import { useEffect, useState } from 'react'

import { useEditor } from 'tldraw' // Added useEditor import
import { colors } from '../constants/theme' // Corrected path
import { FolderIcon, SettingsIcon, ShareIcon, CloseIcon } from './Icons'
import { RoomList } from './RoomList'
import { SettingsMenu } from './SettingsMenu'
import { ExportMenu } from './ExportMenu'

type Tab = 'none' | 'files' | 'settings' | 'export'

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
            case 'export': return 'Share'
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
                    active={activeTab === 'export'}
                    onClick={() => setActiveTab(activeTab === 'export' ? 'none' : 'export')}
                    title="Share & Export"
                    theme={theme}
                >
                    <ShareIcon />
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
                        fontSize: 11,
                        color: theme.text,
                        opacity: 0.6,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        background: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)',
                        padding: '4px 8px',
                        borderRadius: 4,
                        fontFamily: 'monospace'
                    }} title={window.location.href}>
                        {window.location.href}
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

                {activeTab === 'export' && (
                    <ExportMenu 
                        roomId={roomId}
                        theme={theme}
                    />
                )}
            </div>
        </>
    )
}