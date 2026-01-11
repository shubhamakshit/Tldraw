
import { createClient, LiveObject, LiveMap, LiveList } from 'https://cdn.jsdelivr.net/npm/@liveblocks/client@3.12.1/+esm';

export class LiveSyncClient {
    constructor(appInstance) {
        this.app = appInstance;
        this.client = null;
        this.room = null;
        this.userId = localStorage.getItem('color_rm_user_id');
        this.ownerId = null;
        this.projectId = null;
        this.unsubscribes = [];
        this.isInitializing = true;
        this.root = null;

        // Track recent local page changes to prevent sync conflicts
        this.lastLocalPageChange = 0;
        this.PAGE_CHANGE_GRACE_PERIOD = 2000; // 2 seconds grace period
        this.remoteTrails = {};
    }

    async init(ownerId, projectId) {
        // We need Registry to be available globally or passed in.
        // Assuming window.Registry is still global for now or we import it.
        const regUser = window.Registry?.getUsername();
        if (regUser) this.userId = regUser;

        if (!this.userId) {
            this.userId = `user_${Math.random().toString(36).substring(2, 9)}`;
            localStorage.setItem('color_rm_user_id', this.userId);
        }

        const roomId = `room_${ownerId}`;
        this.ownerId = ownerId;
        this.projectId = projectId;

        // Update URL only if this is the main app (hacky check? or let the app handle it)
        // For now, only update hash if this sync client is attached to the main app.
        // We can check this via a config flag on the app.
        if (this.app.config.isMain) {
            window.location.hash = `/color_rm/${ownerId}/${projectId}`;
        }

        if (this.room && this.room.id === roomId) {
            console.log(`Liveblocks: Switching Project sub-key to ${projectId} in existing room.`);
            await this.setupProjectSync(projectId);
            return;
        }

        if (this.room) this.leave();

        this.app.ui.setSyncStatus('syncing');
        console.log(`Liveblocks: Connecting to Owner Room: ${roomId}`);

        if (!this.client) {
            // Get auth endpoint URL (supports bundled mode)
            const authEndpoint = window.Config
                ? window.Config.apiUrl('/api/liveblocks-auth')
                : '/api/liveblocks-auth';

            this.client = createClient({
                authEndpoint: authEndpoint,
            });
        }

        const { room, leave } = this.client.enterRoom(roomId, {
            initialStorage: {
                projects: new LiveMap()
            }
        });

        this.room = room;
        this.leave = leave;

        room.subscribe("status", (status) => {
            if (status === "connected") this.app.ui.setSyncStatus('saved');
            else if (status === "disconnected") this.app.ui.setSyncStatus('offline');
            if (this.app.renderDebug) this.app.renderDebug();
        });

        // Retry logic for storage initialization
        let root;
        let attempts = 0;
        const maxAttempts = 3;

        while (!root && attempts < maxAttempts) {
            attempts++;
            try {
                 // Add simple timeout wrapper around storage fetch
                 const storagePromise = room.getStorage();
                 const timeoutPromise = new Promise((_, reject) =>
                     setTimeout(() => reject(new Error("Storage fetch timed out")), 8000)
                 );

                 const result = await Promise.race([storagePromise, timeoutPromise]);
                 root = result.root;
            } catch(e) {
                 console.warn(`Liveblocks: Storage fetch attempt ${attempts} failed:`, e);
                 if (attempts === maxAttempts) {
                     this.app.ui.showToast("Connection weak - Sync might be incomplete");
                 } else {
                     await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
                 }
            }
        }

        if (!root) {
            console.error("Liveblocks: Critical failure - could not load storage.");
            this.isInitializing = false;
            return;
        }

        this.root = root;

        await this.setupProjectSync(projectId);

        this.isInitializing = false;
        console.log("Liveblocks: Room Ready.");
    }

