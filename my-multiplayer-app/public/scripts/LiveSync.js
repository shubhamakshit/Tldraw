
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

        const { root } = await room.getStorage();
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
        }

        this.syncStorageToLocal();

        // Refresh project-specific subscription
        this.unsubscribes.forEach(unsub => unsub());
        this.unsubscribes = [
            this.room.subscribe(projects.get(projectId), () => {
                this.syncProjectData();
                if (this.app.renderDebug) this.app.renderDebug();
            }, { isDeep: true }),
            // Subscribe to Presence (Others)
            this.room.subscribe("others", () => {
                this.renderUsers();
                this.renderCursors();
            })
        ];

        // Initialize presence for self
        this.room.updatePresence({
            userId: this.userId,
            userName: "User " + this.userId.slice(-4),
            cursor: null,
            pageIdx: this.app.state.idx
        });

        this.renderUsers();
    }

    updateCursor(pt) {
        if (!this.room) return;
        this.room.updatePresence({
            cursor: pt,
            pageIdx: this.app.state.idx
        });
    }

    renderCursors() {
        const container = this.app.getElement('cursorLayer');
        if (!container) return;

        // Clear old cursors
        container.innerHTML = '';

        if (!this.app.state.showCursors) return;

        if (!this.room) return;

        const others = this.room.getOthers();
        const canvas = this.app.getElement('canvas');
        const viewport = this.app.getElement('viewport');
        if (!canvas || !viewport) return;

        const rect = canvas.getBoundingClientRect();
        const viewRect = viewport.getBoundingClientRect();

        others.forEach(user => {
            const presence = user.presence;
            if (!presence || !presence.cursor || presence.pageIdx !== this.app.state.idx) return;

            const div = document.createElement('div');
            div.className = 'remote-cursor';

            // Map canvas coordinates to screen coordinates
            const x = (presence.cursor.x * this.app.state.zoom + this.app.state.pan.x) * (rect.width / this.app.state.viewW) + rect.left - viewRect.left;
            const y = (presence.cursor.y * this.app.state.zoom + this.app.state.pan.y) * (rect.height / this.app.state.viewH) + rect.top - viewRect.top;

            div.style.left = `${x}px`;
            div.style.top = `${y}px`;
            div.style.borderColor = 'var(--accent)';

            div.innerHTML = `
                <div class="cursor-pointer"></div>
                <div class="cursor-label">${presence.userName || 'User'}</div>
            `;
            container.appendChild(div);
        });
    }

    renderUsers() {
        const el = this.app.getElement('userList');
        if (!el) return;

        const others = this.room.getOthers();
        let html = `
            <div class="user-item self">
                <div class="user-dot" style="background:var(--primary)"></div>
                <span>You (${this.userId.slice(-4)})</span>
            </div>
        `;

        others.forEach(user => {
            const info = user.presence;
            if (!info || !info.userId) return;
            html += `
                <div class="user-item">
                    <div class="user-dot" style="background:var(--accent)"></div>
                    <span>Collaborator (${info.userId.slice(-4)})</span>
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

        this.app.state.projectName = metadata.name;
        this.app.state.baseFileName = metadata.baseFileName || null;
        this.app.state.pageLocked = metadata.pageLocked;
        this.app.state.ownerId = metadata.ownerId;

        const titleEl = this.app.getElement('headerTitle');
        if(titleEl) titleEl.innerText = metadata.name;

        if (this.app.state.idx !== metadata.idx) {
            this.app.loadPage(metadata.idx, false);
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
}
