# ColorRM Pro

A real-time collaborative PDF annotation and drawing application built with modern web technologies.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    color_rm.html                          │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │   │
│  │  │ ColorRm     │  │ ColorRm     │  │ ColorRm         │   │   │
│  │  │ Session.js  │──│ Renderer.js │──│ LiveSync.js     │   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Backend                                  │
│  ┌──────────────────────┐    ┌─────────────────────────────┐    │
│  │  Cloudflare Workers  │    │  HuggingFace Spaces         │    │
│  │  ┌────────────────┐  │    │  ┌───────────────────────┐  │    │
│  │  │ worker.ts      │  │    │  │ Vite Dev Server       │  │    │
│  │  │ - API Routes   │  │    │  │ - Static files        │  │    │
│  │  │ - R2 Storage   │  │    │  │ - PDF Convert (7861)  │  │    │
│  │  └────────────────┘  │    │  └───────────────────────┘  │    │
│  │  ┌────────────────┐  │    └─────────────────────────────┘    │
│  │  │ Durable Objects│  │                                        │
│  │  │ - ColorRm DO   │  │    ┌─────────────────────────────┐    │
│  │  └────────────────┘  │    │  Liveblocks                 │    │
│  └──────────────────────┘    │  - Real-time sync           │    │
│                              │  - Presence                  │    │
│                              │  - Room management           │    │
│                              └─────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Key Modules

### Frontend (`public/scripts/modules/`)

| Module | Description |
|--------|-------------|
| `ColorRmSession.js` | Main application controller. Handles state, tools, page management, import/export |
| `ColorRmRenderer.js` | Canvas rendering engine. Draws strokes, shapes, images, handles transformations |
| `ColorRmStorage.js` | IndexedDB and R2 storage. Manages local persistence and cloud sync |
| `ColorRmLiveSync.js` | Liveblocks integration. Real-time collaboration, cursors, history sync |
| `ColorRmSvgImporter.js` | SVG parsing and import. Converts SVG elements to ColorRM history items |
| `ColorRmSvgExporter.js` | SVG export. Renders history to vector SVG format |

### Backend (`worker/`)

| File | Description |
|------|-------------|
| `worker.ts` | Main Cloudflare Worker entry point. Routes API requests |
| `colorRmAssets.ts` | R2 storage handlers for pages, history, modifications |
| `pdfToSvg.ts` | PDF conversion job management (placeholder for CF Workers) |
| `ColorRmDurableObject.ts` | Durable Object for room state management |

### Commands (`cmd/`)

| Script | Description |
|--------|-------------|
| `pdf_convert_server.mjs` | Local PDF to SVG server using pdf2svg binary |
| `hf_init.mjs` | HuggingFace authentication initialization |
| `hf_backup.mjs` | Periodic backup to HuggingFace Hub |
| `hf_restore.mjs` | Restore from HuggingFace Hub on startup |

## Data Flow

### SVG Import Flow

```
1. User selects SVG file
   │
2. ColorRmSvgImporter.importSvg() parses SVG
   │
3. Elements are classified:
   ├── Images/Text → Rasterized to background blob
   └── Strokes/Shapes → Kept as vector history items
   │
4. Page object created with blob + history
   │
5. Sync to cloud:
   ├── Blob → R2 via _uploadPageBlob()
   ├── History → R2 via /api/color_rm/history/:sessionId/:pageId
   └── Structure → Liveblocks via _syncPageStructureToLive()
   │
6. Other users receive notification via Liveblocks
   │
7. Other users fetch page blob from R2
```

### History Sync (Delta Architecture)

For pages with base history (SVG imports):

```
┌─────────────────────────────────────────────────────────────┐
│                    R2 Storage (Base)                         │
│  /api/color_rm/history/:sessionId/:pageId                   │
│  - Original SVG items (large, stored once)                  │
└─────────────────────────────────────────────────────────────┘
                              +
┌─────────────────────────────────────────────────────────────┐
│                 Liveblocks (Deltas Only)                     │
│  - New strokes added by users                               │
│  - Modifications to base items (position, color, etc.)      │
└─────────────────────────────────────────────────────────────┘
                              =
┌─────────────────────────────────────────────────────────────┐
│                    Final Rendered Page                       │
│  BaseHistory + Deltas + Modifications                       │
└─────────────────────────────────────────────────────────────┘
```

### Thresholds

| Condition | Threshold | Action |
|-----------|-----------|--------|
| SVG page history | > 400 items | Use R2 for base, Liveblocks for deltas |
| Regular page history | > 2000 items | Convert to hybrid R2/Liveblocks |
| Modifications | > 100 items | Store in R2, sync metadata via Liveblocks |

## API Endpoints

### Page Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/color_rm/page/:sessionId/:pageId` | Upload page blob |
| GET | `/api/color_rm/page/:sessionId/:pageId` | Download page blob |
| DELETE | `/api/color_rm/page/:sessionId/:pageId` | Delete page |

### History

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/color_rm/history/:sessionId/:pageId` | Upload base history |
| GET | `/api/color_rm/history/:sessionId/:pageId` | Get base history |

### Page Structure

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/color_rm/page_structure/:sessionId` | Get page order |
| POST | `/api/color_rm/page_structure/:sessionId` | Update page order |

### PDF Conversion (Local Server)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/convert/pdf` | Upload PDF for conversion |
| GET | `/convert/status/:jobId` | Check conversion status |
| GET | `/convert/page/:jobId/:pageNum` | Download converted SVG page |

## Development

### Local Development

```bash
npm install
npm run dev
```

### HuggingFace Spaces Deployment

The Dockerfile runs:
1. `hf_init.mjs` - Authenticate with HF
2. `hf_restore.mjs` - Restore previous state
3. `npm run dev` - Vite dev server (port 7860)
4. `hf_backup.mjs` - Periodic backup worker
5. `pdf_convert_server.mjs` - PDF conversion (port 7861)

### Environment Variables

| Variable | Description |
|----------|-------------|
| `HF_TOKEN` | HuggingFace API token |
| `LIVEBLOCKS_SECRET_KEY` | Liveblocks API key |
| `PORT` | Dev server port (default: 7860) |

## Tools

| Tool | Shortcut | Description |
|------|----------|-------------|
| Move | V | Select and move objects |
| Hand | H | Pan the canvas |
| Lasso | L | Free-form selection |
| Pen | P | Freehand drawing |
| Shape | S | Draw shapes (rect, ellipse, arrow, etc.) |
| Text | T | Add text annotations |
| Eraser | E | Erase strokes |
| Box/Capture | B | Capture region to clipboard |

## Collaboration Features

- **Real-time cursors**: See other users' cursors
- **Live history sync**: Strokes appear instantly for all users
- **Page structure sync**: Page order synchronized across users
- **Presence indicators**: See who's online in the room
