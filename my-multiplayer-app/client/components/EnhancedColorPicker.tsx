import { useEffect, useRef, useState } from 'react'

// Declare iro for TypeScript
declare global {
    interface Window {
        iro: any
    }
}

interface EnhancedColorPickerProps {
    color: string
    onChange: (color: string) => void
    label?: string
}

export function EnhancedColorPicker({ color, onChange, label }: EnhancedColorPickerProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [currentColor, setCurrentColor] = useState(color)
    const containerRef = useRef<HTMLDivElement>(null)
    const pickerRef = useRef<any>(null)
    const pickerInstanceRef = useRef<any>(null)

    useEffect(() => {
        setCurrentColor(color)
        if (pickerInstanceRef.current) {
            pickerInstanceRef.current.color.hexString = color
        }
    }, [color])

    useEffect(() => {
        if (isOpen && pickerRef.current && !pickerInstanceRef.current) {
            // Load iro.js if not already loaded
            if (!window.iro) {
                const script = document.createElement('script')
                script.src = 'https://cdn.jsdelivr.net/npm/@jaames/iro@5'
                script.onload = () => initializePicker()
                document.head.appendChild(script)
            } else {
                initializePicker()
            }
        }

        return () => {
            if (pickerInstanceRef.current) {
                // Cleanup if needed
            }
        }
    }, [isOpen])

    const initializePicker = () => {
        if (pickerRef.current && window.iro && !pickerInstanceRef.current) {
            pickerInstanceRef.current = new window.iro.ColorPicker(pickerRef.current, {
                width: 200,
                color: currentColor,
                layout: [
                    {
                        component: window.iro.ui.Wheel,
                        options: {}
                    },
                    {
                        component: window.iro.ui.Slider,
                        options: {
                            sliderType: 'value'
                        }
                    }
                ]
            })

            pickerInstanceRef.current.on('color:change', (color: any) => {
                setCurrentColor(color.hexString)
                onChange(color.hexString)
            })
        }
    }

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false)
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside)
            return () => document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isOpen])

    return (
        <div ref={containerRef} style={{ position: 'relative' }}>
            {label && (
                <div style={{ 
                    fontSize: '10px', 
                    marginBottom: '4px', 
                    color: 'var(--color-text-2)',
                    fontWeight: 600,
                    textTransform: 'uppercase'
                }}>
                    {label}
                </div>
            )}
            <button
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    width: '100%',
                    height: '32px',
                    border: '1px solid var(--color-divider)',
                    borderRadius: 'var(--radius-small)',
                    background: 'var(--color-low)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '0 8px'
                }}
            >
                <div
                    style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '4px',
                        background: currentColor,
                        border: '1px solid var(--color-divider)',
                        flexShrink: 0
                    }}
                />
                <span style={{ 
                    fontSize: '11px', 
                    fontFamily: 'monospace',
                    color: 'var(--color-text)',
                    flex: 1,
                    textAlign: 'left'
                }}>
                    {currentColor}
                </span>
            </button>

            {isOpen && (
                <div
                    style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        marginTop: '4px',
                        background: 'var(--color-panel)',
                        border: '1px solid var(--color-divider)',
                        borderRadius: 'var(--radius-medium)',
                        padding: '12px',
                        boxShadow: 'var(--shadow-3)',
                        zIndex: 1000,
                        backdropFilter: 'blur(20px)'
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div ref={pickerRef} />
                </div>
            )}
        </div>
    )
}