    async setupProjectSync(projectId) {
        if (!this.root) {
            const { root } = await this.room.getStorage();
            this.root = root;
        }
        const projects = this.root.get("projects");

        // Ensure the project structure exists
        if (!projects.has(projectId)) {
            console.log(`Liveblocks: Creating new project ${projectId} with name "${this.app.state.projectName}"`);
            projects.set(projectId, new LiveObject({
                metadata: new LiveObject({
                    name: this.app.state.projectName || "Untitled",
                    baseFileName: this.app.state.baseFileName || null,
                    idx: 0,
                    pageCount: 0,
                    pageLocked: false,
                    ownerId: this.ownerId
                }),
                pagesHistory: new LiveMap(),
                bookmarks: new LiveList([]),
                colors: new LiveList([])
            }));
        } else {
             // Project exists.
             // Safeguard: If I am the owner, and the remote name is "Untitled" or empty, but my local name is set...
             // This fixes the issue where a project might be initialized with default data and overwrite the local name.
             const remoteProject = projects.get(projectId);
             const remoteMeta = remoteProject.get("metadata");
             const remoteName = remoteMeta.get("name");

             if (this.ownerId === this.userId && (remoteName === "Untitled" || !remoteName) && this.app.state.projectName && this.app.state.projectName !== "Untitled") {
                 console.log(`Liveblocks: Remote name is "${remoteName}", pushing local name: "${this.app.state.projectName}"`);
                 remoteMeta.update({ name: this.app.state.projectName });
             }
        }

        this.syncStorageToLocal();

        // Refresh project-specific subscription
        this.unsubscribes.forEach(unsub => unsub());

        // Keep track of other users' page structure versions
        this.otherUserVersions = {};

        this.unsubscribes = [
            this.room.subscribe(projects.get(projectId), () => {
                this.syncProjectData();
                if (this.app.renderDebug) this.app.renderDebug();
            }, { isDeep: true }),
            // Subscribe to Presence (Others)
            this.room.subscribe("others", (others) => {
                this.renderUsers();
                this.renderCursors();

                // Check if any other user has updated their page structure version
                others.forEach(user => {
                    const presence = user.presence;
                    if (presence && presence.pageStructureVersion !== undefined &&
                        presence.pageCount !== undefined) {

                        const userId = user.connectionId || user.id;
                        const currentVersion = this.otherUserVersions[userId];

                        // If this user's version is newer than what we last saw
                        if (!currentVersion || currentVersion < presence.pageStructureVersion) {
                            this.otherUserVersions[userId] = presence.pageStructureVersion;

                            // Another user made a page structure change
                            this.handlePageStructureChange(presence);
                        }
                    }
                });
            })
        ];

        // Initialize presence for self
        this.room.updatePresence({
            userId: this.userId,
            userName: window.Registry?.getUsername() || this.userId,
            cursor: null,
            pageIdx: this.app.state.idx,
            pageStructureVersion: Date.now(),
            pageCount: this.app.state.images.length
        });

        this.renderUsers();
    }

    updateCursor(pt, tool, isDrawing, color, size) {
        if (!this.room) return;
        this.room.updatePresence({
            cursor: pt,
            pageIdx: this.app.state.idx,
            userName: window.Registry?.getUsername() || this.userId,
            tool: tool,
            isDrawing: isDrawing,
            color: color,
            size: size,
            pageStructureVersion: Date.now(),
            pageCount: this.app.state.images.length
        });
    }

    renderCursors() {
        const container = this.app.getElement('cursorLayer');
        if (!container) return;

        // Clear old cursors but keep canvas
        const oldCursors = container.querySelectorAll('.remote-cursor');
        oldCursors.forEach(el => el.remove());

        if (!this.app.state.showCursors) return;

        if (!this.room) return;

        // Setup Trail Canvas
        let trailCanvas = container.querySelector('#remote-trails-canvas');
        if (!trailCanvas) {
            trailCanvas = document.createElement('canvas');
            trailCanvas.id = 'remote-trails-canvas';
            trailCanvas.style.position = 'absolute';
            trailCanvas.style.inset = '0';
            trailCanvas.style.pointerEvents = 'none';
            container.appendChild(trailCanvas);
        }

        const viewport = this.app.getElement('viewport');
        const canvas = this.app.getElement('canvas');
        if (!canvas || !viewport) return;

        const rect = canvas.getBoundingClientRect(); // Canvas on screen rect
        const viewRect = viewport.getBoundingClientRect(); // Viewport rect

        // 1. Align cursorLayer to match canvas exactly (fixes alignment & trail black screen issues)
        container.style.position = 'absolute';
        container.style.width = rect.width + 'px';
        container.style.height = rect.height + 'px';
        container.style.left = (rect.left - viewRect.left) + 'px';
        container.style.top = (rect.top - viewRect.top) + 'px';
        container.style.inset = 'auto'; // Override CSS inset:0

        // 2. Match trailCanvas resolution to main canvas internal resolution
        if (trailCanvas.width !== this.app.state.viewW || trailCanvas.height !== this.app.state.viewH) {
            trailCanvas.width = this.app.state.viewW;
            trailCanvas.height = this.app.state.viewH;
        }
        trailCanvas.style.width = '100%';
        trailCanvas.style.height = '100%';
        trailCanvas.style.backgroundColor = 'transparent'; // Ensure transparent

        const ctx = trailCanvas.getContext('2d');
        // Reset transform to identity to ensure full clear
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);

