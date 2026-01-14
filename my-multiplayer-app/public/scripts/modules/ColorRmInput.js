export const ColorRmInput = {
    setTool(t) {
        this.state.tool = t;
        ['None','Lasso','Pen','Shape','Text','Eraser','Capture','Hand'].forEach(x => {
            const el = this.getElement('tool'+x);
            if(el) el.classList.toggle('active', t===x.toLowerCase());
        });

        const vp = this.getElement('viewport');
        if(vp) {
            if (t === 'hand') vp.style.cursor = 'grab';
            else vp.style.cursor = 'default';
        }

        const tsp = this.getElement('toolSettingsPanel');
        if(tsp) tsp.style.display = ['pen','shape','eraser','text','lasso'].includes(t) ? 'block' : 'none';

        const po = this.getElement('penOptions');
        if(po) po.style.display = t==='pen'?'block':'none';

        const so = this.getElement('shapeOptions');
        if(so) so.style.display = t==='shape'?'block':'none';

        const eo = this.getElement('eraserOptions');
        if(eo) eo.style.display = t==='eraser'?'block':'none';

        const to = this.getElement('textOptions');
        if(to) to.style.display = t==='text'?'block':'none';

        const lo = this.getElement('lassoOptions');
        if(lo) lo.style.display = t==='lasso'?'block':'none';

        // Update the checkboxes based on current lasso options
        if(t==='lasso' && lo) {
            const options = this.state.lassoOptions || {
                scribble: true,
                text: true,
                shapes: true,
                images: true,
                locked: false
            };

            const scribbleCb = this.getElement('lassoScribble');
            const textCb = this.getElement('lassoText');
            const shapesCb = this.getElement('lassoShapes');
            const imagesCb = this.getElement('lassoImages');
            const lockedCb = this.getElement('lassoLocked');

            if(scribbleCb) scribbleCb.checked = options.scribble;
            if(textCb) textCb.checked = options.text;
            if(shapesCb) shapesCb.checked = options.shapes;
            if(imagesCb) imagesCb.checked = options.images;
            if(lockedCb) lockedCb.checked = options.locked;
        }

        // Update the checkboxes based on current eraser options
        if(t==='eraser' && eo) {
            const options = this.state.eraserOptions || {
                scribble: true,
                text: true,
                shapes: true,
                images: false
            };

            const scribbleCb = this.getElement('eraseScribble');
            const textCb = this.getElement('eraseText');
            const shapesCb = this.getElement('eraseShapes');
            const imagesCb = this.getElement('eraseImages');
            const strokeCb = this.getElement('strokeEraserToggle');

            if(scribbleCb) scribbleCb.checked = options.scribble;
            if(textCb) textCb.checked = options.text;
            if(shapesCb) shapesCb.checked = options.shapes;
            if(imagesCb) imagesCb.checked = options.images;
            if(strokeCb) strokeCb.checked = (this.state.eraserType === 'stroke');
        }

        const range = this.getElement('brushSize');
        const label = this.getElement('sizeLabel');
        if(label) label.innerText = "Size";

        if(range) {
            if(t === 'pen') { range.value = this.state.penSize; }
            else if(t === 'eraser') { range.value = this.state.eraserSize; }
            else if(t === 'shape') { range.value = this.state.shapeWidth; if(label) label.innerText = "Border Width"; }
            else if(t === 'text') { range.value = this.state.textSize; if(label) label.innerText = "Text Size"; }
        }

        if(['pen','shape','eraser','text','capture'].includes(t)) {
            this.state.selection = [];
            const tb = this.getElement('contextToolbar');
            if(tb) tb.style.display = 'none';
            this.render();
        }
    },

    undo() {
        const img = this.state.images[this.state.idx];

        // First check if there's a modification undo (for align, etc.)
        if (img._modificationUndo && img._modificationUndo.length > 0) {
            const undoEntry = img._modificationUndo.pop();
            if (!img._modificationRedo) img._modificationRedo = [];

            // Save current state for redo
            const redoEntry = {
                type: undoEntry.type,
                items: undoEntry.indices.map(idx => ({
                    idx,
                    state: JSON.parse(JSON.stringify(img.history[idx]))
                }))
            };
            img._modificationRedo.push(redoEntry);

            // Restore previous state
            undoEntry.items.forEach(({ idx, state }) => {
                img.history[idx] = state;
            });

            this.invalidateCache();
            this.saveCurrentImg();
            this.render();
            return;
        }

        // Fallback to standard undo (add/remove operations)
        if(img.history.length > 0) {
            if(!img.redo) img.redo = [];
            img.redo.push(img.history.pop());
            this.saveCurrentImg(); this.render();
        }
    },

    redo() {
        const img = this.state.images[this.state.idx];

        // First check if there's a modification redo
        if (img._modificationRedo && img._modificationRedo.length > 0) {
            const redoEntry = img._modificationRedo.pop();
            if (!img._modificationUndo) img._modificationUndo = [];

            // Save current state for undo
            const undoEntry = {
                type: redoEntry.type,
                indices: redoEntry.items.map(i => i.idx),
                items: redoEntry.items.map(({ idx }) => ({
                    idx,
                    state: JSON.parse(JSON.stringify(img.history[idx]))
                }))
            };
            img._modificationUndo.push(undoEntry);

            // Apply redo state
            redoEntry.items.forEach(({ idx, state }) => {
                img.history[idx] = state;
            });

            this.invalidateCache();
            this.saveCurrentImg();
            this.render();
            return;
        }

        // Fallback to standard redo
        if(img.redo && img.redo.length > 0) {
            img.history.push(img.redo.pop());
            this.saveCurrentImg(); this.render();
        }
    },

    /**
     * Saves modification state for undo before making in-place changes
     * @param {string} type - Type of modification (e.g., 'align', 'distribute')
     * @param {number[]} indices - Indices of items being modified
     */
    _pushModificationUndo(type, indices) {
        const img = this.state.images[this.state.idx];
        if (!img._modificationUndo) img._modificationUndo = [];

        // Clear redo stack when new modification is made
        img._modificationRedo = [];

        // Save current state of items being modified
        const undoEntry = {
            type,
            indices,
            items: indices.map(idx => ({
                idx,
                state: JSON.parse(JSON.stringify(img.history[idx]))
            }))
        };
        img._modificationUndo.push(undoEntry);

        // Limit undo stack size
        if (img._modificationUndo.length > 50) {
            img._modificationUndo.shift();
        }
    },

    /**
     * Clears the redo stack when new items are added to history.
     * This ensures the redo stack doesn't contain stale items after new operations.
     */
    _clearRedoStack() {
        const img = this.state.images[this.state.idx];
        if (img) {
            img.redo = [];
            img._modificationRedo = [];
        }
    },

    deleteSelected() {
        const img = this.state.images[this.state.idx];
        if (this.state.selection.length === 0) return;

        // Save state for undo before deleting
        this._pushModificationUndo('delete', this.state.selection);

        this.state.selection.forEach(i => {
            const item = img.history[i];
            if (item) {
                item.deleted = true;
                item.lastMod = Date.now();
            }
        });
        this.state.selection = [];
        const tb = this.getElement('contextToolbar');
        if(tb) tb.style.display = 'none';

        this.invalidateCache();
        this.saveCurrentImg();
        this.render();
    },

    copySelected(cut=false) {
        const img = this.state.images[this.state.idx];
        const newIds = [];
        this._clearRedoStack(); // Clear redo when adding new items
        this.state.selection.forEach(i => {
            const item = JSON.parse(JSON.stringify(img.history[i]));
            item.id = Date.now() + Math.random();
            item.lastMod = Date.now();
            item.deleted = false;
            if(!cut) {
                if(item.pts) item.pts.forEach(p=>{p.x+=20; p.y+=20});
                else { item.x+=20; item.y+=20; }
            }
            img.history.push(item);
            newIds.push(img.history.length-1);
        });
        if(cut) this.deleteSelected();
        else {
            this.state.selection = newIds;
            this.saveCurrentImg();
            this.render();
        }
    },

    lockSelected() {
        const img = this.state.images[this.state.idx];
        this.state.selection.forEach(i => img.history[i].locked = true);
        this.state.selection = [];
        this.saveCurrentImg();
        this.render();
    },

    unlockSelected() {
        const img = this.state.images[this.state.idx];
        this.state.selection.forEach(i => img.history[i].locked = false);
        this.saveCurrentImg();
        this.render();
    },

    toggleLockSelected() {
        const img = this.state.images[this.state.idx];
        if (this.state.selection.length === 0) return;

        // Check if any selected items are locked
        const anyLocked = this.state.selection.some(i => img.history[i].locked);

        if (anyLocked) {
            // Unlock all
            this.state.selection.forEach(i => img.history[i].locked = false);
            this.ui.showToast('Unlocked');
        } else {
            // Lock all
            this.state.selection.forEach(i => img.history[i].locked = true);
            this.state.selection = [];
            this.ui.showToast('Locked');
        }
        this.saveCurrentImg();
        this.render();
    },

    makeDraggable() {
        const el = this.getElement('floatingPicker');
        if (!el) return;
        let isDragging = false; let startX, startY, initLeft, initTop;
        const handle = this.getElement('pickerDragHandle');
        if(handle) {
            handle.onmousedown = (e) => { isDragging = true; startX = e.clientX; startY = e.clientY; const r = el.getBoundingClientRect(); initLeft = r.left; initTop = r.top; };
            // Use document instead of window to be more contained
            // Each instance's isDragging flag prevents cross-instance interference
            document.addEventListener('mousemove', (e) => { if(!isDragging) return; el.style.left = (initLeft + (e.clientX - startX)) + 'px'; el.style.top = (initTop + (e.clientY - startY)) + 'px'; });
            document.addEventListener('mouseup', () => isDragging = false);
        }
    },

    setupShortcuts() {
        const target = this.container || document;

        // Ensure container can receive focus if it's not the document
        if (this.container && !this.container.getAttribute('tabindex')) {
            this.container.setAttribute('tabindex', '0');
        }

        target.addEventListener('keydown', e => {
            if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            const key = e.key.toLowerCase();

            // === ESCAPE: Cancel current action or deselect ===
            if(e.key === 'Escape') {
                e.preventDefault();
                // Cancel any active drawing
                if(this.isDragging) {
                    this.isDragging = false;
                    this.currentStroke = null;
                    this.render();
                    return;
                }
                // Close any open modals/pickers
                const picker = this.getElement('floatingPicker');
                if(picker && picker.style.display !== 'none') {
                    picker.style.display = 'none';
                    return;
                }
                const ctxDrop = this.getElement('ctxDrop');
                if(ctxDrop && ctxDrop.classList.contains('show')) {
                    ctxDrop.classList.remove('show');
                    return;
                }
                // Deselect all
                if(this.state.selection.length > 0) {
                    this.state.selection = [];
                    const tb = this.getElement('contextToolbar');
                    if(tb) tb.style.display = 'none';
                    this.render();
                    return;
                }
                // Reset tool to selection
                this.setTool('none');
                return;
            }

            if(e.key === ' ') {
                e.preventDefault();
                this.state.previewOn = !this.state.previewOn;
                const pt = this.getElement('previewToggle');
                if(pt) pt.checked = this.state.previewOn;
                this.render(); this.saveSessionState();
                this.ui.showToast(this.state.previewOn ? 'Preview ON' : 'Preview OFF');
                return;
            }

            // === Zoom keyboard shortcuts ===
            if((e.ctrlKey||e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); this.zoomIn(); return; }
            if((e.ctrlKey||e.metaKey) && e.key === '-') { e.preventDefault(); this.zoomOut(); return; }
            if((e.ctrlKey||e.metaKey) && e.key === '0') { e.preventDefault(); this.resetZoom(); return; }

            // === Undo/Redo ===
            if((e.ctrlKey||e.metaKey) && key==='z') { e.preventDefault(); if(e.shiftKey) this.redo(); else this.undo(); return; }
            if((e.ctrlKey||e.metaKey) && key==='y') { e.preventDefault(); this.redo(); return; }

            // === Fit to screen (F key or Ctrl+1) ===
            if(key==='f' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                this.fitToScreen();
                return;
            }
            if((e.ctrlKey||e.metaKey) && e.key === '1') { e.preventDefault(); this.fitToScreen(); return; }

            // === Duplicate selection (Ctrl+D) ===
            if((e.ctrlKey||e.metaKey) && key==='d' && this.state.selection.length > 0) {
                e.preventDefault();
                this.copySelected(false);
                this.ui.showToast('Duplicated');
                return;
            }

            // === Group (Ctrl+G) ===
            if((e.ctrlKey||e.metaKey) && key==='g' && !e.shiftKey && this.state.selection.length >= 2) {
                e.preventDefault();
                this.groupSelected();
                return;
            }

            // === Ungroup (Ctrl+Shift+G) ===
            if((e.ctrlKey||e.metaKey) && e.shiftKey && key==='g' && this.state.selection.length === 1) {
                e.preventDefault();
                this.ungroupSelected();
                return;
            }

            // === Select All (Ctrl+A) ===
            if((e.ctrlKey||e.metaKey) && key==='a') {
                e.preventDefault();
                const img = this.state.images[this.state.idx];
                if(img && img.history) {
                    // Select all non-deleted items (including locked ones so they can be unlocked)
                    this.state.selection = img.history.map((_, i) => i).filter(i => !img.history[i].deleted);
                    if(this.state.selection.length > 0) {
                        this.setTool('lasso');
                        this.ui.showToast(`Selected ${this.state.selection.length} items`);
                    }
                    this.render();
                }
                return;
            }

            // === Tool shortcuts (single keys) ===
            if(key==='v' && !e.ctrlKey && !e.metaKey) this.setTool('none');
            if(key==='l' && !e.ctrlKey && !e.metaKey) this.setTool('lasso');
            if(key==='p' && !e.ctrlKey && !e.metaKey) this.setTool('pen');
            if(key==='e' && !e.ctrlKey && !e.metaKey) this.setTool('eraser');
            if(key==='s' && !e.ctrlKey && !e.metaKey) this.setTool('shape');
            if(key==='t' && !e.ctrlKey && !e.metaKey) this.setTool('text');
            if(key==='b' && !e.ctrlKey && !e.metaKey) this.setTool('capture');
            if(key==='h' && !e.ctrlKey && !e.metaKey) this.setTool('hand');

            // === Page Navigation ===
            if(e.key==='ArrowLeft' || e.key==='PageUp') { this.loadPage(this.state.idx-1); return; }
            if(e.key==='ArrowRight' || e.key==='PageDown') { this.loadPage(this.state.idx+1); return; }
            if(e.key==='Home') { this.loadPage(0); return; }
            if(e.key==='End') { this.loadPage(this.state.images.length - 1); return; }

            // === Copy/Cut/Paste (Multi-page Clipboard) ===
            if((e.ctrlKey||e.metaKey) && key==='c' && this.state.selection.length > 0) {
                e.preventDefault();
                this.copyToClipboard();
                return;
            }
            if((e.ctrlKey||e.metaKey) && key==='x' && this.state.selection.length > 0) {
                e.preventDefault();
                this.cutToClipboard();
                return;
            }
            if((e.ctrlKey||e.metaKey) && key==='v') {
                e.preventDefault();
                this.pasteFromClipboard();
                return;
            }

            // === Delete selected ===
            if(e.key==='Delete' || (e.key==='Backspace' && !e.ctrlKey && !e.metaKey)) {
                if(this.state.selection.length > 0) {
                    this.deleteSelected();
                }
            }

            // === Toggle Lock (Ctrl+L or Cmd+L) ===
            if((e.ctrlKey||e.metaKey) && key==='l' && this.state.selection.length > 0) {
                e.preventDefault();
                this.toggleLockSelected();
                return;
            }

            // === Shortcuts Help (? key) ===
            if(e.key === '?' || (e.shiftKey && e.key === '/')) {
                e.preventDefault();
                if(this.showShortcutsHelp) this.showShortcutsHelp();
            }
        });
    },

    /**
     * Fits the current page to fill the viewport
     */
    fitToScreen() {
        const canvas = this.getElement('canvas');
        const viewport = this.getElement('viewport');
        if (!canvas || !viewport) return;

        const viewRect = viewport.getBoundingClientRect();
        const canvasWidth = this.state.viewW;
        const canvasHeight = this.state.viewH;

        // Calculate zoom to fit with some padding
        const padding = 40;
        const scaleX = (viewRect.width - padding * 2) / canvasWidth;
        const scaleY = (viewRect.height - padding * 2) / canvasHeight;
        const newZoom = Math.min(scaleX, scaleY, 2); // Cap at 2x

        // Center the canvas
        this.state.zoom = newZoom;
        this.state.pan.x = (viewRect.width - canvasWidth * newZoom) / 2;
        this.state.pan.y = (viewRect.height - canvasHeight * newZoom) / 2;

        this.updateZoomIndicator();
        this.render();
        this.ui.showToast('Fit to screen');
    },

    setupDrawing() {
        // Load S-Pen preference from localStorage
        const spenEnabled = this._loadSpenPreference();
        this.state.spenEngineEnabled = spenEnabled;

        // Update the toggle UI to match saved preference
        const spenToggle = this.getElement('spenEngineToggle');
        if (spenToggle) {
            spenToggle.checked = spenEnabled;
        }

        // Load stabilization preference from localStorage
        const stabilization = this._loadStabilizationPreference();
        this.state.stabilization = stabilization;

        // Update the stabilization UI to match saved preference
        const stabSlider = this.getElement('stabilizationSlider');
        const stabLabel = this.getElement('stabilizationValue');
        if (stabSlider) {
            stabSlider.value = stabilization;
        }
        if (stabLabel) {
            stabLabel.textContent = `${stabilization}%`;
        }

        // Initialize S-Pen Engine only if enabled
        if (spenEnabled) {
            import('../spen_engine.js')
                .then(({ initializeSPen }) => {
                    const canvas = this.getElement('canvas');
                    if (canvas) {
                        console.log('Initializing S-Pen Engine for ColorRM...');
                        // Store cleanup function for toggle support
                        this._spenEngineCleanup = initializeSPen(canvas);
                    }
                })
                .catch(err => {
                    console.log('S-Pen Engine not found, skipping initialization.');
                });
        } else {
            console.log('S-Pen Engine disabled by user preference');
        }

        // Initialize Eraser Pen Engine (button 32) - for generic stylus erasers
        import('../eraser_engine.js')
            .then(({ initializeEraserPen }) => {
                const canvas = this.getElement('canvas');
                if (canvas) {
                    console.log('Initializing Eraser Pen Engine for ColorRM...');
                    // Store cleanup function for toggle support
                    this._eraserEngineCleanup = initializeEraserPen(canvas, (isErasing) => {
                        // Switch tool SYNCHRONOUSLY before synthetic event fires
                        if (isErasing) {
                            if (this.state.tool !== 'eraser') {
                                this._previousToolBeforeEraser = this.state.tool;
                                this.setTool('eraser');
                                console.log('Eraser Pen: Switched to Eraser');
                            }
                        } else {
                            if (this._previousToolBeforeEraser) {
                                this.setTool(this._previousToolBeforeEraser);
                                console.log('Eraser Pen: Reverted to', this._previousToolBeforeEraser);
                                this._previousToolBeforeEraser = null;
                            }
                        }
                    });
                }
            })
            .catch(err => {
                console.log('Eraser Pen Engine not found, skipping initialization.');
            });

        const c = this.getElement('canvas');
        if (!c) return;

        c.addEventListener('contextmenu', e => e.preventDefault());

        // Double-click to edit text
        c.addEventListener('dblclick', e => {
            const r = c.getBoundingClientRect();
            const screenX = (e.clientX - r.left)*(c.width/r.width);
            const screenY = (e.clientY - r.top)*(c.height/r.height);
            const pt = {
                x: (screenX - this.state.pan.x) / this.state.zoom,
                y: (screenY - this.state.pan.y) / this.state.zoom
            };
            this._editTextAtPoint(pt);
        });

        let startPt = null; this.isDragging = false;
        let dragStart = null; let startBounds = null; let startRotation = 0;
        let isMovingSelection = false; let isResizing = false; let isRotating = false; let resizeHandle = null;
        let initialHistoryState = []; let lassoPath = [];

        // --- S-Pen Button Logic ---
        let previousTool = 'pen';

        // Track if this instance's canvas is currently being interacted with
        const isActiveInstance = () => {
            if (!this.container) return true; // Main app, no container = always active
            // Check hover OR if we're actively drawing
            return this.container.matches(':hover') || this.isDragging;
        };

        window.addEventListener('spen-button-down', () => {
            if (!isActiveInstance()) return;

            if (this.state.tool !== 'eraser') {
                previousTool = this.state.tool;
                this.setTool('eraser');
                console.log('S-Pen: Switched to Eraser');
            }
        });
        window.addEventListener('spen-button-up', () => {
            if (!isActiveInstance()) return;

            if (this.state.tool === 'eraser') {
                this.setTool(previousTool);
                console.log('S-Pen: Reverted to', previousTool);
            }
        });

        // Note: Eraser Pen (button 32) tool switching is handled synchronously
        // in the callback passed to initializeEraserPen() above

        const getPt = e => {
            const r = c.getBoundingClientRect();
            const screenX = (e.clientX - r.left)*(c.width/r.width);
            const screenY = (e.clientY - r.top)*(c.height/r.height);
            return {
                x: (screenX - this.state.pan.x) / this.state.zoom,
                y: (screenY - this.state.pan.y) / this.state.zoom
            };
        };

        const getSelectionBounds = () => {
            if(this.state.selection.length===0) return null;
            const img = this.state.images[this.state.idx];
            let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
            this.state.selection.forEach(idx => {
                const st = img.history[idx];
                if (!st || st.deleted) return; // Skip undefined or deleted items
                let bx, by, bw, bh;
                if (st.tool === 'pen' || st.tool === 'eraser') {
                    if (!st.pts || st.pts.length === 0) return;
                    bx = st.pts[0].x; by = st.pts[0].y;
                    let rx = bx, ry = by;
                    st.pts.forEach(p => {
                        bx = Math.min(bx, p.x); by = Math.min(by, p.y);
                        rx = Math.max(rx, p.x); ry = Math.max(ry, p.y);
                    });
                    bw = rx - bx; bh = ry - by;
                } else if (st.tool === 'group' && st.children) {
                    const groupBounds = this._getGroupBounds(st.children);
                    bx = st.x; by = st.y;
                    bw = st.w; bh = st.h;
                } else {
                    bx = st.x; by = st.y;
                    bw = st.w || 0; bh = st.h || 0;
                }
                if (bw < 0) { bx += bw; bw = -bw; }
                if (bh < 0) { by += bh; bh = -bh; }
                minX = Math.min(minX, bx); minY = Math.min(minY, by);
                maxX = Math.max(maxX, bx + bw); maxY = Math.max(maxY, by + bh);
            });
            if (minX === Infinity) return null; // No valid items
            return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
        };

        const hitTest = (pt) => {
            const b = getSelectionBounds(); if(!b) return null;
            if(Math.hypot(pt.x-b.cx, pt.y-(b.maxY+20))<15) return 'rot';
            if(Math.hypot(pt.x-b.minX, pt.y-b.minY)<15) return 'tl'; if(Math.hypot(pt.x-b.maxX, pt.y-b.minY)<15) return 'tr';
            if(Math.hypot(pt.x-b.minX, pt.y-b.maxY)<15) return 'bl'; if(Math.hypot(pt.x-b.maxX, pt.y-b.maxY)<15) return 'br';
            if(pt.x>=b.minX && pt.x<=b.maxX && pt.y>=b.minY && pt.y<=b.maxY) return 'move';
            return null;
        };

        const syncSidebarToSelection = () => {
            if(this.state.selection.length > 0) {
                const img = this.state.images[this.state.idx];
                const first = img.history[this.state.selection[0]];
                const slider = this.getElement('brushSize');
                const label = this.getElement('sizeLabel');
                const panel = this.getElement('toolSettingsPanel');
                if (panel) panel.style.display = 'block';
                if (slider && label) {
                    if(first.tool === 'pen' || first.tool === 'eraser') { slider.value = first.size; label.innerText = "Stroke Size"; }
                    else if(first.tool === 'shape') { slider.value = first.width; label.innerText = "Border Width"; }
                    else if(first.tool === 'text') { slider.value = first.size; label.innerText = "Text Size"; }
                }
                // Update rotation display and aspect ratio checkbox
                this._updateRotationDisplay();
                const ctxAspect = document.getElementById('ctxAspectRatio');
                const sidebarAspect = this.getElement('sidebarAspectRatio');
                if (ctxAspect) ctxAspect.checked = this.state.keepAspectRatio || false;
                if (sidebarAspect) sidebarAspect.checked = this.state.keepAspectRatio || false;
            }
        };

        c.onpointerdown = e => {
            if (e.pointerType === "touch" && !e.isPrimary) return;
            const pt = getPt(e); startPt = pt;
            this.lastScreenX = e.clientX;
            this.lastScreenY = e.clientY;

            // Eyedropper mode
            if(this.state.eyedropperMode) {
                const ctx = c.getContext('2d', {willReadFrequently: true});
                const r = c.getBoundingClientRect();
                const screenX = (e.clientX - r.left)*(c.width/r.width);
                const screenY = (e.clientY - r.top)*(c.height/r.height);
                const pixelData = ctx.getImageData(Math.floor(screenX), Math.floor(screenY), 1, 1).data;
                const hex = '#' + [pixelData[0], pixelData[1], pixelData[2]].map(x => x.toString(16).padStart(2, '0')).join('');
                this.state.colors.push({hex, lab: this.rgbToLab(pixelData[0], pixelData[1], pixelData[2])});
                this.renderSwatches();
                this.saveSessionState();
                if (this.liveSync) this.liveSync.updateColors(this.state.colors);
                this.state.eyedropperMode = false;
                const btn = this.getElement('eyedropperBtn');
                if(btn) { btn.style.background = ''; btn.style.color = ''; }
                this.ui.showToast('Color added: ' + hex);
                return;
            }

            if(this.state.tool === 'text') {
                this._showInlineTextEditor(pt);
                return;
            }

            if(['none','lasso'].includes(this.state.tool) && this.state.selection.length>0) {
                const hit = hitTest(pt);
                if(hit) {
                    // Check if any selected items are locked - prevent move/resize/rotate but allow selection
                    const img = this.state.images[this.state.idx];
                    const hasLockedItems = this.state.selection.some(i => img.history[i].locked);

                    if (hasLockedItems && hit !== 'none') {
                        // Allow clicking but show toast for move/resize/rotate attempts
                        if (hit === 'move' || hit === 'rot' || ['tl','tr','bl','br'].includes(hit)) {
                            this.ui.showToast('Cannot modify locked items. Press L to unlock.');
                            return;
                        }
                    }

                    startBounds = getSelectionBounds();
                    initialHistoryState = this.state.selection.map(i => JSON.parse(JSON.stringify(img.history[i])));
                    if(hit==='rot') { isRotating=true; startRotation = Math.atan2(pt.y - startBounds.cy, pt.x - startBounds.cx); }
                    else if(hit==='move') { isMovingSelection=true; dragStart=pt; this.dragOffset={x:0,y:0}; }
                    else { isResizing=true; resizeHandle=hit; }
                    return;
                }
            }

            if(this.state.selection.length) {
                this.state.selection=[];
                const tb = this.getElement('contextToolbar');
                if(tb) tb.style.display='none';
                this.setTool(this.state.tool); this.render();
                if(this.state.tool==='none') return;
            }

            this.isDragging = true;
            // Reset stabilization on stroke start
            this._resetStabilization();
            if(this.state.tool==='lasso') lassoPath=[pt]; else if(this.state.tool!=='shape' && this.state.tool!=='capture') this.currentStroke=[pt];
        };

        const onPointerMove = e => {
            // Scope: Only process events if this instance is active
            // Check if we're dragging, resizing, rotating OR if the event target is within our container
            const isInteracting = this.isDragging || isMovingSelection || isResizing || isRotating;
            const isOurEvent = isInteracting ||
                               (this.container ? this.container.contains(e.target) : true);
            if (!isOurEvent) return;

            if (lastPinchDist !== null) return;
            // Only process if target is our canvas or we are interacting
            if (!isInteracting && e.target !== c) return;

            const pt = getPt(e);

            const now = Date.now();
            if (now - this.lastCursorUpdateTime > this.cursorUpdateThrottle) {
                this.lastCursorUpdateTime = now;
                if (this.liveSync && !this.liveSync.isInitializing) {
                    const isDrawing = this.isDragging && ['pen', 'eraser'].includes(this.state.tool);
                    this.liveSync.updateCursor(
                        pt,
                        this.state.tool,
                        isDrawing,
                        this.state.penColor,
                        this.state.tool === 'eraser' ? this.state.eraserSize : this.state.penSize
                    );
                }
            }

            if(isMovingSelection) {
                let dx = pt.x - dragStart.x;
                let dy = pt.y - dragStart.y;

                // Apply grid snapping if enabled
                if (this.state.snapToGrid) {
                    const bounds = getSelectionBounds();
                    if (bounds) {
                        const snappedMinX = this._snapToGrid(bounds.minX + dx);
                        const snappedMinY = this._snapToGrid(bounds.minY + dy);
                        dx = snappedMinX - bounds.minX;
                        dy = snappedMinY - bounds.minY;
                    }
                }

                // Apply object snapping (smart guides) if enabled
                if (this.state.snapToObjects) {
                    const bounds = getSelectionBounds();
                    if (bounds) {
                        const movingBounds = {
                            minX: bounds.minX + dx,
                            minY: bounds.minY + dy,
                            maxX: bounds.maxX + dx,
                            maxY: bounds.maxY + dy,
                            w: bounds.w,
                            h: bounds.h
                        };
                        const snapResult = this._findObjectSnaps(movingBounds, this.state.selection, 8);
                        dx += snapResult.snapDx || 0;
                        dy += snapResult.snapDy || 0;
                    }
                }

                this.dragOffset = { x: dx, y: dy };
                this.render();
                return;
            }

            // Handle resize during drag
            if(isResizing && startBounds && resizeHandle) {
                const img = this.state.images[this.state.idx];
                let dx = pt.x - startPt.x;
                let dy = pt.y - startPt.y;

                // Alt key = scale from center
                const scaleFromCenter = e.altKey;

                // Calculate aspect ratio constraint if enabled
                const keepAspect = this.state.keepAspectRatio;
                if (keepAspect && startBounds.w > 0 && startBounds.h > 0) {
                    const aspectRatio = startBounds.w / startBounds.h;
                    // Use the larger movement to determine scale
                    if (Math.abs(dx) > Math.abs(dy)) {
                        dy = dx / aspectRatio;
                    } else {
                        dx = dy * aspectRatio;
                    }
                }

                this.state.selection.forEach((idx, i) => {
                    const st = img.history[idx];
                    const orig = initialHistoryState[i];
                    if (!st || !orig) return;

                    // For pen/eraser strokes, calculate bounds from points
                    if (st.tool === 'pen' || st.tool === 'eraser') {
                        const origBounds = this._getPenBounds(orig.pts);
                        if (!origBounds || origBounds.w === 0 || origBounds.h === 0) return;

                        // Calculate new bounds based on handle
                        let newMinX = origBounds.minX, newMinY = origBounds.minY;
                        let newMaxX = origBounds.maxX, newMaxY = origBounds.maxY;

                        if (scaleFromCenter) {
                            // Scale from center: apply delta to both sides
                            if (resizeHandle.includes('l') || resizeHandle.includes('r')) {
                                newMinX -= dx;
                                newMaxX += dx;
                            }
                            if (resizeHandle.includes('t') || resizeHandle.includes('b')) {
                                newMinY -= dy;
                                newMaxY += dy;
                            }
                        } else {
                            if (resizeHandle.includes('l')) newMinX += dx;
                            if (resizeHandle.includes('r')) newMaxX += dx;
                            if (resizeHandle.includes('t')) newMinY += dy;
                            if (resizeHandle.includes('b')) newMaxY += dy;
                        }

                        const newW = newMaxX - newMinX;
                        const newH = newMaxY - newMinY;
                        const scaleX = newW / origBounds.w;
                        const scaleY = newH / origBounds.h;

                        // Prevent collapse
                        if (Math.abs(scaleX) < 0.01 || Math.abs(scaleY) < 0.01) return;

                        // Scale points relative to original bounds
                        st.pts = orig.pts.map(p => ({
                            x: newMinX + (p.x - origBounds.minX) * scaleX,
                            y: newMinY + (p.y - origBounds.minY) * scaleY
                        }));
                    } else if (st.tool === 'group' && st.children && orig.children) {
                        // Handle group resize - scale the group and all its children
                        let newX = orig.x, newY = orig.y, newW = orig.w, newH = orig.h;

                        if (scaleFromCenter) {
                            // Scale from center for groups
                            if (resizeHandle.includes('r') || resizeHandle.includes('l')) {
                                newW = orig.w + dx * 2;
                                newX = orig.x - dx;
                            }
                            if (resizeHandle.includes('b') || resizeHandle.includes('t')) {
                                newH = orig.h + dy * 2;
                                newY = orig.y - dy;
                            }
                        } else {
                            if (resizeHandle.includes('r')) newW = orig.w + dx;
                            if (resizeHandle.includes('l')) { newX = orig.x + dx; newW = orig.w - dx; }
                            if (resizeHandle.includes('b')) newH = orig.h + dy;
                            if (resizeHandle.includes('t')) { newY = orig.y + dy; newH = orig.h - dy; }
                        }

                        // Calculate scale factors
                        const scaleX = orig.w !== 0 ? newW / orig.w : 1;
                        const scaleY = orig.h !== 0 ? newH / orig.h : 1;

                        // Prevent collapse
                        if (Math.abs(scaleX) < 0.01 || Math.abs(scaleY) < 0.01) return;

                        // Update group bounds
                        st.x = newX;
                        st.y = newY;
                        st.w = newW;
                        st.h = newH;

                        // Scale all children relative to original group position
                        st.children = orig.children.map(origChild => {
                            const child = JSON.parse(JSON.stringify(origChild));
                            if (child.tool === 'pen' || child.tool === 'eraser') {
                                if (child.pts) {
                                    child.pts = child.pts.map(p => ({
                                        x: newX + (p.x - orig.x) * scaleX,
                                        y: newY + (p.y - orig.y) * scaleY
                                    }));
                                }
                            } else {
                                // Scale position and size for shapes/text
                                child.x = newX + (child.x - orig.x) * scaleX;
                                child.y = newY + (child.y - orig.y) * scaleY;
                                if (child.w !== undefined) child.w = child.w * scaleX;
                                if (child.h !== undefined) child.h = child.h * scaleY;
                            }
                            return child;
                        });
                    } else {
                        // For shapes/text with x, y, w, h
                        let newX = orig.x, newY = orig.y, newW = orig.w, newH = orig.h;

                        if (scaleFromCenter) {
                            // Scale from center: apply delta to both sides
                            if (resizeHandle.includes('r') || resizeHandle.includes('l')) {
                                newW = orig.w + dx * 2;
                                newX = orig.x - dx;
                            }
                            if (resizeHandle.includes('b') || resizeHandle.includes('t')) {
                                newH = orig.h + dy * 2;
                                newY = orig.y - dy;
                            }
                        } else {
                            // Standard resize
                            if (resizeHandle.includes('r')) {
                                newW = orig.w + dx;
                            }
                            if (resizeHandle.includes('l')) {
                                newX = orig.x + dx;
                                newW = orig.w - dx;
                            }
                            if (resizeHandle.includes('b')) {
                                newH = orig.h + dy;
                            }
                            if (resizeHandle.includes('t')) {
                                newY = orig.y + dy;
                                newH = orig.h - dy;
                            }
                        }

                        // For aspect ratio constraint
                        if (keepAspect && orig.w !== 0 && orig.h !== 0) {
                            const origAspect = Math.abs(orig.w) / Math.abs(orig.h);
                            if (resizeHandle.length === 2) {
                                // Corner resize - use uniform scale
                                const scale = Math.max(Math.abs(newW / orig.w), Math.abs(newH / orig.h));
                                newW = orig.w * scale * Math.sign(newW || 1);
                                newH = orig.h * scale * Math.sign(newH || 1);
                                if (scaleFromCenter) {
                                    // Keep centered
                                    const centerX = orig.x + orig.w / 2;
                                    const centerY = orig.y + orig.h / 2;
                                    newX = centerX - newW / 2;
                                    newY = centerY - newH / 2;
                                } else {
                                    if (resizeHandle.includes('l')) newX = orig.x + orig.w - newW;
                                    if (resizeHandle.includes('t')) newY = orig.y + orig.h - newH;
                                }
                            }
                        }

                        st.x = newX;
                        st.y = newY;
                        st.w = newW;
                        st.h = newH;
                    }
                });

                this.render();
                return;
            }

            // Handle rotation during drag
            if(isRotating && startBounds) {
                const img = this.state.images[this.state.idx];
                const currentAngle = Math.atan2(pt.y - startBounds.cy, pt.x - startBounds.cx);
                const deltaAngle = currentAngle - startRotation;

                this.state.selection.forEach((idx, i) => {
                    const st = img.history[idx];
                    const orig = initialHistoryState[i];

                    if (st.tool === 'pen' || st.tool === 'eraser') {
                        // Rotate pen points around the center of the selection
                        st.pts = orig.pts.map(p => {
                            const rx = p.x - startBounds.cx;
                            const ry = p.y - startBounds.cy;
                            const cos = Math.cos(deltaAngle);
                            const sin = Math.sin(deltaAngle);
                            return {
                                x: startBounds.cx + rx * cos - ry * sin,
                                y: startBounds.cy + rx * sin + ry * cos
                            };
                        });
                    } else {
                        // For shapes/text, update rotation property
                        st.rotation = (orig.rotation || 0) + deltaAngle;
                    }
                });

                // Update rotation display in UI
                this._updateRotationDisplay();
                this.render();
                return;
            }

            if (this.state.tool === 'hand' && this.isDragging) {
                const dx = e.clientX - this.lastScreenX;
                const dy = e.clientY - this.lastScreenY;
                this.state.pan.x += dx;
                this.state.pan.y += dy;
                this.lastScreenX = e.clientX;
                this.lastScreenY = e.clientY;
                this.render();
                return;
            }

            if(!this.isDragging) return;

            if(this.state.tool==='lasso') {
                // Add the point to the lasso path (in document coordinates)
                lassoPath.push(pt);

                // Redraw the canvas to clear previous content and draw the lasso on top
                this.render();

                // Draw the lasso path on top of the current canvas with proper transforms
                const ctx = c.getContext('2d');
                ctx.save();
                ctx.translate(this.state.pan.x, this.state.pan.y);
                ctx.scale(this.state.zoom, this.state.zoom);

                ctx.strokeStyle = '#3b82f6';
                ctx.setLineDash([5, 5]);
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(lassoPath[0].x, lassoPath[0].y);

                for (let i = 1; i < lassoPath.length - 1; i++) {
                    const xc = (lassoPath[i].x + lassoPath[i + 1].x) / 2;
                    const yc = (lassoPath[i].y + lassoPath[i + 1].y) / 2;
                    ctx.quadraticCurveTo(lassoPath[i].x, lassoPath[i].y, xc, yc);
                }

                ctx.lineTo(lassoPath[lassoPath.length - 1].x, lassoPath[lassoPath.length - 1].y);
                ctx.stroke();

                ctx.restore();
            }
            else if(this.state.tool==='shape' || this.state.tool==='capture') {
                let w=pt.x-startPt.x, h=pt.y-startPt.y;
                if(this.state.tool==='shape' && (e.shiftKey || ['rectangle','circle'].includes(this.state.shapeType))) { if(e.shiftKey || Math.abs(Math.abs(w)-Math.abs(h))<15) { const s=Math.max(Math.abs(w),Math.abs(h)); w=(w<0?-1:1)*s; h=(h<0?-1:1)*s; } }

                // Update the canvas to show the shape preview during drag
                this.render();

                // Draw the shape preview on top of the current canvas
                const ctx = c.getContext('2d');
                ctx.save();

                // Apply the same transforms as the main render function
                ctx.translate(this.state.pan.x, this.state.pan.y);
                ctx.scale(this.state.zoom, this.state.zoom);

                if(this.state.tool === 'capture') {
                    ctx.strokeStyle = '#10b981';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([5,5]);
                    ctx.strokeRect(startPt.x, startPt.y, w, h);
                } else {
                    // Draw the shape preview
                    this.renderObject(ctx, {
                        tool:'shape',
                        shapeType:this.state.shapeType,
                        x:startPt.x,
                        y:startPt.y,
                        w:w,
                        h:h,
                        border:this.state.shapeBorder,
                        fill:this.state.shapeFill,
                        width:this.state.shapeWidth
                    });
                }

                ctx.restore();
            }
            else if(['pen','eraser'].includes(this.state.tool)) {
                if (this.state.tool === 'eraser' && this.state.eraserType === 'stroke') {
                    const img = this.state.images[this.state.idx];
                    const eraserR = this.state.eraserSize / 2;
                    let changed = false;

                    // Get eraser options, default to all enabled if not set
                    const options = this.state.eraserOptions || {
                        scribble: true,
                        text: true,
                        shapes: true,
                        images: false
                    };

                    for (let i = img.history.length - 1; i >= 0; i--) {
                        const st = img.history[i];
                        if (st.locked || st.deleted) continue; // Skip locked and already deleted items

                        let hit = false;
                        let shouldErase = false;

                        if (st.tool === 'pen' || st.tool === 'eraser') {
                            // Check if we should erase scribbles
                            if (options.scribble) {
                                for (const p of st.pts) {
                                    if (Math.hypot(p.x - pt.x, p.y - pt.y) < eraserR + st.size) {
                                        hit = true; break;
                                    }
                                }
                            }
                        } else if (st.tool === 'text') {
                            // Check if we should erase text
                            if (options.text) {
                                if (pt.x >= st.x - eraserR && pt.x <= st.x + st.w + eraserR &&
                                    pt.y >= st.y - eraserR && pt.y <= st.y + st.h + eraserR) {
                                    hit = true;
                                }
                            }
                        } else if (st.tool === 'shape') {
                            // Check if we should erase shapes
                            if (options.shapes) {
                                if (pt.x >= st.x - eraserR && pt.x <= st.x + st.w + eraserR &&
                                    pt.y >= st.y - eraserR && pt.y <= st.y + st.h + eraserR) {
                                    hit = true;
                                }
                            }
                        } else if (st.tool === 'image') {
                            // Check if we should erase images
                            if (options.images) {
                                if (pt.x >= st.x - eraserR && pt.x <= st.x + st.w + eraserR &&
                                    pt.y >= st.y - eraserR && pt.y <= st.y + st.h + eraserR) {
                                    hit = true;
                                }
                            }
                        }

                        if (hit) {
                            st.deleted = true;
                            st.lastMod = Date.now();
                            changed = true;
                        }
                    }
                    if (changed) { this.invalidateCache(); this.scheduleSave(); this.render(); }
                    return;
                }

                // Apply stabilization to the point
                const stabilizedPt = this._applyStabilization(pt);
                this.currentStroke.push(stabilizedPt);

                // Expand infinite canvas if drawing near edges
                if (this.expandInfiniteCanvasIfNeeded) {
                    this.expandInfiniteCanvasIfNeeded(stabilizedPt.x, stabilizedPt.y);
                }

                const ctx=c.getContext('2d');
                ctx.save();
                ctx.translate(this.state.pan.x, this.state.pan.y);
                ctx.scale(this.state.zoom, this.state.zoom);
                ctx.lineCap='round'; ctx.lineJoin='round'; ctx.lineWidth=this.state.tool==='eraser'?this.state.eraserSize:this.state.penSize;
                ctx.strokeStyle=this.state.tool==='eraser'?(this.state.bg==='transparent'?'#000':this.state.bg):this.state.penColor;
                if(this.state.tool==='eraser'&&this.state.bg==='transparent') ctx.globalCompositeOperation='destination-out';
                ctx.beginPath(); ctx.moveTo(this.currentStroke[this.currentStroke.length-2].x, this.currentStroke[this.currentStroke.length-2].y); ctx.lineTo(stabilizedPt.x,stabilizedPt.y); ctx.stroke(); ctx.restore();
            }
        };

        window.addEventListener('pointermove', onPointerMove, { passive: true });

        // Only main app listens to window resize for cursor re-rendering
        if (this.config.isMain) {
            window.addEventListener('resize', () => {
                if (this.liveSync && this.liveSync.renderCursors) this.liveSync.renderCursors();

                // Update infinite canvas dimensions on resize
                const currentPage = this.state.images[this.state.idx];
                if (currentPage && currentPage.isInfinite) {
                    const viewport = this.getElement('viewport');
                    const canvas = this.getElement('canvas');
                    if (viewport && canvas) {
                        const vRect = viewport.getBoundingClientRect();
                        canvas.width = vRect.width;
                        canvas.height = vRect.height;
                        this.state.viewW = canvas.width;
                        this.state.viewH = canvas.height;
                        this.render();
                    }
                }
            });
        }
        const vp = this.getElement('viewport');
        if(vp) vp.addEventListener('scroll', () => this.liveSync && this.liveSync.renderCursors && this.liveSync.renderCursors(), { passive: true });

        // --- Zoom & Pan Logic ---
        let lastPinchDist = null;
        let lastMidpoint = null;
        let pinchGestureDebounce = null;

        c.addEventListener('wheel', e => {
            if (e.ctrlKey) {
                e.preventDefault();
                const r = c.getBoundingClientRect();
                const mouseX = (e.clientX - r.left) * (c.width / r.width);
                const mouseY = (e.clientY - r.top) * (c.height / r.height);
                const zoomSpeed = 0.001;
                const delta = -e.deltaY;
                const factor = Math.pow(1.1, delta / 100);
                const newZoom = Math.min(Math.max(this.state.zoom * factor, 0.1), 10);
                this.state.pan.x = mouseX - (mouseX - this.state.pan.x) * (newZoom / this.state.zoom);
                this.state.pan.y = mouseY - (mouseY - this.state.pan.y) * (newZoom / this.state.zoom);
                this.state.zoom = newZoom;
                this.updateZoomIndicator();
                this.render();
            } else if (this.state.tool === 'none' || e.shiftKey) {
                e.preventDefault();
                this.state.pan.x -= e.deltaX;
                this.state.pan.y -= e.deltaY;
                this.render();
            }
        }, { passive: false });

        c.addEventListener('touchstart', e => {
            if (e.touches.length === 2) {
                // Debounce: Don't immediately cancel stroke - wait a moment
                if (pinchGestureDebounce) clearTimeout(pinchGestureDebounce);

                pinchGestureDebounce = setTimeout(() => {
                    // Store stroke data temporarily in case we need it
                    this._pendingStroke = this.currentStroke;
                    this.isDragging = false;
                    this.currentStroke = null;
                }, 50); // 50ms delay before canceling stroke

                lastPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                lastMidpoint = {
                    x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                    y: (e.touches[0].clientY + e.touches[1].clientY) / 2
                };
            }
        }, { passive: true });

        c.addEventListener('touchmove', e => {
            if (e.touches.length === 2 && lastPinchDist !== null && lastMidpoint !== null) {
                e.preventDefault();

                // Clear any pending stroke data since we're definitely pinching
                if (this._pendingStroke) {
                    this._pendingStroke = null;
                }

                const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                const factor = dist / lastPinchDist;
                const curMidpoint = {
                    x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                    y: (e.touches[0].clientY + e.touches[1].clientY) / 2
                };
                const r = c.getBoundingClientRect();
                const centerX = (curMidpoint.x - r.left) * (c.width / r.width);
                const centerY = (curMidpoint.y - r.top) * (c.height / r.height);
                const newZoom = Math.min(Math.max(this.state.zoom * factor, 0.1), 10);
                this.state.pan.x += (curMidpoint.x - lastMidpoint.x) * (c.width / r.width);
                this.state.pan.y += (curMidpoint.y - lastMidpoint.y) * (c.height / r.height);
                this.state.pan.x = centerX - (centerX - this.state.pan.x) * (newZoom / this.state.zoom);
                this.state.pan.y = centerY - (centerY - this.state.pan.y) * (newZoom / this.state.zoom);
                this.state.zoom = newZoom;
                lastPinchDist = dist;
                lastMidpoint = curMidpoint;
                this.updateZoomIndicator();
                this.render();
            }
        }, { passive: false });

        c.addEventListener('touchend', e => {
            if (e.touches.length < 2) {
                // Clear pinch debounce
                if (pinchGestureDebounce) {
                    clearTimeout(pinchGestureDebounce);
                    pinchGestureDebounce = null;
                }
                lastPinchDist = null;
                lastMidpoint = null;
            }
        }, { passive: true });

        window.addEventListener('pointerup', e => {
            // Scope: Only process if this instance was actively dragging or selecting
            // This check prevents other instances from stealing our pointerup
            const wasOurInteraction = this.isDragging || isMovingSelection || isResizing || isRotating;
            if (!wasOurInteraction) return;

            if(isMovingSelection) {
                // Push undo state before finalizing move
                if (initialHistoryState.length > 0 && this.state.selection.length > 0) {
                    const img = this.state.images[this.state.idx];
                    if (!img._modificationUndo) img._modificationUndo = [];
                    img._modificationRedo = []; // Clear redo on new action
                    img._modificationUndo.push({
                        type: 'move',
                        indices: [...this.state.selection],
                        items: initialHistoryState.map((state, i) => ({
                            idx: this.state.selection[i],
                            state: state
                        }))
                    });
                }

                isMovingSelection=false;
                this.state.selection.forEach(idx => {
                    const st = this.state.images[this.state.idx].history[idx];
                    if (st.tool === 'pen' || st.tool === 'eraser') {
                        st.pts.forEach(p => { p.x += this.dragOffset.x; p.y += this.dragOffset.y; });
                    } else if (st.tool === 'group' && st.children) {
                        st.x += this.dragOffset.x;
                        st.y += this.dragOffset.y;
                        st.children.forEach(child => {
                            if (child.tool === 'pen' || child.tool === 'eraser') {
                                child.pts.forEach(p => { p.x += this.dragOffset.x; p.y += this.dragOffset.y; });
                            } else {
                                child.x += this.dragOffset.x;
                                child.y += this.dragOffset.y;
                            }
                        });
                    } else {
                        st.x += this.dragOffset.x;
                        st.y += this.dragOffset.y;
                    }
                    st.lastMod = Date.now();
                });
                this.dragOffset = null;
                initialHistoryState = [];
                this._clearSnapGuides();
                this.invalidateCache();
                this.saveCurrentImg();
                this.render();
                return;
            }

            // Finalize resize operation
            if(isResizing) {
                // Push undo state before finalizing resize
                if (initialHistoryState.length > 0 && this.state.selection.length > 0) {
                    const img = this.state.images[this.state.idx];
                    if (!img._modificationUndo) img._modificationUndo = [];
                    img._modificationRedo = [];
                    img._modificationUndo.push({
                        type: 'resize',
                        indices: [...this.state.selection],
                        items: initialHistoryState.map((state, i) => ({
                            idx: this.state.selection[i],
                            state: state
                        }))
                    });
                }

                isResizing = false;
                resizeHandle = null;
                initialHistoryState = [];
                startBounds = null;
                this.invalidateCache();
                this.saveCurrentImg();
                this.render();
                return;
            }

            // Finalize rotation operation
            if(isRotating) {
                // Push undo state before finalizing rotation
                if (initialHistoryState.length > 0 && this.state.selection.length > 0) {
                    const img = this.state.images[this.state.idx];
                    if (!img._modificationUndo) img._modificationUndo = [];
                    img._modificationRedo = [];
                    img._modificationUndo.push({
                        type: 'rotate',
                        indices: [...this.state.selection],
                        items: initialHistoryState.map((state, i) => ({
                            idx: this.state.selection[i],
                            state: state
                        }))
                    });
                }

                isRotating = false;
                initialHistoryState = [];
                startBounds = null;
                startRotation = 0;
                this.invalidateCache();
                this.saveCurrentImg();
                this.render();
                return;
            }

            if(!this.isDragging) {
                // Send a final update on pointer up even if not dragging, to clear drawing state
                if (this.liveSync) {
                    this.liveSync.updateCursor(getPt(e), this.state.tool, false, this.state.penColor, 0);
                }
                return;
            }
            this.isDragging=false;

            // Clear pending shape if we were drawing one
            if (this.pendingShape) {
                delete this.pendingShape;
            }

            // Send a final update to clear the live trail for other users
            if (this.liveSync) {
                this.liveSync.updateCursor(getPt(e), this.state.tool, false, this.state.penColor, 0);
            }

            const pt = getPt(e);
            if(this.state.tool==='lasso') {
                // Calculate bounding box of lasso path
                let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
                lassoPath.forEach(p=>{minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);});

                this.state.selection=[];

                // The lassoPath points are in document coordinates (converted by getPt function)
                // So we need to compare with object coordinates in document space
                this.state.images[this.state.idx].history.forEach((st,i)=>{
                    if(st.deleted) return; // Skip deleted but allow locked items to be selected

                    // Filter by lasso options
                    if(!this._filterByLassoOptions(st)) return;

                    // Check if object intersects with lasso (partial selection)
                    if(this._doesObjectIntersectLasso(st, lassoPath)) {
                        this.state.selection.push(i);
                    }
                });

                syncSidebarToSelection();
                this.render();

                // Clear the lasso path after selection is complete
                lassoPath = [];
            } else if(this.state.tool==='shape') {
                // Calculate width and height from the startPt and current pt
                let w = pt.x - startPt.x;
                let h = pt.y - startPt.y;

                if(Math.abs(w)>2 || Math.abs(h)>2) { // Allow for very thin shapes
                    this._clearRedoStack(); // Clear redo when adding new item
                    const newShape = {
                        id: Date.now() + Math.random(),
                        lastMod: Date.now(),
                        tool: 'shape',
                        shapeType: this.state.shapeType,
                        x: startPt.x,
                        y: startPt.y,
                        w: w,
                        h: h,
                        border: this.state.shapeBorder,
                        fill: this.state.shapeFill,
                        width: this.state.shapeWidth,
                        rotation: 0
                    };

                    this.state.images[this.state.idx].history.push(newShape);
                    this.saveCurrentImg();
                    this.state.selection=[this.state.images[this.state.idx].history.length-1];
                    this.setTool('lasso');
                    syncSidebarToSelection();

                    // Ensure the shape is rendered immediately for the owner
                    this.render();

                    // Synchronize with Liveblocks if in collaborative mode
                    if (this.liveSync) {
                        this.liveSync.addStroke(this.state.idx, newShape);
                    }
                }
            } else if(this.state.tool==='capture') {
                let w = pt.x - startPt.x, h = pt.y - startPt.y;
                if(w < 0) { startPt.x += w; w = Math.abs(w); }
                if(h < 0) { startPt.y += h; h = Math.abs(h); }
                if(w > 5 && h > 5) this.addToBox(startPt.x, startPt.y, w, h);
                this.render();

                // Clear the pending shape if it was for capture
                if (this.pendingShape && this.pendingShape.tool === 'capture') {
                    delete this.pendingShape;
                }
            } else if(['pen','eraser'].includes(this.state.tool)) {
                // Check for hold-to-shape conversion (pen only)
                if (this.state.tool === 'pen' && this.state.holdToShape && this.currentStroke && this.currentStroke.length > 10) {
                    const shapeObj = this._convertToShape(this.currentStroke);
                    if (shapeObj) {
                        // Convert stroke to shape
                        this._clearRedoStack(); // Clear redo when adding new item
                        this.state.images[this.state.idx].history.push(shapeObj);
                        this.saveCurrentImg(true);
                        if (this.liveSync && !this.liveSync.isInitializing) {
                            this.liveSync.addStroke(this.state.idx, shapeObj);
                        }
                        this.ui.showToast(`Converted to ${shapeObj.shapeType}`);
                        this.render();
                        return;
                    }
                }

                // Normal stroke
                this._clearRedoStack(); // Clear redo when adding new item
                const newStroke = {id: Date.now() + Math.random(), lastMod: Date.now(), tool:this.state.tool, pts:this.currentStroke, color:this.state.penColor, size:this.state.tool==='eraser'?this.state.eraserSize:this.state.penSize, deleted: false};
                this.state.images[this.state.idx].history.push(newStroke);
                this.saveCurrentImg(true);
                if (this.liveSync && !this.liveSync.isInitializing) {
                    this.liveSync.addStroke(this.state.idx, newStroke);
                }
                this.render();
            } else if (this.state.tool === 'eraser' && this.state.eraserType !== 'stroke') {
                // Regular eraser (area-based) with options
                const img = this.state.images[this.state.idx];
                const eraserR = this.state.eraserSize / 2;
                let changed = false;

                // Get eraser options, default to all enabled if not set
                const options = this.state.eraserOptions || {
                    scribble: true,
                    text: true,
                    shapes: true,
                    images: false
                };

                for (let i = img.history.length - 1; i >= 0; i--) {
                    const st = img.history[i];
                    if (st.locked || st.deleted) continue; // Skip locked and already deleted items

                    let hit = false;

                    if (st.tool === 'pen' || st.tool === 'eraser') {
                        // Check if we should erase scribbles
                        if (options.scribble) {
                            for (const p of st.pts) {
                                if (Math.hypot(p.x - pt.x, p.y - pt.y) < eraserR + st.size) {
                                    hit = true; break;
                                }
                            }
                        }
                    } else if (st.tool === 'text') {
                        // Check if we should erase text
                        if (options.text) {
                            if (pt.x >= st.x - eraserR && pt.x <= st.x + st.w + eraserR &&
                                pt.y >= st.y - eraserR && pt.y <= st.y + st.h + eraserR) {
                                hit = true;
                            }
                        }
                    } else if (st.tool === 'shape') {
                        // Check if we should erase shapes
                        if (options.shapes) {
                            if (pt.x >= st.x - eraserR && pt.x <= st.x + st.w + eraserR &&
                                pt.y >= st.y - eraserR && pt.y <= st.y + st.h + eraserR) {
                                hit = true;
                            }
                        }
                    } else if (st.tool === 'image') {
                        // Check if we should erase images
                        if (options.images) {
                            if (pt.x >= st.x - eraserR && pt.x <= st.x + st.w + eraserR &&
                                pt.y >= st.y - eraserR && pt.y <= st.y + st.h + eraserR) {
                                hit = true;
                            }
                        }
                    }

                    if (hit) {
                        st.deleted = true;
                        st.lastMod = Date.now();
                        changed = true;
                    }
                }
                if (changed) {
                    this.invalidateCache();
                    this.scheduleSave();
                    this.render();
                }
            }
        });
    },

    setEraseOption(option, checked) {
        if (!this.state.eraserOptions) {
            this.state.eraserOptions = {
                scribble: true,
                text: true,
                shapes: true,
                images: false  // By default, don't erase images
            };
        }
        this.state.eraserOptions[option] = checked;
        console.log("Eraser options updated:", this.state.eraserOptions);
        this.saveSessionState();
    },

    setLassoOption(option, checked) {
        if (!this.state.lassoOptions) {
            this.state.lassoOptions = {
                scribble: true,
                text: true,
                shapes: true,
                images: true,
                locked: false
            };
        }
        this.state.lassoOptions[option] = checked;
        console.log("Lasso options updated:", this.state.lassoOptions);
        this.saveSessionState();
    },

    /**
     * Filters items based on lasso selection options
     */
    _filterByLassoOptions(item) {
        const options = this.state.lassoOptions || {
            scribble: true,
            text: true,
            shapes: true,
            images: true,
            locked: false
        };

        // Check locked status first
        if (item.locked && !options.locked) return false;

        if ((item.tool === 'pen' || item.tool === 'eraser') && !options.scribble) return false;
        if (item.tool === 'text' && !options.text) return false;
        if (item.tool === 'shape' && !options.shapes) return false;
        if (item.tool === 'image' && !options.images) return false;

        return true;
    },

    setEraserMode(isStrokeEraser) {
        if (!this.state.eraserOptions) {
            this.state.eraserOptions = {
                scribble: true,
                text: true,
                shapes: true,
                images: false
            };
        }
        this.state.eraserType = isStrokeEraser ? 'stroke' : 'standard';
        console.log("Eraser mode set to:", this.state.eraserType);
        this.saveSessionState();
    },

    /**
     * Enables/disables the S-Pen engine (Samsung S-Pen button support)
     */
    setSpenEngine(enabled) {
        this.state.spenEngineEnabled = enabled;

        // Save preference to localStorage
        try {
            localStorage.setItem('colorRm_spenEngineEnabled', enabled ? 'true' : 'false');
        } catch (e) {
            console.log('Could not save S-Pen preference to localStorage');
        }

        if (enabled) {
            // Re-initialize S-Pen engine
            import('../spen_engine.js')
                .then(({ initializeSPen }) => {
                    const canvas = this.getElement('canvas');
                    if (canvas) {
                        console.log('S-Pen Engine: Enabled');
                        this._spenEngineCleanup = initializeSPen(canvas);
                    }
                })
                .catch(err => {
                    console.log('S-Pen Engine not available:', err);
                });
        } else {
            // Cleanup S-Pen engine
            if (this._spenEngineCleanup) {
                this._spenEngineCleanup();
                this._spenEngineCleanup = null;
                console.log('S-Pen Engine: Disabled');
            }
        }

        this.saveSessionState();
    },

    /**
     * Loads S-Pen engine preference from localStorage
     */
    _loadSpenPreference() {
        try {
            const saved = localStorage.getItem('colorRm_spenEngineEnabled');
            // Default to true if not set
            return saved === null ? true : saved === 'true';
        } catch (e) {
            return true; // Default to enabled
        }
    },

    // Helper function to determine if a point is inside a polygon using ray casting algorithm
    isPointInPolygon(x, y, vertices) {
        let inside = false;
        for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
            const xi = vertices[i].x, yi = vertices[i].y;
            const xj = vertices[j].x, yj = vertices[j].y;

            const intersect = ((yi > y) !== (yj > y))
                && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    },

    /**
     * Checks if an object intersects with a lasso polygon (partial selection)
     * Returns true if any part of the object is inside or crosses the lasso
     * For hollow shapes (unfilled), only their edges count - not their interior
     * @param {Object} st - The stroke/object to check
     * @param {Array} lassoPath - Array of {x, y} points defining the lasso polygon
     * @returns {boolean} True if object intersects with lasso
     */
    _doesObjectIntersectLasso(st, lassoPath) {
        if (!lassoPath || lassoPath.length < 3) return false;

        // For pen/eraser strokes, check if any point is inside the lasso
        if (st.tool === 'pen' || st.tool === 'eraser') {
            if (!st.pts || st.pts.length === 0) return false;

            // Check if any point of the stroke is inside the lasso
            for (const pt of st.pts) {
                if (this.isPointInPolygon(pt.x, pt.y, lassoPath)) {
                    return true;
                }
            }

            // Also check if lasso path intersects the stroke line segments
            return this._doesLassoIntersectStroke(st.pts, lassoPath);
        }

        // For shapes - check if lasso touches the shape's edge or if corners are in lasso
        if (st.tool === 'shape') {
            const bounds = this._getItemBounds(st);
            const isHollow = !st.fill || st.fill === 'transparent' || st.fill === 'none';

            // Check if any corner is inside the lasso
            const corners = [
                { x: bounds.minX, y: bounds.minY },
                { x: bounds.maxX, y: bounds.minY },
                { x: bounds.maxX, y: bounds.maxY },
                { x: bounds.minX, y: bounds.maxY }
            ];

            for (const pt of corners) {
                if (this.isPointInPolygon(pt.x, pt.y, lassoPath)) {
                    return true;
                }
            }

            // Check if lasso edges intersect with shape edges
            if (this._doesLassoIntersectRect(bounds, lassoPath)) {
                return true;
            }

            // For filled shapes only: check if lasso is entirely inside the shape
            if (!isHollow) {
                // Check if any lasso point is inside the shape bounds
                for (const pt of lassoPath) {
                    if (pt.x >= bounds.minX && pt.x <= bounds.maxX &&
                        pt.y >= bounds.minY && pt.y <= bounds.maxY) {
                        return true;
                    }
                }
            }

            return false;
        }

        // For text, images, groups - use bounding box (they're always "filled")
        const bounds = this._getItemBounds(st);

        // Check if any corner or center is inside the lasso
        const checkPoints = [
            { x: bounds.minX, y: bounds.minY }, // top-left
            { x: bounds.maxX, y: bounds.minY }, // top-right
            { x: bounds.maxX, y: bounds.maxY }, // bottom-right
            { x: bounds.minX, y: bounds.maxY }, // bottom-left
            { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 } // center
        ];

        for (const pt of checkPoints) {
            if (this.isPointInPolygon(pt.x, pt.y, lassoPath)) {
                return true;
            }
        }

        // Check if any lasso point is inside the object's bounding box
        for (const pt of lassoPath) {
            if (pt.x >= bounds.minX && pt.x <= bounds.maxX &&
                pt.y >= bounds.minY && pt.y <= bounds.maxY) {
                return true;
            }
        }

        // Check if lasso edges intersect with object edges
        return this._doesLassoIntersectRect(bounds, lassoPath);
    },

    /**
     * Checks if lasso path intersects with a stroke's line segments
     */
    _doesLassoIntersectStroke(pts, lassoPath) {
        // Check if any lasso segment intersects any stroke segment
        for (let i = 0; i < lassoPath.length; i++) {
            const l1 = lassoPath[i];
            const l2 = lassoPath[(i + 1) % lassoPath.length];

            for (let j = 0; j < pts.length - 1; j++) {
                const s1 = pts[j];
                const s2 = pts[j + 1];

                if (this._linesIntersect(l1.x, l1.y, l2.x, l2.y, s1.x, s1.y, s2.x, s2.y)) {
                    return true;
                }
            }
        }
        return false;
    },

    /**
     * Checks if lasso path intersects with a rectangle
     */
    _doesLassoIntersectRect(bounds, lassoPath) {
        const rectEdges = [
            [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY }], // top
            [{ x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }], // right
            [{ x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }], // bottom
            [{ x: bounds.minX, y: bounds.maxY }, { x: bounds.minX, y: bounds.minY }]  // left
        ];

        for (let i = 0; i < lassoPath.length; i++) {
            const l1 = lassoPath[i];
            const l2 = lassoPath[(i + 1) % lassoPath.length];

            for (const edge of rectEdges) {
                if (this._linesIntersect(l1.x, l1.y, l2.x, l2.y,
                                          edge[0].x, edge[0].y, edge[1].x, edge[1].y)) {
                    return true;
                }
            }
        }
        return false;
    },

    /**
     * Checks if two line segments intersect
     */
    _linesIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
        const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
        if (Math.abs(denom) < 0.0001) return false; // Parallel lines

        const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
        const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

        return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
    },

    // =============================================
    // TEXT TOOL
    // =============================================

    /**
     * Sets the text size
     */
    setTextSize(size) {
        this.state.textSize = parseInt(size) || 24;
        const range = this.getElement('brushSize');
        if (range && this.state.tool === 'text') {
            range.value = this.state.textSize;
        }
        this.saveSessionState();
    },

    // =============================================
    // PEN STABILIZATION (Lazy Brush Algorithm)
    // =============================================

    /**
     * Sets the stabilization level (0-100)
     * Higher values = more smoothing/lag
     */
    setStabilization(value) {
        this.state.stabilization = parseInt(value) || 0;
        const label = this.getElement('stabilizationValue');
        if (label) label.textContent = `${this.state.stabilization}%`;

        // Save to localStorage
        try {
            localStorage.setItem('colorRm_stabilization', this.state.stabilization.toString());
        } catch (e) {
            console.log('Could not save stabilization to localStorage');
        }

        this.saveSessionState();
    },

    /**
     * Loads stabilization preference from localStorage
     */
    _loadStabilizationPreference() {
        try {
            const saved = localStorage.getItem('colorRm_stabilization');
            return saved !== null ? parseInt(saved) || 0 : 0;
        } catch (e) {
            return 0; // Default to no stabilization
        }
    },

    /**
     * Applies stabilization to a point using lazy brush algorithm
     * Creates a "pulling string" effect for smoother lines
     */
    _applyStabilization(newPoint) {
        const stab = this.state.stabilization || 0;
        if (stab === 0 || !this._lastStabilizedPoint) {
            this._lastStabilizedPoint = { ...newPoint };
            return newPoint;
        }

        // Lazy brush: the brush follows the cursor with a "string" of length based on stabilization
        // Higher stabilization = longer string = more lag but smoother
        const friction = stab / 100; // 0 to 1
        const stringLength = stab * 0.5; // Max 50px string length

        const dx = newPoint.x - this._lastStabilizedPoint.x;
        const dy = newPoint.y - this._lastStabilizedPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > stringLength) {
            // Pull the brush toward the cursor
            const pullFactor = 1 - (stringLength / dist);
            this._lastStabilizedPoint.x += dx * pullFactor * (1 - friction * 0.5);
            this._lastStabilizedPoint.y += dy * pullFactor * (1 - friction * 0.5);
        }

        return { ...this._lastStabilizedPoint };
    },

    /**
     * Resets stabilization state (call on stroke start)
     */
    _resetStabilization() {
        this._lastStabilizedPoint = null;
    },

    // =============================================
    // HOLD TO SHAPE
    // =============================================

    /**
     * Enables/disables hold-to-shape feature
     */
    setHoldToShape(enabled) {
        this.state.holdToShape = enabled;
        this.saveSessionState();
    },

    /**
     * Detects if a stroke resembles a shape and returns the shape type
     * Called when user holds still at the end of a stroke
     */
    _detectShape(points) {
        if (points.length < 5) return null;

        // Calculate bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        points.forEach(p => {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        });

        const width = maxX - minX;
        const height = maxY - minY;
        const centerX = minX + width / 2;
        const centerY = minY + height / 2;

        // Check if too small
        if (width < 20 && height < 20) return null;

        // Check if it's a line (very thin bounding box)
        const aspectRatio = Math.max(width, height) / Math.min(width, height);
        if (aspectRatio > 5) {
            return {
                type: 'line',
                x: points[0].x,
                y: points[0].y,
                w: points[points.length - 1].x - points[0].x,
                h: points[points.length - 1].y - points[0].y
            };
        }

        // Check if stroke is closed (start near end)
        const startEnd = Math.hypot(
            points[0].x - points[points.length - 1].x,
            points[0].y - points[points.length - 1].y
        );
        const isClosed = startEnd < Math.max(width, height) * 0.3;

        if (!isClosed) return null;

        // Calculate circularity: how close are points to being equidistant from center
        let totalDeviation = 0;
        const avgRadius = (width + height) / 4;
        points.forEach(p => {
            const distFromCenter = Math.hypot(p.x - centerX, p.y - centerY);
            totalDeviation += Math.abs(distFromCenter - avgRadius);
        });
        const circularity = 1 - (totalDeviation / points.length / avgRadius);

        // Calculate rectangularity: how many points are near the edges
        let edgePoints = 0;
        const edgeThreshold = Math.min(width, height) * 0.15;
        points.forEach(p => {
            const nearLeft = Math.abs(p.x - minX) < edgeThreshold;
            const nearRight = Math.abs(p.x - maxX) < edgeThreshold;
            const nearTop = Math.abs(p.y - minY) < edgeThreshold;
            const nearBottom = Math.abs(p.y - maxY) < edgeThreshold;
            if (nearLeft || nearRight || nearTop || nearBottom) edgePoints++;
        });
        const rectangularity = edgePoints / points.length;

        // Detect shape based on metrics
        if (circularity > 0.7) {
            return {
                type: 'circle',
                x: minX,
                y: minY,
                w: width,
                h: height
            };
        } else if (rectangularity > 0.6) {
            return {
                type: 'rectangle',
                x: minX,
                y: minY,
                w: width,
                h: height
            };
        }

        return null;
    },

    /**
     * Converts a stroke to a detected shape
     */
    _convertToShape(points) {
        const detected = this._detectShape(points);
        if (!detected) return null;

        return {
            id: Date.now() + Math.random(),
            lastMod: Date.now(),
            tool: 'shape',
            shapeType: detected.type,
            x: detected.x,
            y: detected.y,
            w: detected.w,
            h: detected.h,
            border: this.state.penColor,
            fill: 'transparent',
            width: this.state.penSize,
            rotation: 0
        };
    },

    /**
     * Gets bounding box of pen stroke points
     */
    _getPenBounds(pts) {
        if (!pts || pts.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pts.forEach(p => {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        });
        return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
    },

    // =============================================
    // SOTA ALIGNMENT & DISTRIBUTION
    // =============================================

    /**
     * Gets bounds for a single item
     */
    _getItemBounds(item) {
        if (item.tool === 'pen' || item.tool === 'eraser') {
            return this._getPenBounds(item.pts);
        } else if (item.tool === 'group' && item.children) {
            // For groups, return the stored group bounds
            let x = item.x, y = item.y, w = item.w || 0, h = item.h || 0;
            if (w < 0) { x += w; w = -w; }
            if (h < 0) { y += h; h = -h; }
            return { minX: x, minY: y, maxX: x + w, maxY: y + h, w, h };
        } else {
            let x = item.x, y = item.y, w = item.w || 0, h = item.h || 0;
            if (w < 0) { x += w; w = -w; }
            if (h < 0) { y += h; h = -h; }
            return { minX: x, minY: y, maxX: x + w, maxY: y + h, w, h };
        }
    },

    /**
     * Aligns selected items
     */
    alignSelection(direction) {
        if (this.state.selection.length < 2) {
            this.ui.showToast('Select at least 2 items to align');
            return;
        }

        const img = this.state.images[this.state.idx];

        // Save state for undo before making changes
        this._pushModificationUndo('align', this.state.selection);

        const items = this.state.selection.map(i => ({ idx: i, item: img.history[i], bounds: this._getItemBounds(img.history[i]) }));

        // Calculate the reference point (from all selected items)
        let targetValue;
        switch (direction) {
            case 'left':
                targetValue = Math.min(...items.map(i => i.bounds.minX));
                items.forEach(i => this._moveItemTo(i.item, targetValue, null));
                break;
            case 'center':
                const allMinX = Math.min(...items.map(i => i.bounds.minX));
                const allMaxX = Math.max(...items.map(i => i.bounds.maxX));
                targetValue = (allMinX + allMaxX) / 2;
                items.forEach(i => {
                    const itemCenterX = (i.bounds.minX + i.bounds.maxX) / 2;
                    const dx = targetValue - itemCenterX;
                    this._moveItemBy(i.item, dx, 0);
                });
                break;
            case 'right':
                targetValue = Math.max(...items.map(i => i.bounds.maxX));
                items.forEach(i => {
                    const dx = targetValue - i.bounds.maxX;
                    this._moveItemBy(i.item, dx, 0);
                });
                break;
            case 'top':
                targetValue = Math.min(...items.map(i => i.bounds.minY));
                items.forEach(i => this._moveItemTo(i.item, null, targetValue));
                break;
            case 'middle':
                const allMinY = Math.min(...items.map(i => i.bounds.minY));
                const allMaxY = Math.max(...items.map(i => i.bounds.maxY));
                targetValue = (allMinY + allMaxY) / 2;
                items.forEach(i => {
                    const itemCenterY = (i.bounds.minY + i.bounds.maxY) / 2;
                    const dy = targetValue - itemCenterY;
                    this._moveItemBy(i.item, 0, dy);
                });
                break;
            case 'bottom':
                targetValue = Math.max(...items.map(i => i.bounds.maxY));
                items.forEach(i => {
                    const dy = targetValue - i.bounds.maxY;
                    this._moveItemBy(i.item, 0, dy);
                });
                break;
        }

        this.invalidateCache();
        this.saveCurrentImg();
        this.render();

        this.ui.showToast(`Aligned ${direction}`);
    },

    /**
     * Distributes selected items evenly
     */
    distributeSelection(direction) {
        if (this.state.selection.length < 3) {
            this.ui.showToast('Select at least 3 items to distribute');
            return;
        }

        const img = this.state.images[this.state.idx];

        // Save state for undo before making changes
        this._pushModificationUndo('distribute', this.state.selection);

        const items = this.state.selection.map(i => ({ idx: i, item: img.history[i], bounds: this._getItemBounds(img.history[i]) }));

        if (direction === 'horizontal') {
            // Sort by center X
            items.sort((a, b) => ((a.bounds.minX + a.bounds.maxX) / 2) - ((b.bounds.minX + b.bounds.maxX) / 2));
            const firstCenter = (items[0].bounds.minX + items[0].bounds.maxX) / 2;
            const lastCenter = (items[items.length - 1].bounds.minX + items[items.length - 1].bounds.maxX) / 2;
            const spacing = (lastCenter - firstCenter) / (items.length - 1);

            items.forEach((item, i) => {
                const currentCenter = (item.bounds.minX + item.bounds.maxX) / 2;
                const targetCenter = firstCenter + spacing * i;
                this._moveItemBy(item.item, targetCenter - currentCenter, 0);
            });
        } else {
            // Sort by center Y
            items.sort((a, b) => ((a.bounds.minY + a.bounds.maxY) / 2) - ((b.bounds.minY + b.bounds.maxY) / 2));
            const firstCenter = (items[0].bounds.minY + items[0].bounds.maxY) / 2;
            const lastCenter = (items[items.length - 1].bounds.minY + items[items.length - 1].bounds.maxY) / 2;
            const spacing = (lastCenter - firstCenter) / (items.length - 1);

            items.forEach((item, i) => {
                const currentCenter = (item.bounds.minY + item.bounds.maxY) / 2;
                const targetCenter = firstCenter + spacing * i;
                this._moveItemBy(item.item, 0, targetCenter - currentCenter);
            });
        }

        this.invalidateCache();
        this.saveCurrentImg();
        this.render();

        this.ui.showToast(`Distributed ${direction}ly`);
    },

    /**
     * Changes layer order of selected items
     */
    changeLayerOrder(direction) {
        if (this.state.selection.length === 0) {
            this.ui.showToast('Select items first');
            return;
        }

        const img = this.state.images[this.state.idx];
        const history = img.history;

        // Sort selection indices
        const sortedSelection = [...this.state.selection].sort((a, b) => a - b);

        // Clear redo stack when reordering (modifying history)
        this._clearRedoStack();

        switch (direction) {
            case 'front':
                // Move all selected to end (maintain relative order)
                sortedSelection.forEach(idx => {
                    const item = history.splice(idx, 1)[0];
                    history.push(item);
                });
                // Update selection to new indices
                this.state.selection = sortedSelection.map((_, i) => history.length - sortedSelection.length + i);
                break;

            case 'back':
                // Move all selected to beginning (maintain relative order)
                sortedSelection.reverse().forEach((idx, i) => {
                    const item = history.splice(idx, 1)[0];
                    history.unshift(item);
                });
                this.state.selection = sortedSelection.map((_, i) => i);
                break;

            case 'forward':
                // Move each selected item one step forward
                for (let i = sortedSelection.length - 1; i >= 0; i--) {
                    const idx = sortedSelection[i];
                    if (idx < history.length - 1) {
                        [history[idx], history[idx + 1]] = [history[idx + 1], history[idx]];
                        sortedSelection[i] = idx + 1;
                    }
                }
                this.state.selection = sortedSelection;
                break;

            case 'backward':
                // Move each selected item one step backward
                for (let i = 0; i < sortedSelection.length; i++) {
                    const idx = sortedSelection[i];
                    if (idx > 0) {
                        [history[idx], history[idx - 1]] = [history[idx - 1], history[idx]];
                        sortedSelection[i] = idx - 1;
                    }
                }
                this.state.selection = sortedSelection;
                break;
        }

        this.invalidateCache();
        this.saveCurrentImg();
        this.render();
    },

    /**
     * Moves an item to absolute position
     */
    _moveItemTo(item, x, y) {
        if (item.tool === 'pen' || item.tool === 'eraser') {
            const bounds = this._getPenBounds(item.pts);
            const dx = x !== null ? x - bounds.minX : 0;
            const dy = y !== null ? y - bounds.minY : 0;
            item.pts.forEach(p => { p.x += dx; p.y += dy; });
        } else if (item.tool === 'group' && item.children) {
            // Move group and all children together
            const dx = x !== null ? x - item.x : 0;
            const dy = y !== null ? y - item.y : 0;
            if (x !== null) item.x = x;
            if (y !== null) item.y = y;
            item.children.forEach(child => {
                if (child.tool === 'pen' || child.tool === 'eraser') {
                    child.pts.forEach(p => { p.x += dx; p.y += dy; });
                } else {
                    child.x += dx;
                    child.y += dy;
                }
            });
        } else {
            if (x !== null) item.x = x;
            if (y !== null) item.y = y;
        }
        item.lastMod = Date.now();
    },

    /**
     * Moves an item by delta
     */
    _moveItemBy(item, dx, dy) {
        if (item.tool === 'pen' || item.tool === 'eraser') {
            item.pts.forEach(p => { p.x += dx; p.y += dy; });
        } else if (item.tool === 'group' && item.children) {
            // Move group and all children together
            item.x += dx;
            item.y += dy;
            item.children.forEach(child => {
                if (child.tool === 'pen' || child.tool === 'eraser') {
                    child.pts.forEach(p => { p.x += dx; p.y += dy; });
                } else {
                    child.x += dx;
                    child.y += dy;
                }
            });
        } else {
            item.x += dx;
            item.y += dy;
        }
        item.lastMod = Date.now();
    },

    // =============================================
    // INLINE TEXT EDITOR
    // =============================================

    /**
     * Shows an inline text editor on the canvas at the given position
     * @param {Object} pt - Document coordinates {x, y}
     * @param {Object} existingText - Optional existing text object to edit
     * @param {number} historyIdx - Optional history index for editing
     */
    _showInlineTextEditor(pt, existingText = null, historyIdx = null) {
        const c = this.getElement('canvas');
        const viewport = this.getElement('viewport');
        if (!c || !viewport) return;

        // Remove any existing editor
        this._removeInlineTextEditor();

        const isEditing = existingText !== null;
        const fs = isEditing ? existingText.size : this.state.textSize;
        const color = isEditing ? existingText.color : this.state.penColor;
        const initialText = isEditing ? existingText.text : '';

        // Calculate screen position from document coordinates
        const rect = c.getBoundingClientRect();
        const scaleX = rect.width / c.width;
        const scaleY = rect.height / c.height;

        const screenX = (pt.x * this.state.zoom + this.state.pan.x) * scaleX + rect.left;
        const screenY = (pt.y * this.state.zoom + this.state.pan.y) * scaleY + rect.top;

        // Create the editor container
        const editor = document.createElement('div');
        editor.id = 'inlineTextEditor';
        editor.style.cssText = `
            position: fixed;
            left: ${screenX}px;
            top: ${screenY}px;
            z-index: 1000;
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        // Create textarea for text input
        const textarea = document.createElement('textarea');
        textarea.id = 'inlineTextInput';
        textarea.value = initialText;
        textarea.placeholder = 'Type here...';
        textarea.style.cssText = `
            font-family: sans-serif;
            font-size: ${fs * this.state.zoom * scaleY}px;
            color: ${color};
            background: rgba(255, 255, 255, 0.95);
            border: 2px solid #0ea5e9;
            border-radius: 4px;
            padding: 8px 12px;
            min-width: 200px;
            min-height: 40px;
            max-width: 400px;
            resize: both;
            outline: none;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        `;

        // Create toolbar for text options
        const toolbar = document.createElement('div');
        toolbar.style.cssText = `
            display: flex;
            gap: 4px;
            background: #000;
            padding: 6px;
            border-radius: 6px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        `;

        // Size display
        const sizeLabel = document.createElement('span');
        sizeLabel.style.cssText = `
            color: #888;
            font-size: 0.7rem;
            padding: 4px 8px;
            background: #111;
            border-radius: 4px;
            font-family: monospace;
        `;
        sizeLabel.textContent = `${fs}px`;

        // Confirm button
        const confirmBtn = document.createElement('button');
        confirmBtn.innerHTML = '<i class="bi bi-check-lg"></i>';
        confirmBtn.style.cssText = `
            background: #22c55e;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9rem;
        `;

        // Cancel button
        const cancelBtn = document.createElement('button');
        cancelBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
        cancelBtn.style.cssText = `
            background: #333;
            color: #888;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9rem;
        `;

        toolbar.appendChild(sizeLabel);
        toolbar.appendChild(confirmBtn);
        toolbar.appendChild(cancelBtn);

        editor.appendChild(textarea);
        editor.appendChild(toolbar);
        document.body.appendChild(editor);

        textarea.focus();
        textarea.select();

        // Handle confirm
        const confirm = () => {
            const text = textarea.value.trim();
            if (text) {
                this._commitTextEdit(pt, text, fs, color, isEditing, historyIdx);
            }
            this._removeInlineTextEditor();
        };

        // Handle cancel
        const cancel = () => {
            this._removeInlineTextEditor();
        };

        confirmBtn.onclick = confirm;
        cancelBtn.onclick = cancel;

        // Keyboard shortcuts
        textarea.onkeydown = (e) => {
            e.stopPropagation(); // Prevent tool shortcuts from triggering
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                confirm();
            } else if (e.key === 'Escape') {
                cancel();
            }
        };

        // Click outside to confirm
        this._textEditorClickHandler = (e) => {
            if (!editor.contains(e.target)) {
                confirm();
            }
        };
        setTimeout(() => {
            document.addEventListener('pointerdown', this._textEditorClickHandler);
        }, 100);

        // Store reference for cleanup
        this._activeTextEditor = editor;
    },

    /**
     * Removes the inline text editor
     */
    _removeInlineTextEditor() {
        if (this._activeTextEditor) {
            this._activeTextEditor.remove();
            this._activeTextEditor = null;
        }
        if (this._textEditorClickHandler) {
            document.removeEventListener('pointerdown', this._textEditorClickHandler);
            this._textEditorClickHandler = null;
        }
    },

    /**
     * Commits text edit to history
     */
    _commitTextEdit(pt, text, size, color, isEditing, historyIdx) {
        const img = this.state.images[this.state.idx];

        // Calculate accurate text width using canvas
        const c = this.getElement('canvas');
        const ctx = c.getContext('2d');
        ctx.font = `${size}px sans-serif`;
        const metrics = ctx.measureText(text);
        const textWidth = metrics.width;
        const textHeight = size * 1.2; // Approximate line height

        if (isEditing && historyIdx !== null) {
            // Update existing text
            const existingItem = img.history[historyIdx];
            existingItem.text = text;
            existingItem.w = textWidth;
            existingItem.h = textHeight;
            existingItem.lastMod = Date.now();
        } else {
            // Add new text
            this._clearRedoStack(); // Clear redo when adding new item
            img.history.push({
                id: Date.now() + Math.random(),
                lastMod: Date.now(),
                tool: 'text',
                text: text,
                x: pt.x,
                y: pt.y,
                size: size,
                color: color,
                rotation: 0,
                w: textWidth,
                h: textHeight
            });
            // Select the new text
            this.state.selection = [img.history.length - 1];
        }

        this.invalidateCache();
        this.saveCurrentImg();
        this.setTool('lasso');
        this.render();

        // Sync with liveblocks if available - saveCurrentImg already handles sync via setHistory
        // For new text, we also call addStroke for immediate visibility
        if (this.liveSync && !this.liveSync.isInitializing && !isEditing) {
            const item = img.history[img.history.length - 1];
            this.liveSync.addStroke(this.state.idx, item);
        }
    },

    /**
     * Edit text on double-click
     * @param {Object} pt - Document coordinates
     */
    _editTextAtPoint(pt) {
        const img = this.state.images[this.state.idx];
        if (!img || !img.history) return false;

        // Find text item at this point (reverse order to get topmost)
        for (let i = img.history.length - 1; i >= 0; i--) {
            const item = img.history[i];
            if (item.tool === 'text' && !item.deleted && !item.locked) {
                // Check if point is within text bounds
                const textX = item.x;
                const textY = item.y;
                const textW = item.w || item.size * item.text.length * 0.6;
                const textH = item.h || item.size;

                if (pt.x >= textX && pt.x <= textX + textW &&
                    pt.y >= textY - textH && pt.y <= textY) {
                    // Found text to edit
                    this._showInlineTextEditor({ x: textX, y: textY }, item, i);
                    return true;
                }
            }
        }
        return false;
    },

    /**
     * Edit selected text (called from context toolbar)
     */
    editSelectedText() {
        if (this.state.selection.length !== 1) return;

        const img = this.state.images[this.state.idx];
        const idx = this.state.selection[0];
        const item = img.history[idx];

        if (item && item.tool === 'text' && !item.locked) {
            this._showInlineTextEditor({ x: item.x, y: item.y }, item, idx);
        }
    },

    // =============================================
    // GROUP / UNGROUP
    // =============================================

    /**
     * Groups selected items into a single group object
     */
    groupSelected() {
        if (this.state.selection.length < 2) {
            this.ui.showToast('Select at least 2 items to group');
            return;
        }

        const img = this.state.images[this.state.idx];
        const history = img.history;

        // Sort selection by index (ascending) to maintain z-order
        const sortedSelection = [...this.state.selection].sort((a, b) => a - b);

        // Collect items to group
        const itemsToGroup = sortedSelection.map(i => JSON.parse(JSON.stringify(history[i])));

        // Calculate combined bounding box
        const bounds = this._getGroupBounds(itemsToGroup);

        // Create group object
        const groupObj = {
            id: Date.now() + Math.random(),
            lastMod: Date.now(),
            tool: 'group',
            x: bounds.minX,
            y: bounds.minY,
            w: bounds.w,
            h: bounds.h,
            children: itemsToGroup,
            deleted: false,
            locked: false
        };

        // Mark original items as deleted (we keep them for undo purposes)
        sortedSelection.forEach(i => {
            history[i].deleted = true;
            history[i].lastMod = Date.now();
        });

        // Add group to history
        this._clearRedoStack(); // Clear redo when adding new item
        history.push(groupObj);

        // Select the new group
        this.state.selection = [history.length - 1];

        this.invalidateCache();
        this.saveCurrentImg();
        this.render();

        // Sync with liveblocks - addStroke for the new group object
        // saveCurrentImg already syncs via setHistory
        if (this.liveSync) {
            this.liveSync.addStroke(this.state.idx, groupObj);
        }

        this.ui.showToast(`Grouped ${itemsToGroup.length} items`);
    },

    /**
     * Ungroups the selected group back into individual items
     */
    ungroupSelected() {
        if (this.state.selection.length !== 1) {
            this.ui.showToast('Select a single group to ungroup');
            return;
        }

        const img = this.state.images[this.state.idx];
        const history = img.history;
        const groupIdx = this.state.selection[0];
        const groupObj = history[groupIdx];

        if (!groupObj || groupObj.tool !== 'group') {
            this.ui.showToast('Selected item is not a group');
            return;
        }

        // Calculate offset from original group position
        const originalBounds = this._getGroupBounds(groupObj.children);
        const dx = groupObj.x - originalBounds.minX;
        const dy = groupObj.y - originalBounds.minY;

        // Extract children and add as new items
        this._clearRedoStack(); // Clear redo when adding new items
        const newIndices = [];
        groupObj.children.forEach(child => {
            // Apply any offset from group movement
            const newItem = JSON.parse(JSON.stringify(child));
            newItem.id = Date.now() + Math.random();
            newItem.lastMod = Date.now();
            newItem.deleted = false;

            // Apply offset based on tool type
            if (newItem.tool === 'pen' || newItem.tool === 'eraser') {
                if (newItem.pts) {
                    newItem.pts.forEach(p => {
                        p.x += dx;
                        p.y += dy;
                    });
                }
            } else {
                newItem.x += dx;
                newItem.y += dy;
            }

            history.push(newItem);
            newIndices.push(history.length - 1);
        });

        // Mark group as deleted
        groupObj.deleted = true;
        groupObj.lastMod = Date.now();

        // Select the ungrouped items
        this.state.selection = newIndices;

        this.invalidateCache();
        this.saveCurrentImg();
        this.render();

        // Sync with liveblocks - addStroke for the new individual items
        // saveCurrentImg already syncs via setHistory
        if (this.liveSync) {
            newIndices.forEach(i => {
                this.liveSync.addStroke(this.state.idx, history[i]);
            });
        }

        this.ui.showToast(`Ungrouped ${groupObj.children.length} items`);
    },

    /**
     * Gets combined bounding box for an array of items
     */
    _getGroupBounds(items) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        items.forEach(item => {
            const bounds = this._getItemBounds(item);
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
        });

        return {
            minX,
            minY,
            maxX,
            maxY,
            w: maxX - minX,
            h: maxY - minY
        };
    },

    // =============================================
    // FLIP & TRANSFORM
    // =============================================

    /**
     * Flips selected items horizontally or vertically
     * @param {string} direction - 'horizontal' or 'vertical'
     */
    flipSelection(direction) {
        if (this.state.selection.length === 0) {
            this.ui.showToast('Select items first');
            return;
        }

        const img = this.state.images[this.state.idx];

        // Save state for undo
        this._pushModificationUndo('flip', this.state.selection);

        // Get combined bounds of selection
        const items = this.state.selection.map(i => img.history[i]);
        const bounds = this._getGroupBounds(items);
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;

        // Helper function to flip an item
        const flipItem = (st) => {
            if (st.tool === 'pen' || st.tool === 'eraser') {
                // Flip pen points around the center
                st.pts = st.pts.map(p => ({
                    x: direction === 'horizontal' ? centerX * 2 - p.x : p.x,
                    y: direction === 'vertical' ? centerY * 2 - p.y : p.y
                }));
            } else if (st.tool === 'group' && st.children) {
                // Flip group: flip the group position and all children
                if (direction === 'horizontal') {
                    const newX = centerX * 2 - st.x - st.w;
                    // Flip children relative to old group position
                    st.children.forEach(child => {
                        if (child.tool === 'pen' || child.tool === 'eraser') {
                            child.pts = child.pts.map(p => ({
                                x: st.x + st.w - (p.x - st.x),
                                y: p.y
                            }));
                        } else {
                            const childNewX = st.x + st.w - (child.x - st.x) - child.w;
                            child.x = childNewX;
                            if (child.rotation) child.rotation = -child.rotation;
                        }
                    });
                    st.x = newX;
                } else {
                    const newY = centerY * 2 - st.y - st.h;
                    // Flip children relative to old group position
                    st.children.forEach(child => {
                        if (child.tool === 'pen' || child.tool === 'eraser') {
                            child.pts = child.pts.map(p => ({
                                x: p.x,
                                y: st.y + st.h - (p.y - st.y)
                            }));
                        } else {
                            const childNewY = st.y + st.h - (child.y - st.y) - child.h;
                            child.y = childNewY;
                            if (child.rotation) child.rotation = -child.rotation;
                        }
                    });
                    st.y = newY;
                }
            } else {
                // Flip shapes/text around the center
                if (direction === 'horizontal') {
                    const newX = centerX * 2 - st.x - st.w;
                    st.x = newX;
                    // Invert rotation for horizontal flip
                    if (st.rotation) st.rotation = -st.rotation;
                } else {
                    const newY = centerY * 2 - st.y - st.h;
                    st.y = newY;
                    // Invert rotation for vertical flip
                    if (st.rotation) st.rotation = -st.rotation;
                }
            }
            st.lastMod = Date.now();
        };

        this.state.selection.forEach(idx => {
            flipItem(img.history[idx]);
        });

        this.invalidateCache();
        this.saveCurrentImg();
        this.render();

        this.ui.showToast(`Flipped ${direction}`);
    },

    /**
     * Sets whether to keep aspect ratio during resize
     * @param {boolean} enabled - Whether to keep aspect ratio
     */
    setKeepAspectRatio(enabled) {
        this.state.keepAspectRatio = enabled;

        // Sync both UI checkboxes
        const ctxCheckbox = document.getElementById('ctxAspectRatio');
        const sidebarCheckbox = document.getElementById('sidebarAspectRatio');
        if (ctxCheckbox) ctxCheckbox.checked = enabled;
        if (sidebarCheckbox) sidebarCheckbox.checked = enabled;

        this.saveSessionState();
    },

    /**
     * Updates the rotation angle display in the UI
     */
    _updateRotationDisplay() {
        if (this.state.selection.length === 0) return;

        const img = this.state.images[this.state.idx];
        const firstItem = img.history[this.state.selection[0]];

        // Get rotation in degrees
        let rotation = 0;
        if (firstItem && firstItem.rotation) {
            rotation = Math.round((firstItem.rotation * 180 / Math.PI) % 360);
            if (rotation < 0) rotation += 360;
        }

        const angleText = `${rotation}°`;

        const ctxAngle = document.getElementById('ctxRotationAngle');
        const sidebarAngle = document.getElementById('sidebarRotationAngle');
        if (ctxAngle) ctxAngle.textContent = angleText;
        if (sidebarAngle) sidebarAngle.textContent = angleText;
    },

    // =============================================
    // SNAP TO GRID
    // =============================================

    /**
     * Toggles snap to grid
     */
    setSnapToGrid(enabled) {
        this.state.snapToGrid = enabled;
        const toggle = this.getElement('snapGridToggle');
        if (toggle) toggle.checked = enabled;
        this.saveSessionState();
        this.ui.showToast(enabled ? 'Snap to Grid ON' : 'Snap to Grid OFF');
    },

    /**
     * Sets grid size for snapping
     */
    setGridSize(size) {
        this.state.gridSize = parseInt(size) || 20;
        const input = this.getElement('gridSizeInput');
        if (input) input.value = this.state.gridSize;
        this.saveSessionState();
        this.render(); // Re-render to show updated grid
    },

    /**
     * Snaps a value to the nearest grid line
     */
    _snapToGrid(value) {
        const gridSize = this.state.gridSize || 20;
        return Math.round(value / gridSize) * gridSize;
    },

    /**
     * Snaps a point to grid if snap is enabled
     */
    _snapPointToGrid(pt) {
        if (!this.state.snapToGrid) return pt;
        return {
            x: this._snapToGrid(pt.x),
            y: this._snapToGrid(pt.y)
        };
    },

    // =============================================
    // SNAP TO OBJECTS (SMART GUIDES)
    // =============================================

    /**
     * Toggles snap to objects
     */
    setSnapToObjects(enabled) {
        this.state.snapToObjects = enabled;
        const toggle = this.getElement('snapObjectsToggle');
        if (toggle) toggle.checked = enabled;
        this.saveSessionState();
        this.ui.showToast(enabled ? 'Smart Guides ON' : 'Smart Guides OFF');
    },

    /**
     * Finds snap points from other objects and returns adjusted position + guide lines
     * @param {Object} movingBounds - Bounds of item being moved {minX, minY, maxX, maxY, w, h}
     * @param {number[]} excludeIndices - Indices to exclude (the items being moved)
     * @param {number} threshold - Snap threshold in pixels
     * @returns {Object} {snappedBounds, guides}
     */
    _findObjectSnaps(movingBounds, excludeIndices = [], threshold = 8) {
        if (!this.state.snapToObjects) {
            return { snappedBounds: movingBounds, guides: [] };
        }

        const img = this.state.images[this.state.idx];
        if (!img || !img.history) return { snappedBounds: movingBounds, guides: [] };

        const guides = [];
        let snapX = null, snapY = null;
        let snapDx = 0, snapDy = 0;

        // Get snap points from moving object
        const movingCenterX = (movingBounds.minX + movingBounds.maxX) / 2;
        const movingCenterY = (movingBounds.minY + movingBounds.maxY) / 2;

        // Check against all other objects
        for (let i = 0; i < img.history.length; i++) {
            if (excludeIndices.includes(i)) continue;
            const item = img.history[i];
            if (item.deleted || item.locked) continue;

            const bounds = this._getItemBounds(item);

            // Vertical alignments (X axis)
            const xChecks = [
                { moving: movingBounds.minX, target: bounds.minX, type: 'left' },
                { moving: movingBounds.minX, target: bounds.maxX, type: 'left-to-right' },
                { moving: movingBounds.maxX, target: bounds.minX, type: 'right-to-left' },
                { moving: movingBounds.maxX, target: bounds.maxX, type: 'right' },
                { moving: movingCenterX, target: (bounds.minX + bounds.maxX) / 2, type: 'center-x' }
            ];

            for (const check of xChecks) {
                const diff = Math.abs(check.moving - check.target);
                if (diff < threshold && (snapX === null || diff < Math.abs(snapDx))) {
                    snapX = check.target;
                    if (check.type.includes('left')) {
                        snapDx = check.target - movingBounds.minX;
                    } else if (check.type.includes('right')) {
                        snapDx = check.target - movingBounds.maxX;
                    } else {
                        snapDx = check.target - movingCenterX;
                    }
                    // Add vertical guide line
                    guides.push({
                        type: 'vertical',
                        x: check.target,
                        y1: Math.min(bounds.minY, movingBounds.minY) - 20,
                        y2: Math.max(bounds.maxY, movingBounds.maxY) + 20
                    });
                }
            }

            // Horizontal alignments (Y axis)
            const yChecks = [
                { moving: movingBounds.minY, target: bounds.minY, type: 'top' },
                { moving: movingBounds.minY, target: bounds.maxY, type: 'top-to-bottom' },
                { moving: movingBounds.maxY, target: bounds.minY, type: 'bottom-to-top' },
                { moving: movingBounds.maxY, target: bounds.maxY, type: 'bottom' },
                { moving: movingCenterY, target: (bounds.minY + bounds.maxY) / 2, type: 'center-y' }
            ];

            for (const check of yChecks) {
                const diff = Math.abs(check.moving - check.target);
                if (diff < threshold && (snapY === null || diff < Math.abs(snapDy))) {
                    snapY = check.target;
                    if (check.type.includes('top')) {
                        snapDy = check.target - movingBounds.minY;
                    } else if (check.type.includes('bottom')) {
                        snapDy = check.target - movingBounds.maxY;
                    } else {
                        snapDy = check.target - movingCenterY;
                    }
                    // Add horizontal guide line
                    guides.push({
                        type: 'horizontal',
                        y: check.target,
                        x1: Math.min(bounds.minX, movingBounds.minX) - 20,
                        x2: Math.max(bounds.maxX, movingBounds.maxX) + 20
                    });
                }
            }
        }

        // Apply snapping
        const snappedBounds = {
            minX: movingBounds.minX + snapDx,
            minY: movingBounds.minY + snapDy,
            maxX: movingBounds.maxX + snapDx,
            maxY: movingBounds.maxY + snapDy,
            w: movingBounds.w,
            h: movingBounds.h
        };

        // Store guides for rendering
        this.state.guideLines = guides;

        return { snappedBounds, guides, snapDx, snapDy };
    },

    /**
     * Clears snap guide lines
     */
    _clearSnapGuides() {
        this.state.guideLines = [];
    },

    // =============================================
    // MULTI-PAGE CLIPBOARD
    // =============================================

    /**
     * Copy selected items to multi-page clipboard
     */
    copyToClipboard() {
        if (this.state.selection.length === 0) {
            this.ui.showToast('Nothing selected');
            return;
        }

        const img = this.state.images[this.state.idx];
        const items = this.state.selection.map(i => JSON.parse(JSON.stringify(img.history[i])));

        // Calculate bounds for relative positioning when pasting
        const bounds = this._getGroupBounds(items);

        this.state.clipboard = {
            items: items,
            bounds: bounds,
            sourcePage: this.state.idx
        };

        this.ui.showToast(`Copied ${items.length} item(s) to clipboard`);
    },

    /**
     * Cut selected items to multi-page clipboard
     */
    cutToClipboard() {
        this.copyToClipboard();
        if (this.state.clipboard && this.state.clipboard.items.length > 0) {
            this.deleteSelected();
            this.ui.showToast(`Cut ${this.state.clipboard.items.length} item(s)`);
        }
    },

    /**
     * Paste items from clipboard (works across pages)
     * @param {Object} position - Optional {x, y} to paste at specific position
     */
    pasteFromClipboard(position = null) {
        if (!this.state.clipboard || this.state.clipboard.items.length === 0) {
            this.ui.showToast('Clipboard is empty');
            return;
        }

        const img = this.state.images[this.state.idx];
        const clipboardBounds = this.state.clipboard.bounds;

        // Default paste position: center of viewport or offset from original
        let pasteX, pasteY;
        if (position) {
            pasteX = position.x;
            pasteY = position.y;
        } else {
            // If pasting on same page, offset by 20px
            // If pasting on different page, try to center in viewport
            if (this.state.idx === this.state.clipboard.sourcePage) {
                pasteX = clipboardBounds.minX + 20;
                pasteY = clipboardBounds.minY + 20;
            } else {
                // Center in current viewport
                const viewCenterX = (this.state.viewW / 2 - this.state.pan.x) / this.state.zoom;
                const viewCenterY = (this.state.viewH / 2 - this.state.pan.y) / this.state.zoom;
                pasteX = viewCenterX - clipboardBounds.w / 2;
                pasteY = viewCenterY - clipboardBounds.h / 2;
            }
        }

        // Calculate offset from original bounds
        const offsetX = pasteX - clipboardBounds.minX;
        const offsetY = pasteY - clipboardBounds.minY;

        // Create new items with new IDs and apply offset
        this._clearRedoStack(); // Clear redo when adding new items
        const newIndices = [];
        this.state.clipboard.items.forEach(item => {
            const newItem = JSON.parse(JSON.stringify(item));
            newItem.id = Date.now() + Math.random();
            newItem.lastMod = Date.now();
            newItem.deleted = false;

            // Apply position offset
            if (newItem.tool === 'pen' || newItem.tool === 'eraser') {
                if (newItem.pts) {
                    newItem.pts.forEach(p => {
                        p.x += offsetX;
                        p.y += offsetY;
                    });
                }
            } else if (newItem.tool === 'group' && newItem.children) {
                newItem.x += offsetX;
                newItem.y += offsetY;
                newItem.children.forEach(child => {
                    if (child.tool === 'pen' || child.tool === 'eraser') {
                        if (child.pts) {
                            child.pts.forEach(p => {
                                p.x += offsetX;
                                p.y += offsetY;
                            });
                        }
                    } else {
                        child.x += offsetX;
                        child.y += offsetY;
                    }
                });
            } else {
                newItem.x += offsetX;
                newItem.y += offsetY;
            }

            img.history.push(newItem);
            newIndices.push(img.history.length - 1);

            // Sync with liveblocks
            if (this.liveSync) {
                this.liveSync.addStroke(this.state.idx, newItem);
            }
        });

        // Select pasted items
        this.state.selection = newIndices;
        this.setTool('lasso');

        this.invalidateCache();
        this.saveCurrentImg();
        this.render();

        this.ui.showToast(`Pasted ${newIndices.length} item(s)`);
    },

    /**
     * Check if clipboard has content
     */
    hasClipboardContent() {
        return this.state.clipboard && this.state.clipboard.items && this.state.clipboard.items.length > 0;
    }
};