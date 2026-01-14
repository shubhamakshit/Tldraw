/**
 * ColorRmSvgImporter - Browser-compatible SVG to ColorRM converter
 *
 * Converts SVG files to ColorRM format for import into the drawing app.
 * Supports: paths, shapes, text, images, masks, transforms
 *
 * Usage:
 *   import { ColorRmSvgImporter } from './modules/ColorRmSvgImporter.js';
 *   const result = await ColorRmSvgImporter.importSvg(svgString);
 *   // result = { metadata: {...}, history: [...] }
 */

export const ColorRmSvgImporter = {
    // Configuration
    CONFIG: {
        defaultStroke: '#000000',
        defaultFill: 'transparent',
        base64WarnSize: 500000
    },

    // Counter for unique IDs
    _idCounter: 0,

    // Mask definitions storage
    _maskDefinitions: {},

    /**
     * Generate unique ID
     */
    generateId() {
        return `svg_${Date.now()}_${++this._idCounter}`;
    },

    /**
     * Parse color string to hex
     */
    parseColor(colorStr) {
        if (!colorStr || colorStr === 'none') return null;
        if (colorStr.startsWith('#')) return colorStr;
        if (colorStr.startsWith('rgb')) {
            const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (match) {
                const r = parseInt(match[1]).toString(16).padStart(2, '0');
                const g = parseInt(match[2]).toString(16).padStart(2, '0');
                const b = parseInt(match[3]).toString(16).padStart(2, '0');
                return `#${r}${g}${b}`;
            }
        }
        // Named colors
        const colors = {
            black: '#000000', white: '#ffffff', red: '#ff0000',
            green: '#00ff00', blue: '#0000ff', yellow: '#ffff00',
            orange: '#ffa500', purple: '#800080', pink: '#ffc0cb'
        };
        return colors[colorStr.toLowerCase()] || colorStr;
    },

    /**
     * Parse opacity value
     */
    parseOpacity(val) {
        if (val === undefined || val === null || val === '') return 1;
        const num = parseFloat(val);
        return isNaN(num) ? 1 : Math.max(0, Math.min(1, num));
    },

    /**
     * Parse transform attribute to matrix
     */
    parseTransform(transformStr) {
        if (!transformStr) return [1, 0, 0, 1, 0, 0];

        let matrix = [1, 0, 0, 1, 0, 0];
        const transforms = transformStr.match(/(\w+)\(([^)]+)\)/g) || [];

        for (const t of transforms) {
            const match = t.match(/(\w+)\(([^)]+)\)/);
            if (!match) continue;

            const type = match[1];
            const values = match[2].split(/[\s,]+/).map(parseFloat);

            let m;
            switch (type) {
                case 'matrix':
                    m = values.length >= 6 ? values.slice(0, 6) : [1, 0, 0, 1, 0, 0];
                    break;
                case 'translate':
                    m = [1, 0, 0, 1, values[0] || 0, values[1] || 0];
                    break;
                case 'scale':
                    const sx = values[0] || 1;
                    const sy = values.length > 1 ? values[1] : sx;
                    m = [sx, 0, 0, sy, 0, 0];
                    break;
                case 'rotate':
                    const angle = (values[0] || 0) * Math.PI / 180;
                    const cos = Math.cos(angle);
                    const sin = Math.sin(angle);
                    if (values.length === 3) {
                        const cx = values[1], cy = values[2];
                        m = [cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos];
                    } else {
                        m = [cos, sin, -sin, cos, 0, 0];
                    }
                    break;
                default:
                    continue;
            }
            matrix = this.multiplyMatrix(matrix, m);
        }

        return matrix;
    },

    /**
     * Multiply two transformation matrices
     */
    multiplyMatrix(a, b) {
        return [
            a[0] * b[0] + a[2] * b[1],
            a[1] * b[0] + a[3] * b[1],
            a[0] * b[2] + a[2] * b[3],
            a[1] * b[2] + a[3] * b[3],
            a[0] * b[4] + a[2] * b[5] + a[4],
            a[1] * b[4] + a[3] * b[5] + a[5]
        ];
    },

    /**
     * Transform a point using a matrix
     */
    transformPoint(x, y, matrix) {
        return {
            x: matrix[0] * x + matrix[2] * y + matrix[4],
            y: matrix[1] * x + matrix[3] * y + matrix[5]
        };
    },

    /**
     * Get scale factor from matrix
     */
    getMatrixScale(matrix) {
        return Math.sqrt(matrix[0] * matrix[0] + matrix[1] * matrix[1]);
    },

    /**
     * Parse SVG path d attribute to points
     */
    parsePathD(d) {
        if (!d) return [];

        const points = [];
        let x = 0, y = 0;
        let startX = 0, startY = 0;

        const commands = d.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g) || [];

        for (const cmd of commands) {
            const type = cmd[0];
            const args = cmd.slice(1).trim().split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));

            switch (type) {
                case 'M':
                    x = args[0]; y = args[1];
                    startX = x; startY = y;
                    points.push({ x, y });
                    for (let i = 2; i < args.length; i += 2) {
                        x = args[i]; y = args[i + 1];
                        points.push({ x, y });
                    }
                    break;
                case 'm':
                    x += args[0]; y += args[1];
                    startX = x; startY = y;
                    points.push({ x, y });
                    for (let i = 2; i < args.length; i += 2) {
                        x += args[i]; y += args[i + 1];
                        points.push({ x, y });
                    }
                    break;
                case 'L':
                    for (let i = 0; i < args.length; i += 2) {
                        x = args[i]; y = args[i + 1];
                        points.push({ x, y });
                    }
                    break;
                case 'l':
                    for (let i = 0; i < args.length; i += 2) {
                        x += args[i]; y += args[i + 1];
                        points.push({ x, y });
                    }
                    break;
                case 'H':
                    for (const arg of args) {
                        x = arg;
                        points.push({ x, y });
                    }
                    break;
                case 'h':
                    for (const arg of args) {
                        x += arg;
                        points.push({ x, y });
                    }
                    break;
                case 'V':
                    for (const arg of args) {
                        y = arg;
                        points.push({ x, y });
                    }
                    break;
                case 'v':
                    for (const arg of args) {
                        y += arg;
                        points.push({ x, y });
                    }
                    break;
                case 'C':
                    for (let i = 0; i < args.length; i += 6) {
                        // Cubic bezier - sample points
                        const x1 = args[i], y1 = args[i + 1];
                        const x2 = args[i + 2], y2 = args[i + 3];
                        const x3 = args[i + 4], y3 = args[i + 5];
                        for (let t = 0.25; t <= 1; t += 0.25) {
                            const px = Math.pow(1 - t, 3) * x + 3 * Math.pow(1 - t, 2) * t * x1 +
                                3 * (1 - t) * t * t * x2 + t * t * t * x3;
                            const py = Math.pow(1 - t, 3) * y + 3 * Math.pow(1 - t, 2) * t * y1 +
                                3 * (1 - t) * t * t * y2 + t * t * t * y3;
                            points.push({ x: px, y: py });
                        }
                        x = x3; y = y3;
                    }
                    break;
                case 'c':
                    for (let i = 0; i < args.length; i += 6) {
                        const x1 = x + args[i], y1 = y + args[i + 1];
                        const x2 = x + args[i + 2], y2 = y + args[i + 3];
                        const x3 = x + args[i + 4], y3 = y + args[i + 5];
                        for (let t = 0.25; t <= 1; t += 0.25) {
                            const px = Math.pow(1 - t, 3) * x + 3 * Math.pow(1 - t, 2) * t * x1 +
                                3 * (1 - t) * t * t * x2 + t * t * t * x3;
                            const py = Math.pow(1 - t, 3) * y + 3 * Math.pow(1 - t, 2) * t * y1 +
                                3 * (1 - t) * t * t * y2 + t * t * t * y3;
                            points.push({ x: px, y: py });
                        }
                        x = x3; y = y3;
                    }
                    break;
                case 'Q':
                    for (let i = 0; i < args.length; i += 4) {
                        const x1 = args[i], y1 = args[i + 1];
                        const x2 = args[i + 2], y2 = args[i + 3];
                        for (let t = 0.33; t <= 1; t += 0.33) {
                            const px = Math.pow(1 - t, 2) * x + 2 * (1 - t) * t * x1 + t * t * x2;
                            const py = Math.pow(1 - t, 2) * y + 2 * (1 - t) * t * y1 + t * t * y2;
                            points.push({ x: px, y: py });
                        }
                        x = x2; y = y2;
                    }
                    break;
                case 'q':
                    for (let i = 0; i < args.length; i += 4) {
                        const x1 = x + args[i], y1 = y + args[i + 1];
                        const x2 = x + args[i + 2], y2 = y + args[i + 3];
                        for (let t = 0.33; t <= 1; t += 0.33) {
                            const px = Math.pow(1 - t, 2) * x + 2 * (1 - t) * t * x1 + t * t * x2;
                            const py = Math.pow(1 - t, 2) * y + 2 * (1 - t) * t * y1 + t * t * y2;
                            points.push({ x: px, y: py });
                        }
                        x = x2; y = y2;
                    }
                    break;
                case 'Z':
                case 'z':
                    if (startX !== x || startY !== y) {
                        points.push({ x: startX, y: startY });
                    }
                    x = startX; y = startY;
                    break;
            }
        }

        return points;
    },

    /**
     * Main import function
     * @param {string} svgContent - SVG string content
     * @returns {Promise<{metadata: Object, history: Array}>}
     */
    async importSvg(svgContent) {
        this._idCounter = 0;
        this._maskDefinitions = {};

        const history = [];
        const warnings = [];

        // Parse SVG
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgContent, 'image/svg+xml');
        const svg = doc.querySelector('svg');

        if (!svg) {
            return { metadata: { error: 'No SVG element found' }, history: [] };
        }

        // Get dimensions
        const viewBox = svg.getAttribute('viewBox');
        let svgWidth = parseFloat(svg.getAttribute('width')) || 800;
        let svgHeight = parseFloat(svg.getAttribute('height')) || 600;
        let viewBoxData = null;

        if (viewBox) {
            const parts = viewBox.split(/[\s,]+/).map(parseFloat);
            viewBoxData = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
            svgWidth = svgWidth || viewBoxData.w;
            svgHeight = svgHeight || viewBoxData.h;
        }

        // First pass: collect mask definitions
        this._collectMasks(svg);

        // Second pass: collect all elements
        const elements = this._collectElements(svg, [1, 0, 0, 1, 0, 0], null);

        // Convert elements
        for (const elem of elements) {
            try {
                const item = this._convertElement(elem, svgWidth, svgHeight);
                if (item) history.push(item);
            } catch (e) {
                warnings.push(`${elem.tagName} conversion error: ${e.message}`);
            }
        }

        // Detect background images
        const TOLERANCE = 0.05;
        for (const item of history) {
            if (item.tool === 'image') {
                const widthRatio = item.w / svgWidth;
                const heightRatio = item.h / svgHeight;
                const xNearZero = Math.abs(item.x) < svgWidth * TOLERANCE;
                const yNearZero = Math.abs(item.y) < svgHeight * TOLERANCE;
                const widthMatch = widthRatio > (1 - TOLERANCE) && widthRatio < (1 + TOLERANCE);
                const heightMatch = heightRatio > (1 - TOLERANCE) && heightRatio < (1 + TOLERANCE);

                if (xNearZero && yNearZero && widthMatch && heightMatch) {
                    item.isBackground = true;
                }
            }
        }

        // Statistics
        const stats = { pen: 0, highlighter: 0, shape: 0, text: 0, image: 0 };
        history.forEach(item => { if (stats[item.tool] !== undefined) stats[item.tool]++; });

        const backgroundCount = history.filter(i => i.isBackground).length;

        return {
            metadata: {
                version: 2,
                sourceType: 'svg',
                width: svgWidth,
                height: svgHeight,
                viewBox: viewBoxData,
                elementCount: history.length,
                statistics: stats,
                backgroundCount
            },
            history
        };
    },

    /**
     * Collect mask definitions from SVG
     */
    _collectMasks(svg) {
        const masks = svg.querySelectorAll('mask');
        for (const mask of masks) {
            const id = mask.getAttribute('id');
            if (!id) continue;

            const image = mask.querySelector('image');
            if (image) {
                const href = image.getAttribute('href') || image.getAttribute('xlink:href');
                if (href) {
                    this._maskDefinitions[id] = {
                        imageData: href,
                        type: 'luminance'
                    };
                }
            }
        }
    },

    /**
     * Recursively collect elements from SVG
     */
    _collectElements(parent, transform, maskId) {
        const elements = [];
        const drawableTags = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image'];

        for (const child of parent.children) {
            const tagName = child.tagName.toLowerCase();

            // Skip defs, mask, clippath, style, etc.
            if (['defs', 'mask', 'clippath', 'style', 'script', 'title', 'desc'].includes(tagName)) {
                continue;
            }

            // Parse element transform
            const elemTransform = this.parseTransform(child.getAttribute('transform'));
            const combinedTransform = this.multiplyMatrix(transform, elemTransform);

            // Check for mask on groups
            let currentMaskId = maskId;
            const maskAttr = child.getAttribute('mask');
            if (maskAttr) {
                const match = maskAttr.match(/url\(#([^)]+)\)/);
                if (match) currentMaskId = match[1];
            }

            if (tagName === 'g' || tagName === 'svg') {
                // Recurse into groups
                const childElements = this._collectElements(child, combinedTransform, currentMaskId);
                elements.push(...childElements);
            } else if (drawableTags.includes(tagName)) {
                elements.push({
                    element: child,
                    tagName,
                    transform: combinedTransform,
                    maskId: currentMaskId
                });
            }
        }

        return elements;
    },

    /**
     * Convert a single element to ColorRM format
     */
    _convertElement(elemData, docWidth, docHeight) {
        const { element, tagName, transform, maskId } = elemData;

        switch (tagName) {
            case 'path':
                return this._convertPath(element, transform);
            case 'rect':
                return this._convertRect(element, transform);
            case 'circle':
            case 'ellipse':
                return this._convertEllipse(element, transform);
            case 'line':
                return this._convertLine(element, transform);
            case 'polyline':
            case 'polygon':
                return this._convertPolyline(element, transform, tagName === 'polygon');
            case 'text':
                return this._convertText(element, transform);
            case 'image':
                return this._convertImage(element, transform, maskId);
            default:
                return null;
        }
    },

    /**
     * Get attribute with style fallback
     */
    _getAttr(element, name) {
        let val = element.getAttribute(name);
        if (val) return val;

        // Check style attribute
        const style = element.getAttribute('style');
        if (style) {
            const match = style.match(new RegExp(`${name}:\\s*([^;]+)`));
            if (match) return match[1].trim();
        }

        return null;
    },

    /**
     * Convert path element
     */
    _convertPath(element, transform) {
        const d = element.getAttribute('d');
        if (!d) return null;

        const pts = this.parsePathD(d);
        if (pts.length < 2) return null;

        // Transform points
        const transformedPts = pts.map(p => this.transformPoint(p.x, p.y, transform));

        const stroke = this._getAttr(element, 'stroke');
        const fill = this._getAttr(element, 'fill');
        const strokeWidth = parseFloat(this._getAttr(element, 'stroke-width')) || 1;
        const opacity = this.parseOpacity(this._getAttr(element, 'opacity'));
        const strokeOpacity = this.parseOpacity(this._getAttr(element, 'stroke-opacity'));

        // Determine tool type
        let tool = 'pen';
        const effectiveOpacity = opacity * strokeOpacity;
        if (effectiveOpacity < 0.6 && effectiveOpacity > 0.1) {
            tool = 'highlighter';
        }

        return {
            id: this.generateId(),
            lastMod: Date.now(),
            tool,
            pts: transformedPts,
            color: this.parseColor(stroke) || this.CONFIG.defaultStroke,
            size: strokeWidth * this.getMatrixScale(transform),
            opacity: effectiveOpacity < 1 ? effectiveOpacity : undefined,
            lineCap: this._getAttr(element, 'stroke-linecap') || 'round',
            lineJoin: this._getAttr(element, 'stroke-linejoin') || 'round',
            deleted: false
        };
    },

    /**
     * Convert rect element
     */
    _convertRect(element, transform) {
        const x = parseFloat(element.getAttribute('x')) || 0;
        const y = parseFloat(element.getAttribute('y')) || 0;
        const w = parseFloat(element.getAttribute('width')) || 0;
        const h = parseFloat(element.getAttribute('height')) || 0;

        if (w === 0 || h === 0) return null;

        const topLeft = this.transformPoint(x, y, transform);
        const bottomRight = this.transformPoint(x + w, y + h, transform);

        return {
            id: this.generateId(),
            lastMod: Date.now(),
            tool: 'shape',
            shapeType: 'rectangle',
            x: topLeft.x,
            y: topLeft.y,
            w: bottomRight.x - topLeft.x,
            h: bottomRight.y - topLeft.y,
            fill: this.parseColor(this._getAttr(element, 'fill')) || 'transparent',
            border: this.parseColor(this._getAttr(element, 'stroke')) || '#000000',
            width: parseFloat(this._getAttr(element, 'stroke-width')) || 1,
            fillOpacity: this.parseOpacity(this._getAttr(element, 'fill-opacity')),
            borderOpacity: this.parseOpacity(this._getAttr(element, 'stroke-opacity')),
            deleted: false
        };
    },

    /**
     * Convert circle/ellipse element
     */
    _convertEllipse(element, transform) {
        let cx, cy, rx, ry;

        if (element.tagName.toLowerCase() === 'circle') {
            cx = parseFloat(element.getAttribute('cx')) || 0;
            cy = parseFloat(element.getAttribute('cy')) || 0;
            rx = ry = parseFloat(element.getAttribute('r')) || 0;
        } else {
            cx = parseFloat(element.getAttribute('cx')) || 0;
            cy = parseFloat(element.getAttribute('cy')) || 0;
            rx = parseFloat(element.getAttribute('rx')) || 0;
            ry = parseFloat(element.getAttribute('ry')) || 0;
        }

        if (rx === 0 || ry === 0) return null;

        const topLeft = this.transformPoint(cx - rx, cy - ry, transform);
        const bottomRight = this.transformPoint(cx + rx, cy + ry, transform);

        return {
            id: this.generateId(),
            lastMod: Date.now(),
            tool: 'shape',
            shapeType: 'circle',
            x: topLeft.x,
            y: topLeft.y,
            w: bottomRight.x - topLeft.x,
            h: bottomRight.y - topLeft.y,
            fill: this.parseColor(this._getAttr(element, 'fill')) || 'transparent',
            border: this.parseColor(this._getAttr(element, 'stroke')) || '#000000',
            width: parseFloat(this._getAttr(element, 'stroke-width')) || 1,
            deleted: false
        };
    },

    /**
     * Convert line element
     */
    _convertLine(element, transform) {
        const x1 = parseFloat(element.getAttribute('x1')) || 0;
        const y1 = parseFloat(element.getAttribute('y1')) || 0;
        const x2 = parseFloat(element.getAttribute('x2')) || 0;
        const y2 = parseFloat(element.getAttribute('y2')) || 0;

        const p1 = this.transformPoint(x1, y1, transform);
        const p2 = this.transformPoint(x2, y2, transform);

        return {
            id: this.generateId(),
            lastMod: Date.now(),
            tool: 'pen',
            pts: [p1, p2],
            color: this.parseColor(this._getAttr(element, 'stroke')) || this.CONFIG.defaultStroke,
            size: parseFloat(this._getAttr(element, 'stroke-width')) || 1,
            deleted: false
        };
    },

    /**
     * Convert polyline/polygon element
     */
    _convertPolyline(element, transform, isClosed) {
        const pointsStr = element.getAttribute('points');
        if (!pointsStr) return null;

        const coords = pointsStr.trim().split(/[\s,]+/).map(parseFloat);
        const pts = [];
        for (let i = 0; i < coords.length - 1; i += 2) {
            const p = this.transformPoint(coords[i], coords[i + 1], transform);
            pts.push(p);
        }

        if (pts.length < 2) return null;

        if (isClosed && (pts[0].x !== pts[pts.length - 1].x || pts[0].y !== pts[pts.length - 1].y)) {
            pts.push({ ...pts[0] });
        }

        return {
            id: this.generateId(),
            lastMod: Date.now(),
            tool: 'pen',
            pts,
            color: this.parseColor(this._getAttr(element, 'stroke')) || this.CONFIG.defaultStroke,
            size: parseFloat(this._getAttr(element, 'stroke-width')) || 1,
            deleted: false
        };
    },

    /**
     * Convert text element
     */
    _convertText(element, transform) {
        const text = element.textContent.trim();
        if (!text) return null;

        // Get position from tspan or text element
        let x = 0, y = 0;
        const tspan = element.querySelector('tspan');
        if (tspan) {
            const tspanX = tspan.getAttribute('x');
            const tspanY = tspan.getAttribute('y');
            x = parseFloat(tspanX?.split(/\s+/)[0]) || 0;
            y = parseFloat(tspanY) || 0;
        } else {
            x = parseFloat(element.getAttribute('x')) || 0;
            y = parseFloat(element.getAttribute('y')) || 0;
        }

        const pos = this.transformPoint(x, y, transform);
        const fontSize = parseFloat(this._getAttr(element, 'font-size')) || 16;
        const fontFamily = this._getAttr(element, 'font-family');
        const fill = this._getAttr(element, 'fill');
        const elemTransform = element.getAttribute('transform');

        const result = {
            id: this.generateId(),
            lastMod: Date.now(),
            tool: 'text',
            text,
            x: pos.x,
            y: pos.y,
            size: fontSize * this.getMatrixScale(transform),
            color: this.parseColor(fill) || this.CONFIG.defaultStroke,
            fontFamily: fontFamily || 'sans-serif',
            w: text.length * fontSize * 0.6,
            h: fontSize * 1.2,
            deleted: false
        };

        // Store original SVG data for precise rendering
        if (elemTransform || element.innerHTML.includes('<tspan')) {
            result.svgData = {
                transform: elemTransform,
                xmlSpace: element.getAttribute('xml:space'),
                fontSize: this._getAttr(element, 'font-size'),
                fontFamily: fontFamily,
                fill: fill,
                innerContent: element.innerHTML
            };
        }

        return result;
    },

    /**
     * Convert image element
     */
    _convertImage(element, transform, maskId) {
        const x = parseFloat(element.getAttribute('x')) || 0;
        const y = parseFloat(element.getAttribute('y')) || 0;
        const w = parseFloat(element.getAttribute('width')) || 0;
        const h = parseFloat(element.getAttribute('height')) || 0;
        const href = element.getAttribute('href') || element.getAttribute('xlink:href');

        if (!href || w === 0 || h === 0) return null;

        const topLeft = this.transformPoint(x, y, transform);
        const bottomRight = this.transformPoint(x + w, y + h, transform);

        const result = {
            id: this.generateId(),
            lastMod: Date.now(),
            tool: 'image',
            x: topLeft.x,
            y: topLeft.y,
            w: Math.abs(bottomRight.x - topLeft.x),
            h: Math.abs(bottomRight.y - topLeft.y),
            src: href,
            rotation: 0,
            deleted: false
        };

        // Add mask data if present
        if (maskId && this._maskDefinitions[maskId]) {
            result.mask = {
                id: maskId,
                type: this._maskDefinitions[maskId].type,
                src: this._maskDefinitions[maskId].imageData
            };
        }

        return result;
    },

    /**
     * Import SVG from File object
     * @param {File} file - SVG file
     * @returns {Promise<{metadata: Object, history: Array}>}
     */
    async importSvgFile(file) {
        const content = await file.text();
        return this.importSvg(content);
    }
};

// Make available globally for non-module usage
if (typeof window !== 'undefined') {
    window.ColorRmSvgImporter = ColorRmSvgImporter;
}
