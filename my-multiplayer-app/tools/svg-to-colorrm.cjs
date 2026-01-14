#!/usr/bin/env node
/**
 * SVG to ColorRM Converter - Pro Version v3
 *
 * FIXES in v3:
 * 1. Recursively processes elements inside groups
 * 2. Applies inherited transforms from parent groups
 * 3. Applies per-element transforms
 * 4. Disabled simplification to preserve hand-drawn curves
 * 5. Always preserves opacity values for highlighters
 *
 * PREVIOUS FIXES (v2):
 * 1. Preserves element order (z-order) from original SVG
 * 2. Detects fill+stroke path pairs and merges them
 * 3. Extracts color from fill paths, stroke-width from stroke paths
 * 4. Properly handles highlighter (low fill-opacity)
 *
 * Usage: node svg-to-colorrm.cjs input.svg [output.json]
 */

const fs = require('fs');
const path = require('path');

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    simplifyTolerance: 0,  // Disabled - preserve original path shapes
    maxPointsPerStroke: 5000,  // Increased to allow more points
    highlighterOpacityThreshold: 0.5,
    bezierPointsPerPixel: 0.2,
    minBezierSegments: 8,
    maxBezierSegments: 100,
    base64WarnSize: 500000,
    defaultStrokeWidth: 2,
    defaultStroke: '#000000',
    defaultFill: 'transparent',
    skipSimplification: true  // New flag to skip simplification entirely
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

function perpendicularDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    if (dx === 0 && dy === 0) {
        return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
    }
    const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy);
    return Math.sqrt((point.x - (lineStart.x + t * dx)) ** 2 + (point.y - (lineStart.y + t * dy)) ** 2);
}

function simplifyPath(points, tolerance = CONFIG.simplifyTolerance) {
    if (points.length <= 2) return points;
    let maxDist = 0, maxIndex = 0;
    const first = points[0], last = points[points.length - 1];
    for (let i = 1; i < points.length - 1; i++) {
        const dist = perpendicularDistance(points[i], first, last);
        if (dist > maxDist) { maxDist = dist; maxIndex = i; }
    }
    if (maxDist > tolerance) {
        const left = simplifyPath(points.slice(0, maxIndex + 1), tolerance);
        const right = simplifyPath(points.slice(maxIndex), tolerance);
        return left.slice(0, -1).concat(right);
    }
    return [first, last];
}

function enforceMaxPoints(points, maxPoints = CONFIG.maxPointsPerStroke) {
    if (points.length <= maxPoints) return points;
    let tolerance = CONFIG.simplifyTolerance;
    let simplified = points;
    while (simplified.length > maxPoints && tolerance < 50) {
        tolerance *= 1.5;
        simplified = simplifyPath(points, tolerance);
    }
    if (simplified.length > maxPoints) {
        const step = simplified.length / maxPoints;
        const result = [];
        for (let i = 0; i < maxPoints; i++) result.push(simplified[Math.floor(i * step)]);
        result.push(simplified[simplified.length - 1]);
        return result;
    }
    return simplified;
}

// Compute bounding box of points
function computeBounds(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Check if a path is a closed rectangle (4 corners, axis-aligned-ish)
function isClosedRectangle(pts) {
    if (pts.length < 4 || pts.length > 6) return false;  // Allow 4-5 points (closed rect might have duplicate endpoint)

    // Get unique corners (remove duplicate close point if present)
    const corners = [];
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const isDup = corners.some(c => Math.abs(c.x - p.x) < 1 && Math.abs(c.y - p.y) < 1);
        if (!isDup) corners.push(p);
    }

    if (corners.length !== 4) return false;

    // Check if corners form axis-aligned rectangle
    const bounds = computeBounds(corners);
    const tolerance = 2;  // pixels

    // Each corner should be at a corner of the bounding box
    let cornersAtBounds = 0;
    for (const c of corners) {
        const atLeft = Math.abs(c.x - bounds.x) < tolerance;
        const atRight = Math.abs(c.x - (bounds.x + bounds.width)) < tolerance;
        const atTop = Math.abs(c.y - bounds.y) < tolerance;
        const atBottom = Math.abs(c.y - (bounds.y + bounds.height)) < tolerance;

        if ((atLeft || atRight) && (atTop || atBottom)) cornersAtBounds++;
    }

    return cornersAtBounds >= 4;
}

// Determine border type from stroke-dasharray value
function getBorderTypeFromDasharray(strokeDasharray) {
    if (!strokeDasharray || strokeDasharray === 'none') return 'solid';
    const parts = strokeDasharray.split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));
    if (parts.length >= 2) {
        // Dotted: small gaps ratio > 1, Dashed: otherwise
        const ratio = parts[1] / parts[0];
        return ratio > 1 ? 'dotted' : 'dashed';
    }
    return parts.length === 1 ? 'dashed' : 'solid';
}

// ============================================
// BEZIER INTERPOLATION
// ============================================

function curveLength(x0, y0, x1, y1, x2, y2, x3, y3) {
    const chord = Math.sqrt((x3 - x0) ** 2 + (y3 - y0) ** 2);
    const poly = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2) +
                 Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) +
                 Math.sqrt((x3 - x2) ** 2 + (y3 - y2) ** 2);
    return (chord + poly) / 2;
}

function adaptiveSegments(length) {
    const segments = Math.ceil(length * CONFIG.bezierPointsPerPixel);
    return Math.max(CONFIG.minBezierSegments, Math.min(CONFIG.maxBezierSegments, segments));
}

function cubicBezier(x0, y0, x1, y1, x2, y2, x3, y3) {
    const segments = adaptiveSegments(curveLength(x0, y0, x1, y1, x2, y2, x3, y3));
    const pts = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments, mt = 1 - t;
        pts.push({
            x: mt*mt*mt*x0 + 3*mt*mt*t*x1 + 3*mt*t*t*x2 + t*t*t*x3,
            y: mt*mt*mt*y0 + 3*mt*mt*t*y1 + 3*mt*t*t*y2 + t*t*t*y3
        });
    }
    return pts;
}

function quadBezier(x0, y0, x1, y1, x2, y2) {
    const length = Math.sqrt((x2 - x0) ** 2 + (y2 - y0) ** 2);
    const segments = adaptiveSegments(length);
    const pts = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments, mt = 1 - t;
        pts.push({ x: mt*mt*x0 + 2*mt*t*x1 + t*t*x2, y: mt*mt*y0 + 2*mt*t*y1 + t*t*y2 });
    }
    return pts;
}

function arcPoints(x0, y0, rx, ry, rotation, largeArc, sweep, x1, y1) {
    if (rx === 0 || ry === 0) return [{ x: x0, y: y0 }, { x: x1, y: y1 }];
    const phi = rotation * Math.PI / 180;
    const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
    const dx = (x0 - x1) / 2, dy = (y0 - y1) / 2;
    const x1p = cosPhi * dx + sinPhi * dy, y1p = -sinPhi * dx + cosPhi * dy;
    let rxSq = rx * rx, rySq = ry * ry;
    const x1pSq = x1p * x1p, y1pSq = y1p * y1p;
    const lambda = x1pSq / rxSq + y1pSq / rySq;
    if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); rxSq = rx*rx; rySq = ry*ry; }
    let sq = (rxSq*rySq - rxSq*y1pSq - rySq*x1pSq) / (rxSq*y1pSq + rySq*x1pSq);
    sq = sq < 0 ? 0 : sq;
    const coef = (largeArc !== sweep ? 1 : -1) * Math.sqrt(sq);
    const cxp = coef * rx * y1p / ry, cyp = coef * -ry * x1p / rx;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const cx = cosPhi * cxp - sinPhi * cyp + mx, cy = sinPhi * cxp + cosPhi * cyp + my;
    const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
    const n = Math.sqrt(ux*ux + uy*uy);
    let theta = (uy < 0 ? -1 : 1) * Math.acos(ux / n);
    const vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
    const nn = Math.sqrt((ux*ux + uy*uy) * (vx*vx + vy*vy));
    let dTheta = (ux*vy - uy*vx < 0 ? -1 : 1) * Math.acos((ux*vx + uy*vy) / nn);
    if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
    if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
    const arcLen = Math.abs(dTheta) * Math.max(rx, ry);
    const segments = adaptiveSegments(arcLen);
    const pts = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments, angle = theta + t * dTheta;
        const xr = rx * Math.cos(angle), yr = ry * Math.sin(angle);
        pts.push({ x: cosPhi * xr - sinPhi * yr + cx, y: sinPhi * xr + cosPhi * yr + cy });
    }
    return pts;
}

