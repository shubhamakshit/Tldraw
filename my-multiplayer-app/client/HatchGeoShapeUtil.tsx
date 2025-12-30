import { 
    GeoShapeUtil, 
    useDefaultColorTheme,
    TLGeoShape
} from 'tldraw'

export class HatchGeoShapeUtil extends GeoShapeUtil {
    static override type = 'geo' as const

    override component(shape: TLGeoShape) {
        const base = super.component(shape)
        const theme = useDefaultColorTheme()
        
        // Get custom colors if set
        const fillColorKey = (shape.meta.fillColor as string) || shape.props.color
        const strokeThemeColor = (theme as any)[shape.props.color]
        const fillThemeColor = (theme as any)[fillColorKey]
        const strokeColor = strokeThemeColor?.solid || '#000000'
        const fillColor = fillThemeColor?.solid || strokeColor
        
        const borderOpacity = (shape.meta.borderOpacity as number) ?? 1.0
        const fillOpacity = (shape.meta.fillOpacity as number) ?? 1.0
        
        // Use CSS color override for all fills
        return (
            <div
                style={{
                    ['--custom-stroke-color' as any]: strokeColor,
                    ['--custom-fill-color' as any]: fillColor,
                    ['--custom-stroke-opacity' as any]: borderOpacity,
                    ['--custom-fill-opacity' as any]: fillOpacity,
                }}
                className="custom-geo-colors"
            >
                {base}
            </div>
        )
    }
}

// Old code removed - using CSS color override instead

/* function ColorOverlayRenderer({ shape, base }: { shape: TLGeoShape, base: JSX.Element }) {
    const theme = useDefaultColorTheme()
    const containerRef = useRef<HTMLDivElement>(null)
    
    const fillColorKey = (shape.meta.fillColor as string) || shape.props.color
    const strokeColor = theme[shape.props.color]?.solid || '#000000'
    const fillColor = (fillColorKey && theme[fillColorKey as keyof typeof theme]?.solid) || strokeColor
    
    console.log('🔍 Theme lookup:', {
        fillColorKey,
        themeKeys: Object.keys(theme),
        themeHasFillColor: fillColorKey in theme,
        fillColorResult: fillColor,
        strokeColorResult: strokeColor
    })
    
    const borderOpacity = (shape.meta.borderOpacity as number) ?? 1.0
    const fillOpacity = (shape.meta.fillOpacity as number) ?? 1.0
    const masterOpacity = shape.opacity
    
    useLayoutEffect(() => {
        if (!containerRef.current) return
        
        console.log('🎨 ColorOverlayRenderer running:', { 
            stroke: shape.props.color, 
            fill: fillColorKey,
            strokeColor,
            fillColor,
            borderOpacity,
            fillOpacity,
            masterOpacity
        })
        
        // Find all SVG elements in the base component
        const svgElements = containerRef.current.querySelectorAll('svg path, svg rect, svg ellipse, svg circle, svg polygon, svg polyline')
        
        console.log(`🎨 Found ${svgElements.length} SVG elements to recolor`)
        
        let appliedCount = 0
        svgElements.forEach((el: any, index) => {
            const currentFill = el.getAttribute('fill')
            const currentStroke = el.getAttribute('stroke')
            
            console.log(`🎨 Element [${index}]:`, {
                tag: el.tagName,
                currentFill,
                currentStroke,
                willApplyFill: currentFill && currentFill !== 'none',
                willApplyStroke: currentStroke && currentStroke !== 'none'
            })
            
            // Apply fill color and opacity
            if (currentFill && currentFill !== 'none') {
                el.setAttribute('fill', fillColor)
                el.style.fillOpacity = (masterOpacity * fillOpacity).toString()
                el.style.visibility = 'visible'
                appliedCount++
                console.log(`🎨 ✓ Applied fill: ${fillColor} with opacity ${(masterOpacity * fillOpacity)}`)
            }
            
            // Apply stroke color and opacity
            if (currentStroke && currentStroke !== 'none') {
                el.setAttribute('stroke', strokeColor)
                el.style.strokeOpacity = (masterOpacity * borderOpacity).toString()
                el.style.visibility = 'visible'
                appliedCount++
                console.log(`🎨 ✓ Applied stroke: ${strokeColor} with opacity ${(masterOpacity * borderOpacity)}`)
            }
        })
        
        console.log(`🎨 Applied colors to ${appliedCount} attributes`)
    }, [shape.props.color, fillColorKey, strokeColor, fillColor, borderOpacity, fillOpacity, masterOpacity, shape.props.w, shape.props.h, shape.props.geo, shape.props.fill])
    
    return (
        <div 
            ref={containerRef}
            style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                pointerEvents: 'all'
            }}
        >
            {base}
        </div>
    )
}

*/

