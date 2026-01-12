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
        if(tsp) tsp.style.display = ['pen','shape','eraser','text'].includes(t) ? 'block' : 'none';

        const po = this.getElement('penOptions');
        if(po) po.style.display = t==='pen'?'block':'none';

        const so = this.getElement('shapeOptions');
        if(so) so.style.display = t==='shape'?'block':'none';

        const eo = this.getElement('eraserOptions');
        if(eo) eo.style.display = t==='eraser'?'block':'none';

        const to = this.getElement('textOptions');
        if(to) to.style.display = t==='text'?'block':'none';

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
        if(img.history.length > 0) {
            if(!img.redo) img.redo = [];
            img.redo.push(img.history.pop());
            this.saveCurrentImg(); this.render();
        }
    },

    redo() {
        const img = this.state.images[this.state.idx];
        if(img.redo && img.redo.length > 0) {
            img.history.push(img.redo.pop());
            this.saveCurrentImg(); this.render();
        }
    },

    deleteSelected() {
        const img = this.state.images[this.state.idx];
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
            if(e.target.tagName === 'INPUT') return;
            const key = e.key.toLowerCase();
            if(e.key === ' ') {
                e.preventDefault();
                this.state.previewOn = !this.state.previewOn;
                const pt = this.getElement('previewToggle');
                if(pt) pt.checked = this.state.previewOn;
                this.render(); this.saveSessionState();
                return;
            }
            if((e.ctrlKey||e.metaKey) && key==='z') { e.preventDefault(); if(e.shiftKey) this.redo(); else this.undo(); }
            if(key==='v' && !e.ctrlKey && !e.metaKey) this.setTool('none'); if(key==='l') this.setTool('lasso'); if(key==='p') this.setTool('pen');
            if(key==='e') this.setTool('eraser'); if(key==='s') this.setTool('shape'); if(key==='t') this.setTool('text');
            if(key==='b') this.setTool('capture'); if(key==='h') this.setTool('hand');
            if(e.key==='ArrowLeft') this.loadPage(this.state.idx-1); if(e.key==='ArrowRight') this.loadPage(this.state.idx+1); if(e.key==='Delete' || e.key==='Backspace') this.deleteSelected();
        });
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
                let bx,by,bw,bh;
                if(st.tool==='pen') { bx=st.pts[0].x; by=st.pts[0].y; let rx=bx, ry=by; st.pts.forEach(p=>{bx=Math.min(bx,p.x);by=Math.min(by,p.y);rx=Math.max(rx,p.x);ry=Math.max(ry,p.y);}); bw=rx-bx; bh=ry-by; }
                else { bx=st.x; by=st.y; bw=st.w; bh=st.h; }
                if(bw<0){bx+=bw; bw=-bw;} if(bh<0){by+=bh; bh=-bh;}
                minX=Math.min(minX,bx); minY=Math.min(minY,by); maxX=Math.max(maxX,bx+bw); maxY=Math.max(maxY,by+bh);
            });
            return {minX, minY, maxX, maxY, w:maxX-minX, h:maxY-minY, cx:(minX+maxX)/2, cy:(minY+maxY)/2, maxY:maxY};
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
                    startBounds = getSelectionBounds();
                    const img = this.state.images[this.state.idx];
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

            if(isMovingSelection) { this.dragOffset = {x:pt.x-dragStart.x, y:pt.y-dragStart.y}; this.render(); return; }

            // Handle resize during drag
            if(isResizing && startBounds && resizeHandle) {
                const img = this.state.images[this.state.idx];
                const dx = pt.x - startPt.x;
                const dy = pt.y - startPt.y;

                this.state.selection.forEach((idx, i) => {
                    const st = img.history[idx];
                    const orig = initialHistoryState[i];

                    // Calculate scale factors based on which handle is being dragged
                    let scaleX = 1, scaleY = 1;
                    let newX = orig.x, newY = orig.y, newW = orig.w, newH = orig.h;

                    if (resizeHandle.includes('r')) { // right handles
                        newW = orig.w + dx;
                        scaleX = newW / orig.w;
                    }
                    if (resizeHandle.includes('l')) { // left handles
                        newX = orig.x + dx;
                        newW = orig.w - dx;
                        scaleX = newW / orig.w;
                    }
                    if (resizeHandle.includes('b')) { // bottom handles
                        newH = orig.h + dy;
                        scaleY = newH / orig.h;
                    }
                    if (resizeHandle.includes('t')) { // top handles
                        newY = orig.y + dy;
                        newH = orig.h - dy;
                        scaleY = newH / orig.h;
                    }

                    // Apply to shape/text
                    if (st.tool === 'pen' || st.tool === 'eraser') {
                        // Scale pen points relative to original bounds
                        const origBounds = this._getPenBounds(orig.pts);
                        st.pts = orig.pts.map(p => ({
                            x: origBounds.minX + (p.x - origBounds.minX) * scaleX + (resizeHandle.includes('l') ? dx : 0),
                            y: origBounds.minY + (p.y - origBounds.minY) * scaleY + (resizeHandle.includes('t') ? dy : 0)
                        }));
                    } else {
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
                        if (st.locked) continue;

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
            window.addEventListener('resize', () => this.liveSync && this.liveSync.renderCursors && this.liveSync.renderCursors());
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
                isMovingSelection=false;
                this.state.selection.forEach(idx => { const st=this.state.images[this.state.idx].history[idx]; if(st.tool==='pen') st.pts.forEach(p=>{p.x+=this.dragOffset.x;p.y+=this.dragOffset.y}); else {st.x+=this.dragOffset.x;st.y+=this.dragOffset.y} });
                this.dragOffset=null; this.saveCurrentImg(); this.render(); return;
            }

            // Finalize resize operation
            if(isResizing) {
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
                    if(st.locked || st.deleted) return;

                    let cx, cy;
                    if(st.tool==='pen'){
                        // For pen strokes, use the first point as center
                        cx = st.pts[0].x;
                        cy = st.pts[0].y;
                    } else {
                        // For other objects, calculate center in document coordinates
                        cx = st.x + st.w/2;
                        cy = st.y + st.h/2;
                    }

                    // Check if the point is within the lasso path using point-in-polygon algorithm
                    if(this.isPointInPolygon(cx, cy, lassoPath)) {
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
                // Calculate width and height from the startPt and current pt
                let w = pt.x - startPt.x;
                let h = pt.y - startPt.y;

                if(Math.abs(w)>2 || Math.abs(h)>2) { // Allow for very thin shapes
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

                // Clear the pending shape if it exists
                if (this.pendingShape) {
                    delete this.pendingShape;
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
                    if (st.locked) continue;

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

        // Sync with liveblocks if available
        if (this.liveSync && !this.liveSync.isInitializing) {
            const item = isEditing ? img.history[historyIdx] : img.history[img.history.length - 1];
            if (isEditing) {
                this.liveSync.updateStroke(this.state.idx, item);
            } else {
                this.liveSync.addStroke(this.state.idx, item);
            }
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
    }
};