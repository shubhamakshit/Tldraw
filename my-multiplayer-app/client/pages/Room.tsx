import { useSync } from '@tldraw/sync'
import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Tldraw, useEditor, uniqueId } from 'tldraw'
import { getBookmarkPreview } from '../getBookmarkPreview'
import { multiplayerAssetStore } from '../multiplayerAssetStore'
import { Clipboard } from '@capacitor/clipboard'
import { WS_URL, SERVER_URL } from '../config'
import { useSPen } from '../hooks/useSPen'
import { RoomMetadata, getRooms, saveRoom, updateRoomName, deleteRoom } from './storageUtils'

// Stable color palette - no transparency issues
const colors = {
    panelBg: '#ffffff',
    panelBgDark: '#1e1e1e',
    border: '#e5e5e5',
    borderDark: '#3a3a3a',
    hover: '#f5f5f5',
    hoverDark: '#2a2a2a',
    selected: '#2563eb',
    text: '#1a1a1a',
    textDark: '#ffffff',
    textMuted: '#6b7280',
    overlay: 'rgba(0, 0, 0, 0.5)',
}

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

    const store = useSync({
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

// -----------------------------------------------------------------------------
// NAVIGATION DOCK
// -----------------------------------------------------------------------------

type Tab = 'none' | 'files' | 'settings'

function NavigationDock({ roomId }: { roomId: string }) {
    const navigate = useNavigate()
    const editor = useEditor()
    const [activeTab, setActiveTab] = useState<Tab>('none')
    const [rooms, setRooms] = useState<RoomMetadata[]>([])
    const [didCopy, setDidCopy] = useState(false)
    const [isDark, setIsDark] = useState(false)

    // Track dark mode
    useEffect(() => {
        const checkDark = () => {
            const prefs = editor.user.getUserPreferences()
            setIsDark(prefs.colorScheme === 'dark')
        }
        checkDark()
        const interval = setInterval(checkDark, 500)
        return () => clearInterval(interval)
    }, [editor])

    const theme = {
        bg: isDark ? colors.panelBgDark : colors.panelBg,
        border: isDark ? colors.borderDark : colors.border,
        hover: isDark ? colors.hoverDark : colors.hover,
        text: isDark ? colors.textDark : colors.text,
    }

    useEffect(() => {
        if (activeTab === 'files') {
            setRooms(getRooms().sort((a, b) => b.lastVisited - a.lastVisited))
        }
    }, [activeTab])

    const handleRename = (id: string, newName: string) => {
        const updated = updateRoomName(id, newName)
        setRooms(updated.sort((a, b) => b.lastVisited - a.lastVisited))
    }

    const toggleTheme = () => {
        const current = editor.user.getUserPreferences()
        const newScheme = current.colorScheme === 'dark' ? 'light' : 'dark'
        editor.user.updateUserPreferences({ colorScheme: newScheme })
        setIsDark(newScheme === 'dark')
    }

    const toggleGrid = () => {
        editor.updateInstanceState({ isGridMode: !editor.getInstanceState().isGridMode })
    }

    const isOpen = activeTab !== 'none'

    return (
        <>
            {/* DOCK BUTTONS */}
            <div style={{
                position: 'absolute',
                top: 60,
                left: 12,
                zIndex: 300,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
            }}>
                <NavButton 
                    active={activeTab === 'files'}
                    onClick={() => setActiveTab(activeTab === 'files' ? 'none' : 'files')}
                    title="Your Boards"
                    theme={theme}
                >
                    <FolderIcon />
                </NavButton>

                <NavButton 
                    active={activeTab === 'settings'}
                    onClick={() => setActiveTab(activeTab === 'settings' ? 'none' : 'settings')}
                    title="Settings"
                    theme={theme}
                >
                    <SettingsIcon />
                </NavButton>
            </div>

            {/* BACKDROP */}
            {isOpen && (
                <div 
                    onClick={() => setActiveTab('none')}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 400,
                        background: colors.overlay,
                    }}
                />
            )}

            {/* SIDEBAR PANEL */}
            <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                bottom: 0,
                width: 300,
                background: theme.bg,
                borderRight: `1px solid ${theme.border}`,
                zIndex: 500,
                transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
                transition: 'transform 0.2s ease-out',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: isOpen ? '4px 0 20px rgba(0,0,0,0.15)' : 'none',
            }}>
                {/* HEADER */}
                <div style={{
                    padding: 16,
                    borderBottom: `1px solid ${theme.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}>
                    <h2 style={{
                        fontSize: 16,
                        fontWeight: 600,
                        margin: 0,
                        color: theme.text,
                    }}>
                        {activeTab === 'files' ? 'My Boards' : 'Settings'}
                    </h2>
                    <button
                        onClick={() => setActiveTab('none')}
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 4,
                            color: colors.textMuted,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <CloseIcon />
                    </button>
                </div>

                {/* FILES CONTENT */}
                {activeTab === 'files' && (
                    <>
                        <div style={{ padding: 12 }}>
                            <button
                                onClick={() => {
                                    const newId = uniqueId()
                                    saveRoom(newId, `Untitled Board ${rooms.length + 1}`)
                                    setActiveTab('none')
                                    navigate(`/${newId}`)
                                }}
                                style={{
                                    width: '100%',
                                    padding: '10px 16px',
                                    background: colors.selected,
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: 8,
                                    fontSize: 14,
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 8,
                                }}
                            >
                                <PlusIcon />
                                New Board
                            </button>
                        </div>

                        <div style={{
                            padding: '0 12px',
                            fontSize: 11,
                            fontWeight: 600,
                            color: colors.textMuted,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                        }}>
                            Recent
                        </div>

                        <div style={{
                            flex: 1,
                            overflowY: 'auto',
                            padding: '8px 8px 12px',
                        }}>
                            {rooms.map(room => (
                                <FileItem 
                                    key={room.id}
                                    room={room}
                                    isActive={room.id === roomId}
                                    theme={theme}
                                    onClick={() => {
                                        if (room.id !== roomId) {
                                            navigate(`/${room.id}`)
                                            setActiveTab('none')
                                        }
                                    }}
                                    onRename={handleRename}
                                    onDelete={(id: string) => {
                                        if (confirm('Delete this board?')) {
                                            const updated = deleteRoom(id)
                                            setRooms(updated)
                                            if (id === roomId) navigate('/')
                                        }
                                    }}
                                />
                            ))}
                        </div>

                        <div style={{
                            padding: 12,
                            borderTop: `1px solid ${theme.border}`,
                        }}>
                            <button
                                onClick={async () => {
                                    try {
                                        await Clipboard.write({ string: `${SERVER_URL}/#/${roomId}` })
                                        setDidCopy(true)
                                        setTimeout(() => setDidCopy(false), 2000)
                                    } catch (e) {
                                        console.error(e)
                                    }
                                }}
                                style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    background: theme.hover,
                                    color: theme.text,
                                    border: `1px solid ${theme.border}`,
                                    borderRadius: 6,
                                    fontSize: 13,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 6,
                                }}
                            >
                                <LinkIcon />
                                {didCopy ? 'Copied!' : 'Copy Link to Board'}
                            </button>
                        </div>
                    </>
                )}

                {/* SETTINGS CONTENT */}
                {activeTab === 'settings' && (
                    <div style={{ padding: 16 }}>
                        <div style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: colors.textMuted,
                            textTransform: 'uppercase',
                            marginBottom: 8,
                        }}>
                            Appearance
                        </div>
                        
                        <SettingRow
                            label="Dark Mode"
                            value={isDark}
                            onClick={toggleTheme}
                            theme={theme}
                        />
                        
                        <SettingRow
                            label="Show Grid"
                            value={editor.getInstanceState().isGridMode}
                            onClick={toggleGrid}
                            theme={theme}
                        />

                        <div style={{
                            marginTop: 24,
                            fontSize: 11,
                            fontWeight: 600,
                            color: colors.textMuted,
                            textTransform: 'uppercase',
                            marginBottom: 8,
                        }}>
                            Info
                        </div>
                        
                        <div style={{
                            padding: '10px 12px',
                            background: theme.hover,
                            borderRadius: 6,
                            fontSize: 12,
                            color: colors.textMuted,
                        }}>
                            Room ID: <code style={{ 
                                userSelect: 'all',
                                color: theme.text,
                                fontFamily: 'monospace',
                            }}>{roomId}</code>
                        </div>
                    </div>
                )}
            </div>
        </>
    )
}

