/**
 * Math2SVG Engine
 * Converts mathematical equations (parametric and y(x) functions) to SVG paths
 */

export interface EquationOptions {
    // Equation type
    type: 'parametric' | 'function'
    
    // For y(x) functions
    expression?: string // e.g., "x^2", "sin(x)", "x^3 - 2*x"
    
    // For parametric equations
    xExpression?: string // e.g., "cos(t)"
    yExpression?: string // e.g., "sin(t)"
    
    // Range
    tMin?: number // For parametric (parameter range)
    tMax?: number
    xMin?: number // For functions (x range)
    xMax?: number
    
    // Sampling
    samples?: number // Number of points to sample
    
    // Scaling
    scaleX?: number // Visual scaling
    scaleY?: number
    
    // Offset/translation
    offsetX?: number
    offsetY?: number
    
    // Coordinate system
    flipY?: boolean // SVG has inverted Y, set true to flip
    
    // Visual Options
    showAxes?: boolean
    showNumbers?: boolean
    showGrid?: boolean
    
    // Colors
    axisColor?: string
    gridColor?: string
    strokeColor?: string
    
    // Font Options
    fontSize?: number
    fontFamily?: string
}

export interface Point {
    x: number
    y: number
}

/**
 * Evaluates a mathematical expression
 * Supports: +, -, *, /, ^, sin, cos, tan, sqrt, abs, exp, ln, log
 */
