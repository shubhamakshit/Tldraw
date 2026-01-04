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
        } catch(e) {
            console.error("Liveblocks: Base file fetch failed:", e);
        } finally {
            this.isFetchingBase = false;
        }
    },

    async loadSessionList() {
        const userIdEl = this.getElement('dashUserId');
        const projIdEl = this.getElement('dashProjId');
        if (userIdEl) userIdEl.innerText = this.liveSync ? this.liveSync.userId : 'local';
        if (projIdEl) projIdEl.innerText = this.state.sessionId || 'None';

        this.state.selectedSessions = new Set(); // Reset selection

        try {
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

                const userId = this.liveSync ? this.liveSync.userId : 'local';

                req.result.sort((a,b) => b.lastMod - a.lastMod).forEach(s => {
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
            };
            req.onerror = (e) => {
                console.error("Failed to load sessions:", e);
                const l = this.getElement('sessionList');
                if (l) l.innerHTML = '<div style="color:#ff4d4d;text-align:center;padding:10px">Error loading database.</div>';
            };
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
        if(!list) return;
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
    },

    async switchProject(ownerId, projectId) {
        this.ui.hideDashboard();
        window.location.hash = `/color_rm/${ownerId}/${projectId}`;
        location.reload();
    },

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
    },

    async importBaseFile(blob) {
        // Simulates a file input event to reuse existing handleImport logic
        const file = new File([blob], "base_document_blob", { type: blob.type });
        await this.handleImport({ target: { files: [file] } }, true); // Pass true to skip upload
    },

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
    },

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
                    alert(`Upload Failed: ${errTxt}\nCollaborators won't see the document background.`);
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
    },

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
    },

    async reuploadBaseFile() {
        if (this.state.images.length > 0 && this.state.images[0].blob) {
            this.ui.showToast("Re-uploading base...");
            try {
                await fetch(window.Config?.apiUrl(`/api/color_rm/upload/${this.state.sessionId}`) || `/api/color_rm/upload/${this.state.sessionId}`, {
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
            // Final fallback: show URL in prompt
            prompt("Share this URL:", shareUrl);
        }
    }
};