        const others = this.room.getOthers();
        let hasActiveTrails = false;

        others.forEach(user => {
            const presence = user.presence;
            if (!presence || !presence.cursor || presence.pageIdx !== this.app.state.idx) {
                if (this.remoteTrails[user.connectionId]) delete this.remoteTrails[user.connectionId];
                return;
            }

            // Check for page structure changes from this user
            if (presence.pageStructureVersion !== undefined && presence.pageCount !== undefined) {
                const userId = user.connectionId || user.id;
                const currentVersion = this.otherUserVersions[userId];

                // If this user's version is newer than what we last saw
                if (!currentVersion || currentVersion < presence.pageStructureVersion) {
                    this.otherUserVersions[userId] = presence.pageStructureVersion;

                    // Another user made a page structure change
                    this.handlePageStructureChange(presence);
                }
            }

            // --- Draw Live Trail ---
            if (presence.isDrawing && presence.tool === 'pen') {
                hasActiveTrails = true;
                let trail = this.remoteTrails[user.connectionId] || [];
                // Add point if new
                const lastPt = trail[trail.length - 1];
                if (!lastPt || lastPt.x !== presence.cursor.x || lastPt.y !== presence.cursor.y) {
                    trail.push(presence.cursor);
                }
                this.remoteTrails[user.connectionId] = trail;

                if (trail.length > 1) {
                    ctx.save();
                    // Transform to match main canvas state
                    ctx.translate(this.app.state.pan.x, this.app.state.pan.y);
                    ctx.scale(this.app.state.zoom, this.app.state.zoom);

                    ctx.beginPath();
                    ctx.moveTo(trail[0].x, trail[0].y);
                    for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);

                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.lineWidth = (presence.size || 3);

                    // Smooth transition: Use user's color with opacity
                    const hex = presence.color || '#000000';
                    let r=0, g=0, b=0;
                    if(hex.length === 4) {
                        r = parseInt(hex[1]+hex[1], 16);
                        g = parseInt(hex[2]+hex[2], 16);
                        b = parseInt(hex[3]+hex[3], 16);
                    } else if (hex.length === 7) {
                        r = parseInt(hex.slice(1,3), 16);
                        g = parseInt(hex.slice(3,5), 16);
                        b = parseInt(hex.slice(5,7), 16);
                    }
                    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;

                    ctx.stroke();
                    ctx.restore();
                }
            } else {
                if (this.remoteTrails[user.connectionId]) delete this.remoteTrails[user.connectionId];
            }

            // --- Draw Cursor ---
            const div = document.createElement('div');
            // ... (cursor drawing code) ...
            div.className = 'remote-cursor';

            // Map canvas coordinates to screen coordinates relative to cursorLayer (which now matches canvas)
            // x_screen = (x_internal * zoom + pan) * (screen_width / internal_width)
            const scaleX = rect.width / this.app.state.viewW;
            const scaleY = rect.height / this.app.state.viewH;

            const x = (presence.cursor.x * this.app.state.zoom + this.app.state.pan.x) * scaleX;
            const y = (presence.cursor.y * this.app.state.zoom + this.app.state.pan.y) * scaleY;

            div.style.left = `${x}px`;
            div.style.top = `${y}px`;
            div.style.borderColor = 'var(--accent)';

            div.innerHTML = `
                <div class="cursor-pointer"></div>
                <div class="cursor-label">${presence.userName || 'User'}</div>
            `;
            container.appendChild(div);
        });

        // Hide trail canvas if no active trails to minimize risk of obstruction
        trailCanvas.style.display = hasActiveTrails ? 'block' : 'none';
    }

    renderUsers() {
        const el = this.app.getElement('userList');
        if (!el) return;

        const others = this.room.getOthers();
        const myName = window.Registry?.getUsername() || this.userId;
        let html = `
            <div class="user-item self">
                <div class="user-dot" style="background:var(--primary)"></div>
                <span>You (${myName})</span>
            </div>
        `;

        others.forEach(user => {
            const info = user.presence;
            if (!info || !info.userId) return;
            const userName = info.userName || info.userId;
            html += `
                <div class="user-item">
                    <div class="user-dot" style="background:var(--accent)"></div>
                    <span>${userName}</span>
                </div>
            `;
        });

        el.innerHTML = html;
    }

    getProject() {
        if (!this.root || !this.projectId) return null;
        return this.root.get("projects").get(this.projectId);
    }

    syncStorageToLocal() {
        const project = this.getProject();
        if (!project) return;

        const metadata = project.get("metadata").toObject();
        this.app.state.projectName = metadata.name;
        this.app.state.idx = metadata.idx;
        this.app.state.pageLocked = metadata.pageLocked;
        this.app.state.ownerId = metadata.ownerId;

        const titleEl = this.app.getElement('headerTitle');
        if(titleEl) titleEl.innerText = metadata.name;

        this.app.state.bookmarks = project.get("bookmarks").toArray();
        this.app.renderBookmarks();

        this.app.state.colors = project.get("colors").toArray();
        this.app.renderSwatches();

        this.syncHistory();
        this.app.loadPage(this.app.state.idx, false);
    }

    syncProjectData() {
        const project = this.getProject();
        if (!project || this.isInitializing) return;

        const metadata = project.get("metadata").toObject();
        console.log(`Liveblocks Sync: Remote PageCount=${metadata.pageCount}, Local PageCount=${this.app.state.images.length}`);

        // Intelligent Name Sync:
        // If I am the owner, and remote is Untitled, but I have a name -> Update Remote
        // Otherwise -> Accept Remote

        console.log(`[LiveSync] Name Sync Check: Owner=${this.ownerId}, User=${this.userId}`);
        console.log(`[LiveSync] Remote Name: "${metadata.name}", Local Name: "${this.app.state.projectName}"`);

        if (this.ownerId === this.userId && (metadata.name === "Untitled" || !metadata.name) && this.app.state.projectName && this.app.state.projectName !== "Untitled") {
             console.log(`[LiveSync] DECISION: Correcting remote 'Untitled' name with local: "${this.app.state.projectName}"`);
             project.get("metadata").update({ name: this.app.state.projectName });
        } else {
             if (this.app.state.projectName !== metadata.name) {
                 console.log(`[LiveSync] DECISION: Accepting remote name: "${metadata.name}" (replacing "${this.app.state.projectName}")`);
             }
             this.app.state.projectName = metadata.name;
        }

        this.app.state.baseFileName = metadata.baseFileName || null;
        this.app.state.pageLocked = metadata.pageLocked;
        this.app.state.ownerId = metadata.ownerId;

        const titleEl = this.app.getElement('headerTitle');
        if(titleEl) titleEl.innerText = this.app.state.projectName;

        // Only sync page index if:
        // 1. We haven't made a local page change recently (grace period)
        // 2. The remote change is from another user (not our own echo)
        const timeSinceLocalChange = Date.now() - this.lastLocalPageChange;
        const isWithinGracePeriod = timeSinceLocalChange < this.PAGE_CHANGE_GRACE_PERIOD;

        if (this.app.state.idx !== metadata.idx) {
            if (isWithinGracePeriod) {
                // Skip - this is likely our own change echoing back
                console.log(`Liveblocks: Ignoring remote idx=${metadata.idx}, local change was ${timeSinceLocalChange}ms ago`);
            } else {
                // Accept remote page change (from another user)
                console.log(`Liveblocks: Accepting remote page change to idx=${metadata.idx}`);
                this.app.loadPage(metadata.idx, false);
            }
        }

        // AUTO-RETRY base file fetch if remote has pages but we don't
        if (metadata.pageCount > 0 && this.app.state.images.length === 0) {
            console.log("Liveblocks: Remote has content but local is empty. Triggering fetch...");
            this.app.retryBaseFetch();
        }

        this.syncHistory();
        this.app.updateLockUI();
    }

    syncHistory() {
        const project = this.getProject();
        if (!project || this.isInitializing) return;

        const pagesHistory = project.get("pagesHistory");
        let currentIdxChanged = false;

        // Priority: Update current page immediately
        const currentRemote = pagesHistory.get(this.app.state.idx.toString());
        if (currentRemote) {
            const newHist = currentRemote.toArray();
            const localImg = this.app.state.images[this.app.state.idx];
            if (localImg) {
                localImg.history = newHist;
                currentIdxChanged = true;
                if (this.app.invalidateCache) this.app.invalidateCache();
            }
        }

        // Background sync all other pages
        this.app.state.images.forEach((img, idx) => {
            if (idx === this.app.state.idx) return; // Already handled
            const remote = pagesHistory.get(idx.toString());
            if (remote) img.history = remote.toArray();
        });

        if (currentIdxChanged) this.app.render();
    }

    // --- Local -> Remote Updates ---
    updateMetadata(updates) {
        const project = this.getProject();
        if (project) project.get("metadata").update(updates);
    }

    addStroke(pageIdx, stroke) {
        const project = this.getProject();
        if (!project) return;
        const pagesHistory = project.get("pagesHistory");
        const key = pageIdx.toString();
        if (!pagesHistory.has(key)) {
            pagesHistory.set(key, new LiveList([]));
        }
        pagesHistory.get(key).push(stroke);
    }

    setHistory(pageIdx, history) {
        const project = this.getProject();
        if (!project) return;
        const pagesHistory = project.get("pagesHistory");
        pagesHistory.set(pageIdx.toString(), new LiveList(history || []));
    }

    updateBookmarks(bookmarks) {
        const project = this.getProject();
        if (project) project.set("bookmarks", new LiveList(bookmarks || []));
    }

    updateColors(colors) {
        const project = this.getProject();
        if (project) project.set("colors", new LiveList(colors || []));
    }

    // Add new page to remote storage
    addPage(pageIndex, pageData) {
        const project = this.getProject();
        if (!project) return;

        const pagesHistory = project.get("pagesHistory");
        const key = pageIndex.toString();

        // Initialize with empty history for the new page
        pagesHistory.set(key, new LiveList([]));

        // Update page count in metadata
        const currentMetadata = project.get("metadata").toObject();
        project.get("metadata").update({
            pageCount: Math.max(currentMetadata.pageCount, pageIndex + 1)
        });
    }

    // Reorder pages in remote storage
    reorderPages(fromIndex, toIndex) {
        const project = this.getProject();
        if (!project) return;

        const pagesHistory = project.get("pagesHistory");
        const fromKey = fromIndex.toString();
        const toKey = toIndex.toString();

        // Get the histories to swap
        const fromHistory = pagesHistory.get(fromKey);
        const toHistory = pagesHistory.get(toKey);

        // If 'to' page doesn't exist, create empty history
        if (!toHistory) {
            pagesHistory.set(toKey, new LiveList([]));
        }

        // Swap histories
        if (fromHistory) {
            const fromArray = fromHistory.toArray();
            const toArray = toHistory ? toHistory.toArray() : [];

            pagesHistory.set(fromKey, new LiveList(toArray));
            pagesHistory.set(toKey, new LiveList(fromArray));
        } else {
            pagesHistory.set(fromKey, new LiveList([]));
        }
    }

    // Update page count in metadata
    updatePageCount(count) {
        const project = this.getProject();
        if (project) {
            project.get("metadata").update({ pageCount: count });
        }
    }

    // Notify other users about page structure changes using presence
    notifyPageStructureChange() {
        // Update presence with a timestamp to notify other users of changes
        if (this.room) {
            this.room.updatePresence({
                pageStructureVersion: Date.now(),
                pageCount: this.app.state.images.length,
                pageIdx: this.app.state.idx
            });
        }
    }

    // Handle page structure change notifications from other users (debounced)
    handlePageStructureChange(message) {
        // Debounce: Only process if we haven't processed recently
        const now = Date.now();
        const DEBOUNCE_MS = 2000; // 2 second debounce

        if (this._lastPageStructureChange && (now - this._lastPageStructureChange) < DEBOUNCE_MS) {
            // Skip - too soon since last change
            return;
        }

        // Check if page count actually differs
        if (this.app.state.images.length === message.pageCount) {
            // No change needed
            return;
        }

        this._lastPageStructureChange = now;
        console.log('Page structure change detected, refreshing pages...');

        // Reload the session pages to get the new structure
        this.app.loadSessionPages(this.app.state.sessionId).then(() => {
            // Update the page total display
            const pt = this.app.getElement('pageTotal');
            if (pt) pt.innerText = '/ ' + this.app.state.images.length;

            // Update the page input if needed
            const pageInput = this.app.getElement('pageInput');
            if (pageInput) pageInput.value = this.app.state.idx + 1;

            // Update the sidebar if it's showing pages
            if (this.app.state.activeSideTab === 'pages') {
                this.app.renderPageSidebar();
            }

            // If the current page index is out of bounds, adjust it
            if (this.app.state.idx >= this.app.state.images.length) {
                this.app.state.idx = Math.max(0, this.app.state.images.length - 1);
                if (this.app.state.idx >= 0) {
                    this.app.loadPage(this.app.state.idx, false);
                }
            }

            // Update session metadata
            this.app.dbGet('sessions', this.app.state.sessionId).then(session => {
                if (session) {
                    session.pageCount = this.app.state.images.length;
                    this.app.dbPut('sessions', session);
                }
            });
        });
    }
}
