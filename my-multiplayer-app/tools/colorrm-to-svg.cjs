#!/usr/bin/env node
/**
 * ColorRM to SVG Converter - Pro Version
 *
 * Converts ColorRM JSON format back to SVG for round-trip testing.
 * Handles all ColorRM properties including:
 * - opacity (global alpha)
 * - lineCap, lineJoin
 * - highlighter tool
 * - shapes, text, images, groups
 *
 * Usage: node colorrm-to-svg.cjs input.json [output.svg]
 */

const fs = require('fs');
const path = require('path');

// Convert a color object or string to SVG color
function toSvgColor(color) {
    if (!color) return 'black';
    if (typeof color === 'string') return color;
    if (color.r !== undefined) {
        const a = color.a !== undefined ? color.a : 1;
        if (a < 1) {
            return `rgba(${color.r},${color.g},${color.b},${a})`;
        }
        return `rgb(${color.r},${color.g},${color.b})`;
    }
    return 'black';
}

// Build opacity attribute string
function opacityAttr(item) {
    if (item.opacity !== undefined && item.opacity < 1) {
        return ` opacity="${item.opacity.toFixed(4)}"`;
    }
    return '';
}

// Build stroke properties string
function strokeProps(item, defaultCap = 'round', defaultJoin = 'round') {
    const lineCap = item.lineCap || defaultCap;
    const lineJoin = item.lineJoin || defaultJoin;
    return ` stroke-linecap="${lineCap}" stroke-linejoin="${lineJoin}"`;
}

// Convert pen stroke to SVG path
function penToSvg(item) {
    if (!item.pts || item.pts.length === 0) return '';

    const color = toSvgColor(item.color);
    const strokeWidth = item.size || 2;

    // Build path d attribute
    let d = `M ${item.pts[0].x.toFixed(2)} ${item.pts[0].y.toFixed(2)}`;
    for (let i = 1; i < item.pts.length; i++) {
        d += ` L ${item.pts[i].x.toFixed(2)} ${item.pts[i].y.toFixed(2)}`;
    }

    const transform = item.rotation ? ` transform="rotate(${item.rotation})"` : '';
    const opacity = opacityAttr(item);
    const strokeAttrs = strokeProps(item);

    return `  <path d="${d}" stroke="${color}" stroke-width="${strokeWidth}" fill="none"${strokeAttrs}${opacity}${transform}/>`;
}

// Convert highlighter stroke to SVG path with opacity
function highlighterToSvg(item) {
    if (!item.pts || item.pts.length === 0) return '';

    const color = toSvgColor(item.color);
    const strokeWidth = item.size || 20;

    let d = `M ${item.pts[0].x.toFixed(2)} ${item.pts[0].y.toFixed(2)}`;
    for (let i = 1; i < item.pts.length; i++) {
        d += ` L ${item.pts[i].x.toFixed(2)} ${item.pts[i].y.toFixed(2)}`;
    }

    const transform = item.rotation ? ` transform="rotate(${item.rotation})"` : '';
    const strokeAttrs = strokeProps(item);

    // Highlighter uses its own opacity or defaults to 0.4
    const effectiveOpacity = item.opacity !== undefined ? item.opacity : 0.4;

    return `  <path d="${d}" stroke="${color}" stroke-width="${strokeWidth}" fill="none"${strokeAttrs} opacity="${effectiveOpacity.toFixed(4)}"${transform}/>`;
}

