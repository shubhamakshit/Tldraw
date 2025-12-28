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
        try {
            await Share.share({
                title: 'Join my Whiteboard',
                text: 'Collaborate with me on this board:',
                url: `${SERVER_URL}/#/${roomId}`,
                dialogTitle: 'Share Board Link',
            })
        } catch (error) {
            console.error('Error sharing link:', error)
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

            // 2. Use editor.toImage() 
            // This is the standard API in recent tldraw versions to get a Blob directly
            const result = await editor.toImage(shapeIds, {
                format: 'png',
                background: true, // Include background
                scale: 2,         // High DPI for mobile
                padding: 32,      // Padding around shapes
            })

            if (!result || !result.blob) {
                throw new Error('Failed to generate image blob')
            }

            // 3. Convert Blob to Base64 for Capacitor
            const base64Data = await blobToBase64(result.blob)
            const pureBase64 = base64Data.split(',')[1] // Remove 'data:image/png;base64,' prefix
            
            const fileName = `board-${roomId}-${Date.now()}.png`
            
            // 4. Save to Capacitor Filesystem (Cache directory)
            const savedFile = await Filesystem.writeFile({
                path: fileName,
                data: pureBase64,
                directory: Directory.Cache
            })

            // 5. Share the file URI using native share sheet
            await Share.share({
                title: 'Export Board',
                files: [savedFile.uri],
            })

        } catch (error) {
            console.error('Export failed:', error)
            alert('Failed to export image')
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