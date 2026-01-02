import { 
    ShapeUtil, 
    TLShape, 
    HTMLContainer, 
    Rectangle2d,
    T,
    useEditor
} from 'tldraw'
import { useState } from 'react'
import { math2svgFull } from '../utils/math2svg'

// Component for interactive equation shapes with hover controls
function EquationShapeComponent({ shape, svgContent }: { shape: IEquationShape, svgContent: string }) {
    const editor = useEditor()
    const [showControls, setShowControls] = useState(false)
    
    // Calculate scale factor for buttons based on shape size (relative to default 500x500)
    const scaleFactor = Math.min(shape.props.w / 500, shape.props.h / 500)
    const buttonSize = Math.max(16, Math.min(32, 24 * scaleFactor)) // Clamp between 16-32px
    const fontSize = Math.max(10, Math.min(18, 14 * scaleFactor))
    const padding = Math.max(2, Math.min(6, 4 * scaleFactor))
    const gap = Math.max(2, Math.min(6, 4 * scaleFactor))
    
    const handlePan = (dx: number, dy: number, e: React.MouseEvent) => {
        e.stopPropagation()
        const offsetX = (shape.props.offsetX ?? 250) + dx
        const offsetY = (shape.props.offsetY ?? 250) + dy
        editor.updateShape({
            id: shape.id,
            type: 'equation',
            props: { offsetX, offsetY }
        })
    }
    
    const handleZoom = (factor: number, e: React.MouseEvent) => {
        e.stopPropagation()
        const scaleX = Math.max(1, shape.props.scaleX * factor)
        const scaleY = Math.max(1, shape.props.scaleY * factor)
        editor.updateShape({
            id: shape.id,
            type: 'equation',
            props: { scaleX, scaleY }
        })
    }

    const toggleAspectRatio = (e: React.MouseEvent) => {
        e.stopPropagation()
        editor.updateShape({
            id: shape.id,
            type: 'equation',
            props: { lockAspectRatio: !shape.props.lockAspectRatio }
        })
    }

    const getButtonStyle = (active = false): React.CSSProperties => ({
        width: `${buttonSize}px`,
        height: `${buttonSize}px`,
        border: 'none',
        background: active ? 'rgba(66, 135, 245, 0.9)' : 'rgba(255,255,255,0.15)',
        color: 'white',
        borderRadius: '4px',
        cursor: 'pointer',
        fontSize: `${fontSize}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        flexShrink: 0
    })
    
    return (
        <div 
            style={{
                width: shape.props.w,
                height: shape.props.h,
                pointerEvents: 'all',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                position: 'relative'
            }}
            onMouseEnter={() => setShowControls(true)}
            onMouseLeave={() => setShowControls(false)}
        >
            <div dangerouslySetInnerHTML={{ __html: svgContent }} />
            
            {showControls && (
                <div style={{
                    position: 'absolute',
                    bottom: padding * 2,
                    right: padding * 2,
                    display: 'flex',
                    gap,
                    background: 'rgba(0,0,0,0.8)',
                    padding: `${padding}px`,
                    borderRadius: '6px',
                    zIndex: 1000,
                    backdropFilter: 'blur(4px)'
                }} onClick={(e) => e.stopPropagation()}>
                    <button onClick={(e) => handlePan(-10, 0, e)} style={getButtonStyle()} title="Pan Left">←</button>
                    <button onClick={(e) => handlePan(10, 0, e)} style={getButtonStyle()} title="Pan Right">→</button>
                    <button onClick={(e) => handlePan(0, -10, e)} style={getButtonStyle()} title="Pan Up">↑</button>
                    <button onClick={(e) => handlePan(0, 10, e)} style={getButtonStyle()} title="Pan Down">↓</button>
                    <div style={{ width: '1px', background: 'rgba(255,255,255,0.3)', margin: '0 2px' }} />
                    <button onClick={(e) => handleZoom(1.2, e)} style={getButtonStyle()} title="Zoom In">+</button>
                    <button onClick={(e) => handleZoom(0.8, e)} style={getButtonStyle()} title="Zoom Out">−</button>
                    <div style={{ width: '1px', background: 'rgba(255,255,255,0.3)', margin: '0 2px' }} />
                    <button
                        onClick={toggleAspectRatio}
                        style={getButtonStyle(shape.props.lockAspectRatio)}
                        title={shape.props.lockAspectRatio ? "Unlock Aspect Ratio" : "Lock Aspect Ratio"}
                    >
                        {shape.props.lockAspectRatio ? "🔒" : "🔓"}
                    </button>
                </div>
            )}
        </div>
    )
}

export type IEquationShape = TLShape & {
    type: 'equation'
    props: {
        w: number
        h: number
        
        // Equation
        type: 'function' | 'parametric'
        expression: string
        xExpression: string
        yExpression: string
        xMin: number
        xMax: number
        tMin: number
        tMax: number
        scaleX: number
        scaleY: number
        offsetX: number
        offsetY: number
        
        // View
        showAxes: boolean
        showGrid: boolean
        showNumbers: boolean
        
        // Style
        axisColor: string
        gridColor: string
        strokeColor: string

        // Behavior
        lockAspectRatio?: boolean

        // Font (optional for backwards compatibility)
        fontSize?: number
        fontFamily?: string
    }
}

export class EquationShapeUtil extends ShapeUtil<IEquationShape> {
    static override type = 'equation' as const

    static override props = {
        w: T.number,
        h: T.number,
        type: T.string,
        expression: T.string,
        xExpression: T.string,
        yExpression: T.string,
        xMin: T.number,
        xMax: T.number,
        tMin: T.number,
        tMax: T.number,
        scaleX: T.number,
        scaleY: T.number,
        offsetX: T.number.optional(),
        offsetY: T.number.optional(),
        showAxes: T.boolean,
        showGrid: T.boolean,
        showNumbers: T.boolean,
        axisColor: T.string,
        gridColor: T.string,
        strokeColor: T.string,
        lockAspectRatio: T.boolean.optional(),
        fontSize: T.number.optional(),
        fontFamily: T.string.optional(),
    }

    override canResize = (_shape: IEquationShape) => true

    override isAspectRatioLocked = (shape: IEquationShape) => shape.props.lockAspectRatio ?? false

    // Disable text editing on double-click
    override canEdit = () => false

    override onResize = (shape: IEquationShape, info: { newPoint: { x: number, y: number }, handle: string, scaleX: number, scaleY: number }) => {
        return {
            props: {
                w: Math.max(100, shape.props.w * info.scaleX),
                h: Math.max(100, shape.props.h * info.scaleY),
            }
        }
    }

    override getDefaultProps(): IEquationShape['props'] {
        return {
            w: 500,
            h: 500,
            type: 'function',
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
            lockAspectRatio: false,
            fontSize: 8,
            fontFamily: 'monospace'
        }
    }

    override getGeometry(shape: IEquationShape) {
        // Just a rectangular bounds for now
        return new Rectangle2d({
            width: shape.props.w,
            height: shape.props.h,
            isFilled: true,
        })
    }

    override component(shape: IEquationShape) {
        const { w, h, axisColor, gridColor, strokeColor } = shape.props
        const offsetX = shape.props.offsetX ?? 250
        const offsetY = shape.props.offsetY ?? 250
        const fontSize = shape.props.fontSize ?? 8
        const fontFamily = shape.props.fontFamily ?? 'monospace'
        
        // Generate SVG string with fixed 500x500 viewBox, scaled to shape dimensions
        const svgString = math2svgFull({
            ...shape.props,
            offsetX,
            offsetY,
            // Pass explicitly to ensure colors match props
            axisColor,
            gridColor,
            strokeColor,
            fontSize,
            fontFamily,
            samples: 400
        })

        // Replace the viewBox in the SVG to maintain aspect ratio when resizing
        const modifiedSvg = svgString.replace(
            /width="500" height="500"/,
            `width="${w}" height="${h}" preserveAspectRatio="none"`
        )
        
        return (
            <HTMLContainer id={shape.id}>
                <EquationShapeComponent shape={shape} svgContent={modifiedSvg} />
            </HTMLContainer>
        )
    }

    override indicator(shape: IEquationShape) {
        return <rect width={shape.props.w} height={shape.props.h} />
    }
}
