import { Share } from '@capacitor/share'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { SERVER_URL } from '../config'
import { Editor } from 'tldraw'
import { customAlert, customPrompt, showToast } from './uiUtils'
import { jsPDF } from 'jspdf'
import 'svg2pdf.js'

// Helper: Convert Blob to Base64
const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = reject
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(blob)
    })
}

export const shareLink = async (roomId: string) => {
    const url = `${SERVER_URL}/#/${roomId}`
    try {
        // Try native share or Web Share API first
        await Share.share({
            title: 'Join my Whiteboard',
            text: 'Collaborate with me on this board:',
            url: url,
            dialogTitle: 'Share Board Link',
        })
    } catch (error) {
        // Fallback to clipboard if Share API fails (common on desktop)
        console.log('Share API not available, falling back to clipboard', error)
        try {
            await navigator.clipboard.writeText(url)
            await customAlert('Link copied to clipboard!')
        } catch (clipboardError) {
            console.error('Failed to copy to clipboard:', clipboardError)
            await customPrompt('Copy this link:', url)
        }
    }
}

export const exportToImage = async (editor: Editor, roomId: string, format: 'png' | 'svg' | 'pdf' = 'png') => {
    try {
        // 1. Get all shape IDs from the current page
        const shapeIds = Array.from(editor.getCurrentPageShapeIds())
        if (shapeIds.length === 0) {
            await customAlert('Board is empty')
            return
        }

        // Show quiet indicator
        showToast(`Preparing ${format.toUpperCase()} export...`, { duration: 3000 })

        // 2. Calculate Bounds to prevent OOM
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        shapeIds.forEach(id => {
            const bounds = editor.getShapePageBounds(id)
            if (bounds) {
                minX = Math.min(minX, bounds.x)
                minY = Math.min(minY, bounds.y)
                maxX = Math.max(maxX, bounds.x + bounds.w)
                maxY = Math.max(maxY, bounds.y + bounds.h)
            }
        })

        const width = maxX - minX
        const height = maxY - minY

        // --- SVG EXPORT ---
        if (format === 'svg') {
            try {
                // Use toImage with format: 'svg' which returns a Blob
                const result = await editor.toImage(shapeIds, {
                    format: 'svg',
                    background: true,
                    scale: 5,
                    padding: 32,
                })

                if (!result || !result.blob) throw new Error('Failed to generate SVG blob')

                // Convert Blob to Base64
                const base64Data = await blobToBase64(result.blob)
                // base64Data is like "data:image/svg+xml;base64,PHN2Zy..."
                const base64Svg = base64Data.split(',')[1]

                const fileName = `board-${roomId}-${Date.now()}.svg`

                const savedFile = await Filesystem.writeFile({
                    path: fileName,
                    data: base64Svg,
                    directory: Directory.Cache
                })

                try {
                    await Share.share({
                        title: 'Export Board as SVG',
                        files: [savedFile.uri],
                    })
                } catch (shareError) {
                    console.log('Share API not available for SVG, downloading directly')
                    // For SVG blob, we can use the base64 data URI we already have
                    const downloadUrl = base64Data
                    const link = document.createElement('a')
                    link.href = downloadUrl
                    link.download = fileName
                    document.body.appendChild(link)
                    link.click()
                    document.body.removeChild(link)
                }
                return
            } catch (e: any) {
                console.error('SVG Export failed', e)
                throw new Error('SVG Export failed: ' + e.message)
            }
        }

        // --- IMAGE GENERATION (PNG/PDF) ---

        // Limit max dimension to ~4000px (increased from 3000) for better quality,
        // but still safety capped for mobile memory
        const MAX_DIMENSION = 4000
        let scale = 3 // Default high quality scale (increased from 2)

        if (width * scale > MAX_DIMENSION || height * scale > MAX_DIMENSION) {
            scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height)
            console.log(`Large board detected. Reducing scale to ${scale.toFixed(2)} to prevent crash.`)
        }

        // 3. Generate Image with improved scale
        let result
        try {
            // Force PNG for quality first
            result = await editor.toImage(shapeIds, {
                format: 'png',
                background: true,
                scale: scale,
                padding: 32,
            })
        } catch (e) {
            throw new Error('Image generation failed: ' + (e as any).message)
        }

        if (!result || !result.blob) {
            throw new Error('Failed to generate image blob (empty result)')
        }

        // --- PDF EXPORT (Vector Optimized) ---
        if (format === 'pdf') {
            try {
                // Ask user for background preference
                const isDarkMode = editor.user.getIsDarkMode()
                let keepBackground = true

                if (isDarkMode) {
                    keepBackground = window.confirm(
                        "Export with Dark Background?\n\n" +
                        "OK: Keep dark background (like screen)\n" +
                        "Cancel: Use light background (better for printing)"
                    )
                }

                // 1. Generate SVG first (best quality, vector)
                const result = await editor.toImage(shapeIds, {
                    format: 'svg',
                    scale: 1,
                    background: keepBackground, // Tldraw handles theme based on current user preference usually
                    padding: 32,
                    darkMode: keepBackground ? isDarkMode : false // Force light mode if user wants printing version
                })

                if (!result || !result.blob) throw new Error('Failed to generate SVG for PDF')

                // 2. Read SVG string from Blob
                const svgText = await result.blob.text()

                // 3. Parse to DOM Element
                const parser = new DOMParser()
                const svgElement = parser.parseFromString(svgText, "image/svg+xml").documentElement as unknown as SVGElement

                // 4. Create PDF with correct dimensions
                // Dimensions are in pixels in the SVG, we can keep using pixels in PDF for simplicity
                const orientation = width > height ? 'l' : 'p'
                const pdf = new jsPDF({
                    orientation,
                    unit: 'px',
                    format: [width + 64, height + 64] // Add padding
                })

                // Draw background directly on PDF canvas
                if (keepBackground) {
                    const bgColor = isDarkMode ? "#212529" : "#ffffff"
                    pdf.setFillColor(bgColor)
                    pdf.rect(0, 0, width + 64, height + 64, 'F')
                }

                // 5. Render SVG to PDF using svg2pdf (injected into jsPDF)
                // Note: using 'await' as svg() returns a Promise
                await pdf.svg(svgElement, {
                    x: 0,
                    y: 0,
                    width: width + 64,
                    height: height + 64,
                })

                // 6. Output as base64 string
                const pdfBase64 = pdf.output('datauristring').split(',')[1]

                const fileName = `board-${roomId}-${Date.now()}.pdf`

                const savedFile = await Filesystem.writeFile({
                    path: fileName,
                    data: pdfBase64,
                    directory: Directory.Cache
                })

                try {
                    await Share.share({
                        title: 'Export Board as PDF',
                        files: [savedFile.uri],
                    })
                } catch (shareError) {
                    console.log('Share API not available for PDF, downloading directly')
                    const downloadUrl = `data:application/pdf;base64,${pdfBase64}`
                    const link = document.createElement('a')
                    link.href = downloadUrl
                    link.download = fileName
                    document.body.appendChild(link)
                    link.click()
                    document.body.removeChild(link)
                }
                return

            } catch (e: any) {
                console.error('PDF Export failed', e)
                throw new Error('PDF Export failed: ' + e.message)
            }
        }

        // --- PNG EXPORT (FALLBACK & DEFAULT) ---

        // 4. Check file size. If huge (>4MB), convert to JPEG to ensure shareability
        // Increased limit from 2MB to 4MB as devices handle larger files now
        if (result.blob.size > 4 * 1024 * 1024) {
            console.log('Image too large (>4MB), switching to JPEG for compression')
            try {
                result = await editor.toImage(shapeIds, {
                    format: 'jpeg',
                    quality: 0.9, // High quality JPEG
                    background: true,
                    scale: scale,
                    padding: 32,
                })
            } catch (e) {
                console.warn('JPEG fallback failed, using original PNG')
            }
        }

        // 5. Convert Blob to Base64 for Capacitor
        let pureBase64
        try {
            const base64Data = await blobToBase64(result.blob!)
            pureBase64 = base64Data.split(',')[1]
        } catch (e) {
            throw new Error('Base64 conversion failed')
        }

        const isJpeg = result.blob!.type === 'image/jpeg'
        const ext = isJpeg ? 'jpg' : 'png'
        const mimeType = isJpeg ? 'image/jpeg' : 'image/png'
        const fileName = `board-${roomId}-${Date.now()}.${ext}`

        // 6. Save to Capacitor Filesystem
        let savedFile
        try {
            savedFile = await Filesystem.writeFile({
                path: fileName,
                data: pureBase64,
                directory: Directory.Cache
            })
        } catch (e) {
            throw new Error('File save failed: ' + (e as any).message)
        }

        // 7. Share
        try {
            await Share.share({
                title: 'Export Board',
                files: [savedFile.uri],
            })
        } catch (e) {
            console.log('Share API failed or not available, falling back to download', e)

            // Web/Desktop Fallback: Download via anchor tag
            const downloadUrl = `data:${mimeType};base64,${pureBase64}`
            const link = document.createElement('a')
            link.href = downloadUrl
            link.download = fileName
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
        }

    } catch (error) {
        console.error('Export failed:', error)
        await customAlert((error as any).message)
    }
}
