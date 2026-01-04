import { Editor, createShapeId, TLShapeId } from 'tldraw'

interface ParsedShape {
    type: 'geo' | 'draw' | 'line' | 'text'
    x: number
    y: number
    props: Record<string, any>
    rotation?: number
}

// Map SVG colors to tldraw color names
function mapColorToTldraw(color: string | null): string {
    if (!color || color === 'none') return 'black'

    const colorMap: Record<string, string> = {
        '#000000': 'black',
        '#000': 'black',
        'black': 'black',
        '#ffffff': 'white',
        '#fff': 'white',
        'white': 'white',
        '#ff0000': 'red',
        'red': 'red',
        '#00ff00': 'green',
        'green': 'green',
        '#0000ff': 'blue',
        'blue': 'blue',
        '#ffff00': 'yellow',
        'yellow': 'yellow',
        '#ffa500': 'orange',
        'orange': 'orange',
        '#800080': 'violet',
        'purple': 'violet',
        'violet': 'violet',
        '#808080': 'grey',
        'gray': 'grey',
        'grey': 'grey',
    }

    return colorMap[color.toLowerCase()] || 'black'
}

// Map SVG fill to tldraw fill type
function mapFillType(fill: string | null): 'none' | 'solid' | 'semi' {
    if (!fill || fill === 'none' || fill === 'transparent') return 'none'
    return 'solid'
}

// Parse transform attribute to extract translate values
function parseTransform(transform: string | null): { x: number; y: number; rotation: number } {
    const result = { x: 0, y: 0, rotation: 0 }
    if (!transform) return result

    // Parse translate(x, y) or translate(x y)
    const translateMatch = transform.match(/translate\s*\(\s*([^,\s]+)[\s,]*([^)]*)\)/)
    if (translateMatch) {
        result.x = parseFloat(translateMatch[1]) || 0
        result.y = parseFloat(translateMatch[2]) || 0
    }

    // Parse rotate(angle) or rotate(angle, cx, cy)
    const rotateMatch = transform.match(/rotate\s*\(\s*([^,)\s]+)/)
    if (rotateMatch) {
        result.rotation = (parseFloat(rotateMatch[1]) || 0) * (Math.PI / 180)
    }

    return result
}

