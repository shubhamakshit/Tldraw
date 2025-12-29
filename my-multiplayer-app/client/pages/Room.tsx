import { useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { 
    Tldraw, 
    useEditor, 
    DefaultMainMenu, 
    DefaultMainMenuContent, 
    TldrawUiMenuItem, 
    TldrawUiMenuGroup, 
    TLComponents 
} from 'tldraw' 
import { useSync } from '@tldraw/sync' // Corrected: useSync specifically from @tldraw/sync
import { getBookmarkPreview } from '../getBookmarkPreview' // Corrected path
import { multiplayerAssetStore } from '../multiplayerAssetStore' // Corrected path
import { WS_URL, SERVER_URL } from '../config' // Corrected path
import { useSPen } from '../hooks/useSPen' // Corrected path
import { saveRoom } from '../pages/storageUtils' // Corrected path
import { StatePersistence } from '../components/StatePersistence' // Corrected path
import { NavigationDock } from '../components/NavigationDock' // Corrected path
import { getUiOverrides } from '../overrides' // Import overrides
import { shareLink } from '../utils/exportUtils' // Import share utility

export function Room() {
    const { roomId } = useParams<{ roomId: string }>()
    const navigate = useNavigate()
    
    if (!roomId) {
        navigate('/')
        return null
    }

    useEffect(() => {
        // 1. Save locally immediately so it appears in history
        saveRoom(roomId)

        // 2. Fetch remote metadata (name) to sync
        fetch(`${SERVER_URL}/api/meta/${roomId}`)
            .then(res => res.json())
            .then((data: any) => {
                if (data.name) {
                    saveRoom(roomId, data.name)
                    // Trigger a custom event so other components (like NavigationDock) can update if needed
                    window.dispatchEvent(new Event('tldraw-room-update'))
                }
            })
            .catch(err => console.error('Failed to fetch room metadata:', err))
    }, [roomId])

    const store = useSync({ // Using useSync from @tldraw/sync
        uri: `${WS_URL}/api/connect/${roomId}`,
        assets: multiplayerAssetStore,
    })

    const overrides = useMemo(() => getUiOverrides(roomId), [roomId])

    // --- NATIVE MENU OVERRIDE ---
    const components = useMemo<TLComponents>(() => ({
        MainMenu: () => (
            <DefaultMainMenu>
                <TldrawUiMenuGroup id="navigation">
                     <TldrawUiMenuItem
                        id="go-home"
                        label="Go to Home"
                        icon="home" // Ensure 'home' icon is available or use a generic one if not
                        readonlyOk
                        onSelect={() => navigate('/')}
                    />
                </TldrawUiMenuGroup>
                <TldrawUiMenuGroup id="share">
                    <TldrawUiMenuItem
                        id="share-link"
                        label="Share Link"
                        icon="link"
                        readonlyOk
                        onSelect={() => shareLink(roomId)}
                    />
                </TldrawUiMenuGroup>
                <DefaultMainMenuContent />
            </DefaultMainMenu>
        )
    }), [roomId, navigate])

    return (
        <div style={{ position: 'fixed', inset: 0 }}>
            <Tldraw
                store={store}
                deepLinks
                overrides={overrides}
                components={components}
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