
import { createClient, LiveObject, LiveMap, LiveList } from 'https://cdn.jsdelivr.net/npm/@liveblocks/client@3.12.1/+esm';

// Yjs imports - lazy loaded only when beta mode is used
let Y = null;
let WebsocketProvider = null;
async function loadYjs() {
    if (!Y) {
        Y = await import('https://cdn.jsdelivr.net/npm/yjs@13.6.10/+esm');
        const ywsModule = await import('https://cdn.jsdelivr.net/npm/y-websocket@2.0.4/+esm');
        WebsocketProvider = ywsModule.WebsocketProvider;
        console.log('[LiveSync] Yjs modules loaded');
    }
}

export class LiveSyncClient {
    constructor(appInstance) {
        this.app = appInstance;
        this.useBetaSync = appInstance.config.useBetaSync || false; // Beta mode flag
        this.client = null;
        this.room = null;
        this.userId = localStorage.getItem('color_rm_user_id');
        this.ownerId = null;
        this.projectId = null;
        this.unsubscribes = [];
        this.isInitializing = true;
        this.root = null;

        // Yjs-specific (only used when useBetaSync=true)
        this.yjsDoc = null;
        this.yjsProvider = null;
        this.yjsRoot = null;

        // Track recent local page changes to prevent sync conflicts
        this.lastLocalPageChange = 0;
        this.PAGE_CHANGE_GRACE_PERIOD = 500; // 500ms grace period for fluid sync
        this.remoteTrails = {};

        // Lock to prevent reconciliation during local page operations
        this._isLocalPageOperation = false;
        this._localPageOperationTimeout = null;
    }

    async init(ownerId, projectId) {
        // 1. Reconcile Immediately (Parallel)
        console.log('[LiveSync] Triggering early reconciliation...');
        this.reconcilePageStructure();

        // We need Registry to be available globally or passed in.
        // Assuming window.Registry is still global for now or we import it.
        const regUser = window.Registry?.getUsername();
        if (regUser) this.userId = regUser;

        if (!this.userId) {
            this.userId = `user_${Math.random().toString(36).substring(2, 9)}`;
            localStorage.setItem('color_rm_user_id', this.userId);
        }

        this.ownerId = ownerId;
        this.projectId = projectId;

        // Beta mode: Use Yjs instead of Liveblocks
        if (this.useBetaSync) {
            return this._initYjs(ownerId, projectId);
        }

        const roomId = `room_${ownerId}`;

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
            },
            // Use HTTP fallback for large messages that exceed websocket limits
            largeMessageStrategy: 'http'
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

