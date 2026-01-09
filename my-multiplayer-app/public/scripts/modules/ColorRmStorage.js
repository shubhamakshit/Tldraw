export const ColorRmStorage = {
    async dbPut(s, v) { return new Promise(r=>{const t=this.db.transaction(s,'readwrite'); t.objectStore(s).put(v); t.oncomplete=()=>r()}); },

    async dbGet(s, k) { return new Promise(r=>{const q=this.db.transaction(s,'readonly').objectStore(s).get(k);q.onsuccess=()=>r(q.result)}); },

    async dbGetAll(s) { return new Promise(r=>{const q=this.db.transaction(s,'readonly').objectStore(s).getAll();q.onsuccess=()=>r(q.result||[]);q.onerror=()=>r([])}); },

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
    },

    async saveCurrentImg(skipRemoteSync = false) {
        // Invalidate cache immediately since history changed in memory
        if (this.invalidateCache) this.invalidateCache();

        if(this.state.sessionId) {
            await this.dbPut('pages', this.state.images[this.state.idx]);
            if (!skipRemoteSync && this.liveSync && !this.liveSync.isInitializing) {
                this.liveSync.setHistory(this.state.idx, this.state.images[this.state.idx].history);
            }
        }
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