import { useEffect, useState } from 'react'
import { getRooms } from '../pages/storageUtils' // Added getRooms import

import { useEditor } from 'tldraw' // Added useEditor import
import { colors } from '../constants/theme' // Corrected path
import { FolderIcon, SettingsIcon, CloseIcon } from './Icons' // Added ShareIcon
import { RoomList } from './RoomList'
import { SettingsMenu } from './SettingsMenu'

type Tab = 'none' | 'files' | 'settings'

interface NavButtonProps {
    children: React.ReactNode
    onClick: () => void
    active: boolean
    title: string
    theme: any
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

export function NavigationDock({ roomId }: { roomId: string }) {

    const editor = useEditor()
    const [activeTab, setActiveTab] = useState<Tab>('none')
    const [isDark, setIsDark] = useState(false)
    const [roomName, setRoomName] = useState('')

    // Check dark mode
    useEffect(() => {
        const checkDark = () => {
            if (!editor?.user) return
            const prefs = editor.user.getUserPreferences()
            setIsDark(prefs.colorScheme === 'dark')
        }
        checkDark()
        const interval = setInterval(checkDark, 1000)
        return () => clearInterval(interval)
    }, [editor])

    // Monitor Room Name
    useEffect(() => {
        const updateName = () => {
            const rooms = getRooms()
            const room = rooms.find(r => r.id === roomId)
            setRoomName(room?.name || 'Untitled Board')
        }
        updateName()
        window.addEventListener('tldraw-room-update', updateName)
        // Also listen for storage events in case it changes in another tab
        window.addEventListener('storage', updateName)
        
        return () => {
            window.removeEventListener('tldraw-room-update', updateName)
            window.removeEventListener('storage', updateName)
        }
    }, [roomId])

    const theme = {
        bg: isDark ? colors.panelBgDark : colors.panelBg,
        border: isDark ? colors.borderDark : colors.border,
        hover: isDark ? colors.hoverDark : colors.hover,
        text: isDark ? colors.textDark : colors.text,
    }

    const isOpen = activeTab !== 'none'
    const close = () => setActiveTab('none')

    const getTitle = () => {
        switch(activeTab) {
            case 'files': return 'My Boards'
            case 'settings': return 'Settings'
            default: return ''
        }
    }

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
                    onClick={close}
                    style={{ position: 'fixed', inset: 0, zIndex: 400, background: colors.overlay }}
                />
            )}

            {/* SIDEBAR PANEL */}
            <div style={{
                position: 'fixed',
                top: 0, left: 0, bottom: 0, width: 300,
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
                    flexDirection: 'column',
                    gap: 8,
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}>
                        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: theme.text }}>
                            {getTitle()}
                        </h2>
                        <button
                            onClick={close}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: colors.textMuted }}
                        >
                            <CloseIcon />
                        </button>
                    </div>
                    
                    <div style={{
                        fontSize: 14, // Increased font size slightly
                        fontWeight: 500,
                        color: theme.text,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        padding: '0 4px',
                    }} title={roomName}>
                        {roomName}
                    </div>
                </div>

                {/* CONTENT */}
                {activeTab === 'files' && (
                    <RoomList 
                        currentRoomId={roomId} 
                        theme={theme} 
                        onClose={close}
                    />
                )}

                {activeTab === 'settings' && (
                    <SettingsMenu 
                        roomId={roomId}
                        isDark={isDark}
                        theme={theme}
                    />
                )}
            </div>
        </>
    )
}