// Convert shape to SVG element
function shapeToSvg(item) {
    const x = item.x || 0;
    const y = item.y || 0;
    const w = item.width || item.w || 100;
    const h = item.height || item.h || 100;
    const strokeWidth = item.borderSize || item.width || 2;
    const rotation = item.rotation || 0;

    // Handle fill with separate opacity (support both fillColor and fill)
    let fill = 'none';
    const fillColorVal = item.fillColor || item.fill;
    if (fillColorVal && fillColorVal !== 'transparent') {
        if (item.fillOpacity !== undefined && item.fillOpacity < 1) {
            // Apply fill opacity using rgba
            const fillColor = fillColorVal;
            if (fillColor.startsWith('#')) {
                const r = parseInt(fillColor.slice(1, 3), 16);
                const g = parseInt(fillColor.slice(3, 5), 16);
                const b = parseInt(fillColor.slice(5, 7), 16);
                fill = `rgba(${r},${g},${b},${item.fillOpacity.toFixed(4)})`;
            } else {
                fill = toSvgColor(fillColor);
            }
        } else {
            fill = toSvgColor(fillColorVal);
        }
    }

    // Handle border with separate opacity (support both borderColor and border)
    const borderColorVal = item.borderColor || item.border || '#000000';
    let border = toSvgColor(borderColorVal);
    if (item.borderOpacity !== undefined && item.borderOpacity < 1) {
        if (borderColorVal && borderColorVal.startsWith('#')) {
            const r = parseInt(borderColorVal.slice(1, 3), 16);
            const g = parseInt(borderColorVal.slice(3, 5), 16);
            const b = parseInt(borderColorVal.slice(5, 7), 16);
            border = `rgba(${r},${g},${b},${item.borderOpacity.toFixed(4)})`;
        }
    }

    // Handle border dash pattern
    let strokeDasharray = '';
    if (item.borderType === 'dashed') {
        strokeDasharray = ` stroke-dasharray="${strokeWidth * 4},${strokeWidth * 2}"`;
    } else if (item.borderType === 'dotted') {
        strokeDasharray = ` stroke-dasharray="${strokeWidth},${strokeWidth * 2}"`;
    }

    const opacity = opacityAttr(item);

    // Calculate center for rotation
    const cx = x + w / 2;
    const cy = y + h / 2;
    const transform = rotation ? ` transform="rotate(${rotation} ${cx} ${cy})"` : '';

    switch (item.shapeType) {
        case 'rectangle':
        case 'roundedRect':
            return `  <rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${border}" fill="${fill}" stroke-width="${strokeWidth}"${strokeDasharray}${opacity}${transform}/>`;

        case 'ellipse':
        case 'circle':
            const rx = w / 2;
            const ry = h / 2;
            return `  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${border}" fill="${fill}" stroke-width="${strokeWidth}"${strokeDasharray}${opacity}${transform}/>`;

        case 'triangle':
            const p1 = `${cx},${y}`;
            const p2 = `${x},${y + h}`;
            const p3 = `${x + w},${y + h}`;
            return `  <polygon points="${p1} ${p2} ${p3}" stroke="${border}" fill="${fill}" stroke-width="${strokeWidth}"${strokeDasharray}${opacity}${transform}/>`;

        case 'diamond':
            const d1 = `${cx},${y}`;
            const d2 = `${x + w},${cy}`;
            const d3 = `${cx},${y + h}`;
            const d4 = `${x},${cy}`;
            return `  <polygon points="${d1} ${d2} ${d3} ${d4}" stroke="${border}" fill="${fill}" stroke-width="${strokeWidth}"${strokeDasharray}${opacity}${transform}/>`;

        case 'star':
            // 5-pointed star
            const starPoints = [];
            const outerR = Math.min(w, h) / 2;
            const innerR = outerR * 0.4;
            for (let i = 0; i < 10; i++) {
                const angle = (i * 36 - 90) * Math.PI / 180;
                const r = i % 2 === 0 ? outerR : innerR;
                starPoints.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
            }
            return `  <polygon points="${starPoints.join(' ')}" stroke="${border}" fill="${fill}" stroke-width="${strokeWidth}"${strokeDasharray}${opacity}${transform}/>`;

        case 'hexagon':
            const hexPoints = [];
            const hexR = Math.min(w, h) / 2;
            for (let i = 0; i < 6; i++) {
                const angle = (i * 60 - 30) * Math.PI / 180;
                hexPoints.push(`${(cx + hexR * Math.cos(angle)).toFixed(2)},${(cy + hexR * Math.sin(angle)).toFixed(2)}`);
            }
            return `  <polygon points="${hexPoints.join(' ')}" stroke="${border}" fill="${fill}" stroke-width="${strokeWidth}"${strokeDasharray}${opacity}${transform}/>`;

        case 'pentagon':
            const pentPoints = [];
            const pentR = Math.min(w, h) / 2;
            for (let i = 0; i < 5; i++) {
                const angle = (i * 72 - 90) * Math.PI / 180;
                pentPoints.push(`${(cx + pentR * Math.cos(angle)).toFixed(2)},${(cy + pentR * Math.sin(angle)).toFixed(2)}`);
            }
            return `  <polygon points="${pentPoints.join(' ')}" stroke="${border}" fill="${fill}" stroke-width="${strokeWidth}"${strokeDasharray}${opacity}${transform}/>`;

        case 'octagon':
            const octPoints = [];
            const octR = Math.min(w, h) / 2;
            for (let i = 0; i < 8; i++) {
                const angle = (i * 45 - 22.5) * Math.PI / 180;
                octPoints.push(`${(cx + octR * Math.cos(angle)).toFixed(2)},${(cy + octR * Math.sin(angle)).toFixed(2)}`);
            }
            return `  <polygon points="${octPoints.join(' ')}" stroke="${border}" fill="${fill}" stroke-width="${strokeWidth}"${strokeDasharray}${opacity}${transform}/>`;

        case 'polygon':
            // Custom polygon with normalized points
            if (item.pts && item.pts.length >= 3) {
                const polyPoints = item.pts.map(p =>
                    `${(x + p.x * w).toFixed(2)},${(y + p.y * h).toFixed(2)}`
                );
                return `  <polygon points="${polyPoints.join(' ')}" stroke="${border}" fill="${fill}" stroke-width="${strokeWidth}"${strokeDasharray}${opacity}${transform}/>`;
            }
            // Fallback to rectangle if no points
            return `  <rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${border}" fill="${fill}" stroke-width="${strokeWidth}"${strokeDasharray}${opacity}${transform}/>`;

        case 'arrow':
            // Arrow pointing right
            const arrowPath = `M ${x} ${y + h*0.3} L ${x + w*0.6} ${y + h*0.3} L ${x + w*0.6} ${y} L ${x + w} ${y + h/2} L ${x + w*0.6} ${y + h} L ${x + w*0.6} ${y + h*0.7} L ${x} ${y + h*0.7} Z`;
            return `  <path d="${arrowPath}" stroke="${border}" fill="${fill}" stroke-width="${strokeWidth}"${strokeDasharray}${opacity}${transform}/>`;

        case 'line':
            return `  <line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="${border}" stroke-width="${strokeWidth}"${strokeDasharray}${opacity}${transform}/>`;

        default:
            // Default to rectangle
            return `  <rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${border}" fill="${fill}" stroke-width="${strokeWidth}"${strokeDasharray}${opacity}${transform}/>`;
    }
}

