import { useState } from 'react'
import { useEditor, TldrawUiMenuItem } from 'tldraw'
import { useAuth } from '../hooks/useAuth'
import { useBackups } from '../hooks/useBackups'

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
