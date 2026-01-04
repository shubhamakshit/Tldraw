
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
            colors: [], strict: 15, tool: 'none', bg: 'transparent',
            penColor: '#ef4444', penSize: 3, eraserSize: 20, eraserType: 'stroke',
            textSize: 40,
            shapeType: 'rectangle', shapeBorder: '#3b82f6', shapeFill: 'transparent', shapeWidth: 3,
            selection: [], dlSelection: [], isLivePreview: false, guideLines: [], activeShapeRatio: false, previewOn: false,
            bookmarks: [], activeSideTab: 'tools', projectName: "Untitled", baseFileName: null,
            clipboardBox: [],
            ownerId: null, pageLocked: false,
            selectedSessions: new Set(), isMultiSelect: false, showCursors: true,
            zoom: 1, pan: { x: 0, y: 0 }
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
    }

    async init(ui, registry, LiveSyncClient) {
        this.ui = ui;
        this.registry = registry;

        // 1. Initialize Database (use configured DB name)
        this.db = await new Promise(r => {
            const req = indexedDB.open(this.config.dbName, 1);
            req.onupgradeneeded = e => {
                const d = e.target.result;
                if(!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', { keyPath: 'id' });
                if(!d.objectStoreNames.contains('pages')) d.createObjectStore('pages', { keyPath: 'id' }).createIndex('sessionId','sessionId');
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
                const res = await fetch(`/api/color_rm/base_file/${projectId}`, { method: 'GET' });
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
            // Note: querySelector works on the element's subtree.
            // Even if IDs are duplicated in the document, this finds the one inside this container.
            const el = this.container.querySelector(`#${id}`);
            if (el) return el;

            // Optional: fallback to class or data attribute if we move away from IDs
            const dataEl = this.container.querySelector(`[data-id="${id}"]`);
            if (dataEl) return dataEl;

            // When container is set, do NOT fall back to document.getElementById
            // This prevents cross-instance element binding
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

        const item = this.state.images[i];
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

    // Invalidate the cached canvas (call when history changes)
    invalidateCache() {
        this.cache.isDirty = true;
    }

    // Request a render on next animation frame (throttled to 60fps)
    requestRender() {
        if (this.renderPending) return;
        this.renderPending = true;
        requestAnimationFrame(() => {
            this.render();
            this.renderPending = false;
        });
    }

    // Build the cached canvas with all committed strokes
    buildCommittedCache(ctx, currentImg) {
        if (!this.cache.isDirty && this.cache.committedCanvas) {
            return;  // Cache is valid
        }

        const activeHistory = currentImg?.history?.filter(st => !st.deleted) || [];

        // Create or resize offscreen canvas
        if (!this.cache.committedCanvas ||
            this.cache.committedCanvas.width !== this.state.viewW ||
            this.cache.committedCanvas.height !== this.state.viewH) {
            this.cache.committedCanvas = document.createElement('canvas');
            this.cache.committedCanvas.width = this.state.viewW;
            this.cache.committedCanvas.height = this.state.viewH;
            this.cache.committedCtx = this.cache.committedCanvas.getContext('2d');
        }

        const cacheCtx = this.cache.committedCtx;
        cacheCtx.clearRect(0, 0, this.state.viewW, this.state.viewH);

        // Draw all non-selected, committed strokes to cache
        activeHistory.forEach((st, idx) => {
            // Skip items being dragged (they'll be drawn live)
            if (this.state.selection.includes(idx)) return;
            this.renderObject(cacheCtx, st, 0, 0);
        });

        this.cache.isDirty = false;
        this.cache.lastHistoryLength = currentImg?.history?.length || 0;
    }

    render() {
        if(!this.cache.currentImg) return;
        const c = this.getElement('canvas');
        if (!c) return;
        const ctx = c.getContext('2d');
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0,0,c.width,c.height);

        ctx.save();
        ctx.translate(this.state.pan.x, this.state.pan.y);
        ctx.scale(this.state.zoom, this.state.zoom);

        // Preview logic
        if(this.state.previewOn || (this.tempHex && this.state.pickerMode==='remove')) {
            let targets = this.state.colors.map(x=>x.lab);
            if(this.tempHex) {
                const i = parseInt(this.tempHex.slice(1), 16);
                targets.push(this.rgbToLab((i>>16)&255, (i>>8)&255, i&255));
            }
            if(targets.length > 0) {
                const tmpC = document.createElement('canvas');
                tmpC.width = this.state.viewW;
                tmpC.height = this.state.viewH;
                const tmpCtx = tmpC.getContext('2d', {willReadFrequently: true});
                tmpCtx.drawImage(this.cache.currentImg, 0, 0, this.state.viewW, this.state.viewH);
                const imgD = tmpCtx.getImageData(0, 0, this.state.viewW, this.state.viewH);
                const d = imgD.data;
                const lab = this.cache.lab;
                const sq = this.state.strict**2;
                for(let i=0, j=0; i<d.length; i+=4, j+=3) {
                    if(d[i+3]===0) continue;
                    const l=lab[j], a=lab[j+1], b=lab[j+2];
                    let keep = false;
                    for(let t of targets) {
                        if(((l-t[0])**2 + (a-t[1])**2 + (b-t[2])**2) <= sq) { keep = true; break; }
                    }
                    if(!keep) d[i+3] = 0;
                }
                tmpCtx.putImageData(imgD, 0, 0);
                ctx.drawImage(tmpC, 0, 0);
            } else {
                ctx.drawImage(this.cache.currentImg, 0, 0, this.state.viewW, this.state.viewH);
            }
        } else {
            ctx.drawImage(this.cache.currentImg, 0, 0, this.state.viewW, this.state.viewH);
        }

        const currentImg = this.state.images[this.state.idx];

        // Build cached canvas if needed (only rebuilds when dirty)
        this.buildCommittedCache(ctx, currentImg);

        // Draw the cached committed strokes
        if (this.cache.committedCanvas) {
            ctx.drawImage(this.cache.committedCanvas, 0, 0);
        }

        // Draw selected items with drag offset (these are live, not cached)
        if (currentImg && currentImg.history && this.state.selection.length > 0) {
            this.state.selection.forEach(idx => {
                const st = currentImg.history[idx];
                if (!st || st.deleted) return;
                let dx = 0, dy = 0;
                if (this.dragOffset) {
                    dx = this.dragOffset.x;
                    dy = this.dragOffset.y;
                }
                this.renderObject(ctx, st, dx, dy);
            });
        }

        // Active stroke (being drawn right now)
        if (this.isDragging && this.currentStroke && this.currentStroke.length > 1 && ['pen','eraser'].includes(this.state.tool)) {
            ctx.save();
            ctx.lineCap='round'; ctx.lineJoin='round';
            ctx.lineWidth = this.state.tool==='eraser' ? this.state.eraserSize : this.state.penSize;
            ctx.strokeStyle = this.state.tool==='eraser' ? (this.state.bg==='transparent'?'#000':this.state.bg) : this.state.penColor;
            if(this.state.tool==='eraser' && this.state.bg==='transparent') ctx.globalCompositeOperation='destination-out';
            ctx.beginPath();
            ctx.moveTo(this.currentStroke[0].x, this.currentStroke[0].y);
            for(let i=1; i<this.currentStroke.length; i++) {
                ctx.lineTo(this.currentStroke[i].x, this.currentStroke[i].y);
            }
            ctx.stroke();
            ctx.restore();
        }

        if(this.state.selection.length > 0) this.renderSelectionOverlay(ctx, currentImg.history);

        const zb = this.getElement('zoomBtn');
        if (zb) zb.innerText = Math.round(this.state.zoom * 100) + '%';

        if(this.state.guideLines.length > 0) {
            ctx.save();
            ctx.strokeStyle = '#f472b6';
            ctx.lineWidth = 1 / this.state.zoom;
            ctx.setLineDash([4 / this.state.zoom, 4 / this.state.zoom]);
            ctx.beginPath();
            this.state.guideLines.forEach(g => {
                if(g.type==='v') { ctx.moveTo(g.x, 0); ctx.lineTo(g.x, this.state.viewH); }
                else { ctx.moveTo(0, g.y); ctx.lineTo(this.state.viewW, g.y); }
            });
            ctx.stroke();
            ctx.restore();
        }

        ctx.restore();
    }

    // Helper methods moved from App object
    rgbToLab(r,g,b) {
        let r_=r/255, g_=g/255, b_=b/255;
        r_ = r_>0.04045 ? Math.pow((r_+0.055)/1.055, 2.4) : r_/12.92;
        g_ = g_>0.04045 ? Math.pow((g_+0.055)/1.055, 2.4) : g_/12.92;
        b_ = b_>0.04045 ? Math.pow((b_+0.055)/1.055, 2.4) : b_/12.92;
        let x=(r_*0.4124+g_*0.3576+b_*0.1805)/0.95047, y=(r_*0.2126+g_*0.7152+b_*0.0722), z=(r_*0.0193+g_*0.1192+b_*0.9505)/1.08883;
        x = x>0.008856?Math.pow(x,1/3):(7.787*x)+16/116; y=y>0.008856?Math.pow(y,1/3):(7.787*y)+16/116; z=z>0.008856?Math.pow(z,1/3):(7.787*z)+16/116;
        return [(116*y)-16, 500*(x-y), 200*(y-z)];
    }

    async dbPut(s, v) { return new Promise(r=>{const t=this.db.transaction(s,'readwrite'); t.objectStore(s).put(v); t.oncomplete=()=>r()}); }
    async dbGet(s, k) { return new Promise(r=>{const q=this.db.transaction(s,'readonly').objectStore(s).get(k);q.onsuccess=()=>r(q.result)}); }

    // Placeholder for other methods to be moved...
    setupUI() {
        // Use getElement to support scoped lookup or fallback
        const wheelEl = this.getElement("iroWheel");

        // Only initialize color picker if the element exists
        if (wheelEl && window.iro) {
            this.iroP = new iro.ColorPicker(wheelEl, {width:180, color:"#fff"});

            this.iroP.on('input:start', () => { this.state.isLivePreview = true; });
            this.iroP.on('input:end', () => { this.state.isLivePreview = false; this.render(); this.saveSessionState(); });
            this.iroP.on('color:change', c => {
                const mode = this.state.pickerMode;
                if(mode==='remove') requestAnimationFrame(() => this.render(c.hexString));
                else if(mode==='pen') this.setPenColor(c.hexString);
                else if(mode==='shapeBorder') { this.state.shapeBorder=c.hexString; this.render(); }
                else if(mode==='shapeFill') { this.state.shapeFill=c.hexString; this.render(); }
                else if(mode==='selectionStroke' || mode==='selectionFill') {
                    const img = this.state.images[this.state.idx];
                    this.state.selection.forEach(idx => {
                        const st = img.history[idx];
                        if(mode==='selectionStroke') {
                            if(st.tool==='pen') st.color = c.hexString;
                            if(st.tool==='shape') st.border = c.hexString;
                            if(st.tool==='text') st.color = c.hexString;
                        } else {
                            if(st.tool==='shape') st.fill = c.hexString;
                        }
                    });
                    this.render();
                }
            });
        }

        const fileIn = this.getElement('fileIn');
        if (fileIn) fileIn.onchange = (e) => this.handleImport(e);

        const pickerBtn = this.getElement('openColorPicker');
        if(pickerBtn) pickerBtn.onclick = () => this.openPicker('remove');

        const eyeBtn = this.getElement('eyedropperBtn');
        if (eyeBtn) {
            eyeBtn.onclick = () => {
                this.state.eyedropperMode = !this.state.eyedropperMode;
                if(this.state.eyedropperMode) {
                    eyeBtn.style.background = 'var(--primary)';
                    eyeBtn.style.color = 'white';
                    this.ui.showToast('Tap on image to pick color');
                } else {
                    eyeBtn.style.background = '';
                    eyeBtn.style.color = '';
                }
            };
        }

        const closePicker = this.getElement('closePicker');
        if(closePicker) {
            closePicker.onclick = () => {
                this.getElement('floatingPicker').style.display='none';
                if(this.state.selection.length) this.saveCurrentImg();
                this.state.isLivePreview=false; this.render();
            };
        }

        const pickerAction = this.getElement('pickerActionBtn');
        if(pickerAction) {
            pickerAction.onclick = () => {
                if(this.state.pickerMode==='remove') {
                    const hex = this.iroP.color.hexString;
                    const i = parseInt(hex.slice(1), 16);
                    this.state.colors.push({hex, lab:this.rgbToLab((i>>16)&255,(i>>8)&255,i&255)});
                    this.renderSwatches();
                    this.saveSessionState();
                    if (this.liveSync) this.liveSync.updateColors(this.state.colors);
                }
                this.getElement('floatingPicker').style.display='none';
                this.render(); this.saveSessionState();
                if(this.state.selection.length) this.saveCurrentImg();
            };
        }

        const pickerNone = this.getElement('pickerNoneBtn');
        if(pickerNone) {
            pickerNone.onclick = () => {
                const mode = this.state.pickerMode;
                if(mode==='selectionFill') {
                    const img = this.state.images[this.state.idx];
                    this.state.selection.forEach(i => { if(img.history[i].tool==='shape') img.history[i].fill='transparent'; });
                    this.render(); this.saveCurrentImg();
                } else if (mode==='shapeFill') this.state.shapeFill = 'transparent';
                this.getElement('floatingPicker').style.display='none';
                this.saveSessionState();
            };
        }

        const pi = this.getElement('pageInput');
        if(pi) {
            pi.onchange = () => {
                let v = parseInt(pi.value);
                if(isNaN(v) || v < 1 || v > this.state.images.length) { pi.value = this.state.idx + 1; } else { this.loadPage(v - 1); }
            };
            pi.onfocus = () => { pi.style.borderBottomColor = 'var(--primary)'; };
            pi.onblur = () => { pi.style.borderBottomColor = 'transparent'; };
            pi.onkeydown = (e) => { e.stopPropagation(); };
        }

        const brushSize = this.getElement('brushSize');
        if(brushSize) {
            brushSize.oninput = e => {
                const v = parseInt(e.target.value);
                if(this.state.selection.length > 0) {
                    const img = this.state.images[this.state.idx];
                    this.state.selection.forEach(idx => {
                        const st = img.history[idx];
                        if(st.tool === 'pen' || st.tool === 'eraser') st.size = v;
                        else if(st.tool === 'shape') st.width = v;
                        else if(st.tool === 'text') st.size = v;
                    });
                    this.render();
                } else {
                    if(this.state.tool==='eraser') this.state.eraserSize=v;
                    else if(this.state.tool==='shape') this.state.shapeWidth=v;
                    else if(this.state.tool==='text') this.state.textSize=v;
                    else this.state.penSize=v;
                }
                this.saveSessionState();
            };
        }

        const strictRange = this.getElement('strictRange');
        if(strictRange) {
            strictRange.oninput = e => { this.state.strict=e.target.value; this.render(); };
            strictRange.onchange = () => this.saveSessionState();
        }

        const previewToggle = this.getElement('previewToggle');
        if(previewToggle) {
            previewToggle.onchange = e => { this.state.previewOn=e.target.checked; this.render(); this.saveSessionState(); };
        }

        const cursorToggle = this.getElement('cursorToggle');
        if(cursorToggle) {
            cursorToggle.onchange = e => {
                this.state.showCursors=e.target.checked;
                if(this.liveSync && this.liveSync.renderCursors) this.liveSync.renderCursors();
                this.saveSessionState();
            };
        }

        // --- Bind Tool Buttons Programmatically (for Scoped Instances) ---
        ['None','Lasso','Pen','Shape','Text','Eraser','Capture','Hand'].forEach(toolName => {
            const id = 'tool' + toolName;
            const btn = this.getElement(id);
            if (btn) {
                // Remove inline onclick if present to avoid conflicts (optional)
                btn.onclick = () => this.setTool(toolName.toLowerCase());
            }
        });

        const undoBtn = this.getElement('undoBtn');
        if (undoBtn) undoBtn.onclick = () => this.undo();

        const redoBtn = this.getElement('redoBtn');
        if (redoBtn) redoBtn.onclick = () => this.redo();

        const prevPageBtn = this.getElement('prevPageBtn');
        if (prevPageBtn) prevPageBtn.onclick = () => this.loadPage(this.state.idx - 1);

        const nextPageBtn = this.getElement('nextPageBtn');
        if (nextPageBtn) nextPageBtn.onclick = () => this.loadPage(this.state.idx + 1);

        const zoomBtn = this.getElement('zoomBtn');
        if (zoomBtn) zoomBtn.onclick = () => this.resetZoom();
    }

    setupDrawing() {
        import('./spen_engine.js')
            .then(({ initializeSPen }) => {
                const canvas = this.getElement('canvas');
                if (canvas) {
                    console.log('Initializing S-Pen Engine for ColorRM...');
                    initializeSPen(canvas);
                }
            })
            .catch(err => {
                console.log('S-Pen Engine not found, skipping initialization.');
            });

        const c = this.getElement('canvas');
        if (!c) return;

        c.addEventListener('contextmenu', e => e.preventDefault());

        let startPt = null; this.isDragging = false;
        let dragStart = null; let startBounds = null; let startRotation = 0;
        let isMovingSelection = false; let isResizing = false; let isRotating = false; let resizeHandle = null;
        let initialHistoryState = []; let lassoPath = [];

        // --- S-Pen Button Logic ---
        let previousTool = 'pen';

        // Track if this instance's canvas is currently being interacted with
        const isActiveInstance = () => {
            if (!this.container) return true; // Main app, no container = always active
            // Check hover OR if we're actively drawing
            return this.container.matches(':hover') || this.isDragging;
        };

        window.addEventListener('spen-button-down', () => {
            if (!isActiveInstance()) return;

            if (this.state.tool !== 'eraser') {
                previousTool = this.state.tool;
                this.setTool('eraser');
                console.log('S-Pen: Switched to Eraser');
            }
        });
        window.addEventListener('spen-button-up', () => {
            if (!isActiveInstance()) return;

            if (this.state.tool === 'eraser') {
                this.setTool(previousTool);
                console.log('S-Pen: Reverted to', previousTool);
            }
        });

        const getPt = e => {
            const r = c.getBoundingClientRect();
            const screenX = (e.clientX - r.left)*(c.width/r.width);
            const screenY = (e.clientY - r.top)*(c.height/r.height);
            return {
                x: (screenX - this.state.pan.x) / this.state.zoom,
                y: (screenY - this.state.pan.y) / this.state.zoom
            };
        };

        const getSelectionBounds = () => {
            if(this.state.selection.length===0) return null;
            const img = this.state.images[this.state.idx];
            let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
            this.state.selection.forEach(idx => {
                const st = img.history[idx];
                let bx,by,bw,bh;
                if(st.tool==='pen') { bx=st.pts[0].x; by=st.pts[0].y; let rx=bx, ry=by; st.pts.forEach(p=>{bx=Math.min(bx,p.x);by=Math.min(by,p.y);rx=Math.max(rx,p.x);ry=Math.max(ry,p.y);}); bw=rx-bx; bh=ry-by; }
                else { bx=st.x; by=st.y; bw=st.w; bh=st.h; }
                if(bw<0){bx+=bw; bw=-bw;} if(bh<0){by+=bh; bh=-bh;}
                minX=Math.min(minX,bx); minY=Math.min(minY,by); maxX=Math.max(maxX,bx+bw); maxY=Math.max(maxY,by+bh);
            });
            return {minX, minY, maxX, maxY, w:maxX-minX, h:maxY-minY, cx:(minX+maxX)/2, cy:(minY+maxY)/2, maxY:maxY};
        };

        const hitTest = (pt) => {
            const b = getSelectionBounds(); if(!b) return null;
            if(Math.hypot(pt.x-b.cx, pt.y-(b.maxY+20))<15) return 'rot';
            if(Math.hypot(pt.x-b.minX, pt.y-b.minY)<15) return 'tl'; if(Math.hypot(pt.x-b.maxX, pt.y-b.minY)<15) return 'tr';
            if(Math.hypot(pt.x-b.minX, pt.y-b.maxY)<15) return 'bl'; if(Math.hypot(pt.x-b.maxX, pt.y-b.maxY)<15) return 'br';
            if(pt.x>=b.minX && pt.x<=b.maxX && pt.y>=b.minY && pt.y<=b.maxY) return 'move';
            return null;
        };

        const syncSidebarToSelection = () => {
            if(this.state.selection.length > 0) {
                const img = this.state.images[this.state.idx];
                const first = img.history[this.state.selection[0]];
                const slider = this.getElement('brushSize');
                const label = this.getElement('sizeLabel');
                const panel = this.getElement('toolSettingsPanel');
                if (panel) panel.style.display = 'block';
                if (slider && label) {
                    if(first.tool === 'pen' || first.tool === 'eraser') { slider.value = first.size; label.innerText = "Stroke Size"; }
                    else if(first.tool === 'shape') { slider.value = first.width; label.innerText = "Border Width"; }
                    else if(first.tool === 'text') { slider.value = first.size; label.innerText = "Text Size"; }
                }
            }
        };

        c.onpointerdown = e => {
            if (e.pointerType === "touch" && !e.isPrimary) return;
            const pt = getPt(e); startPt = pt;
            this.lastScreenX = e.clientX;
            this.lastScreenY = e.clientY;

            // Eyedropper mode
            if(this.state.eyedropperMode) {
                const ctx = c.getContext('2d', {willReadFrequently: true});
                const r = c.getBoundingClientRect();
                const screenX = (e.clientX - r.left)*(c.width/r.width);
                const screenY = (e.clientY - r.top)*(c.height/r.height);
                const pixelData = ctx.getImageData(Math.floor(screenX), Math.floor(screenY), 1, 1).data;
                const hex = '#' + [pixelData[0], pixelData[1], pixelData[2]].map(x => x.toString(16).padStart(2, '0')).join('');
                this.state.colors.push({hex, lab: this.rgbToLab(pixelData[0], pixelData[1], pixelData[2])});
                this.renderSwatches();
                this.saveSessionState();
                if (this.liveSync) this.liveSync.updateColors(this.state.colors);
                this.state.eyedropperMode = false;
                const btn = this.getElement('eyedropperBtn');
                if(btn) { btn.style.background = ''; btn.style.color = ''; }
                this.ui.showToast('Color added: ' + hex);
                return;
            }

            if(this.state.tool === 'text') {
                this.ui.showInput("Add Text", "Type something...", (text) => {
                    const img = this.state.images[this.state.idx]; const fs = this.state.textSize;
                    img.history.push({ id: Date.now() + Math.random(), lastMod: Date.now(), tool: 'text', text: text, x: pt.x, y: pt.y, size: fs, color: this.state.penColor, rotation: 0, w: fs*text.length*0.6, h: fs });
                    this.saveCurrentImg(); this.setTool('none'); this.state.selection = [img.history.length-1]; syncSidebarToSelection(); this.render();
                }); return;
            }

            if(['none','lasso'].includes(this.state.tool) && this.state.selection.length>0) {
                const hit = hitTest(pt);
                if(hit) {
                    startBounds = getSelectionBounds();
                    const img = this.state.images[this.state.idx];
                    initialHistoryState = this.state.selection.map(i => JSON.parse(JSON.stringify(img.history[i])));
                    if(hit==='rot') { isRotating=true; startRotation = Math.atan2(pt.y - startBounds.cy, pt.x - startBounds.cx); }
                    else if(hit==='move') { isMovingSelection=true; dragStart=pt; this.dragOffset={x:0,y:0}; }
                    else { isResizing=true; resizeHandle=hit; }
                    return;
                }
            }

            if(this.state.selection.length) {
                this.state.selection=[];
                const tb = this.getElement('contextToolbar');
                if(tb) tb.style.display='none';
                this.setTool(this.state.tool); this.render();
                if(this.state.tool==='none') return;
            }

            this.isDragging = true;
            if(this.state.tool==='lasso') lassoPath=[pt]; else if(this.state.tool!=='shape' && this.state.tool!=='capture') this.currentStroke=[pt];
        };

        const onPointerMove = e => {
            // Scope: Only process events if this instance is active
            // Check if we're dragging OR if the event target is within our container
            const isOurEvent = this.isDragging ||
                               (this.container ? this.container.contains(e.target) : true);
            if (!isOurEvent) return;

            if (lastPinchDist !== null) return;
            // Only process if target is our canvas or we are dragging
            if (!this.isDragging && e.target !== c) return;

            const pt = getPt(e);

            if (this.liveSync && !this.liveSync.isInitializing) {
                this.liveSync.updateCursor(pt);
            }

            if(isMovingSelection) { this.dragOffset = {x:pt.x-dragStart.x, y:pt.y-dragStart.y}; this.render(); return; }

            if (this.state.tool === 'hand' && this.isDragging) {
                const dx = e.clientX - this.lastScreenX;
                const dy = e.clientY - this.lastScreenY;
                this.state.pan.x += dx;
                this.state.pan.y += dy;
                this.lastScreenX = e.clientX;
                this.lastScreenY = e.clientY;
                this.render();
                return;
            }

            if(!this.isDragging) return;

            if(this.state.tool==='lasso') { lassoPath.push(pt); this.renderLasso(c.getContext('2d'), lassoPath); }
            else if(this.state.tool==='shape' || this.state.tool==='capture') {
                let w=pt.x-startPt.x, h=pt.y-startPt.y;
                if(this.state.tool==='shape' && (e.shiftKey || ['rectangle','circle'].includes(this.state.shapeType))) { if(e.shiftKey || Math.abs(Math.abs(w)-Math.abs(h))<15) { const s=Math.max(Math.abs(w),Math.abs(h)); w=(w<0?-1:1)*s; h=(h<0?-1:1)*s; } }
                this.render();
                if(this.state.tool === 'capture') {
                        const ctx = c.getContext('2d'); ctx.save();
                        ctx.strokeStyle = '#10b981'; ctx.lineWidth = 2; ctx.setLineDash([5,5]);
                        ctx.strokeRect(startPt.x, startPt.y, w, h); ctx.restore();
                } else {
                    this.renderObject(c.getContext('2d'), {tool:'shape', shapeType:this.state.shapeType, x:startPt.x, y:startPt.y, w:w, h:h, border:this.state.shapeBorder, fill:this.state.shapeFill, width:this.state.shapeWidth});
                }
            }
            else if(['pen','eraser'].includes(this.state.tool)) {
                if (this.state.tool === 'eraser' && this.state.eraserType === 'stroke') {
                    const img = this.state.images[this.state.idx];
                    const eraserR = this.state.eraserSize / 2;
                    let changed = false;
                    for (let i = img.history.length - 1; i >= 0; i--) {
                        const st = img.history[i];
                        if (st.locked) continue;
                        let hit = false;
                        if (st.tool === 'pen' || st.tool === 'eraser') {
                            for (const p of st.pts) {
                                if (Math.hypot(p.x - pt.x, p.y - pt.y) < eraserR + st.size) {
                                    hit = true; break;
                                }
                            }
                        } else if (st.tool === 'shape' || st.tool === 'text') {
                            if (pt.x >= st.x - eraserR && pt.x <= st.x + st.w + eraserR &&
                                pt.y >= st.y - eraserR && pt.y <= st.y + st.h + eraserR) {
                                hit = true;
                            }
                        }
                        if (hit) { st.deleted = true; st.lastMod = Date.now(); changed = true; }
                    }
                    if (changed) { this.invalidateCache(); this.scheduleSave(); this.render(); }
                    return;
                }

                this.currentStroke.push(pt); const ctx=c.getContext('2d');
                ctx.save();
                ctx.translate(this.state.pan.x, this.state.pan.y);
                ctx.scale(this.state.zoom, this.state.zoom);
                ctx.lineCap='round'; ctx.lineJoin='round'; ctx.lineWidth=this.state.tool==='eraser'?this.state.eraserSize:this.state.penSize;
                ctx.strokeStyle=this.state.tool==='eraser'?(this.state.bg==='transparent'?'#000':this.state.bg):this.state.penColor;
                if(this.state.tool==='eraser'&&this.state.bg==='transparent') ctx.globalCompositeOperation='destination-out';
                ctx.beginPath(); ctx.moveTo(this.currentStroke[this.currentStroke.length-2].x, this.currentStroke[this.currentStroke.length-2].y); ctx.lineTo(pt.x,pt.y); ctx.stroke(); ctx.restore();
            }
        };

        window.addEventListener('pointermove', onPointerMove);

        // Only main app listens to window resize for cursor re-rendering
        if (this.config.isMain) {
            window.addEventListener('resize', () => this.liveSync && this.liveSync.renderCursors && this.liveSync.renderCursors());
        }
        const vp = this.getElement('viewport');
        if(vp) vp.addEventListener('scroll', () => this.liveSync && this.liveSync.renderCursors && this.liveSync.renderCursors());

        // --- Zoom & Pan Logic ---
        let lastPinchDist = null;
        let lastMidpoint = null;

        c.addEventListener('wheel', e => {
            if (e.ctrlKey) {
                e.preventDefault();
                const r = c.getBoundingClientRect();
                const mouseX = (e.clientX - r.left) * (c.width / r.width);
                const mouseY = (e.clientY - r.top) * (c.height / r.height);
                const zoomSpeed = 0.001;
                const delta = -e.deltaY;
                const factor = Math.pow(1.1, delta / 100);
                const newZoom = Math.min(Math.max(this.state.zoom * factor, 0.1), 10);
                this.state.pan.x = mouseX - (mouseX - this.state.pan.x) * (newZoom / this.state.zoom);
                this.state.pan.y = mouseY - (mouseY - this.state.pan.y) * (newZoom / this.state.zoom);
                this.state.zoom = newZoom;
                this.render();
            } else if (this.state.tool === 'none' || e.shiftKey) {
                e.preventDefault();
                this.state.pan.x -= e.deltaX;
                this.state.pan.y -= e.deltaY;
                this.render();
            }
        }, { passive: false });

        c.addEventListener('touchstart', e => {
            if (e.touches.length === 2) {
                this.isDragging = false;
                this.currentStroke = null;
                lastPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                lastMidpoint = {
                    x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                    y: (e.touches[0].clientY + e.touches[1].clientY) / 2
                };
            }
        }, { passive: false });

        c.addEventListener('touchmove', e => {
            if (e.touches.length === 2 && lastPinchDist !== null && lastMidpoint !== null) {
                e.preventDefault();
                const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                const factor = dist / lastPinchDist;
                const curMidpoint = {
                    x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                    y: (e.touches[0].clientY + e.touches[1].clientY) / 2
                };
                const r = c.getBoundingClientRect();
                const centerX = (curMidpoint.x - r.left) * (c.width / r.width);
                const centerY = (curMidpoint.y - r.top) * (c.height / r.height);
                const newZoom = Math.min(Math.max(this.state.zoom * factor, 0.1), 10);
                this.state.pan.x += (curMidpoint.x - lastMidpoint.x) * (c.width / r.width);
                this.state.pan.y += (curMidpoint.y - lastMidpoint.y) * (c.height / r.height);
                this.state.pan.x = centerX - (centerX - this.state.pan.x) * (newZoom / this.state.zoom);
                this.state.pan.y = centerY - (centerY - this.state.pan.y) * (newZoom / this.state.zoom);
                this.state.zoom = newZoom;
                lastPinchDist = dist;
                lastMidpoint = curMidpoint;
                this.render();
            }
        }, { passive: false });

        c.addEventListener('touchend', e => {
            if (e.touches.length < 2) {
                lastPinchDist = null;
                lastMidpoint = null;
            }
        });

        window.addEventListener('pointerup', e => {
            // Scope: Only process if this instance was actively dragging or selecting
            // This check prevents other instances from stealing our pointerup
            const wasOurInteraction = this.isDragging || isMovingSelection || isResizing || isRotating;
            if (!wasOurInteraction) return;

            if(isMovingSelection) {
                isMovingSelection=false;
                this.state.selection.forEach(idx => { const st=this.state.images[this.state.idx].history[idx]; if(st.tool==='pen') st.pts.forEach(p=>{p.x+=this.dragOffset.x;p.y+=this.dragOffset.y}); else {st.x+=this.dragOffset.x;st.y+=this.dragOffset.y} });
                this.dragOffset=null; this.saveCurrentImg(); this.render(); return;
            }
            if(!this.isDragging) return; this.isDragging=false;
            const pt = getPt(e);
            if(this.state.tool==='lasso') {
                let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
                lassoPath.forEach(p=>{minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);});
                this.state.selection=[];
                this.state.images[this.state.idx].history.forEach((st,i)=>{
                    if(st.locked) return; let cx,cy; if(st.tool==='pen'){cx=st.pts[0].x;cy=st.pts[0].y} else {cx=st.x+st.w/2;cy=st.y+st.h/2}
                    if(cx>=minX && cx<=maxX && cy>=minY && cy<=maxY) this.state.selection.push(i);
                });
                syncSidebarToSelection();
                this.render();
            } else if(this.state.tool==='shape') {
                let w=pt.x-startPt.x, h=pt.y-startPt.y;
                if(Math.abs(w)>2) {
                    this.state.images[this.state.idx].history.push({id: Date.now() + Math.random(), lastMod: Date.now(), tool:'shape', shapeType:this.state.shapeType, x:startPt.x, y:startPt.y, w:w, h:h, border:this.state.shapeBorder, fill:this.state.shapeFill, width:this.state.shapeWidth, rotation:0});
                    this.saveCurrentImg(); this.state.selection=[this.state.images[this.state.idx].history.length-1]; this.setTool('lasso'); syncSidebarToSelection();
                }
            } else if(this.state.tool==='capture') {
                let w = pt.x - startPt.x, h = pt.y - startPt.y;
                if(w < 0) { startPt.x += w; w = Math.abs(w); }
                if(h < 0) { startPt.y += h; h = Math.abs(h); }
                if(w > 5 && h > 5) this.addToBox(startPt.x, startPt.y, w, h);
                this.render();
            } else if(['pen','eraser'].includes(this.state.tool)) {
                const newStroke = {id: Date.now() + Math.random(), lastMod: Date.now(), tool:this.state.tool, pts:this.currentStroke, color:this.state.penColor, size:this.state.tool==='eraser'?this.state.eraserSize:this.state.penSize, deleted: false};
                this.state.images[this.state.idx].history.push(newStroke);
                this.saveCurrentImg(true);
                if (this.liveSync && !this.liveSync.isInitializing) {
                    this.liveSync.addStroke(this.state.idx, newStroke);
                }
                this.render();
            }
        });
    }

    makeDraggable() {
        const el = this.getElement('floatingPicker');
        if (!el) return;
        let isDragging = false; let startX, startY, initLeft, initTop;
        const handle = this.getElement('pickerDragHandle');
        if(handle) {
            handle.onmousedown = (e) => { isDragging = true; startX = e.clientX; startY = e.clientY; const r = el.getBoundingClientRect(); initLeft = r.left; initTop = r.top; };
            // Use document instead of window to be more contained
            // Each instance's isDragging flag prevents cross-instance interference
            document.addEventListener('mousemove', (e) => { if(!isDragging) return; el.style.left = (initLeft + (e.clientX - startX)) + 'px'; el.style.top = (initTop + (e.clientY - startY)) + 'px'; });
            document.addEventListener('mouseup', () => isDragging = false);
        }
    }

    renderLasso(ctx, points) {
        if(points.length < 2) return;
        this.render(); // Clear and redraw base
        ctx.save();
        ctx.strokeStyle = '#3b82f6';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length - 1; i++) {
            const xc = (points[i].x + points[i + 1].x) / 2;
            const yc = (points[i].y + points[i + 1].y) / 2;
            ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        ctx.stroke();
        ctx.restore();
    }

    // Placeholder for other methods to be moved...
    setupShortcuts() {
        const target = this.container || document;

        // Ensure container can receive focus if it's not the document
        if (this.container && !this.container.getAttribute('tabindex')) {
            this.container.setAttribute('tabindex', '0');
            // We can leave the outline styles to CSS, or suppress them if desired
            // this.container.style.outline = 'none';
        }

        target.addEventListener('keydown', e => {
            if(e.target.tagName === 'INPUT') return;
            const key = e.key.toLowerCase();
            if(e.key === ' ') {
                e.preventDefault();
                this.state.previewOn = !this.state.previewOn;
                const pt = this.getElement('previewToggle');
                if(pt) pt.checked = this.state.previewOn;
                this.render(); this.saveSessionState();
                return;
            }
            if((e.ctrlKey||e.metaKey) && key==='z') { e.preventDefault(); if(e.shiftKey) this.redo(); else this.undo(); }
            if(key==='v') this.setTool('none'); if(key==='l') this.setTool('lasso'); if(key==='p') this.setTool('pen');
            if(key==='e') this.setTool('eraser'); if(key==='s') this.setTool('shape'); if(key==='t') this.setTool('text');
            if(key==='b') this.setTool('capture'); if(key==='h') this.setTool('hand');
            if(e.key==='ArrowLeft') this.loadPage(this.state.idx-1); if(e.key==='ArrowRight') this.loadPage(this.state.idx+1); if(e.key==='Delete' || e.key==='Backspace') this.deleteSelected();
        });
    }

    renderObject(ctx, st, dx, dy) {
        ctx.save();
        if(st.rotation && st.tool!=='pen') {
            const cx = st.x + st.w/2 + dx;
            const cy = st.y + st.h/2 + dy;
            ctx.translate(cx, cy);
            ctx.rotate(st.rotation);
            ctx.translate(-cx, -cy);
        }
        ctx.translate(dx, dy);

        if(st.tool === 'text') {
            ctx.fillStyle = st.color;
            ctx.font = `${st.size}px sans-serif`;
            ctx.textBaseline = 'top';
            ctx.fillText(st.text, st.x, st.y);
        } else if(st.tool === 'shape') {
            ctx.strokeStyle = st.border; ctx.lineWidth = st.width;
            if(st.fill!=='transparent') { ctx.fillStyle=st.fill; }
            ctx.beginPath();
            const {x,y,w,h} = st;
            if(st.shapeType==='rectangle') ctx.rect(x,y,w,h);
            else if(st.shapeType==='circle') {
                ctx.ellipse(x+w/2, y+h/2, Math.abs(w/2), Math.abs(h/2), 0, 0, 2*Math.PI);
            } else if(st.shapeType==='line') { ctx.moveTo(x,y); ctx.lineTo(x+w,y+h); }
            else if(st.shapeType==='arrow') {
                const head=15; const ang=Math.atan2(h,w);
                ctx.moveTo(x,y); ctx.lineTo(x+w,y+h);
                ctx.lineTo(x+w - head*Math.cos(ang-0.5), y+h - head*Math.sin(ang-0.5));
                ctx.moveTo(x+w,y+h);
                ctx.lineTo(x+w - head*Math.cos(ang+0.5), y+h - head*Math.sin(ang+0.5));
            }
            if(st.fill!=='transparent' && !['line','arrow'].includes(st.shapeType)) ctx.fill();
            ctx.stroke();
            if(this.state.activeShapeRatio) {
                ctx.beginPath(); ctx.strokeStyle = '#f472b6'; ctx.setLineDash([2,2]); ctx.lineWidth=1;
                ctx.moveTo(x,y); ctx.lineTo(x+w, y+h); ctx.stroke();
            }
        } else {
            ctx.lineCap='round'; ctx.lineJoin='round'; ctx.lineWidth=st.size;
            ctx.strokeStyle = st.tool==='eraser' ? '#000' : st.color;
            if(st.tool==='eraser') ctx.globalCompositeOperation='destination-out';
            ctx.beginPath();
            if(st.pts.length) ctx.moveTo(st.pts[0].x, st.pts[0].y);
            for(let i=1; i<st.pts.length; i++) ctx.lineTo(st.pts[i].x, st.pts[i].y);
            ctx.stroke();
        }
        ctx.restore();
    }

    renderSelectionOverlay(ctx, hist) {
        let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
        this.state.selection.forEach(idx => {
            const st = hist[idx];
            let bx, by, bw, bh;
            if(st.tool==='pen') {
                 bx=st.pts[0].x; by=st.pts[0].y; let rx=bx, ry=by;
                 st.pts.forEach(p=>{bx=Math.min(bx,p.x);by=Math.min(by,p.y);rx=Math.max(rx,p.x);ry=Math.max(ry,p.y);});
                 bw=rx-bx; bh=ry-by;
            } else { bx=st.x; by=st.y; bw=st.w; bh=st.h; }

            if(this.dragOffset && this.state.selection.includes(idx)) { bx+=this.dragOffset.x; by+=this.dragOffset.y; }

            if(bw<0){bx+=bw; bw=-bw;} if(bh<0){by+=bh; bh=-bh;}
            minX=Math.min(minX,bx); minY=Math.min(minY,by); maxX=Math.max(maxX,bx+bw); maxY=Math.max(maxY,by+bh);
        });

        ctx.save();
        ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 2;
        ctx.strokeRect(minX, minY, maxX-minX, maxY-minY);

        ctx.fillStyle = '#fff'; ctx.lineWidth = 2;
        const drawHandle = (x,y) => { ctx.beginPath(); ctx.arc(x,y,5,0,2*Math.PI); ctx.fill(); ctx.stroke(); };
        drawHandle(minX, minY); drawHandle(maxX, minY);
        drawHandle(maxX, maxY); drawHandle(minX, maxY);

        ctx.beginPath(); ctx.arc((minX+maxX)/2, maxY+20, 10, 0, 2*Math.PI);
        ctx.strokeStyle='#0ea5e9'; ctx.stroke();
        ctx.fillStyle='#0ea5e9'; ctx.font='16px bootstrap-icons'; ctx.fillText('\uF14B', (minX+maxX)/2-8, maxY+26);
        ctx.restore();

        const menu = this.getElement('contextToolbar');
        const canvas = this.getElement('canvas');
        if(menu && canvas) {
            const cr = canvas.getBoundingClientRect();
            const sx = cr.width/this.state.viewW; const sy = cr.height/this.state.viewH;

            menu.style.display = 'flex';
            const screenMinX = (minX * this.state.zoom + this.state.pan.x) * sx;
            const screenMaxX = (maxX * this.state.zoom + this.state.pan.x) * sx;
            const screenMinY = (minY * this.state.zoom + this.state.pan.y) * sy;
            const screenMaxY = (maxY * this.state.zoom + this.state.pan.y) * sy;

            let mx = (screenMinX + screenMaxX)/2;
            let my = (screenMinY) - 50;
            if(my < 10) my = (screenMaxY) + 50;

            menu.style.left = (cr.left + mx - menu.offsetWidth/2) + 'px';
            menu.style.top = (cr.top + my) + 'px';
        }
    }

    setTool(t) {
        this.state.tool = t;
        ['None','Lasso','Pen','Shape','Text','Eraser','Capture','Hand'].forEach(x => {
            const el = this.getElement('tool'+x);
            if(el) el.classList.toggle('active', t===x.toLowerCase());
        });

        const vp = this.getElement('viewport');
        if(vp) {
            if (t === 'hand') vp.style.cursor = 'grab';
            else vp.style.cursor = 'default';
        }

        const tsp = this.getElement('toolSettingsPanel');
        if(tsp) tsp.style.display = ['pen','shape','eraser','text'].includes(t) ? 'block' : 'none';

        const po = this.getElement('penOptions');
        if(po) po.style.display = t==='pen'||t==='text'?'block':'none';

        const so = this.getElement('shapeOptions');
        if(so) so.style.display = t==='shape'?'block':'none';

        const eo = this.getElement('eraserOptions');
        if(eo) eo.style.display = t==='eraser'?'block':'none';

        const range = this.getElement('brushSize');
        const label = this.getElement('sizeLabel');
        if(label) label.innerText = "Size";

        if(range) {
            if(t === 'pen') { range.value = this.state.penSize; }
            else if(t === 'eraser') { range.value = this.state.eraserSize; }
            else if(t === 'shape') { range.value = this.state.shapeWidth; if(label) label.innerText = "Border Width"; }
            else if(t === 'text') { range.value = this.state.textSize; if(label) label.innerText = "Text Size"; }
        }

        if(['pen','shape','eraser','text','capture'].includes(t)) {
            this.state.selection = [];
            const tb = this.getElement('contextToolbar');
            if(tb) tb.style.display = 'none';
            this.render();
        }
    }

    setEraserMode(checked) { this.state.eraserType = checked ? 'stroke' : 'standard'; }
    setPenColor(c){ this.state.penColor=c; }
    setShapeType(t){
        this.state.shapeType=t;
        ['rectangle','circle','line','arrow'].forEach(s=>{
            const el = this.getElement('sh_'+s);
            if(el) el.classList.toggle('active', s===t);
        });
    }
    openPicker(m){
        this.state.pickerMode=m;
        const pb = this.getElement('pickerNoneBtn');
        if(pb) pb.style.display = (m==='shapeFill'||m==='selectionFill') ? 'block' : 'none';
        const fp = this.getElement('floatingPicker');
        if(fp) fp.style.display='flex';
    }

    undo() {
        const img = this.state.images[this.state.idx];
        if(img.history.length > 0) {
            if(!img.redo) img.redo = [];
            img.redo.push(img.history.pop());
            this.saveCurrentImg(); this.render();
        }
    }
    redo() {
        const img = this.state.images[this.state.idx];
        if(img.redo && img.redo.length > 0) {
            img.history.push(img.redo.pop());
            this.saveCurrentImg(); this.render();
        }
    }

    deleteSelected() {
        const img = this.state.images[this.state.idx];
        this.state.selection.forEach(i => {
            const item = img.history[i];
            if (item) {
                item.deleted = true;
                item.lastMod = Date.now();
            }
        });
        this.state.selection = [];
        const tb = this.getElement('contextToolbar');
        if(tb) tb.style.display = 'none';

        this.invalidateCache();
        this.saveCurrentImg();
        this.render();
    }

    copySelected(cut=false) {
        const img = this.state.images[this.state.idx];
        const newIds = [];
        this.state.selection.forEach(i => {
            const item = JSON.parse(JSON.stringify(img.history[i]));
            item.id = Date.now() + Math.random();
            item.lastMod = Date.now();
            item.deleted = false;
            if(!cut) {
                if(item.pts) item.pts.forEach(p=>{p.x+=20; p.y+=20});
                else { item.x+=20; item.y+=20; }
            }
            img.history.push(item);
            newIds.push(img.history.length-1);
        });
        if(cut) this.deleteSelected();
        else {
            this.state.selection = newIds;
            this.saveCurrentImg();
            this.render();
        }
    }

    lockSelected() {
        const img = this.state.images[this.state.idx];
        this.state.selection.forEach(i => img.history[i].locked = true);
        this.state.selection = [];
        this.render();
    }

    async saveCurrentImg(skipRemoteSync = false) {
        if(this.state.sessionId) {
            await this.dbPut('pages', this.state.images[this.state.idx]);
            if (!skipRemoteSync && this.liveSync && !this.liveSync.isInitializing) {
                this.liveSync.setHistory(this.state.idx, this.state.images[this.state.idx].history);
            }
        }
        // Invalidate cache since history changed
        this.invalidateCache();
    }

    // Debounced save - call this instead of saveCurrentImg for frequent updates
    scheduleSave(skipRemoteSync = false) {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => {
            this.saveCurrentImg(skipRemoteSync);
        }, 300);  // Save 300ms after last change
    }

    // Compact history by removing soft-deleted items
    compactHistory(pageIdx = null) {
        const idx = pageIdx !== null ? pageIdx : this.state.idx;
        const img = this.state.images[idx];
        if (!img || !img.history) return 0;

        const before = img.history.length;
        img.history = img.history.filter(st => !st.deleted);
        const removed = before - img.history.length;

        if (removed > 0) {
            console.log(`Compacted history: removed ${removed} deleted items`);
            // Clear selection since indices changed
            this.state.selection = [];
            this.invalidateCache();
            this.saveCurrentImg();
        }

        return removed;
    }

    // Compact all pages
    compactAllHistory() {
        let totalRemoved = 0;
        this.state.images.forEach((_, idx) => {
            totalRemoved += this.compactHistory(idx);
        });
        if (totalRemoved > 0) {
            this.ui.showToast(`Cleaned up ${totalRemoved} items`);
        }
        return totalRemoved;
    }

    // Auto-compact if history is getting large
    checkAutoCompact() {
        const img = this.state.images[this.state.idx];
        if (!img || !img.history) return;

        const deletedCount = img.history.filter(st => st.deleted).length;
        const totalCount = img.history.length;

        // Auto-compact if more than 100 deleted items or >30% are deleted
        if (deletedCount > 100 || (totalCount > 50 && deletedCount / totalCount > 0.3)) {
            console.log('Auto-compacting history...');
            this.compactHistory();
        }
    }

    saveBlobNative(blob, filename) {
        if (window.AndroidNative) {
            // For large files, process in chunks to avoid OOM
            const CHUNK_SIZE = 512 * 1024; // 512KB chunks

            if (blob.size > CHUNK_SIZE * 2) {
                // Large file: use chunked approach
                this.ui.showToast("Saving large file...");
                this.saveBlobNativeChunked(blob, filename);
            } else {
                // Small file: use direct approach
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64 = reader.result.split(',')[1];
                    window.AndroidNative.saveBlob(base64, filename, blob.type);
                    this.ui.showToast("Saved to Downloads");
                };
                reader.onerror = () => {
                    console.error("FileReader error");
                    this.ui.showToast("Save failed");
                };
                reader.readAsDataURL(blob);
            }
            return true;
        }
        return false;
    }

    // Chunked saving for large blobs on Android
    async saveBlobNativeChunked(blob, filename) {
        try {
            // Convert blob to base64 in chunks to avoid memory spike
            const arrayBuffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);

            // Convert to base64 in chunks
            let base64 = '';
            const chunkSize = 32768; // Process 32KB at a time
            for (let i = 0; i < bytes.length; i += chunkSize) {
                const chunk = bytes.slice(i, Math.min(i + chunkSize, bytes.length));
                base64 += btoa(String.fromCharCode.apply(null, chunk));

                // Yield to UI every few chunks
                if (i % (chunkSize * 10) === 0) {
                    await new Promise(r => setTimeout(r, 0));
                }
            }

            window.AndroidNative.saveBlob(base64, filename, blob.type);
            this.ui.showToast("Saved to Downloads");
        } catch (e) {
            console.error("Chunked save failed:", e);
            this.ui.showToast("Save failed: " + e.message);
        }
    }

    async saveImage() {
        const cvs = this.getElement('canvas');
        cvs.toBlob(blob => {
            if (this.saveBlobNative(blob, 'Page.png')) return;
            const a=document.createElement('a'); a.download='Page.png'; a.href=URL.createObjectURL(blob); a.click();
        });
    }

    // Share session URL via native share or clipboard
    async shareSession() {
        if (!this.state.sessionId || !this.liveSync) {
            this.ui.showToast("No active session to share");
            return;
        }

        const ownerId = this.liveSync.ownerId || this.state.ownerId;
        const projectId = this.state.sessionId;

        if (!ownerId) {
            this.ui.showToast("Session not synced yet");
            return;
        }

        // Build the share URL
        const baseUrl = window.Config?.getApiBase() || window.location.origin;
        const shareUrl = `${baseUrl}/color_rm.html#/color_rm/${ownerId}/${projectId}`;

        try {
            // Try native share first (works on mobile)
            if (navigator.share) {
                await navigator.share({
                    title: this.state.projectName || 'ColorRM Session',
                    text: 'Join my ColorRM session',
                    url: shareUrl
                });
                return;
            }

            // Fallback to clipboard
            await navigator.clipboard.writeText(shareUrl);
            this.ui.showToast("Link copied to clipboard!");
        } catch (e) {
            // Final fallback: show URL in prompt
            prompt("Share this URL:", shareUrl);
        }
    }

    renderSwatches() {
        const c = this.getElement('swatches');
        if (!c) return;
        c.innerHTML='';
        this.state.colors.forEach((col) => {
            const d = document.createElement('div'); d.className='swatch'; d.style.background=col.hex;
            d.onclick=()=>{
                this.state.colors = this.state.colors.filter(c => c.hex !== col.hex);
                this.renderSwatches(); // Re-render swatches after removal
                this.render();
                this.saveSessionState();
                if (this.liveSync) this.liveSync.updateColors(this.state.colors);
            };
            c.appendChild(d);
        });
    }

    switchSideTab(tab) {
        this.state.activeSideTab = tab;
        const tabs = ['tools', 'pages', 'box', 'debug'];
        tabs.forEach(t => {
            const tabEl = this.getElement('tab' + t.charAt(0).toUpperCase() + t.slice(1));
            if (tabEl) tabEl.className = `sb-tab ${tab===t?'active':''}`;
            const panelEl = this.getElement('panel' + t.charAt(0).toUpperCase() + t.slice(1));
            if (panelEl) panelEl.style.display = tab===t ? 'block' : 'none';
        });

        if(tab === 'pages') this.renderPageSidebar();
        if(tab === 'box') this.renderBox();
        if(tab === 'debug') this.renderDebug();
    }

    renderDebug() {
        if (this.state.activeSideTab !== 'debug') return;

        const debugRoomId = this.getElement('debugRoomId');
        if (debugRoomId) debugRoomId.innerText = `room_${this.liveSync.ownerId}`;

        const debugUserId = this.getElement('debugUserId');
        if (debugUserId) debugUserId.innerText = this.liveSync.userId || "None";

        const debugStatus = this.getElement('debugStatus');
        if (debugStatus) {
            debugStatus.innerText = this.liveSync.room ? this.liveSync.room.getStorageStatus() : "Disconnected";
            debugStatus.style.color = (this.liveSync.room && this.liveSync.room.getStorageStatus() === 'synchronized') ? 'var(--success)' : 'var(--primary)';
        }

        const debugPageIdx = this.getElement('debugPageIdx');
        if (debugPageIdx) debugPageIdx.innerText = this.state.idx + 1;

        const debugPageCount = this.getElement('debugPageCount');
        if (debugPageCount) debugPageCount.innerText = this.state.images.length;

        const currentImg = this.state.images[this.state.idx];
        const debugHistoryCount = this.getElement('debugHistoryCount');
        if (debugHistoryCount) debugHistoryCount.innerText = currentImg ? (currentImg.history || []).length : 0;

        // LiveMap Trace (Refactored for User-Owned Room Model)
        const mapEl = this.getElement('debugLiveMap');
        const keyEl = this.getElement('debugKeyCheck');

        if (this.liveSync.root && this.liveSync.projectId) {
            const projects = this.liveSync.root.get("projects");
            const project = projects.get(this.liveSync.projectId);

            if (keyEl) {
                keyEl.innerHTML = `
                    <div>In Root.projects: <span style="color:${projects.has(this.liveSync.projectId) ? 'var(--success)' : '#ef4444'}">${projects.has(this.liveSync.projectId)}</span></div>
                    <div>Local projId: <span style="color:var(--primary)">${this.liveSync.projectId}</span></div>
                `;
            }

            if (project) {
                const meta = project.get("metadata").toObject();
                const debugRemoteCount = this.getElement('debugRemoteCount');
                if (debugRemoteCount) debugRemoteCount.innerText = meta.pageCount;

                const debugRemoteOwner = this.getElement('debugRemoteOwner');
                if (debugRemoteOwner) debugRemoteOwner.innerText = meta.ownerId;

                const ph = project.get("pagesHistory");
                if (ph && mapEl) {
                    let html = `<b>Project: ${this.liveSync.projectId}</b><br>`;
                    html += "pagesHistory Keys:<br>";
                    ph.forEach((val, key) => {
                        html += `• pg ${key}: ${val.length} items<br>`;
                    });
                    mapEl.innerHTML = html;
                }
            } else if (mapEl) {
                mapEl.innerHTML = "Waiting for project data...";
            }
        } else if (mapEl) {
            mapEl.innerHTML = "LiveSync not connected.";
        }
    }

    renderPageSidebar() {
        const el = this.getElement('sbPageList');
        if (!el) return;

        // Revoke old blob URLs to prevent memory leaks
        if (this.pageThumbnailUrls) {
            this.pageThumbnailUrls.forEach(url => URL.revokeObjectURL(url));
        }
        this.pageThumbnailUrls = [];

        el.innerHTML = '';
        this.state.images.forEach((img, i) => {
            const d = document.createElement('div');
            d.className = `sb-page-item ${i === this.state.idx ? 'active' : ''}`;
            d.onclick = () => this.loadPage(i);

            const im = new Image();
            const url = URL.createObjectURL(img.blob);
            this.pageThumbnailUrls.push(url);
            im.src = url;

            d.appendChild(im);
            const n = document.createElement('div');
            n.className = 'sb-page-num'; n.innerText = i + 1;
            d.appendChild(n);
            el.appendChild(d);
        });
    }

    resetZoom() {
        this.state.zoom = 1;
        this.state.pan = { x: 0, y: 0 };
        this.render();
    }

    togglePageLock() {
        if (this.state.ownerId !== this.liveSync.userId) return;
        this.state.pageLocked = !this.state.pageLocked;
        this.updateLockUI();
        this.saveSessionState();
    }

    updateLockUI() {
        const btn = this.getElement('lockBtn');
        const ctrl = this.getElement('presenterControls');
        if (this.liveSync && this.state.ownerId === this.liveSync.userId) {
            if (ctrl) ctrl.style.display = 'block';
            if (btn) {
                btn.className = this.state.pageLocked ? "btn btn-primary" : "btn";
                btn.innerHTML = this.state.pageLocked ? '<i class="bi bi-lock-fill"></i> Presenter Lock: ON' : '<i class="bi bi-unlock"></i> Presenter Lock: OFF';
            }
        } else {
            if (ctrl) ctrl.style.display = 'none';
        }
    }

    async saveSessionState() {
        if(!this.state.sessionId || (this.liveSync && this.liveSync.isInitializing) || this.isUploading) return;

        // Save Locally
        const s = await this.dbGet('sessions', this.state.sessionId);
        if(s) {
            s.lastMod = Date.now();
            s.name = this.state.projectName;
            s.state = {
                idx: this.state.idx,
                colors: this.state.colors,
                previewOn: this.state.previewOn,
                strict: this.state.strict,
                bg: this.state.bg,
                penColor: this.state.penColor,
                penSize: this.state.penSize,
                eraserSize: this.state.eraserSize,
                textSize: this.state.textSize,
                shapeType: this.state.shapeType,
                shapeBorder: this.state.shapeBorder,
                shapeFill: this.state.shapeFill,
                shapeWidth: this.state.shapeWidth,
                bookmarks: this.state.bookmarks,
                clipboardBox: this.state.clipboardBox,
                showCursors: this.state.showCursors
            };
            this.dbPut('sessions', s);
            if (this.registry) this.registry.upsert(s);
        }

        // Save Remotely (Metadata)
        if (this.liveSync && !this.liveSync.isInitializing) {
            this.liveSync.updateMetadata({
                name: this.state.projectName,
                baseFileName: this.state.baseFileName,
                idx: this.state.idx,
                pageCount: this.state.images.length,
                pageLocked: this.state.pageLocked,
                ownerId: this.state.ownerId
            });
        }
    }

    async retryBaseFetch() {
        if (this.isFetchingBase) return;
        this.isFetchingBase = true;
        try {
            const res = await fetch(`/api/color_rm/base_file/${this.state.sessionId}`);
            if (res.ok) {
                const blob = await res.blob();
                await this.importBaseFile(blob);
                console.log("Liveblocks: Base file fetch successful.");
            }
        } catch(e) {
            console.error("Liveblocks: Base file fetch failed:", e);
        } finally {
            this.isFetchingBase = false;
        }
    }

    // --- Bookmarks Feature ---
    initBookmark() {
        this.ui.showInput("New Bookmark", "Bookmark Name", (name) => {
             if(!this.state.bookmarks) this.state.bookmarks = [];
             this.state.bookmarks.push({ id: Date.now(), pageIdx: this.state.idx, name: name });
             this.renderBookmarks();
             this.saveSessionState();
             if (this.liveSync) this.liveSync.updateBookmarks(this.state.bookmarks);
        });
    }

    removeBookmark(id) {
        this.state.bookmarks = this.state.bookmarks.filter(b => b.id !== id);
        this.renderBookmarks();
        this.saveSessionState();
        if (this.liveSync) this.liveSync.updateBookmarks(this.state.bookmarks);
    }

    renderBookmarks() {
        const el = this.getElement('bookmarkList');
        if (!el) return;
        el.innerHTML = '';
        if(!this.state.bookmarks || this.state.bookmarks.length === 0) {
            el.innerHTML = '<div style="color:#666; font-size:0.8rem; text-align:center; padding:10px;">No bookmarks yet.</div>';
            return;
        }
        this.state.bookmarks.sort((a,b) => a.pageIdx - b.pageIdx).forEach(b => {
            const div = document.createElement('div');
            div.className = 'bm-item';
            if(b.pageIdx === this.state.idx) div.style.borderColor = 'var(--primary)';
            div.innerHTML = `<span><i class="bi bi-bookmark"></i> ${b.name} <span style="color:#666; font-size:0.7em">(Pg ${b.pageIdx+1})</span></span>`;
            div.onclick = () => this.loadPage(b.pageIdx);

            const del = document.createElement('button');
            del.className = 'bm-del';
            del.innerHTML = '<i class="bi bi-x"></i>';
            del.onclick = (e) => { e.stopPropagation(); this.removeBookmark(b.id); };

            div.appendChild(del);
            el.appendChild(div);
        });
    }

    // --- The Clipboard Box Feature ---
    // Now uses Blobs instead of base64 for ~10x memory savings
    addToBox(x, y, w, h, srcOrBlob=null, pageIdx=null) {
        const createItem = (blob) => {
            if(!this.state.clipboardBox) this.state.clipboardBox = [];
            this.state.clipboardBox.push({
                id: Date.now() + Math.random(),
                blob: blob,  // Store as Blob, not base64
                blobUrl: null,  // Lazy-create URL when rendering
                w: w, h: h,
                pageIdx: (pageIdx !== null) ? pageIdx : this.state.idx
            });

            this.ui.showToast("Added to Box!");
            this.saveSessionState();
            if(this.state.activeSideTab === 'box') this.renderBox();
        };

        // If a Blob was passed directly
        if (srcOrBlob instanceof Blob) {
            createItem(srcOrBlob);
            return;
        }

        // If a base64 dataURL was passed (legacy support), convert to Blob
        if (srcOrBlob && typeof srcOrBlob === 'string' && srcOrBlob.startsWith('data:')) {
            fetch(srcOrBlob)
                .then(res => res.blob())
                .then(blob => createItem(blob));
            return;
        }

        // Capture from canvas
        const cvs = this.getElement('canvas');
        const ctx = cvs.getContext('2d');
        const id = ctx.getImageData(x, y, w, h);
        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        tmp.getContext('2d').putImageData(id, 0, 0);

        // Use toBlob instead of toDataURL
        tmp.toBlob(blob => {
            createItem(blob);
        }, 'image/jpeg', 0.85);
    }

    captureFullPage() {
        const cvs = this.getElement('canvas');
        this.addToBox(0, 0, cvs.width, cvs.height);
    }

    async addRangeToBox() {
        const txt = this.getElement('boxRangeInput').value.trim();
        if(!txt) return alert("Please enter a range (e.g. 1, 3-5)");

        const indices = [];
        const set = new Set();
        txt.split(',').forEach(p => {
            if(p.includes('-')) {
                const [s,e] = p.split('-').map(n=>parseInt(n));
                if(!isNaN(s) && !isNaN(e)) for(let k=s; k<=e; k++) if(k>0 && k<=this.state.images.length) set.add(k-1);
            } else { const n=parseInt(p); if(!isNaN(n) && n>0 && n<=this.state.images.length) set.add(n-1); }
        });
        indices.push(...Array.from(set).sort((a,b)=>a-b));

        if(indices.length === 0) return alert("No valid pages found in range");

        this.ui.toggleLoader(true, "Capturing Pages...");
        const cvs = document.createElement('canvas');
        const ctx = cvs.getContext('2d');

        for(let i=0; i<indices.length; i++) {
            const idx = indices[i];
            this.ui.updateProgress((i/indices.length)*100, `Processing Page ${idx+1}`);
            const item = this.state.images[idx];

            // Render Page to Canvas
            const img = new Image();
            img.src = URL.createObjectURL(item.blob);
            await new Promise(r => img.onload = r);

            cvs.width = img.width; cvs.height = img.height;
            ctx.drawImage(img, 0, 0);

            // Apply Edits (History) to Canvas
            if(item.history && item.history.length > 0) {
                item.history.forEach(st => {
                    ctx.save();
                    if(st.rotation && st.tool!=='pen') {
                        const cx = st.x + st.w/2; const cy = st.y + st.h/2;
                        ctx.translate(cx, cy); ctx.rotate(st.rotation); ctx.translate(-cx, -cy);
                    }
                    if(st.tool === 'text') { ctx.fillStyle = st.color; ctx.font = `${st.size}px sans-serif`; ctx.textBaseline = 'top'; ctx.fillText(st.text, st.x, st.y); }
                    else if(st.tool === 'shape') {
                        ctx.strokeStyle = st.border; ctx.lineWidth = st.width; if(st.fill!=='transparent') { ctx.fillStyle=st.fill; }
                        ctx.beginPath(); const {x,y,w,h} = st;
                        if(st.shapeType==='rectangle') ctx.rect(x,y,w,h); else if(st.shapeType==='circle') ctx.ellipse(x+w/2, y+h/2, Math.abs(w/2), Math.abs(h/2), 0, 0, 2*Math.PI); else if(st.shapeType==='line') { ctx.moveTo(x,y); ctx.lineTo(x+w,y+h); }
                        if(st.fill!=='transparent' && !['line','arrow'].includes(st.shapeType)) ctx.fill(); ctx.stroke();
                    } else {
                        ctx.lineCap='round'; ctx.lineJoin='round'; ctx.lineWidth=st.size; ctx.strokeStyle = st.tool==='eraser' ? '#000' : st.color; if(st.tool==='eraser') ctx.globalCompositeOperation='destination-out';
                        ctx.beginPath(); if(st.pts.length) ctx.moveTo(st.pts[0].x, st.pts[0].y); for(let j=1; j<st.pts.length; j++) ctx.lineTo(st.pts[j].x, st.pts[j].y); ctx.stroke();
                    }
                    ctx.restore();
                });
            }

            // Use toBlob instead of toDataURL for memory efficiency
            const blob = await new Promise(r => cvs.toBlob(r, 'image/jpeg', 0.85));
            this.addToBox(0, 0, cvs.width, cvs.height, blob, idx);
            await new Promise(r => setTimeout(r, 0));
        }

        this.ui.toggleLoader(false);
        this.getElement('boxRangeInput').value = '';
    }

    renderBox() {
        const el = this.getElement('boxList');
        if (!el) return;

        // Revoke old blob URLs to prevent memory leaks
        if (this.boxBlobUrls) {
            this.boxBlobUrls.forEach(url => URL.revokeObjectURL(url));
        }
        this.boxBlobUrls = [];

        el.innerHTML = '';
        const countEl = this.getElement('boxCount');
        if (countEl) countEl.innerText = (this.state.clipboardBox || []).length;

        if(!this.state.clipboardBox || this.state.clipboardBox.length === 0) {
            el.innerHTML = '<div style="grid-column:1/-1; color:#666; text-align:center; padding:20px;">Box is empty. Use Capture Tool or Add Full Page.</div>';
            return;
        }

        this.state.clipboardBox.forEach((item, idx) => {
            const div = document.createElement('div');
            div.className = 'box-item';
            const im = new Image();

            // Support both new Blob format and legacy base64 src format
            if (item.blob) {
                const url = URL.createObjectURL(item.blob);
                this.boxBlobUrls.push(url);
                im.src = url;
            } else if (item.src) {
                im.src = item.src;  // Legacy base64 support
            }

            div.appendChild(im);

            const btn = document.createElement('button');
            btn.className = 'box-del';
            btn.innerHTML = '<i class="bi bi-trash"></i>';
            btn.onclick = () => {
                // Revoke the URL for this item if it has one
                if (item.blob && item.blobUrl) {
                    URL.revokeObjectURL(item.blobUrl);
                }
                this.state.clipboardBox.splice(idx, 1);
                this.saveSessionState();
                this.renderBox();
            };
            div.appendChild(btn);
            el.appendChild(div);
        });
    }

    clearBox() {
        if(confirm("Clear all items in Box?")) {
            // Revoke all blob URLs
            if (this.boxBlobUrls) {
                this.boxBlobUrls.forEach(url => URL.revokeObjectURL(url));
                this.boxBlobUrls = [];
            }
            this.state.clipboardBox = [];
            this.saveSessionState();
            this.renderBox();
        }
    }

    addBoxTag(t, area) {
        const id = area === 'header' ? 'boxHeaderTxt' : 'boxLabelTxt';
        const el = this.getElement(id);
        if(el) el.value += " " + t;
    }

    processTags(text, context = {}) {
        const now = new Date();
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        let res = text.replace('{date}', now.toLocaleDateString())
                      .replace('{day}', days[now.getDay()])
                      .replace('{time}', now.toLocaleTimeString())
                      .replace('{count}', (this.state.clipboardBox||[]).length);

        if(context.seq !== undefined) res = res.replace('{seq}', context.seq);
        if(context.page !== undefined) res = res.replace('{page}', context.page);

        return res;
    }

    async generateBoxImage() {
        if(!this.state.clipboardBox || this.state.clipboardBox.length === 0) return alert("Box is empty");

        this.ui.toggleLoader(true, "Generating Sheets...");

        const cols = parseInt(this.getElement('boxCols').value);
        const pad = 30;
        const A4W = 2480;
        const A4H = 3508;
        const colW = (A4W - (pad * (cols + 1))) / cols;

        // Configs
        const practiceOn = this.getElement('boxPracticeOn').checked;
        const practiceCol = this.getElement('boxPracticeColor').value;
        const labelsOn = this.getElement('boxLabelsOn').checked;
        const labelPos = this.getElement('boxLabelsPos').value;
        const labelTxt = this.getElement('boxLabelTxt').value;
        const labelH = labelsOn ? 60 : 0;

        // Pagination State
        let pages = [];
        let currentCanvas = document.createElement('canvas');
        currentCanvas.width = A4W; currentCanvas.height = A4H;
        let ctx = currentCanvas.getContext('2d');

        // Helper to start new page
        const initPage = () => {
             ctx.fillStyle = "#ffffff"; ctx.fillRect(0,0, A4W, A4H);
             return this.getElement('boxHeaderOn').checked ? 150 : pad;
        };

        let currentY = initPage();

        // 1. Organize into Rows
        const rows = [];
        for(let i = 0; i < this.state.clipboardBox.length; i += cols) {
             const rowItems = this.state.clipboardBox.slice(i, i + cols);

             // Calculate Heights
             const effectiveImgW = practiceOn ? (colW/2 - 10) : colW;

             const rowHeights = rowItems.map(item => item.h * (effectiveImgW / item.w));
             const maxRowH = Math.max(...rowHeights);

             rows.push({
                 items: rowItems.map((item, idx) => ({
                     item,
                     finalH: item.h * (effectiveImgW / item.w),
                     seq: i + idx + 1
                 })),
                 height: maxRowH + labelH + pad
             });
        }

        // 2. Draw Loop
        for(let r=0; r<rows.length; r++) {
            const row = rows[r];

            // Check Pagination
            if((currentY + row.height + (this.getElement('boxFooterOn').checked ? 100 : 0)) > A4H) {
                this.drawHeaderFooter(ctx, A4W, A4H);
                pages.push(currentCanvas);

                currentCanvas = document.createElement('canvas');
                currentCanvas.width = A4W; currentCanvas.height = A4H;
                ctx = currentCanvas.getContext('2d');
                currentY = initPage();
            }

            // Draw Row
            for(let c=0; c<row.items.length; c++) {
                const {item, finalH, seq} = row.items[c];
                const x = pad + (c * (colW + pad));

                // Vertical Alignment (Top)
                const effectiveImgW = practiceOn ? (colW/2 - 10) : colW;

                // Label Position
                let imgY = currentY;
                let labelY = 0;

                if(labelsOn) {
                    if(labelPos === 'top') { labelY = currentY + 30; imgY = currentY + labelH; }
                    else { imgY = currentY; labelY = currentY + finalH + 40; }
                }

                const img = new Image();
                // Support both Blob and legacy base64 src formats
                if (item.blob) {
                    img.src = URL.createObjectURL(item.blob);
                } else if (item.src) {
                    img.src = item.src;
                }
                await new Promise(r => img.onload = r);
                // Revoke blob URL after loading
                if (item.blob) {
                    URL.revokeObjectURL(img.src);
                }

                ctx.drawImage(img, x, imgY, effectiveImgW, finalH);

                // Draw Practice Space
                if(practiceOn) {
                    const px = x + effectiveImgW + 20;
                    ctx.fillStyle = practiceCol === 'white' ? '#fff' : '#000';
                    ctx.fillRect(px, imgY, effectiveImgW, finalH);
                    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 2;
                    ctx.strokeRect(px, imgY, effectiveImgW, finalH);
                }

                // Draw Label
                if(labelsOn) {
                    ctx.fillStyle = "#333"; ctx.textAlign = "center"; ctx.font = "30px sans-serif";
                    const lbl = this.processTags(labelTxt, {seq: seq, page: (item.pageIdx !== undefined ? item.pageIdx+1 : '?')});
                    ctx.fillText(lbl, x + colW/2, labelY);
                }
            }
            currentY += row.height;
        }

        // Finish last page
        this.drawHeaderFooter(ctx, A4W, A4H);
        pages.push(currentCanvas);

        // Export Logic
        try {
            if(pages.length === 1) {
                const blob = await new Promise(r => pages[0].toBlob(r, 'image/png'));
                const filename = `${this.state.projectName}_Sheet.png`;

                if (this.saveBlobNative(blob, filename)) {
                    // Handled by Android
                } else {
                    const file = new File([blob], filename, { type: 'image/png' });
                    if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        await navigator.share({
                            files: [file],
                            title: 'Export Sheet',
                            text: 'Here is the exported sheet.'
                        });
                    } else {
                        const a = document.createElement('a');
                        a.download = filename;
                        a.href = URL.createObjectURL(blob);
                        a.click();
                    }
                }
            } else {
                this.ui.toggleLoader(true, "Zipping...");
                const zip = new JSZip();

                // Use JPEG for smaller file sizes (especially on Android)
                const useJpeg = pages.length > 2 || (window.Capacitor !== undefined);
                const format = useJpeg ? 'image/jpeg' : 'image/png';
                const ext = useJpeg ? 'jpg' : 'png';
                const quality = useJpeg ? 0.85 : undefined;

                for(let i=0; i<pages.length; i++) {
                    this.ui.toggleLoader(true, `Compressing ${i+1}/${pages.length}...`);
                    const blob = await new Promise(r => pages[i].toBlob(r, format, quality));
                    zip.file(`${this.state.projectName}_Sheet_${i+1}.${ext}`, blob);

                    // Yield to UI to prevent freezing
                    await new Promise(r => setTimeout(r, 0));
                }

                this.ui.toggleLoader(true, "Generating zip...");
                const content = await zip.generateAsync({
                    type: "blob",
                    compression: "DEFLATE",
                    compressionOptions: { level: 6 }  // Balance speed vs size
                }, (metadata) => {
                    // Progress callback
                    this.ui.toggleLoader(true, `Zipping ${Math.round(metadata.percent)}%...`);
                });
                const filename = `${this.state.projectName}_Sheets.zip`;

                if (this.saveBlobNative(content, filename)) {
                    // Handled by Android
                } else {
                    const file = new File([content], filename, { type: 'application/zip' });
                    if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        await navigator.share({
                            files: [file],
                            title: 'Export Sheets',
                            text: 'Here are the exported sheets.'
                        });
                    } else {
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(content);
                        a.download = filename;
                        a.click();
                    }
                }
            }
        } catch (e) {
            console.error("Export failed:", e);
            alert("Export failed: " + e.message);
        }
        this.ui.toggleLoader(false);
    }

    drawHeaderFooter(ctx, w, h) {
        if(this.getElement('boxHeaderOn').checked) {
            let txt = this.getElement('boxHeaderTxt').value || "Clipboard Sheet";
            txt = this.processTags(txt);
            ctx.fillStyle = "#333"; ctx.font = "bold 60px sans-serif"; ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(txt, w/2, 75);
        }
        if(this.getElement('boxFooterOn').checked) {
            let txt = this.getElement('boxFooterTxt').value || "Generated by ColorRM Pro";
            txt = this.processTags(txt);
            ctx.fillStyle = "#666"; ctx.font = "40px sans-serif"; ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(txt, w/2, h - 50);
        }
    }

    // Export functions (PDF)
    setDlTab(t) {
        const tabRange = this.getElement('tabRange');
        const tabSelect = this.getElement('tabSelect');
        const tabOpts = this.getElement('tabOpts');
        const dlPanelRange = this.getElement('dlPanelRange');
        const dlPanelSelect = this.getElement('dlPanelSelect');
        const dlPanelOpts = this.getElement('dlPanelOpts');

        if (tabRange) tabRange.className = `tab-btn ${t==='range'?'active':''}`;
        if (tabSelect) tabSelect.className = `tab-btn ${t==='select'?'active':''}`;
        if (tabOpts) tabOpts.className = `tab-btn ${t==='opts'?'active':''}`;
        if (dlPanelRange) dlPanelRange.style.display = t==='range'?'block':'none';
        if (dlPanelSelect) dlPanelSelect.style.display = t==='select'?'block':'none';
        if (dlPanelOpts) dlPanelOpts.style.display = t==='opts'?'block':'none';
    }

    renderDlGrid() {
        const g = this.getElement('dlThumbGrid');
        if (!g) return;
        g.innerHTML = '';
        this.state.images.forEach((img, i) => {
            const el = document.createElement('div');
            el.className = `thumb-item ${this.state.dlSelection.includes(i)?'selected':''}`;
            el.onclick = () => {
                if(this.state.dlSelection.includes(i)) this.state.dlSelection = this.state.dlSelection.filter(x=>x!==i);
                else this.state.dlSelection.push(i);
                this.state.dlSelection.sort((a,b)=>a-b);
                el.className = `thumb-item ${this.state.dlSelection.includes(i)?'selected':''}`;
            };
            const im = new Image(); im.src = URL.createObjectURL(img.blob);
            el.appendChild(im);
            const sp = document.createElement('span'); sp.innerText = i+1; el.appendChild(sp);
            g.appendChild(el);
        });
    }

    dlSelectAll(y) {
        this.state.dlSelection = y ? this.state.images.map((_,i)=>i) : [];
        this.renderDlGrid();
    }

    addTag(t) {
        const h = this.getElement('exHeaderTxt');
        if (h) h.value += " " + t;
    }

    async processExport() {
        let indices = [];
        const tabSelect = this.getElement('tabSelect');
        if(tabSelect && tabSelect.classList.contains('active')) {
            indices = this.state.dlSelection.length ? this.state.dlSelection : this.state.images.map((_,i)=>i);
        } else {
            const rangeInput = this.getElement('dlRangeInput');
            const txt = rangeInput ? rangeInput.value.trim() : '';
            if(!txt) indices = this.state.images.map((_,i)=>i);
            else {
                const set = new Set();
                txt.split(',').forEach(p => {
                    if(p.includes('-')) {
                        const [s,e] = p.split('-').map(n=>parseInt(n));
                        if(!isNaN(s) && !isNaN(e)) for(let k=s; k<=e; k++) if(k>0 && k<=this.state.images.length) set.add(k-1);
                    } else { const n=parseInt(p); if(!isNaN(n) && n>0 && n<=this.state.images.length) set.add(n-1); }
                });
                indices = Array.from(set).sort((a,b)=>a-b);
            }
        }

        if(indices.length===0) return alert("No pages selected");

        const exportModal = this.getElement('exportModal');
        if (exportModal) exportModal.style.display='none';
        this.ui.toggleLoader(true, "Exporting PDF...");

        // Configs
        const exHeaderOn = this.getElement('exHeaderOn');
        const doHeader = exHeaderOn ? exHeaderOn.checked : false;

        const exHeaderTxt = this.getElement('exHeaderTxt');
        const headTpl = exHeaderTxt ? exHeaderTxt.value : '';

        const exHeaderAlign = this.getElement('exHeaderAlign');
        const headAlign = exHeaderAlign ? exHeaderAlign.value : 'center';

        const exHeaderSize = this.getElement('exHeaderSize');
        const headSize = exHeaderSize ? (parseInt(exHeaderSize.value) || 10) : 10;

        const exHeaderColor = this.getElement('exHeaderColor');
        const headColor = exHeaderColor ? exHeaderColor.value : '#000000';

        const exFooterOn = this.getElement('exFooterOn');
        const doFooter = exFooterOn ? exFooterOn.checked : false;

        const exFooterTxt = this.getElement('exFooterTxt');
        const footTpl = exFooterTxt ? exFooterTxt.value : '';

        const exFooterAlign = this.getElement('exFooterAlign');
        const footAlign = exFooterAlign ? exFooterAlign.value : 'center';

        const exFooterSize = this.getElement('exFooterSize');
        const footSize = exFooterSize ? (parseInt(exFooterSize.value) || 10) : 10;

        const exFooterColor = this.getElement('exFooterColor');
        const footColor = exFooterColor ? exFooterColor.value : '#000000';

        const now = new Date(), dateStr = now.toLocaleDateString(), days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], dayStr = days[now.getDay()];
        const getTagText = (tpl, seq, pg) => tpl.replace('{seq}', seq).replace('{date}', dateStr).replace('{page}', pg).replace('{day}', dayStr).replace('{time}', now.toLocaleTimeString());
        const hexToRgb = (hex) => { const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [0,0,0]; };

        // Check if jspdf is available
        if (!window.jspdf) {
            alert("jsPDF library not loaded");
            this.ui.toggleLoader(false);
            return;
        }

        const pdfDoc = new window.jspdf.jsPDF({orientation: 'p', unit: 'mm', format: 'a4'});
        const cvs = document.createElement('canvas'); const cx = cvs.getContext('2d');

        for(let i=0; i<indices.length; i++) {
            const idx = indices[i];
            this.ui.updateProgress((i/indices.length)*100, `Page ${i+1}/${indices.length}`);

            const item = this.state.images[idx];
            const img = new Image(); img.src = URL.createObjectURL(item.blob);
            await new Promise(r=>img.onload=r);

            cvs.width = img.width; cvs.height = img.height;
            cx.drawImage(img,0,0);

            // Color Removal
            let targets = this.state.colors.map(x=>x.lab);
            if(targets.length > 0) {
                const imgD = cx.getImageData(0,0,cvs.width,cvs.height); const d = imgD.data; const lab = new Float32Array(cvs.width*cvs.height*3);
                for(let k=0,j=0; k<d.length; k+=4,j+=3){ const [l,a,b] = this.rgbToLab(d[k],d[k+1],d[k+2]); lab[j]=l; lab[j+1]=a; lab[j+2]=b; }
                const sq = this.state.strict**2;
                for(let k=0, j=0; k<d.length; k+=4, j+=3) { if(d[k+3]===0) continue; const l=lab[j], a=lab[j+1], b=lab[j+2]; let keep = false; for(let t of targets) if(((l-t[0])**2 + (a-t[1])**2 + (b-t[2])**2) <= sq) { keep = true; break; } if(!keep) d[k+3] = 0; }
                cx.putImageData(imgD, 0, 0);
            }

            // Draw history
            if (item.history) {
                item.history.forEach(st => {
                    cx.save();
                    if(st.rotation && st.tool!=='pen') { const centerx = st.x + st.w/2; const centery = st.y + st.h/2; cx.translate(centerx, centery); cx.rotate(st.rotation); cx.translate(-centerx, -centery); }
                    if(st.tool === 'text') { cx.fillStyle = st.color; cx.font = `${st.size}px sans-serif`; cx.textBaseline = 'top'; cx.fillText(st.text, st.x, st.y); }
                    else if(st.tool === 'shape') {
                        cx.strokeStyle = st.border; cx.lineWidth = st.width; if(st.fill!=='transparent') { cx.fillStyle=st.fill; }
                        cx.beginPath(); const {x,y,w,h} = st;
                        if(st.shapeType==='rectangle') cx.rect(x,y,w,h); else if(st.shapeType==='circle') cx.ellipse(x+w/2, y+h/2, Math.abs(w/2), Math.abs(h/2), 0, 0, 2*Math.PI); else if(st.shapeType==='line') { cx.moveTo(x,y); cx.lineTo(x+w,y+h); } else if(st.shapeType==='arrow') { const head=15; const ang=Math.atan2(h,w); cx.moveTo(x,y); cx.lineTo(x+w,y+h); cx.lineTo(x+w - head*Math.cos(ang-0.5), y+h - head*Math.sin(ang-0.5)); cx.moveTo(x+w,y+h); cx.lineTo(x+w - head*Math.cos(ang+0.5), y+h - head*Math.sin(ang+0.5)); }
                        if(st.fill!=='transparent' && !['line','arrow'].includes(st.shapeType)) cx.fill(); cx.stroke();
                    } else {
                        cx.lineCap='round'; cx.lineJoin='round'; cx.lineWidth=st.size; cx.strokeStyle = st.tool==='eraser' ? '#000' : st.color; if(st.tool==='eraser') cx.globalCompositeOperation='destination-out';
                        cx.beginPath(); if(st.pts.length) cx.moveTo(st.pts[0].x, st.pts[0].y); for(let j=1; j<st.pts.length; j++) cx.lineTo(st.pts[j].x, st.pts[j].y); cx.stroke();
                    }
                    cx.restore();
                });
            }

            const u = cvs.toDataURL('image/jpeg', 0.85);
            const props = pdfDoc.getImageProperties(u);

            if (i > 0) pdfDoc.addPage();
            const pageW = pdfDoc.internal.pageSize.getWidth();
            const pageH = pdfDoc.internal.pageSize.getHeight();

            const marginX = 10;
            const headerMargin = doHeader ? 15 : 10;
            const footerMargin = doFooter ? 15 : 10;

            const printableW = pageW - (marginX * 2);
            const printableH = pageH - headerMargin - footerMargin;

            const ratio = Math.min(printableW / props.width, printableH / props.height);
            const scaledW = props.width * ratio;
            const scaledH = props.height * ratio;

            const offsetX = marginX + (printableW - scaledW) / 2;
            const offsetY = headerMargin + (printableH - scaledH) / 2;

            pdfDoc.addImage(u, 'JPEG', offsetX, offsetY, scaledW, scaledH);

            // Draw Header
            if(doHeader && headTpl) {
                const txt = getTagText(headTpl, i+1, idx+1);
                pdfDoc.setFontSize(headSize);
                const rgb = hexToRgb(headColor); pdfDoc.setTextColor(rgb[0], rgb[1], rgb[2]);
                let x = (headAlign === 'center') ? pageW / 2 : (headAlign === 'right' ? pageW - marginX : marginX);
                pdfDoc.text(txt, x, headerMargin - 5, {align: headAlign, baseline:'bottom'});
            }

            // Draw Footer
            if(doFooter && footTpl) {
                const txt = getTagText(footTpl, i+1, idx+1);
                pdfDoc.setFontSize(footSize);
                const rgb = hexToRgb(footColor); pdfDoc.setTextColor(rgb[0], rgb[1], rgb[2]);
                let x = (footAlign === 'center') ? pageW / 2 : (footAlign === 'right' ? pageW - marginX : marginX);
                pdfDoc.text(txt, x, pageH - footerMargin + 5, {align: footAlign, baseline:'top'});
            }

            await new Promise(r => setTimeout(r, 0));
        }

        const fName = (this.state.projectName || "Export").replace(/[^a-z0-9]/gi, '_');

        try {
            const blob = pdfDoc.output('blob');

            if (this.saveBlobNative(blob, `${fName}.pdf`)) {
                // Handled by Android
            } else {
                const file = new File([blob], `${fName}.pdf`, { type: 'application/pdf' });

                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: 'Export PDF',
                        text: 'Here is your exported PDF.'
                    });
                } else {
                    pdfDoc.save(`${fName}.pdf`);
                }
            }
        } catch (e) {
            console.error("PDF Export failed:", e);
            pdfDoc.save(`${fName}.pdf`);
        }

        this.ui.toggleLoader(false);
    }

    // --- Session Management ---

    async loadSessionList() {
        const userIdEl = this.getElement('dashUserId');
        const projIdEl = this.getElement('dashProjId');
        if (userIdEl) userIdEl.innerText = this.liveSync.userId;
        if (projIdEl) projIdEl.innerText = this.state.sessionId;

        this.state.selectedSessions = new Set(); // Reset selection

        const tx = this.db.transaction('sessions', 'readonly');
        const req = tx.objectStore('sessions').getAll();
        req.onsuccess = () => {
            const l = this.getElement('sessionList');
            if (!l) return;
            l.innerHTML = '';

            if(!req.result || req.result.length === 0) {
                l.innerHTML = '<div style="color:#666;text-align:center;padding:10px">No projects found.</div>';
                const editBtn = this.getElement('dashEditBtn');
                if (editBtn) editBtn.style.display = 'none';
                return;
            }

            const editBtn = this.getElement('dashEditBtn');
            if (editBtn) editBtn.style.display = 'block';

            req.result.sort((a,b) => b.lastMod - a.lastMod).forEach(s => {
                const isMine = s.ownerId === this.liveSync.userId;
                const badge = isMine ? '<span class="owner-badge">Owner</span>' : `<span class="other-badge">Shared</span>`;
                const cloudIcon = s.isCloudBackedUp ? '<i class="bi bi-cloud-check-fill" style="color:var(--success); margin-left:6px;" title="Backed up to Cloud"></i>' : '';

                const item = document.createElement('div');
                item.className = 'session-item';
                item.id = `sess_${s.id}`;
                item.onclick = (e) => {
                    if (this.state.isMultiSelect) {
                        e.stopPropagation();
                        this.toggleSessionSelection(s.id);
                    } else {
                        this.switchProject(s.ownerId, s.id);
                    }
                };

                item.innerHTML = `
                    <input type="checkbox" class="session-checkbox" onclick="event.stopPropagation()" onchange="window.location.hash.includes('${s.id}') ? null : this.checked = !this.checked">
                    <div>
                        <div style="font-weight:600; color:white;">${s.name} ${badge} ${cloudIcon}</div>
                        <div style="font-size:0.7rem; color:#666; font-family:monospace;">${s.id}</div>
                    </div>
                    <div style="font-size:0.7rem; color:#888;">${s.pageCount} pgs</div>
                `;

                // Re-bind checkbox change properly since innerHTML kills listeners
                const cb = item.querySelector('.session-checkbox');
                if (cb) cb.onchange = () => this.toggleSessionSelection(s.id);

                l.appendChild(item);
            });
            this.updateMultiSelectUI();
        };
    }

    toggleMultiSelect() {
        this.state.isMultiSelect = !this.state.isMultiSelect;
        const list = this.getElement('sessionList');
        const bar = this.getElement('multiDeleteBar');
        const btn = this.getElement('dashEditBtn');

        if (list) list.classList.toggle('active-multi', this.state.isMultiSelect);
        if (bar) bar.classList.toggle('show', this.state.isMultiSelect);
        if (btn) btn.innerHTML = this.state.isMultiSelect ? '<i class="bi bi-x-circle"></i> Cancel' : '<i class="bi bi-pencil-square"></i> Edit';

        if (!this.state.isMultiSelect) {
            this.state.selectedSessions.clear();
            this.updateMultiSelectUI();
        }
    }

    toggleSessionSelection(id) {
        if (this.state.selectedSessions.has(id)) this.state.selectedSessions.delete(id);
        else this.state.selectedSessions.add(id);
        this.updateMultiSelectUI();
    }

    selectAllSessions() {
        const tx = this.db.transaction('sessions', 'readonly');
        const req = tx.objectStore('sessions').getAll();
        req.onsuccess = () => {
            req.result.forEach(s => this.state.selectedSessions.add(s.id));
            this.updateMultiSelectUI();
        };
    }

    updateMultiSelectUI() {
        const count = this.state.selectedSessions.size;
        const countEl = this.getElement('multiDeleteCount');
        if (countEl) countEl.innerText = `${count} selected`;

        // Update Checkboxes and classes
        const list = this.getElement('sessionList');
        if(!list) return;
        const items = list.querySelectorAll('.session-item');
        items.forEach(el => {
            const idStr = el.id.replace('sess_', '');
            const isSelected = this.state.selectedSessions.has(idStr) || (!isNaN(idStr) && this.state.selectedSessions.has(Number(idStr)));

            el.classList.toggle('selected', isSelected);
            const cb = el.querySelector('.session-checkbox');
            if (cb) cb.checked = isSelected;
        });
    }

    async deleteSelectedSessions() {
        const count = this.state.selectedSessions.size;
        if (count === 0) return;
        if (!confirm(`Permanently delete ${count} project(s) and ALL their drawing data? This cannot be undone.`)) return;

        this.ui.toggleLoader(true, "Deleting...");

        const deletePromises = Array.from(this.state.selectedSessions).map(async (id) => {
            if (this.registry) this.registry.delete(id);
            return new Promise((resolve) => {
                // 1. Delete Pages
                const pagesTx = this.db.transaction('pages', 'readwrite');
                const pagesStore = pagesTx.objectStore('pages');
                const index = pagesStore.index('sessionId');
                const pagesReq = index.getAll(id);

                pagesReq.onsuccess = () => {
                    pagesReq.result.forEach(pg => pagesStore.delete(pg.id));

                    // 2. Delete Session Metadata
                    const sessTx = this.db.transaction('sessions', 'readwrite');
                    sessTx.objectStore('sessions').delete(id);
                    sessTx.oncomplete = () => resolve();
                };
            });
        });

        await Promise.all(deletePromises);

        const deletedActive = this.state.selectedSessions.has(this.state.sessionId);

        this.state.isMultiSelect = false;
        this.state.selectedSessions.clear();

        const editBtn = this.getElement('dashEditBtn');
        if (editBtn) editBtn.innerHTML = '<i class="bi bi-pencil-square"></i> Edit';

        const list = this.getElement('sessionList');
        if (list) list.classList.remove('active-multi');

        const bar = this.getElement('multiDeleteBar');
        if (bar) bar.classList.remove('show');

        if (deletedActive) {
            window.location.hash = '';
            location.reload();
        } else {
            await this.loadSessionList();
            this.ui.toggleLoader(false);
        }
    }

    async switchProject(ownerId, projectId) {
        this.ui.hideDashboard();
        window.location.hash = `/color_rm/${ownerId}/${projectId}`;
        location.reload();
    }

    async loadSessionPages(id) {
        return new Promise((resolve, reject) => {
            const q = this.db.transaction('pages').objectStore('pages').index('sessionId').getAll(id);
            q.onsuccess = () => {
                this.state.images = q.result.sort((a,b)=>a.pageIndex-b.pageIndex);

                // Retroactively assign IDs to legacy items
                this.state.images.forEach(img => {
                    if (img.history) {
                        img.history.forEach(item => {
                            if (!item.id) item.id = Date.now() + '_' + Math.random();
                        });
                    }
                });

                console.log(`Loaded ${this.state.images.length} pages from DB.`);
                const pageTotal = this.getElement('pageTotal');
                if (pageTotal) pageTotal.innerText = '/ ' + this.state.images.length;

                if(this.state.activeSideTab === 'pages') this.renderPageSidebar();
                if(this.state.images.length > 0 && !this.cache.currentImg) this.loadPage(0);
                resolve();
            };
            q.onerror = (e) => reject(e);
        });
    }

    async importBaseFile(blob) {
        // Simulates a file input event to reuse existing handleImport logic
        const file = new File([blob], "base_document_blob", { type: blob.type });
        await this.handleImport({ target: { files: [file] } }, true); // Pass true to skip upload
    }

    async computeFileHash(file) {
        try {
            const buffer = await file.arrayBuffer();
            const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
            console.error("Hash calculation failed", e);
            return null;
        }
    }

    async handleImport(e, skipUpload = false) {
        const files = e.target.files;
        if(!files || !files.length) return;

        // Deduplication Check
        let fileHash = null;
        if (!skipUpload && files[0].type.includes('pdf')) {
            try {
                fileHash = await this.computeFileHash(files[0]);
                if (fileHash) {
                    const sessions = await new Promise(r => {
                        const tx = this.db.transaction('sessions', 'readonly');
                        const req = tx.objectStore('sessions').getAll();
                        req.onsuccess = () => r(req.result);
                        req.onerror = () => r([]);
                    });
                    const existing = sessions.find(s => s.fileHash === fileHash);
                    if (existing) {
                        if (confirm(`This PDF already exists as "${existing.name}". Load it instead?`)) {
                            this.switchProject(existing.ownerId || this.liveSync?.userId || 'local', existing.id);
                            return;
                        }
                    }
                }
            } catch (err) { console.error("Hash check error:", err); }
        }

        this.isUploading = true; // Set flag

        // --- CRITICAL: FORCE UNIQUE PROJECT FOR EVERY NEW UPLOAD ---
        const localUserId = this.liveSync?.userId || 'local';
        if (!skipUpload) {
            const newProjectId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            console.log("ColorRM: Forcing new unique project key for upload:", newProjectId);
            await this.createNewProject(false, newProjectId, localUserId);
        } else if (!this.state.sessionId) {
            // Sync case: only create if missing (Legacy support)
            await this.createNewProject(false, this.state.sessionId, this.liveSync?.ownerId || localUserId);
        }

        this.ui.hideDashboard();
        this.ui.toggleLoader(true, "Initializing...");

        const nameInput = this.getElement('newProjectName');
        let pName = (nameInput && nameInput.value.trim());

        // Priority: 1. Manual Input, 2. Existing State, 3. File Name, 4. Fallback
        if (!pName) {
            if (this.state.projectName && this.state.projectName !== "Untitled" && !files[0].name.includes("base_document_blob")) {
                pName = this.state.projectName;
            } else {
                pName = files[0].name.replace(/\\.[^/.]+$/, "");
                // If it's the dummy blob name, try to use existing state name or fallback
                if (pName.includes("base_document_blob")) {
                    pName = (this.state.projectName && this.state.projectName !== "Untitled") ? this.state.projectName : "Untitled Project";
                }
            }
        }
        if(!pName || pName === "Untitled") pName = "Untitled Project";

        // --- Sync to Server ---
        if (!skipUpload && this.state.sessionId) {
            console.log('ColorRM Sync: Uploading base file to server for ID:', this.state.sessionId);
            this.ui.toggleLoader(true, "Uploading to server...");
            try {
                const uploadRes = await fetch(`/api/color_rm/upload/${this.state.sessionId}`, {
                    method: 'POST',
                    body: files[0],
                    headers: {
                        'Content-Type': files[0].type,
                        'x-project-name': encodeURIComponent(pName)
                    }
                });
                if (uploadRes.ok) {
                    console.log('ColorRM Sync: Base file upload successful.');
                } else {
                    const errTxt = await uploadRes.text();
                    console.error('ColorRM Sync: Upload failed:', errTxt);
                    alert(`Upload Failed: ${errTxt}\\nCollaborators won't see the document background.`);
                }
            } catch (err) {
                console.error('ColorRM Sync: Error uploading base file:', err);
                alert("Network Error: Could not upload base file to server. Collaboration will be limited.");
            }
        }
        // -----------------------

        this.state.projectName = pName;
        this.state.baseFileName = files[0].name;
        const titleEl = this.getElement('headerTitle');
        if (titleEl) titleEl.innerText = pName;

        // Ensure ownerId is set before saving
        if (!this.state.ownerId) this.state.ownerId = this.liveSync?.userId || 'local';

        const session = await this.dbGet('sessions', this.state.sessionId);
        if(session) {
            session.name = pName;
            session.baseFileName = this.state.baseFileName;
            session.ownerId = this.state.ownerId;
            if (fileHash) session.fileHash = fileHash;
            await this.dbPut('sessions', session);
        } else {
            // Fallback create
            await this.dbPut('sessions', {
                id: this.state.sessionId,
                name: pName,
                baseFileName: this.state.baseFileName,
                pageCount: 0,
                lastMod: Date.now(),
                idx:0,
                bookmarks: [],
                clipboardBox: [],
                ownerId: this.state.ownerId,
                fileHash: fileHash
            });
        }

        const processQueue = Array.from(files);
        let idx = 0; // Reset for new project
        const BATCH_SIZE = 5;

        // Update UI immediately
        if (titleEl) titleEl.innerText = pName;
        this.state.images = [];

        // Wrap processing in a promise to await completion
        await new Promise((resolve) => {
            const processNext = async () => {
                if(processQueue.length === 0) {
                    // Update storage with final page count
                    const session = await this.dbGet('sessions', this.state.sessionId);
                    if (session) {
                        session.pageCount = idx;
                        await this.dbPut('sessions', session);
                        // Sync to cloud registry so it appears on other devices
                        if (this.registry) this.registry.upsert(session);
                    }

                    // Final reload to ensure everything is synced
                    await this.loadSessionPages(this.state.sessionId);

                    // Signal readiness to Liveblocks
                    if (this.liveSync && !this.liveSync.isInitializing) {
                        this.liveSync.updateMetadata({
                            name: this.state.projectName,
                            pageCount: idx
                        });
                    }

                    this.isUploading = false; // Reset flag
                    this.ui.toggleLoader(false);
                    resolve();
                    return;
                }

                const f = processQueue.shift();
                if(f.type.includes('pdf')) {
                     try {
                         const d = await f.arrayBuffer();
                         const pdf = await pdfjsLib.getDocument(d).promise;
                         for(let i=1; i<=pdf.numPages; i+=BATCH_SIZE) {
                             const batch = [];
                             for(let j=0; j<BATCH_SIZE && (i+j)<=pdf.numPages; j++) {
                                 const pNum = i+j;
                                 batch.push(pdf.getPage(pNum).then(async page => {
                                     const v = page.getViewport({scale:1.5});
                                     const cvs = document.createElement('canvas'); cvs.width=v.width; cvs.height=v.height;
                                     await page.render({canvasContext:cvs.getContext('2d'), viewport:v}).promise;
                                     const b = await new Promise(r=>cvs.toBlob(r, 'image/jpeg', 0.8));
                                     const pageObj = { id:`${this.state.sessionId}_${idx+j}`, sessionId:this.state.sessionId, pageIndex:idx+j, blob:b, history:[] };
                                     await this.dbPut('pages', pageObj);
                                     return pageObj;
                                 }));
                             }
                             const results = await Promise.all(batch);

                             // INCREMENTAL UPDATE: Add results to state and update UI
                             this.state.images.push(...results);
                             this.state.images.sort((a,b) => a.pageIndex - b.pageIndex);

                             if (this.state.images.length > 0 && !this.cache.currentImg) {
                                 await this.loadPage(0, false); // Load first page as soon as it's ready
                             }

                             if(this.state.activeSideTab === 'pages') this.renderPageSidebar();
                             const pt = this.getElement('pageTotal');
                             if (pt) pt.innerText = '/ ' + this.state.images.length;

                             idx += results.length;
                             this.ui.updateProgress(((i/pdf.numPages)*100), `Processing Page ${i}/${pdf.numPages}`);
                             await new Promise(r => setTimeout(r, 0));
                         }
                     } catch(e) { console.error(e); alert("Failed to load PDF"); }
                } else {
                    const pageObj = { id:`${this.state.sessionId}_${idx}`, sessionId:this.state.sessionId, pageIndex:idx, blob:f, history:[] };
                    await this.dbPut('pages', pageObj);
                    this.state.images.push(pageObj);
                    if (this.state.images.length === 1) await this.loadPage(0, false);
                    if(this.state.activeSideTab === 'pages') this.renderPageSidebar();
                    idx++;
                }
                processNext();
            };
            processNext();
        });
    }

    async createNewProject(openPicker = true, forceId = null, forceOwnerId = null) {
        // Determine IDs (One PDF -> One Project Key in User Room)
        const regUser = this.registry ? this.registry.getUsername() : null;
        const ownerId = forceOwnerId || regUser || this.liveSync?.userId || 'local';
        const projectId = forceId || `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        // --- IMMEDIATE UI & URL UPDATE ---
        this.state.ownerId = ownerId;
        this.state.sessionId = projectId;
        this.ui.hideDashboard();

        // Only update URL hash for main app
        if (this.config.isMain) {
            window.location.hash = `/color_rm/${ownerId}/${projectId}`;
        }

        const nameInput = this.getElement('newProjectName');
        const name = (nameInput && nameInput.value) || "Untitled";
        this.state.projectName = name;
        const titleEl = this.getElement('headerTitle');
        if (titleEl) titleEl.innerText = name;

        // Clear local state for fresh project
        this.state.images = [];
        this.state.idx = 0;
        this.state.bookmarks = [];
        this.state.clipboardBox = [];
        const pt = this.getElement('pageTotal');
        if (pt) pt.innerText = '/ 0';
        if(this.state.activeSideTab === 'pages') this.renderPageSidebar();

        const c = this.getElement('canvas');
        if(c) c.getContext('2d').clearRect(0,0,c.width,c.height);
        // ----------------------------

        this.ui.setSyncStatus('new');

        if(openPicker) {
            const fileIn = this.getElement('fileIn');
            if (fileIn) fileIn.click();
        }

        // Initialize LiveSync with the Owner's Room and this Project Key
        if (this.liveSync) {
            await this.liveSync.init(ownerId, projectId);
        }
    }

    async reuploadBaseFile() {
        if (this.state.images.length > 0 && this.state.images[0].blob) {
            this.ui.showToast("Re-uploading base...");
            try {
                await fetch(`/api/color_rm/upload/${this.state.sessionId}`, {
                    method: 'POST',
                    body: this.state.images[0].blob,
                    headers: { 'Content-Type': this.state.images[0].blob.type }
                });
                this.ui.showToast("Base file restored!");
            } catch(e) {
                this.ui.showToast("Restore failed");
            }
        } else {
            alert("No local file to upload.");
        }
    }
}