// -----------------------------------------------------------------------------
// COMPONENTS
// -----------------------------------------------------------------------------

interface NavButtonProps {
    children: React.ReactNode
    onClick: () => void
    active: boolean
    title: string
    theme: { bg: string; border: string; hover: string; text: string }
}

function NavButton({ children, onClick, active, title, theme }: NavButtonProps) {
    const [hovered, setHovered] = useState(false)
    
    return (
        <button
            onClick={onClick}
            title={title}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                width: 40,
                height: 40,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: active ? colors.selected : (hovered ? theme.hover : theme.bg),
                color: active ? '#fff' : theme.text,
                border: `1px solid ${active ? colors.selected : theme.border}`,
                borderRadius: 8,
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                transition: 'background 0.15s, border-color 0.15s',
            }}
        >
            {children}
        </button>
    )
}

interface FileItemProps {
    room: RoomMetadata
    isActive: boolean
    theme: { bg: string; border: string; hover: string; text: string }
    onClick: () => void
    onRename: (id: string, name: string) => void
    onDelete: (id: string) => void
}

function FileItem({ room, isActive, theme, onClick, onRename, onDelete }: FileItemProps) {
    const [isEditing, setIsEditing] = useState(false)
    const [tempName, setTempName] = useState(room.name)
    const [hovered, setHovered] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [isEditing])

    const handleFinish = () => {
        if (tempName.trim()) {
            onRename(room.id, tempName.trim())
        } else {
            setTempName(room.name)
        }
        setIsEditing(false)
    }

    return (
        <div
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: 'flex',
                alignItems: 'center',
                padding: '8px 10px',
                borderRadius: 6,
                background: isActive ? theme.hover : (hovered ? theme.hover : 'transparent'),
                cursor: 'pointer',
                marginBottom: 2,
            }}
        >
            <div style={{ 
                marginRight: 10, 
                color: isActive ? colors.selected : colors.textMuted,
                display: 'flex',
            }}>
                <FileIcon />
            </div>
            
            <div style={{ flex: 1, minWidth: 0 }}>
                {isEditing ? (
                    <input
                        ref={inputRef}
                        value={tempName}
                        onChange={(e) => setTempName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleFinish()
                            if (e.key === 'Escape') {
                                setTempName(room.name)
                                setIsEditing(false)
                            }
                        }}
                        onBlur={handleFinish}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: '100%',
                            padding: '2px 6px',
                            background: theme.bg,
                            border: `2px solid ${colors.selected}`,
                            borderRadius: 4,
                            fontSize: 13,
                            color: theme.text,
                            outline: 'none',
                        }}
                    />
                ) : (
                    <div 
                        onDoubleClick={(e) => {
                            e.stopPropagation()
                            setIsEditing(true)
                        }}
                        style={{
                            fontSize: 13,
                            fontWeight: isActive ? 600 : 400,
                            color: theme.text,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                        }}
                    >
                        {room.name}
                    </div>
                )}
                <div style={{ 
                    fontSize: 11, 
                    color: colors.textMuted,
                    marginTop: 2,
                }}>
                    {new Date(room.lastVisited).toLocaleDateString()}
                </div>
            </div>
            
            {!isEditing && hovered && (
                <button 
                    onClick={(e) => {
                        e.stopPropagation()
                        onDelete(room.id)
                    }} 
                    style={{ 
                        background: 'none', 
                        border: 'none', 
                        color: colors.textMuted, 
                        cursor: 'pointer', 
                        padding: 4,
                        display: 'flex',
                    }}
                >
                    <CloseIcon />
                </button>
            )}
        </div>
    )
}

