import { useState, useRef, useEffect, ChangeEvent } from 'react'
import { useEditor, TldrawUiMenuItem, uniqueId } from 'tldraw'
import { useAuth } from '../hooks/useAuth'
import { useBackups } from '../hooks/useBackups'
import { exportToImage } from '../utils/exportUtils'
import { triggerSvgImport } from '../utils/svgImport'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { Capacitor } from '@capacitor/core'

export function BackupMenuItem({ roomId }: { roomId: string }) {
    const editor = useEditor()
    const { isAuthenticated } = useAuth()
    const { createBackup } = useBackups()
    const [isBackingUp, setIsBackingUp] = useState(false)

    if (!isAuthenticated) return null

    const handleBackup = async () => {
        if (isBackingUp) return

        const confirmBackup = window.confirm("Save a backup of this board to the cloud?")
        if (!confirmBackup) return

        setIsBackingUp(true)
        try {
            const snapshot = editor.getSnapshot()
            // Get room name if available (from local storage or metadata?)
            // We can try to get it from the store if we stored it there,
            // otherwise just use the ID or ask the user.
            // For now let's check localStorage for the name we saved in Lobby/RoomPage

            // Try to find name in local storage first
            let roomName = 'Untitled'
            try {
                const storedRooms = localStorage.getItem('tldraw_saved_rooms')
                if (storedRooms) {
                    const parsed = JSON.parse(storedRooms)
                    const room = parsed.find((r: any) => r.id === roomId)
                    if (room) roomName = room.name
                }
            } catch (e) {}

            await createBackup(snapshot, roomName, roomId, 'tldraw')
            alert('Backup saved successfully!')
        } catch (e: any) {
            console.error(e)
            alert('Failed to save backup: ' + e.message)
        } finally {
            setIsBackingUp(false)
        }
    }

    return (
        <TldrawUiMenuItem
            id="cloud-backup"
            label={isBackingUp ? "Backing up..." : "Save to Cloud"}
            icon="cloud"
            readonlyOk
            onSelect={handleBackup}
            disabled={isBackingUp}
        />
    )
}

export function DownloadMenuItem({ roomId }: { roomId: string }) {
    const editor = useEditor()

    const handleDownload = async () => {
        try {
            const snapshot = editor.getSnapshot()
            const jsonStr = JSON.stringify({
                snapshot,
                roomId,
                timestamp: Date.now(),
                source: 'tldraw-multiplayer'
            }, null, 2)

            const fileName = `tldraw-room-${roomId}-${new Date().toISOString().slice(0,10)}.json`

            if (Capacitor.isNativePlatform()) {
                // Native (Android/iOS): Use Filesystem + Share
                try {
                    const savedFile = await Filesystem.writeFile({
                        path: fileName,
                        data: jsonStr,
                        directory: Directory.Cache,
                        encoding: Encoding.UTF8
                    })

                    await Share.share({
                        title: 'Backup Board JSON',
                        files: [savedFile.uri],
                    })
                } catch (err: any) {
                    console.error('Native save failed', err)
                    alert('Failed to save file: ' + err.message)
                }
            } else {
                // Web: Use anchor tag download
                const blob = new Blob([jsonStr], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = fileName
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
                URL.revokeObjectURL(url)
            }
        } catch (e: any) {
            console.error('Failed to download backup', e)
            alert('Failed to download backup: ' + e.message)
        }
    }

    return (
        <TldrawUiMenuItem
            id="download-json"
            label="Download File"
            icon="download"
            readonlyOk
            onSelect={handleDownload}
        />
    )
}

export function RestoreMenuItem() {
    const handleRestoreClick = () => {
        window.dispatchEvent(new CustomEvent('tldraw-trigger-file-restore'))
    }

    return (
        <TldrawUiMenuItem
            id="restore-json"
            label="Restore from File"
            icon="external-link"
            readonlyOk
            onSelect={handleRestoreClick}
        />
    )
}

export function RestoreFileHandler({ roomId: _roomId }: { roomId: string }) {
    const editor = useEditor()
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        const handleTrigger = () => {
            if (inputRef.current) {
                inputRef.current.click()
            }
        }
        window.addEventListener('tldraw-trigger-file-restore', handleTrigger)
        return () => window.removeEventListener('tldraw-trigger-file-restore', handleTrigger)
    }, [])

    const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        const reader = new FileReader()
        reader.onload = (event) => {
            try {
                const jsonStr = event.target?.result as string
                const data = JSON.parse(jsonStr)

                // Handle both raw snapshot or our wrapped format
                const snapshot = data.snapshot || data

                const mode = window.confirm('Restore as a NEW board? (Click Cancel to OVERWRITE the current board)')

                if (mode) {
                    // Restore as New
                    const newId = uniqueId()
                    const name = data.roomName || 'Restored Board'

                    // Store for the new room to pick up
                    localStorage.setItem(`restore_data_${newId}`, JSON.stringify({
                        snapshot,
                        roomName: name
                    }))

                    // Save to recents
                    const storedRooms = localStorage.getItem('tldraw_saved_rooms')
                    let recentRooms = []
                    try {
                        if (storedRooms) recentRooms = JSON.parse(storedRooms)
                    } catch (e) {}

                    recentRooms.push({
                        id: newId,
                        name: name,
                        lastVisited: Date.now()
                    })
                    localStorage.setItem('tldraw_saved_rooms', JSON.stringify(recentRooms))

                    // Open in new tab or navigate?
                    // Let's navigate to keep it simple, or open in new tab if requested.
                    // Implementation plan said "Creates new Room -> Loads snapshot -> Navigates to room"
                    window.location.assign(`/#/${newId}`)
                } else {
                    // Overwrite Current
                    if (window.confirm('WARNING: This will permanently overwrite the current board content for everyone. Are you sure?')) {
                        editor.loadSnapshot(snapshot)
                    }
                }
            } catch (e: any) {
                console.error('Failed to parse backup file', e)
                alert('Failed to restore backup: Invalid file format (' + e.message + ')')
            } finally {
                // Reset input
                if (inputRef.current) inputRef.current.value = ''
            }
        }
        reader.onerror = (err) => {
             alert('FileReader Error: ' + err)
        }
        reader.readAsText(file)
    }

    return (
        <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            style={{ position: 'fixed', top: '-10000px', left: '-10000px', opacity: 0, pointerEvents: 'none' }}
            onChange={handleFileChange}
        />
    )
}

export function PdfExportMenuItem({ roomId }: { roomId: string }) {
    const editor = useEditor()
    const [isExporting, setIsExporting] = useState(false)

    const handleExport = async () => {
        if (isExporting) return
        setIsExporting(true)
        try {
            await exportToImage(editor, roomId, 'pdf')
        } catch (e) {
            console.error(e)
        } finally {
            setIsExporting(false)
        }
    }

    return (
        <TldrawUiMenuItem
            id="export-as-pdf"
            label={isExporting ? "Exporting PDF..." : "Export as PDF"}
            icon="file" // Using generic file icon as 'pdf' might not be standard in Tldraw icon set yet, or we could check. 'file' is safe.
            readonlyOk
            onSelect={handleExport}
            disabled={isExporting}
        />
    )
}

export function ImportSvgMenuItem() {
    const editor = useEditor()

    const handleImport = () => {
        triggerSvgImport(editor)
    }

    return (
        <TldrawUiMenuItem
            id="import-svg"
            label="Import from SVG"
            icon="image"
            readonlyOk
            onSelect={handleImport}
        />
    )
}

