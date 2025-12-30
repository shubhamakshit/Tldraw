import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { track, useEditor, TldrawUiButton, TldrawUiButtonIcon, createShapeId, TLShapeId } from 'tldraw'
import { math2svg, math2svgFull } from '../utils/math2svg'
import { EnhancedColorPicker } from './EnhancedColorPicker'

// Default Initial State
const INITIAL_STATE = {
    type: 'function' as 'function' | 'parametric',
    expression: 'sin(x)',
    xExpression: 'cos(t)',
    yExpression: 'sin(t)',
    xMin: -10,
    xMax: 10,
    tMin: 0,
    tMax: 6.28,
    scaleX: 40,
    scaleY: 40,
    offsetX: 250,
    offsetY: 250,
    showAxes: true,
    showGrid: false,
    showNumbers: true,
    axisColor: '#666666',
    gridColor: '#e5e5e5',
    strokeColor: '#2563eb',
    fontSize: 8,
    fontFamily: 'monospace' as 'monospace' | 'sans-serif' | 'serif'
}

export const EquationRenderer = track(() => {
    const editor = useEditor()
    const [isOpen, setIsOpen] = useState(false)
    const [editingShapeId, setEditingShapeId] = useState<TLShapeId | null>(null)
    const isDark = editor.user.getIsDarkMode()

    // Local state for creation mode
    const [localState, setLocalState] = useState(INITIAL_STATE)
    
    // Reset state when closing
    const handleClose = useCallback(() => {
        setIsOpen(false)
        setEditingShapeId(null)
        setLocalState(INITIAL_STATE)
    }, [])
    
    // Listen for external open-equation-editor event (from context menu)
    useEffect(() => {
        const handleOpenEditor = (event: CustomEvent) => {
            const { shapeId } = event.detail
            const shape = editor.getShape(shapeId)
            if (shape && shape.type === 'equation') {
                setEditingShapeId(shapeId)
                setLocalState({
                    type: (shape.props as any).type || 'function',
                    expression: (shape.props as any).expression || 'sin(x)',
                    xExpression: (shape.props as any).xExpression || 'cos(t)',
                    yExpression: (shape.props as any).yExpression || 'sin(t)',
                    xMin: (shape.props as any).xMin ?? -10,
                    xMax: (shape.props as any).xMax ?? 10,
                    tMin: (shape.props as any).tMin ?? 0,
                    tMax: (shape.props as any).tMax ?? 6.28,
                    scaleX: (shape.props as any).scaleX ?? 40,
                    scaleY: (shape.props as any).scaleY ?? 40,
                    offsetX: (shape.props as any).offsetX ?? 250,
                    offsetY: (shape.props as any).offsetY ?? 250,
                    showAxes: (shape.props as any).showAxes ?? true,
                    showGrid: (shape.props as any).showGrid ?? false,
                    showNumbers: (shape.props as any).showNumbers ?? true,
                    axisColor: (shape.props as any).axisColor || '#666666',
                    gridColor: (shape.props as any).gridColor || '#e5e5e5',
                    strokeColor: (shape.props as any).strokeColor || '#2563eb',
                    fontSize: (shape.props as any).fontSize ?? 8,
                    fontFamily: (shape.props as any).fontFamily || 'monospace'
                })
                setIsOpen(true)
            }
        }
        
        window.addEventListener('open-equation-editor' as any, handleOpenEditor)
        return () => window.removeEventListener('open-equation-editor' as any, handleOpenEditor)
    }, [editor])

    // Selection Logic - only open via explicit trigger, not auto-open on selection
    // Note: We don't auto-open on selection anymore
    
    // Derived State (Current Values)
    const values = localState

    // Ensure defaults for missing props (compatibility)
    const state = { ...INITIAL_STATE, ...values }

    // Update Handler
    const updateState = useCallback((changes: Partial<typeof INITIAL_STATE>) => {
        setLocalState(prev => ({ ...prev, ...changes }))
        // If editing an existing shape, update it in real-time
        if (editingShapeId) {
            editor.updateShape({
                id: editingShapeId,
                type: 'equation',
                props: changes
            })
        }
    }, [editor, editingShapeId])

    // SVG Generation for Preview
    const svgPath = useMemo(() => {
        return math2svg({
            type: state.type,
            expression: state.expression,
            xExpression: state.xExpression,
            yExpression: state.yExpression,
            xMin: state.xMin,
            xMax: state.xMax,
            tMin: state.tMin,
            tMax: state.tMax,
            scaleX: state.scaleX,
            scaleY: state.scaleY,
            offsetX: state.offsetX,
            offsetY: state.offsetY,
            samples: 400
        })
    }, [state])

    // Interaction State for Preview Pan/Zoom
    const isDragging = useRef(false)
    const lastPos = useRef({ x: 0, y: 0 })
    const initialDistance = useRef(0)
    const isPinching = useRef(false)
    const velocity = useRef({ x: 0, y: 0 })
    const lastMoveTime = useRef(0)
    const animationFrame = useRef<number | null>(null)

    const handleWheel = (e: React.WheelEvent) => {
        e.stopPropagation()
        e.preventDefault()
        const s = e.deltaY > 0 ? 0.9 : 1.1
        updateState({ 
            scaleX: Math.max(1, state.scaleX * s), 
            scaleY: Math.max(1, state.scaleY * s) 
        })
    }

    // Use touch events for better Android support
    const handleTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length === 2) {
            // Two-finger pinch
            isPinching.current = true
            isDragging.current = false
            const touch1 = e.touches[0]
            const touch2 = e.touches[1]
            const distance = Math.hypot(
                touch2.clientX - touch1.clientX,
                touch2.clientY - touch1.clientY
            )
            initialDistance.current = distance
        } else if (e.touches.length === 1) {
            // Single finger drag
            isDragging.current = true
            isPinching.current = false
            const touch = e.touches[0]
            lastPos.current = { x: touch.clientX, y: touch.clientY }
        }
    }

    const handleTouchMove = (e: React.TouchEvent) => {
        if (e.touches.length === 2 && isPinching.current) {
            // Pinch zoom
            e.preventDefault()
            const touch1 = e.touches[0]
            const touch2 = e.touches[1]
            const distance = Math.hypot(
                touch2.clientX - touch1.clientX,
                touch2.clientY - touch1.clientY
            )
            if (initialDistance.current > 0) {
                const scale = distance / initialDistance.current
                updateState({ 
                    scaleX: Math.max(1, state.scaleX * scale), 
                    scaleY: Math.max(1, state.scaleY * scale) 
                })
                initialDistance.current = distance
            }
        } else if (e.touches.length === 1 && isDragging.current && !isPinching.current) {
            // Single finger pan with velocity tracking
            e.preventDefault()
            const touch = e.touches[0]
            const now = Date.now()
            const dt = now - lastMoveTime.current
            
            const dx = touch.clientX - lastPos.current.x
            const dy = touch.clientY - lastPos.current.y
            
            // Calculate velocity for momentum
            if (dt > 0) {
                velocity.current = {
                    x: dx / dt * 16, // Normalize to ~60fps
                    y: dy / dt * 16
                }
            }
            
            lastPos.current = { x: touch.clientX, y: touch.clientY }
            lastMoveTime.current = now
            
            updateState({ 
                offsetX: state.offsetX + dx, 
                offsetY: state.offsetY + dy 
            })
        }
    }

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (e.touches.length < 2) {
            isPinching.current = false
            initialDistance.current = 0
        }
        if (e.touches.length === 0) {
            isDragging.current = false
            
            // Apply momentum/inertia
            const speed = Math.hypot(velocity.current.x, velocity.current.y)
            if (speed > 1) {
                applyMomentum()
            }
        }
    }
    
    const applyMomentum = () => {
        const friction = 0.95 // Deceleration factor
        const minSpeed = 0.5
        
        const animate = () => {
            const speed = Math.hypot(velocity.current.x, velocity.current.y)
            
            if (speed < minSpeed || isDragging.current) {
                velocity.current = { x: 0, y: 0 }
                animationFrame.current = null
                return
            }
            
            // Apply velocity
            updateState({
                offsetX: state.offsetX + velocity.current.x,
                offsetY: state.offsetY + velocity.current.y
            })
            
            // Apply friction
            velocity.current = {
                x: velocity.current.x * friction,
                y: velocity.current.y * friction
            }
            
            animationFrame.current = requestAnimationFrame(animate)
        }
        
        if (animationFrame.current) {
            cancelAnimationFrame(animationFrame.current)
        }
        animationFrame.current = requestAnimationFrame(animate)
    }

    // Mouse events for desktop
    const handleMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
        
        // Cancel any ongoing momentum
        if (animationFrame.current) {
            cancelAnimationFrame(animationFrame.current)
            animationFrame.current = null
        }
        velocity.current = { x: 0, y: 0 }
        
        isDragging.current = true
        lastPos.current = { x: e.clientX, y: e.clientY }
        lastMoveTime.current = Date.now()
    }

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging.current) return
        e.stopPropagation()
        e.preventDefault()
        
        const now = Date.now()
        const dt = now - lastMoveTime.current
        
        const dx = e.clientX - lastPos.current.x
        const dy = e.clientY - lastPos.current.y
        
        // Calculate velocity for momentum
        if (dt > 0) {
            velocity.current = {
                x: dx / dt * 16,
                y: dy / dt * 16
            }
        }
        
        lastPos.current = { x: e.clientX, y: e.clientY }
        lastMoveTime.current = now
        
        updateState({ 
            offsetX: state.offsetX + dx, 
            offsetY: state.offsetY + dy 
        })
    }

    const handleMouseUp = (e: React.MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
        isDragging.current = false
        
        // Apply momentum/inertia for mouse too
        const speed = Math.hypot(velocity.current.x, velocity.current.y)
        if (speed > 1) {
            applyMomentum()
        }
    }
    
    // Cleanup animation frame on unmount
    useEffect(() => {
        return () => {
            if (animationFrame.current) {
                cancelAnimationFrame(animationFrame.current)
            }
        }
    }, [])

    const copy = async () => {
        const svgString = math2svgFull({ ...state, samples: 400 })
        try {
            await navigator.clipboard.writeText(svgString)
            editor.setCurrentTool('select')
        } catch (err) {}
    }

    const addToCanvas = () => {
        // Create Equation Shape
        const id = createShapeId()
        const center = editor.getViewportPageBounds().center
        
        editor.createShape({
            id,
            type: 'equation',
            x: center.x - 250, // Center the 500x500 shape
            y: center.y - 250,
            props: {
                w: 500,
                h: 500,
                ...state
            }
        })
        
        // Don't close, maybe user wants to add more? Or close.
        // setIsOpen(false) 
    }

    if (!isOpen) {
        return (
            <div style={{
                position: 'fixed',
                top: '180px',
                left: '12px',
                zIndex: 400,
            }}>
                 <TldrawUiButton
                    type="normal"
                    onClick={() => setIsOpen(true)}
                    title="Function Plotter"
                    style={{
                        width: '40px',
                        height: '40px',
                        background: 'var(--color-panel)',
                        border: '1px solid var(--color-divider)',
                        borderRadius: 'var(--radius-medium)',
                        boxShadow: 'var(--shadow-1)',
                    }}
                >
                    <span style={{ fontSize: '14px', fontWeight: 700 }}>f(x)</span>
                </TldrawUiButton>
            </div>
        )
    }

    // Styles
    const previewBg = isDark ? '#212121' : '#ffffff'

    return (
        <div 
            onPointerDown={(e) => e.stopPropagation()}
            style={{
                position: 'fixed',
                top: 'max(60px, env(safe-area-inset-top, 12px))',
                left: 'max(60px, env(safe-area-inset-left, 12px))',
                right: 'max(12px, env(safe-area-inset-right, 12px))',
                width: '320px',
                maxWidth: 'calc(100vw - max(72px, env(safe-area-inset-left, 12px) + env(safe-area-inset-right, 12px) + 24px))',
                maxHeight: 'calc(100dvh - max(80px, env(safe-area-inset-top, 12px) + env(safe-area-inset-bottom, 12px) + 24px))',
                background: 'var(--color-panel)',
                border: '1px solid var(--color-divider)',
                borderRadius: 'var(--radius-medium)',
                boxShadow: 'var(--shadow-3)',
                zIndex: 400,
                display: 'flex',
                flexDirection: 'column',
                backdropFilter: 'blur(20px)',
                overflow: 'hidden'
            }}
        >
            {/* Header */}
            <div style={{
                padding: '12px',
                borderBottom: '1px solid var(--color-divider)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'var(--color-panel-header)',
                flexShrink: 0,
            }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text)' }}>
                    {editingShapeId ? 'Edit Formula' : 'Function Plotter'}
                </span>
                <TldrawUiButton
                    type="icon"
                    onClick={handleClose}
                    title="Close"
                >
                    <TldrawUiButtonIcon icon="cross-2" />
                </TldrawUiButton>
            </div>
            
            {/* Content */}
            <div style={{
                padding: '12px',
                overflowY: 'auto',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
            }}>
                {/* Type Selector */}
                <div style={{ display: 'flex', gap: '8px', background: 'var(--color-low)', padding: '4px', borderRadius: '6px' }}>
                    <button
                        onClick={() => updateState({ type: 'function' })}
                        style={{
                            flex: 1,
                            padding: '6px',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background: state.type === 'function' ? 'var(--color-selected)' : 'transparent',
                            color: state.type === 'function' ? 'white' : 'var(--color-text)',
                            cursor: 'pointer'
                        }}
                    >
                        y(x)
                    </button>
                    <button
                        onClick={() => updateState({ type: 'parametric' })}
                        style={{
                            flex: 1,
                            padding: '6px',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background: state.type === 'parametric' ? 'var(--color-selected)' : 'transparent',
                            color: state.type === 'parametric' ? 'white' : 'var(--color-text)',
                            cursor: 'pointer'
                        }}
                    >
                        Parametric
                    </button>
                </div>

                {/* Inputs */}
                {state.type === 'function' ? (
                    <>
                        <div>
                            <Label>y(x) =</Label>
                            <Input value={state.expression} onChange={(v: string) => updateState({ expression: v })} placeholder="sin(x)" />
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <div style={{ flex: 1 }}>
                                <Label>x min</Label>
                                <Input value={state.xMin} onChange={(v: string) => updateState({ xMin: Number(v) })} type="number" />
                            </div>
                            <div style={{ flex: 1 }}>
                                <Label>x max</Label>
                                <Input value={state.xMax} onChange={(v: string) => updateState({ xMax: Number(v) })} type="number" />
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div>
                            <Label>x(t) =</Label>
                            <Input value={state.xExpression} onChange={(v: string) => updateState({ xExpression: v })} placeholder="cos(t)" />
                        </div>
                        <div>
                            <Label>y(t) =</Label>
                            <Input value={state.yExpression} onChange={(v: string) => updateState({ yExpression: v })} placeholder="sin(t)" />
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <div style={{ flex: 1 }}>
                                <Label>t min</Label>
                                <Input value={state.tMin} onChange={(v: string) => updateState({ tMin: Number(v) })} type="number" />
                            </div>
                            <div style={{ flex: 1 }}>
                                <Label>t max</Label>
                                <Input value={state.tMax} onChange={(v: string) => updateState({ tMax: Number(v) })} type="number" />
                            </div>
                        </div>
                    </>
                )}

                {/* Visual Settings */}
                <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                        <Label>Scale X</Label>
                        <Input value={state.scaleX} onChange={(v: string) => updateState({ scaleX: Number(v) })} type="number" />
                    </div>
                    <div style={{ flex: 1 }}>
                        <Label>Scale Y</Label>
                        <Input value={state.scaleY} onChange={(v: string) => updateState({ scaleY: Number(v) })} type="number" />
                    </div>
                </div>

                {/* Toggles */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                     <Checkbox 
                        label="Axes & Grid" 
                        checked={state.showAxes} 
                        onChange={(v: boolean) => updateState({ showAxes: v, showGrid: v })} 
                     />
                     <Checkbox label="Numbers" checked={state.showNumbers} onChange={(v: boolean) => updateState({ showNumbers: v })} />
                </div>
                
                {/* Font Settings */}
                {state.showNumbers && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <div style={{ flex: 1 }}>
                            <Label>Font Size</Label>
                            <Input value={state.fontSize} onChange={(v: string) => updateState({ fontSize: Number(v) })} type="number" />
                        </div>
                        <div style={{ flex: 1 }}>
                            <Label>Font</Label>
                            <select
                                value={state.fontFamily}
                                onChange={(e) => updateState({ fontFamily: e.target.value as 'monospace' | 'sans-serif' | 'serif' })}
                                style={{
                                    width: '100%',
                                    padding: '6px',
                                    fontSize: '12px',
                                    background: 'var(--color-low)',
                                    color: 'var(--color-text)',
                                    border: '1px solid var(--color-divider)',
                                    borderRadius: 'var(--radius-small)',
                                    outline: 'none'
                                }}
                            >
                                <option value="monospace">Mono</option>
                                <option value="sans-serif">Sans</option>
                                <option value="serif">Serif</option>
                            </select>
                        </div>
                    </div>
                )}
                
                {/* Colors */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <EnhancedColorPicker 
                        label="Curve Color"
                        color={state.strokeColor} 
                        onChange={(color) => updateState({ strokeColor: color })}
                    />
                    <EnhancedColorPicker 
                        label="Axes Color"
                        color={state.axisColor} 
                        onChange={(color) => updateState({ axisColor: color })}
                    />
                    <EnhancedColorPicker 
                        label="Grid Color"
                        color={state.gridColor} 
                        onChange={(color) => updateState({ gridColor: color })}
                    />
                </div>
                
                {/* Preview */}
                <div style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: '8px',
                    paddingTop: '8px',
                    borderTop: '1px solid var(--color-divider)',
                    flexShrink: 0
                }}>
                    <div 
                        onWheel={handleWheel}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                        onTouchStart={handleTouchStart}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                        onTouchCancel={handleTouchEnd}
                        style={{
                            background: previewBg,
                            border: '1px solid var(--color-divider)',
                            borderRadius: 'var(--radius-small)',
                            height: '200px',
                            overflow: 'hidden',
                            flexShrink: 0,
                            position: 'relative',
                            cursor: 'move',
                            touchAction: 'none',
                            userSelect: 'none',
                            WebkitUserSelect: 'none',
                            WebkitTouchCallout: 'none'
                        }}
                    >
                        <svg
                            width="100%"
                            height="100%"
                            viewBox="0 0 500 500"
                            style={{ overflow: 'visible', pointerEvents: 'none' }}
                        >
                             {state.showGrid && (
                                <pattern id="preview-grid" width={state.scaleX} height={state.scaleY} patternUnits="userSpaceOnUse">
                                    <path d={`M ${state.scaleX} 0 L 0 0 0 ${state.scaleY}`} fill="none" stroke={state.gridColor} strokeWidth="0.5"/>
                                </pattern>
                            )}
                            {state.showGrid && <rect width="100%" height="100%" fill="url(#preview-grid)" />}

                            {state.showAxes && (
                                <>
                                    <line x1="0" y1={state.offsetY} x2="500" y2={state.offsetY} stroke={state.axisColor} strokeWidth="1.5" />
                                    <line x1={state.offsetX} y1="0" x2={state.offsetX} y2="500" stroke={state.axisColor} strokeWidth="1.5" />
                                    
                                    {state.showNumbers && (
                                        <>
                                            {/* X-axis numbers */}
                                            {(() => {
                                                const ticks = []
                                                const xStep = state.scaleX
                                                if (xStep > 20) {
                                                    for (let x = state.offsetX % xStep; x < 500; x += xStep) {
                                                        const val = Math.round((x - state.offsetX) / state.scaleX)
                                                        if (val === 0) continue
                                                        ticks.push(
                                                            <g key={`x-${x}`}>
                                                                <line x1={x} y1={state.offsetY - 3} x2={x} y2={state.offsetY + 3} stroke={state.axisColor} strokeWidth="1" />
                                                                <text x={x} y={state.offsetY + 12} fontSize="8" fill={state.axisColor} textAnchor="middle" fontFamily="monospace">{val}</text>
                                                            </g>
                                                        )
                                                    }
                                                }
                                                return ticks
                                            })()}
                                            
                                            {/* Y-axis numbers */}
                                            {(() => {
                                                const ticks = []
                                                const yStep = state.scaleY
                                                if (yStep > 20) {
                                                    for (let y = state.offsetY % yStep; y < 500; y += yStep) {
                                                        const val = Math.round((state.offsetY - y) / state.scaleY)
                                                        if (val === 0) continue
                                                        ticks.push(
                                                            <g key={`y-${y}`}>
                                                                <line x1={state.offsetX - 3} y1={y} x2={state.offsetX + 3} y2={y} stroke={state.axisColor} strokeWidth="1" />
                                                                <text x={state.offsetX - 6} y={y + 3} fontSize="8" fill={state.axisColor} textAnchor="end" fontFamily="monospace">{val}</text>
                                                            </g>
                                                        )
                                                    }
                                                }
                                                return ticks
                                            })()}
                                            <text x={state.offsetX - 4} y={state.offsetY + 12} fontSize="8" fill={state.axisColor} textAnchor="end" fontFamily="monospace">0</text>
                                        </>
                                    )}
                                </>
                            )}
                            
                            <path
                                d={svgPath}
                                fill="none"
                                stroke={state.strokeColor}
                                strokeWidth="3"
                                strokeLinecap="round"
                            />
                        </svg>
                        
                        <div style={{ 
                            position: 'absolute', bottom: 4, right: 6, 
                            fontSize: '10px', color: 'var(--color-text-3)', pointerEvents: 'none',
                            background: 'rgba(0,0,0,0.5)',
                            padding: '2px 6px',
                            borderRadius: '4px'
                        }}>
                            Pinch to zoom • Drag to pan
                        </div>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <TldrawUiButton
                            type="normal"
                            onClick={copy}
                            style={{ flex: 1, justifyContent: 'center' }}
                        >
                            Copy SVG
                        </TldrawUiButton>
                        {!editingShapeId && (
                            <TldrawUiButton
                                type="primary"
                                onClick={addToCanvas}
                                style={{ flex: 1, justifyContent: 'center' }}
                            >
                                Add to Board
                            </TldrawUiButton>
                        )}
                        {editingShapeId && (
                            <TldrawUiButton
                                type="primary"
                                onClick={handleClose}
                                style={{ flex: 1, justifyContent: 'center' }}
                            >
                                Done
                            </TldrawUiButton>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
})

const Label = ({ children }: { children: React.ReactNode }) => (
    <label style={{ 
        display: 'block', 
        fontSize: '10px', 
        fontWeight: 600,
        marginBottom: '4px',
        color: 'var(--color-text-1)',
        textTransform: 'uppercase'
    }}>
        {children}
    </label>
)

const Input = ({ value, onChange, placeholder, type = 'text' }: any) => (
    <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
            width: '100%',
            padding: '6px',
            fontSize: '12px',
            background: 'var(--color-low)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-divider)',
            borderRadius: 'var(--radius-small)',
            outline: 'none',
            fontFamily: 'monospace'
        }}
    />
)

const Checkbox = ({ label, checked, onChange }: any) => (
    <div 
        onClick={() => onChange(!checked)}
        style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px', 
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 500,
            color: 'var(--color-text)'
        }}
    >
        <div style={{
            width: '14px',
            height: '14px',
            border: `1px solid ${checked ? 'var(--color-selected)' : 'var(--color-text-2)'}`,
            background: checked ? 'var(--color-selected)' : 'transparent',
            borderRadius: '3px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        }}>
            {checked && <div style={{ width: '8px', height: '8px', background: 'white', borderRadius: '1px' }} />}
        </div>
        {label}
    </div>
)
