import { useState, useRef, useEffect } from 'react'
import { math2svg } from '../utils/math2svg'

export function EquationRenderer() {
    const [isOpen, setIsOpen] = useState(false)
    const [type, setType] = useState<'function' | 'parametric'>('function')
    const [expression, setExpression] = useState('sin(x)')
    const [xExpression, setXExpression] = useState('cos(t)')
    const [yExpression, setYExpression] = useState('sin(t)')
    const [xMin, setXMin] = useState(-10)
    const [xMax, setXMax] = useState(10)
    const [tMin, setTMin] = useState(0)
    const [tMax, setTMax] = useState(6.28)
    const [scale, setScale] = useState(20)
    const [svgPath, setSvgPath] = useState('')
    const [zoom, setZoom] = useState(1)
    const svgRef = useRef<SVGSVGElement>(null)
    
    // Pinch to zoom
    useEffect(() => {
        const svg = svgRef.current
        if (!svg) return
        
        let initialDistance = 0
        
        const getTouchDistance = (touches: TouchList) => {
            const dx = touches[0].clientX - touches[1].clientX
            const dy = touches[0].clientY - touches[1].clientY
            return Math.sqrt(dx * dx + dy * dy)
        }
        
        const handleTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                e.preventDefault()
                initialDistance = getTouchDistance(e.touches)
            }
        }
        
        const handleTouchMove = (e: TouchEvent) => {
            if (e.touches.length === 2 && initialDistance > 0) {
                e.preventDefault()
                const currentDistance = getTouchDistance(e.touches)
                const scale = currentDistance / initialDistance
                setZoom(prev => Math.max(0.5, Math.min(3, prev * scale)))
                initialDistance = currentDistance
            }
        }
        
        svg.addEventListener('touchstart', handleTouchStart, { passive: false })
        svg.addEventListener('touchmove', handleTouchMove, { passive: false })
        
        return () => {
            svg.removeEventListener('touchstart', handleTouchStart)
            svg.removeEventListener('touchmove', handleTouchMove)
        }
    }, [svgPath])
    
    const generate = () => {
        if (type === 'function') {
            const path = math2svg({
                type: 'function',
                expression,
                xMin,
                xMax,
                scaleX: scale,
                scaleY: scale,
                offsetX: 250,
                offsetY: 250,
                samples: 200
            })
            setSvgPath(path)
        } else {
            const path = math2svg({
                type: 'parametric',
                xExpression,
                yExpression,
                tMin,
                tMax,
                scaleX: scale,
                scaleY: scale,
                offsetX: 250,
                offsetY: 250,
                samples: 200
            })
            setSvgPath(path)
        }
    }
    
    const insert = () => {
        if (!svgPath) return
        // For now, just copy to clipboard
        navigator.clipboard.writeText(svgPath)
        alert('SVG path copied to clipboard!')
    }
    
    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="tlui-button"
                style={{
                    position: 'fixed',
                    bottom: '80px',
                    left: '16px',
                    zIndex: 999,
                    height: '40px',
                    padding: '0 16px',
                    gap: '8px',
                    background: 'var(--color-panel)',
                    border: '1px solid var(--color-panel-contrast)',
                    boxShadow: 'var(--shadow-2)',
                }}
            >
                <span style={{ fontSize: '18px' }}>ƒ</span>
                <span>Equations</span>
            </button>
        )
    }
    
    return (
        <div
            style={{
                position: 'fixed',
                bottom: '80px',
                left: '16px',
                width: '360px',
                background: 'var(--color-panel)',
                border: '1px solid var(--color-panel-contrast)',
                borderRadius: '12px',
                boxShadow: 'var(--shadow-3)',
                zIndex: 999,
                fontFamily: 'var(--tl-font-ui)',
            }}
        >
            {/* Header */}
            <div style={{
                padding: '16px',
                borderBottom: '1px solid var(--color-panel-contrast)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px' }}>ƒ</span>
                    <span style={{ fontSize: '15px', fontWeight: 600 }}>Function Plotter</span>
                </div>
                <button
                    onClick={() => setIsOpen(false)}
                    className="tlui-button tlui-button__icon"
                    style={{ width: '32px', height: '32px' }}
                >
                    ✕
                </button>
            </div>
            
            {/* Content */}
            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Type Selector */}
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={() => setType('function')}
                        className={`tlui-button ${type === 'function' ? 'tlui-button__primary' : ''}`}
                        style={{ flex: 1, height: '36px', fontSize: '13px' }}
                    >
                        y(x)
                    </button>
                    <button
                        onClick={() => setType('parametric')}
                        className={`tlui-button ${type === 'parametric' ? 'tlui-button__primary' : ''}`}
                        style={{ flex: 1, height: '36px', fontSize: '13px' }}
                    >
                        Parametric
                    </button>
                </div>
                
                {/* Expression Input */}
                {type === 'function' ? (
                <>
                    <div>
                        <label style={{ 
                            display: 'block', 
                            fontSize: '13px', 
                            marginBottom: '8px',
                            color: 'var(--color-text-1)',
                            fontWeight: 500
                        }}>
                            y(x) =
                        </label>
                        <input
                            type="text"
                            value={expression}
                            onChange={(e) => setExpression(e.target.value)}
                            placeholder="e.g., sin(x), x^2, cos(x)*x"
                            className="tlui-input"
                            style={{
                                width: '100%',
                                height: '40px',
                                fontSize: '14px'
                            }}
                        />
                    </div>
                    
                    {/* Range */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                        <label style={{ 
                            display: 'block', 
                            fontSize: '12px', 
                            marginBottom: '6px',
                            color: 'var(--color-text-2)'
                        }}>
                            x min
                        </label>
                        <input
                            type="number"
                            value={xMin}
                            onChange={(e) => setXMin(Number(e.target.value))}
                            className="tlui-input"
                            style={{ width: '100%', height: '36px' }}
                        />
                    </div>
                    <div>
                        <label style={{ 
                            display: 'block', 
                            fontSize: '12px', 
                            marginBottom: '6px',
                            color: 'var(--color-text-2)'
                        }}>
                            x max
                        </label>
                        <input
                            type="number"
                            value={xMax}
                            onChange={(e) => setXMax(Number(e.target.value))}
                            className="tlui-input"
                            style={{ width: '100%', height: '36px' }}
                        />
                    </div>
                    </div>
                </>
                ) : (
                <>
                <div>
                    <div style={{ marginBottom: '12px' }}>
                        <label style={{ 
                            display: 'block', 
                            fontSize: '13px', 
                            marginBottom: '8px',
                            color: 'var(--color-text-1)',
                            fontWeight: 500
                        }}>
                            x(t) =
                        </label>
                        <input
                            type="text"
                            value={xExpression}
                            onChange={(e) => setXExpression(e.target.value)}
                            placeholder="e.g., cos(t)"
                            className="tlui-input"
                            style={{ width: '100%', height: '40px', fontSize: '14px' }}
                        />
                    </div>
                    <div style={{ marginBottom: '12px' }}>
                        <label style={{ 
                            display: 'block', 
                            fontSize: '13px', 
                            marginBottom: '8px',
                            color: 'var(--color-text-1)',
                            fontWeight: 500
                        }}>
                            y(t) =
                        </label>
                        <input
                            type="text"
                            value={yExpression}
                            onChange={(e) => setYExpression(e.target.value)}
                            placeholder="e.g., sin(t)"
                            className="tlui-input"
                            style={{ width: '100%', height: '40px', fontSize: '14px' }}
                        />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                            <label style={{ 
                                display: 'block', 
                                fontSize: '12px', 
                                marginBottom: '6px',
                                color: 'var(--color-text-2)'
                            }}>
                                t min
                            </label>
                            <input
                                type="number"
                                value={tMin}
                                onChange={(e) => setTMin(Number(e.target.value))}
                                className="tlui-input"
                                style={{ width: '100%', height: '36px' }}
                                step="0.1"
                            />
                        </div>
                        <div>
                            <label style={{ 
                                display: 'block', 
                                fontSize: '12px', 
                                marginBottom: '6px',
                                color: 'var(--color-text-2)'
                            }}>
                                t max
                            </label>
                            <input
                                type="number"
                                value={tMax}
                                onChange={(e) => setTMax(Number(e.target.value))}
                                className="tlui-input"
                                style={{ width: '100%', height: '36px' }}
                                step="0.1"
                            />
                        </div>
                    </div>
                </div>
                </>
                )}
                
                {/* Scale */}
                <div>
                    <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        marginBottom: '8px'
                    }}>
                        <label style={{ 
                            fontSize: '12px', 
                            color: 'var(--color-text-2)'
                        }}>
                            Scale
                        </label>
                        <span style={{ 
                            fontSize: '12px', 
                            color: 'var(--color-text-1)',
                            fontWeight: 500
                        }}>
                            {scale}
                        </span>
                    </div>
                    <input
                        type="range"
                        min="5"
                        max="50"
                        value={scale}
                        onChange={(e) => setScale(Number(e.target.value))}
                        style={{ width: '100%' }}
                    />
                </div>
                
                {/* Generate Button */}
                <button
                    onClick={generate}
                    className="tlui-button tlui-button__primary"
                    style={{ 
                        width: '100%', 
                        height: '40px',
                        fontSize: '14px',
                        fontWeight: 600
                    }}
                >
                    Generate
                </button>
                
                {/* Preview */}
                {svgPath && (
                    <div>
                        <label style={{ 
                            display: 'block', 
                            fontSize: '12px', 
                            marginBottom: '8px',
                            color: 'var(--color-text-2)'
                        }}>
                            Preview
                        </label>
                        <div style={{ position: 'relative' }}>
                            <svg
                                ref={svgRef}
                                width="100%"
                                height="180"
                                viewBox={`${250 - 250/zoom} ${250 - 250/zoom} ${500/zoom} ${500/zoom}`}
                                style={{
                                    background: 'var(--color-low)',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-panel-contrast)',
                                    touchAction: 'none',
                                    cursor: zoom !== 1 ? 'move' : 'default'
                                }}
                            >
                            {/* Axes */}
                            <line x1="0" y1="250" x2="500" y2="250" stroke="var(--color-grid)" strokeWidth="1" opacity="0.3" />
                            <line x1="250" y1="0" x2="250" y2="500" stroke="var(--color-grid)" strokeWidth="1" opacity="0.3" />
                            
                            {/* Function */}
                            <path
                                d={svgPath}
                                fill="none"
                                stroke="var(--color-primary)"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                        
                        {/* Zoom indicator */}
                        {zoom !== 1 && (
                            <div style={{
                                position: 'absolute',
                                top: '8px',
                                right: '8px',
                                background: '#212121',
                                border: '1px solid var(--color-panel-contrast)',
                                borderRadius: '6px',
                                padding: '4px 8px',
                                fontSize: '11px',
                                fontWeight: 600,
                                pointerEvents: 'none'
                            }}>
                                {zoom.toFixed(1)}x
                            </div>
                        )}
                        
                        {/* Reset zoom button */}
                        {zoom !== 1 && (
                            <button
                                onClick={() => setZoom(1)}
                                className="tlui-button tlui-button__icon"
                                style={{
                                    position: 'absolute',
                                    bottom: '8px',
                                    right: '8px',
                                    width: '32px',
                                    height: '32px'
                                }}
                                title="Reset zoom"
                            >
                                ⟲
                            </button>
                        )}
                        </div>
                        
                        {/* Insert Button */}
                        <button
                            onClick={insert}
                            className="tlui-button"
                            style={{ 
                                width: '100%', 
                                height: '36px',
                                marginTop: '12px',
                                fontSize: '13px'
                            }}
                        >
                            Copy SVG Path
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