// ============================================
// PATH PARSER
// ============================================

function parsePathD(d) {
    if (!d) return [];
    const points = [];
    let currentX = 0, currentY = 0, startX = 0, startY = 0;
    let lastControlX = 0, lastControlY = 0, lastCommand = '';
    const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
    let i = 0;
    const getNum = () => i < tokens.length ? (parseFloat(tokens[i++]) || 0) : 0;
    const addPt = (x, y) => {
        if (points.length === 0 || points[points.length-1].x !== x || points[points.length-1].y !== y)
            points.push({ x, y });
    };
    while (i < tokens.length) {
        let cmd = tokens[i];
        if (/[a-zA-Z]/.test(cmd)) { i++; lastCommand = cmd; }
        else { cmd = lastCommand; if (cmd === 'M') cmd = 'L'; if (cmd === 'm') cmd = 'l'; }
        const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
        switch (C) {
            case 'M': { let x = getNum(), y = getNum(); if (rel) { x += currentX; y += currentY; }
                currentX = x; currentY = y; startX = x; startY = y; addPt(x, y); break; }
            case 'L': { let x = getNum(), y = getNum(); if (rel) { x += currentX; y += currentY; }
                currentX = x; currentY = y; addPt(x, y); break; }
            case 'H': { let x = getNum(); if (rel) x += currentX; currentX = x; addPt(currentX, currentY); break; }
            case 'V': { let y = getNum(); if (rel) y += currentY; currentY = y; addPt(currentX, currentY); break; }
            case 'C': { let x1 = getNum(), y1 = getNum(), x2 = getNum(), y2 = getNum(), x = getNum(), y = getNum();
                if (rel) { x1 += currentX; y1 += currentY; x2 += currentX; y2 += currentY; x += currentX; y += currentY; }
                cubicBezier(currentX, currentY, x1, y1, x2, y2, x, y).slice(1).forEach(p => addPt(p.x, p.y));
                lastControlX = x2; lastControlY = y2; currentX = x; currentY = y; break; }
            case 'S': { let x1 = currentX*2 - lastControlX, y1 = currentY*2 - lastControlY;
                let x2 = getNum(), y2 = getNum(), x = getNum(), y = getNum();
                if (rel) { x2 += currentX; y2 += currentY; x += currentX; y += currentY; }
                if (!'CScs'.includes(lastCommand)) { x1 = currentX; y1 = currentY; }
                cubicBezier(currentX, currentY, x1, y1, x2, y2, x, y).slice(1).forEach(p => addPt(p.x, p.y));
                lastControlX = x2; lastControlY = y2; currentX = x; currentY = y; break; }
            case 'Q': { let x1 = getNum(), y1 = getNum(), x = getNum(), y = getNum();
                if (rel) { x1 += currentX; y1 += currentY; x += currentX; y += currentY; }
                quadBezier(currentX, currentY, x1, y1, x, y).slice(1).forEach(p => addPt(p.x, p.y));
                lastControlX = x1; lastControlY = y1; currentX = x; currentY = y; break; }
            case 'T': { let x1 = currentX*2 - lastControlX, y1 = currentY*2 - lastControlY;
                let x = getNum(), y = getNum(); if (rel) { x += currentX; y += currentY; }
                if (!'QTqt'.includes(lastCommand)) { x1 = currentX; y1 = currentY; }
                quadBezier(currentX, currentY, x1, y1, x, y).slice(1).forEach(p => addPt(p.x, p.y));
                lastControlX = x1; lastControlY = y1; currentX = x; currentY = y; break; }
            case 'A': { const rxV = Math.abs(getNum()), ryV = Math.abs(getNum()), rot = getNum();
                const la = !!getNum(), sw = !!getNum(); let x = getNum(), y = getNum();
                if (rel) { x += currentX; y += currentY; }
                arcPoints(currentX, currentY, rxV, ryV, rot, la, sw, x, y).slice(1).forEach(p => addPt(p.x, p.y));
                currentX = x; currentY = y; break; }
            case 'Z': { if (currentX !== startX || currentY !== startY) addPt(startX, startY);
                currentX = startX; currentY = startY; break; }
            default: i++;
        }
        lastCommand = cmd;
    }
    return points;
}

// ============================================
// TRANSFORM MATRIX
// ============================================

function identityMatrix() { return [1, 0, 0, 1, 0, 0]; }

function multiplyMatrix(a, b) {
    return [
        a[0]*b[0] + a[2]*b[1], a[1]*b[0] + a[3]*b[1],
        a[0]*b[2] + a[2]*b[3], a[1]*b[2] + a[3]*b[3],
        a[0]*b[4] + a[2]*b[5] + a[4], a[1]*b[4] + a[3]*b[5] + a[5]
    ];
}

function parseTransform(transform) {
    if (!transform) return identityMatrix();
    let matrix = identityMatrix();
    const transforms = transform.match(/(\w+)\s*\([^)]+\)/g) || [];
    for (const t of transforms) {
        const match = t.match(/(\w+)\s*\(([^)]+)\)/);
        if (!match) continue;
        const type = match[1], values = match[2].split(/[\s,]+/).map(parseFloat);
        let m;
        switch (type) {
            case 'matrix': if (values.length >= 6) m = values.slice(0, 6); break;
            case 'translate': m = [1, 0, 0, 1, values[0] || 0, values[1] || 0]; break;
            case 'scale': const sx = values[0] || 1, sy = values[1] !== undefined ? values[1] : sx;
                m = [sx, 0, 0, sy, 0, 0]; break;
            case 'rotate': const angle = (values[0] || 0) * Math.PI / 180;
                const cos = Math.cos(angle), sin = Math.sin(angle);
                if (values.length >= 3) { const cx = values[1], cy = values[2];
                    m = [cos, sin, -sin, cos, cx - cos*cx + sin*cy, cy - sin*cx - cos*cy];
                } else m = [cos, sin, -sin, cos, 0, 0]; break;
            case 'skewX': m = [1, 0, Math.tan((values[0]||0)*Math.PI/180), 1, 0, 0]; break;
            case 'skewY': m = [1, Math.tan((values[0]||0)*Math.PI/180), 0, 1, 0, 0]; break;
        }
        if (m) matrix = multiplyMatrix(matrix, m);
    }
    return matrix;
}

function transformPoint(x, y, m) { return { x: m[0]*x + m[2]*y + m[4], y: m[1]*x + m[3]*y + m[5] }; }
function getMatrixScale(m) { return Math.sqrt(Math.abs(m[0]*m[3] - m[1]*m[2])); }

// ============================================
// COLOR PARSING
// ============================================

function parseColor(color) {
    if (!color || color === 'none' || color === 'transparent') return null;
    if (color === 'currentColor') return '#000000';
    if (color.startsWith('#')) {
        if (color.length === 4) return '#' + color[1]+color[1] + color[2]+color[2] + color[3]+color[3];
        return color;
    }
    const rgb = color.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgb) return '#' + parseInt(rgb[1]).toString(16).padStart(2,'0') +
        parseInt(rgb[2]).toString(16).padStart(2,'0') + parseInt(rgb[3]).toString(16).padStart(2,'0');
    const named = { black:'#000000', white:'#ffffff', red:'#ff0000', green:'#008000', blue:'#0000ff',
        yellow:'#ffff00', cyan:'#00ffff', magenta:'#ff00ff', orange:'#ffa500', purple:'#800080' };
    return named[color.toLowerCase()] || '#000000';
}