// Parse an SVG path d attribute into segments for TLDrawShape
function parsePathToSegments(d: string): { type: 'line' | 'free'; points: { x: number; y: number }[] }[] {
    const segments: { type: 'free'; points: { x: number; y: number }[] }[] = []
    const points: { x: number; y: number }[] = []

    // Simplified path parsing - handles M, L, C, Q, Z commands
    const commands = d.match(/[MLHVCSQTAZmlhvcsqtaz][^MLHVCSQTAZmlhvcsqtaz]*/g) || []

    let currentX = 0
    let currentY = 0
    let startX = 0
    let startY = 0

    for (const cmd of commands) {
        const type = cmd[0]
        const args = cmd.slice(1).trim().split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n))

        switch (type) {
            case 'M': // Move to absolute
                currentX = args[0] || 0
                currentY = args[1] || 0
                startX = currentX
                startY = currentY
                points.push({ x: currentX, y: currentY })
                break
            case 'm': // Move to relative
                currentX += args[0] || 0
                currentY += args[1] || 0
                startX = currentX
                startY = currentY
                points.push({ x: currentX, y: currentY })
                break
            case 'L': // Line to absolute
                for (let i = 0; i < args.length; i += 2) {
                    currentX = args[i]
                    currentY = args[i + 1]
                    points.push({ x: currentX, y: currentY })
                }
                break
            case 'l': // Line to relative
                for (let i = 0; i < args.length; i += 2) {
                    currentX += args[i]
                    currentY += args[i + 1]
                    points.push({ x: currentX, y: currentY })
                }
                break
            case 'H': // Horizontal line absolute
                currentX = args[0]
                points.push({ x: currentX, y: currentY })
                break
            case 'h': // Horizontal line relative
                currentX += args[0]
                points.push({ x: currentX, y: currentY })
                break
            case 'V': // Vertical line absolute
                currentY = args[0]
                points.push({ x: currentX, y: currentY })
                break
            case 'v': // Vertical line relative
                currentY += args[0]
                points.push({ x: currentX, y: currentY })
                break
            case 'C': // Cubic bezier absolute - sample points along curve
                for (let i = 0; i < args.length; i += 6) {
                    // Add intermediate points for smoother curve
                    const x1 = args[i], y1 = args[i + 1]
                    const x2 = args[i + 2], y2 = args[i + 3]
                    const x3 = args[i + 4], y3 = args[i + 5]

                    for (let t = 0.25; t <= 1; t += 0.25) {
                        const px = Math.pow(1 - t, 3) * currentX + 3 * Math.pow(1 - t, 2) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t * x3
                        const py = Math.pow(1 - t, 3) * currentY + 3 * Math.pow(1 - t, 2) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t * y3
                        points.push({ x: px, y: py })
                    }
                    currentX = x3
                    currentY = y3
                }
                break
            case 'c': // Cubic bezier relative
                for (let i = 0; i < args.length; i += 6) {
                    const x1 = currentX + args[i], y1 = currentY + args[i + 1]
                    const x2 = currentX + args[i + 2], y2 = currentY + args[i + 3]
                    const x3 = currentX + args[i + 4], y3 = currentY + args[i + 5]

                    const sx = currentX, sy = currentY
                    for (let t = 0.25; t <= 1; t += 0.25) {
                        const px = Math.pow(1 - t, 3) * sx + 3 * Math.pow(1 - t, 2) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t * x3
                        const py = Math.pow(1 - t, 3) * sy + 3 * Math.pow(1 - t, 2) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t * y3
                        points.push({ x: px, y: py })
                    }
                    currentX = x3
                    currentY = y3
                }
                break
            case 'Q': // Quadratic bezier absolute
                for (let i = 0; i < args.length; i += 4) {
                    const x1 = args[i], y1 = args[i + 1]
                    const x2 = args[i + 2], y2 = args[i + 3]

                    for (let t = 0.25; t <= 1; t += 0.25) {
                        const px = Math.pow(1 - t, 2) * currentX + 2 * (1 - t) * t * x1 + t * t * x2
                        const py = Math.pow(1 - t, 2) * currentY + 2 * (1 - t) * t * y1 + t * t * y2
                        points.push({ x: px, y: py })
                    }
                    currentX = x2
                    currentY = y2
                }
                break
            case 'q': // Quadratic bezier relative
                for (let i = 0; i < args.length; i += 4) {
                    const x1 = currentX + args[i], y1 = currentY + args[i + 1]
                    const x2 = currentX + args[i + 2], y2 = currentY + args[i + 3]

                    const sx = currentX, sy = currentY
                    for (let t = 0.25; t <= 1; t += 0.25) {
                        const px = Math.pow(1 - t, 2) * sx + 2 * (1 - t) * t * x1 + t * t * x2
                        const py = Math.pow(1 - t, 2) * sy + 2 * (1 - t) * t * y1 + t * t * y2
                        points.push({ x: px, y: py })
                    }
                    currentX = x2
                    currentY = y2
                }
                break
            case 'Z':
            case 'z':
                if (startX !== currentX || startY !== currentY) {
                    points.push({ x: startX, y: startY })
                }
                currentX = startX
                currentY = startY
                break
            default:
                // For unsupported commands, just move to end point if present
                if (args.length >= 2) {
                    currentX = type === type.toUpperCase() ? args[args.length - 2] : currentX + args[args.length - 2]
                    currentY = type === type.toUpperCase() ? args[args.length - 1] : currentY + args[args.length - 1]
                    points.push({ x: currentX, y: currentY })
                }
        }
    }

    if (points.length > 0) {
        segments.push({ type: 'free', points })
    }

    return segments
}

// Parse rect element
function parseRect(el: SVGRectElement, baseTransform: { x: number; y: number; rotation: number }): ParsedShape {
    const x = parseFloat(el.getAttribute('x') || '0') + baseTransform.x
    const y = parseFloat(el.getAttribute('y') || '0') + baseTransform.y
    const width = parseFloat(el.getAttribute('width') || '100')
    const height = parseFloat(el.getAttribute('height') || '100')
    const fill = el.getAttribute('fill')
    const stroke = el.getAttribute('stroke')

    return {
        type: 'geo',
        x,
        y,
        rotation: baseTransform.rotation,
        props: {
            geo: 'rectangle',
            w: width,
            h: height,
            color: mapColorToTldraw(stroke || fill),
            fill: mapFillType(fill),
        }
    }
}

// Parse circle element
function parseCircle(el: SVGCircleElement, baseTransform: { x: number; y: number; rotation: number }): ParsedShape {
    const cx = parseFloat(el.getAttribute('cx') || '0')
    const cy = parseFloat(el.getAttribute('cy') || '0')
    const r = parseFloat(el.getAttribute('r') || '50')
    const fill = el.getAttribute('fill')
    const stroke = el.getAttribute('stroke')

    return {
        type: 'geo',
        x: cx - r + baseTransform.x,
        y: cy - r + baseTransform.y,
        rotation: baseTransform.rotation,
        props: {
            geo: 'ellipse',
            w: r * 2,
            h: r * 2,
            color: mapColorToTldraw(stroke || fill),
            fill: mapFillType(fill),
        }
    }
}

