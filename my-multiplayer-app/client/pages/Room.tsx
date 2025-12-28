import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Tldraw, useEditor } from 'tldraw' // Added useEditor here
import { useSync } from '@tldraw/sync' // Corrected: useSync specifically from @tldraw/sync
import { getBookmarkPreview } from '../getBookmarkPreview' // Corrected path
import { multiplayerAssetStore } from '../multiplayerAssetStore' // Corrected path
import { WS_URL } from '../config' // Corrected path
import { useSPen } from '../hooks/useSPen' // Corrected path
import { saveRoom } from '../pages/storageUtils' // Corrected path
import { StatePersistence } from '../components/StatePersistence' // Corrected path
import { NavigationDock } from '../components/NavigationDock' // Corrected path

export function Room() {
    const { roomId } = useParams<{ roomId: string }>()
    const navigate = useNavigate()
    
    if (!roomId) {
        navigate('/')
        return null
    }

    useEffect(() => {
        saveRoom(roomId)
    }, [roomId])

    const store = useSync({ // Using useSync from @tldraw/sync
        uri: `${WS_URL}/api/connect/${roomId}`,
        assets: multiplayerAssetStore,
    })

    return (
        <div style={{ position: 'fixed', inset: 0 }}>
            <Tldraw
                store={store}
                deepLinks
                onMount={(editor) => {
                    editor.registerExternalAssetHandler('url', getBookmarkPreview)
                }}
            >
                <SPenController />
                <StatePersistence roomId={roomId} />
                <NavigationDock roomId={roomId} />
            </Tldraw>
        </div>
    )
}

function SPenController() {
    const editor = useEditor() // useEditor needs to be imported here too
    useSPen(editor)
    return null
}