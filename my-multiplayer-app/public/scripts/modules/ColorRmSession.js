export const ColorRmSession = {
    async retryBaseFetch() {
        if (this.isFetchingBase) return;
        this.isFetchingBase = true;
        try {
            const res = await fetch(window.Config?.apiUrl(`/api/color_rm/base_file/${this.state.sessionId}`) || `/api/color_rm/base_file/${this.state.sessionId}`);
            if (res.ok) {
                const blob = await res.blob();
                await this.importBaseFile(blob);
                console.log("Liveblocks: Base file fetch successful.");
            }
        } catch (e) {
            console.error("Liveblocks: Base file fetch failed:", e);
        } finally {
            this.isFetchingBase = false;
        }
    },

    // --- Folder Management ---
    async createFolder() {
        this.ui.showInput("New Folder", "Folder Name", async (name) => {
            if (!name) return;
            const folder = {
                id: `folder_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
                name: name,
                parentId: this.state.currentFolderId || null,
                ownerId: this.state.ownerId || this.liveSync?.userId || 'local'
            };
            await this.dbPut('folders', folder);
            if (this.registry) this.registry.saveFolder(folder);
            this.loadSessionList();
        });
    },

    async deleteFolder(folderId) {
        const confirmed = await this.ui.showConfirm(
            "Delete Folder",
            "Delete this folder? Projects inside will be moved to root."
        );
        if (!confirmed) return;

        // 1. Move contents to root (or parent)
        const sessions = await this.dbGetAll('sessions');
        const contents = sessions.filter(s => s.folderId === folderId);

        for (const s of contents) {
            s.folderId = null; // Move to root for safety
            await this.dbPut('sessions', s);
            if (this.registry) this.registry.upsert(s);
        }

        // 2. Delete Folder from cloud first
        if (this.registry) await this.registry.deleteFolder(folderId);

        // 3. Delete Folder locally
        const tx = this.db.transaction('folders', 'readwrite');
        tx.objectStore('folders').delete(folderId);

        tx.oncomplete = () => this.loadSessionList();
    },

    async openFolder(folderId) {
        this.state.currentFolderId = folderId;
        this.loadSessionList();
    },

    navigateUp() {
        // Simple 1-level for now, or fetch parent from DB if nested
        this.state.currentFolderId = null;
        this.loadSessionList();
    },

    async moveSelectedToFolder(folderId) {
        if (!this.state.selectedSessions || this.state.selectedSessions.size === 0) return;

        for (const id of this.state.selectedSessions) {
            const session = await this.dbGet('sessions', id);
            if (session) {
                session.folderId = folderId;
                await this.dbPut('sessions', session);
                if (this.registry) this.registry.upsert(session);
            }
        }
        this.state.isMultiSelect = false;
        this.state.selectedSessions.clear();
        this.toggleMultiSelect(); // Reset UI
        this.loadSessionList();
    },

    async showMoveDialog() {
        const fid = await this.ui.showPrompt(
            "Move to Folder",
            "Enter destination Folder ID (leave blank for root)",
            this.state.currentFolderId || ''
        );
        if (fid !== null) {
            this.moveSelectedToFolder(fid || null);
        }
    },
    // -------------------------

    async loadSessionList() {
        const userIdEl = this.getElement('dashUserId');
        const projIdEl = this.getElement('dashProjId');
        if (userIdEl) userIdEl.innerText = this.liveSync ? this.liveSync.userId : 'local';
        if (projIdEl) projIdEl.innerText = this.state.sessionId || 'None';

        this.state.selectedSessions = new Set(); // Reset selection

        try {
            const tx = this.db.transaction(['sessions', 'folders'], 'readonly');
            const sessionsReq = tx.objectStore('sessions').getAll();
            const foldersReq = tx.objectStore('folders').getAll();

            // Wait for both
            await new Promise(resolve => {
                let completed = 0;
                const check = () => {
                    if (++completed === 2) resolve();
                };
                sessionsReq.onsuccess = check;
                foldersReq.onsuccess = check;
            });

            const l = this.getElement('sessionList');
            if (!l) return;
            l.innerHTML = '';

            // Render Navigation Header
            if (this.state.currentFolderId) {
                const backBtn = document.createElement('div');
                backBtn.className = 'session-item folder-back';
                backBtn.innerHTML = `<i class="bi bi-arrow-return-left"></i> Back to Root`;
                backBtn.onclick = () => this.navigateUp();
                l.appendChild(backBtn);
            }

            // Filter Folders
            const folders = (foldersReq.result || []).filter(f => {
                // Only show folders in current path
                return (f.parentId || null) === (this.state.currentFolderId || null);
            });

            folders.forEach(f => {
                const item = document.createElement('div');
                item.className = 'session-item folder-item';
                item.innerHTML = `
                    <div style="display:flex; gap:10px; align-items:center;">
                        <i class="bi bi-folder-fill" style="color:#fbbf24; font-size:1.2rem;"></i>
                        <span style="font-weight:600; color:white;">${f.name}</span>
                    </div>
                    <button class="btn btn-sm" style="background:none; border:none; color:#666;"><i class="bi bi-trash"></i></button>
                 `;

                // Click to open
                item.onclick = (e) => {
                    if (e.target.closest('button')) {
                        this.deleteFolder(f.id);
                    } else {
                        this.openFolder(f.id);
                    }
                };
                l.appendChild(item);
            });


            const sessions = sessionsReq.result || [];
            if (sessions.length === 0 && folders.length === 0) {
                l.innerHTML += '<div style="color:#666;text-align:center;padding:10px">No projects found.</div>';
                const editBtn = this.getElement('dashEditBtn');
                if (editBtn) editBtn.style.display = 'none';
                return;
            }

            const editBtn = this.getElement('dashEditBtn');
            if (editBtn) editBtn.style.display = 'block';

            const userId = this.liveSync ? this.liveSync.userId : 'local';

            // Filter Sessions by Folder
            sessions.filter(s => (s.folderId || null) === (this.state.currentFolderId || null))
                .sort((a, b) => b.lastMod - a.lastMod).forEach(s => {

                    const isMine = s.ownerId === userId;
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
                        <input type="checkbox" class="session-checkbox" onclick="event.stopPropagation()">
                        <div>
                            <div style="font-weight:600; color:white;">${s.name} ${badge} ${cloudIcon}</div>
                            <div style="font-size:0.7rem; color:#666; font-family:monospace;">${s.id}</div>
                        </div>
                        <div style="font-size:0.7rem; color:#888;">${s.pageCount} pgs</div>
                    `;

                    // Re-bind checkbox change
                    const cb = item.querySelector('.session-checkbox');
                    if (cb) cb.onchange = () => this.toggleSessionSelection(s.id);

                    l.appendChild(item);
                });
            this.updateMultiSelectUI();
        } catch (e) {
            console.error("Dashboard render error:", e);
        }
    },

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
    },

    toggleSessionSelection(id) {
        if (this.state.selectedSessions.has(id)) this.state.selectedSessions.delete(id);
        else this.state.selectedSessions.add(id);
        this.updateMultiSelectUI();
    },

    selectAllSessions() {
        const tx = this.db.transaction('sessions', 'readonly');
        const req = tx.objectStore('sessions').getAll();
        req.onsuccess = () => {
            req.result.forEach(s => this.state.selectedSessions.add(s.id));
            this.updateMultiSelectUI();
        };
    },

    updateMultiSelectUI() {
        const count = this.state.selectedSessions.size;
        const countEl = this.getElement('multiDeleteCount');
        if (countEl) countEl.innerText = `${count} selected`;

        // Update Checkboxes and classes
        const list = this.getElement('sessionList');
        if (!list) return;
        const items = list.querySelectorAll('.session-item');
        items.forEach(el => {
            const idStr = el.id.replace('sess_', '');
            // Support both string and numeric IDs in the set
            const isSelected = this.state.selectedSessions.has(idStr) ||
                (!isNaN(Number(idStr)) && this.state.selectedSessions.has(Number(idStr)));

            el.classList.toggle('selected', isSelected);
            const cb = el.querySelector('.session-checkbox');
            if (cb) cb.checked = isSelected;
        });
    },

    async deleteSelectedSessions() {
        const count = this.state.selectedSessions.size;
        if (count === 0) return;

        const confirmed = await this.ui.showConfirm(
            "Delete Projects",
            `Permanently delete ${count} project(s) and ALL their drawing data? This cannot be undone.`
        );
        if (!confirmed) return;

        this.ui.toggleLoader(true, "Deleting...");

        // Delete SEQUENTIALLY to avoid KV race conditions
        const ids = Array.from(this.state.selectedSessions);
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            this.ui.toggleLoader(true, `Deleting ${i + 1}/${ids.length}...`);

            // Delete from cloud registry first (await it)
            if (this.registry) await this.registry.delete(id);

            // Then delete locally
            await new Promise((resolve) => {
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
        }

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
    },

    async switchProject(ownerId, projectId) {
        this.ui.hideDashboard();
        window.location.hash = `/color_rm/${ownerId}/${projectId}`;
        location.reload();
    },

    async loadSessionPages(id) {
        return new Promise(async (resolve, reject) => {
            const q = this.db.transaction('pages').objectStore('pages').index('sessionId').getAll(id);
            q.onsuccess = async () => {
                this.state.images = q.result.sort((a, b) => a.pageIndex - b.pageIndex);

                // Retroactively assign IDs to legacy items
                this.state.images.forEach(img => {
                    if (img.history) {
                        img.history.forEach(item => {
                            if (!item.id) item.id = Date.now() + '_' + Math.random();
                        });
                    }
                });

                // Check if we have all pages according to the project metadata
                if (this.liveSync && this.config.collaborative) {
                    const project = this.liveSync.getProject();
                    if (project) {
                        const metadata = project.get("metadata").toObject();
                        const expectedPageCount = metadata.pageCount || 0;

                        // If we have fewer pages than expected, try to fetch missing ones from backend
                        if (this.state.images.length < expectedPageCount && this.config.collaborative && this.state.ownerId) {
                            console.log(`Found ${expectedPageCount} expected pages but only have ${this.state.images.length} locally. Fetching missing pages...`);

                            // Fetch missing page images from backend
                            for (let i = this.state.images.length; i < expectedPageCount; i++) {
                                try {
                                    const response = await fetch(window.Config?.apiUrl(`/api/color_rm/page_file/${this.state.sessionId}/${i}`) || `/api/color_rm/page_file/${this.state.sessionId}/${i}`);
                                    if (response.ok) {
                                        const blob = await response.blob();
                                        const pageObj = {
                                            id: `${this.state.sessionId}_${i}`,
                                            sessionId: this.state.sessionId,
                                            pageIndex: i,
                                            blob: blob,
                                            history: []
                                        };

                                        // Add to database and state
                                        await this.dbPut('pages', pageObj);
                                        this.state.images.push(pageObj);
                                        console.log(`Fetched and added page ${i} from backend`);
                                    } else {
                                        console.warn(`Page ${i} not found on backend`);
                                        // If page not found on backend, try to get from base file (for first page)
                                        if (i === 0) {
                                            const baseResponse = await fetch(window.Config?.apiUrl(`/api/color_rm/base_file/${this.state.sessionId}`) || `/api/color_rm/base_file/${this.state.sessionId}`);
                                            if (baseResponse.ok) {
                                                const blob = await baseResponse.blob();
                                                const pageObj = {
                                                    id: `${this.state.sessionId}_${i}`,
                                                    sessionId: this.state.sessionId,
                                                    pageIndex: i,
                                                    blob: blob,
                                                    history: []
                                                };

                                                // Add to database and state
                                                await this.dbPut('pages', pageObj);
                                                this.state.images.push(pageObj);
                                                console.log(`Fetched and added page ${i} from base file`);
                                            }
                                        }
                                    }
                                } catch (err) {
                                    console.error(`Error fetching page ${i} from backend:`, err);
                                }
                            }
                        }
                    }
                }

                // Sort pages by index again after adding any missing pages
                this.state.images.sort((a, b) => a.pageIndex - b.pageIndex);

                console.log(`Loaded ${this.state.images.length} pages from DB.`);
                const pageTotal = this.getElement('pageTotal');
                if (pageTotal) pageTotal.innerText = '/ ' + this.state.images.length;

                if (this.state.images.length === 0) {
                    // Try to fetch base from server if pages are missing
                    this.retryBaseFetch();
                }

                if (this.state.activeSideTab === 'pages') this.renderPageSidebar();

                // Only load page 0 if we don't have a current page loaded or if the current page is out of bounds
                if (this.state.images.length > 0) {
                    if (!this.cache.currentImg || this.state.idx >= this.state.images.length) {
                        // Adjust current page index if it's out of bounds
                        if (this.state.idx >= this.state.images.length) {
                            this.state.idx = Math.max(0, this.state.images.length - 1);
                        }
                        this.loadPage(this.state.idx, false);
                    }
                }
                resolve();
            };
            q.onerror = (e) => reject(e);
        });
    },

    async importBaseFile(blob) {
        // Simulates a file input event to reuse existing handleImport logic
        const file = new File([blob], "base_document_blob", {
            type: blob.type
        });
        await this.handleImport({
            target: {
                files: [file]
            }
        }, true); // Pass true to skip upload
    },

    async computeFileHash(file) {
        if (!window.crypto || !window.crypto.subtle) return null;
        try {
            const buffer = await file.arrayBuffer();
            const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
            console.warn("Hash calculation failed", e);
            return null;
        }
    },

    async handleImport(e, skipUpload = false, lazy = false) {
        const files = e.target.files;
        if (!files || !files.length) return;

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
                        const loadExisting = await this.ui.showConfirm(
                            "Duplicate PDF",
                            `This PDF already exists as "${existing.name}". Load it instead?`
                        );
                        if (loadExisting) {
                            this.switchProject(existing.ownerId || this.liveSync?.userId || 'local', existing.id);
                            return;
                        }
                    }
                }
            } catch (err) {
                console.error("Hash check error:", err);
            }
        }

        this.isUploading = true; // Set flag

        const nameInput = this.getElement('newProjectName');
        let pName = (nameInput && nameInput.value.trim());

        console.log(`[Import] Initial pName from input: "${pName}"`);
        console.log(`[Import] Files length: ${files.length}, Bulk: ${this.isBulkImporting}`);

        // Priority: 1. Manual Input (only if single file and NOT bulk importing), 2. File Name, 3. Fallback
        // Reset name for bulk imports to avoid carrying over previous project names
        if (!pName || files.length > 1 || this.isBulkImporting) {
            pName = files[0].name.replace(/\.[^/.]+$/, "");
            console.log(`[Import] Derived pName from file: "${pName}"`);
            if (pName.includes("base_document_blob")) {
                console.log(`[Import] Detected base blob. Current project name: "${this.state.projectName}"`);
                // Only overwrite if we don't have a valid project name already
                if (this.state.projectName && this.state.projectName !== "Untitled" && this.state.projectName !== "Untitled Project") {
                    pName = this.state.projectName;
                    console.log(`[Import] Preserving existing name: "${pName}"`);
                } else {
                    pName = "Untitled Project";
                    console.log(`[Import] Fallback to Untitled Project (no valid existing name)`);
                }
            }
        }
        if (!pName || pName === "Untitled") {
            pName = "Untitled Project";
            console.log(`[Import] Final fallback to Untitled Project`);
        }

        console.log(`[Import] FINAL pName to be used: "${pName}"`);

        // --- CRITICAL: FORCE UNIQUE PROJECT FOR EVERY NEW UPLOAD ---
        const localUserId = this.liveSync?.userId || 'local';
        if (!skipUpload) {
            const newProjectId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            console.log("ColorRM: Forcing new unique project key for upload:", newProjectId);
            // Pass lazy as skipSync to avoid connecting to room during bulk import
            await this.createNewProject(false, newProjectId, localUserId, pName, lazy);
        } else if (!this.state.sessionId) {
            // Sync case: only create if missing (Legacy support)
            await this.createNewProject(false, this.state.sessionId, this.liveSync?.ownerId || localUserId, pName, lazy);
        }

        this.ui.hideDashboard();
        this.ui.toggleLoader(true, "Initializing...");

        // --- Sync to Server ---
        if (!skipUpload && this.state.sessionId) {
            console.log('ColorRM Sync: Uploading base file to server for ID:', this.state.sessionId);
            this.ui.toggleLoader(true, "Uploading to server...");
            try {
                const uploadRes = await fetch(window.Config?.apiUrl(`/api/color_rm/upload/${this.state.sessionId}`) || `/api/color_rm/upload/${this.state.sessionId}`, {
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
                    this.ui.showToast("Upload failed - collaborators won't see background");
                }
            } catch (err) {
                console.error('ColorRM Sync: Error uploading base file:', err);
                this.ui.showToast("Network error - collaboration limited");
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
        if (session) {
            session.name = pName;
            session.baseFileName = this.state.baseFileName;
            session.ownerId = this.state.ownerId;
            // Keep existing folder if updating, or assign current if new
            if (!session.folderId && this.state.currentFolderId) {
                session.folderId = this.state.currentFolderId;
            }
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
                idx: 0,
                bookmarks: [],
                clipboardBox: [],
                ownerId: this.state.ownerId,
                fileHash: fileHash,
                folderId: this.state.currentFolderId || null // Assign current folder
            });
        }

        if (lazy) {
            // If lazy, we just get page count and stop
            let pageCount = 1;
            if (files[0].type.includes('pdf')) {
                try {
                    const d = await files[0].arrayBuffer();
                    const pdf = await pdfjsLib.getDocument(d).promise;
                    pageCount = pdf.numPages;
                } catch (e) {
                    console.error("PDF metadata failed", e);
                }
            }

            const session = await this.dbGet('sessions', this.state.sessionId);
            if (session) {
                session.pageCount = pageCount;
                await this.dbPut('sessions', session);
                if (this.registry) this.registry.upsert(session);
            }
            this.isUploading = false;
            this.ui.toggleLoader(false);
            return;
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
                if (processQueue.length === 0) {
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
                if (f.type.includes('pdf')) {
                    try {
                        const d = await f.arrayBuffer();
                        const pdf = await pdfjsLib.getDocument(d).promise;
                        for (let i = 1; i <= pdf.numPages; i += BATCH_SIZE) {
                            const batch = [];
                            for (let j = 0; j < BATCH_SIZE && (i + j) <= pdf.numPages; j++) {
                                const pNum = i + j;
                                batch.push(pdf.getPage(pNum).then(async page => {
                                    const v = page.getViewport({
                                        scale: 1.5
                                    }); // Increased scale for higher quality
                                    const cvs = document.createElement('canvas');
                                    cvs.width = v.width;
                                    cvs.height = v.height;
                                    await page.render({
                                        canvasContext: cvs.getContext('2d'),
                                        viewport: v
                                    }).promise;
                                    const b = await new Promise(r => cvs.toBlob(r, 'image/jpeg', 0.9)); // Higher quality JPEG
                                    const pageObj = {
                                        id: `${this.state.sessionId}_${idx+j}`,
                                        sessionId: this.state.sessionId,
                                        pageIndex: idx + j,
                                        blob: b,
                                        history: []
                                    };
                                    await this.dbPut('pages', pageObj);
                                    return pageObj;
                                }));
                            }
                            const results = await Promise.all(batch);

                            // INCREMENTAL UPDATE: Add results to state and update UI
                            this.state.images.push(...results);
                            this.state.images.sort((a, b) => a.pageIndex - b.pageIndex);

                            if (this.state.images.length > 0 && !this.cache.currentImg) {
                                await this.loadPage(0, false); // Load first page as soon as it's ready
                            }

                            if (this.state.activeSideTab === 'pages') this.renderPageSidebar();
                            const pt = this.getElement('pageTotal');
                            if (pt) pt.innerText = '/ ' + this.state.images.length;

                            idx += results.length;
                            this.ui.updateProgress(((i / pdf.numPages) * 100), `Processing Page ${i}/${pdf.numPages}`);
                            await new Promise(r => setTimeout(r, 0));
                        }
                    } catch (e) {
                        console.error(e);
                        this.ui.showToast("Failed to load PDF");
                    }
                } else {
                    const pageObj = {
                        id: `${this.state.sessionId}_${idx}`,
                        sessionId: this.state.sessionId,
                        pageIndex: idx,
                        blob: f,
                        history: []
                    };
                    await this.dbPut('pages', pageObj);
                    this.state.images.push(pageObj);
                    if (this.state.images.length === 1) await this.loadPage(0, false);
                    if (this.state.activeSideTab === 'pages') this.renderPageSidebar();
                    idx++;
                }
                processNext();
            };
            processNext();
        });
    },

    async createNewProject(openPicker = true, forceId = null, forceOwnerId = null, initialName = null, skipSync = false) {
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
        const name = initialName || (nameInput && nameInput.value) || "Untitled";
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
        if (this.state.activeSideTab === 'pages') this.renderPageSidebar();

        const c = this.getElement('canvas');
        if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
        // ----------------------------

        this.ui.setSyncStatus('new');

        if (openPicker) {
            const fileIn = this.getElement('fileIn');
            if (fileIn) fileIn.click();
        }

        // Initialize LiveSync with the Owner's Room and this Project Key
        if (this.liveSync && !skipSync) {
            await this.liveSync.init(ownerId, projectId);
        }
    },

    async reuploadBaseFile() {
        if (this.state.images.length > 0 && this.state.images[0].blob) {
            this.ui.showToast("Re-uploading base...");
            try {
                await fetch(window.Config?.apiUrl(`/api/color_rm/upload/${this.state.sessionId}`) || `/api/color_rm/upload/${this.state.sessionId}`, {
                    method: 'POST',
                    body: this.state.images[0].blob,
                    headers: {
                        'Content-Type': this.state.images[0].blob.type
                    }
                });
                this.ui.showToast("Base file restored!");
            } catch (e) {
                this.ui.showToast("Restore failed");
            }
        } else {
            this.ui.showToast("No local file to upload");
        }
    },

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
            // Final fallback: show URL in custom prompt
            this.ui.showAlert("Share URL", shareUrl);
        }
    },

    async addBlankPage(width = 2000, height = 1500, insertAtCurrent = false) {
        // Get the selected color from the color picker
        const colorPicker = document.getElementById('blankPageColor');
        const bgColor = colorPicker ? colorPicker.value : '#ffffff';

        // Create a blank canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Fill with selected background color
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, width, height);

        // Convert to high-quality blob
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95)); // Higher quality

        // Determine where to insert the page
        let newPageIndex;
        if (insertAtCurrent) {
            newPageIndex = this.state.idx + 1; // Insert after current page
        } else {
            newPageIndex = this.state.images.length; // Append at the end
        }

        // Create page object
        const pageObj = {
            id: `${this.state.sessionId}_${newPageIndex}`,
            sessionId: this.state.sessionId,
            pageIndex: newPageIndex,
            blob: blob,
            history: []
        };

        // Update all existing pages that come after the insertion point
        for (let i = newPageIndex; i < this.state.images.length; i++) {
            this.state.images[i].pageIndex = i + 1;
            this.state.images[i].id = `${this.state.sessionId}_${i + 1}`;
            await this.dbPut('pages', this.state.images[i]);
        }

        // Insert the new page at the correct position
        this.state.images.splice(newPageIndex, 0, pageObj);
        await this.dbPut('pages', pageObj);

        // Update UI
        if (this.state.activeSideTab === 'pages') this.renderPageSidebar();
        const pt = this.getElement('pageTotal');
        if (pt) pt.innerText = '/ ' + this.state.images.length;

        // Navigate to the new page if inserting at current
        if (insertAtCurrent) {
            await this.loadPage(newPageIndex);
        } else {
            // If appending, stay on current page but update the total
            if (this.state.idx >= newPageIndex) {
                // If we inserted before or at the current page, update current index
                this.state.idx++;
            }
            // Update page input to reflect current page
            const pageInput = this.getElement('pageInput');
            if (pageInput) pageInput.value = this.state.idx + 1;
        }

        // Update session metadata
        const session = await this.dbGet('sessions', this.state.sessionId);
        if (session) {
            session.pageCount = this.state.images.length;
            session.idx = this.state.idx; // Update current page index in session
            await this.dbPut('sessions', session);
            if (this.registry) this.registry.upsert(session);
        }

        // Upload page image to backend if in collaborative mode
        if (this.config.collaborative && this.state.ownerId) {
            try {
                const uploadRes = await fetch(window.Config?.apiUrl(`/api/color_rm/page_upload/${this.state.sessionId}/${newPageIndex}`) || `/api/color_rm/page_upload/${this.state.sessionId}/${newPageIndex}`, {
                    method: 'POST',
                    body: blob,
                    headers: {
                        'Content-Type': 'image/jpeg',
                        'x-project-name': encodeURIComponent(this.state.projectName)
                    }
                });

                if (uploadRes.ok) {
                    // Synchronize with Liveblocks - send page count and potentially page data
                    if (this.liveSync) {
                        // Update the page count in metadata
                        this.liveSync.updatePageCount(this.state.images.length);
                        // Update presence to notify other users about the page structure change
                        this.liveSync.notifyPageStructureChange();
                    }

                    this.ui.showToast(`Added blank page ${newPageIndex + 1} ✓ Synced`);
                } else {
                    console.error('Page upload failed:', await uploadRes.text());
                    this.ui.showToast(`Added blank page ${newPageIndex + 1} ⚠ Upload failed`);
                }
            } catch (err) {
                console.error('Error uploading page image:', err);
                this.ui.showToast(`Added blank page ${newPageIndex + 1} ⚠ Upload failed`);
            }
        } else {
            // Synchronize with Liveblocks - send page count and potentially page data
            if (this.liveSync) {
                // Update the page count in metadata
                this.liveSync.updatePageCount(this.state.images.length);
                // Update presence to notify other users about the page structure change
                this.liveSync.notifyPageStructureChange();
            }

            this.ui.showToast(`Added blank page ${newPageIndex + 1} (Local)`);
        }

        // Update canvas dimensions to match new page size
        const canvas = this.getElement('canvas');
        if (canvas) {
            canvas.width = width;
            canvas.height = height;
            // Update the view dimensions as well
            this.state.viewW = width;
            this.state.viewH = height;
        }
    },

    async addImageAsPage(file, insertAtCurrent = false) {
        const img = new Image();
        img.src = URL.createObjectURL(file);

        await new Promise(resolve => {
            img.onload = resolve;
        });

        // Create canvas to ensure consistent format
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        // Convert to blob
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95)); // Higher quality

        // Determine where to insert the page
        let newPageIndex;
        if (insertAtCurrent) {
            newPageIndex = this.state.idx + 1; // Insert after current page
        } else {
            newPageIndex = this.state.images.length; // Append at the end
        }

        // Create page object
        const pageObj = {
            id: `${this.state.sessionId}_${newPageIndex}`,
            sessionId: this.state.sessionId,
            pageIndex: newPageIndex,
            blob: blob,
            history: []
        };

        // Update all existing pages that come after the insertion point
        for (let i = newPageIndex; i < this.state.images.length; i++) {
            this.state.images[i].pageIndex = i + 1;
            this.state.images[i].id = `${this.state.sessionId}_${i + 1}`;
            await this.dbPut('pages', this.state.images[i]);
        }

        // Insert the new page at the correct position
        this.state.images.splice(newPageIndex, 0, pageObj);
        await this.dbPut('pages', pageObj);

        // Update UI
        if (this.state.activeSideTab === 'pages') this.renderPageSidebar();
        const pt = this.getElement('pageTotal');
        if (pt) pt.innerText = '/ ' + this.state.images.length;

        // Navigate to the new page if inserting at current
        if (insertAtCurrent) {
            await this.loadPage(newPageIndex);
        } else {
            // If appending, stay on current page but update the total
            if (this.state.idx >= newPageIndex) {
                // If we inserted before or at the current page, update current index
                this.state.idx++;
            }
            // Update page input to reflect current page
            const pageInput = this.getElement('pageInput');
            if (pageInput) pageInput.value = this.state.idx + 1;
        }

        // Update session metadata
        const session = await this.dbGet('sessions', this.state.sessionId);
        if (session) {
            session.pageCount = this.state.images.length;
            session.idx = this.state.idx; // Update current page index in session
            await this.dbPut('sessions', session);
            if (this.registry) this.registry.upsert(session);
        }

        // Upload page image to backend if in collaborative mode
        if (this.config.collaborative && this.state.ownerId) {
            try {
                const uploadRes = await fetch(window.Config?.apiUrl(`/api/color_rm/page_upload/${this.state.sessionId}/${newPageIndex}`) || `/api/color_rm/page_upload/${this.state.sessionId}/${newPageIndex}`, {
                    method: 'POST',
                    body: blob,
                    headers: {
                        'Content-Type': 'image/jpeg',
                        'x-project-name': encodeURIComponent(this.state.projectName)
                    }
                });
                if (!uploadRes.ok) {
                    console.error('Page upload failed:', await uploadRes.text());
                }
            } catch (err) {
                console.error('Error uploading page image:', err);
            }
        }

        // Synchronize with Liveblocks - send page count and potentially page data
        if (this.liveSync) {
            // Update the page count in metadata
            this.liveSync.updatePageCount(this.state.images.length);
            // Update presence to notify other users about the page structure change
            this.liveSync.notifyPageStructureChange();
        }

        // Update canvas dimensions to match new page size
        const canvas = this.getElement('canvas');
        if (canvas) {
            canvas.width = width;
            canvas.height = height;
            // Update the view dimensions as well
            this.state.viewW = width;
            this.state.viewH = height;
        }

        this.ui.showToast(`Added image as page ${newPageIndex + 1}`);
    },

    handleImagePageUpload(event, insertAtCurrent = false) {
        const file = event.target.files[0];
        if (file && file.type.startsWith('image/')) {
            this.addImageAsPage(file, insertAtCurrent);
        }
    },

    async deleteCurrentPage() {
        if (this.state.images.length <= 1) {
            this.ui.showToast("Cannot delete the only page");
            return;
        }

        const currentPageIndex = this.state.idx;
        const confirmed = await this.ui.showConfirm(
            "Delete Page",
            `Delete page ${currentPageIndex + 1}? This cannot be undone.`
        );

        if (!confirmed) return;

        // Remove from database using existing transaction method
        const pageToDelete = this.state.images[currentPageIndex];
        const tx = this.db.transaction('pages', 'readwrite');
        tx.objectStore('pages').delete(pageToDelete.id);
        await new Promise(resolve => tx.oncomplete = resolve);

        // Remove from state
        this.state.images.splice(currentPageIndex, 1);

        // Update indices for remaining pages after the deleted page
        for (let i = currentPageIndex; i < this.state.images.length; i++) {
            this.state.images[i].pageIndex = i;
            this.state.images[i].id = `${this.state.sessionId}_${i}`;
            await this.dbPut('pages', this.state.images[i]);
        }

        // Update UI
        if (this.state.activeSideTab === 'pages') this.renderPageSidebar();
        const pt = this.getElement('pageTotal');
        if (pt) pt.innerText = '/ ' + this.state.images.length;

        // Navigate to a valid page (preferably the next one, or previous if at end)
        if (currentPageIndex >= this.state.images.length) {
            this.state.idx = Math.max(0, this.state.images.length - 1);
        }

        if (this.state.images.length > 0) {
            await this.loadPage(this.state.idx);
        } else {
            // If no pages left, clear canvas
            const canvas = this.getElement('canvas');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        }

        // Update session metadata
        const session = await this.dbGet('sessions', this.state.sessionId);
        if (session) {
            session.pageCount = this.state.images.length;
            session.idx = this.state.idx; // Update current page index in session
            await this.dbPut('sessions', session);
            if (this.registry) this.registry.upsert(session);
        }

        // Synchronize with Liveblocks
        if (this.liveSync) {
            this.liveSync.updatePageCount(this.state.images.length);
            this.liveSync.notifyPageStructureChange();
        }

        this.ui.showToast(`Deleted page ${currentPageIndex + 1}`);
    },

    showPageSizeModal() {
        const modal = document.getElementById('pageSizeModal');
        if (modal) {
            modal.style.display = 'flex';

            // Update preview with current page size
            this.updatePageSizePreview();
        }
    },

    updatePageSizePreview() {
        const preview = document.getElementById('pagePreview');
        if (!preview) return;

        // Get current page dimensions (or default)
        const width = this.state.viewW || 800;
        const height = this.state.viewH || 600;

        // Calculate aspect ratio to fit in preview container
        const maxWidth = 120;
        const maxHeight = 120;
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        const dispW = width * ratio;
        const dispH = height * ratio;

        preview.style.width = dispW + 'px';
        preview.style.height = dispH + 'px';
    },

    setPageSize(width, height) {
        this.resizeCurrentPage(width, height);
        document.getElementById('pageSizeModal').style.display = 'none';
    },

    setCustomPageSize() {
        const widthInput = document.getElementById('pageWidthInput');
        const heightInput = document.getElementById('pageHeightInput');

        const width = parseInt(widthInput.value);
        const height = parseInt(heightInput.value);

        if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
            this.ui.showToast("Please enter valid dimensions");
            return;
        }

        this.resizeCurrentPage(width, height);
        document.getElementById('pageSizeModal').style.display = 'none';
    },

    async resizeCurrentPage(newWidth, newHeight) {
        const currentPage = this.state.images[this.state.idx];
        if (!currentPage) return;

        // Create a new canvas with the new dimensions
        const canvas = document.createElement('canvas');
        canvas.width = newWidth;
        canvas.height = newHeight;
        const ctx = canvas.getContext('2d');

        // Draw the current page content onto the new canvas
        const img = new Image();
        img.src = URL.createObjectURL(currentPage.blob);

        await new Promise(resolve => {
            img.onload = () => {
                // Scale the image to fit the new dimensions (maintaining aspect ratio or stretching)
                ctx.fillStyle = '#ffffff'; // White background
                ctx.fillRect(0, 0, newWidth, newHeight);

                // Draw the original content
                ctx.drawImage(img, 0, 0, newWidth, newHeight);

                // Draw any existing drawings on top
                this.drawHistoryOntoCanvas(ctx, currentPage.history, newWidth, newHeight);

                resolve();
            };
        });

        // Convert to blob
        const newBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95)); // Higher quality

        // Update the page in state and database
        currentPage.blob = newBlob;
        await this.dbPut('pages', currentPage);

        // Update state dimensions
        this.state.viewW = newWidth;
        this.state.viewH = newHeight;

        // Update canvas dimensions to match new page size
        const canvas = this.getElement('canvas');
        if (canvas) {
            canvas.width = newWidth;
            canvas.height = newHeight;
            // Update the view dimensions as well
            this.state.viewW = newWidth;
            this.state.viewH = newHeight;
        }

        // Reload the page to reflect changes
        await this.loadPage(this.state.idx, false);

        this.ui.showToast(`Page resized to ${newWidth}×${newHeight}`);
    },

    // Helper function to draw history onto a canvas
    drawHistoryOntoCanvas(ctx, history, canvasWidth, canvasHeight) {
        // This function draws all the drawing history onto the provided canvas context
        // It scales the drawings to fit the new canvas dimensions
        history.forEach(item => {
            if (item.deleted) return;

            ctx.save();

            if (item.tool === 'pen') {
                // Scale pen strokes proportionally
                const scaleX = canvasWidth / this.state.viewW;
                const scaleY = canvasHeight / this.state.viewH;

                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.lineWidth = item.size;
                ctx.strokeStyle = item.color;

                if (item.pts && item.pts.length > 0) {
                    ctx.beginPath();
                    ctx.moveTo(item.pts[0].x * scaleX, item.pts[0].y * scaleY);
                    for (let i = 1; i < item.pts.length; i++) {
                        ctx.lineTo(item.pts[i].x * scaleX, item.pts[i].y * scaleY);
                    }
                    ctx.stroke();
                }
            } else if (item.tool === 'shape') {
                // Scale shapes proportionally
                const scaleX = canvasWidth / this.state.viewW;
                const scaleY = canvasHeight / this.state.viewH;

                ctx.strokeStyle = item.border;
                ctx.lineWidth = item.width;
                if (item.fill !== 'transparent') {
                    ctx.fillStyle = item.fill;
                }

                ctx.beginPath();
                const x = item.x * scaleX;
                const y = item.y * scaleY;
                const w = item.w * scaleX;
                const h = item.h * scaleY;

                if (item.shapeType === 'rectangle') {
                    ctx.rect(x, y, w, h);
                } else if (item.shapeType === 'circle') {
                    ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, 2 * Math.PI);
                } else if (item.shapeType === 'line') {
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + w, y + h);
                } else if (item.shapeType === 'arrow') {
                    // Draw arrow with scaled coordinates
                    const headLength = 15;
                    const angle = Math.atan2(h, w);
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + w, y + h);
                    ctx.lineTo(
                        x + w - headLength * Math.cos(angle - Math.PI / 6),
                        y + h - headLength * Math.sin(angle - Math.PI / 6)
                    );
                    ctx.moveTo(x + w, y + h);
                    ctx.lineTo(
                        x + w - headLength * Math.cos(angle + Math.PI / 6),
                        y + h - headLength * Math.sin(angle + Math.PI / 6)
                    );
                }

                if (item.fill !== 'transparent' && !['line', 'arrow'].includes(item.shapeType)) {
                    ctx.fill();
                }
                ctx.stroke();
            } else if (item.tool === 'text') {
                // Scale text proportionally
                const scaleX = canvasWidth / this.state.viewW;
                const scaleY = canvasHeight / this.state.viewH;

                ctx.fillStyle = item.color;
                ctx.font = `${item.size * Math.min(scaleX, scaleY)}px sans-serif`;
                ctx.textBaseline = 'top';
                ctx.fillText(item.text, item.x * scaleX, item.y * scaleY);
            }

            ctx.restore();
        });
    },


    async applyPageSizeToAll() {
        const widthInput = document.getElementById('pageWidthInput');
        const heightInput = document.getElementById('pageHeightInput');

        let width, height;
        if (widthInput.value && heightInput.value) {
            width = parseInt(widthInput.value);
            height = parseInt(heightInput.value);
        } else {
            // Use current page size as default
            width = this.state.viewW || 2000;
            height = this.state.viewH || 1500;
        }

        if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
            this.ui.showToast("Please enter valid dimensions");
            return;
        }

        this.ui.showToast(`Resizing all ${this.state.images.length} pages...`);

        // Process each page sequentially to avoid overwhelming the system
        for (let i = 0; i < this.state.images.length; i++) {
            this.ui.updateProgress((i / this.state.images.length) * 100, `Resizing page ${i + 1}/${this.state.images.length}...`);

            const page = this.state.images[i];
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            // Draw the original page content
            const img = new Image();
            img.src = URL.createObjectURL(page.blob);

            await new Promise(resolve => {
                img.onload = () => {
                    // Draw with white background
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, width, height);

                    // Draw original content scaled to new dimensions
                    ctx.drawImage(img, 0, 0, width, height);

                    // Draw history scaled to new dimensions
                    this.drawHistoryOntoCanvas(ctx, page.history, width, height);

                    resolve();
                };
            });

            // Convert to blob and update page
            const newBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
            page.blob = newBlob;
            await this.dbPut('pages', page);

            // If this is the current page, update the display
            if (i === this.state.idx) {
                this.state.viewW = width;
                this.state.viewH = height;
            }
        }

        // Update canvas dimensions to match new page size
        const canvas = this.getElement('canvas');
        if (canvas) {
            canvas.width = width;
            canvas.height = height;
            // Update the view dimensions as well
            this.state.viewW = width;
            this.state.viewH = height;
        }

        // Reload current page to reflect changes
        await this.loadPage(this.state.idx, false);

        this.ui.showToast(`All ${this.state.images.length} pages resized to ${width}×${height}`);
    },

    async addTemplatePage(templateType) {
        // Get the selected color from the color picker
        const colorPicker = document.getElementById('blankPageColor');
        const bgColor = colorPicker ? colorPicker.value : '#ffffff';

        // Define dimensions for the page
        const width = 800;
        const height = 1000;

        // Create a canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Fill with the selected background color
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, width, height);

        // Add template-specific elements
        if (templateType === 'graph') {
            // Draw graph paper pattern
            ctx.strokeStyle = '#e0e0e0';
            ctx.lineWidth = 0.5;

            // Vertical lines
            for (let x = 0; x <= width; x += 20) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
            }

            // Horizontal lines
            for (let y = 0; y <= height; y += 20) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }
        } else if (templateType === 'lined') {
            // Draw lined paper pattern
            ctx.strokeStyle = '#e0e0e0';
            ctx.lineWidth = 0.5;

            // Horizontal lines every 30 pixels
            for (let y = 30; y <= height; y += 30) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }

            // Margin line at 60px from left
            ctx.strokeStyle = '#f0f0f0';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(60, 0);
            ctx.lineTo(60, height);
            ctx.stroke();
        }
        // For 'white' template, we just have a plain background

        // Convert to blob - this returns a Promise
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95)); // Higher quality

        // Determine where to insert the page
        const newPageIndex = this.state.images.length; // Always append for templates

        // Create page object
        const pageObj = {
            id: `${this.state.sessionId}_${newPageIndex}`,
            sessionId: this.state.sessionId,
            pageIndex: newPageIndex,
            blob: blob,
            history: []
        };

        // Update all existing pages that come after the insertion point
        for (let i = newPageIndex; i < this.state.images.length; i++) {
            this.state.images[i].pageIndex = i + 1;
            this.state.images[i].id = `${this.state.sessionId}_${i + 1}`;
            await this.dbPut('pages', this.state.images[i]);
        }

        // Insert the new page at the correct position
        this.state.images.splice(newPageIndex, 0, pageObj);
        await this.dbPut('pages', pageObj);

        // Update UI
        if (this.state.activeSideTab === 'pages') this.renderPageSidebar();
        const pt = this.getElement('pageTotal');
        if (pt) pt.innerText = '/ ' + this.state.images.length;

        // Stay on current page but update the total
        if (this.state.idx >= newPageIndex) {
            // If we inserted before or at the current page, update current index
            this.state.idx++;
        }
        // Update page input to reflect current page
        const pageInput = this.getElement('pageInput');
        if (pageInput) pageInput.value = this.state.idx + 1;

        // Update session metadata
        const session = await this.dbGet('sessions', this.state.sessionId);
        if (session) {
            session.pageCount = this.state.images.length;
            session.idx = this.state.idx; // Update current page index in session
            await this.dbPut('sessions', session);
            if (this.registry) this.registry.upsert(session);
        }

        // Upload page image to backend if in collaborative mode
        if (this.config.collaborative && this.state.ownerId) {
            try {
                const uploadRes = await fetch(window.Config?.apiUrl(`/api/color_rm/page_upload/${this.state.sessionId}/${newPageIndex}`) || `/api/color_rm/page_upload/${this.state.sessionId}/${newPageIndex}`, {
                    method: 'POST',
                    body: blob,
                    headers: {
                        'Content-Type': 'image/jpeg',
                        'x-project-name': encodeURIComponent(this.state.projectName)
                    }
                });
                if (!uploadRes.ok) {
                    console.error('Page upload failed:', await uploadRes.text());
                }
            } catch (err) {
                console.error('Error uploading template page image:', err);
            }
        }

        // Synchronize with Liveblocks - send page count and potentially page data
        if (this.liveSync) {
            // Update the page count in metadata
            this.liveSync.updatePageCount(this.state.images.length);
            // Update presence to notify other users about the page structure change
            this.liveSync.notifyPageStructureChange();
        }

        // Update canvas dimensions to match new page size
        const canvas = this.getElement('canvas');
        if (canvas) {
            canvas.width = width;
            canvas.height = height;
            // Update the view dimensions as well
            this.state.viewW = width;
            this.state.viewH = height;
        }

        this.ui.showToast(`Added ${templateType} template page ${newPageIndex + 1}`);
    },

    reorderPages(fromIndex, toIndex) {
        if (fromIndex < 0 || toIndex < 0 ||
            fromIndex >= this.state.images.length ||
            toIndex >= this.state.images.length) {
            return;
        }

        // Reorder in state
        const page = this.state.images.splice(fromIndex, 1)[0];
        this.state.images.splice(toIndex, 0, page);

        // Update page indices
        this.state.images.forEach((img, idx) => {
            img.pageIndex = idx;
            // Update the ID to reflect new index
            img.id = `${this.state.sessionId}_${idx}`;
        });

        // Update database
        const promises = this.state.images.map(img => this.dbPut('pages', img));
        Promise.all(promises).then(() => {
            this.ui.showToast("Pages reordered");
            if (this.state.activeSideTab === 'pages') this.renderPageSidebar();

            // Synchronize with Liveblocks
            if (this.liveSync) {
                // Update the page count in metadata
                this.liveSync.updatePageCount(this.state.images.length);
                // Update presence to notify other users about the page structure change
                this.liveSync.notifyPageStructureChange();
            }
        });
    }
}; 
