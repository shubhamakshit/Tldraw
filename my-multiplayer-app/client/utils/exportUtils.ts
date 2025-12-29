import { Share } from '@capacitor/share'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { SERVER_URL } from '../config'
import { Editor } from 'tldraw'
import { customAlert, customPrompt } from './uiUtils'

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

export const exportToImage = async (editor: Editor, roomId: string) => {
    try {
        // 1. Get all shape IDs from the current page
        const shapeIds = Array.from(editor.getCurrentPageShapeIds())
        if (shapeIds.length === 0) {
            await customAlert('Board is empty')
            return
        }

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
        
        // Limit max dimension to ~3000px to avoid Android texture/memory limits
        const MAX_DIMENSION = 3000
        let scale = 2
        if (width * scale > MAX_DIMENSION || height * scale > MAX_DIMENSION) {
            scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height)
            console.log(`Large board detected. Reducing scale to ${scale.toFixed(2)} to prevent crash.`)
        }

        // 3. Generate Image with safe scale
        let result
        try {
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

        // 4. Check file size. If huge (>2MB), convert to JPEG to ensure shareability
        if (result.blob.size > 2 * 1024 * 1024) {
            console.log('Image too large (>2MB), switching to JPEG for compression')
            try {
                result = await editor.toImage(shapeIds, {
                    format: 'jpeg',
                    quality: 0.8,
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
        
        const ext = result.blob!.type === 'image/jpeg' ? 'jpg' : 'png'
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
            throw new Error('Share API failed: ' + (e as any).message)
        }

    } catch (error) {
        console.error('Export failed:', error)
        await customAlert((error as any).message)
    }
}