interface SettingRowProps {
    label: string
    value: boolean
    onClick: () => void
    theme: { bg: string; border: string; hover: string; text: string }
}

function SettingRow({ label, value, onClick, theme }: SettingRowProps) {
    return (
        <button
            onClick={onClick}
            style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 12px',
                background: theme.hover,
                border: `1px solid ${theme.border}`,
                borderRadius: 6,
                cursor: 'pointer',
                color: theme.text,
                fontSize: 13,
                marginBottom: 8,
            }}
        >
            <span>{label}</span>
            <span style={{ 
                color: value ? colors.selected : colors.textMuted,
                fontWeight: 500,
            }}>
                {value ? 'On' : 'Off'}
            </span>
        </button>
    )
}

// -----------------------------------------------------------------------------
// ICONS
// -----------------------------------------------------------------------------

const FolderIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
)

const SettingsIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
)

const CloseIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
)

const PlusIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 5v14M5 12h14"/>
    </svg>
)

const FileIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
    </svg>
)

const LinkIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
)

// -----------------------------------------------------------------------------
// STATE PERSISTENCE
// -----------------------------------------------------------------------------

function StatePersistence({ roomId }: { roomId: string }) {
    const editor = useEditor()
    
    useEffect(() => {
        if (!editor) return
        
        const globalPrefsStr = localStorage.getItem('tldraw_global_prefs')
        if (globalPrefsStr) {
            try { 
                editor.user.updateUserPreferences(JSON.parse(globalPrefsStr)) 
            } catch (e) {
                console.error('Failed to load preferences:', e)
            }
        }
        
        const roomStateKey = `tldraw_room_state_${roomId}`
        const savedRoomState = localStorage.getItem(roomStateKey)
        if (savedRoomState) {
            try {
                const state = JSON.parse(savedRoomState)
                if (state.pageId && editor.getPage(state.pageId)) {
                    editor.setCurrentPage(state.pageId)
                }
                if (state.camera) {
                    editor.setCamera(state.camera)
                }
                editor.updateInstanceState({
                    isGridMode: state.isGridMode,
                    isFocusMode: state.isFocusMode,
                    isDebugMode: state.isDebugMode,
                    isToolLocked: state.isToolLocked,
                    exportBackground: state.exportBackground,
                })
                if (state.tool) {
                    editor.setCurrentTool(state.tool)
                }
            } catch (e) {
                console.error('Failed to load room state:', e)
            }
        }
        
        const cleanupUser = editor.store.listen(() => {
            localStorage.setItem('tldraw_global_prefs', JSON.stringify(editor.user.getUserPreferences()))
        })
        
        const cleanupRoom = editor.store.listen(() => {
            const { x, y, z } = editor.getCamera()
            const instanceState = editor.getInstanceState()
            localStorage.setItem(roomStateKey, JSON.stringify({
                camera: { x, y, z },
                tool: editor.getCurrentToolId(),
                pageId: editor.getCurrentPageId(),
                isGridMode: instanceState.isGridMode,
                isFocusMode: instanceState.isFocusMode,
                isDebugMode: instanceState.isDebugMode,
                isToolLocked: instanceState.isToolLocked,
                exportBackground: instanceState.exportBackground
            }))
        })
        
        return () => {
            cleanupUser()
            cleanupRoom()
        }
    }, [editor, roomId])
    
    return null
}

function SPenController() {
    const editor = useEditor()
    useSPen(editor)
    return null
}