// Convert text to SVG text element
function textToSvg(item) {
    // If we have original SVG data, use it for precise reproduction
    if (item.svgData) {
        const svg = item.svgData;
        let attrs = '';
        if (svg.xmlSpace) attrs += ` xml:space="${svg.xmlSpace}"`;
        if (svg.transform) attrs += ` transform="${svg.transform}"`;
        if (svg.fontSize) attrs += ` font-size="${svg.fontSize}"`;
        if (svg.fontFamily) attrs += ` font-family="${svg.fontFamily}"`;
        if (svg.fill) attrs += ` fill="${svg.fill}"`;

        return `  <text${attrs}>${svg.innerContent}</text>`;
    }

    // Fallback to simple text rendering
    const x = item.x || 0;
    const y = item.y || 0;
    const fontSize = item.size || 16;
    const color = toSvgColor(item.color);
    const text = item.text || '';
    const rotation = item.rotation || 0;
    const opacity = opacityAttr(item);
    const fontFamily = item.fontFamily || 'sans-serif';

    const transform = rotation ? ` transform="rotate(${rotation} ${x} ${y})"` : '';

    // Escape XML special characters
    const escapedText = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    // Handle multi-line text
    const lines = escapedText.split('\n');
    if (lines.length === 1) {
        return `  <text x="${x}" y="${y + fontSize}" font-size="${fontSize}" font-family="${fontFamily}" fill="${color}"${opacity}${transform}>${escapedText}</text>`;
    }

    // Multi-line text using tspan
    let svgText = `  <text x="${x}" y="${y + fontSize}" font-size="${fontSize}" font-family="${fontFamily}" fill="${color}"${opacity}${transform}>`;
    lines.forEach((line, i) => {
        if (i === 0) {
            svgText += `<tspan>${line}</tspan>`;
        } else {
            svgText += `<tspan x="${x}" dy="${fontSize * 1.2}">${line}</tspan>`;
        }
    });
    svgText += '</text>';
    return svgText;
}