        // CRITICAL: Immediate page sync after initialization
        // This ensures we catch any pages that were added while we were connecting
        setTimeout(() => {
            this._immediatePageSync();
        }, 0);
    }

    /**
     * Initialize Yjs-based sync (beta mode)
     * Uses Yjs CRDTs over WebSocket for real-time collaboration
     */
    async _initYjs(ownerId, projectId) {
        // 1. Reconcile Immediately (Parallel)
        console.log('[LiveSync] Triggering early reconciliation...');
        this.reconcilePageStructure();

        await loadYjs();

        this.app.ui.setSyncStatus('syncing');
        console.log(`[Yjs] Beta sync: Connecting for ${ownerId}/${projectId}`);

        // Update URL with beta prefix
        if (this.app.config.isMain) {
            window.location.hash = `/beta/color_rm/${ownerId}/${projectId}`;
        }

        // Create Yjs document
        this.yjsDoc = new Y.Doc();

        // Connect to WebSocket - use Config for proper URL in Capacitor/bundled mode
        const roomId = `yjs_${ownerId}_${projectId}`;

        // Use Config.wsUrl for proper WebSocket URL (handles Capacitor bundled mode)
        const wsUrl = window.Config
            ? window.Config.wsUrl(`/yjs/${roomId}`)
            : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/yjs/${roomId}`;

        console.log(`[Yjs] Connecting to: ${wsUrl}`);

        try {
            // Create WebSocket connection directly (simpler than y-websocket provider)
            this._yjsSocket = new WebSocket(wsUrl);
            this._yjsConnected = false;

            this._yjsSocket.onopen = () => {
                console.log('[Yjs] WebSocket connected');
                this._yjsConnected = true;
                this.app.ui.setSyncStatus('saved');
                if (this.app.renderDebug) this.app.renderDebug();

                // Send initial state
                this._sendYjsUpdate();
            };

            this._yjsSocket.onmessage = (event) => {
                try {
                    if (typeof event.data === 'string') {
                        const msg = JSON.parse(event.data);
                        this._handleYjsMessage(msg);
                    }
                } catch (err) {
                    console.error('[Yjs] Message parse error:', err);
                }
            };

            this._yjsSocket.onclose = () => {
                console.log('[Yjs] WebSocket disconnected');
                this._yjsConnected = false;
                this.app.ui.setSyncStatus('offline');
                // Auto-reconnect after 3 seconds
                if (!this._yjsClosedIntentionally) {
                    setTimeout(() => {
                        if (!this._yjsConnected && !this._yjsClosedIntentionally) {
                            console.log('[Yjs] Attempting reconnection...');
                            this._initYjs(this.ownerId, this.projectId);
                        }
                    }, 3000);
                }
            };

            this._yjsSocket.onerror = (err) => {
                console.error('[Yjs] WebSocket error:', err);
                this._yjsConnected = false;
            };

            // Set up leave function for cleanup
            this.leave = () => {
                this._yjsClosedIntentionally = true;
                if (this._yjsSocket) {
                    this._yjsSocket.close();
                    this._yjsSocket = null;
                }
                this._yjsConnected = false;
                this.stopPeriodicPageSync();
                console.log('[Yjs] Connection closed');
            };

            // Setup Yjs document structure (mirrors Liveblocks structure)
            this.yjsRoot = {
                metadata: this.yjsDoc.getMap('metadata'),
                pagesHistory: this.yjsDoc.getMap('pagesHistory'),
                pagesModifications: this.yjsDoc.getMap('pagesModifications'),
                pagesMetadata: this.yjsDoc.getMap('pagesMetadata'),
                bookmarks: this.yjsDoc.getArray('bookmarks'),
                colors: this.yjsDoc.getArray('colors')
            };

            // Create fake awareness for presence
            this._yjsAwareness = new Map();
            this._yjsClientId = Math.random().toString(36).slice(2);

            this.isInitializing = false;
            console.log('[Yjs] Beta sync initialized');

            // Sync current state and structure immediately
            this._immediatePageSync();

        } catch (err) {
            console.error('[Yjs] Failed to initialize:', err);
            this.app.ui.showToast('Beta sync connection failed');
            this.isInitializing = false;
        }
    }

    /**
     * Send current state as Yjs update
     */
    _sendYjsUpdate() {
        if (!this._yjsSocket || !this._yjsConnected) {
            console.warn('[Yjs] Cannot send update - not connected');
            return;
        }

        const img = this.app.state.images[this.app.state.idx];
        if (!img) {
            console.warn('[Yjs] Cannot send update - no image for current page');
            return;
        }

        const msg = {
            type: 'state-update',
            pageIdx: this.app.state.idx,
            history: (img.history || []).filter(s => !s.deleted),
            metadata: {
                name: this.app.state.projectName,
                idx: this.app.state.idx,
                pageCount: this.app.state.images.length
            }
        };

        this._yjsSocket.send(JSON.stringify(msg));
        console.log(`[Yjs] Sent state update for page ${this.app.state.idx}: ${msg.history.length} strokes`);
    }

    /**
     * Handle incoming Yjs message
     */
    _handleYjsMessage(msg) {
        if (this.isInitializing) return;

        if (msg.type === 'state-update') {
            // Apply remote state
            console.log(`[Yjs] Received state-update for page ${msg.pageIdx}: ${msg.history?.length || 0} strokes`);

            // Sync project name from metadata (like Liveblocks does)
            if (msg.metadata && msg.metadata.name) {
                const remoteName = msg.metadata.name;
                const localName = this.app.state.projectName;

                // If we're the owner and remote is "Untitled" but we have a real name, don't overwrite
                const isOwner = this.ownerId === this.userId;
                const remoteIsUntitled = remoteName === 'Untitled' || !remoteName;
                const localHasName = localName && localName !== 'Untitled';

                if (!(isOwner && remoteIsUntitled && localHasName)) {
                    // Accept remote name
                    if (localName !== remoteName) {
                        console.log(`[Yjs] Name Sync: "${localName}" -> "${remoteName}"`);
                        this.app.state.projectName = remoteName;
                        const titleEl = this.app.getElement('headerTitle');
                        if (titleEl) titleEl.innerText = remoteName;
                    }
                }
            }

            const localImg = this.app.state.images[msg.pageIdx];
            if (localImg && msg.history) {
                // For beta sync, we always accept remote state as the source of truth
                // This handles both additions and deletions
                const localNonDeleted = (localImg.history || []).filter(s => !s.deleted);
                const remoteLen = msg.history.length;
                const localLen = localNonDeleted.length;

                // Check if content actually differs (by comparing visible strokes)
                const needsUpdate = remoteLen !== localLen ||
                    JSON.stringify(msg.history) !== JSON.stringify(localNonDeleted);

                if (needsUpdate) {
                    // Replace local history with remote (non-deleted strokes only)
                    localImg.history = msg.history;
                    console.log(`[Yjs] Applied remote state for page ${msg.pageIdx}: ${remoteLen} strokes (was ${localLen})`);

                    // Only re-render if this is the current page
                    if (msg.pageIdx === this.app.state.idx) {
                        this.app.invalidateCache();
                        this.app.render();
                    }
                }
            }
        } else if (msg.type === 'page-structure') {
            // Handle page structure change from another client
            const remotePageCount = msg.pageCount || 0;
            const localPageCount = this.app.state.images.length;
            const remotePageIds = msg.pageIds || [];
            const localPageIds = this.app.state.images.map(img => img?.pageId).filter(Boolean);

            console.log(`[Yjs] Received page-structure: remote=${remotePageCount} pages, local=${localPageCount} pages`);

            // Check if structure actually differs (count or order)
            const countDiffers = remotePageCount !== localPageCount;
            const orderDiffers = JSON.stringify(remotePageIds) !== JSON.stringify(localPageIds);

            if (countDiffers || orderDiffers) {
                // Page structure changed - run reconciliation via R2 (source of truth)
                console.log(`[Yjs] Page structure mismatch (count: ${countDiffers}, order: ${orderDiffers}), triggering reconciliation...`);
                // Debounce to avoid rapid re-fetches
                if (this._yjsReconcileTimer) clearTimeout(this._yjsReconcileTimer);
                this._yjsReconcileTimer = setTimeout(() => {
                    this.reconcilePageStructure();
                }, 500);
            } else {
                console.log(`[Yjs] Page structure matches, no reconciliation needed`);
            }
        } else if (msg.type === 'presence') {
            // Update presence map
            this._yjsAwareness.set(msg.clientId, {
                userName: msg.userName,
                cursor: msg.cursor,
                pageIdx: msg.pageIdx,
                tool: msg.tool,
                isDrawing: msg.isDrawing,
                color: msg.color,
                size: msg.size
            });
            console.log(`[Yjs] Received presence from ${msg.clientId}: page ${msg.pageIdx}`);

            // Follow mode: Navigate to the same page as the other user
            // (Skip if this is an echo of our own change or if we recently changed pages)
            const timeSinceLocalChange = Date.now() - (this.lastLocalPageChange || 0);
            if (msg.pageIdx !== undefined && msg.pageIdx !== this.app.state.idx) {
                if (timeSinceLocalChange < 500) {
                    console.log(`[Yjs] Ignoring remote page=${msg.pageIdx}, local change was ${timeSinceLocalChange}ms ago`);
                } else {
                    console.log(`[Yjs] Following remote user to page ${msg.pageIdx}`);
                    this.lastLocalPageChange = Date.now(); // Prevent echo
                    this.app.loadPage(msg.pageIdx, false, true); // false = don't broadcast back, true = skip animation
                }
            }

            this.renderCursors();
            this.renderUsers();
        }
    }

    /**
     * Immediate page sync - called right after initialization
     * Simply runs reconciliation - R2 is the source of truth
     */
    async _immediatePageSync() {
        console.log(`[_immediatePageSync] Running reconciliation...`);
        // Page reconciliation works for both modes (fetches from R2)
        await this.reconcilePageStructure();

        // For beta mode, also sync current history
        if (this.useBetaSync) {
            console.log('[Yjs] Immediate history sync');
            this.syncHistory();
        }
    }

    /**
     * Start a local page operation - blocks reconciliation
     * Call this BEFORE adding/deleting/reordering pages locally
     */
    startLocalPageOperation() {
        this._isLocalPageOperation = true;
        // Clear any existing timeout
        if (this._localPageOperationTimeout) {
            clearTimeout(this._localPageOperationTimeout);
        }
        console.log('[LiveSync] Local page operation started - reconciliation blocked');
    }

    /**
     * End a local page operation - allows reconciliation after a delay
     * Call this AFTER the page operation is complete and synced to server
     */
    endLocalPageOperation() {
        // Add a grace period before allowing reconciliation
        this._localPageOperationTimeout = setTimeout(() => {
            this._isLocalPageOperation = false;
            console.log('[LiveSync] Local page operation ended - reconciliation unblocked');
        }, 3000); // 3 second grace period
    }

    /**
     * Starts a periodic check to ensure pages are synced with remote
     * This catches any missed updates due to race conditions or network issues
     */
    startPeriodicPageSync() {
        // Clear any existing interval
        if (this._pageSyncInterval) {
            clearInterval(this._pageSyncInterval);
        }

        this._pageSyncInterval = setInterval(() => {
            if (this.isInitializing) return;

            // Just run reconciliation periodically - R2 is the source of truth
            this.reconcilePageStructure();
        }, 10000); // Check every 10 seconds
    }

    /**
     * Stops the periodic page sync
     */
    stopPeriodicPageSync() {
        if (this._pageSyncInterval) {
            clearInterval(this._pageSyncInterval);
            this._pageSyncInterval = null;
        }
    }

    /**
     * Force sync all pages - use this for manual recovery
     * This method is exposed globally for debugging via window.LiveSync.forceSyncPages()
     */
    async forceSyncPages() {
        console.log('[forceSyncPages] Starting forced page synchronization...');

        // Reset locks in case they're stuck
        this._isFetchingMissingPages = false;
        this.app.isFetchingBase = false;

        // Simply run reconciliation - R2 is the source of truth
        await this.reconcilePageStructure();

        // Sync history and render
        this.syncHistory();
        this.app.render();

        console.log('[forceSyncPages] Complete. Local pages:', this.app.state.images.length);
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
                pagesModifications: new LiveMap(),
                pagesMetadata: new LiveMap(),
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

             // Ensure required LiveMaps exist (migration for older projects)
             if (!remoteProject.get("pagesModifications")) {
                 console.log('[LiveSync] Adding missing pagesModifications LiveMap');
                 remoteProject.set("pagesModifications", new LiveMap());
             }
             if (!remoteProject.get("pagesMetadata")) {
                 console.log('[LiveSync] Adding missing pagesMetadata LiveMap');
                 remoteProject.set("pagesMetadata", new LiveMap());
             }
        }

        await this.syncStorageToLocal();

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

                const timeSinceLocalChange = Date.now() - (this.lastLocalPageChange || 0);
                const isNavigatingLocally = timeSinceLocalChange < 500;

                // Check if any other user has updated their page structure version
                others.forEach(user => {
                    const presence = user.presence;
                    if (!presence) return;

                    // REAL-TIME NAVIGATION: Follow the owner immediately based on presence
                    // This creates a stroke-like real-time experience for page flips
                    if (presence.userId === this.ownerId && presence.pageIdx !== undefined) {
                         if (presence.pageIdx !== this.app.state.idx && !isNavigatingLocally) {
                             // Use skipAnimation=true for instant following
                             this.app.loadPage(presence.pageIdx, false, true);
                         }
                    }

                    // Handle page structure version changes
                    if (presence.pageStructureVersion !== undefined &&
                        presence.pageCount !== undefined) {

                        const oderId = user.connectionId || user.id;
                        const currentVersion = this.otherUserVersions[oderId];

                        // Only trigger if we've seen this user before AND their version changed
                        // This prevents triggering on initial connection when we first see other users
                        if (currentVersion !== undefined && currentVersion < presence.pageStructureVersion) {
                            this.otherUserVersions[oderId] = presence.pageStructureVersion;

                            // Another user made a page structure change
                            this.handlePageStructureChange(presence);
                        } else if (currentVersion === undefined) {
                            // First time seeing this user - just record their version, don't trigger
                            this.otherUserVersions[oderId] = presence.pageStructureVersion;
                        }
                    }

                    // Infinite canvas bounds are now auto-calculated from synced strokes
                    // No need for explicit bounds sync via presence
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

        // Perform initial page structure reconciliation after a short delay
        // This ensures we have the correct pages in the correct order
        setTimeout(() => {
            this.reconcilePageStructure();
        }, 1500);
    }

    updateCursor(pt, tool, isDrawing, color, size) {
        // Beta mode: Use Yjs awareness
        if (this.useBetaSync) {
            if (!this._yjsSocket || !this._yjsConnected) return;
            // Send presence via WebSocket
            this._yjsSocket.send(JSON.stringify({
                type: 'presence',
                clientId: this._yjsClientId,
                cursor: pt,
                pageIdx: this.app.state.idx,
                userName: window.Registry?.getUsername() || this.userId,
                tool: tool,
                isDrawing: isDrawing,
                color: color,
                size: size
            }));
            return;
        }

        if (!this.room) return;
        this.room.updatePresence({
            cursor: pt,
            pageIdx: this.app.state.idx,
            userName: window.Registry?.getUsername() || this.userId,
            tool: tool,
            isDrawing: isDrawing,
            color: color,
            size: size
            // Note: pageStructureVersion and pageCount are only updated via notifyPageStructureChange()
        });
    }

    renderCursors() {
        if (!this.fadingTrails) this.fadingTrails = [];
        if (this._rafId) cancelAnimationFrame(this._rafId);
        
        // Beta mode: Use Yjs awareness
        if (this.useBetaSync) {
            return this._renderCursorsYjs();
        }

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

        // --- Process Fading Trails ---
        const now = Date.now();
        this.fadingTrails = this.fadingTrails.filter(t => {
            const age = now - t.timestamp;
            // Shrink animation: 200ms duration
            // animate size from original to 0
            const progress = age / 200;
            if (progress >= 1) return false; // Dead
            
            t.currentSize = t.size * (1 - progress);
            return true;
        });

        const others = this.room.getOthers();
        let hasActiveTrails = this.fadingTrails.length > 0;

        // Helper to draw a trail
        const drawTrail = (trail, color, size, opacity) => {
            if (trail.length <= 1) return;
            ctx.save();
            ctx.translate(this.app.state.pan.x, this.app.state.pan.y);
            ctx.scale(this.app.state.zoom, this.app.state.zoom);

            ctx.beginPath();
            ctx.moveTo(trail[0].x, trail[0].y);
            for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);

            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = size || 3;

            const hex = color || '#000000';
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
            // Use full opacity for shrink effect, or slight fade
            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
            ctx.stroke();
            ctx.restore();
        };

        // Draw Fading Trails
        this.fadingTrails.forEach(t => {
            drawTrail(t.points, t.color, t.currentSize, 1.0);
        });

        others.forEach(user => {
            const presence = user.presence;
            if (!presence || !presence.cursor || presence.pageIdx !== this.app.state.idx) {
                if (this.remoteTrails[user.connectionId]) {
                    // Move to fading
                    this.fadingTrails.push({
                        points: this.remoteTrails[user.connectionId],
                        color: this._lastColors?.[user.connectionId] || '#000000',
                        size: 3,
                        opacity: 1.0,
                        timestamp: Date.now()
                    });
                    delete this.remoteTrails[user.connectionId];
                    hasActiveTrails = true;
                }
                return;
            }

            // Cache color/size for fade out
            if (!this._lastColors) this._lastColors = {};
            this._lastColors[user.connectionId] = presence.color;

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

                drawTrail(trail, presence.color, presence.size, 1.0);
            } else {
                if (this.remoteTrails[user.connectionId]) {
                    // Move to fading
                    this.fadingTrails.push({
                        points: this.remoteTrails[user.connectionId],
                        color: presence.color,
                        size: presence.size,
                        opacity: 1.0,
                        timestamp: Date.now()
                    });
                    delete this.remoteTrails[user.connectionId];
                    hasActiveTrails = true;
                }
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
        if (hasActiveTrails) {
             trailCanvas.style.display = 'block';
             // If we have fading trails, we MUST re-render to animate the fade
             if (this.fadingTrails.length > 0) {
                 this._rafId = requestAnimationFrame(() => this.renderCursors());
             }
        } else {
             trailCanvas.style.display = 'none';
        }
    }

    /**
     * Yjs version of renderCursors - uses awareness API
     */
    _renderCursorsYjs() {
        const container = this.app.getElement('cursorLayer');
        if (!container) return;

        // Clear old cursors
        const oldCursors = container.querySelectorAll('.remote-cursor');
        oldCursors.forEach(el => el.remove());

        if (!this.app.state.showCursors) return;
        if (!this._yjsAwareness || this._yjsAwareness.size === 0) return;

        const viewport = this.app.getElement('viewport');
        const canvas = this.app.getElement('canvas');
        if (!canvas || !viewport) return;

        const rect = canvas.getBoundingClientRect();
        const viewRect = viewport.getBoundingClientRect();

        // Align cursorLayer to match canvas
        container.style.position = 'absolute';
        container.style.width = rect.width + 'px';
        container.style.height = rect.height + 'px';
        container.style.left = (rect.left - viewRect.left) + 'px';
        container.style.top = (rect.top - viewRect.top) + 'px';
        container.style.inset = 'auto';

        // Setup Trail Canvas for Yjs
        let trailCanvas = container.querySelector('#remote-trails-canvas');
        if (!trailCanvas) {
            trailCanvas = document.createElement('canvas');
            trailCanvas.id = 'remote-trails-canvas';
            trailCanvas.style.position = 'absolute';
            trailCanvas.style.inset = '0';
            trailCanvas.style.pointerEvents = 'none';
            container.appendChild(trailCanvas);
        }

        // Match trailCanvas resolution to main canvas
        if (trailCanvas.width !== this.app.state.viewW || trailCanvas.height !== this.app.state.viewH) {
            trailCanvas.width = this.app.state.viewW;
            trailCanvas.height = this.app.state.viewH;
        }
        trailCanvas.style.width = '100%';
        trailCanvas.style.height = '100%';
        trailCanvas.style.backgroundColor = 'transparent';

        const ctx = trailCanvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);

        // --- Process Fading Trails ---
        const now = Date.now();
        this.fadingTrails = this.fadingTrails.filter(t => {
            const age = now - t.timestamp;
            // Shrink animation: 200ms duration
            const progress = age / 200;
            if (progress >= 1) return false; // Dead
            
            t.currentSize = t.size * (1 - progress);
            return true;
        });

        // Helper to draw a trail
        const drawTrail = (trail, color, size, opacity) => {
            if (trail.length <= 1) return;
            ctx.save();
            ctx.translate(this.app.state.pan.x, this.app.state.pan.y);
            ctx.scale(this.app.state.zoom, this.app.state.zoom);

            ctx.beginPath();
            ctx.moveTo(trail[0].x, trail[0].y);
            for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);

            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = size || 3;

            const hex = color || '#000000';
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
            // Use full opacity for shrink effect, or slight fade
            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
            ctx.stroke();
            ctx.restore();
        };

        // Draw Fading Trails
        this.fadingTrails.forEach(t => {
            drawTrail(t.points, t.color, t.currentSize, 1.0);
        });

        let hasActiveTrails = this.fadingTrails.length > 0;

        this._yjsAwareness.forEach((state, clientId) => {
            if (clientId === this._yjsClientId) return; // Skip self
            if (!state || !state.cursor || state.pageIdx !== this.app.state.idx) {
                if (this.remoteTrails[clientId]) {
                     // Move to fading
                     this.fadingTrails.push({
                         points: this.remoteTrails[clientId],
                         color: this._lastColors?.[clientId] || '#000000',
                         size: 3,
                         opacity: 1.0,
                         timestamp: Date.now()
                     });
                     delete this.remoteTrails[clientId];
                     hasActiveTrails = true;
                }
                return;
            }

            // Cache color
            if (!this._lastColors) this._lastColors = {};
            this._lastColors[clientId] = state.color;

            // Draw live trail
            if (state.isDrawing && state.tool === 'pen') {
                hasActiveTrails = true;
                let trail = this.remoteTrails[clientId] || [];
                const lastPt = trail[trail.length - 1];
                if (!lastPt || lastPt.x !== state.cursor.x || lastPt.y !== state.cursor.y) {
                    trail.push(state.cursor);
                }
                this.remoteTrails[clientId] = trail;

                drawTrail(trail, state.color, state.size, 1.0);
            } else {
                if (this.remoteTrails[clientId]) {
                     // Move to fading
                     this.fadingTrails.push({
                         points: this.remoteTrails[clientId],
                         color: state.color,
                         size: state.size,
                         opacity: 1.0,
                         timestamp: Date.now()
                     });
                     delete this.remoteTrails[clientId];
                     hasActiveTrails = true;
                }
            }


            // Draw cursor
            const div = document.createElement('div');
            div.className = 'remote-cursor';

            const scaleX = rect.width / this.app.state.viewW;
            const scaleY = rect.height / this.app.state.viewH;

            const x = (state.cursor.x * this.app.state.zoom + this.app.state.pan.x) * scaleX;
            const y = (state.cursor.y * this.app.state.zoom + this.app.state.pan.y) * scaleY;

            div.style.left = `${x}px`;
            div.style.top = `${y}px`;
            div.style.borderColor = 'var(--accent)';

            div.innerHTML = `
                <div class="cursor-pointer"></div>
                <div class="cursor-label">${state.userName || 'User'}</div>
            `;
            container.appendChild(div);
        });

        // Hide trail canvas if no active trails
        trailCanvas.style.display = hasActiveTrails ? 'block' : 'none';
    }

    renderUsers() {
        // Beta mode: Use Yjs awareness
        if (this.useBetaSync) {
            return this._renderUsersYjs();
        }

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

    /**
     * Yjs version of renderUsers - uses awareness map
     */
    _renderUsersYjs() {
        const el = this.app.getElement('userList');
        if (!el) return;

        const myName = window.Registry?.getUsername() || this.userId;
        let html = `
            <div class="user-item self">
                <div class="user-dot" style="background:var(--primary)"></div>
                <span>You (${myName})</span>
            </div>
        `;

        if (this._yjsAwareness) {
            this._yjsAwareness.forEach((state, clientId) => {
                if (clientId === this._yjsClientId) return; // Skip self
                if (!state) return;
                const userName = state.userName || 'User';
                html += `
                    <div class="user-item">
                        <div class="user-dot" style="background:var(--accent)"></div>
                        <span>${userName}</span>
                    </div>
                `;
            });
        }

        el.innerHTML = html;
    }

    getProject() {
        if (!this.root || !this.projectId) return null;
        return this.root.get("projects").get(this.projectId);
    }

    async syncStorageToLocal() {
        const project = this.getProject();
        if (!project) return;

        const metadata = project.get("metadata").toObject();
        this.app.state.projectName = metadata.name;
        this.app.state.idx = metadata.idx;
        this.app.state.pageLocked = metadata.pageLocked;
        this.app.state.ownerId = metadata.ownerId;
        this.app.state.baseFileName = metadata.baseFileName || null;

        const titleEl = this.app.getElement('headerTitle');
        if(titleEl) titleEl.innerText = metadata.name;

        this.app.state.bookmarks = project.get("bookmarks").toArray();
        this.app.renderBookmarks();

        this.app.state.colors = project.get("colors").toArray();
        this.app.renderSwatches();

        // Page sync: R2 is the source of truth - just run reconciliation
        console.log(`[syncStorageToLocal] Running reconciliation to sync pages from R2...`);
        await this.reconcilePageStructure();

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
                // Instant navigation - no debounce for following other users
                console.log(`Liveblocks: Accepting remote page change to idx=${metadata.idx}`);
                this.app.loadPage(metadata.idx, false, true);
            }
        }

        // Check for R2 modification updates (large file sync) - debounced
        this._scheduleR2ModificationCheck();

        this.syncHistory();
        this.app.updateLockUI();
    }

    // Debounced R2 modification check to avoid too many fetches
    _scheduleR2ModificationCheck() {
        if (this._r2CheckTimeout) {
            clearTimeout(this._r2CheckTimeout);
        }
        this._r2CheckTimeout = setTimeout(() => {
            this._checkR2ModificationUpdates();
        }, 300);
    }

    // Check if any page has new R2 modifications we need to fetch
    _checkR2ModificationUpdates() {
        const project = this.getProject();
        if (!project) return;

        const pagesMetadata = project.get("pagesMetadata");
        if (!pagesMetadata) return;

        // Check each page for R2 updates (both base history and modifications)
        this.app.state.images.forEach((img, idx) => {
            if (!img) return;

            const pageMeta = pagesMetadata.get(idx.toString());
            if (!pageMeta) return;

            const meta = pageMeta.toObject ? pageMeta.toObject() : pageMeta;

            // Check if base history needs to be fetched
            if (meta.hasBaseHistory && !img._baseHistory && img.pageId) {
                console.log(`[LiveSync] Base history needed for page ${idx}, fetching from R2...`);
                this._fetchBaseHistoryForPage(idx, img);
            }

            // Check if there are R2 modifications we haven't fetched yet
            if (meta.hasR2Modifications && meta.r2ModTimestamp) {
                const lastFetched = img._r2ModTimestamp || 0;

                if (meta.r2ModTimestamp > lastFetched) {
                    console.log(`[LiveSync] R2 modifications updated for page ${idx}, fetching...`);
                    this._fetchAndApplyR2Modifications(idx, img, meta.r2ModTimestamp);
                }
            }
        });
    }

    // Fetch base history for a specific page
    async _fetchBaseHistoryForPage(pageIdx, img) {
        if (!img.pageId || img._baseHistoryFetching) return;

        img._baseHistoryFetching = true;

        try {
            const baseHistory = await this.fetchBaseHistory(img.pageId);
            if (baseHistory && baseHistory.length > 0) {
                img._baseHistory = baseHistory;
                img.hasBaseHistory = true;

                console.log(`[LiveSync] Fetched ${baseHistory.length} base history items for page ${pageIdx}`);

                // Re-sync history to merge base + deltas
                this.syncHistory();
                this.app.render();
            }
        } catch (e) {
            console.error(`[LiveSync] Failed to fetch base history for page ${pageIdx}:`, e);
        } finally {
            img._baseHistoryFetching = false;
        }
    }

    // Fetch R2 modifications and apply them
    async _fetchAndApplyR2Modifications(pageIdx, img, timestamp) {
        if (!img.pageId) return;

        const r2Mods = await this.fetchR2Modifications(img.pageId);
        if (r2Mods && Object.keys(r2Mods).length > 0) {
            img._r2Modifications = r2Mods;
            img._r2ModTimestamp = timestamp;

            // Re-sync history to apply the new modifications
            this.syncHistory();
            this.app.render();

            console.log(`[LiveSync] Applied ${Object.keys(r2Mods).length} R2 modifications for page ${pageIdx}`);
        }
    }

    // Debounced scheduler for page reconciliation (add/delete pages only)
    _scheduleReconciliation() {
        // Clear any pending reconciliation
        if (this._reconcileDebounceTimer) {
            clearTimeout(this._reconcileDebounceTimer);
        }

        // Debounce: wait 300ms before reconciling (coalesces rapid changes)
        this._reconcileDebounceTimer = setTimeout(() => {
            this.reconcilePageStructure();
        }, 300);
    }

    /**
     * Fetches missing pages from backend with retry logic (3 attempts per page)
     * @param {number} expectedPageCount - The expected total page count from metadata
     * @param {number} maxRetries - Maximum retries per page (default: 3)
     */
    async fetchMissingPagesWithRetry(expectedPageCount, maxRetries = 3) {
        // Prevent concurrent fetches
        if (this._isFetchingMissingPages) {
            console.log('[fetchMissingPagesWithRetry] Already fetching missing pages, skipping...');
            return;
        }
        this._isFetchingMissingPages = true;

        console.log(`[fetchMissingPagesWithRetry] Starting fetch. Expected: ${expectedPageCount}, Current: ${this.app.state.images.length}`);

        try {
            let pagesAdded = 0;
            const failedPages = [];

            // First pass: try to fetch all missing pages
            for (let i = this.app.state.images.length; i < expectedPageCount; i++) {
                const success = await this._fetchSinglePageWithRetry(i, maxRetries);
                if (success) {
                    pagesAdded++;
                } else {
                    failedPages.push(i);
                }
            }

            // Second pass: retry failed pages with longer delays
            if (failedPages.length > 0) {
                console.log(`[fetchMissingPagesWithRetry] Retrying ${failedPages.length} failed pages with extended delay...`);
                await new Promise(r => setTimeout(r, 2000)); // Wait 2 seconds before retry

                for (const pageIdx of failedPages) {
                    const success = await this._fetchSinglePageWithRetry(pageIdx, maxRetries, 1500);
                    if (success) {
                        pagesAdded++;
                    }
                }
            }

            // Third pass: final attempt for any remaining missing pages
            const stillMissing = expectedPageCount - this.app.state.images.length;
            if (stillMissing > 0) {
                console.log(`[fetchMissingPagesWithRetry] Final attempt for ${stillMissing} still-missing pages...`);
                await new Promise(r => setTimeout(r, 3000)); // Wait 3 seconds

                for (let i = this.app.state.images.length; i < expectedPageCount; i++) {
                    await this._fetchSinglePageWithRetry(i, maxRetries, 2000);
                }
            }

            if (pagesAdded > 0 || this.app.state.images.length > 0) {
                // Update UI
                const pt = this.app.getElement('pageTotal');
                if (pt) pt.innerText = '/ ' + this.app.state.images.length;

                if (this.app.state.activeSideTab === 'pages') {
                    this.app.renderPageSidebar();
                }

                // Reload current page to ensure proper display
                if (this.app.loadPage) {
                    await this.app.loadPage(this.app.state.idx, false);
                    this.app.render();
                }

                console.log(`[fetchMissingPagesWithRetry] Complete. Added ${pagesAdded} pages. Total: ${this.app.state.images.length}`);
            }
        } catch (error) {
            console.error('[fetchMissingPagesWithRetry] Critical error:', error);
        } finally {
            this._isFetchingMissingPages = false;
        }
    }

    /**
     * Fetch a single page by its UUID with retry logic
     * @param {string} pageId - The unique page ID (e.g., 'pdf_0', 'user_abc123')
     * @param {number} targetIndex - The index where this page should be inserted
     * @param {number} maxRetries - Maximum number of retries
     * @param {number} retryDelay - Delay between retries in ms
     * @returns {boolean} - Whether the fetch was successful
     */
    async _fetchPageByIdWithRetry(pageId, targetIndex, maxRetries = 3, retryDelay = 1000, metadata = null) {
        // Check if page with this pageId already exists AND has content
        const existingPage = this.app.state.images.find(img => img && img.pageId === pageId);
        // Only skip if it exists, is NOT a skeleton, and has a blob
        if (existingPage && !existingPage.isSkeleton && existingPage.blob) {
            console.log(`[_fetchPageByIdWithRetry] Page ${pageId} already exists and has blob, skipping`);
            return true;
        }
        
        // If it exists but has no blob (skeleton), we update it in place
        const isHydrating = !!existingPage;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Use new UUID-based endpoint
                const url = window.Config?.apiUrl(`/api/color_rm/page/${this.app.state.sessionId}/${pageId}`) ||
                    `/api/color_rm/page/${this.app.state.sessionId}/${pageId}`;

                console.log(`[_fetchPageByIdWithRetry] Fetching page ${pageId} (hydrating: ${isHydrating}), attempt ${attempt}/${maxRetries}`);

                const response = await fetch(url);
                console.log(`[_fetchPageByIdWithRetry] Fetch response status: ${response.status} for page ${pageId}`);

                if (response.ok) {
                    const blob = await response.blob();
                    console.log(`[_fetchPageByIdWithRetry] Received blob for page ${pageId}: size=${blob.size} bytes, type=${blob.type}`);

                    // Validate blob
                    if (!blob || blob.size === 0) {
                        console.warn(`[_fetchPageByIdWithRetry] Page ${pageId} returned empty blob (size: ${blob?.size || 0}), retry...`);
                        if (attempt < maxRetries) {
                            await new Promise(r => setTimeout(r, retryDelay));
                            continue;
                        }
                        console.error(`[_fetchPageByIdWithRetry] Page ${pageId} is empty after ${maxRetries} attempts`);
                        return false;
                    }

                    console.log(`[_fetchPageByIdWithRetry] Page ${pageId} blob size: ${blob.size} bytes`);

                    if (isHydrating) {
                        // Update existing skeleton
                        existingPage.blob = blob;
                        existingPage.isSkeleton = false; // Clear flag
                        await this.app.dbPut('pages', existingPage);
                        console.log(`[_fetchPageByIdWithRetry] Successfully hydrated page ${pageId}`);
                        return true;
                    }

                    const pageObj = {
                        id: `${this.app.state.sessionId}_${targetIndex}`,
                        sessionId: this.app.state.sessionId,
                        pageIndex: targetIndex,
                        pageId: pageId, // Store the UUID
                        blob: blob,
                        history: []
                    };

                    // Apply metadata (template type, infinite canvas, etc.)
                    if (metadata) {
                        if (metadata.templateType) {
                            pageObj.templateType = metadata.templateType;
                            pageObj.templateConfig = metadata.templateConfig;
                            console.log(`[_fetchPageByIdWithRetry] Applied template metadata: ${metadata.templateType}`);
                        }
                        if (metadata.isInfinite) {
                            pageObj.isInfinite = true;
                            pageObj.vectorGrid = metadata.vectorGrid;
                            pageObj.bounds = metadata.bounds;
                            pageObj.origin = metadata.origin;
                            console.log(`[_fetchPageByIdWithRetry] Applied infinite canvas metadata`);
                        }
                    }

                    // Double-check if page still doesn't exist (race condition protection)
                    const existsNow = this.app.state.images.find(img => img && img.pageId === pageId);
                    if (!existsNow) {
                        await this.app.dbPut('pages', pageObj);

                        // Just add the page - _reorderPagesToMatchStructure will handle correct positioning
                        this.app.state.images.push(pageObj);

                        console.log(`[_fetchPageByIdWithRetry] Successfully added page ${pageId}`);
                        return true;
                    } else {
                        // If it appeared during fetch, maybe update its blob if missing?
                        if (!existsNow.blob) {
                             existsNow.blob = blob;
                             await this.app.dbPut('pages', existsNow);
                             return true;
                        }
                        console.log(`[_fetchPageByIdWithRetry] Page ${pageId} was added by another process`);
                        return true;
                    }
                } else if (response.status === 404) {
                    // Page doesn't exist on backend - might be a PDF page (not uploaded individually)
                    console.log(`[_fetchPageByIdWithRetry] Page ${pageId} not found (404)`);
                    if (attempt < maxRetries) {
                        await new Promise(r => setTimeout(r, retryDelay * 2));
                        continue;
                    }
                    return false;
                } else {
                    console.warn(`[_fetchPageByIdWithRetry] Page ${pageId} fetch failed (status: ${response.status})`);
                    if (attempt < maxRetries) {
                        await new Promise(r => setTimeout(r, retryDelay));
                        continue;
                    }
                    return false;
                }
            } catch (err) {
                console.error(`[_fetchPageByIdWithRetry] Error fetching page ${pageId}:`, err);
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, retryDelay));
                    continue;
                }
                return false;
            }
        }
        return false;
    }

    /**
     * Fetch a single page with retry logic (legacy index-based - for backwards compatibility)
     * @param {number} pageIndex - The page index to fetch
     * @param {number} maxRetries - Maximum number of retries
     * @param {number} retryDelay - Delay between retries in ms
     * @returns {boolean} - Whether the fetch was successful
     */
    async _fetchSinglePageWithRetry(pageIndex, maxRetries = 3, retryDelay = 1000) {
        // Skip if page already exists
        if (this.app.state.images[pageIndex]) {
            console.log(`[_fetchSinglePageWithRetry] Page ${pageIndex} already exists, skipping`);
            return true;
        }

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Try new UUID-based endpoint first with pdf_X format
                const pageId = `pdf_${pageIndex}`;
                const url = window.Config?.apiUrl(`/api/color_rm/page/${this.app.state.sessionId}/${pageId}`) ||
                    `/api/color_rm/page/${this.app.state.sessionId}/${pageId}`;

                console.log(`[_fetchSinglePageWithRetry] Fetching page ${pageIndex} (pageId: ${pageId}), attempt ${attempt}/${maxRetries}`);

                const response = await fetch(url);

                if (response.ok) {
                    const blob = await response.blob();

                    // Validate blob
                    if (!blob || blob.size === 0) {
                        console.warn(`[_fetchSinglePageWithRetry] Page ${pageIndex} returned empty blob, retry...`);
                        if (attempt < maxRetries) {
                            await new Promise(r => setTimeout(r, retryDelay));
                            continue;
                        }
                        return false;
                    }

                    const pageObj = {
                        id: `${this.app.state.sessionId}_${pageIndex}`,
                        sessionId: this.app.state.sessionId,
                        pageIndex: pageIndex,
                        pageId: pageId, // Store the UUID
                        blob: blob,
                        history: []
                    };

                    // Double-check if page still doesn't exist (race condition protection)
                    if (!this.app.state.images[pageIndex]) {
                        // Ensure we don't have gaps in the array
                        while (this.app.state.images.length < pageIndex) {
                            console.warn(`[_fetchSinglePageWithRetry] Filling gap at index ${this.app.state.images.length}`);
                            // Create placeholder for missing pages
                            this.app.state.images.push(null);
                        }

                        await this.app.dbPut('pages', pageObj);

                        if (this.app.state.images.length === pageIndex) {
                            this.app.state.images.push(pageObj);
                        } else {
                            this.app.state.images[pageIndex] = pageObj;
                        }

                        console.log(`[_fetchSinglePageWithRetry] Successfully added page ${pageIndex}`);
                        return true;
                    } else {
                        console.log(`[_fetchSinglePageWithRetry] Page ${pageIndex} was added by another process`);
                        return true;
                    }
                } else if (response.status === 404) {
                    // Page doesn't exist on backend yet - might still be uploading
                    console.log(`[_fetchSinglePageWithRetry] Page ${pageIndex} not found (404), waiting...`);
                    if (attempt < maxRetries) {
                        await new Promise(r => setTimeout(r, retryDelay * 2)); // Longer wait for 404
                        continue;
                    }
                    return false;
                } else {
                    console.warn(`[_fetchSinglePageWithRetry] Page ${pageIndex} fetch failed (status: ${response.status})`);
                    if (attempt < maxRetries) {
                        await new Promise(r => setTimeout(r, retryDelay));
                        continue;
                    }
                    return false;
                }
            } catch (err) {
                console.error(`[_fetchSinglePageWithRetry] Error fetching page ${pageIndex}:`, err);
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, retryDelay));
                    continue;
                }
                return false;
            }
        }
        return false;
    }

    /**
     * Fetches the page structure from the server and reconciles with local pages
     * This is the main method for UUID-based page sync
     *
     * SOURCE OF TRUTH: The page structure file + base PDF + user-added pages in R2
     * - PDF pages (pdf_*) are rendered from the base PDF file
     * - User pages (user_*) are fetched individually from R2
     */
    async reconcilePageStructure() {
        // Prevent concurrent reconciliation
        if (this._isReconciling) {
            console.log('[reconcilePageStructure] Already running, skipping.');
            return;
        }

        // Skip if a local page operation is in progress
        if (this._isLocalPageOperation) {
            console.log('[reconcilePageStructure] Skipped - local page operation in progress');
            return;
        }

        this._isReconciling = true;

        // Show non-obtrusive progress bar
        this.app.ui.updateProgress(0, 'Syncing pages...');

        console.log('[reconcilePageStructure] Starting page structure reconciliation...');

        try {
            // SPECIAL CASE: If base_file exists but page structure says 0 pages,
            // the project has never been opened - simply import the PDF
            const baseFileUrl = window.Config?.apiUrl(`/api/color_rm/base_file/${this.app.state.sessionId}`) ||
                `/api/color_rm/base_file/${this.app.state.sessionId}`;

            const baseFileResponse = await fetch(baseFileUrl);
            if (baseFileResponse.ok && this.app.state.images.length === 0) {
                console.log('[reconcilePageStructure] Base file exists but no pages in structure, importing PDF...');

                // Fetch the base file
                const baseBlob = await baseFileResponse.blob();

                // Import the base file as PDF
                await this.app.importBaseFile(baseBlob);

                // Update UI
                const pt = this.app.getElement('pageTotal');
                if (pt) pt.innerText = '/ ' + this.app.state.images.length;

                // Update page input max value to reflect new total
                const pageInput = this.app.getElement('pageInput');
                if (pageInput) {
                    pageInput.max = this.app.state.images.length;
                }

                if (this.app.state.activeSideTab === 'pages') {
                    this.app.renderPageSidebar();
                }

                // Reload current page if anything changed
                if (this.app.state.images.length > 0) {
                    this.app.invalidateCache();
                    await this.app.loadPage(this.app.state.idx, false);
                }

                // Clear progress bar
                this.app.ui.updateProgress(100, 'Sync complete');
                setTimeout(() => this.app.ui.updateProgress(0, ''), 1000);

                console.log(`[reconcilePageStructure] PDF import complete. Local pages: ${this.app.state.images.length}`);
                return;
            }

            // STEP 1: Get the page structure (this is the source of truth for ordering)
            const structureUrl = window.Config?.apiUrl(`/api/color_rm/page_structure/${this.app.state.sessionId}`) ||
                `/api/color_rm/page_structure/${this.app.state.sessionId}`;

            const structureResponse = await fetch(structureUrl);

            if (!structureResponse.ok) {
                console.log('[reconcilePageStructure] No structure file found, nothing to sync');

                // Clear progress bar
                this.app.ui.updateProgress(0, '');

                // Update UI to reflect current page count even if no structure
                const pageTotal = this.app.getElement('pageTotal');
                if (pageTotal) pageTotal.innerText = '/ ' + this.app.state.images.length;

                // Update page input max value to reflect current total
                const pageInput = this.app.getElement('pageInput');
                if (pageInput) {
                    pageInput.max = this.app.state.images.length;
                }

                if (this.app.state.activeSideTab === 'pages') {
                    this.app.renderPageSidebar();
                }

                return;
            }

            const structure = await structureResponse.json();
            const remotePageIds = structure.pageIds || [];
            const pdfPageCount = structure.pdfPageCount || 0;
            const pageMetadata = structure.pageMetadata || {}; // Template/infinite canvas metadata

            console.log(`[reconcilePageStructure] Remote structure: ${remotePageIds.length} pages (${pdfPageCount} from PDF)`);

            if (remotePageIds.length === 0) {
                console.log('[reconcilePageStructure] Empty structure, nothing to sync');

                // Clear progress bar
                this.app.ui.updateProgress(0, '');

                return;
            }

            // STEP 2: Get local page IDs
            const localPageIds = this.app.state.images.map(img => img?.pageId).filter(Boolean);
            console.log(`[reconcilePageStructure] Local has ${localPageIds.length} pages`);

            // STEP 3: Find missing pages
            const missingPageIds = remotePageIds.filter(pid => !localPageIds.includes(pid));

            if (missingPageIds.length > 0) {
                console.log(`[reconcilePageStructure] Missing ${missingPageIds.length} pages. Synchronizing...`);

                // Update progress bar
                this.app.ui.updateProgress(30, `Syncing ${missingPageIds.length} missing pages...`);

                // Separate PDF pages from user pages
                const missingPdfPages = missingPageIds.filter(pid => pid.startsWith('pdf_'));
                const missingUserPages = missingPageIds.filter(pid => pid.startsWith('user_'));

                // 1. PDF pages: render from base PDF
                if (missingPdfPages.length > 0) {
                    console.log(`[reconcilePageStructure] Rendering ${missingPdfPages.length} PDF pages from base file...`);
                    this.app.ui.updateProgress(40, `Rendering ${missingPdfPages.length} PDF pages...`);
                    await this._renderPdfPagesFromBase(missingPdfPages);

                    // Update progress after PDF pages
                    this.app.ui.updateProgress(60, `Syncing user pages...`);
                }

                // 2. User pages: fetch from R2
                if (missingUserPages.length > 0) {
                    const currentIdx = this.app.state.idx;
                    const pendingIdx = this._pendingPageIdx;
                    const targetPageId = remotePageIds[pendingIdx !== undefined ? pendingIdx : currentIdx];

                    // Sort: Target page first for faster response
                    missingUserPages.sort((a, b) => {
                        if (a === targetPageId) return -1;
                        if (b === targetPageId) return 1;
                        return 0;
                    });

                    let fetchedCount = 0;
                    const CONCURRENCY = 5;

                    for (let i = 0; i < missingUserPages.length; i += CONCURRENCY) {
                        const chunk = missingUserPages.slice(i, i + CONCURRENCY);

                        // Update progress for each chunk
                        const progressPercent = 60 + Math.floor((i / missingUserPages.length) * 30);
                        this.app.ui.updateProgress(progressPercent, `Syncing pages ${i + 1}-${Math.min(i + CONCURRENCY, missingUserPages.length)} of ${missingUserPages.length}...`);

                        const results = await Promise.all(chunk.map(async pageId => {
                            const targetIndex = this.app.state.images.length;
                            const meta = pageMetadata[pageId] || null;
                            return await this._fetchPageByIdWithRetry(pageId, targetIndex, 3, 1000, meta);
                        }));
                        fetchedCount += results.filter(Boolean).length;
                    }

                    if (fetchedCount > 0) {
                        this.app.ui.showToast(`Synced ${fetchedCount} new page${fetchedCount > 1 ? 's' : ''}`);
                    }
                }
            }

            // STEP 4: Reorder local pages to match remote structure
            this.app.ui.updateProgress(90, 'Finalizing sync...');
            await this._reorderPagesToMatchStructure(remotePageIds);

            // STEP 5: Update UI
            const pt = this.app.getElement('pageTotal');
            if (pt) pt.innerText = '/ ' + this.app.state.images.length;

            // Update page input max value to reflect new total
            const pageInput = this.app.getElement('pageInput');
            if (pageInput) {
                pageInput.max = this.app.state.images.length;
            }

            if (this.app.state.activeSideTab === 'pages') {
                this.app.renderPageSidebar();
            }

            // Reload current page if anything changed
            if (missingPageIds.length > 0) {
                this.app.invalidateCache();
                await this.app.loadPage(this.app.state.idx, false);
            }

            // Final progress update
            this.app.ui.updateProgress(100, 'Sync complete');
            setTimeout(() => this.app.ui.updateProgress(0, ''), 1000);

            // Update UI to reflect new page count (already handled earlier in the function)
            if (this.app.state.activeSideTab === 'pages') {
                this.app.renderPageSidebar();
            }

            console.log(`[reconcilePageStructure] Complete. Local pages: ${this.app.state.images.length}`);
        } catch (error) {
            console.error('[reconcilePageStructure] Error:', error);

            // Clear progress bar on error
            this.app.ui.updateProgress(0, '');
        } finally {
            this._isReconciling = false;
        }
    }

    /**
     * Renders PDF pages from the base PDF file
     * @param {string[]} pdfPageIds - Array of PDF page IDs like ['pdf_0', 'pdf_1', ...]
     */
    async _renderPdfPagesFromBase(pdfPageIds) {
        try {
            // Fetch the base PDF file
            const baseUrl = window.Config?.apiUrl(`/api/color_rm/base_file/${this.app.state.sessionId}`) ||
                `/api/color_rm/base_file/${this.app.state.sessionId}`;

            console.log(`[_renderPdfPagesFromBase] Fetching base PDF from: ${baseUrl}`);

            const response = await fetch(baseUrl);
            console.log(`[_renderPdfPagesFromBase] Fetch response status: ${response.status}`);

            if (!response.ok) {
                console.error('[_renderPdfPagesFromBase] Failed to fetch base PDF');
                return;
            }

            const blob = await response.blob();
            console.log(`[_renderPdfPagesFromBase] Received blob: size=${blob.size} bytes, type=${blob.type}`);

            // Check if it's a PDF
            if (!blob.type.includes('pdf')) {
                console.warn(`[_renderPdfPagesFromBase] Base file is not a PDF (type: ${blob.type}), treating as single image`);
                // Handle single image base file
                if (pdfPageIds.includes('pdf_0')) {
                    const pageObj = {
                        id: `${this.app.state.sessionId}_${this.app.state.images.length}`,
                        sessionId: this.app.state.sessionId,
                        pageIndex: this.app.state.images.length,
                        pageId: 'pdf_0',
                        blob: blob,
                        history: []
                    };
                    await this.app.dbPut('pages', pageObj);
                    this.app.state.images.push(pageObj);
                }
                return;
            }

            // Load PDF with pdf.js
            console.log(`[_renderPdfPagesFromBase] Converting blob to arrayBuffer...`);
            const arrayBuffer = await blob.arrayBuffer();
            console.log(`[_renderPdfPagesFromBase] ArrayBuffer size: ${arrayBuffer.byteLength}, expected PDF size: ${blob.size}`);

            try {
                console.log(`[_renderPdfPagesFromBase] Loading PDF with pdf.js...`);
                const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
                console.log(`[_renderPdfPagesFromBase] PDF loaded successfully, numPages: ${pdf.numPages}`);
            } catch (pdfError) {
                console.error(`[_renderPdfPagesFromBase] PDF loading failed:`, pdfError);
                console.error(`[_renderPdfPagesFromBase] ArrayBuffer byte check - first 100 bytes:`,
                    Array.from(new Uint8Array(arrayBuffer.slice(0, 100))).map(b => b.toString(16).padStart(2, '0')).join(' '));
                console.error(`[_renderPdfPagesFromBase] Content type check:`, blob.type);
                throw pdfError;
            }

            console.log(`[_renderPdfPagesFromBase] PDF has ${pdf.numPages} pages, rendering ${pdfPageIds.length} missing pages in parallel`);

            const CONCURRENCY = 3;
            for (let i = 0; i < pdfPageIds.length; i += CONCURRENCY) {
                const chunk = pdfPageIds.slice(i, i + CONCURRENCY);

                // Update progress for each chunk
                const progressPercent = 40 + Math.floor((i / pdfPageIds.length) * 20); // Distribute 20% across PDF rendering
                this.app.ui.updateProgress(progressPercent, `Rendering PDF pages ${i + 1}-${Math.min(i + CONCURRENCY, pdfPageIds.length)} of ${pdfPageIds.length}...`);

                await Promise.all(chunk.map(async (pageId) => {
                    // Extract page number from pageId (e.g., 'pdf_0' -> 0, 'pdf_5' -> 5)
                    const pageNum = parseInt(pageId.replace('pdf_', ''), 10);

                    if (pageNum >= pdf.numPages) {
                        console.warn(`[_renderPdfPagesFromBase] Page ${pageNum} exceeds PDF page count ${pdf.numPages}`);
                        return;
                    }

                    // pdf.js uses 1-indexed pages
                    const page = await pdf.getPage(pageNum + 1);
                    const viewport = page.getViewport({ scale: 1.5 });

                    const canvas = document.createElement('canvas');
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;

                    await page.render({
                        canvasContext: canvas.getContext('2d'),
                        viewport: viewport
                    }).promise;

                    const pageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));

                    const pageObj = {
                        id: `${this.app.state.sessionId}_${this.app.state.images.length}`,
                        sessionId: this.app.state.sessionId,
                        pageIndex: this.app.state.images.length,
                        pageId: pageId,
                        blob: pageBlob,
                        history: []
                    };

                    await this.app.dbPut('pages', pageObj);
                    this.app.state.images.push(pageObj);

                    console.log(`[_renderPdfPagesFromBase] Rendered page ${pageId}`);
                }));
            }
        } catch (error) {
            console.error('[_renderPdfPagesFromBase] Error:', error);
        }
    }

    /**
     * Reorders local pages to match the remote structure order
     * @param {string[]} remotePageIds - Ordered array of page IDs from server
     */
    async _reorderPagesToMatchStructure(remotePageIds) {
        const reorderedPages = [];
        const pageMap = new Map();
        const usedPageIds = new Set();

        // Build a map of pageId -> page object
        this.app.state.images.forEach(page => {
            if (page && page.pageId) {
                pageMap.set(page.pageId, page);
            }
        });

        // Reorder based on remote structure
        remotePageIds.forEach((pageId, index) => {
            const page = pageMap.get(pageId);
            if (page) {
                page.pageIndex = index;
                page.id = `${this.app.state.sessionId}_${index}`;
                reorderedPages.push(page);
                usedPageIds.add(pageId);
            }
        });

        // Append any local-only pages that weren't in the remote structure at the end
        this.app.state.images.forEach(page => {
            if (page && page.pageId && !usedPageIds.has(page.pageId)) {
                const newIndex = reorderedPages.length;
                page.pageIndex = newIndex;
                page.id = `${this.app.state.sessionId}_${newIndex}`;
                reorderedPages.push(page);
                console.log(`[_reorderPagesToMatchStructure] Appending local-only page ${page.pageId} at index ${newIndex}`);
            }
        });

        // Only update if there were actual changes
        if (reorderedPages.length > 0) {
            // Check if order actually changed (or if page count changed)
            const orderChanged = reorderedPages.length !== this.app.state.images.length ||
                reorderedPages.some((page, idx) =>
                    this.app.state.images[idx]?.pageId !== page.pageId
                );

            if (orderChanged) {
                this.app.state.images = reorderedPages;

                // Update IndexedDB with new page indices
                for (const page of reorderedPages) {
                    await this.app.dbPut('pages', page);
                }

                console.log(`[_reorderPagesToMatchStructure] Reordered ${reorderedPages.length} pages`);
            }
        }
    }

    /**
     * Fetches missing pages from backend when remote has more pages than local
     * @param {number} expectedPageCount - The expected total page count from metadata
     */
    async fetchMissingPages(expectedPageCount) {
        // Delegate to the new retry-enabled method
        return this.fetchMissingPagesWithRetry(expectedPageCount, 3);
    }

    syncHistory() {
        // Beta mode: Use Yjs
        if (this.useBetaSync) {
            return this._syncHistoryYjs();
        }

        const project = this.getProject();
        if (!project || this.isInitializing) return;

        const pagesHistory = project.get("pagesHistory");
        let currentIdxChanged = false;
        const pagesToFetchBase = [];

        // Priority: Update current page immediately
        const currentRemote = pagesHistory.get(this.app.state.idx.toString());
        if (currentRemote) {
            const deltaHist = currentRemote.toArray();
            const localImg = this.app.state.images[this.app.state.idx];
            if (localImg) {
                // Check if we need to fetch base history first
                const pageMeta = this.getPageMetadata(this.app.state.idx);
                const needsBase = (pageMeta?.hasBaseHistory || localImg.hasBaseHistory) && !localImg._baseHistory;

                if (needsBase) {
                    // Queue for base history fetch, use deltas only for now
                    pagesToFetchBase.push(this.app.state.idx);
                    localImg.history = deltaHist;
                } else if (localImg.hasBaseHistory && localImg._baseHistory) {
                    // If page has base history, merge it with deltas and apply modifications
                    // Get modifications from Liveblocks + R2 (if large)
                    const liveblocksModifications = this.getPageModifications(this.app.state.idx);
                    const r2Modifications = localImg._r2Modifications || {};
                    const modifications = { ...liveblocksModifications, ...r2Modifications };

                    // Apply modifications to base history
                    const modifiedBase = localImg._baseHistory.map(item => {
                        if (modifications[item.id]) {
                            // Merge modification onto base item
                            return { ...item, ...modifications[item.id] };
                        }
                        return item;
                    });
                    // Merge: modified base + deltas from Liveblocks
                    localImg.history = [...modifiedBase, ...deltaHist];
                } else {
                    localImg.history = deltaHist;
                }
                currentIdxChanged = true;
                if (this.app.invalidateCache) this.app.invalidateCache();

                // Auto-recalculate infinite canvas bounds from synced strokes
                if (localImg.isInfinite && this.app.recalculateInfiniteCanvasBounds) {
                    this.app.recalculateInfiniteCanvasBounds(this.app.state.idx);
                }
            }
        }

        // Background sync all other pages (with null check)
        this.app.state.images.forEach((img, idx) => {
            if (!img) return; // Skip null/undefined pages (gaps)
            if (idx === this.app.state.idx) return; // Already handled
            const remote = pagesHistory.get(idx.toString());
            if (remote) {
                const deltaHist = remote.toArray();

                // Check if we need to fetch base history first
                const pageMeta = this.getPageMetadata(idx);
                const needsBase = (pageMeta?.hasBaseHistory || img.hasBaseHistory) && !img._baseHistory;

                if (needsBase) {
                    // Queue for base history fetch, use deltas only for now
                    pagesToFetchBase.push(idx);
                    img.history = deltaHist;
                } else if (img.hasBaseHistory && img._baseHistory) {
                    // If page has base history, merge it with deltas and apply modifications
                    // Get modifications from Liveblocks + R2 (if large)
                    const liveblocksModifications = this.getPageModifications(idx);
                    const r2Modifications = img._r2Modifications || {};
                    const modifications = { ...liveblocksModifications, ...r2Modifications };

                    const modifiedBase = img._baseHistory.map(item => {
                        if (modifications[item.id]) {
                            return { ...item, ...modifications[item.id] };
                        }
                        return item;
                    });
                    img.history = [...modifiedBase, ...deltaHist];
                } else {
                    img.history = deltaHist;
                }

                // Auto-recalculate infinite canvas bounds for all infinite pages
                if (img.isInfinite && this.app.recalculateInfiniteCanvasBounds) {
                    this.app.recalculateInfiniteCanvasBounds(idx);
                }
            }
        });

        if (currentIdxChanged) this.app.render();

        // Fetch base history for pages that need it (async, will trigger re-sync)
        if (pagesToFetchBase.length > 0) {
            this._fetchMissingBaseHistories(pagesToFetchBase);
        }
    }

    /**
     * Yjs version of syncHistory - syncs current page history via WebSocket
     */
    _syncHistoryYjs() {
        if (this.isInitializing) return;

        // Use the simpler WebSocket-based sync
        this._sendYjsUpdate();
    }

    // Fetches base history for multiple pages and re-syncs
    async _fetchMissingBaseHistories(pageIndices) {
        console.log(`[LiveSync] Fetching base history for ${pageIndices.length} pages...`);

        for (const pageIdx of pageIndices) {
            await this.ensureBaseHistory(pageIdx);
        }

        // Re-sync history now that base is loaded
        // Use a small delay to avoid recursion
        setTimeout(() => {
            console.log('[LiveSync] Re-syncing history after base fetch...');
            this.syncHistory();
        }, 100);
    }

    // Fetch and cache base history for a page (called when page is loaded)
    async ensureBaseHistory(pageIdx) {
        const localImg = this.app.state.images[pageIdx];
        if (!localImg) return;

        // Check if page has base history and we haven't fetched it yet
        const pageMeta = this.getPageMetadata(pageIdx);
        if ((pageMeta?.hasBaseHistory || localImg.hasBaseHistory) && !localImg._baseHistory) {
            const pageId = localImg.pageId;
            if (pageId) {
                const baseHistory = await this.fetchBaseHistory(pageId);
                if (baseHistory.length > 0) {
                    localImg._baseHistory = baseHistory;
                    localImg.hasBaseHistory = true;

                    // Re-sync to merge base + deltas
                    this.syncHistory();
                }
            }
        }

        // Also check for R2 modifications if they exist
        if (pageMeta?.hasR2Modifications && localImg.pageId) {
            const r2Mods = await this.fetchR2Modifications(localImg.pageId);
            if (r2Mods && Object.keys(r2Mods).length > 0) {
                localImg._r2Modifications = r2Mods;
                // Re-sync to apply modifications
                this.syncHistory();
            }
        }
    }

    // Fetch modifications from R2 (for large modification sets)
    async fetchR2Modifications(pageId) {
        if (!this.app.state.sessionId || !pageId) return {};

        try {
            const modsUrl = window.Config?.apiUrl(`/api/color_rm/modifications/${this.app.state.sessionId}/${pageId}`)
                || `/api/color_rm/modifications/${this.app.state.sessionId}/${pageId}`;

            const response = await fetch(modsUrl);
            if (!response.ok) return {};

            const data = await response.json();
            console.log(`[LiveSync] Fetched ${Object.keys(data.modifications || {}).length} R2 modifications for page ${pageId}`);
            return data.modifications || {};
        } catch (e) {
            console.error('[LiveSync] Failed to fetch R2 modifications:', e);
            return {};
        }
    }

    // --- Local -> Remote Updates ---
    updateMetadata(updates) {
        // Beta mode: Use Yjs
        if (this.useBetaSync) {
            if (!this.yjsRoot) return;
            this.yjsDoc.transact(() => {
                for (const [key, value] of Object.entries(updates)) {
                    this.yjsRoot.metadata.set(key, value);
                }
            });
            return;
        }

        const project = this.getProject();
        if (project) project.get("metadata").update(updates);
    }

    addStroke(pageIdx, stroke) {
        // Beta mode: Use Yjs
        if (this.useBetaSync) {
            // For beta sync, just send the updated state via WebSocket
            // The stroke is already added to local history by the app
            this._sendYjsUpdate();
            return;
        }

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
        // Beta mode: Use Yjs
        if (this.useBetaSync) {
            // For beta sync, send updated state via WebSocket
            this._sendYjsUpdate();
            return;
        }

        const project = this.getProject();
        if (!project) return;
        const pagesHistory = project.get("pagesHistory");
        pagesHistory.set(pageIdx.toString(), new LiveList(history || []));
    }

    /**
     * Sync page deltas for pages with base history (SVG imports)
     * Instead of syncing full history, only sync:
     * - deltas: new items (user scribbles)
     * - modifications: changes to base items (moves, deletes, etc.)
     */
    syncPageDeltas(pageIdx, deltas, modifications) {
        // Beta mode: Use Yjs
        if (this.useBetaSync) {
            return this._syncPageDeltasYjs(pageIdx, deltas, modifications);
        }

        const project = this.getProject();
        if (!project) return;

        const key = pageIdx.toString();

        // Store deltas in pagesHistory (new items only)
        const pagesHistory = project.get("pagesHistory");
        pagesHistory.set(key, new LiveList(deltas || []));

        // Store modifications in a separate LiveMap
        let pagesMods = project.get("pagesModifications");
        if (!pagesMods) {
            project.set("pagesModifications", new LiveMap());
            pagesMods = project.get("pagesModifications");
        }

        // Store modifications as a LiveObject
        if (Object.keys(modifications).length > 0) {
            pagesMods.set(key, new LiveObject(modifications));
        } else if (pagesMods.has(key)) {
            pagesMods.delete(key);
        }

        console.log(`[LiveSync] Synced page ${pageIdx}: ${deltas.length} deltas, ${Object.keys(modifications).length} modifications`);
    }

    /**
     * Yjs version of syncPageDeltas
     */
    _syncPageDeltasYjs(pageIdx, deltas, modifications) {
        if (!this.yjsRoot) return;

        const key = pageIdx.toString();

        this.yjsDoc.transact(() => {
            // Store deltas
            this.yjsRoot.pagesHistory.set(key, deltas || []);

            // Store modifications
            if (Object.keys(modifications).length > 0) {
                this.yjsRoot.pagesModifications.set(key, modifications);
            } else if (this.yjsRoot.pagesModifications.has(key)) {
                this.yjsRoot.pagesModifications.delete(key);
            }
        });

        console.log(`[Yjs] Synced page ${pageIdx}: ${deltas.length} deltas, ${Object.keys(modifications).length} modifications`);
    }

    /**
     * Get modifications for a page (for applying to base history)
     */
    getPageModifications(pageIdx) {
        // Beta mode: Get from Yjs root
        if (this.useBetaSync) {
            if (!this.yjsRoot) return {};
            const key = pageIdx.toString();
            return this.yjsRoot.pagesModifications?.get(key) || {};
        }

        const project = this.getProject();
        if (!project) return {};

        const pagesMods = project.get("pagesModifications");
        if (!pagesMods) return {};

        const mods = pagesMods.get(pageIdx.toString());
        return mods ? mods.toObject() : {};
    }

    // Update page metadata (e.g., hasBaseHistory flag for SVG imports)
    updatePageMetadata(pageIdx, metadata) {
        // Beta mode: Store in Yjs root
        if (this.useBetaSync) {
            if (!this.yjsRoot) return;
            const key = pageIdx.toString();
            const existing = this.yjsRoot.pagesMetadata?.get(key) || {};
            this.yjsRoot.pagesMetadata?.set(key, { ...existing, ...metadata });
            return;
        }

        const project = this.getProject();
        if (!project) return;

        // Store page metadata in a separate LiveMap
        let pagesMetadata = project.get("pagesMetadata");
        if (!pagesMetadata) {
            // Initialize if not exists
            project.set("pagesMetadata", new LiveMap());
            pagesMetadata = project.get("pagesMetadata");
        }

        const key = pageIdx.toString();
        const existing = pagesMetadata.get(key);
        if (existing) {
            existing.update(metadata);
        } else {
            pagesMetadata.set(key, new LiveObject(metadata));
        }
    }

    // Get page metadata (for checking if page has base history)
    getPageMetadata(pageIdx) {
        // Beta mode: Get from Yjs root
        if (this.useBetaSync) {
            if (!this.yjsRoot) return null;
            const key = pageIdx.toString();
            return this.yjsRoot.pagesMetadata?.get(key) || null;
        }

        const project = this.getProject();
        if (!project) return null;

        const pagesMetadata = project.get("pagesMetadata");
        if (!pagesMetadata) return null;

        const meta = pagesMetadata.get(pageIdx.toString());
        return meta ? meta.toObject() : null;
    }

    // Fetch base history from R2 for a page (for SVG imports)
    async fetchBaseHistory(pageId) {
        if (!this.app.state.sessionId || !pageId) return [];

        try {
            const historyUrl = window.Config?.apiUrl(`/api/color_rm/history/${this.app.state.sessionId}/${pageId}`)
                || `/api/color_rm/history/${this.app.state.sessionId}/${pageId}`;
            const response = await fetch(historyUrl);
            if (response.ok) {
                const history = await response.json();
                console.log(`[LiveSync] Fetched ${history.length} base history items from R2 for page ${pageId}`);
                return history;
            }
        } catch (e) {
            console.error('[LiveSync] Failed to fetch base history from R2:', e);
        }
        return [];
    }

    // DEPRECATED: Bounds are now auto-calculated from synced strokes via math
    // Kept for backwards compatibility but does nothing
    updateInfiniteCanvasBounds(pageIdx, bounds) {
        // No-op: bounds are derived from stroke history automatically
        // console.log(`[LiveSync] updateInfiniteCanvasBounds deprecated - bounds auto-calculated from strokes`);
    }

    // DEPRECATED: Bounds are now auto-calculated from synced strokes via math
    // Kept for backwards compatibility but does nothing
    handleInfiniteCanvasBoundsUpdate(presence) {
        // No-op: bounds are derived from stroke history automatically
        // When strokes sync via Liveblocks, recalculateInfiniteCanvasBounds() is called
    }

    updateBookmarks(bookmarks) {
        // Beta mode: Use Yjs
        if (this.useBetaSync) {
            if (!this.yjsRoot) return;
            this.yjsDoc.transact(() => {
                this.yjsRoot.bookmarks.delete(0, this.yjsRoot.bookmarks.length);
                (bookmarks || []).forEach(b => this.yjsRoot.bookmarks.push([b]));
            });
            return;
        }
        const project = this.getProject();
        if (project) project.set("bookmarks", new LiveList(bookmarks || []));
    }

    updateColors(colors) {
        // Beta mode: Use Yjs
        if (this.useBetaSync) {
            if (!this.yjsRoot) return;
            this.yjsDoc.transact(() => {
                this.yjsRoot.colors.delete(0, this.yjsRoot.colors.length);
                (colors || []).forEach(c => this.yjsRoot.colors.push([c]));
            });
            return;
        }
        const project = this.getProject();
        if (project) project.set("colors", new LiveList(colors || []));
    }

    // Add new page to remote storage
    addPage(pageIndex, pageData) {
        // Beta mode: Use Yjs
        if (this.useBetaSync) {
            if (!this.yjsRoot) return;
            const key = pageIndex.toString();
            this.yjsDoc.transact(() => {
                this.yjsRoot.pagesHistory.set(key, []);
                // Update metadata
                this.yjsRoot.metadata.set('pageCount', Math.max(
                    this.yjsRoot.metadata.get('pageCount') || 0,
                    pageIndex + 1
                ));
            });
            // Broadcast update
            this._sendYjsUpdate();
            return;
        }

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
        // Beta mode: Use Yjs
        if (this.useBetaSync) {
            if (!this.yjsRoot) return;
            const fromKey = fromIndex.toString();
            const toKey = toIndex.toString();
            this.yjsDoc.transact(() => {
                const fromHistory = this.yjsRoot.pagesHistory.get(fromKey) || [];
                const toHistory = this.yjsRoot.pagesHistory.get(toKey) || [];
                this.yjsRoot.pagesHistory.set(fromKey, toHistory);
                this.yjsRoot.pagesHistory.set(toKey, fromHistory);
            });
            return;
        }

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
        // Beta mode: Use Yjs
        if (this.useBetaSync) {
            if (!this.yjsRoot) return;
            this.yjsRoot.metadata.set('pageCount', count);
            return;
        }

        const project = this.getProject();
        if (project) {
            project.get("metadata").update({ pageCount: count });
        }
    }

    // Notify other users about page structure changes using presence (debounced)
    notifyPageStructureChange() {
        // Beta mode: Use Yjs - broadcast page structure change
        if (this.useBetaSync) {
            this._sendYjsPageStructure();
            return;
        }

        // Debounce notifications to prevent flooding during rapid page changes
        if (this._notifyDebounceTimer) {
            clearTimeout(this._notifyDebounceTimer);
        }

        this._notifyDebounceTimer = setTimeout(() => {
            this._doNotifyPageStructureChange();
        }, 100); // 100ms debounce for outgoing notifications
    }

    /**
     * Send page structure update via Yjs WebSocket
     */
    _sendYjsPageStructure() {
        if (!this._yjsSocket || !this._yjsConnected) return;

        const msg = {
            type: 'page-structure',
            pageCount: this.app.state.images.length,
            pageIds: this.app.state.images.map(img => img?.pageId).filter(Boolean),
            currentIdx: this.app.state.idx
        };

        this._yjsSocket.send(JSON.stringify(msg));
        console.log(`[Yjs] Sent page structure: ${msg.pageCount} pages`);
    }

    /**
     * Send presence update via Yjs WebSocket
     */
    _sendYjsPresence() {
        if (!this._yjsSocket || !this._yjsConnected) {
            console.warn('[Yjs] Cannot send presence - not connected');
            return;
        }

        const msg = {
            type: 'presence',
            clientId: this._yjsClientId,
            userName: this.userName || 'Anonymous',
            pageIdx: this.app.state.idx,
            cursor: this._lastCursor || null,
            tool: this.app.state.tool,
            isDrawing: this.app.state.isDrawing || false,
            color: this.app.state.color,
            size: this.app.state.size
        };

        this._yjsSocket.send(JSON.stringify(msg));
        console.log(`[Yjs] Sent presence: page ${msg.pageIdx}`);
    }

    // Internal: Actually send the page structure change notification
    _doNotifyPageStructureChange() {
        // Beta mode: Already handled via _sendYjsPageStructure in notifyPageStructureChange
        if (this.useBetaSync) {
            this._sendYjsPageStructure();
            return;
        }

        // Update presence with a timestamp to notify other users of changes
        if (this.room) {
            // Set flag to ignore our own page structure change notification
            this._ownPageStructureVersion = Date.now();

            this.room.updatePresence({
                pageStructureVersion: this._ownPageStructureVersion,
                pageCount: this.app.state.images.length,
                pageIdx: this.app.state.idx
            });

            console.log(`[LiveSync] Notified page structure change: ${this.app.state.images.length} pages`);
        }
    }

    // Notify other users about page navigation (smart debounced)
    // When user is rapidly flipping pages, we wait until they stop
    notifyPageNavigation(pageIdx) {
        // 1. Mark internal state so we don't process incoming echoes
        this._isFlippingPages = true;
        this._pendingPageIdx = pageIdx;

        this._isFlippingPages = false;
        
        // Mark the time of this broadcast to ignore echoes
        this.lastLocalPageChange = Date.now();

        // --- Beta Mode (Yjs) ---
        if (this.useBetaSync) {
            // If _sendYjsPresence exists, call it. Otherwise skip.
            if (this._sendYjsPresence) this._sendYjsPresence();
            this._sendYjsUpdate();
            console.log(`[Yjs] Page navigation broadcast: ${pageIdx}`);
            return;
        }

        // --- Standard Mode (Liveblocks) ---
        // Update Metadata (Persistent)
        const project = this.getProject();
        if (project) {
            project.get("metadata").update({ idx: pageIdx });
        }

        // Update Presence (Live)
        if (this.room) {
            this.room.updatePresence({ pageIdx: pageIdx });
        }
        
        console.log(`[LiveSync] Page navigation broadcast: ${pageIdx}`);
    }

    // Visual feedback when user is rapidly flipping pages
    _showFlippingFeedback(show) {
        // INTENTIONALLY LEFT EMPTY
        // We want the teacher to see the page instantly and clearly.
        // Dimming the canvas (previous behavior) makes scanning pages difficult.
        return;
    }

    // Handle page structure change notifications from other users (debounced)
    async handlePageStructureChange(message) {
        // Ignore our own page structure change notification
        if (message.pageStructureVersion === this._ownPageStructureVersion) {
            return;
        }

        // Debounce: Coalesce multiple rapid changes into one reconciliation
        if (this._handleStructureDebounceTimer) {
            clearTimeout(this._handleStructureDebounceTimer);
        }

        this._handleStructureDebounceTimer = setTimeout(async () => {
            await this._doHandlePageStructureChange(message);
        }, 500); // 500ms debounce for incoming changes
    }

    // Internal: Actually handle the page structure change
    async _doHandlePageStructureChange(message) {
        // Double-check we haven't processed very recently
        const now = Date.now();
        const DEBOUNCE_MS = 800;

        if (this._lastPageStructureChange && (now - this._lastPageStructureChange) < DEBOUNCE_MS) {
            return;
        }

        this._lastPageStructureChange = now;

        // Always run reconciliation when notified of structure change
        console.log(`Page structure change detected: local=${this.app.state.images.length}, remote=${message.pageCount}`);

        // Add a small delay to allow server to receive the page structure update
        await new Promise(r => setTimeout(r, 300));

        // Simply run reconciliation - it will fetch from R2 (source of truth)
        console.log('[handlePageStructureChange] Running reconciliation...');
        await this.reconcilePageStructure();
    }
}
