import { fetchWithTimeout, TIMEOUT } from './NetworkUtils.js';

export const ColorRmStorage = {
    async dbPut(s, v) {
        return new Promise((resolve, reject) => {
            try {
                const t = this.db.transaction(s, 'readwrite');
                t.objectStore(s).put(v);
                t.oncomplete = () => resolve();
                t.onerror = (e) => {
                    console.error(`[dbPut] Error saving to ${s}:`, e.target.error);
                    reject(e.target.error);
                };
            } catch (e) {
                console.error(`[dbPut] Transaction error:`, e);
                reject(e);
            }
        });
    },

    async dbGet(s, k) {
        return new Promise((resolve, reject) => {
            try {
                const q = this.db.transaction(s, 'readonly').objectStore(s).get(k);
                q.onsuccess = () => resolve(q.result);
                q.onerror = (e) => {
                    console.error(`[dbGet] Error reading from ${s}:`, e.target.error);
                    resolve(null); // Return null on error to avoid breaking flows
                };
            } catch (e) {
                console.error(`[dbGet] Transaction error:`, e);
                resolve(null);
            }
        });
    },

    async dbGetAll(s) {
        return new Promise((resolve) => {
            try {
                const q = this.db.transaction(s, 'readonly').objectStore(s).getAll();
                q.onsuccess = () => resolve(q.result || []);
                q.onerror = (e) => {
                    console.error(`[dbGetAll] Error reading all from ${s}:`, e.target.error);
                    resolve([]);
                };
            } catch (e) {
                console.error(`[dbGetAll] Transaction error:`, e);
                resolve([]);
            }
        });
    },

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
                showCursors: this.state.showCursors,
                // SOTA preferences
                eraserType: this.state.eraserType,
                eraserOptions: this.state.eraserOptions,
                lassoOptions: this.state.lassoOptions,
                stabilization: this.state.stabilization,
                holdToShape: this.state.holdToShape,
                spenEngineEnabled: this.state.spenEngineEnabled
            };
            this.dbPut('sessions', s);
            if (this.registry) this.registry.upsert(s);
        }

        // Save Remotely (Metadata) - only if sync is enabled
        if (this.state.syncEnabled && this.liveSync && !this.liveSync.isInitializing) {
            this.liveSync.updateMetadata({
                name: this.state.projectName,
                baseFileName: this.state.baseFileName,
                idx: this.state.idx,
                pageCount: this.state.images.length,
                pageLocked: this.state.pageLocked,
                ownerId: this.state.ownerId
            });
        }
    },

    async saveCurrentImg(skipRemoteSync = false) {
        // Invalidate cache immediately since history changed in memory
        if (this.invalidateCache) this.invalidateCache();

        if(this.state.sessionId) {
            const currentPage = this.state.images[this.state.idx];
            await this.dbPut('pages', currentPage);

            // Check if sync is enabled
            if (!this.state.syncEnabled) {
                console.log('[saveCurrentImg] Sync disabled, skipping remote sync');
                return;
            }

            if (!skipRemoteSync && this.liveSync && !this.liveSync.isInitializing) {
                // If page has base history (SVG import), only sync deltas
                if (currentPage.hasBaseHistory && currentPage._baseHistory) {
                    // Extract deltas: items not in base history + modified base items
                    const baseIds = new Set(currentPage._baseHistory.map(item => item.id));
                    const deltas = [];
                    const modifications = {};

                    currentPage.history.forEach(item => {
                        if (!baseIds.has(item.id)) {
                            // New item (user scribble) - add to deltas
                            deltas.push(item);
                        } else {
                            // Item exists in base - check if modified
                            const baseItem = currentPage._baseHistory.find(b => b.id === item.id);
                            if (baseItem && this._isItemModified(baseItem, item)) {
                                // Store as modification (only changed properties)
                                modifications[item.id] = item;
                            }
                        }
                    });

                    // Also track deleted base items
                    currentPage._baseHistory.forEach(baseItem => {
                        const currentItem = currentPage.history.find(h => h.id === baseItem.id);
                        if (currentItem && currentItem.deleted && !baseItem.deleted) {
                            modifications[baseItem.id] = { id: baseItem.id, deleted: true, lastMod: currentItem.lastMod };
                        }
                    });

                    // Check if modifications are too large for Liveblocks
                    const modCount = Object.keys(modifications).length;
                    const LARGE_MODIFICATION_THRESHOLD = 100;

                    if (modCount > LARGE_MODIFICATION_THRESHOLD) {
                        // Too many modifications - use R2 instead
                        console.log(`[saveCurrentImg] ${modCount} modifications exceed threshold, using R2`);
                        await this._syncLargeModificationsToR2(currentPage, deltas, modifications);
                    } else {
                        // Sync deltas and modifications via Liveblocks
                        this.liveSync.syncPageDeltas(this.state.idx, deltas, modifications);
                    }
                } else {
                    // No base history yet - check if history is too large
                    const historySize = currentPage.history?.length || 0;
                    // Use lower threshold for SVG-imported pages (they have base history in R2)
                    // Regular pages can have more items before triggering R2 upload
                    const LARGE_HISTORY_THRESHOLD = currentPage.hasBaseHistory ? 400 : 2000;

                    if (historySize > LARGE_HISTORY_THRESHOLD && !this._r2HistoryUploading) {
                        // Too large for Liveblocks - convert to hybrid approach
                        // Only trigger once (debounced), subsequent calls will use delta sync
                        console.log(`[saveCurrentImg] History size ${historySize} exceeds threshold, converting to R2 hybrid`);
                        this._syncLargeHistoryToR2(currentPage);
                    } else if (!this._r2HistoryUploading) {
                        // Sync full history as before
                        this.liveSync.setHistory(this.state.idx, currentPage.history);
                    }
                    // Skip sync if R2 upload is in progress
                }
            }
        }
    },

    /**
     * Sync large modifications to R2 instead of Liveblocks
     * Used when modification count exceeds threshold
     * Debounced to avoid too many uploads
     */
    async _syncLargeModificationsToR2(currentPage, deltas, modifications) {
        const pageId = currentPage.pageId;
        if (!pageId || !this.state.sessionId) return;

        // Debounce R2 uploads (500ms)
        if (this._r2ModUploadTimeout) {
            clearTimeout(this._r2ModUploadTimeout);
        }

        // Store pending data
        this._pendingR2Mods = { currentPage, deltas, modifications };

        this._r2ModUploadTimeout = setTimeout(async () => {
            const { currentPage: page, deltas: d, modifications: m } = this._pendingR2Mods;
            this._pendingR2Mods = null;

            try {
                // Upload modifications to R2
                const modsUrl = window.Config?.apiUrl(`/api/color_rm/modifications/${this.state.sessionId}/${page.pageId}`)
                    || `/api/color_rm/modifications/${this.state.sessionId}/${page.pageId}`;

                const response = await fetchWithTimeout(modsUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        modifications: m,
                        timestamp: Date.now()
                    })
                }, TIMEOUT.MEDIUM);

                if (!response.ok) {
                    throw new Error(`Upload failed: ${response.status}`);
                }

                // Only sync deltas via Liveblocks (usually small)
                // Also notify that modifications are in R2
                this.liveSync.syncPageDeltas(this.state.idx, d, {});
                this.liveSync.updatePageMetadata(this.state.idx, {
                    hasR2Modifications: true,
                    r2ModTimestamp: Date.now()
                });

                console.log(`[_syncLargeModificationsToR2] Uploaded ${Object.keys(m).length} modifications to R2`);
            } catch (e) {
                console.error('[_syncLargeModificationsToR2] Failed:', e);
                this.ui.showToast('Sync failed - modifications too large');
            }
        }, 500);
    },

    /**
     * Sync large history to R2 with only a reference in Liveblocks
     * Used for pages with very many strokes
     * Debounced to avoid excessive uploads
     */
    async _syncLargeHistoryToR2(currentPage) {
        const pageId = currentPage.pageId;
        if (!pageId || !this.state.sessionId) return;

        // Prevent duplicate uploads
        if (this._r2HistoryUploading) {
            console.log('[_syncLargeHistoryToR2] Upload already in progress, skipping');
            return;
        }

        // Debounce R2 history uploads (1s)
        if (this._r2HistoryUploadTimeout) {
            clearTimeout(this._r2HistoryUploadTimeout);
        }

        this._r2HistoryUploadTimeout = setTimeout(async () => {
            // Mark as uploading to prevent duplicates
            this._r2HistoryUploading = true;

            try {
                // Upload full history to R2
                const historyUrl = window.Config?.apiUrl(`/api/color_rm/history/${this.state.sessionId}/${pageId}`)
                    || `/api/color_rm/history/${this.state.sessionId}/${pageId}`;

                const response = await fetchWithTimeout(historyUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(currentPage.history)
                }, TIMEOUT.LONG);

                if (!response.ok) {
                    throw new Error(`Upload failed: ${response.status}`);
                }

                // Mark page as having base history in R2
                currentPage.hasBaseHistory = true;
                currentPage._baseHistory = [...currentPage.history];

                // Notify via Liveblocks (metadata only)
                this.liveSync.setHistory(this.state.idx, []); // Clear Liveblocks history
                this.liveSync.updatePageMetadata(this.state.idx, {
                    hasBaseHistory: true,
                    baseHistoryCount: currentPage.history.length,
                    r2SyncTimestamp: Date.now()
                });

                console.log(`[_syncLargeHistoryToR2] Uploaded ${currentPage.history.length} items to R2`);
            } catch (e) {
                console.error('[_syncLargeHistoryToR2] Failed:', e);
                this.ui.showToast('Sync failed - history too large');
            } finally {
                this._r2HistoryUploading = false;
            }
        }, 1000);
    },

    // Check if an item has been modified from its base version
    _isItemModified(baseItem, currentItem) {
        // Check key properties that indicate modification
        if (currentItem.deleted !== baseItem.deleted) return true;
        if (currentItem.x !== baseItem.x || currentItem.y !== baseItem.y) return true;
        if (currentItem.w !== baseItem.w || currentItem.h !== baseItem.h) return true;
        if (currentItem.rotation !== baseItem.rotation) return true;

        // For pen strokes, check if points changed
        if (currentItem.pts && baseItem.pts) {
            if (currentItem.pts.length !== baseItem.pts.length) return true;
            // Quick check: compare first and last points
            if (currentItem.pts.length > 0) {
                const first = currentItem.pts[0];
                const basefirst = baseItem.pts[0];
                if (first.x !== basefirst.x || first.y !== basefirst.y) return true;
            }
        }

        return false;
    },

    // Debounced save - call this instead of saveCurrentImg for frequent updates
    scheduleSave(skipRemoteSync = false) {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => {
            this.saveCurrentImg(skipRemoteSync);
        }, 300);  // Save 300ms after last change
    },

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
    },

    // Chunked saving for large blobs on Android
    async saveBlobNativeChunked(blob, filename) {
        try {
            if (window.AndroidNative.startFile) {
                // New Method: True Chunked Transfer
                const sessionId = Date.now().toString();
                const actualName = window.AndroidNative.startFile(filename, sessionId);

                if (!actualName) throw new Error("Failed to start file save");

                const arrayBuffer = await blob.arrayBuffer();
                const bytes = new Uint8Array(arrayBuffer);
                const chunkSize = 32768; // 32KB chunks

                for (let i = 0; i < bytes.length; i += chunkSize) {
                    const chunk = bytes.slice(i, Math.min(i + chunkSize, bytes.length));
                    const b64Chunk = btoa(String.fromCharCode.apply(null, chunk));
                    window.AndroidNative.appendFile(b64Chunk, sessionId);

                    if (i % (chunkSize * 10) === 0) await new Promise(r => setTimeout(r, 0));
                    this.ui.updateProgress((i / bytes.length) * 100, `Saving ${Math.round((i/bytes.length)*100)}%`);
                }

                window.AndroidNative.finishFile(sessionId, blob.type);
                this.ui.showToast("Saved: " + actualName);

            } else {
                // Fallback: Old method (High Memory)
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
            }
        } catch (e) {
            console.error("Chunked save failed:", e);
            this.ui.showToast("Save failed: " + e.message);
        }
    },

    async saveImage() {
        const cvs = this.getElement('canvas');
        cvs.toBlob(blob => {
            if (this.saveBlobNative(blob, 'Page.png')) return;
            const a=document.createElement('a'); a.download='Page.png'; a.href=URL.createObjectURL(blob); a.click();
        });
    },

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
    },

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
    },

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
};
