// public/color_rm_sync.js

const SYNC = {
    socket: null,
    roomId: null,
    sessionId: localStorage.getItem('color_rm_session_id') || `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    isRemoteChange: false,
    isInitializing: true,
    sendQueue: [], // Buffer for updates during init

    async init() {
        // Failsafe: If no full-sync received in 5s, force init complete
        setTimeout(() => {
            if (this.isInitializing) {
                console.warn("ColorRM Sync: Initialization timeout. Forcing ready state.");
                this.isInitializing = false;
                this.flushQueue();
            }
        }, 5000);

        if (!localStorage.getItem('color_rm_session_id')) {
            localStorage.setItem('color_rm_session_id', this.sessionId);
        }

        // 1. Extract room ID from URL hash
        const hash = window.location.hash.substring(1);
        // Supports both #/color_rm/ID and #/ID
        this.roomId = hash.startsWith('/color_rm/') ? hash.substring(10) : (hash.startsWith('/') ? hash.substring(1) : hash);

        if (!this.roomId) {
            // No room ID found, generate a new one
            this.roomId = `color_rm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
            window.location.hash = `/color_rm/${this.roomId}`
            console.log('ColorRM Sync: Generated new room ID:', this.roomId)
        } else {
            console.log('ColorRM Sync: Joining room:', this.roomId)
            
            // 2. Check local DB first to avoid re-downloading/processing
            const sessionExists = await App.dbGet('sessions', this.roomId);
            
            if (sessionExists) {
                 console.log('ColorRM Sync: Session exists locally. Skipping base file download.');
            } else {
                // 3. Try to fetch the base file from the server
                try {
                    const res = await fetch(`/api/color_rm/base_file/${this.roomId}`);
                    if (res.ok) {
                        console.log('ColorRM Sync: Found base file on server. Importing...');
                        const blob = await res.blob();
                        await App.importBaseFile(blob);
                    } else {
                        console.log('ColorRM Sync: No base file found on server (might be the first user).');
                    }
                } catch (e) {
                    console.error('ColorRM Sync: Error fetching base file:', e);
                }
            }
        }

        // 3. Connect to WebSocket for real-time history sync
        this.connect();
    },

    connect() {
        const url = new URL(window.location.href)
        const wsProtocol = url.protocol === 'https:' ? 'wss' : 'ws'
        const wsUrl = `${wsProtocol}://${url.host}/api/color_rm/connect/${this.roomId}?sessionId=${this.sessionId}`

        this.socket = new WebSocket(wsUrl)

        this.socket.addEventListener('open', () => {
            console.log('ColorRM Sync: Connected!')
        })

        this.socket.addEventListener('message', async (event) => {
            try {
                const message = JSON.parse(event.data)
                this.isRemoteChange = true

                if (message.type === 'full-sync' || message.type === 'state-update') {
                    console.log(`ColorRM Sync: Received ${message.type}.`);
                    
                    // If images are missing (e.g. reload race), try to ensure session is open
                    if (!App.state.images || App.state.images.length === 0) {
                         console.warn("ColorRM Sync: App.state.images is empty! Attempting fallback openSession...");
                         if (this.roomId) await App.openSession(this.roomId);
                    }

                    // 1. Apply History Map to Images (Merge Strategy)
                    if (message.state.history_map) {
                        const pagesWithHistory = Object.keys(message.state.history_map);
                        
                        if (App.state.images) {
                            pagesWithHistory.forEach(pageIdx => {
                                const idx = parseInt(pageIdx);
                                const remoteHistory = message.state.history_map[pageIdx];

                                if (App.state.images[idx]) {
                                    const localHistory = App.state.images[idx].history || [];
                                    const localMap = new Map();
                                    localHistory.forEach(item => {
                                        if (item.id) localMap.set(item.id, item);
                                    });
                                    
                                    let newItemsCount = 0;
                                    let updatedItemsCount = 0;

                                    remoteHistory.forEach(remoteItem => {
                                        if (!remoteItem.id) {
                                            // Legacy fallback: Only add if history is empty
                                            if (localHistory.length === 0) localHistory.push(remoteItem);
                                            return;
                                        }

                                        const localItem = localMap.get(remoteItem.id);

                                        if (!localItem) {
                                            // New Item
                                            localHistory.push(remoteItem);
                                            localMap.set(remoteItem.id, remoteItem);
                                            newItemsCount++;
                                        } else {
                                            // Update existing item (Last-Write-Wins)
                                            const remoteTime = remoteItem.lastMod || 0;
                                            const localTime = localItem.lastMod || 0;

                                            if (remoteTime > localTime) {
                                                Object.assign(localItem, remoteItem);
                                                updatedItemsCount++;
                                            }
                                        }
                                    });
                                    
                                    if (newItemsCount > 0 || updatedItemsCount > 0) {
                                        console.log(`ColorRM Sync: Page ${idx} - Added ${newItemsCount}, Updated ${updatedItemsCount}`);
                                        // App.render() is called at end of this block globally, so no need to call here
                                    }
                                } else {
                                    console.warn(`ColorRM Sync: Received history for non-existent page ${idx}`);
                                }
                            });
                        }
                    }

                    // 2. Merge other properties
                    const { history_map, images, ...otherState } = message.state;
                    
                    const oldIdx = App.state.idx; // Capture OLD index
                    Object.assign(App.state, otherState);
                    
                    UI.hideDashboard();
                    
                    // 3. Render Updates
                    App.renderSwatches();
                    App.renderBookmarks();
                    App.updateLockUI(); // Update Lock Button visibility/text
                    
                    // Sync Page Navigation (Silent update)
                    if (message.type === 'full-sync' || (message.state.idx !== undefined && message.state.idx !== oldIdx)) {
                         if (App.state.images && App.state.images.length > 0) {
                            console.log(`ColorRM Sync: Switching to Page ${App.state.idx} (Broadcast Suppressed)`);
                            // Pass false to suppress broadcast loop
                            App.loadPage(App.state.idx || 0, false);
                        }
                    } else {
                        App.render();
                    }

                    if (message.type === 'full-sync') {
                        this.isInitializing = false;
                        console.log("ColorRM Sync: %cInitialization Complete. Sync ENABLED.", "color: green; font-weight: bold;");
                        this.flushQueue();
                    }
                }

                setTimeout(() => { this.isRemoteChange = false }, 50)

            } catch (e) {
                console.error('ColorRM Sync: Error processing message:', e)
                this.isRemoteChange = false
            }
        })

        this.socket.addEventListener('close', () => {
            console.log('ColorRM Sync: Disconnected. Reconnecting in 2s...')
            setTimeout(() => this.connect(), 2000)
        })
    },

    flushQueue() {
        if (this.sendQueue.length > 0) {
            console.log(`ColorRM Sync: Flushing ${this.sendQueue.length} buffered updates...`);
            this.sendQueue = [];
            this.sendStateUpdate();
        }
    },

    switchRoom(newId) {
        if (this.roomId === newId) return;
        console.log(`ColorRM Sync: Switching room from ${this.roomId} to ${newId}`);
        this.roomId = newId;
        window.location.hash = `/color_rm/${newId}`;
        if (this.socket) {
            this.socket.close();
        }
        // Re-init connection
        this.isInitializing = true;
        this.connect();
    },

    async sendStateUpdate() {
        if (this.isRemoteChange) return;

        if (this.isInitializing) {
            console.log("ColorRM Sync: %cBuffering update (Client initializing...)", "color: orange");
            // Debounce the queue: Only keep the latest update request
            if (this.sendQueue.length === 0) {
                 this.sendQueue.push(true);
            }
            return;
        }

        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            // Create a syncable version of the state
            const history_map = {};
            let strokeCount = 0;
            App.state.images.forEach((img, idx) => {
                history_map[idx] = img.history || [];
                strokeCount += (img.history || []).length;
            });

            console.log(`ColorRM Sync: %cBroadcasting Update. Total Strokes: ${strokeCount}`, "color: cyan");

            const stateToSend = {
                ...App.state,
                history_map: history_map
            };
            
            // Explicitly remove images array (it contains Blobs)
            delete stateToSend.images;

            this.socket.send(JSON.stringify({
                type: 'state-update',
                state: stateToSend
            }))
        }
    }
}

