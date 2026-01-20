export const ColorRmUI = {
    // --- Page Load Progress ---
    // AI Agent Marker: Progress Bar Logic
    startPageLoadProgress() {
        const bar = document.getElementById('pageLoadProgress');
        if (!bar) return;
        bar.style.width = '0%';
        bar.style.opacity = '1';
        
        // Force reflow
        bar.offsetHeight;
        
        // Animate to 90% over 2s (accelerates then slows)
        bar.style.transition = 'width 2s cubic-bezier(0.2, 0.8, 0.2, 1)';
        bar.style.width = '90%';
    },

    finishPageLoadProgress() {
        const bar = document.getElementById('pageLoadProgress');
        if (!bar) return;
        
        // Fast completion
        bar.style.transition = 'width 0.2s ease-out, opacity 0.2s ease-out';
        bar.style.width = '100%';
        
        setTimeout(() => {
            bar.style.opacity = '0';
            setTimeout(() => {
                bar.style.width = '0%';
            }, 200);
        }, 300);
    },

    initUI() {
        // Use getElement to support scoped lookup or fallback
        const wheelEl = this.getElement("iroWheel");

        // Only initialize color picker if the element exists
        if (wheelEl && window.iro) {
            this.iroP = new iro.ColorPicker(wheelEl, {width:180, color:"#fff"});

            this.iroP.on('input:start', () => { this.state.isLivePreview = true; });
            this.iroP.on('input:end', () => { this.state.isLivePreview = false; this.render(); this.saveSessionState(); });
            this.iroP.on('color:change', c => {
                const mode = this.state.pickerMode;
                if(mode==='remove') requestAnimationFrame(() => this.render(c.hexString));
                else if(mode==='pen') this.setPenColor(c.hexString);
                else if(mode==='shapeBorder') { this.state.shapeBorder=c.hexString; this.render(); }
                else if(mode==='shapeFill') { this.state.shapeFill=c.hexString; this.render(); }
                else if(mode==='selectionStroke' || mode==='selectionFill') {
                    const img = this.state.images[this.state.idx];

                    // Helper to apply color recursively (for groups)
                    const applyColorToItem = (st, isStroke) => {
                        if (st.tool === 'group' && st.children) {
                            // Recursively apply to all children
                            st.children.forEach(child => applyColorToItem(child, isStroke));
                        } else if (isStroke) {
                            if (st.tool === 'pen' || st.tool === 'highlighter') st.color = c.hexString;
                            if (st.tool === 'shape') st.border = c.hexString;
                            if (st.tool === 'text') st.color = c.hexString;
                        } else {
                            if (st.tool === 'shape') st.fill = c.hexString;
                        }
                    };

                    this.state.selection.forEach(idx => {
                        const st = img.history[idx];
                        applyColorToItem(st, mode === 'selectionStroke');
                    });
                    this.invalidateCache();
                    this.saveCurrentImg();
                    this.render();
                }
            });
        }

        const fileIn = this.getElement('fileIn');
        if (fileIn) {
            fileIn.onchange = (e) => {
                if (e.target.files && e.target.files.length > 1) {
                    this.handleExternalFiles(e.target.files);
                } else {
                    this.handleImport(e);
                }
            };
        }

        const importBtn = this.getElement('importBtn');
        if (importBtn) {
            // Add tooltip explaining Ctrl+V support
            importBtn.title = "Click to import files, or press Ctrl+V anywhere on the page";

            importBtn.onclick = async () => {
                try {
                    // Explicitly check for clipboard-read permission if supported
                    if (navigator.permissions && navigator.permissions.query) {
                        try {
                            // Note: 'clipboard-read' support varies by browser (e.g. Firefox might throw)
                            const status = await navigator.permissions.query({ name: 'clipboard-read' });
                            if (status.state === 'denied') {
                                console.log("Clipboard access denied by permission, opening picker...");
                                this.ui.showToast("Clipboard permission denied");
                                fileIn.click();
                                return;
                            }
                        } catch (pe) {
                            // Permission query failed or not supported for this API
                            console.debug("Clipboard permission query skipped:", pe);
                        }
                    }

                    // Try to read from clipboard first (check support)
                    if (navigator.clipboard && navigator.clipboard.read) {
                        const clipboardItems = await navigator.clipboard.read();
                        const files = [];
                        for (const item of clipboardItems) {
                             // Look for PDF or Images
                             const type = item.types.find(t => t === 'application/pdf' || t.startsWith('image/'));
                             if (type) {
                                 const blob = await item.getType(type);
                                 const file = new File([blob], "clipboard_import." + (type === 'application/pdf' ? 'pdf' : 'png'), { type: type });
                                 files.push(file);
                             }
                        }

                        if (files.length > 0) {
                            this.ui.showToast(`Found ${files.length} file(s) in clipboard!`);
                            this.handleExternalFiles(files);
                            return;
                        }
                    }

                    // Fallback to file picker if clipboard not supported or empty
                    console.log("Clipboard empty or not supported, opening picker...");
                    fileIn.click();
                } catch (e) {
                    // Clipboard access denied or empty, fallback to picker
                    console.warn("Clipboard read failed or empty, opening picker...", e);
                    fileIn.click();
                }
            };
        }

        const pickerBtn = this.getElement('openColorPicker');
        if(pickerBtn) pickerBtn.onclick = () => this.openPicker('remove');

        const eyeBtn = this.getElement('eyedropperBtn');
        if (eyeBtn) {
            eyeBtn.onclick = () => {
                this.state.eyedropperMode = !this.state.eyedropperMode;
                if(this.state.eyedropperMode) {
                    eyeBtn.style.background = 'var(--primary)';
                    eyeBtn.style.color = 'white';
                    this.ui.showToast('Tap on image to pick color');
                } else {
                    eyeBtn.style.background = '';
                    eyeBtn.style.color = '';
                }
            };
        }

        const closePicker = this.getElement('closePicker');
        if(closePicker) {
            closePicker.onclick = () => {
                this.getElement('floatingPicker').style.display='none';
                if(this.state.selection.length) this.saveCurrentImg();
                this.state.isLivePreview=false; this.render();
            };
        }

        const pickerAction = this.getElement('pickerActionBtn');
        if(pickerAction) {
            pickerAction.onclick = () => {
                const hex = this.iroP.color.hexString;

                // Save to custom swatches history (max 14)
                this.state.customSwatches = this.state.customSwatches.filter(c => c !== hex);
                this.state.customSwatches.unshift(hex);
                if(this.state.customSwatches.length > 14) this.state.customSwatches.pop();
                localStorage.setItem('crm_custom_colors', JSON.stringify(this.state.customSwatches));

                if(this.state.pickerMode==='remove') {
                    const i = parseInt(hex.slice(1), 16);
                    this.state.colors.push({hex, lab:this.rgbToLab((i>>16)&255,(i>>8)&255,i&255)});
                    this.renderSwatches();
                    this.saveSessionState();
                    this.invalidatePreviewCache();
                    if (this.liveSync) this.liveSync.updateColors(this.state.colors);
                } else {
                    this.renderCustomSwatches();
                }
                this.getElement('floatingPicker').style.display='none';
                this.render(); this.saveSessionState();
                if(this.state.selection.length) this.saveCurrentImg();
            };
        }

        const pickerNone = this.getElement('pickerNoneBtn');
        if(pickerNone) {
            pickerNone.onclick = () => {
                const mode = this.state.pickerMode;
                if(mode==='selectionFill') {
                    const img = this.state.images[this.state.idx];
                    this.state.selection.forEach(i => { if(img.history[i].tool==='shape') img.history[i].fill='transparent'; });
                    this.render(); this.saveCurrentImg();
                } else if (mode==='shapeFill') this.state.shapeFill = 'transparent';
                this.getElement('floatingPicker').style.display='none';
                this.saveSessionState();
            };
        }

        const pi = this.getElement('pageInput');
        if(pi) {
            pi.onchange = () => {
                let v = parseInt(pi.value);
                if(isNaN(v) || v < 1 || v > this.state.images.length) { pi.value = this.state.idx + 1; } else { this.loadPage(v - 1); }
            };
            pi.onfocus = () => { pi.style.borderBottomColor = 'var(--primary)'; };
            pi.onblur = () => { pi.style.borderBottomColor = 'transparent'; };
            pi.onkeydown = (e) => { e.stopPropagation(); };
        }

        const brushSize = this.getElement('brushSize');
        if(brushSize) {
            brushSize.oninput = e => {
                const v = parseInt(e.target.value);
                if(this.state.selection.length > 0) {
                    const img = this.state.images[this.state.idx];
                    this.state.selection.forEach(idx => {
                        const st = img.history[idx];
                        if(st.tool === 'pen' || st.tool === 'eraser') st.size = v;
                        else if(st.tool === 'shape') st.width = v;
                        else if(st.tool === 'text') st.size = v;
                    });
                    this.render();
                } else {
                    if(this.state.tool==='eraser') this.state.eraserSize=v;
                    else if(this.state.tool==='shape') this.state.shapeWidth=v;
                    else if(this.state.tool==='text') this.state.textSize=v;
                    else this.state.penSize=v;
                }
                this.saveSessionState();
            };
        }

        const strictRange = this.getElement('strictRange');
        if(strictRange) {
            strictRange.oninput = e => { this.state.strict=e.target.value; this.invalidatePreviewCache(); this.requestPreviewRender(); };
            strictRange.onchange = () => this.saveSessionState();
        }

        const previewToggle = this.getElement('previewToggle');
        if(previewToggle) {
            previewToggle.onchange = e => { this.state.previewOn=e.target.checked; this.invalidatePreviewCache(); this.requestPreviewRender(); this.saveSessionState(); };
        }

        const cursorToggle = this.getElement('cursorToggle');
        if(cursorToggle) {
            cursorToggle.onchange = e => {
                this.state.showCursors=e.target.checked;
                if(this.liveSync && this.liveSync.renderCursors) this.liveSync.renderCursors();
                this.saveSessionState();
            };
        }

        // --- Bind Tool Buttons Programmatically (for Scoped Instances) ---
        ['None','Lasso','Pen','Shape','Text','Eraser','Capture','Hand'].forEach(toolName => {
            const id = 'tool' + toolName;
            const btn = this.getElement(id);
            if (btn) {
                // Remove inline onclick if present to avoid conflicts (optional)
                btn.onclick = () => this.setTool(toolName.toLowerCase());
            }
        });

        const undoBtn = this.getElement('undoBtn');
        if (undoBtn) undoBtn.onclick = () => this.undo();

        const redoBtn = this.getElement('redoBtn');
        if (redoBtn) redoBtn.onclick = () => this.redo();

        const prevPageBtn = this.getElement('prevPageBtn');
        if (prevPageBtn) prevPageBtn.onclick = () => this.loadPage(this.state.idx - 1);

        const nextPageBtn = this.getElement('nextPageBtn');
        if (nextPageBtn) nextPageBtn.onclick = () => this.loadPage(this.state.idx + 1);

        const zoomBtn = this.getElement('zoomBtn');
        if (zoomBtn) {
            zoomBtn.onclick = () => this.resetZoom();
            zoomBtn.ondblclick = () => this.fitToScreen();
        }

        this.renderCustomSwatches();
        this.setupDragAndDrop();
    },

    showMoveModal() {
        const modal = this.getElement('moveModal');
        const select = this.getElement('moveFolderSelect');
        const confirmBtn = this.getElement('moveConfirmBtn');
        
        if (!modal || !select || !confirmBtn) return;
        
        // Populate folders
        select.innerHTML = '<option value="">(Root)</option>';
        
        const tx = this.db.transaction('folders', 'readonly');
        tx.objectStore('folders').getAll().onsuccess = (e) => {
            const folders = e.target.result || [];
            folders.forEach(f => {
                // Don't allow moving into itself if we were moving folders (not supported yet, but good practice)
                const opt = document.createElement('option');
                opt.value = f.id;
                opt.innerText = f.name;
                select.appendChild(opt);
            });
            
            // Set current folder as default if applicable, or root
            select.value = this.state.currentFolderId || "";
            
            modal.style.display = 'flex';
        };
        
        confirmBtn.onclick = () => {
            const folderId = select.value || null;
            this.moveSelectedToFolder(folderId);
            modal.style.display = 'none';
        };
    },

    setEraserMode(checked) { this.state.eraserType = checked ? 'stroke' : 'standard'; },
    setPenColor(c){ this.state.penColor=c; },
    setShapeType(t){
        this.state.shapeType=t;
        ['rectangle','circle','line','arrow','triangle','diamond','star','hexagon','pentagon','octagon'].forEach(s=>{
            const el = this.getElement('sh_'+s);
            if(el) el.classList.toggle('active', s===t);
        });
    },
    openPicker(m){
        this.state.pickerMode=m;
        const pb = this.getElement('pickerNoneBtn');
        if(pb) pb.style.display = (m==='shapeFill'||m==='selectionFill') ? 'block' : 'none';
        this.renderCustomSwatches();
        const fp = this.getElement('floatingPicker');
        if(fp) fp.style.display='flex';
    },

    switchSideTab(tab) {
        this.state.activeSideTab = tab;
        const tabs = ['tools', 'pages', 'box', 'debug'];
        tabs.forEach(t => {
            const tabEl = this.getElement('tab' + t.charAt(0).toUpperCase() + t.slice(1));
            if (tabEl) tabEl.className = `sb-tab ${tab===t?'active':''}`;
            const panelEl = this.getElement('panel' + t.charAt(0).toUpperCase() + t.slice(1));
            if (panelEl) panelEl.style.display = tab===t ? 'block' : 'none';
        });

        if(tab === 'pages') this.renderPageSidebar();
        if(tab === 'box') this.renderBox();
        if(tab === 'debug') this.renderDebug();
    },

    renderDebug() {
        if (this.state.activeSideTab !== 'debug') return;

        const debugRoomId = this.getElement('debugRoomId');
        if (debugRoomId) debugRoomId.innerText = `room_${this.liveSync.ownerId}`;

        const debugUserId = this.getElement('debugUserId');
        if (debugUserId) debugUserId.innerText = this.liveSync.userId || "None";

        const debugStatus = this.getElement('debugStatus');
        if (debugStatus) {
            debugStatus.innerText = this.liveSync.room ? this.liveSync.room.getStorageStatus() : "Disconnected";
            debugStatus.style.color = (this.liveSync.room && this.liveSync.room.getStorageStatus() === 'synchronized') ? 'var(--success)' : 'var(--primary)';
        }

        const debugPageIdx = this.getElement('debugPageIdx');
        if (debugPageIdx) debugPageIdx.innerText = this.state.idx + 1;

        const debugPageCount = this.getElement('debugPageCount');
        if (debugPageCount) debugPageCount.innerText = this.state.images.length;

        const currentImg = this.state.images[this.state.idx];
        const debugHistoryCount = this.getElement('debugHistoryCount');
        if (debugHistoryCount) debugHistoryCount.innerText = currentImg ? (currentImg.history || []).length : 0;

        // LiveMap Trace (Refactored for User-Owned Room Model)
        const mapEl = this.getElement('debugLiveMap');
        const keyEl = this.getElement('debugKeyCheck');

        if (this.liveSync.root && this.liveSync.projectId) {
            const projects = this.liveSync.root.get("projects");
            const project = projects.get(this.liveSync.projectId);

            if (keyEl) {
                keyEl.innerHTML = `
                    <div>In Root.projects: <span style="color:${projects.has(this.liveSync.projectId) ? 'var(--success)' : '#ef4444'}">${projects.has(this.liveSync.projectId)}</span></div>
                    <div>Local projId: <span style="color:var(--primary)">${this.liveSync.projectId}</span></div>
                `;
            }

            if (project) {
                const meta = project.get("metadata").toObject();
                const debugRemoteCount = this.getElement('debugRemoteCount');
                if (debugRemoteCount) debugRemoteCount.innerText = meta.pageCount;

                const debugRemoteOwner = this.getElement('debugRemoteOwner');
                if (debugRemoteOwner) debugRemoteOwner.innerText = meta.ownerId;

                const ph = project.get("pagesHistory");
                if (ph && mapEl) {
                    let html = `<b>Project: ${this.liveSync.projectId}</b><br>`;
                    html += "pagesHistory Keys:<br>";
                    ph.forEach((val, key) => {
                        html += `• pg ${key}: ${val.length} items<br>`;
                    });
                    mapEl.innerHTML = html;
                }
            } else if (mapEl) {
                mapEl.innerHTML = "Waiting for project data...";
            }
        } else if (mapEl) {
            mapEl.innerHTML = "LiveSync not connected.";
        }
    },

    renderPageSidebar() {
        const el = this.getElement('sbPageList');
        if (!el) return;

        // Revoke old blob URLs to prevent memory leaks
        if (this.pageThumbnailUrls) {
            this.pageThumbnailUrls.forEach(url => URL.revokeObjectURL(url));
        }
        this.pageThumbnailUrls = [];

        el.innerHTML = '';

        // Just display pages normally
        this.state.images.forEach((img, i) => {
            const d = document.createElement('div');
            d.className = `sb-page-item ${i === this.state.idx ? 'active' : ''}`;
            d.onclick = () => this.loadPage(i);

            const im = new Image();
            // Check if img.blob is a Promise and handle accordingly
            if (img.blob instanceof Promise) {
                img.blob.then(blob => {
                    const url = URL.createObjectURL(blob);
                    this.pageThumbnailUrls.push(url);
                    im.src = url;
                });
            } else {
                const url = URL.createObjectURL(img.blob);
                this.pageThumbnailUrls.push(url);
                im.src = url;
            }

            d.appendChild(im);
            const n = document.createElement('div');
            n.className = 'sb-page-num'; n.innerText = i + 1;
            d.appendChild(n);
            el.appendChild(d);
        });
    },

    resetZoom() {
        this.state.zoom = 1;
        this.state.pan = { x: 0, y: 0 };
        this.updateZoomIndicator();
        this.render();
    },

    zoomIn() {
        const c = this.getElement('canvas');
        if (!c) return;

        // Zoom towards center of canvas
        const centerX = c.width / 2;
        const centerY = c.height / 2;

        const newZoom = Math.min(this.state.zoom * 1.25, 10); // Max 10x zoom
        this.state.pan.x = centerX - (centerX - this.state.pan.x) * (newZoom / this.state.zoom);
        this.state.pan.y = centerY - (centerY - this.state.pan.y) * (newZoom / this.state.zoom);
        this.state.zoom = newZoom;

        this.updateZoomIndicator();
        this.render();
    },

    zoomOut() {
        const c = this.getElement('canvas');
        if (!c) return;

        // Zoom towards center of canvas
        const centerX = c.width / 2;
        const centerY = c.height / 2;

        const newZoom = Math.max(this.state.zoom / 1.25, 0.1); // Min 0.1x zoom
        this.state.pan.x = centerX - (centerX - this.state.pan.x) * (newZoom / this.state.zoom);
        this.state.pan.y = centerY - (centerY - this.state.pan.y) * (newZoom / this.state.zoom);
        this.state.zoom = newZoom;

        this.updateZoomIndicator();
        this.render();
    },

    updateZoomIndicator() {
        const zoomBtn = this.getElement('zoomBtn');
        if (zoomBtn) {
            zoomBtn.innerText = Math.round(this.state.zoom * 100) + '%';
        }
    },

    togglePageLock() {
        if (this.state.ownerId !== this.liveSync.userId) return;
        this.state.pageLocked = !this.state.pageLocked;
        this.updateLockUI();
        this.saveSessionState();
    },

    updateLockUI() {
        const btn = this.getElement('lockBtn');
        const ctrl = this.getElement('presenterControls');
        if (this.liveSync && this.state.ownerId === this.liveSync.userId) {
            if (ctrl) ctrl.style.display = 'block';
            if (btn) {
                btn.className = this.state.pageLocked ? "btn btn-primary" : "btn";
                btn.innerHTML = this.state.pageLocked ? '<i class="bi bi-lock-fill"></i> Presenter Lock: ON' : '<i class="bi bi-unlock"></i> Presenter Lock: OFF';
            }
        } else {
            if (ctrl) ctrl.style.display = 'none';
        }
    },

    // --- Bookmarks Feature ---
    initBookmark() {
        this.ui.showInput("New Bookmark", "Bookmark Name", (name) => {
             if(!this.state.bookmarks) this.state.bookmarks = [];
             this.state.bookmarks.push({ id: Date.now(), pageIdx: this.state.idx, name: name });
             this.renderBookmarks();
             this.saveSessionState();
             if (this.liveSync) this.liveSync.updateBookmarks(this.state.bookmarks);
        });
    },

    removeBookmark(id) {
        this.state.bookmarks = this.state.bookmarks.filter(b => b.id !== id);
        this.renderBookmarks();
        this.saveSessionState();
        if (this.liveSync) this.liveSync.updateBookmarks(this.state.bookmarks);
    },

    renderBookmarks() {
        const el = this.getElement('bookmarkList');
        if (!el) return;
        el.innerHTML = '';
        if(!this.state.bookmarks || this.state.bookmarks.length === 0) {
            el.innerHTML = '<div style="color:#666; font-size:0.8rem; text-align:center; padding:10px;">No bookmarks yet.</div>';
            return;
        }
        this.state.bookmarks.sort((a,b) => a.pageIdx - b.pageIdx).forEach(b => {
            const div = document.createElement('div');
            div.className = 'bm-item';
            if(b.pageIdx === this.state.idx) div.style.borderColor = 'var(--primary)';
            div.innerHTML = `<span><i class="bi bi-bookmark"></i> ${b.name} <span style="color:#666; font-size:0.7em">(Pg ${b.pageIdx+1})</span></span>`;
            div.onclick = () => this.loadPage(b.pageIdx);

            const del = document.createElement('button');
            del.className = 'bm-del';
            del.innerHTML = '<i class="bi bi-x"></i>';
            del.onclick = (e) => { e.stopPropagation(); this.removeBookmark(b.id); };

            div.appendChild(del);
            el.appendChild(div);
        });
    },

    setupDragAndDrop() {
        const zone = document.body;

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.style.boxShadow = 'inset 0 0 0 4px var(--accent)';
        });

        zone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.style.boxShadow = 'none';
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.style.boxShadow = 'none';
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                this.handleExternalFiles(e.dataTransfer.files);
            }
        });

        document.addEventListener('paste', async (e) => {
            console.log("[Paste Debug] Event fired", e);

            // 1. Check for standard files (e.g. from File Explorer)
            if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
                console.log("[Paste Debug] Files detected in clipboardData.files");
                e.preventDefault();
                e.stopPropagation();
                this.handleExternalFiles(e.clipboardData.files);
                return;
            }

            // 2. Check for items (e.g. Screenshots, Image Copy)
            if (e.clipboardData && e.clipboardData.items && e.clipboardData.items.length > 0) {
                const extractedFiles = [];
                let hasString = false;

                for (let i = 0; i < e.clipboardData.items.length; i++) {
                    const item = e.clipboardData.items[i];
                    console.log(`[Paste Debug] Item ${i}: kind=${item.kind}, type=${item.type}`);

                    if (item.kind === 'file') {
                        const f = item.getAsFile();
                        if (f) extractedFiles.push(f);
                    } else if (item.kind === 'string') {
                        hasString = true;
                        // Check if string is a path
                        item.getAsString((str) => {
                             console.log(`[Paste Debug] String content: "${str}"`);
                             // Check for common local path signatures
                             if ((str.includes(':\\') || str.startsWith('/') || str.startsWith('file://')) && (str.toLowerCase().endsWith('.pdf') || str.match(/\.(png|jpg|jpeg|webp)$/i))) {
                                 this.ui.showToast("Cannot read local file path. Opening picker...");
                                 this.ui.showAlert("Security Restriction", "Browsers cannot access local files pasted as paths. Please use the file picker.");
                                 const fileIn = this.getElement('fileIn');
                                 if (fileIn) fileIn.click();
                             }
                        });
                    }
                }

                if (extractedFiles.length > 0) {
                    console.log(`[Paste Debug] Extracted ${extractedFiles.length} files from items`);
                    e.preventDefault();
                    e.stopPropagation();
                    this.handleExternalFiles(extractedFiles);
                    return;
                }

                // If we only found strings (no files) and not in an input, try Async API fallback
                if (hasString && extractedFiles.length === 0 && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
                     console.log("[Paste Debug] Only found strings. Attempting Async Clipboard API fallback...");
                }
            }

            // 3. Fallback: Try Async Clipboard API (Permission based)
            // This catches cases where the 'paste' event doesn't expose the file but the async API does
            if (navigator.clipboard && navigator.clipboard.read && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
                try {
                    const clipboardItems = await navigator.clipboard.read();
                    const files = [];
                    for (const item of clipboardItems) {
                         const type = item.types.find(t => t === 'application/pdf' || t.startsWith('image/'));
                         if (type) {
                             const blob = await item.getType(type);
                             const file = new File([blob], "clipboard_import." + (type === 'application/pdf' ? 'pdf' : 'png'), { type: type });
                             files.push(file);
                         }
                    }
                    if (files.length > 0) {
                        console.log(`[Paste Debug] Async API found ${files.length} files!`);
                        e.preventDefault();
                        e.stopPropagation();
                        this.handleExternalFiles(files);
                        return;
                    }
                } catch(err) {
                    // Ignore errors here, as it might just be permission denied or empty
                    console.log("[Paste Debug] Async fallback failed or empty:", err);
                }
            }

            // Never hijack text paste if user is typing in an input
            if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
        });
    },

    async handleExternalFiles(files) {
        this.ui.toggleLoader(true, `Importing ${files.length} projects...`);
        this.isBulkImporting = true; 

        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                this.ui.updateProgress((i / files.length) * 100, `Creating project ${i + 1} of ${files.length}...`);
                await this.handleImport({ target: { files: [file] } }, false, true);
            }
        } catch(e) {
            console.error("Bulk import failed:", e);
            this.ui.showToast("Import error occurred");
        } finally {
            this.isBulkImporting = false;
            this.ui.toggleLoader(false);
            this.ui.showToast(`Imported ${files.length} projects`);
            this.ui.showDashboard();
        }
    },

    renderSwatches() {
        const c = this.getElement('swatches');
        if (!c) return;
        c.innerHTML='';
        this.state.colors.forEach((col) => {
            const d = document.createElement('div'); d.className='swatch'; d.style.background=col.hex;
            d.onclick=()=>{
                this.state.colors = this.state.colors.filter(c => c.hex !== col.hex);
                this.renderSwatches(); // Re-render swatches after removal
                this.invalidatePreviewCache();
                this.render();
                this.saveSessionState();
                if (this.liveSync) this.liveSync.updateColors(this.state.colors);
            };
            c.appendChild(d);
        });
    },

    renderCustomSwatches() {
        const c = this.getElement('customSwatches');
        if (!c) return;
        c.innerHTML = '';
        this.state.customSwatches.forEach(color => {
            const d = document.createElement('div');
            d.className = 'color-dot';
            d.style.background = color;
            d.title = color;
            d.onclick = () => {
                this.setPenColor(color);
                // Also update picker color if it's open
                if (this.iroP) this.iroP.color.set(color);
            };
            c.appendChild(d);
        });
    },

    /**
     * Shows a keyboard shortcuts help modal
     */
    showShortcutsHelp() {
        // Remove existing modal if any
        let modal = document.getElementById('shortcutsHelpModal');
        if (modal) {
            modal.style.display = 'flex';
            return;
        }

        // Create modal
        modal = document.createElement('div');
        modal.id = 'shortcutsHelpModal';
        modal.className = 'overlay';
        modal.style.cssText = 'display:flex; z-index:400;';

        const shortcuts = [
            { category: 'Tools', items: [
                { key: 'V', desc: 'Move/Select tool' },
                { key: 'L', desc: 'Lasso selection' },
                { key: 'P', desc: 'Pen/Draw tool' },
                { key: 'E', desc: 'Eraser tool' },
                { key: 'S', desc: 'Shape tool' },
                { key: 'T', desc: 'Text tool' },
                { key: 'B', desc: 'Box capture tool' },
                { key: 'H', desc: 'Hand/Pan tool' },
            ]},
            { category: 'Navigation', items: [
                { key: '← / →', desc: 'Previous / Next page' },
                { key: 'PageUp / PageDown', desc: 'Previous / Next page' },
                { key: 'Home / End', desc: 'First / Last page' },
            ]},
            { category: 'View', items: [
                { key: 'F', desc: 'Fit to screen' },
                { key: 'Ctrl + 1', desc: 'Fit to screen' },
                { key: 'Ctrl + 0', desc: 'Reset zoom to 100%' },
                { key: 'Ctrl + +', desc: 'Zoom in' },
                { key: 'Ctrl + -', desc: 'Zoom out' },
                { key: 'Space', desc: 'Toggle preview mode' },
            ]},
            { category: 'Editing', items: [
                { key: 'Ctrl + Z', desc: 'Undo' },
                { key: 'Ctrl + Shift + Z', desc: 'Redo' },
                { key: 'Ctrl + Y', desc: 'Redo' },
                { key: 'Ctrl + A', desc: 'Select all items' },
                { key: 'Ctrl + D', desc: 'Duplicate selection' },
                { key: 'Delete / Backspace', desc: 'Delete selected' },
                { key: 'Escape', desc: 'Cancel action / Deselect' },
            ]},
        ];

        let html = `
            <div class="card" style="max-width:600px; max-height:85vh; overflow-y:auto;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; padding-bottom:15px; border-bottom:1px solid var(--border);">
                    <h3 style="margin:0; color:white; display:flex; align-items:center; gap:10px;">
                        <i class="bi bi-keyboard" style="color:#8b5cf6;"></i> Keyboard Shortcuts
                    </h3>
                    <button onclick="document.getElementById('shortcutsHelpModal').style.display='none'" style="background:var(--bg-surface); border:1px solid var(--border); color:#888; cursor:pointer; width:32px; height:32px; border-radius:4px; display:flex; align-items:center; justify-content:center;">×</button>
                </div>
                <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:20px;">
        `;

        shortcuts.forEach(cat => {
            html += `
                <div>
                    <h4 style="margin:0 0 10px 0; color:#8b5cf6; font-size:0.85rem; text-transform:uppercase; letter-spacing:0.05em;">${cat.category}</h4>
                    <div style="display:flex; flex-direction:column; gap:6px;">
            `;
            cat.items.forEach(item => {
                html += `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; background:var(--bg-surface); border-radius:4px;">
                        <span style="color:#888; font-size:0.8rem;">${item.desc}</span>
                        <kbd style="background:#000; color:#fff; padding:3px 8px; border-radius:4px; font-family:monospace; font-size:0.75rem; border:1px solid #333;">${item.key}</kbd>
                    </div>
                `;
            });
            html += `</div></div>`;
        });

        html += `
                </div>
                <div style="margin-top:20px; padding-top:15px; border-top:1px solid var(--border); text-align:center;">
                    <span style="color:#666; font-size:0.75rem;">Press <kbd style="background:#000; color:#fff; padding:2px 6px; border-radius:3px; font-family:monospace; font-size:0.7rem; border:1px solid #333;">?</kbd> anytime to show this help</span>
                </div>
            </div>
        `;

        modal.innerHTML = html;
        modal.onclick = (e) => {
            if (e.target === modal) modal.style.display = 'none';
        };

        document.body.appendChild(modal);
    },

    /**
     * Hides the shortcuts help modal
     */
    hideShortcutsHelp() {
        const modal = document.getElementById('shortcutsHelpModal');
        if (modal) modal.style.display = 'none';
    }
};