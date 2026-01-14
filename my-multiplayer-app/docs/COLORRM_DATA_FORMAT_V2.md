# ColorRM Data Format v2

This document describes the ColorRM JSON data format version 2, used for storing and rendering drawings.

## Format Overview

```json
{
  "metadata": { ... },
  "history": [ ... ]
}
```

## Metadata

```json
{
  "version": 2,
  "sourceType": "svg",
  "width": 800,
  "height": 600,
  "viewBox": { "x": 0, "y": 0, "w": 800, "h": 600 },
  "elementCount": 42,
  "statistics": {
    "pen": 10,
    "highlighter": 5,
    "shape": 8,
    "text": 15,
    "image": 4
  },
  "backgroundCount": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `version` | number | Format version (2 for this spec) |
| `sourceType` | string | Source format ("svg", "native") |
| `width` | number | Document width in pixels |
| `height` | number | Document height in pixels |
| `viewBox` | object | SVG viewBox (if from SVG source) |
| `elementCount` | number | Total number of elements |
| `statistics` | object | Count per tool type |
| `backgroundCount` | number | Number of detected background images |

## History Elements

The `history` array contains drawing elements in z-order (first = bottom, last = top).

### Common Properties (all elements)

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string | Yes | Unique element ID |
| `lastMod` | number | Yes | Last modification timestamp |
| `tool` | string | Yes | Tool type (see below) |
| `deleted` | boolean | No | If true, element is hidden |

### Tool Types

---

## 1. Pen (`tool: "pen"`)

Freehand strokes with solid color.

```json
{
  "id": "abc123",
  "lastMod": 1704067200000,
  "tool": "pen",
  "pts": [
    { "x": 100, "y": 200 },
    { "x": 105, "y": 202 },
    { "x": 110, "y": 205 }
  ],
  "color": "#000000",
  "size": 2,
  "opacity": 1,
  "lineCap": "round",
  "lineJoin": "round",
  "rotation": 0,
  "deleted": false
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `pts` | array | Required | Array of {x, y} points |
| `color` | string | "#000000" | Stroke color (hex) |
| `size` | number | 2 | Stroke width in pixels |
| `opacity` | number | 1 | Opacity (0-1) |
| `lineCap` | string | "round" | Line cap style |
| `lineJoin` | string | "round" | Line join style |

---

## 2. Highlighter (`tool: "highlighter"`)

Semi-transparent strokes, typically wider.

```json
{
  "id": "def456",
  "tool": "highlighter",
  "pts": [...],
  "color": "#FFFF00",
  "size": 20,
  "opacity": 0.4
}
```

Same properties as `pen`, but typically:
- Larger `size` (10-40)
- Lower `opacity` (0.2-0.5)

---

## 3. Shape (`tool: "shape"`)

Geometric shapes with fill and border.

```json
{
  "id": "ghi789",
  "tool": "shape",
  "shapeType": "rectangle",
  "x": 50,
  "y": 100,
  "w": 200,
  "h": 150,
  "fillColor": "#FFCC00",
  "borderColor": "#000000",
  "fillOpacity": 0.5,
  "borderOpacity": 1,
  "borderSize": 2,
  "borderType": "solid",
  "rotation": 0
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `shapeType` | string | "rectangle" | Shape type (see below) |
| `x`, `y` | number | 0 | Position |
| `w`, `h` | number | 100 | Dimensions |
| `fillColor` | string | "transparent" | Fill color |
| `borderColor` | string | "#000000" | Border color |
| `fillOpacity` | number | 1 | Fill opacity |
| `borderOpacity` | number | 1 | Border opacity |
| `borderSize` | number | 2 | Border width |
| `borderType` | string | "solid" | Border style |
| `rotation` | number | 0 | Rotation in degrees |

### Shape Types
- `rectangle` - Rectangular shape
- `ellipse` - Ellipse/oval
- `circle` - Perfect circle
- `triangle` - Triangle
- `arrow` - Arrow shape
- `line` - Straight line
- `polygon` - Custom polygon (uses `pts`)

### Border Types
- `solid` - Solid line
- `dashed` - Dashed line (stroke-dasharray: "10,5")
- `dotted` - Dotted line (stroke-dasharray: "2,3")

### Polygon Shape

When `shapeType: "polygon"`, uses normalized points:

```json
{
  "shapeType": "polygon",
  "x": 100,
  "y": 100,
  "w": 200,
  "h": 150,
  "pts": [
    { "x": 0.5, "y": 0 },
    { "x": 1, "y": 1 },
    { "x": 0, "y": 1 }
  ]
}
```

Points are normalized (0-1) relative to bounding box.

---

## 4. Text (`tool: "text"`)

Text elements with optional SVG data for precise rendering.

```json
{
  "id": "jkl012",
  "tool": "text",
  "text": "Hello World",
  "x": 100,
  "y": 200,
  "size": 16,
  "color": "#000000",
  "fontFamily": "Calibri",
  "w": 120,
  "h": 20,
  "rotation": 0,
  "svgData": {
    "transform": "matrix(1,0,0,1,0,792)",
    "xmlSpace": "preserve",
    "fontSize": "11.04",
    "fontFamily": "Calibri",
    "fill": "#000000",
    "innerContent": "<tspan y=\"-745\" x=\"54 61 67\">Hi</tspan>"
  }
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `text` | string | "" | Plain text content |
| `x`, `y` | number | 0 | Position (transformed) |
| `size` | number | 16 | Font size |
| `color` | string | "#000000" | Text color |
| `fontFamily` | string | "sans-serif" | Font family |
| `w`, `h` | number | auto | Bounding box |
| `svgData` | object | null | Original SVG for precise rendering |

### svgData Object (v2 feature)

For imported SVGs, preserves original formatting:

| Property | Description |
|----------|-------------|
| `transform` | SVG transform attribute |
| `xmlSpace` | xml:space attribute |
| `fontSize` | Original font-size |
| `fontFamily` | Original font-family |
| `fill` | Original fill color |
| `innerContent` | Original tspan/text content |

**Rendering Priority:**
1. If `svgData` exists, render using original SVG structure
2. Otherwise, render using simplified properties

---

## 5. Image (`tool: "image"`)

Embedded or referenced images with optional masking.

```json
{
  "id": "mno345",
  "tool": "image",
  "x": 0,
  "y": 0,
  "w": 800,
  "h": 600,
  "src": "data:image/jpeg;base64,...",
  "rotation": 0,
  "opacity": 1,
  "isBackground": true,
  "mask": {
    "id": "mask_2",
    "type": "luminance",
    "src": "data:image/png;base64,..."
  }
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `x`, `y` | number | 0 | Position |
| `w`, `h` | number | 100 | Dimensions |
| `src` | string | Required | Image source (data URL or URL) |
| `rotation` | number | 0 | Rotation in degrees |
| `opacity` | number | 1 | Opacity |
| `isBackground` | boolean | false | True if full-document size |
| `mask` | object | null | Mask definition |

### Mask Object (v2 feature)

```json
{
  "id": "mask_2",
  "type": "luminance",
  "src": "data:image/png;base64,..."
}
```

| Property | Description |
|----------|-------------|
| `id` | Original mask ID from SVG |
| `type` | Mask type ("luminance" or "alpha") |
| `src` | Mask image (grayscale for luminance) |

**Luminance Mask Rendering:**
- White pixels = fully visible
- Black pixels = fully transparent
- Gray pixels = partial transparency

---

## 6. Group (`tool: "group"`)

Container for grouping elements.

```json
{
  "id": "pqr678",
  "tool": "group",
  "children": ["abc123", "def456"],
  "x": 50,
  "y": 50,
  "w": 300,
  "h": 200,
  "rotation": 0,
  "opacity": 1
}
```

| Property | Type | Description |
|----------|------|-------------|
| `children` | array | Array of element IDs or inline elements |
| `x`, `y`, `w`, `h` | number | Bounding box |

---

## Backwards Compatibility

### Reading Old Data (v1)

- If `metadata.version` is missing, assume v1
- v1 data lacks: `svgData`, `mask`, `isBackground`
- Renderer should handle missing properties with defaults

### Version Detection

```javascript
function getVersion(data) {
  return data.metadata?.version || 1;
}

function isV2(data) {
  return getVersion(data) >= 2;
}
```

---

## Rendering Order

1. **Background images** (`isBackground: true`) - render first
2. **Regular elements** - render in history order (z-index)
3. **Masked images** - apply mask during render

---

## Canvas Rendering Guidelines

### Images with Masks

```javascript
function renderMaskedImage(ctx, item) {
  if (!item.mask) {
    // Simple image render
    ctx.drawImage(img, item.x, item.y, item.w, item.h);
    return;
  }

  // Create offscreen canvas for masking
  const offscreen = new OffscreenCanvas(item.w, item.h);
  const offCtx = offscreen.getContext('2d');

  // Draw content image
  offCtx.drawImage(contentImg, 0, 0, item.w, item.h);

  // Apply luminance mask using globalCompositeOperation
  offCtx.globalCompositeOperation = 'destination-in';
  offCtx.drawImage(maskImg, 0, 0, item.w, item.h);

  // Draw result to main canvas
  ctx.drawImage(offscreen, item.x, item.y);
}
```

### Text with svgData

For precise text rendering (imported SVGs):

```javascript
function renderText(ctx, item) {
  if (item.svgData) {
    // Use SVG rendering for precise positioning
    // Create inline SVG and render to canvas
    const svgStr = `<svg>...</svg>`;
    // Use canvg or similar library
  } else {
    // Simple canvas text
    ctx.font = `${item.size}px ${item.fontFamily}`;
    ctx.fillStyle = item.color;
    ctx.fillText(item.text, item.x, item.y);
  }
}
```

---

## Migration Notes

### From v1 to v2

No migration needed - v2 is backwards compatible. New properties are optional.

### For New Imports

SVG imports will generate v2 data with:
- `svgData` for text elements with complex formatting
- `mask` for masked images
- `isBackground` for full-size images