// Parse ellipse element
function parseEllipse(el: SVGEllipseElement, baseTransform: { x: number; y: number; rotation: number }): ParsedShape {
    const cx = parseFloat(el.getAttribute('cx') || '0')
    const cy = parseFloat(el.getAttribute('cy') || '0')
    const rx = parseFloat(el.getAttribute('rx') || '50')
    const ry = parseFloat(el.getAttribute('ry') || '50')
    const fill = el.getAttribute('fill')
    const stroke = el.getAttribute('stroke')

    return {
        type: 'geo',
        x: cx - rx + baseTransform.x,
        y: cy - ry + baseTransform.y,
        rotation: baseTransform.rotation,
        props: {
            geo: 'ellipse',
            w: rx * 2,
            h: ry * 2,
            color: mapColorToTldraw(stroke || fill),
            fill: mapFillType(fill),
        }
    }
}

// Parse line element
function parseLine(el: SVGLineElement, baseTransform: { x: number; y: number; rotation: number }): ParsedShape {
    const x1 = parseFloat(el.getAttribute('x1') || '0') + baseTransform.x
    const y1 = parseFloat(el.getAttribute('y1') || '0') + baseTransform.y
    const x2 = parseFloat(el.getAttribute('x2') || '100') + baseTransform.x
    const y2 = parseFloat(el.getAttribute('y2') || '100') + baseTransform.y
    const stroke = el.getAttribute('stroke')

    return {
        type: 'line',
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        rotation: baseTransform.rotation,
        props: {
            color: mapColorToTldraw(stroke),
            points: {
                a1: { id: 'a1', index: 'a1', x: x1 - Math.min(x1, x2), y: y1 - Math.min(y1, y2) },
                a2: { id: 'a2', index: 'a2', x: x2 - Math.min(x1, x2), y: y2 - Math.min(y1, y2) },
            }
        }
    }
}

// Parse text element
function parseText(el: SVGTextElement, baseTransform: { x: number; y: number; rotation: number }): ParsedShape {
    const x = parseFloat(el.getAttribute('x') || '0') + baseTransform.x
    const y = parseFloat(el.getAttribute('y') || '0') + baseTransform.y
    const text = el.textContent || ''
    const fill = el.getAttribute('fill')
    const fontSize = parseFloat(el.getAttribute('font-size') || '16')

    // Map font size to tldraw size
    let size: 's' | 'm' | 'l' | 'xl' = 'm'
    if (fontSize <= 12) size = 's'
    else if (fontSize <= 18) size = 'm'
    else if (fontSize <= 28) size = 'l'
    else size = 'xl'

    return {
        type: 'text',
        x,
        y: y - fontSize, // Adjust for baseline
        rotation: baseTransform.rotation,
        props: {
            text,
            color: mapColorToTldraw(fill),
            size,
            autoSize: true,
        }
    }
}

// Parse path element
function parsePath(el: SVGPathElement, baseTransform: { x: number; y: number; rotation: number }): ParsedShape | null {
    const d = el.getAttribute('d')
    if (!d) return null

    const segments = parsePathToSegments(d)
    if (segments.length === 0 || segments[0].points.length === 0) return null

    const stroke = el.getAttribute('stroke')
    const strokeWidth = parseFloat(el.getAttribute('stroke-width') || '2')

    // Calculate bounds
    let minX = Infinity, minY = Infinity
    for (const seg of segments) {
        for (const pt of seg.points) {
            minX = Math.min(minX, pt.x)
            minY = Math.min(minY, pt.y)
        }
    }

    // Normalize points relative to shape origin
    const normalizedSegments = segments.map(seg => ({
        ...seg,
        points: seg.points.map(pt => ({
            x: pt.x - minX,
            y: pt.y - minY,
            z: 0.5 // Pressure
        }))
    }))

    // Map stroke width to tldraw size
    let size: 's' | 'm' | 'l' | 'xl' = 'm'
    if (strokeWidth <= 1) size = 's'
    else if (strokeWidth <= 3) size = 'm'
    else if (strokeWidth <= 6) size = 'l'
    else size = 'xl'

    return {
        type: 'draw',
        x: minX + baseTransform.x,
        y: minY + baseTransform.y,
        rotation: baseTransform.rotation,
        props: {
            color: mapColorToTldraw(stroke),
            size,
            segments: normalizedSegments,
            isComplete: true,
            isClosed: false,
            isPen: false,
        }
    }
}

