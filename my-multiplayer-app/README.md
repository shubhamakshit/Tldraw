# 🎨 Tldraw + ColorRM Multiplayer Hub

A high-performance, production-ready multiplayer whiteboarding and PDF annotation platform. This project combines the power of **tldraw** for infinite canvas collaboration with **ColorRM**, a specialized tool for synchronized PDF markup.

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** (v18+)
- **Cloudflare Account** (for R2 and Workers)
- **Liveblocks Account** (for ColorRM synchronization)

### 2. Installation
```bash
npm install
```

### 3. Environment Setup
Create a `.env` file in the root directory:
```env
LIVEBLOCKS_SECRET_KEY=sk_dev_... # Your Liveblocks secret key
```

### 4. Local Development
Run both the frontend and backend worker simultaneously:
```bash
npm run dev
```
- **Web Hub:** `http://localhost:5173`
- **ColorRM Tool:** `http://localhost:5173/color_rm.html`

---

## 🛠 Features & Architecture

### 1. Tldraw Multiplayer (Durable Objects)
The main hub uses **Cloudflare Durable Objects** to create low-latency WebSocket rooms. Each room is a miniature server instance that scales automatically.
- **Storage:** R2 Bucket for whiteboard state and assets.
- **Limit:** ~50 simultaneous users per room.

### 2. ColorRM Pro (Liveblocks)
A specialized PDF annotator built for high-performance collaboration.
- **User-Centric Rooms:** Uses a "One Room Per User" model to stay within Liveblocks limits.
- **Hierarchy:** Projects are nested within user rooms (`room_[userId] -> projects[projectId]`).
- **Stable URLs:** Dual-ID routing (`#/color_rm/[ownerId]/[projectId]`) ensures shared links never break.
- **Streaming Uploads:** PDF processing is incremental; start drawing the moment the first page is ready.

### 3. Android Integration (Capacitor)
Includes a native Android wrapper with:
- **S-Pen Hardware Support:** Hardware button toggles the eraser tool.
- **Native File Export:** Direct saving to the device's `Downloads` folder.

---

## 📱 Mobile Development

To test on an Android device:
1.  Ensure your phone is on the same Wi-Fi.
2.  Run the local sync build:
    ```bash
    npm run build:local
    npm run capacitor:sync:local
    npm run capacitor:open:local
    ```

---

## 🧹 Maintenance & Diagnostics

### Wipe Collaborative Data
To clear all remote rooms and start fresh on the backend:
```bash
node cmd/wipe_liveblocks.mjs
```
*Note: You must also clear your browser's "Site Data" (IndexedDB) to remove local caches.*

### Debug Sidebar
In the **ColorRM** tool, open the sidebar and click the **"Debug"** tab to see:
- Real-time Sync Status
- Remote Stroke Counts
- User & Project IDs
- Manual History Reconciliation button

---

## 🌐 Deployment

1.  **Configure Wrangler:** Update `bucket_name` in `wrangler.toml`.
2.  **Add Secrets:**
    ```bash
    npx wrangler secret put LIVEBLOCKS_SECRET_KEY
    ```
3.  **Deploy:**
    ```bash
    npm run build
    npx wrangler deploy
    ```

## 📄 License
This project is licensed under the MIT License. Tldraw SDK components follow the Tldraw license.