
export const Registry = {
    // App instance reference - set by the main app during initialization
    app: null,

    // Track recently deleted items to avoid re-syncing them (KV eventual consistency workaround)
    recentlyDeleted: new Set(),

    setApp(appInstance) {
        this.app = appInstance;
        // Load recently deleted from localStorage
        try {
            const deleted = JSON.parse(localStorage.getItem('crm_recently_deleted') || '[]');
            // Only keep items deleted in the last 5 minutes
            const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
            const valid = deleted.filter(d => d.time > fiveMinutesAgo);
            this.recentlyDeleted = new Set(valid.map(d => d.id));
            localStorage.setItem('crm_recently_deleted', JSON.stringify(valid));
        } catch (e) {
            this.recentlyDeleted = new Set();
        }
    },

    markAsDeleted(id) {
        this.recentlyDeleted.add(id);
        try {
            const deleted = JSON.parse(localStorage.getItem('crm_recently_deleted') || '[]');
            deleted.push({ id, time: Date.now() });
            localStorage.setItem('crm_recently_deleted', JSON.stringify(deleted));
        } catch (e) {}
    },

    getApp() {
        // Fallback to window.App for backwards compatibility
        return this.app || window.App;
    },

    getToken() { return localStorage.getItem('tldraw_auth_token'); },
    getUsername() { return localStorage.getItem('tldraw_auth_username'); },

    // Helper to get API URL (supports bundled mode)
    apiUrl(path) {
        return window.Config ? window.Config.apiUrl(path) : path;
    },

    async sync() {
        const token = this.getToken();
        if (!token) return; // Anonymous users don't sync registry

        try {
            // 1. Fetch Cloud Registry
            const res = await fetch(this.apiUrl('/api/color_rm/registry'), {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) {
                if (res.status === 401) {
                    console.warn("Registry: Auth token invalid/expired, skipping sync.");
                    return; // Silent fail for expired tokens
                }
                throw new Error("Registry fetch failed");
            }
            const data = await res.json();
            console.log('Registry Sync Data:', data);

            const cloudProjects = data.projects || [];
            const cloudFolders = data.folders || [];

            // Filter out recently deleted items (KV eventual consistency workaround)
            const filteredProjects = cloudProjects.filter(p => !this.recentlyDeleted.has(p.id));
            const filteredFolders = cloudFolders.filter(f => !this.recentlyDeleted.has(f.id));

            if (filteredProjects.length !== cloudProjects.length) {
                console.log(`Registry: Filtered out ${cloudProjects.length - filteredProjects.length} recently deleted projects`);
            }

            const cloudIds = new Set(filteredProjects.map(p => p.id));
            const cloudFolderIds = new Set(filteredFolders.map(f => f.id));

            // 2. Merge into Local DB
            const app = this.getApp();
            if (!app || !app.db) {
                console.warn("Registry: App DB not ready.");
                return;
            }

            // --- SYNC SESSIONS (use separate transaction) ---
            const localSessions = await new Promise((resolve) => {
                const tx = app.db.transaction('sessions', 'readonly');
                const r = tx.objectStore('sessions').getAll();
                r.onsuccess = () => resolve(r.result || []);
                r.onerror = () => resolve([]);
            });

            const localMap = new Map(localSessions.map(p => [p.id, p]));

            for (const cp of filteredProjects) {
                const local = localMap.get(cp.id);

                if (!local) {
                    // New project from cloud (metadata only)
                    await app.dbPut('sessions', {
                        id: cp.id,
                        name: cp.name,
                        pageCount: cp.pageCount,
                        lastMod: cp.lastMod,
                        ownerId: cp.ownerId,
                        baseFileName: cp.baseFileName,
                        idx: 0,
                        bookmarks: [],
                        clipboardBox: [],
                        state: null,
                        folderId: cp.folderId || null, // Sync folderId
                        isCloudBackedUp: true
                    });
                } else {
                    // Update existing
                    let changed = false;
                    if (cp.lastMod > (local.lastMod || 0)) {
                        local.name = cp.name;
                        local.pageCount = cp.pageCount;
                        local.lastMod = cp.lastMod;
                        local.ownerId = cp.ownerId;
                        local.folderId = cp.folderId || null; // Update folderId
                        changed = true;
                    }
                    // Mark as backed up
                    if (!local.isCloudBackedUp) {
                        local.isCloudBackedUp = true;
                        changed = true;
                    }

                    if (changed) await app.dbPut('sessions', local);
                }
            }

            // --- SYNC FOLDERS (use separate transaction) ---
            const localFolders = await new Promise(r => {
                const tx = app.db.transaction('folders', 'readonly');
                const req = tx.objectStore('folders').getAll();
                req.onsuccess = () => r(req.result || []);
                req.onerror = () => r([]);
            });
            const localFolderMap = new Map(localFolders.map(f => [f.id, f]));

            for (const cf of filteredFolders) {
                const lf = localFolderMap.get(cf.id);
                if (!lf) {
                    await app.dbPut('folders', cf);
                } else {
                    // Simple overwrite for now (last write wins on server usually)
                    await app.dbPut('folders', cf);
                }
            }
            // --------------------

            // --- Clean up local projects that were deleted from cloud ---
            // Only do this for projects owned by this user
            const userId = localStorage.getItem('color_rm_user_id') || (app.liveSync && app.liveSync.userId);

            for (const [id, local] of localMap) {
                // If project was synced to cloud but now missing, delete locally
                if (local.isCloudBackedUp && !cloudIds.has(id)) {
                    // Verify ownership before deleting
                    if (local.ownerId === userId) {
                        console.log("Registry: Removing orphaned local project:", id);
                        // Delete session
                        await new Promise(r => {
                            const tx = app.db.transaction('sessions', 'readwrite');
                            tx.objectStore('sessions').delete(id);
                            tx.oncomplete = () => r();
                            tx.onerror = () => r();
                        });
                        // Delete pages
                        try {
                            const tx = app.db.transaction('pages', 'readwrite');
                            const store = tx.objectStore('pages');
                            const index = store.index('sessionId');
                            const pages = await new Promise(r => {
                                const req = index.getAll(id);
                                req.onsuccess = () => r(req.result || []);
                                req.onerror = () => r([]);
                            });
                            pages.forEach(pg => store.delete(pg.id));
                        } catch (e) {}
                    }
                }
            }

        } catch (e) {
            console.warn("Registry sync error:", e);
        }
    },

    async upsert(project) {
        const token = this.getToken();
        if (!token) return;

        // Prepare lightweight metadata object
        const payload = {
            id: project.id,
            name: project.name,
            pageCount: project.pageCount,
            lastMod: project.lastMod,
            ownerId: project.ownerId,
            baseFileName: project.baseFileName,
            folderId: project.folderId || null
        };

        fetch(this.apiUrl('/api/color_rm/registry'), {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ project: payload })
        })
        .then(res => {
            if (res.status === 401) {
                console.warn("Registry: Auth token expired on upsert.");
                return;
            }
            if (res.ok) {
                // Mark as backed up locally
                const app = this.getApp();
                if (app && app.dbGet) {
                    app.dbGet('sessions', project.id).then(s => {
                        if (s) {
                            s.isCloudBackedUp = true;
                            app.dbPut('sessions', s).then(() => {
                                // Refresh list if dashboard is open
                                if(document.getElementById('dashboardModal') && document.getElementById('dashboardModal').style.display === 'flex') {
                                    app.loadSessionList();
                                }
                            });
                        }
                    });
                }
            }
        })
        .catch(e => console.warn("Registry upsert failed:", e));
    },

    async saveFolder(folder) {
        const token = this.getToken();
        if (!token) return;
        
        // Payload for folder update
        const payload = {
             id: folder.id,
             name: folder.name,
             parentId: folder.parentId || null,
             ownerId: folder.ownerId
        };

        fetch(this.apiUrl('/api/color_rm/registry/folder'), {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ folder: payload })
        }).catch(e => console.warn("Folder save failed:", e));
    },

    async deleteFolder(folderId) {
        const token = this.getToken();
        if (!token) return;

        // Mark as deleted locally FIRST to prevent re-sync
        this.markAsDeleted(folderId);

        try {
            const res = await fetch(this.apiUrl(`/api/color_rm/registry/folder/${folderId}`), {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                console.log("Registry: Folder deleted from cloud:", folderId);
            }
        } catch (e) {
            console.warn("Folder delete failed:", e);
        }
    },

    async delete(projectId) {
        const token = this.getToken();
        if (!token) return;

        // Mark as deleted locally FIRST to prevent re-sync
        this.markAsDeleted(projectId);

        try {
            // 1. Delete from registry (KV)
            const res = await fetch(this.apiUrl(`/api/color_rm/registry/${projectId}`), {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.status === 401) {
                console.warn("Registry: Auth token expired on delete.");
            } else if (res.ok) {
                console.log("Registry: Project deleted from cloud registry:", projectId);
            }

            // 2. Delete base file from R2 bucket
            const baseRes = await fetch(this.apiUrl(`/api/color_rm/base_file/${projectId}`), {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (baseRes.ok) {
                console.log("Registry: Base file deleted from R2:", projectId);
            }
        } catch (e) {
            console.warn("Registry delete failed:", e);
        }
    }
};
