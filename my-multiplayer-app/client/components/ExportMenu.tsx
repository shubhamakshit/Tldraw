import { useState } from 'react'
import { useEditor } from 'tldraw'
import { Share } from '@capacitor/share'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { colors } from '../constants/theme'
import { LinkIcon, ImageIcon } from './Icons'
import { SERVER_URL } from '../config'

interface ExportMenuProps {
    roomId: string
    theme: any
}

export function ExportMenu({ roomId, theme }: ExportMenuProps) {
    const editor = useEditor()
    const [loading, setLoading] = useState(false)

    // Helper: Convert Blob to Base64
    const blobToBase64 = (blob: Blob): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onerror = reject
            reader.onload = () => resolve(reader.result as string)
            reader.readAsDataURL(blob)
        })
    }

    const handleShareLink = async () => {
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
                alert('Link copied to clipboard!')
            } catch (clipboardError) {
                console.error('Failed to copy to clipboard:', clipboardError)
                prompt('Copy this link:', url)
            }
        }
    }

    const handleExportImage = async () => {
        setLoading(true)
        try {
            // 1. Get all shape IDs from the current page
            const shapeIds = Array.from(editor.getCurrentPageShapeIds())
            if (shapeIds.length === 0) {
                alert('Board is empty')
                setLoading(false)
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
            let result = await editor.toImage(shapeIds, {
                format: 'png',
                background: true,
                scale: scale,
                padding: 32,
            })

            if (!result || !result.blob) {
                throw new Error('Failed to generate image blob')
            }

            // 4. Check file size. If huge (>2MB), convert to JPEG to ensure shareability
            if (result.blob.size > 2 * 1024 * 1024) {
                console.log('Image too large (>2MB), switching to JPEG for compression')
                result = await editor.toImage(shapeIds, {
                    format: 'jpeg',
                    quality: 0.8,
                    background: true,
                    scale: scale,
                    padding: 32,
                })
            }

            // 5. Convert Blob to Base64 for Capacitor
            const base64Data = await blobToBase64(result.blob!)
            const pureBase64 = base64Data.split(',')[1] 
            
            const ext = result.blob!.type === 'image/jpeg' ? 'jpg' : 'png'
            const fileName = `board-${roomId}-${Date.now()}.${ext}`
            
            // 6. Save to Capacitor Filesystem
            const savedFile = await Filesystem.writeFile({
                path: fileName,
                data: pureBase64,
                directory: Directory.Cache
            })

            // 7. Share
            await Share.share({
                title: 'Export Board',
                files: [savedFile.uri],
            })

        } catch (error) {
            console.error('Export failed:', error)
            alert('Failed to export image: ' + (error as any).message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div style={{ padding: 16 }}>
            <div style={{
                fontSize: 11,
                fontWeight: 600,
                color: colors.textMuted,
                textTransform: 'uppercase',
                marginBottom: 12,
            }}>
                Share & Export
            </div>

            <button
                onClick={handleShareLink}
                style={{
                    width: '100%',
                    padding: '12px',
                    marginBottom: 12,
                    background: theme.hover,
                    color: theme.text,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    cursor: 'pointer',
                    fontSize: 14,
                }}
            >
                <LinkIcon />
                Share Link
            </button>

            <button
                onClick={handleExportImage}
                disabled={loading}
                style={{
                    width: '100%',
                    padding: '12px',
                    background: theme.hover,
                    color: theme.text,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    cursor: 'pointer',
                    fontSize: 14,
                    opacity: loading ? 0.7 : 1
                }}
            >
                <ImageIcon />
                {loading ? 'Generating...' : 'Export Image'}
            </button>
        </div>
    )
}