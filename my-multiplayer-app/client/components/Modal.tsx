import { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { colors } from '../constants/theme'

interface ThemeColors {
    bg: string
    border: string
    text: string
    hover: string
    selected: string
    textMuted: string
}

interface ModalProps {
    title?: string
    message: string
    type: 'alert' | 'prompt' | 'confirm'
    defaultValue?: string
    onConfirm: (value?: string) => void
    onCancel: () => void
    theme: ThemeColors
}

function Modal({ title, message, type, defaultValue = '', onConfirm, onCancel, theme }: ModalProps) {
    const [inputValue, setInputValue] = useState(defaultValue)

    // Focus input on mount
    useEffect(() => {
        if (type === 'prompt') {
            const input = document.getElementById('custom-modal-input')
            if (input) input.focus()
        }
    }, [type])

    const handleConfirm = () => {
        onConfirm(type === 'prompt' ? inputValue : undefined)
    }

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: colors.overlay,
            backdropFilter: 'blur(2px)',
            fontFamily: 'Inter, sans-serif',
        }}>
            <div style={{
                background: theme.bg,
                border: `1px solid ${theme.border}`,
                borderRadius: 12,
                padding: 20,
                width: '90%',
                maxWidth: 360,
                boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
                color: theme.text,
            }}>
                {title && (
                    <div style={{
                        fontSize: 16,
                        fontWeight: 600,
                        marginBottom: 8,
                        color: theme.text,
                    }}>
                        {title}
                    </div>
                )}
                
                <div style={{
                    fontSize: 14,
                    lineHeight: 1.5,
                    marginBottom: 20,
                    color: theme.text,
                    opacity: 0.8,
                }}>
                    {message}
                </div>

                {type === 'prompt' && (
                    <input
                        id="custom-modal-input"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleConfirm()
                            if (e.key === 'Escape') onCancel()
                        }}
                        style={{
                            width: '100%',
                            padding: '10px 12px',
                            background: theme.hover,
                            border: `1px solid ${theme.border}`,
                            borderRadius: 6,
                            color: theme.text,
                            fontSize: 14,
                            marginBottom: 20,
                            outline: 'none',
                        }}
                    />
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    {(type === 'prompt' || type === 'confirm') && (
                        <button
                            onClick={onCancel}
                            style={{
                                padding: '8px 16px',
                                background: 'transparent',
                                border: 'none',
                                color: theme.textMuted,
                                fontSize: 13,
                                fontWeight: 500,
                                cursor: 'pointer',
                                borderRadius: 6,
                            }}
                        >
                            Cancel
                        </button>
                    )}
                    <button
                        onClick={handleConfirm}
                        style={{
                            padding: '8px 16px',
                            background: theme.selected,
                            color: '#fff',
                            border: 'none',
                            borderRadius: 6,
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: 'pointer',
                        }}
                    >
                        OK
                    </button>
                </div>
            </div>
        </div>
    )
}

// Utility to mount the modal dynamically
export function showModal(props: Omit<ModalProps, 'onConfirm' | 'onCancel' | 'theme'>): Promise<string | undefined | boolean> {
    return new Promise((resolve) => {
        // Detect Theme
        let isDark = false
        try {
            const prefs = localStorage.getItem('tldraw_global_prefs')
            if (prefs) {
                const parsed = JSON.parse(prefs)
                if (parsed.colorScheme === 'dark') isDark = true
            }
        } catch (e) { }

        const theme: ThemeColors = {
            bg: isDark ? colors.panelBgDark : colors.panelBg,
            border: isDark ? colors.borderDark : colors.border,
            text: isDark ? colors.textDark : colors.text,
            hover: isDark ? colors.hoverDark : colors.hover,
            selected: colors.selected,
            textMuted: colors.textMuted
        }

        const div = document.createElement('div')
        document.body.appendChild(div)
        const root = createRoot(div)

        const cleanup = () => {
            root.unmount()
            document.body.removeChild(div)
        }

        const onConfirm = (value?: string) => {
            cleanup()
            resolve(props.type === 'prompt' ? value : true)
        }

        const onCancel = () => {
            cleanup()
            resolve(props.type === 'prompt' ? undefined : false)
        }

        root.render(
            <Modal 
                {...props} 
                theme={theme}
                onConfirm={onConfirm} 
                onCancel={onCancel} 
            />
        )
    })
}