function parseOpacity(value) {
    if (value === undefined || value === null || value === '') return 1;
    const num = parseFloat(value);
    return isNaN(num) ? 1 : Math.max(0, Math.min(1, num));
}

// ============================================
// ATTRIBUTE EXTRACTION
// ============================================

const NS = '(?:\\w+:)?';

function getAttr(element, attr) {
    const patterns = [new RegExp(`\\s${attr}="([^"]*)"`, 'i'), new RegExp(`\\s\\w+:${attr}="([^"]*)"`, 'i')];
    for (const p of patterns) { const m = element.match(p); if (m) return m[1]; }
    return null;
}

function parseStyle(style) {
    if (!style) return {};
    const result = {};
    style.split(';').forEach(r => { const [p, v] = r.split(':').map(s => s.trim()); if (p && v) result[p] = v; });
    return result;
}

// ============================================
// SIMPLE XML ELEMENT PARSER (no regex for structure)
// ============================================

/**
 * Parse SVG content into a tree structure
 * This is more robust than regex-based parsing
 */
function parseXMLElements(content) {
    const elements = [];
    let i = 0;
    const len = content.length;

    while (i < len) {
        // Skip until we find a tag
        const tagStart = content.indexOf('<', i);
        if (tagStart === -1) break;

        // Skip comments and CDATA
        if (content.slice(tagStart, tagStart + 4) === '<!--') {
            const commentEnd = content.indexOf('-->', tagStart);
            i = commentEnd === -1 ? len : commentEnd + 3;
            continue;
        }
        if (content.slice(tagStart, tagStart + 9) === '<![CDATA[') {
            const cdataEnd = content.indexOf(']]>', tagStart);
            i = cdataEnd === -1 ? len : cdataEnd + 3;
            continue;
        }

        // Skip closing tags
        if (content[tagStart + 1] === '/') {
            const closeEnd = content.indexOf('>', tagStart);
            i = closeEnd === -1 ? len : closeEnd + 1;
            continue;
        }

        // Skip processing instructions and doctype
        if (content[tagStart + 1] === '?' || content[tagStart + 1] === '!') {
            const piEnd = content.indexOf('>', tagStart);
            i = piEnd === -1 ? len : piEnd + 1;
            continue;
        }

        // Find tag name end
        let j = tagStart + 1;
        while (j < len && /[a-zA-Z0-9:_-]/.test(content[j])) j++;
        const tagName = content.slice(tagStart + 1, j);

        if (!tagName) {
            i = tagStart + 1;
            continue;
        }

        // Find end of opening tag (either /> or >)
        let inQuote = false;
        let quoteChar = '';
        let k = j;
        while (k < len) {
            const ch = content[k];
            if (inQuote) {
                if (ch === quoteChar) inQuote = false;
            } else {
                if (ch === '"' || ch === "'") {
                    inQuote = true;
                    quoteChar = ch;
                } else if (ch === '>') {
                    break;
                }
            }
            k++;
        }

        if (k >= len) break;

        const isSelfClosing = content[k - 1] === '/';
        const attrsStr = content.slice(j, isSelfClosing ? k - 1 : k).trim();
        const tagEnd = k + 1;

        // Parse attributes
        const attrs = parseAttributes(attrsStr);

        let innerContent = '';
        let elementEnd = tagEnd;

        // If not self-closing, find the closing tag
        if (!isSelfClosing) {
            const closeTag = findClosingTag(content, tagEnd, tagName);
            if (closeTag.end !== -1) {
                innerContent = content.slice(tagEnd, closeTag.start);
                elementEnd = closeTag.end;
            } else {
                elementEnd = tagEnd;
            }
        }

        elements.push({
            position: tagStart,
            tagName: tagName.replace(/^\w+:/, '').toLowerCase(),
            rawTagName: tagName,
            attrs,
            attrsStr,
            innerContent,
            selfClosing: isSelfClosing,
            end: elementEnd
        });

        i = elementEnd;
    }

    return elements;
}

/**
 * Parse attribute string into object
 */