// Convert image to SVG image element
// Returns { svg: string, maskDef: string|null, maskId: string|null }
function imageToSvg(item) {
    const x = item.x || 0;
    const y = item.y || 0;
    const w = item.w || 100;
    const h = item.h || 100;
    const src = item.src || '';
    const rotation = item.rotation || 0;
    const opacity = opacityAttr(item);

    const cx = x + w / 2;
    const cy = y + h / 2;
    const transform = rotation ? ` transform="rotate(${rotation} ${cx} ${cy})"` : '';

    let imageSvg = `  <image x="${x}" y="${y}" width="${w}" height="${h}" href="${src}"${opacity}${transform}/>`;

    // If this image has a mask, return mask info for defs
    if (item.mask && item.mask.src) {
        const maskId = item.mask.id || `mask_${item.id}`;
        // Mask definition - image inside mask element
        const maskDef = `    <mask id="${maskId}">
      <image x="${x}" y="${y}" width="${w}" height="${h}" href="${item.mask.src}"/>
    </mask>`;
        // Wrap the image in a group with the mask
        imageSvg = `  <g mask="url(#${maskId})">
    <image x="${x}" y="${y}" width="${w}" height="${h}" href="${src}"${opacity}${transform}/>
  </g>`;
        return { svg: imageSvg, maskDef, maskId };
    }

    return { svg: imageSvg, maskDef: null, maskId: null };
}

// Convert group to SVG group element
// Note: Returns string only - mask defs from children won't be captured here
// (Groups with masked images would need more complex handling)
function groupToSvg(item, allItems) {
    if (!item.children || item.children.length === 0) return '';

    const rotation = item.rotation || 0;
    const x = item.x || 0;
    const y = item.y || 0;
    const w = item.w || 0;
    const h = item.h || 0;
    const opacity = opacityAttr(item);

    const cx = x + w / 2;
    const cy = y + h / 2;
    const transform = rotation ? ` transform="rotate(${rotation} ${cx} ${cy})"` : '';

    let content = '';
    for (const child of item.children) {
        // Children can be inline objects or IDs referencing allItems
        let childItem = child;
        if (typeof child === 'string' || typeof child === 'number') {
            childItem = allItems.find(it => it.id === child);
        }
        if (childItem && !childItem.deleted) {
            const result = itemToSvg(childItem, allItems);
            content += '\n' + result.svg;
        }
    }

    return `  <g id="${item.id}"${opacity}${transform}>${content}\n  </g>`;
}

// Convert any item to SVG
// Returns { svg: string, maskDef: string|null } for items that may have masks
function itemToSvg(item, allItems) {
    if (!item || item.deleted) return { svg: '', maskDef: null };

    switch (item.tool) {
        case 'pen':
            return { svg: penToSvg(item), maskDef: null };
        case 'highlighter':
            return { svg: highlighterToSvg(item), maskDef: null };
        case 'shape':
            return { svg: shapeToSvg(item), maskDef: null };
        case 'text':
            return { svg: textToSvg(item), maskDef: null };
        case 'image':
            return imageToSvg(item);  // Already returns { svg, maskDef, maskId }
        case 'group':
            return { svg: groupToSvg(item, allItems), maskDef: null };
        default:
            // Try to handle as pen if it has pts
            if (item.pts) return { svg: penToSvg(item), maskDef: null };
            return { svg: '', maskDef: null };
    }
}

