
export const Registry = {
    // App instance reference - set by the main app during initialization
    app: null,

    setApp(appInstance) {
        this.app = appInstance;
    },

    getApp() {
        // Fallback to window.App for backwards compatibility
        return this.app || window.App;
    },

    getToken() { return localStorage.getItem('tldraw_auth_token'); },
    getUsername() { return localStorage.getItem('tldraw_auth_username'); },

    async sync() {
        const token = this.getToken();
        if (!token) return; // Anonymous users don't sync registry

        try {
            // 1. Fetch Cloud Registry
            const res = await fetch('/api/color_rm/registry', {
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
            console.log('Cloud Projects:', cloudProjects);
            const cloudIds = new Set(cloudProjects.map(p => p.id));

            // 2. Merge into Local DB
            const app = this.getApp();
            if (!app || !app.db) {
                console.warn("Registry: App DB not ready.");
                return;
            }

            const tx = app.db.transaction('sessions', 'readwrite');
            const store = tx.objectStore('sessions');

            // Get all local first to compare
            const localRequest = await new Promise((resolve) => {
                const r = store.getAll();
                r.onsuccess = () => resolve(r.result);
            });

            const localMap = new Map(localRequest.map(p => [p.id, p]));

            for (const cp of cloudProjects) {
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

            // Optional: Mark locals as NOT backed up if they are missing from cloud list?
            // Only do this if we are sure the list is complete.
            const userId = localStorage.getItem('color_rm_user_id') || (app.liveSync && app.liveSync.userId);

            for (const [id, local] of localMap) {
                if (local.isCloudBackedUp && !cloudIds.has(id)) {
                     // Verify ownership before unmarking
                     if (local.ownerId === userId) {
                         local.isCloudBackedUp = false;
                         await app.dbPut('sessions', local);
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
            baseFileName: project.baseFileName
        };

        fetch('/api/color_rm/registry', {
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

    async delete(projectId) {
        const token = this.getToken();
        if (!token) return;

        fetch(`/api/color_rm/registry/${projectId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => {
            if (res.status === 401) {
                console.warn("Registry: Auth token expired on delete.");
            }
        })
        .catch(e => console.warn("Registry delete failed:", e));
    }
};
