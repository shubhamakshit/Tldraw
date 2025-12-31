import { useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { 
    Tldraw, 
    DefaultMainMenu, 
    DefaultMainMenuContent, 
    TldrawUiMenuItem, 
    TldrawUiMenuGroup, 
    TLComponents,
    DefaultContextMenu,
    DefaultContextMenuContent,
    DefaultToolbar,
    DefaultToolbarContent,
    defaultShapeUtils,
    useEditor,
    track,
} from 'tldraw' 
import { useSync } from '@tldraw/sync'
import { getBookmarkPreview } from '../getBookmarkPreview'
import { multiplayerAssetStore } from '../multiplayerAssetStore'
import { WS_URL, SERVER_URL } from '../config'
import { saveRoom } from './storageUtils'
import { StatePersistence } from '../components/StatePersistence'
import { NavigationDock } from '../components/NavigationDock'
import { getUiOverrides } from '../overrides'
import { shareLink } from '../utils/exportUtils'
import { HatchGeoShapeUtil } from '../HatchGeoShapeUtil'
import { SPenController } from '../components/SPenController'
import { LockStatus, ToggleLockMenuItem } from '../components/LockComponents'
import { SelectOptionsPanel, SelectLockedToggle, SelectLockedLogic } from '../components/SelectLockedComponents'
import { CustomStylePanel, getInitialMetaForOpacity } from '../components/CustomStylePanel'
import { BrushManager } from '../components/BrushManager'
import { EquationRenderer } from '../components/EquationRendererSimple'
import { getEraserSettings } from '../utils/eraserUtils'
import { EquationShapeUtil } from '../shapes/EquationShapeUtil'

const customShapeUtils = [
    ...defaultShapeUtils.filter(u => u.type !== 'geo'),
    HatchGeoShapeUtil,
    EquationShapeUtil
]

export function RoomPage() {
    const { roomId } = useParams<{ roomId: string }>()
    const navigate = useNavigate()
    
    console.log(`[Room] Initializing. RoomID: ${roomId}`);
    console.log(`[Room] Constants -> SERVER_URL: ${SERVER_URL}, WS_URL: ${WS_URL}`);

    if (!roomId) {
        navigate('/')
        return null
    }

    useEffect(() => {
        saveRoom(roomId)
        const metaUrl = `${SERVER_URL}/api/meta/${roomId}`;
        console.log(`[Room] Fetching metadata from: ${metaUrl}`);
        
        fetch(metaUrl)
            .then(res => res.json())
            .then((data: any) => {
                if (data.name) {
                    saveRoom(roomId, data.name)
                    window.dispatchEvent(new Event('tldraw-room-update'))
                }
            })
            .catch(err => console.error('Failed to fetch room metadata:', err))
    }, [roomId])

    const syncUri = `${WS_URL}/api/connect/${roomId}`;
    console.log(`[Room] Syncing with URI: ${syncUri}`);

    const store = useSync({
        uri: syncUri,
        assets: multiplayerAssetStore,
        shapeUtils: customShapeUtils,
    })

    const overrides = useMemo(() => getUiOverrides(roomId), [roomId])

    const EditEquationMenuItem = track(() => {
        const editor = useEditor()
        const selectedShapes = editor.getSelectedShapes()
        const isEquationSelected = selectedShapes.length === 1 && selectedShapes[0].type === 'equation'
        
        if (!isEquationSelected) return null
        
        return (
            <TldrawUiMenuItem
                id="edit-equation"
                label="Edit Formula"
                icon="edit"
                onSelect={() => {
                    const shape = selectedShapes[0]
                    // Trigger equation editor with shape data
                    window.dispatchEvent(new CustomEvent('open-equation-editor', { 
                        detail: { shapeId: shape.id } 
                    }))
                }}
            />
        )
    })

    const components = useMemo<TLComponents>(() => ({
        MainMenu: () => (
            <DefaultMainMenu>
                <TldrawUiMenuGroup id="navigation">
                     <TldrawUiMenuItem
                        id="go-home"
                        label="Go to Home"
                        icon="home"
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
        ),
        ContextMenu: (props) => (
            <DefaultContextMenu {...props}>
                <TldrawUiMenuGroup id="modify">
                    <ToggleLockMenuItem />
                    <EditEquationMenuItem />
                </TldrawUiMenuGroup>
                <DefaultContextMenuContent />
            </DefaultContextMenu>
        ),
        Toolbar: (props) => (
            <DefaultToolbar {...props}>
                <DefaultToolbarContent />
                <SelectLockedToggle />
            </DefaultToolbar>
        ),
        StylePanel: (props) => <CustomStylePanel {...props} />,
        InFrontOfTheCanvas: () => (
            <>
                <LockStatus />
                <SelectOptionsPanel />
            </>
        )
    }), [roomId, navigate])

    return (
        <div style={{ position: 'fixed', inset: 0 }}>
            <Tldraw
                store={store}
                deepLinks
                overrides={overrides}
                components={components}
                shapeUtils={customShapeUtils}
                onMount={(editor) => {
                    editor.registerExternalAssetHandler('url', getBookmarkPreview)
                    editor.user.updateUserPreferences({ colorScheme: 'dark' })
                    
                    // Prevent editing equation shapes by intercepting the editingShapeId change
                    editor.sideEffects.registerBeforeChangeHandler('instance', (prev: any, next: any) => {
                        // If trying to set editingShapeId for an equation shape, prevent it
                        if (next.editingShapeId && next.editingShapeId !== prev.editingShapeId) {
                            const shape = editor.getShape(next.editingShapeId)
                            if (shape && shape.type === 'equation') {
                                // Return the previous state (no editing)
                                return prev
                            }
                        }
                        return next
                    })
                    
                    editor.sideEffects.registerBeforeCreateHandler('shape', (shape) => {
                        if (shape.type === 'geo') {
                            return {
                                ...shape,
                                meta: {
                                    ...shape.meta,
                                    ...getInitialMetaForOpacity(editor)
                                }
                            }
                        }
                        return shape
                    })

                    editor.sideEffects.registerBeforeChangeHandler('instance_page_state', (_prev: any, next: any) => {
                        if (next.erasingShapeIds.length === 0) return next
                        const settings = getEraserSettings()
                        const filteredIds = next.erasingShapeIds.filter((id: any) => {
                            const shape = editor.getShape(id)
                            if (!shape) return false
                            const { type } = shape
                            if (['draw', 'highlight'].includes(type)) return settings.scribble
                            if (type === 'text') return settings.text
                            if (['geo', 'arrow', 'line', 'note', 'frame', 'group'].includes(type)) return settings.shapes
                            if (['image', 'video'].includes(type)) return settings.images
                            return true
                        })
                        if (filteredIds.length !== next.erasingShapeIds.length) {
                            return { ...next, erasingShapeIds: filteredIds }
                        }
                        return next
                    })

                    editor.sideEffects.registerBeforeDeleteHandler('shape', (shape: any) => {
                        if (editor.getCurrentToolId() !== 'eraser') return
                        const settings = getEraserSettings()
                        const { type } = shape
                        if (['draw', 'highlight'].includes(type) && !settings.scribble) return false
                        if (type === 'text' && !settings.text) return false
                        if (['geo', 'arrow', 'line', 'note', 'frame', 'group'].includes(type) && !settings.shapes) return false
                        if (['image', 'video'].includes(type) && !settings.images) return false
                    })
                }}
            >
                <SPenController />
                <StatePersistence roomId={roomId} />
                <NavigationDock roomId={roomId} />
                <SelectLockedLogic />
                <BrushManager />
                <EquationRenderer />
            </Tldraw>
        </div>
    )
}