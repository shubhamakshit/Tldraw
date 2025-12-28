import { useEditor } from 'tldraw' // Added useEditor import
import { colors } from '../constants/theme' // Corrected path

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

export function SettingsMenu({ roomId, isDark, theme }: { roomId: string, isDark: boolean, theme: any }) {
    const editor = useEditor()

    const toggleTheme = () => {
        const current = editor.user.getUserPreferences()
        const newScheme = current.colorScheme === 'dark' ? 'light' : 'dark'
        editor.user.updateUserPreferences({ colorScheme: newScheme })
    }

    const toggleGrid = () => {
        editor.updateInstanceState({ isGridMode: !editor.getInstanceState().isGridMode })
    }

    return (
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
    )
}