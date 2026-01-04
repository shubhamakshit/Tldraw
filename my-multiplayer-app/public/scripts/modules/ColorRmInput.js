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
        if(po) po.style.display = t==='pen'||t==='text'?'block':'none';

        const so = this.getElement('shapeOptions');
        if(so) so.style.display = t==='shape'?'block':'none';

        const eo = this.getElement('eraserOptions');
        if(eo) eo.style.display = t==='eraser'?'block':'none';

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
            if(key==='v') this.setTool('none'); if(key==='l') this.setTool('lasso'); if(key==='p') this.setTool('pen');
            if(key==='e') this.setTool('eraser'); if(key==='s') this.setTool('shape'); if(key==='t') this.setTool('text');
            if(key==='b') this.setTool('capture'); if(key==='h') this.setTool('hand');
            if(e.key==='ArrowLeft') this.loadPage(this.state.idx-1); if(e.key==='ArrowRight') this.loadPage(this.state.idx+1); if(e.key==='Delete' || e.key==='Backspace') this.deleteSelected();
        });
    },

    setupDrawing() {
        import('../spen_engine.js')
            .then(({ initializeSPen }) => {
                const canvas = this.getElement('canvas');
                if (canvas) {
                    console.log('Initializing S-Pen Engine for ColorRM...');
                    initializeSPen(canvas);
                }
            })
            .catch(err => {
                console.log('S-Pen Engine not found, skipping initialization.');
            });

        const c = this.getElement('canvas');
        if (!c) return;

        c.addEventListener('contextmenu', e => e.preventDefault());

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
                this.ui.showInput("Add Text", "Type something...", (text) => {
                    const img = this.state.images[this.state.idx]; const fs = this.state.textSize;
                    img.history.push({ id: Date.now() + Math.random(), lastMod: Date.now(), tool: 'text', text: text, x: pt.x, y: pt.y, size: fs, color: this.state.penColor, rotation: 0, w: fs*text.length*0.6, h: fs });
                    this.saveCurrentImg(); this.setTool('none'); this.state.selection = [img.history.length-1]; syncSidebarToSelection(); this.render();
                }); return;
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
            if(this.state.tool==='lasso') lassoPath=[pt]; else if(this.state.tool!=='shape' && this.state.tool!=='capture') this.currentStroke=[pt];
        };

        const onPointerMove = e => {
            // Scope: Only process events if this instance is active
            // Check if we're dragging OR if the event target is within our container
            const isOurEvent = this.isDragging ||
                               (this.container ? this.container.contains(e.target) : true);
            if (!isOurEvent) return;

            if (lastPinchDist !== null) return;
            // Only process if target is our canvas or we are dragging
            if (!this.isDragging && e.target !== c) return;

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

            if(this.state.tool==='lasso') { lassoPath.push(pt); this.renderLasso(c.getContext('2d'), lassoPath); }
            else if(this.state.tool==='shape' || this.state.tool==='capture') {
                let w=pt.x-startPt.x, h=pt.y-startPt.y;
                if(this.state.tool==='shape' && (e.shiftKey || ['rectangle','circle'].includes(this.state.shapeType))) { if(e.shiftKey || Math.abs(Math.abs(w)-Math.abs(h))<15) { const s=Math.max(Math.abs(w),Math.abs(h)); w=(w<0?-1:1)*s; h=(h<0?-1:1)*s; } }
                this.render();
                if(this.state.tool === 'capture') {
                        const ctx = c.getContext('2d'); ctx.save();
                        ctx.strokeStyle = '#10b981'; ctx.lineWidth = 2; ctx.setLineDash([5,5]);
                        ctx.strokeRect(startPt.x, startPt.y, w, h); ctx.restore();
                } else {
                    this.renderObject(c.getContext('2d'), {tool:'shape', shapeType:this.state.shapeType, x:startPt.x, y:startPt.y, w:w, h:h, border:this.state.shapeBorder, fill:this.state.shapeFill, width:this.state.shapeWidth});
                }
            }
            else if(['pen','eraser'].includes(this.state.tool)) {
                if (this.state.tool === 'eraser' && this.state.eraserType === 'stroke') {
                    const img = this.state.images[this.state.idx];
                    const eraserR = this.state.eraserSize / 2;
                    let changed = false;
                    for (let i = img.history.length - 1; i >= 0; i--) {
                        const st = img.history[i];
                        if (st.locked) continue;
                        let hit = false;
                        if (st.tool === 'pen' || st.tool === 'eraser') {
                            for (const p of st.pts) {
                                if (Math.hypot(p.x - pt.x, p.y - pt.y) < eraserR + st.size) {
                                    hit = true; break;
                                }
                            }
                        } else if (st.tool === 'shape' || st.tool === 'text') {
                            if (pt.x >= st.x - eraserR && pt.x <= st.x + st.w + eraserR &&
                                pt.y >= st.y - eraserR && pt.y <= st.y + st.h + eraserR) {
                                hit = true;
                            }
                        }
                        if (hit) { st.deleted = true; st.lastMod = Date.now(); changed = true; }
                    }
                    if (changed) { this.invalidateCache(); this.scheduleSave(); this.render(); }
                    return;
                }

                this.currentStroke.push(pt); const ctx=c.getContext('2d');
                ctx.save();
                ctx.translate(this.state.pan.x, this.state.pan.y);
                ctx.scale(this.state.zoom, this.state.zoom);
                ctx.lineCap='round'; ctx.lineJoin='round'; ctx.lineWidth=this.state.tool==='eraser'?this.state.eraserSize:this.state.penSize;
                ctx.strokeStyle=this.state.tool==='eraser'?(this.state.bg==='transparent'?'#000':this.state.bg):this.state.penColor;
                if(this.state.tool==='eraser'&&this.state.bg==='transparent') ctx.globalCompositeOperation='destination-out';
                ctx.beginPath(); ctx.moveTo(this.currentStroke[this.currentStroke.length-2].x, this.currentStroke[this.currentStroke.length-2].y); ctx.lineTo(pt.x,pt.y); ctx.stroke(); ctx.restore();
            }
        };

        window.addEventListener('pointermove', onPointerMove);

        // Only main app listens to window resize for cursor re-rendering
        if (this.config.isMain) {
            window.addEventListener('resize', () => this.liveSync && this.liveSync.renderCursors && this.liveSync.renderCursors());
        }
        const vp = this.getElement('viewport');
        if(vp) vp.addEventListener('scroll', () => this.liveSync && this.liveSync.renderCursors && this.liveSync.renderCursors());

        // --- Zoom & Pan Logic ---
        let lastPinchDist = null;
        let lastMidpoint = null;

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
                this.isDragging = false;
                this.currentStroke = null;
                lastPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                lastMidpoint = {
                    x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                    y: (e.touches[0].clientY + e.touches[1].clientY) / 2
                };
            }
        }, { passive: false });

        c.addEventListener('touchmove', e => {
            if (e.touches.length === 2 && lastPinchDist !== null && lastMidpoint !== null) {
                e.preventDefault();
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
                lastPinchDist = null;
                lastMidpoint = null;
            }
        });

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
            if(!this.isDragging) {
                // Send a final update on pointer up even if not dragging, to clear drawing state
                if (this.liveSync) {
                    this.liveSync.updateCursor(getPt(e), this.state.tool, false, this.state.penColor, 0);
                }
                return;
            }
            this.isDragging=false;
            
            // Send a final update to clear the live trail for other users
            if (this.liveSync) {
                this.liveSync.updateCursor(getPt(e), this.state.tool, false, this.state.penColor, 0);
            }

            const pt = getPt(e);
            if(this.state.tool==='lasso') {
                let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
                lassoPath.forEach(p=>{minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);});
                this.state.selection=[];
                this.state.images[this.state.idx].history.forEach((st,i)=>{
                    if(st.locked) return; let cx,cy; if(st.tool==='pen'){cx=st.pts[0].x;cy=st.pts[0].y} else {cx=st.x+st.w/2;cy=st.y+st.h/2}
                    if(cx>=minX && cx<=maxX && cy>=minY && cy<=maxY) this.state.selection.push(i);
                });
                syncSidebarToSelection();
                this.render();
            } else if(this.state.tool==='shape') {
                let w=pt.x-startPt.x, h=pt.y-startPt.y;
                if(Math.abs(w)>2) {
                    this.state.images[this.state.idx].history.push({id: Date.now() + Math.random(), lastMod: Date.now(), tool:'shape', shapeType:this.state.shapeType, x:startPt.x, y:startPt.y, w:w, h:h, border:this.state.shapeBorder, fill:this.state.shapeFill, width:this.state.shapeWidth, rotation:0});
                    this.saveCurrentImg(); this.state.selection=[this.state.images[this.state.idx].history.length-1]; this.setTool('lasso'); syncSidebarToSelection();
                }
            } else if(this.state.tool==='capture') {
                let w = pt.x - startPt.x, h = pt.y - startPt.y;
                if(w < 0) { startPt.x += w; w = Math.abs(w); }
                if(h < 0) { startPt.y += h; h = Math.abs(h); }
                if(w > 5 && h > 5) this.addToBox(startPt.x, startPt.y, w, h);
                this.render();
            } else if(['pen','eraser'].includes(this.state.tool)) {
                const newStroke = {id: Date.now() + Math.random(), lastMod: Date.now(), tool:this.state.tool, pts:this.currentStroke, color:this.state.penColor, size:this.state.tool==='eraser'?this.state.eraserSize:this.state.penSize, deleted: false};
                this.state.images[this.state.idx].history.push(newStroke);
                this.saveCurrentImg(true);
                if (this.liveSync && !this.liveSync.isInitializing) {
                    this.liveSync.addStroke(this.state.idx, newStroke);
                }
                this.render();
            }
        });
    }
};