function evaluateExpression(expr: string, variable: string, value: number): number {
    // Replace variable with value
    let expression = expr.replace(new RegExp(variable, 'g'), `(${value})`)
    
    // Replace mathematical functions
    expression = expression
        .replace(/sin\(/g, 'Math.sin(')
        .replace(/cos\(/g, 'Math.cos(')
        .replace(/tan\(/g, 'Math.tan(')
        .replace(/sqrt\(/g, 'Math.sqrt(')
        .replace(/abs\(/g, 'Math.abs(')
        .replace(/exp\(/g, 'Math.exp(')
        .replace(/ln\(/g, 'Math.log(')
        .replace(/log\(/g, 'Math.log10(')
        .replace(/pi/g, 'Math.PI')
        .replace(/e(?![a-z])/g, 'Math.E')
        .replace(/\^/g, '**') // Power operator
    
    try {
        // Use Function constructor for safe evaluation
        const func = new Function('return ' + expression)
        const result = func()
        return isFinite(result) ? result : NaN
    } catch (e) {
        console.error('Expression evaluation error:', e)
        return NaN
    }
}

/**
 * Generate points for a y(x) function
 */
export function generateFunctionPoints(options: EquationOptions): Point[] {
    const {
        expression = 'x',
        xMin = -10,
        xMax = 10,
        samples = 200,
        scaleX = 20,
        scaleY = 20,
        offsetX = 0,
        offsetY = 0,
        flipY = true
    } = options
    
    const points: Point[] = []
    const step = (xMax - xMin) / samples
    
    for (let i = 0; i <= samples; i++) {
        const x = xMin + i * step
        const y = evaluateExpression(expression, 'x', x)
        
        if (!isNaN(y) && isFinite(y)) {
            points.push({
                x: x * scaleX + offsetX,
                y: (flipY ? -y : y) * scaleY + offsetY
            })
        }
    }
    
    return points
}

/**
 * Generate points for parametric equations
 */
export function generateParametricPoints(options: EquationOptions): Point[] {
    const {
        xExpression = 'cos(t)',
        yExpression = 'sin(t)',
        tMin = 0,
        tMax = 2 * Math.PI,
        samples = 200,
        scaleX = 50,
        scaleY = 50,
        offsetX = 0,
        offsetY = 0,
        flipY = true
    } = options
    
    const points: Point[] = []
    const step = (tMax - tMin) / samples
    
    for (let i = 0; i <= samples; i++) {
        const t = tMin + i * step
        const x = evaluateExpression(xExpression, 't', t)
        const y = evaluateExpression(yExpression, 't', t)
        
        if (!isNaN(x) && !isNaN(y) && isFinite(x) && isFinite(y)) {
            points.push({
                x: x * scaleX + offsetX,
                y: (flipY ? -y : y) * scaleY + offsetY
            })
        }
    }
    
    return points
}

/**
 * Convert points to SVG path string
 */
export function pointsToSVGPath(points: Point[]): string {
    if (points.length === 0) return ''
    
    let path = `M ${points[0].x} ${points[0].y}`
    
    for (let i = 1; i < points.length; i++) {
        path += ` L ${points[i].x} ${points[i].y}`
    }
    
    return path
}

/**
 * Convert points to smooth SVG path using cubic bezier curves
 */
export function pointsToSmoothSVGPath(points: Point[]): string {
    if (points.length === 0) return ''
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
    
    let path = `M ${points[0].x} ${points[0].y}`
    
    // Use Catmull-Rom to Bezier conversion for smooth curves
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(i - 1, 0)]
        const p1 = points[i]
        const p2 = points[i + 1]
        const p3 = points[Math.min(i + 2, points.length - 1)]
        
        // Calculate control points
        const cp1x = p1.x + (p2.x - p0.x) / 6
        const cp1y = p1.y + (p2.y - p0.y) / 6
        const cp2x = p2.x - (p3.x - p1.x) / 6
        const cp2y = p2.y - (p3.y - p1.y) / 6
        
        path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
    }
    
    return path
}

/**
 * Main function: Convert equation to SVG path
 */
export function math2svg(options: EquationOptions): string {
    const points = options.type === 'parametric'
        ? generateParametricPoints(options)
        : generateFunctionPoints(options)
    
    return pointsToSmoothSVGPath(points)
}

/**
 * Generate full SVG string including axes and numbers
 */
export function math2svgFull(options: EquationOptions): string {
    const {
        scaleX = 40,
        scaleY = 40,
        offsetX = 250,
        offsetY = 250,
        showAxes = true,
        showNumbers = true,
        showGrid = false,
        axisColor = '#525252',
        gridColor = '#333',
        strokeColor = '#60a5fa',
        fontSize = 8,
        fontFamily = 'monospace'
    } = options

    const path = math2svg(options)
    let content = ''

    // Grid (aligned with axes by using offsetX/offsetY)
    if (showGrid) {
        const gridOffsetX = offsetX % scaleX
        const gridOffsetY = offsetY % scaleY
        content += `<defs><pattern id="grid-pattern" x="${gridOffsetX}" y="${gridOffsetY}" width="${scaleX}" height="${scaleY}" patternUnits="userSpaceOnUse"><path d="M ${scaleX} 0 L 0 0 0 ${scaleY}" fill="none" stroke="${gridColor}" stroke-width="0.5"/></pattern></defs>`
        content += `<rect width="500" height="500" fill="url(#grid-pattern)" />`
    }

    // Axes
    if (showAxes) {
        content += `<line x1="0" y1="${offsetY}" x2="500" y2="${offsetY}" stroke="${axisColor}" stroke-width="1.5" />`
        content += `<line x1="${offsetX}" y1="0" x2="${offsetX}" y2="500" stroke="${axisColor}" stroke-width="1.5" />`
        
        // Numbers
        if (showNumbers) {
            // X-axis tick marks and numbers
            if (scaleX > 20) {
                for (let x = offsetX % scaleX; x < 500; x += scaleX) {
                    const val = Math.round((x - offsetX) / scaleX)
                    if (val === 0) continue
                    content += `<line x1="${x}" y1="${offsetY - 3}" x2="${x}" y2="${offsetY + 3}" stroke="${axisColor}" stroke-width="1" />`
                    content += `<text x="${x}" y="${offsetY + fontSize + 4}" font-size="${fontSize}" fill="${axisColor}" text-anchor="middle" font-family="${fontFamily}">${val}</text>`
                }
            }
            
            // Y-axis tick marks and numbers
            if (scaleY > 20) {
                for (let y = offsetY % scaleY; y < 500; y += scaleY) {
                    const val = Math.round((offsetY - y) / scaleY)
                    if (val === 0) continue
                    content += `<line x1="${offsetX - 3}" y1="${y}" x2="${offsetX + 3}" y2="${y}" stroke="${axisColor}" stroke-width="1" />`
                    content += `<text x="${offsetX - 6}" y="${y + fontSize / 3}" font-size="${fontSize}" fill="${axisColor}" text-anchor="end" font-family="${fontFamily}">${val}</text>`
                }
            }
            content += `<text x="${offsetX - 4}" y="${offsetY + fontSize + 4}" font-size="${fontSize}" fill="${axisColor}" text-anchor="end" font-family="${fontFamily}">0</text>`
        }
    }

    // Curve
    content += `<path d="${path}" fill="none" stroke="${strokeColor}" stroke-width="3" stroke-linecap="round" />`

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="500" height="500" style="background-color: transparent">${content}</svg>`
}

/**
 * Get bounding box of points
 */
export function getBoundingBox(points: Point[]): { minX: number, maxX: number, minY: number, maxY: number, width: number, height: number } {
    if (points.length === 0) {
        return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 }
    }
    
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    
    for (const p of points) {
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minY = Math.min(minY, p.y)
        maxY = Math.max(maxY, p.y)
    }
    
    return {
        minX,
        maxX,
        minY,
        maxY,
        width: maxX - minX,
        height: maxY - minY
    }
}
