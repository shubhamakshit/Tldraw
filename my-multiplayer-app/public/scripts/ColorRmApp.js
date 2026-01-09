import { ColorRmRenderer } from './modules/ColorRmRenderer.js';
import { ColorRmStorage } from './modules/ColorRmStorage.js';
import { ColorRmBox } from './modules/ColorRmBox.js';
import { ColorRmInput } from './modules/ColorRmInput.js';
import { ColorRmUI } from './modules/ColorRmUI.js';
import { ColorRmSession } from './modules/ColorRmSession.js';
import { ColorRmExport } from './modules/ColorRmExport.js';

export class ColorRmApp {
    constructor(config = {}) {
        this.config = {
            isMain: true,
            container: null,
            collaborative: true, // Set to false for local-only mode (split view)
            dbName: 'ColorRM_SOTA_V12', // Allow separate DB for split view
            ...config
        };

        this.container = this.config.container;

        this.state = {
            sessionId: null, images: [], idx: 0,
            colors: [], customSwatches: JSON.parse(localStorage.getItem('crm_custom_colors') || '[]'),
            strict: 15, tool: 'none', bg: 'transparent',
            penColor: '#ef4444', penSize: 3, eraserSize: 20, eraserType: 'stroke',
            textSize: 40,
            shapeType: 'rectangle', shapeBorder: '#3b82f6', shapeFill: 'transparent', shapeWidth: 3,
            selection: [], dlSelection: [], isLivePreview: false, guideLines: [], activeShapeRatio: false, previewOn: false,
            bookmarks: [], activeSideTab: 'tools', projectName: "Untitled", baseFileName: null,
            clipboardBox: [],
            ownerId: null, pageLocked: false,
            selectedSessions: new Set(), isMultiSelect: false, showCursors: true,
            zoom: 1, pan: { x: 0, y: 0 },
            // Eraser options
            eraserOptions: {
                scribble: true,
                text: true,
                shapes: true,
                images: false
            }
        };

        this.cache = {
            currentImg: null,
            lab: null,
            // Offscreen canvas for caching committed strokes
            committedCanvas: null,
            committedCtx: null,
            lastHistoryLength: 0,  // Track when to invalidate cache
            isDirty: true  // Flag to rebuild cache
        };
        this.db = null;

        // Performance flags
        this.renderPending = false;
        this.saveTimeout = null;
        this.ui = null;
        this.liveSync = null;
        this.registry = null;
        this.iroP = null;

        this.lastCursorUpdateTime = 0;
        this.cursorUpdateThrottle = 30; // 30ms throttle, approx 33fps
    }