// Process SVG element and children recursively
function processElement(
    el: Element,
    shapes: ParsedShape[],
    parentTransform: { x: number; y: number; rotation: number }
): void {
    const localTransform = parseTransform(el.getAttribute('transform'))
    const combinedTransform = {
        x: parentTransform.x + localTransform.x,
        y: parentTransform.y + localTransform.y,
        rotation: parentTransform.rotation + localTransform.rotation,
    }

    const tagName = el.tagName.toLowerCase()

    switch (tagName) {
        case 'rect':
            shapes.push(parseRect(el as SVGRectElement, combinedTransform))
            break
        case 'circle':
            shapes.push(parseCircle(el as SVGCircleElement, combinedTransform))
            break
        case 'ellipse':
            shapes.push(parseEllipse(el as SVGEllipseElement, combinedTransform))
            break
        case 'line':
            shapes.push(parseLine(el as SVGLineElement, combinedTransform))
            break
        case 'text':
            shapes.push(parseText(el as SVGTextElement, combinedTransform))
            break
        case 'path': {
            const pathShape = parsePath(el as SVGPathElement, combinedTransform)
            if (pathShape) shapes.push(pathShape)
            break
        }
        case 'g':
        case 'svg':
            // Process children
            for (const child of Array.from(el.children)) {
                processElement(child, shapes, combinedTransform)
            }
            break
        case 'polygon':
        case 'polyline':
        case 'image':
        case 'use':
        case 'clippath':
        case 'mask':
        case 'defs':
        case 'style':
        case 'lineargradient':
        case 'radialgradient':
        case 'pattern':
            console.warn(`[SVG Import] Unsupported element: <${tagName}>`)
            break
        default:
            // Skip metadata elements silently
            if (!['title', 'desc', 'metadata'].includes(tagName)) {
                console.warn(`[SVG Import] Unknown element: <${tagName}>`)
            }
    }
}

/**
 * Parse SVG string and import shapes into tldraw editor
 */
export function importSvgToEditor(editor: Editor, svgString: string): TLShapeId[] {
    const parser = new DOMParser()
    const doc = parser.parseFromString(svgString, 'image/svg+xml')

    // Check for parse errors
    const parseError = doc.querySelector('parsererror')
    if (parseError) {
        console.error('[SVG Import] Parse error:', parseError.textContent)
        throw new Error('Invalid SVG file')
    }

    const svgEl = doc.querySelector('svg')
    if (!svgEl) {
        throw new Error('No SVG element found')
    }

    const shapes: ParsedShape[] = []

    // Get viewBox for potential offset
    const viewBox = svgEl.getAttribute('viewBox')
    let viewBoxOffset = { x: 0, y: 0 }
    if (viewBox) {
        const [vbX, vbY] = viewBox.split(/[\s,]+/).map(parseFloat)
        viewBoxOffset = { x: -vbX || 0, y: -vbY || 0 }
    }

    // Process all child elements
    for (const child of Array.from(svgEl.children)) {
        processElement(child, shapes, { x: viewBoxOffset.x, y: viewBoxOffset.y, rotation: 0 })
    }

    if (shapes.length === 0) {
        console.warn('[SVG Import] No supported shapes found in SVG')
        return []
    }

    // Get center of viewport for placement
    const viewportCenter = editor.getViewportPageBounds().center

    // Calculate bounds of all shapes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const shape of shapes) {
        minX = Math.min(minX, shape.x)
        minY = Math.min(minY, shape.y)
        const w = shape.props.w || 100
        const h = shape.props.h || 100
        maxX = Math.max(maxX, shape.x + w)
        maxY = Math.max(maxY, shape.y + h)
    }

    // Offset to center shapes in viewport
    const offsetX = viewportCenter.x - (minX + maxX) / 2
    const offsetY = viewportCenter.y - (minY + maxY) / 2

    // Create shapes in tldraw
    const createdIds: TLShapeId[] = []

    for (const shape of shapes) {
        const id = createShapeId()
        createdIds.push(id)

        editor.createShape({
            id,
            type: shape.type,
            x: shape.x + offsetX,
            y: shape.y + offsetY,
            rotation: shape.rotation || 0,
            props: shape.props,
        })
    }

    // Select all created shapes
    if (createdIds.length > 0) {
        editor.select(...createdIds)
    }

    console.log(`[SVG Import] Created ${createdIds.length} shapes`)
    return createdIds
}

/**
 * Open file picker and import SVG
 */
export function triggerSvgImport(editor: Editor): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.svg,image/svg+xml'

    input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return

        try {
            const svgString = await file.text()
            const ids = importSvgToEditor(editor, svgString)

            if (ids.length === 0) {
                alert('No supported shapes found in SVG file.\n\nSupported: rect, circle, ellipse, line, path, text')
            }
        } catch (err) {
            console.error('[SVG Import] Error:', err)
            alert('Failed to import SVG: ' + (err as Error).message)
        }
    }

    input.click()
}