// Main conversion function
function convertToSvg(colorrmData) {
    const metadata = colorrmData.metadata || {};
    const history = colorrmData.history || [];

    // Get canvas dimensions
    const width = metadata.width || 1920;
    const height = metadata.height || 1080;
    const title = metadata.title || 'ColorRM Export';

    // Collect mask definitions and SVG content
    const maskDefs = [];
    const svgElements = [];

    // Track which items are children of groups (to avoid double-rendering)
    const groupChildren = new Set();
    for (const item of history) {
        if (item.tool === 'group' && item.children) {
            for (const child of item.children) {
                // Handle both inline objects and ID references
                if (typeof child === 'object' && child.id) {
                    groupChildren.add(child.id);
                } else {
                    groupChildren.add(child);
                }
            }
        }
    }

    // Convert each item (skip group children as they're rendered inside groups)
    for (const item of history) {
        if (item.deleted) continue;
        if (groupChildren.has(item.id)) continue; // Skip, will be rendered in group

        const result = itemToSvg(item, history);
        if (result.svg) {
            svgElements.push(result.svg);
        }
        if (result.maskDef) {
            maskDefs.push(result.maskDef);
        }
    }

    // Build final SVG with defs section if we have masks
    let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>${title}</title>
  <desc>Exported from ColorRM - Pro Version</desc>
`;

    // Add defs section if we have mask definitions
    if (maskDefs.length > 0) {
        svgContent += `  <defs>\n${maskDefs.join('\n')}\n  </defs>\n`;
    }

    // Add all SVG elements
    svgContent += svgElements.join('\n') + '\n';

    svgContent += '</svg>';
    return svgContent;
}

// CLI interface
function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log(`
ColorRM to SVG Converter - Pro Version
======================================

Usage:
  node colorrm-to-svg.cjs input.json [output.svg]

Converts ColorRM JSON format back to SVG.
If no output file is specified, uses input filename with .roundtrip.svg extension.

Supported Features:
  ✓ Pen strokes with lineCap/lineJoin
  ✓ Highlighter strokes with opacity
  ✓ All shape types (rectangle, ellipse, triangle, etc.)
  ✓ Text elements
  ✓ Images (including base64)
  ✓ Groups with nested items
  ✓ Opacity/transparency
  ✓ Rotation transforms
`);
        process.exit(0);
    }

    const inputFile = args[0];
    const outputFile = args[1] || inputFile.replace(/\.(json|colorrm\.json)$/i, '') + '.roundtrip.svg';

    // Read input file
    console.log(`Reading: ${inputFile}`);
    let content;
    try {
        content = fs.readFileSync(inputFile, 'utf-8');
    } catch (err) {
        console.error(`Error reading file: ${err.message}`);
        process.exit(1);
    }

    // Parse JSON
    let colorrmData;
    try {
        colorrmData = JSON.parse(content);
    } catch (err) {
        console.error(`Error parsing JSON: ${err.message}`);
        process.exit(1);
    }

    // Convert
    console.log('Converting ColorRM to SVG format...');
    const history = colorrmData.history || [];

    // Count elements by type
    const counts = {};
    for (const item of history) {
        if (!item.deleted) {
            const tool = item.tool || 'unknown';
            counts[tool] = (counts[tool] || 0) + 1;
        }
    }

    console.log('Element statistics:');
    for (const [tool, count] of Object.entries(counts)) {
        console.log(`  ${tool}: ${count} elements`);
    }

    const svgContent = convertToSvg(colorrmData);

    // Write output
    console.log(`\nWriting: ${outputFile}`);
    try {
        fs.writeFileSync(outputFile, svgContent, 'utf-8');
    } catch (err) {
        console.error(`Error writing file: ${err.message}`);
        process.exit(1);
    }

    const outputSize = fs.statSync(outputFile).size;
    console.log(`Output size: ${Math.round(outputSize / 1024)}KB`);
    console.log('Done!');
}

// Run if called directly
if (require.main === module) {
    main();
}

// Export for programmatic use
module.exports = {
    convertToSvg,
    itemToSvg,
    penToSvg,
    highlighterToSvg,
    shapeToSvg,
    textToSvg,
    imageToSvg,
    groupToSvg
};