    async init(ui, registry, LiveSyncClient) {
        this.ui = ui;
        this.registry = registry;

        // 1. Initialize Database (use configured DB name)
        this.db = await new Promise(r => {
            const req = indexedDB.open(this.config.dbName, 2);
            req.onupgradeneeded = e => {
                const d = e.target.result;
                if(!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', { keyPath: 'id' });
                if(!d.objectStoreNames.contains('pages')) d.createObjectStore('pages', { keyPath: 'id' }).createIndex('sessionId','sessionId');
                if(!d.objectStoreNames.contains('folders')) d.createObjectStore('folders', { keyPath: 'id' });
            };
            req.onsuccess = e => r(e.target.result);
        });

        // Only sync registry for collaborative mode
        if (this.config.collaborative && this.registry) {
            await this.registry.sync();
        }

        // 2. Setup UI
        this.setupUI();
        this.setupDrawing();
        this.makeDraggable();
        this.setupShortcuts();

        // 3. Initialize PDF.js Worker
        if (window.pdfjsLib) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        // 4. Initialize Liveblocks Room & Project Mapping (only for collaborative mode)
        let ownerId, projectId;

        if (this.config.collaborative && LiveSyncClient) {
            this.liveSync = new LiveSyncClient(this);

            // Failsafe for missing userId
            const regUser = this.registry ? this.registry.getUsername() : null;
            if (regUser) this.liveSync.userId = regUser;

            if (!this.liveSync.userId) {
                this.liveSync.userId = `user_${Math.random().toString(36).substring(2, 9)}`;
                localStorage.setItem('color_rm_user_id', this.liveSync.userId);
            }
        } else {
             // Ensure LiveSync is null if not collaborative
             this.liveSync = null;
        }

        if (this.config.isMain) {
            // Parse URL for Main App
            const hashPath = window.location.hash.replace(/^#\/?/, '');
            const parts = hashPath.split('/').filter(Boolean);
            ownerId = parts[1];
            projectId = parts[2];

            // If owner or project is missing from URL, try to load last project OR show dashboard
            if (!ownerId || !projectId) {
                const lastSess = await this.db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
                if (lastSess && lastSess.length > 0) {
                    const latest = lastSess.sort((a,b) => b.lastMod - a.lastMod)[0];
                    ownerId = latest.ownerId || (this.liveSync ? this.liveSync.userId : 'local');
                    projectId = latest.id;
                    window.location.replace(`#/color_rm/${ownerId}/${projectId}`);
                } else {
                    this.ui.showDashboard();
                    return;
                }
            }
        } else {
            // Secondary App: Use config provided IDs or default to empty/new
            ownerId = this.config.ownerId || (this.liveSync ? this.liveSync.userId : 'local');
            projectId = this.config.projectId;

            if (!projectId) {
                // If no project provided for split view, wait for PDF import
                console.log("ColorRmApp (Secondary): No projectId provided. Ready for import.");
                return;
            }
        }

        this.state.ownerId = ownerId;
        this.state.sessionId = projectId;

        await this.openSession(projectId);

        // Only initialize LiveSync for collaborative mode
        if (this.config.collaborative && this.liveSync) {
            await this.liveSync.init(ownerId, projectId);
        }

        // 5. Sync Base File (only for collaborative mode)
        if (this.config.collaborative) {
            try {
                const res = await fetch(window.Config?.apiUrl(`/api/color_rm/base_file/${projectId}`) || `/api/color_rm/base_file/${projectId}`, { method: 'GET' });
                if (res.ok) {
                    if (this.state.images.length === 0) {
                        console.log("Liveblocks: Downloading base file from server...");
                        const blob = await res.blob();
                        await this.importBaseFile(blob);
                        if (this.liveSync && this.liveSync.syncHistory) this.liveSync.syncHistory();
                    }
                } else if (res.status === 404) {
                    if (this.state.images.length > 0 && this.state.images[0].blob) {
                        console.log("Liveblocks: Server missing base file. Healing/Uploading...");
                        this.reuploadBaseFile();
                    }
                }
            } catch(e) {
                console.error("Liveblocks: Sync check error:", e);
            }
        }
    }

    getElement(id) {
        if (this.container) {
            // Try scoped lookup first
            const el = this.container.querySelector(`#${id}`);
            if (el) return el;

            // Optional: fallback to class or data attribute if we move away from IDs
            const dataEl = this.container.querySelector(`[data-id="${id}"]`);
            if (dataEl) return dataEl;

            // When container is set, do NOT fall back to document.getElementById
            return null;
        }
        return document.getElementById(id);
    }

    async openSession(id) {
        this.state.sessionId = id;
        const session = await this.dbGet('sessions', id);
        if(session) {
            this.state.projectName = session.name || "Untitled";
            this.state.ownerId = session.ownerId || this.state.ownerId;
            const titleEl = this.getElement('headerTitle');
            if (titleEl) titleEl.innerText = session.name;
            if(session.state) Object.assign(this.state, session.state);
            if(!this.state.bookmarks) this.state.bookmarks = [];
            if(!this.state.clipboardBox) this.state.clipboardBox = [];
            if(this.state.showCursors === undefined) this.state.showCursors = true;
            const cToggle = this.getElement('cursorToggle');
            if(cToggle) cToggle.checked = this.state.showCursors;
            this.renderBookmarks();
            if(this.liveSync && this.liveSync.renderCursors) this.liveSync.renderCursors();
        }

        return new Promise((resolve) => {
            const q = this.db.transaction('pages').objectStore('pages').index('sessionId').getAll(id);
            q.onsuccess = () => {
                this.state.images = q.result.sort((a,b)=>a.pageIndex-b.pageIndex);
                this.ui.hideDashboard();
                this.updateLockUI();
                const targetIdx = (session && session.idx !== undefined) ? session.idx : 0;
                if(this.state.images.length>0) {
                    this.loadPage(targetIdx).then(resolve);
                } else {
                    resolve();
                }
                if(this.state.activeSideTab === 'pages') this.renderPageSidebar();
                if(this.state.activeSideTab === 'box') this.renderBox();
            }
            q.onerror = () => resolve();
        });
    }

    async loadPage(i, broadcast = true) {
        if(i<0 || i>=this.state.images.length) return;

        // Auto-compact current page before switching (if leaving a page)
        if (this.state.idx !== i && this.state.images[this.state.idx]) {
            this.checkAutoCompact();
        }

        // Invalidate cache when loading new page
        this.invalidateCache();

        // Mark this as a local page change to prevent sync conflicts
        if (broadcast && this.liveSync) {
            this.liveSync.lastLocalPageChange = Date.now();
        }

        if (this.liveSync) {
            const project = this.liveSync.getProject();
            if (project) {
                const remoteHistory = project.get("pagesHistory").get(i.toString());
                if (remoteHistory) {
                    this.state.images[i].history = remoteHistory.toArray();
                }
            }
        }

        if (broadcast && this.state.pageLocked && this.state.ownerId !== this.liveSync.userId) {
            this.ui.showToast("Page is locked by presenter.");
            return;
        }

        let item = this.state.images[i];
        if (!item) {
            console.warn(`Page ${i} missing from state. Skipping loadPage.`);
            return;
        }

        // If the page doesn't have a blob, try to fetch it from the backend
        if (!item.blob && this.config.collaborative && this.state.ownerId) {
            try {
                const response = await fetch(window.Config?.apiUrl(`/api/color_rm/page_file/${this.state.sessionId}/${i}`) || `/api/color_rm/page_file/${this.state.sessionId}/${i}`);
                if (response.ok) {
                    const blob = await response.blob();
                    item.blob = blob;
                    // Update the database with the fetched blob
                    await this.dbPut('pages', item);
                } else {
                    console.warn(`Page ${i} not found on backend. Attempting to fetch from base file...`);
                    // If page not found, try to get base file (first page)
                    if (i === 0) {
                        const baseResponse = await fetch(window.Config?.apiUrl(`/api/color_rm/base_file/${this.state.sessionId}`) || `/api/color_rm/base_file/${this.state.sessionId}`);
                        if (baseResponse.ok) {
                            const blob = await baseResponse.blob();
                            item.blob = blob;
                            await this.dbPut('pages', item);
                        }
                    }
                }
            } catch (err) {
                console.error(`Error fetching page ${i} from backend:`, err);
            }
        }

        if (!item || !item.blob) {
            console.warn(`Page ${i} missing blob data. Skipping loadPage.`);
            return;
        }

        this.state.idx = i;
        const pageInput = this.getElement('pageInput');
        if (pageInput) pageInput.value = i + 1;
        const pageTotal = this.getElement('pageTotal');
        if (pageTotal) pageTotal.innerText = '/ ' + this.state.images.length;

        this.renderBookmarks();

        if(!item.history) item.history = [];

        // Revoke old page blob URL to prevent memory leak
        if (this.currentPageBlobUrl) {
            URL.revokeObjectURL(this.currentPageBlobUrl);
        }

        const img = new Image();
        this.currentPageBlobUrl = URL.createObjectURL(item.blob);
        img.src = this.currentPageBlobUrl;
        return new Promise((resolve) => {
            img.onload = () => {
                this.cache.currentImg = img;

                const c = this.getElement('canvas');
                if (!c) return resolve();
                const max = 2000;
                let w=img.width, h=img.height;
                if(w>max || h>max) { const r = Math.min(max/w, max/h); w*=r; h*=r; }
                c.width=w; c.height=h; this.state.viewW=w; this.state.viewH=h;

                const ctx = c.getContext('2d', {willReadFrequently:true});
                ctx.drawImage(img,0,0,w,h);
                const d = ctx.getImageData(0,0,w,h).data;
                this.cache.lab = new Float32Array(w*h*3);
                for(let k=0,j=0; k<d.length; k+=4,j+=3) {
                    const [l,a,b] = this.rgbToLab(d[k],d[k+1],d[k+2]);
                    this.cache.lab[j]=l; this.cache.lab[j+1]=a; this.cache.lab[j+2]=b;
                }

                this.render();
                if (broadcast) {
                    this.saveSessionState();
                }
                resolve();
            };
        });
    }
}

// Mixin all modules into the prototype
Object.assign(ColorRmApp.prototype, ColorRmRenderer);
Object.assign(ColorRmApp.prototype, ColorRmStorage);
Object.assign(ColorRmApp.prototype, ColorRmBox);
Object.assign(ColorRmApp.prototype, ColorRmInput);
Object.assign(ColorRmApp.prototype, ColorRmUI);
Object.assign(ColorRmApp.prototype, ColorRmSession);
Object.assign(ColorRmApp.prototype, ColorRmExport);

// Ensure the app instance has access to export methods for other modules
ColorRmApp.prototype.sanitizeFilename = ColorRmExport.sanitizeFilename;

// The methods are already properly mixed in via Object.assign, so no need to rebind them
// The functions are already bound to the prototype correctly