function parseAttributes(attrsStr) {
    const attrs = {};
    const attrPattern = /([a-zA-Z0-9:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match;
    while ((match = attrPattern.exec(attrsStr)) !== null) {
        attrs[match[1]] = match[2] !== undefined ? match[2] : match[3];
    }
    return attrs;
}

/**
 * Find the matching closing tag, handling nesting
 * Handles namespaced tags (e.g., svg:g) by matching both with and without namespace
 */
function findClosingTag(content, start, tagName) {
    // Strip namespace from tagName for pattern matching
    const baseName = tagName.replace(/^\w+:/, '');

    // Match both namespaced and non-namespaced versions
    const escapedName = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const openPattern = new RegExp(`<(?:\\w+:)?${escapedName}(?:\\s|>)`, 'gi');
    const closePattern = new RegExp(`</(?:\\w+:)?${escapedName}>`, 'gi');

    let depth = 1;
    let pos = start;

    while (depth > 0 && pos < content.length) {
        openPattern.lastIndex = pos;
        closePattern.lastIndex = pos;

        const openMatch = openPattern.exec(content);
        const closeMatch = closePattern.exec(content);

        if (!closeMatch) {
            // No closing tag found - try to find end of content
            return { start: -1, end: -1 };
        }

        // Check if there's an opening tag before the closing tag
        if (openMatch && openMatch.index < closeMatch.index) {
            // Check if it's not a self-closing tag
            const tagEnd = content.indexOf('>', openMatch.index);
            if (tagEnd !== -1 && content[tagEnd - 1] !== '/') {
                depth++;
            }
            pos = openMatch.index + openMatch[0].length;
        } else {
            depth--;
            if (depth === 0) {
                return { start: closeMatch.index, end: closeMatch.index + closeMatch[0].length };
            }
            pos = closeMatch.index + closeMatch[0].length;
        }
    }

    return { start: -1, end: -1 };
}

// ============================================
// ELEMENT COLLECTION (using proper parser)
// ============================================

// Global mask definitions storage
let maskDefinitions = {};

function collectAllElementsRecursive(content, parentTransform = identityMatrix(), depth = 0, parentMaskId = null) {
    const elements = [];
    const parsedElements = parseXMLElements(content);

    const drawableElements = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image'];

    for (const elem of parsedElements) {
        const tagLower = elem.tagName;

        if (tagLower === 'g') {
            // It's a group - parse transform and recurse
            const groupTransformStr = elem.attrs.transform || null;
            const groupMatrix = parseTransform(groupTransformStr);
            const combinedTransform = multiplyMatrix(parentTransform, groupMatrix);

            // Also inherit style attributes
            const groupOpacity = elem.attrs.opacity;

            // Check for mask attribute on this group
            let maskId = parentMaskId;
            const maskAttr = elem.attrs.mask;
            if (maskAttr) {
                // Extract mask ID from url(#mask_id)
                const maskMatch = maskAttr.match(/url\(#([^)]+)\)/);
                if (maskMatch) {
                    maskId = maskMatch[1];
                }
            }

            // Recursively process group contents with mask inheritance
            const childElements = collectAllElementsRecursive(elem.innerContent, combinedTransform, depth + 1, maskId);

            // Apply group opacity to children if set
            if (groupOpacity !== undefined) {
                childElements.forEach(child => {
                    if (child.groupOpacity === undefined) {
                        child.groupOpacity = parseFloat(groupOpacity);
                    } else {
                        child.groupOpacity *= parseFloat(groupOpacity);
                    }
                });
            }

            elements.push(...childElements);

        } else if (tagLower === 'mask') {
            // Store mask definition - extract image data from inside
            const maskId = elem.attrs.id;
            if (maskId) {
                // Find image inside the mask
                const maskContent = elem.innerContent;
                const imageMatch = maskContent.match(/<image[^>]*(?:xlink:)?href="([^"]+)"[^>]*>/);
                if (imageMatch) {
                    // Store the mask image data
                    maskDefinitions[maskId] = {
                        imageData: imageMatch[1],
                        type: 'luminance'  // SVG masks default to luminance
                    };
                }
            }
            // Don't add mask content as drawable elements
            continue;

        } else if (tagLower === 'clippath') {
            // Skip clippath content
            continue;

        } else if (tagLower === 'defs') {
            // Process defs - this will capture masks inside
            const childElements = collectAllElementsRecursive(elem.innerContent, parentTransform, depth + 1, parentMaskId);
            // Don't add defs content to drawable elements
            continue;

        } else if (drawableElements.includes(tagLower)) {
            // It's a drawable element
            const elemData = {
                position: elem.position,
                tag: tagLower,
                fullMatch: content.slice(elem.position, elem.end),
                attrs: elem.attrsStr,
                attrsObj: elem.attrs,
                innerContent: elem.innerContent,
                inheritedTransform: parentTransform
            };

            // Add mask reference if this element is inside a masked group
            if (parentMaskId) {
                elemData.maskId = parentMaskId;
            }

            elements.push(elemData);
        }
    }

    return elements;
}

function collectAllElements(content) {
    // Reset mask definitions for each conversion
    maskDefinitions = {};
    console.log('Using recursive element collection with transform inheritance...');
    return collectAllElementsRecursive(content);
}

// ============================================
// PATH PAIR DETECTION & MERGING
// ============================================

function detectPathPairs(elements) {
    const merged = [];
    const used = new Set();

    // Helper to get attribute from attrsObj or fallback to getAttr
    const getElemAttr = (elem, attr) => {
        if (elem.attrsObj && elem.attrsObj[attr] !== undefined) {
            return elem.attrsObj[attr];
        }
        return getAttr(`<${elem.tag} ${elem.attrs}>`, attr);
    };

    for (let i = 0; i < elements.length; i++) {
        if (used.has(i)) continue;

        const elem = elements[i];

        if (elem.tag === 'path') {
            const d = getElemAttr(elem, 'd');
            const fill = getElemAttr(elem, 'fill');
            const stroke = getElemAttr(elem, 'stroke');
            const fillOpacity = getElemAttr(elem, 'fill-opacity');
            const strokeWidth = getElemAttr(elem, 'stroke-width');
            const styleStr = getElemAttr(elem, 'style');
            const style = parseStyle(styleStr);

            // Check if this is a fill-only path (potential first of pair)
            const isFillPath = fill && fill !== 'none' && (!stroke || stroke === 'none');

            if (isFillPath && i + 1 < elements.length) {
                const nextElem = elements[i + 1];
                if (nextElem.tag === 'path') {
                    const nextD = getElemAttr(nextElem, 'd');
                    const nextFill = getElemAttr(nextElem, 'fill');
                    const nextStroke = getElemAttr(nextElem, 'stroke');
                    const nextStrokeWidth = getElemAttr(nextElem, 'stroke-width');
                    const nextStrokeOpacity = getElemAttr(nextElem, 'stroke-opacity');
                    const nextStrokeDasharray = getElemAttr(nextElem, 'stroke-dasharray');

                    // Check if next path is stroke-only with same d
                    const isStrokePath = (!nextFill || nextFill === 'none') && nextStroke && nextStroke !== 'none';

                    if (isStrokePath && d === nextD) {
                        const fillOp = parseFloat(fillOpacity || style['fill-opacity'] || '1');
                        const strokeOp = parseFloat(nextStrokeOpacity || '1');

                        // CASE 1: Visible fill WITH solid stroke (like filled box with border)
                        // DON'T merge - keep both as separate elements (a fill shape + border)
                        if (fillOp >= 0.01 && strokeOp >= 0.99) {
                            // Mark both as used but create a SHAPE instead of stroke
                            used.add(i);
                            used.add(i + 1);

                            // Create a filled shape with border
                            merged.push({
                                ...elem,
                                isPair: true,
                                isFillWithBorder: true,  // New flag for shapes with fill + border
                                mergedFillColor: fill,
                                mergedFillOpacity: fillOp,
                                mergedStrokeColor: nextStroke,
                                mergedStrokeWidth: nextStrokeWidth || strokeWidth || '2',
                                mergedStrokeOpacity: strokeOp,
                                mergedStrokeDasharray: nextStrokeDasharray
                            });
                            continue;
                        }

                        // CASE 2: Invisible fill (fillOp < 0.01) - eraser/highlighter pattern
                        // Use stroke color and stroke-opacity
                        if (fillOp < 0.01) {
                            used.add(i);
                            used.add(i + 1);
                            merged.push({
                                ...elem,
                                isPair: true,
                                mergedColor: nextStroke,
                                mergedStrokeWidth: nextStrokeWidth || strokeWidth || '2',
                                mergedOpacity: strokeOp,  // Use stroke-opacity from companion path
                                originalStrokeColor: nextStroke,
                                isEraser: fillOp < 0.01 && strokeOp >= 1
                            });
                            continue;
                        }

                        // CASE 3: Semi-transparent fill with semi-transparent stroke (highlighter)
                        // Merge into single highlighter stroke
                        used.add(i);
                        used.add(i + 1);
                        merged.push({
                            ...elem,
                            isPair: true,
                            mergedColor: fill,
                            mergedStrokeWidth: nextStrokeWidth || strokeWidth || '2',
                            mergedOpacity: fillOp,
                            originalStrokeColor: nextStroke
                        });
                        continue;
                    }
                }
            }
        }

        // Not a pair, add as-is
        merged.push(elem);
        used.add(i);
    }

    return merged;
}

// ============================================
// ELEMENT CONVERTERS
// ============================================

let itemIdCounter = Date.now();
function generateId() { return itemIdCounter++; }

// Helper to get attribute from element (prefers parsed attrsObj, falls back to regex)
function getElemAttr(elem, attr) {
    if (elem.attrsObj && elem.attrsObj[attr] !== undefined) {
        return elem.attrsObj[attr];
    }
    return getAttr(`<${elem.tag} ${elem.attrs}>`, attr);
}

function convertPath(elem, globalTransform) {
    const d = getElemAttr(elem, 'd');
    if (!d) return null;

    let pts = parsePathD(d);
    if (pts.length < 2) return null;

    // Combine inherited transform (from groups) with element's own transform
    const elemTransformStr = getElemAttr(elem, 'transform');
    const elemTransform = parseTransform(elemTransformStr);
    const inheritedTransform = elem.inheritedTransform || identityMatrix();
    const transform = multiplyMatrix(multiplyMatrix(globalTransform, inheritedTransform), elemTransform);

    // Apply group opacity if inherited
    let groupOpacityMultiplier = elem.groupOpacity !== undefined ? elem.groupOpacity : 1;

    pts = pts.map(p => transformPoint(p.x, p.y, transform));

    // Skip simplification if configured
    if (!CONFIG.skipSimplification && CONFIG.simplifyTolerance > 0) {
        pts = simplifyPath(pts);
    }
    pts = enforceMaxPoints(pts);
    if (pts.length < 2) return null;

    // Handle merged pair - fillWithBorder case (visible fill + solid stroke)
    if (elem.isPair && elem.isFillWithBorder) {
        const fillOpacity = elem.mergedFillOpacity * groupOpacityMultiplier;
        const strokeOpacity = elem.mergedStrokeOpacity * groupOpacityMultiplier;
        const strokeWidth = parseFloat(elem.mergedStrokeWidth) * getMatrixScale(transform);
        const borderType = getBorderTypeFromDasharray(elem.mergedStrokeDasharray);

        // Try to detect if this is a rectangle-like shape (closed path with 4 corners)
        const isRectLike = isClosedRectangle(pts);

        if (isRectLike) {
            // Convert to rectangle shape
            const bounds = computeBounds(pts);
            return {
                id: generateId(),
                lastMod: Date.now(),
                tool: 'shape',
                shapeType: 'rectangle',
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
                borderColor: parseColor(elem.mergedStrokeColor) || CONFIG.defaultStroke,
                fillColor: parseColor(elem.mergedFillColor) || '#ffffff',
                fillOpacity: fillOpacity,
                borderOpacity: strokeOpacity,
                borderSize: strokeWidth,
                borderType: borderType,
                deleted: false
            };
        } else {
            // Create a polygon shape for non-rectangular paths
            const bounds = computeBounds(pts);
            const normalizedPts = pts.map(p => ({
                x: bounds.width > 0 ? (p.x - bounds.x) / bounds.width : 0,
                y: bounds.height > 0 ? (p.y - bounds.y) / bounds.height : 0
            }));

            return {
                id: generateId(),
                lastMod: Date.now(),
                tool: 'shape',
                shapeType: 'polygon',
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
                pts: normalizedPts,
                borderColor: parseColor(elem.mergedStrokeColor) || CONFIG.defaultStroke,
                fillColor: parseColor(elem.mergedFillColor) || '#ffffff',
                fillOpacity: fillOpacity,
                borderOpacity: strokeOpacity,
                borderSize: strokeWidth,
                borderType: borderType,
                deleted: false
            };
        }
    }

    // Handle merged pair - highlighter/eraser case
    if (elem.isPair) {
        const opacity = elem.mergedOpacity * groupOpacityMultiplier;
        const tool = opacity < CONFIG.highlighterOpacityThreshold ? 'highlighter' : 'pen';
        const strokeWidth = parseFloat(elem.mergedStrokeWidth) * getMatrixScale(transform);

        return {
            id: generateId(),
            lastMod: Date.now(),
            tool,
            pts,
            color: parseColor(elem.mergedColor) || CONFIG.defaultStroke,
            size: strokeWidth,
            opacity: opacity,  // Always include opacity
            lineCap: 'round',
            lineJoin: 'round',
            deleted: false
        };
    }

    // Single path
    const fill = getElemAttr(elem, 'fill');
    const stroke = getElemAttr(elem, 'stroke');
    const strokeWidth = getElemAttr(elem, 'stroke-width');
    const fillOpacity = getElemAttr(elem, 'fill-opacity');
    const strokeOpacity = getElemAttr(elem, 'stroke-opacity');
    const opacity = getElemAttr(elem, 'opacity');
    const lineCap = getElemAttr(elem, 'stroke-linecap');
    const lineJoin = getElemAttr(elem, 'stroke-linejoin');
    const strokeDasharray = getElemAttr(elem, 'stroke-dasharray');

    // Check if this is a stroke-only path with a dash pattern (dashed/dotted border)
    // If so, and it looks like a closed rectangle, convert to a shape instead of stroke
    const isStrokeOnly = (!fill || fill === 'none') && stroke && stroke !== 'none';
    const hasDashPattern = strokeDasharray && strokeDasharray !== 'none';

    if (isStrokeOnly && hasDashPattern && isClosedRectangle(pts)) {
        // Convert to rectangle shape with dashed border and no fill
        const bounds = computeBounds(pts);
        const borderType = getBorderTypeFromDasharray(strokeDasharray);
        const strokeOp = parseFloat(strokeOpacity || opacity || '1') * groupOpacityMultiplier;
        const sw = (parseFloat(strokeWidth) || CONFIG.defaultStrokeWidth) * getMatrixScale(transform);

        return {
            id: generateId(),
            lastMod: Date.now(),
            tool: 'shape',
            shapeType: 'rectangle',
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            borderColor: parseColor(stroke) || CONFIG.defaultStroke,
            fillColor: 'transparent',
            fillOpacity: 0,
            borderOpacity: strokeOp,
            borderSize: sw,
            borderType: borderType,
            deleted: false
        };
    }

    // Check if stroke-only with dash pattern but not rectangular - make polygon
    if (isStrokeOnly && hasDashPattern && pts.length >= 3) {
        const bounds = computeBounds(pts);
        const normalizedPts = pts.map(p => ({
            x: bounds.width > 0 ? (p.x - bounds.x) / bounds.width : 0,
            y: bounds.height > 0 ? (p.y - bounds.y) / bounds.height : 0
        }));
        const borderType = getBorderTypeFromDasharray(strokeDasharray);
        const strokeOp = parseFloat(strokeOpacity || opacity || '1') * groupOpacityMultiplier;
        const sw = (parseFloat(strokeWidth) || CONFIG.defaultStrokeWidth) * getMatrixScale(transform);

        return {
            id: generateId(),
            lastMod: Date.now(),
            tool: 'shape',
            shapeType: 'polygon',
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            pts: normalizedPts,
            borderColor: parseColor(stroke) || CONFIG.defaultStroke,
            fillColor: 'transparent',
            fillOpacity: 0,
            borderOpacity: strokeOp,
            borderSize: sw,
            borderType: borderType,
            deleted: false
        };
    }

    const effectiveOpacity = parseOpacity(opacity) * parseOpacity(fillOpacity) * groupOpacityMultiplier;
    const tool = effectiveOpacity < CONFIG.highlighterOpacityThreshold ? 'highlighter' : 'pen';
    const color = parseColor(stroke) || parseColor(fill) || CONFIG.defaultStroke;
    const sw = (parseFloat(strokeWidth) || CONFIG.defaultStrokeWidth) * getMatrixScale(transform);

    return {
        id: generateId(),
        lastMod: Date.now(),
        tool,
        pts,
        color,
        size: sw,
        opacity: effectiveOpacity,  // Always include opacity
        lineCap: lineCap || 'round',
        lineJoin: lineJoin || 'round',
        deleted: false
    };
}

function convertRect(elem, globalTransform) {
    const x = parseFloat(getElemAttr(elem, 'x')) || 0;
    const y = parseFloat(getElemAttr(elem, 'y')) || 0;
    const w = parseFloat(getElemAttr(elem, 'width')) || 0;
    const h = parseFloat(getElemAttr(elem, 'height')) || 0;
    if (w === 0 || h === 0) return null;

    // Combine inherited transform with element's own transform
    const elemTransformStr = getElemAttr(elem, 'transform');
    const elemTransform = parseTransform(elemTransformStr);
    const inheritedTransform = elem.inheritedTransform || identityMatrix();
    const transform = multiplyMatrix(multiplyMatrix(globalTransform, inheritedTransform), elemTransform);

    const stroke = getElemAttr(elem, 'stroke');
    const fill = getElemAttr(elem, 'fill');
    const strokeWidth = getElemAttr(elem, 'stroke-width');
    const fillOpacity = getElemAttr(elem, 'fill-opacity');
    const strokeOpacity = getElemAttr(elem, 'stroke-opacity');
    const strokeDasharray = getElemAttr(elem, 'stroke-dasharray');

    // Determine border type from stroke-dasharray
    let borderType = 'solid';
    if (strokeDasharray && strokeDasharray !== 'none') {
        const parts = strokeDasharray.split(/[\s,]+/).map(parseFloat);
        if (parts.length >= 2) {
            // Dotted: small gaps, Dashed: larger gaps
            const ratio = parts[1] / parts[0];
            borderType = ratio > 1 ? 'dotted' : 'dashed';
        }
    }

    const corners = [
        transformPoint(x, y, transform),
        transformPoint(x + w, y, transform),
        transformPoint(x + w, y + h, transform),
        transformPoint(x, y + h, transform)
    ];
    const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    const result = {
        id: generateId(),
        lastMod: Date.now(),
        tool: 'shape',
        shapeType: 'rectangle',
        x: minX, y: minY, w: maxX - minX, h: maxY - minY,
        border: parseColor(stroke) || CONFIG.defaultStroke,
        fill: parseColor(fill) || CONFIG.defaultFill,
        width: (parseFloat(strokeWidth) || CONFIG.defaultStrokeWidth) * getMatrixScale(transform),
        rotation: 0,
        deleted: false
    };

    // Add separate opacities
    if (fillOpacity !== undefined && parseFloat(fillOpacity) < 1) {
        result.fillOpacity = parseFloat(fillOpacity);
    }
    if (strokeOpacity !== undefined && parseFloat(strokeOpacity) < 1) {
        result.borderOpacity = parseFloat(strokeOpacity);
    }
    if (borderType !== 'solid') {
        result.borderType = borderType;
    }

    return result;
}

function convertCircle(elem, globalTransform) {
    const cx = parseFloat(getElemAttr(elem, 'cx')) || 0;
    const cy = parseFloat(getElemAttr(elem, 'cy')) || 0;
    const r = parseFloat(getElemAttr(elem, 'r')) || 0;
    if (r === 0) return null;

    // Combine inherited transform with element's own transform
    const elemTransformStr = getElemAttr(elem, 'transform');
    const elemTransform = parseTransform(elemTransformStr);
    const inheritedTransform = elem.inheritedTransform || identityMatrix();
    const transform = multiplyMatrix(multiplyMatrix(globalTransform, inheritedTransform), elemTransform);

    const stroke = getElemAttr(elem, 'stroke');
    const fill = getElemAttr(elem, 'fill');
    const strokeWidth = getElemAttr(elem, 'stroke-width');
    const fillOpacity = getElemAttr(elem, 'fill-opacity');
    const strokeOpacity = getElemAttr(elem, 'stroke-opacity');
    const strokeDasharray = getElemAttr(elem, 'stroke-dasharray');

    let borderType = 'solid';
    if (strokeDasharray && strokeDasharray !== 'none') {
        const parts = strokeDasharray.split(/[\s,]+/).map(parseFloat);
        if (parts.length >= 2) {
            borderType = parts[1] / parts[0] > 1 ? 'dotted' : 'dashed';
        }
    }

    const center = transformPoint(cx, cy, transform);
    const scaledR = r * getMatrixScale(transform);

    const result = {
        id: generateId(),
        lastMod: Date.now(),
        tool: 'shape',
        shapeType: 'circle',
        x: center.x - scaledR, y: center.y - scaledR, w: scaledR * 2, h: scaledR * 2,
        border: parseColor(stroke) || CONFIG.defaultStroke,
        fill: parseColor(fill) || CONFIG.defaultFill,
        width: (parseFloat(strokeWidth) || CONFIG.defaultStrokeWidth) * getMatrixScale(transform),
        rotation: 0,
        deleted: false
    };

    if (fillOpacity !== undefined && parseFloat(fillOpacity) < 1) {
        result.fillOpacity = parseFloat(fillOpacity);
    }
    if (strokeOpacity !== undefined && parseFloat(strokeOpacity) < 1) {
        result.borderOpacity = parseFloat(strokeOpacity);
    }
    if (borderType !== 'solid') {
        result.borderType = borderType;
    }

    return result;
}

function convertEllipse(elem, globalTransform) {
    const cx = parseFloat(getElemAttr(elem, 'cx')) || 0;
    const cy = parseFloat(getElemAttr(elem, 'cy')) || 0;
    const rx = parseFloat(getElemAttr(elem, 'rx')) || 0;
    const ry = parseFloat(getElemAttr(elem, 'ry')) || 0;
    if (rx === 0 || ry === 0) return null;

    // Combine inherited transform with element's own transform
    const elemTransformStr = getElemAttr(elem, 'transform');
    const elemTransform = parseTransform(elemTransformStr);
    const inheritedTransform = elem.inheritedTransform || identityMatrix();
    const transform = multiplyMatrix(multiplyMatrix(globalTransform, inheritedTransform), elemTransform);

    const stroke = getElemAttr(elem, 'stroke');
    const fill = getElemAttr(elem, 'fill');
    const strokeWidth = getElemAttr(elem, 'stroke-width');
    const fillOpacity = getElemAttr(elem, 'fill-opacity');
    const strokeOpacity = getElemAttr(elem, 'stroke-opacity');
    const strokeDasharray = getElemAttr(elem, 'stroke-dasharray');

    let borderType = 'solid';
    if (strokeDasharray && strokeDasharray !== 'none') {
        const parts = strokeDasharray.split(/[\s,]+/).map(parseFloat);
        if (parts.length >= 2) {
            borderType = parts[1] / parts[0] > 1 ? 'dotted' : 'dashed';
        }
    }

    const center = transformPoint(cx, cy, transform);
    const scale = getMatrixScale(transform);

    const result = {
        id: generateId(),
        lastMod: Date.now(),
        tool: 'shape',
        shapeType: 'ellipse',
        x: center.x - rx * scale, y: center.y - ry * scale, w: rx * 2 * scale, h: ry * 2 * scale,
        border: parseColor(stroke) || CONFIG.defaultStroke,
        fill: parseColor(fill) || CONFIG.defaultFill,
        width: (parseFloat(strokeWidth) || CONFIG.defaultStrokeWidth) * scale,
        rotation: 0,
        deleted: false
    };

    if (fillOpacity !== undefined && parseFloat(fillOpacity) < 1) {
        result.fillOpacity = parseFloat(fillOpacity);
    }
    if (strokeOpacity !== undefined && parseFloat(strokeOpacity) < 1) {
        result.borderOpacity = parseFloat(strokeOpacity);
    }
    if (borderType !== 'solid') {
        result.borderType = borderType;
    }

    return result;
}

function convertLine(elem, globalTransform) {
    const x1 = parseFloat(getElemAttr(elem, 'x1')) || 0;
    const y1 = parseFloat(getElemAttr(elem, 'y1')) || 0;
    const x2 = parseFloat(getElemAttr(elem, 'x2')) || 0;
    const y2 = parseFloat(getElemAttr(elem, 'y2')) || 0;

    // Combine inherited transform with element's own transform
    const elemTransformStr = getElemAttr(elem, 'transform');
    const elemTransform = parseTransform(elemTransformStr);
    const inheritedTransform = elem.inheritedTransform || identityMatrix();
    const transform = multiplyMatrix(multiplyMatrix(globalTransform, inheritedTransform), elemTransform);

    const stroke = getElemAttr(elem, 'stroke');
    const strokeWidth = getElemAttr(elem, 'stroke-width');

    return {
        id: generateId(),
        lastMod: Date.now(),
        tool: 'pen',
        pts: [transformPoint(x1, y1, transform), transformPoint(x2, y2, transform)],
        color: parseColor(stroke) || CONFIG.defaultStroke,
        size: (parseFloat(strokeWidth) || CONFIG.defaultStrokeWidth) * getMatrixScale(transform),
        lineCap: 'round',
        lineJoin: 'round',
        deleted: false
    };
}

function convertPolyline(elem, globalTransform, close = false) {
    const pointsStr = getElemAttr(elem, 'points') || '';
    const nums = pointsStr.match(/[-+]?(?:\d+\.?\d*|\.\d+)/g) || [];
    if (nums.length < 4) return null;

    // Combine inherited transform with element's own transform
    const elemTransformStr = getElemAttr(elem, 'transform');
    const elemTransform = parseTransform(elemTransformStr);
    const inheritedTransform = elem.inheritedTransform || identityMatrix();
    const transform = multiplyMatrix(multiplyMatrix(globalTransform, inheritedTransform), elemTransform);

    let pts = [];
    for (let i = 0; i < nums.length - 1; i += 2) {
        pts.push(transformPoint(parseFloat(nums[i]), parseFloat(nums[i + 1]), transform));
    }
    if (close && pts.length > 0 && (pts[0].x !== pts[pts.length-1].x || pts[0].y !== pts[pts.length-1].y)) {
        pts.push({ x: pts[0].x, y: pts[0].y });
    }

    if (!CONFIG.skipSimplification && CONFIG.simplifyTolerance > 0) {
        pts = simplifyPath(pts);
    }
    pts = enforceMaxPoints(pts);
    if (pts.length < 2) return null;

    const stroke = getElemAttr(elem, 'stroke');
    const strokeWidth = getElemAttr(elem, 'stroke-width');

    return {
        id: generateId(),
        lastMod: Date.now(),
        tool: 'pen',
        pts,
        color: parseColor(stroke) || CONFIG.defaultStroke,
        size: (parseFloat(strokeWidth) || CONFIG.defaultStrokeWidth) * getMatrixScale(transform),
        lineCap: 'round',
        lineJoin: 'round',
        deleted: false
    };
}

// Convert polygon to a shape (closed polygon)
function convertPolygonShape(elem, globalTransform) {
    const pointsStr = getElemAttr(elem, 'points') || '';
    const nums = pointsStr.match(/[-+]?(?:\d+\.?\d*|\.\d+)/g) || [];
    if (nums.length < 6) return null; // Need at least 3 points for a polygon

    // Combine inherited transform with element's own transform
    const elemTransformStr = getElemAttr(elem, 'transform');
    const elemTransform = parseTransform(elemTransformStr);
    const inheritedTransform = elem.inheritedTransform || identityMatrix();
    const transform = multiplyMatrix(multiplyMatrix(globalTransform, inheritedTransform), elemTransform);

    // Parse and transform points
    let pts = [];
    for (let i = 0; i < nums.length - 1; i += 2) {
        pts.push(transformPoint(parseFloat(nums[i]), parseFloat(nums[i + 1]), transform));
    }

    // Calculate bounding box
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    const stroke = getElemAttr(elem, 'stroke');
    const fill = getElemAttr(elem, 'fill');
    const strokeWidth = getElemAttr(elem, 'stroke-width');
    const fillOpacity = getElemAttr(elem, 'fill-opacity');
    const strokeOpacity = getElemAttr(elem, 'stroke-opacity');
    const strokeDasharray = getElemAttr(elem, 'stroke-dasharray');
    const opacity = getElemAttr(elem, 'opacity');

    let borderType = 'solid';
    if (strokeDasharray && strokeDasharray !== 'none') {
        const parts = strokeDasharray.split(/[\s,]+/).map(parseFloat);
        if (parts.length >= 2) {
            borderType = parts[1] / parts[0] > 1 ? 'dotted' : 'dashed';
        }
    }

    // Store normalized points (relative to bounding box)
    const normalizedPts = pts.map(p => ({
        x: (p.x - minX) / (maxX - minX || 1),
        y: (p.y - minY) / (maxY - minY || 1)
    }));

    const result = {
        id: generateId(),
        lastMod: Date.now(),
        tool: 'shape',
        shapeType: 'polygon',
        x: minX, y: minY, w: maxX - minX, h: maxY - minY,
        pts: normalizedPts, // Store normalized points for custom polygon
        border: parseColor(stroke) || CONFIG.defaultStroke,
        fill: parseColor(fill) || CONFIG.defaultFill,
        width: (parseFloat(strokeWidth) || CONFIG.defaultStrokeWidth) * getMatrixScale(transform),
        rotation: 0,
        deleted: false
    };

    // Apply group opacity if inherited
    const groupOpacityMultiplier = elem.groupOpacity !== undefined ? elem.groupOpacity : 1;
    const effectiveOpacity = parseOpacity(opacity) * groupOpacityMultiplier;
    if (effectiveOpacity < 1) {
        result.opacity = effectiveOpacity;
    }

    if (fillOpacity !== undefined && parseFloat(fillOpacity) < 1) {
        result.fillOpacity = parseFloat(fillOpacity);
    }
    if (strokeOpacity !== undefined && parseFloat(strokeOpacity) < 1) {
        result.borderOpacity = parseFloat(strokeOpacity);
    }
    if (borderType !== 'solid') {
        result.borderType = borderType;
    }

    return result;
}

function convertText(elem, globalTransform) {
    // Get text content - strip tags but preserve text
    const text = elem.innerContent.replace(/<[^>]*>/g, '').trim();
    if (!text) return null;

    // Try to get position from tspan first, then fall back to text element
    let x = 0, y = 0;

    // Parse tspan for position - tspan often has the actual x/y
    const tspanMatch = elem.innerContent.match(/<tspan[^>]*\s+x="([^"]+)"[^>]*\s+y="([^"]+)"/);
    const tspanMatchAlt = elem.innerContent.match(/<tspan[^>]*\s+y="([^"]+)"[^>]*\s+x="([^"]+)"/);

    if (tspanMatch) {
        // x might be multiple values (kerning) - take the first
        const xVals = tspanMatch[1].split(/\s+/);
        x = parseFloat(xVals[0]) || 0;
        y = parseFloat(tspanMatch[2]) || 0;
    } else if (tspanMatchAlt) {
        const xVals = tspanMatchAlt[2].split(/\s+/);
        x = parseFloat(xVals[0]) || 0;
        y = parseFloat(tspanMatchAlt[1]) || 0;
    } else {
        // Fall back to text element attributes
        x = parseFloat(getElemAttr(elem, 'x')) || 0;
        y = parseFloat(getElemAttr(elem, 'y')) || 0;
    }

    // Combine inherited transform with element's own transform
    const elemTransformStr = getElemAttr(elem, 'transform');
    const elemTransform = parseTransform(elemTransformStr);
    const inheritedTransform = elem.inheritedTransform || identityMatrix();
    const transform = multiplyMatrix(multiplyMatrix(globalTransform, inheritedTransform), elemTransform);

    const fill = getElemAttr(elem, 'fill');
    const fontSize = getElemAttr(elem, 'font-size');
    const fontFamily = getElemAttr(elem, 'font-family');
    const pos = transformPoint(x, y, transform);
    const size = (parseFloat(fontSize) || 16) * getMatrixScale(transform);

    const result = {
        id: generateId(),
        lastMod: Date.now(),
        tool: 'text',
        text,
        x: pos.x, y: pos.y,
        size,
        color: parseColor(fill) || CONFIG.defaultStroke,
        rotation: 0,
        w: text.length * size * 0.6,
        h: size * 1.2,
        deleted: false
    };

    // Store font family if present
    if (fontFamily) {
        result.fontFamily = fontFamily;
    }

    // Store original SVG structure for precise roundtrip
    // This preserves kerning, transforms, tspans, etc.
    const xmlSpace = getElemAttr(elem, 'xml:space');
    if (elemTransformStr || elem.innerContent.includes('<tspan')) {
        result.svgData = {
            transform: elemTransformStr || null,
            xmlSpace: xmlSpace || null,
            fontSize: fontSize || null,
            fontFamily: fontFamily || null,
            fill: fill || null,
            innerContent: elem.innerContent
        };
    }

    return result;
}

function convertImage(elem, globalTransform, warnings) {
    const x = parseFloat(getElemAttr(elem, 'x')) || 0;
    const y = parseFloat(getElemAttr(elem, 'y')) || 0;
    const w = parseFloat(getElemAttr(elem, 'width')) || 0;
    const h = parseFloat(getElemAttr(elem, 'height')) || 0;
    const href = getElemAttr(elem, 'href') || getElemAttr(elem, 'xlink:href');

    if (!href) return null;

    // Skip images with zero dimensions
    if (w === 0 || h === 0) {
        warnings.push('Warning: Image with zero dimensions skipped');
        return null;
    }

    // Combine inherited transform with element's own transform
    const elemTransformStr = getElemAttr(elem, 'transform');
    const elemTransform = parseTransform(elemTransformStr);
    const inheritedTransform = elem.inheritedTransform || identityMatrix();
    const transform = multiplyMatrix(multiplyMatrix(globalTransform, inheritedTransform), elemTransform);

    const topLeft = transformPoint(x, y, transform);
    const bottomRight = transformPoint(x + w, y + h, transform);

    if (href.startsWith('data:') && href.length > CONFIG.base64WarnSize) {
        warnings.push(`Warning: Large embedded image (${Math.round(href.length / 1024)}KB)`);
    }

    // Get opacity (may be inherited from group)
    const opacity = getElemAttr(elem, 'opacity');
    const groupOpacity = elem.groupOpacity !== undefined ? elem.groupOpacity : 1;
    const effectiveOpacity = parseOpacity(opacity) * groupOpacity;

    // Check for mask (warn if present since we can't fully support it)
    const mask = getElemAttr(elem, 'mask');
    if (mask) {
        warnings.push(`Warning: Image has mask "${mask}" which may not render correctly`);
    }

    const result = {
        id: generateId(),
        lastMod: Date.now(),
        tool: 'image',
        x: topLeft.x, y: topLeft.y,
        w: Math.abs(bottomRight.x - topLeft.x),
        h: Math.abs(bottomRight.y - topLeft.y),
        src: href,
        rotation: 0,
        deleted: false
    };

    // Add opacity if not fully opaque
    if (effectiveOpacity < 1) {
        result.opacity = effectiveOpacity;
    }

    // Add mask data if this image has a mask applied
    if (elem.maskId && maskDefinitions[elem.maskId]) {
        result.mask = {
            id: elem.maskId,
            type: maskDefinitions[elem.maskId].type,
            src: maskDefinitions[elem.maskId].imageData
        };
    }

    return result;
}

// ============================================
// MAIN CONVERTER
// ============================================

function convertSVG(svgContent) {
    const history = [];
    const warnings = [];

    // Get SVG attributes
    const svgMatch = svgContent.match(/<(?:\w+:)?svg\s+([^>]*)>/i);
    if (!svgMatch) return { metadata: { error: 'No SVG element found' }, history: [] };

    const svgAttrs = svgMatch[1];
    const viewBoxMatch = svgAttrs.match(/viewBox="([^"]*)"/);
    let viewBox = null, viewBoxOffset = { x: 0, y: 0 };

    if (viewBoxMatch) {
        const parts = viewBoxMatch[1].split(/[\s,]+/).map(parseFloat);
        viewBox = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
        viewBoxOffset = { x: -parts[0], y: -parts[1] };
    }

    const widthMatch = svgAttrs.match(/width="([^"]*)"/);
    const heightMatch = svgAttrs.match(/height="([^"]*)"/);
    const svgWidth = parseFloat(widthMatch?.[1]) || viewBox?.w || 800;
    const svgHeight = parseFloat(heightMatch?.[1]) || viewBox?.h || 600;

    // Initial transform for viewBox offset
    let transform = identityMatrix();
    if (viewBoxOffset.x !== 0 || viewBoxOffset.y !== 0) {
        transform = [1, 0, 0, 1, viewBoxOffset.x, viewBoxOffset.y];
    }

    // Extract SVG content
    const svgContentMatch = svgContent.match(/<(?:\w+:)?svg[^>]*>([\s\S]*)<\/(?:\w+:)?svg>/i);
    if (!svgContentMatch) return { metadata: { error: 'Could not extract SVG content' }, history: [] };

    // Keep defs - we now process mask/clippath content to include all images
    const cleanedContent = svgContentMatch[1];

    // Collect all elements in order
    console.log('Collecting elements in document order...');
    const elements = collectAllElements(cleanedContent);
    console.log(`Found ${elements.length} elements`);

    // Detect and merge path pairs
    console.log('Detecting fill+stroke path pairs...');
    const mergedElements = detectPathPairs(elements);
    console.log(`After merging: ${mergedElements.length} elements (${elements.length - mergedElements.length} pairs merged)`);

    // Convert each element
    console.log('Converting elements...');
    for (const elem of mergedElements) {
        try {
            let item = null;
            switch (elem.tag) {
                case 'path': item = convertPath(elem, transform); break;
                case 'rect': item = convertRect(elem, transform); break;
                case 'circle': item = convertCircle(elem, transform); break;
                case 'ellipse': item = convertEllipse(elem, transform); break;
                case 'line': item = convertLine(elem, transform); break;
                case 'polyline': item = convertPolyline(elem, transform, false); break;
                case 'polygon': item = convertPolygonShape(elem, transform); break;
                case 'text': item = convertText(elem, transform); break;
                case 'image': item = convertImage(elem, transform, warnings); break;
            }
            if (item) history.push(item);
        } catch (e) {
            warnings.push(`${elem.tag} conversion error: ${e.message}`);
        }
    }

    // Statistics
    const stats = { pen: 0, highlighter: 0, shape: 0, text: 0, image: 0 };
    history.forEach(item => { if (stats[item.tool] !== undefined) stats[item.tool]++; });

    console.log('Conversion statistics:');
    for (const [type, count] of Object.entries(stats)) {
        if (count > 0) console.log(`  ${type}: ${count} elements`);
    }

    if (warnings.length > 0) {
        console.log('\nWarnings:');
        warnings.forEach(w => console.log(`  ${w}`));
    }

    // Post-process: Detect background images
    // Images that cover the full document are likely backgrounds
    const TOLERANCE = 0.05; // 5% tolerance for size matching
    const docWidth = svgWidth;
    const docHeight = svgHeight;

    for (const item of history) {
        if (item.tool === 'image') {
            const widthRatio = item.w / docWidth;
            const heightRatio = item.h / docHeight;
            const xNearZero = Math.abs(item.x) < docWidth * TOLERANCE;
            const yNearZero = Math.abs(item.y) < docHeight * TOLERANCE;
            const widthMatch = widthRatio > (1 - TOLERANCE) && widthRatio < (1 + TOLERANCE);
            const heightMatch = heightRatio > (1 - TOLERANCE) && heightRatio < (1 + TOLERANCE);

            if (xNearZero && yNearZero && widthMatch && heightMatch) {
                item.isBackground = true;
            }
        }
    }

    // Count backgrounds
    const backgroundCount = history.filter(i => i.isBackground).length;
    if (backgroundCount > 0) {
        console.log(`Detected ${backgroundCount} background image(s)`);
    }

    return {
        metadata: {
            version: 2,  // New format version
            sourceType: 'svg',
            width: svgWidth,
            height: svgHeight,
            viewBox,
            elementCount: history.length,
            statistics: stats,
            backgroundCount
        },
        history
    };
}