/* function HatchRenderer_OLD({ shape }: { shape: TLGeoShape }) {
    const theme = useDefaultColorTheme()
    const { w, h, color, geo, dash, size, fill } = shape.props
    const masterOpacity = shape.opacity
    const borderOpacityMeta = (shape.meta.borderOpacity as number) ?? 1.0
    const fillOpacityMeta = (shape.meta.fillOpacity as number) ?? 0.6
    
    const svgRef = useRef<SVGSVGElement>(null)
    const hatchGroupRef = useRef<SVGGElement | null>(null)
    const strokeGroupRef = useRef<SVGGElement | null>(null)

    // Effect 1: Heavy RoughJS rendering (only on structural changes)
    useLayoutEffect(() => {
        const el = svgRef.current
        if (!el) return
        el.innerHTML = ''
        const rc = rough.svg(el)
        
        const strokeWidths = { s: 2, m: 3.5, l: 5, xl: 10 }
        const strokeWidth = strokeWidths[size] || 2
        const hachureGaps = { s: 4, m: 5, l: 7, xl: 10 }
        const hachureGap = hachureGaps[size] || 5

        let currentFillColor = 'none'
        let currentFillStyle = 'hachure'

        // Use separate fill color from meta.fillColor if set, otherwise use stroke color
        const fillColorKey = (shape.meta.fillColor as string) || color
        
        console.log('🎨 HatchRenderer:', {
            geo,
            strokeColor: color,
            fillColor: fillColorKey,
            fill,
            hasMeta: !!shape.meta.fillColor
        })
        
        if (fill === 'solid') {
            currentFillColor = theme[fillColorKey as any]?.solid || theme[color].solid
            currentFillStyle = 'solid'
        } else if (fill === 'semi') {
            currentFillColor = theme[fillColorKey as any]?.semi || theme[color].semi
            currentFillStyle = 'solid'
        } else if (fill === 'pattern') {
            currentFillColor = theme[fillColorKey as any]?.semi || theme[color].semi
            currentFillStyle = 'hachure'
        }

        console.log('🎨 Rendering colors:', {
            strokeColor: theme[color].solid,
            fillColor: currentFillColor
        })

        // Stroke always uses the native tldraw color style
        const strokeColor = theme[color].solid
        
        const hatchOptions: any = {
            fill: currentFillColor,
            stroke: 'none',
            fillStyle: currentFillStyle,
            hachureAngle: 60,
            hachureGap: hachureGap,
            roughness: 1,
            fillWeight: strokeWidth / 2,
        }

        const strokeOptions: any = {
            stroke: strokeColor,
            strokeWidth: strokeWidth,
            roughness: 1,
        }

        let dashArray: number[] | null = null
        if (dash === 'dashed') {
            dashArray = [strokeWidth * 3, strokeWidth * 3]
        } else if (dash === 'dotted') {
            dashArray = [strokeWidth, strokeWidth * 2]
        }

        const padding = strokeWidth / 2 + 1
        
        let hatchNode: SVGGElement | null = null
        let strokeNode: SVGGElement | null = null
        
        // Render based on geometry type
        switch (geo) {
            case 'rectangle':
            case 'check-box':
            case 'x-box':
                if (fill !== 'none') hatchNode = rc.rectangle(padding, padding, w - padding * 2, h - padding * 2, hatchOptions)
                strokeNode = rc.rectangle(padding, padding, w - padding * 2, h - padding * 2, strokeOptions)
                break
            
            case 'ellipse':
            case 'oval':
                if (fill !== 'none') hatchNode = rc.ellipse(w / 2, h / 2, w - padding * 2, h - padding * 2, hatchOptions)
                strokeNode = rc.ellipse(w / 2, h / 2, w - padding * 2, h - padding * 2, strokeOptions)
                break
            
            case 'triangle':
                const trianglePoints: [number, number][] = [[w / 2, padding], [w - padding, h - padding], [padding, h - padding]]
                if (fill !== 'none') hatchNode = rc.polygon(trianglePoints, hatchOptions)
                strokeNode = rc.polygon(trianglePoints, strokeOptions)
                break
            
            case 'diamond':
                const diamondPoints: [number, number][] = [[w / 2, padding], [w - padding, h / 2], [w / 2, h - padding], [padding, h / 2]]
                if (fill !== 'none') hatchNode = rc.polygon(diamondPoints, hatchOptions)
                strokeNode = rc.polygon(diamondPoints, strokeOptions)
                break
            
            case 'pentagon':
                const pentagonPoints: [number, number][] = [
                    [w / 2, padding],
                    [w - padding, h / 2 - h / 10],
                    [w - padding - w / 5, h - padding],
                    [padding + w / 5, h - padding],
                    [padding, h / 2 - h / 10]
                ]
                if (fill !== 'none') hatchNode = rc.polygon(pentagonPoints, hatchOptions)
                strokeNode = rc.polygon(pentagonPoints, strokeOptions)
                break
            
            case 'hexagon':
                const hexagonPoints: [number, number][] = [
                    [w / 4, padding],
                    [w * 3 / 4, padding],
                    [w - padding, h / 2],
                    [w * 3 / 4, h - padding],
                    [w / 4, h - padding],
                    [padding, h / 2]
                ]
                if (fill !== 'none') hatchNode = rc.polygon(hexagonPoints, hatchOptions)
                strokeNode = rc.polygon(hexagonPoints, strokeOptions)
                break
            
            case 'octagon':
                const octagonPoints: [number, number][] = [
                    [w / 3, padding],
                    [w * 2 / 3, padding],
                    [w - padding, w / 3],
                    [w - padding, h - w / 3],
                    [w * 2 / 3, h - padding],
                    [w / 3, h - padding],
                    [padding, h - w / 3],
                    [padding, w / 3]
                ]
                if (fill !== 'none') hatchNode = rc.polygon(octagonPoints, hatchOptions)
                strokeNode = rc.polygon(octagonPoints, strokeOptions)
                break
            
            case 'star':
                const starPoints: [number, number][] = []
                const outerRadius = Math.min(w, h) / 2 - padding
                const innerRadius = outerRadius * 0.4
                const centerX = w / 2
                const centerY = h / 2
                for (let i = 0; i < 10; i++) {
                    const radius = i % 2 === 0 ? outerRadius : innerRadius
                    const angle = (i * Math.PI / 5) - Math.PI / 2
                    starPoints.push([
                        centerX + radius * Math.cos(angle),
                        centerY + radius * Math.sin(angle)
                    ])
                }
                if (fill !== 'none') hatchNode = rc.polygon(starPoints, hatchOptions)
                strokeNode = rc.polygon(starPoints, strokeOptions)
                break
            
            case 'rhombus':
                const rhombusPoints: [number, number][] = [
                    [w / 2, padding],
                    [w - padding, h / 2],
                    [w / 2, h - padding],
                    [padding, h / 2]
                ]
                if (fill !== 'none') hatchNode = rc.polygon(rhombusPoints, hatchOptions)
                strokeNode = rc.polygon(rhombusPoints, strokeOptions)
                break
            
            case 'cloud':
                // Simplified cloud as ellipse for now
                if (fill !== 'none') hatchNode = rc.ellipse(w / 2, h / 2, w - padding * 2, h - padding * 2, hatchOptions)
                strokeNode = rc.ellipse(w / 2, h / 2, w - padding * 2, h - padding * 2, strokeOptions)
                break
            
            case 'trapezoid':
                const trapezoidPoints: [number, number][] = [
                    [w / 4, padding],
                    [w * 3 / 4, padding],
                    [w - padding, h - padding],
                    [padding, h - padding]
                ]
                if (fill !== 'none') hatchNode = rc.polygon(trapezoidPoints, hatchOptions)
                strokeNode = rc.polygon(trapezoidPoints, strokeOptions)
                break
            
            case 'arrow-right':
                const arrowRightPoints: [number, number][] = [
                    [padding, padding],
                    [w * 3 / 4, padding],
                    [w - padding, h / 2],
                    [w * 3 / 4, h - padding],
                    [padding, h - padding]
                ]
                if (fill !== 'none') hatchNode = rc.polygon(arrowRightPoints, hatchOptions)
                strokeNode = rc.polygon(arrowRightPoints, strokeOptions)
                break
            
            case 'arrow-left':
                const arrowLeftPoints: [number, number][] = [
                    [w - padding, padding],
                    [w / 4, padding],
                    [padding, h / 2],
                    [w / 4, h - padding],
                    [w - padding, h - padding]
                ]
                if (fill !== 'none') hatchNode = rc.polygon(arrowLeftPoints, hatchOptions)
                strokeNode = rc.polygon(arrowLeftPoints, strokeOptions)
                break
            
            case 'arrow-up':
                const arrowUpPoints: [number, number][] = [
                    [w / 2, padding],
                    [w - padding, h / 4],
                    [w * 3 / 4, h / 4],
                    [w * 3 / 4, h - padding],
                    [w / 4, h - padding],
                    [w / 4, h / 4],
                    [padding, h / 4]
                ]
                if (fill !== 'none') hatchNode = rc.polygon(arrowUpPoints, hatchOptions)
                strokeNode = rc.polygon(arrowUpPoints, strokeOptions)
                break
            
            case 'arrow-down':
                const arrowDownPoints: [number, number][] = [
                    [w / 4, padding],
                    [w * 3 / 4, padding],
                    [w * 3 / 4, h * 3 / 4],
                    [w - padding, h * 3 / 4],
                    [w / 2, h - padding],
                    [padding, h * 3 / 4],
                    [w / 4, h * 3 / 4]
                ]
                if (fill !== 'none') hatchNode = rc.polygon(arrowDownPoints, hatchOptions)
                strokeNode = rc.polygon(arrowDownPoints, strokeOptions)
                break
            
            default:
                // Default to rectangle for unknown shapes
                if (fill !== 'none') hatchNode = rc.rectangle(padding, padding, w - padding * 2, h - padding * 2, hatchOptions)
                strokeNode = rc.rectangle(padding, padding, w - padding * 2, h - padding * 2, strokeOptions)
                break
        }
        
        if (hatchNode) {
            el.appendChild(hatchNode)
            hatchGroupRef.current = hatchNode
        } else {
            hatchGroupRef.current = null
        }
        
        if (strokeNode) {
            if (dashArray) {
                const dashString = dashArray.join(', ')
                strokeNode.querySelectorAll('path').forEach(path => {
                    path.setAttribute('stroke-dasharray', dashString)
                })
            }
            el.appendChild(strokeNode)
            strokeGroupRef.current = strokeNode
        } else {
            strokeGroupRef.current = null
        }
    }, [w, h, color, geo, theme, dash, size, fill, shape.meta.fillColor])

    // Effect 2: Fast opacity updates (no RoughJS path generation)
    useLayoutEffect(() => {
        if (hatchGroupRef.current) {
            hatchGroupRef.current.setAttribute('opacity', (masterOpacity * fillOpacityMeta).toString())
        }
        if (strokeGroupRef.current) {
            strokeGroupRef.current.setAttribute('opacity', (masterOpacity * borderOpacityMeta).toString())
        }
    }, [masterOpacity, fillOpacityMeta, borderOpacityMeta])

    return (
        <svg
            ref={svgRef}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: w,
                height: h,
                overflow: 'visible',
                pointerEvents: 'none'
            }}
        />
    )
}
*/
