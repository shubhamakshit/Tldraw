import { useState, useRef, useEffect } from 'react'
import { math2svg, EquationOptions } from '../utils/math2svg'

export function EquationRenderer() {
    // const editor = useEditor() // Not currently used
    const [isExpanded, setIsExpanded] = useState(false)
    const [type, setType] = useState<'function' | 'parametric'>('function')
    const [expression, setExpression] = useState('sin(x)')
    const [xExpression, setXExpression] = useState('cos(t)')
    const [yExpression, setYExpression] = useState('sin(t)')
    
    // Range
    const [xMin, setXMin] = useState(-10)
    const [xMax, setXMax] = useState(10)
    const [tMin, setTMin] = useState(0)
    const [tMax, setTMax] = useState(6.28)
    
    // Scaling
    const [scaleX, setScaleX] = useState(20)
    const [scaleY, setScaleY] = useState(20)
    const [zoom, setZoom] = useState(1)
    const [panX] = useState(0)
    const [panY] = useState(0)
    
    // Samples
    const [samples, setSamples] = useState(200)
    
    const [svgPath, setSvgPath] = useState('')
    const svgRef = useRef<SVGSVGElement>(null)
    
    // Touch zoom support
    useEffect(() => {
        const svg = svgRef.current
        if (!svg) return
        
        let lastDistance = 0
        
        const handleTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                e.preventDefault()
                const touch1 = e.touches[0]
                const touch2 = e.touches[1]
                lastDistance = Math.hypot(
                    touch2.clientX - touch1.clientX,
                    touch2.clientY - touch1.clientY
                )
            }
        }
        
        const handleTouchMove = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                e.preventDefault()
                const touch1 = e.touches[0]
                const touch2 = e.touches[1]
                const distance = Math.hypot(
                    touch2.clientX - touch1.clientX,
                    touch2.clientY - touch1.clientY
                )
                
                if (lastDistance > 0) {
                    const scale = distance / lastDistance
                    setZoom(prev => Math.max(0.1, Math.min(5, prev * scale)))
                }
                
                lastDistance = distance
            }
        }
        
        svg.addEventListener('touchstart', handleTouchStart, { passive: false })
        svg.addEventListener('touchmove', handleTouchMove, { passive: false })
        
        return () => {
            svg.removeEventListener('touchstart', handleTouchStart)
            svg.removeEventListener('touchmove', handleTouchMove)
        }
    }, [])
    
    const generateSVG = () => {
        const options: EquationOptions = {
            type,
            samples,
            scaleX,
            scaleY,
            offsetX: 250,
            offsetY: 250,
            flipY: true
        }
        
        if (type === 'function') {
            options.expression = expression
            options.xMin = xMin
            options.xMax = xMax
        } else {
            options.xExpression = xExpression
            options.yExpression = yExpression
            options.tMin = tMin
            options.tMax = tMax
        }
        
        const path = math2svg(options)
        setSvgPath(path)
    }
    
    // Disabled for now - createAssetId is not available in current tldraw version
    // const insertIntoCanvas = () => {
    //     if (!svgPath) return
    //     alert('Equation inserted! (Feature in progress - will add as shape)')
    // }
    
    if (!isExpanded) {
        return (
            <button
                onClick={() => setIsExpanded(true)}
                className="tlui-button tlui-button__primary"
                style={{
                    position: 'fixed',
                    bottom: 20,
                    left: 20,
                    zIndex: 10000,
                    gap: '8px'
                }}
            >
                <span>📐</span>
                <span>Equations</span>
            </button>
        )
    }
    
    return (
        <div 
            className="tlui-menu"
            style={{
                position: 'fixed',
                bottom: 20,
                left: 20,
                width: '340px',
                maxHeight: 'calc(100vh - 120px)',
                overflowY: 'auto',
                zIndex: 10000,
            }}
        >
            <div className="tlui-menu__group">
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--color-divider)'
                }}>
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>📐 Equations</span>
                    <button
                        onClick={() => setIsExpanded(false)}
                        className="tlui-button tlui-button__icon"
                        style={{ width: '32px', height: '32px' }}
                    >
                        ✕
                    </button>
                </div>
            
            <div className="tlui-menu__group" style={{ padding: '12px' }}>
                <label className="tlui-input__label" style={{ display: 'block', marginBottom: '8px' }}>Type:</label>
                <select 
                    value={type} 
                    onChange={(e) => setType(e.target.value as any)}
                    className="tlui-input"
                    style={{ width: '100%' }}
                >
                    <option value="function">Function y(x)</option>
                    <option value="parametric">Parametric (x(t), y(t))</option>
                </select>
            </div>
            
            {type === 'function' ? (
                <div className="tlui-menu__group" style={{ padding: '12px' }}>
                    <div style={{ marginBottom: '12px' }}>
                        <label className="tlui-input__label" style={{ display: 'block', marginBottom: '4px' }}>y(x) =</label>
                        <input 
                            type="text"
                            value={expression}
                            onChange={(e) => setExpression(e.target.value)}
                            placeholder="e.g., sin(x), x^2"
                            className="tlui-input"
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <div>
                            <label className="tlui-input__label" style={{ fontSize: '11px' }}>x min:</label>
                            <input 
                                type="number"
                                value={xMin}
                                onChange={(e) => setXMin(Number(e.target.value))}
                                className="tlui-input"
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div>
                            <label className="tlui-input__label" style={{ fontSize: '11px' }}>x max:</label>
                            <input 
                                type="number"
                                value={xMax}
                                onChange={(e) => setXMax(Number(e.target.value))}
                                className="tlui-input"
                                style={{ width: '100%' }}
                            />
                        </div>
                    </div>
                </div>
            ) : (
                <div className="tlui-menu__group" style={{ padding: '12px' }}>
                    <div style={{ marginBottom: '12px' }}>
                        <label style={{ display: 'block', marginBottom: '4px' }}>x(t) =</label>
                        <input 
                            type="text"
                            value={xExpression}
                            onChange={(e) => setXExpression(e.target.value)}
                            placeholder="e.g., cos(t)"
                            style={{ width: '100%', padding: '6px', borderRadius: '4px', background: '#333', color: 'white', border: '1px solid #555' }}
                        />
                    </div>
                    <div style={{ marginBottom: '12px' }}>
                        <label style={{ display: 'block', marginBottom: '4px' }}>y(t) =</label>
                        <input 
                            type="text"
                            value={yExpression}
                            onChange={(e) => setYExpression(e.target.value)}
                            placeholder="e.g., sin(t)"
                            style={{ width: '100%', padding: '6px', borderRadius: '4px', background: '#333', color: 'white', border: '1px solid #555' }}
                        />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px' }}>t min:</label>
                            <input 
                                type="number"
                                value={tMin}
                                onChange={(e) => setTMin(Number(e.target.value))}
                                step="0.1"
                                style={{ width: '100%', padding: '6px', borderRadius: '4px', background: '#333', color: 'white', border: '1px solid #555' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px' }}>t max:</label>
                            <input 
                                type="number"
                                value={tMax}
                                onChange={(e) => setTMax(Number(e.target.value))}
                                step="0.1"
                                style={{ width: '100%', padding: '6px', borderRadius: '4px', background: '#333', color: 'white', border: '1px solid #555' }}
                            />
                        </div>
                    </div>
                </div>
            )}
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginBottom: '12px' }}>
                <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '10px' }}>Scale X:</label>
                    <input 
                        type="number"
                        value={scaleX}
                        onChange={(e) => setScaleX(Number(e.target.value))}
                        style={{ width: '100%', padding: '4px', borderRadius: '4px', background: '#333', color: 'white', border: '1px solid #555', fontSize: '11px' }}
                    />
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '10px' }}>Scale Y:</label>
                    <input 
                        type="number"
                        value={scaleY}
                        onChange={(e) => setScaleY(Number(e.target.value))}
                        style={{ width: '100%', padding: '4px', borderRadius: '4px', background: '#333', color: 'white', border: '1px solid #555', fontSize: '11px' }}
                    />
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '10px' }}>Zoom:</label>
                    <input 
                        type="number"
                        value={zoom}
                        onChange={(e) => setZoom(Number(e.target.value))}
                        step="0.1"
                        min="0.1"
                        max="5"
                        style={{ width: '100%', padding: '4px', borderRadius: '4px', background: '#333', color: 'white', border: '1px solid #555', fontSize: '11px' }}
                    />
                </div>
            </div>
            
            <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px' }}>Samples:</label>
                <input 
                    type="number"
                    value={samples}
                    onChange={(e) => setSamples(Number(e.target.value))}
                    min="10"
                    max="1000"
                    style={{ width: '100%', padding: '6px', borderRadius: '4px', background: '#333', color: 'white', border: '1px solid #555' }}
                />
            </div>
            
            <button
                onClick={generateSVG}
                style={{
                    width: '100%',
                    padding: '10px',
                    background: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    marginBottom: '12px'
                }}
            >
                Generate SVG
            </button>
            
            {svgPath && (
                <>
                    <div style={{ marginBottom: '12px' }}>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 'bold' }}>Preview:</label>
                        <svg 
                            ref={svgRef}
                            width="100%" 
                            height="200" 
                            viewBox={`${250 - 250/zoom + panX} ${250 - 250/zoom + panY} ${500/zoom} ${500/zoom}`}
                            style={{ 
                                background: 'var(--color-low)', 
                                borderRadius: '8px', 
                                border: '1px solid var(--color-panel-contrast)',
                                touchAction: 'none'
                            }}
                        >
                            {/* Grid lines for reference */}
                            <line x1="0" y1="250" x2="500" y2="250" stroke="#444" strokeWidth="1" strokeDasharray="5,5" />
                            <line x1="250" y1="0" x2="250" y2="500" stroke="#444" strokeWidth="1" strokeDasharray="5,5" />
                            <circle cx="250" cy="250" r="3" fill="#888" />
                            
                            {/* The equation path */}
                            <path 
                                d={svgPath} 
                                fill="none" 
                                stroke="#4CAF50" 
                                strokeWidth={2/zoom}
                            />
                        </svg>
                    </div>
                    <div style={{ fontSize: '10px', color: '#888' }}>
                        Path length: {svgPath.length} chars
                    </div>
                    <textarea
                        readOnly
                        value={svgPath.substring(0, 200) + '...'}
                        style={{
                            width: '100%',
                            height: '60px',
                            fontSize: '9px',
                            fontFamily: 'monospace',
                            background: '#222',
                            color: '#0f0',
                            border: '1px solid #555',
                            borderRadius: '4px',
                            padding: '4px',
                            marginTop: '8px'
                        }}
                    />
                </>
            )}
            </div>
        </div>
    )
}