// ============================================
// CLI
// ============================================

function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log(`
SVG to ColorRM Converter - Pro Version v3
==========================================

Usage: node svg-to-colorrm.cjs <input.svg> [output.json]

FIXES in v3:
  ✓ Recursively processes elements inside groups
  ✓ Applies inherited transforms from parent groups
  ✓ Applies per-element transforms
  ✓ Disabled simplification to preserve hand-drawn curves
  ✓ Always preserves opacity values for highlighters

PREVIOUS (v2):
  ✓ Preserves element order (z-order)
  ✓ Detects fill+stroke path pairs and merges them
  ✓ Uses fill color, stroke width from pairs
  ✓ Properly maps low opacity to highlighter tool
`);
        process.exit(0);
    }

    const inputFile = args[0];
    const outputFile = args[1] || inputFile.replace(/\.svg$/i, '.colorrm.json');

    if (!fs.existsSync(inputFile)) {
        console.error(`Error: Input file not found: ${inputFile}`);
        process.exit(1);
    }

    console.log(`Reading: ${inputFile}`);
    const svgContent = fs.readFileSync(inputFile, 'utf-8');
    console.log(`File size: ${Math.round(svgContent.length / 1024)}KB`);

    console.log('\nConverting SVG to ColorRM format...');
    const result = convertSVG(svgContent);

    console.log(`\nConversion complete!`);
    console.log(`  Total elements: ${result.history.length}`);
    console.log(`  Canvas size: ${result.metadata.width} x ${result.metadata.height}`);

    console.log(`\nWriting: ${outputFile}`);
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));

    const outputSize = fs.statSync(outputFile).size;
    console.log(`Output size: ${Math.round(outputSize / 1024)}KB`);
    console.log('\nDone!');
}

if (require.main === module) main();

module.exports = { convertSVG, parsePathD, parseTransform, transformPoint, parseColor, simplifyPath, CONFIG };
