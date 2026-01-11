export const ColorRmRenderer = {
    // Invalidate the cached canvas (call when history changes)
    invalidateCache() {
        this.cache.isDirty = true;
        this.cache.hiResCache = null; // Clear high-res cache
    },

    // Request a render on next animation frame (throttled to 60fps)
    requestRender() {
        if (this.renderPending) return;
        this.renderPending = true;
        requestAnimationFrame(() => {
            this.render();
            this.renderPending = false;
        });
    },

    // Build high-resolution cache at current zoom level for idle state
    _buildHiResCache(currentImg) {
        const zoom = this.state.zoom;
        const pan = this.state.pan;

        // Check if cache is valid for current zoom/pan
        if (this.cache.hiResCache &&
            this.cache.hiResCacheZoom === zoom &&
            this.cache.hiResCachePanX === pan.x &&
            this.cache.hiResCachePanY === pan.y &&
            !this.cache.isDirty) {
            return this.cache.hiResCache;
        }

        const activeHistory = currentImg?.history?.filter(st => !st.deleted) || [];
        if (activeHistory.length === 0) return null;

        // Create cache at display resolution
        const cacheCanvas = document.createElement('canvas');
        cacheCanvas.width = this.state.viewW;
        cacheCanvas.height = this.state.viewH;
        const cacheCtx = cacheCanvas.getContext('2d');

        // Draw strokes at current zoom level (crisp)
        cacheCtx.translate(pan.x, pan.y);
        cacheCtx.scale(zoom, zoom);

        activeHistory.forEach((st, idx) => {
            if (this.state.selection.includes(idx)) return;
            this.renderObject(cacheCtx, st, 0, 0);
        });

        // Store cache with metadata
        this.cache.hiResCache = cacheCanvas;
        this.cache.hiResCacheZoom = zoom;
        this.cache.hiResCachePanX = pan.x;
        this.cache.hiResCachePanY = pan.y;
        this.cache.isDirty = false;

        return cacheCanvas;
    },

    render(tempHex) {
        if(typeof tempHex === 'string') this.tempHex = tempHex; else this.tempHex = null;
        if(!this.cache.currentImg) return;
        const c = this.getElement('canvas');
        if (!c) return;
        const ctx = c.getContext('2d');

        // Reset transform before clearing
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-over';

        // Disable image smoothing for crisp strokes at any zoom level
        ctx.imageSmoothingEnabled = false;

        ctx.clearRect(0,0,c.width,c.height);

        try {
            ctx.save();
            ctx.translate(this.state.pan.x, this.state.pan.y);
            ctx.scale(this.state.zoom, this.state.zoom);

            // Preview logic
            if(this.state.previewOn || (this.tempHex && this.state.pickerMode==='remove')) {
                let targets = this.state.colors.map(x=>x.lab);
                if(this.tempHex) {
                    const i = parseInt(this.tempHex.slice(1), 16);
                    targets.push(this.rgbToLab((i>>16)&255, (i>>8)&255, i&255));
                }
                if(targets.length > 0) {
                    const tmpC = document.createElement('canvas');
                    tmpC.width = this.state.viewW;
                    tmpC.height = this.state.viewH;
                    const tmpCtx = tmpC.getContext('2d', {willReadFrequently: true});
                    tmpCtx.drawImage(this.cache.currentImg, 0, 0, this.state.viewW, this.state.viewH);
                    const imgD = tmpCtx.getImageData(0, 0, this.state.viewW, this.state.viewH);
                    const d = imgD.data;
                    const lab = this.cache.lab;
                    const sq = this.state.strict**2;
                    for(let i=0, j=0; i<d.length; i+=4, j+=3) {
                        if(d[i+3]===0) continue;
                        const l=lab[j], a=lab[j+1], b=lab[j+2];
                        let keep = false;
                        for(let t of targets) {
                            if(((l-t[0])**2 + (a-t[1])**2 + (b-t[2])**2) <= sq) { keep = true; break; }
                        }
                        if(!keep) d[i+3] = 0;
                    }
                    tmpCtx.putImageData(imgD, 0, 0);
                    ctx.drawImage(tmpC, 0, 0);
                } else {
                    ctx.drawImage(this.cache.currentImg, 0, 0, this.state.viewW, this.state.viewH);
                }
            } else {
                ctx.drawImage(this.cache.currentImg, 0, 0, this.state.viewW, this.state.viewH);
            }

            const currentImg = this.state.images[this.state.idx];
            const activeHistory = currentImg?.history?.filter(st => !st.deleted) || [];

            // HYBRID RENDERING: Use cache when idle, render live when interacting
            const isInteracting = this.isDragging || this.state.selection.length > 0;

            if (isInteracting || activeHistory.length < 100) {
                // LIVE RENDERING: Always render strokes directly for crispness
                // Used when drawing, selecting, or when stroke count is low
                activeHistory.forEach((st, idx) => {
                    if (this.state.selection.includes(idx)) return;
                    this.renderObject(ctx, st, 0, 0);
                });
            } else {
                // CACHED RENDERING: Use hi-res cache for performance during idle
                // Cache is built at current zoom level so it stays crisp
                const hiResCache = this._buildHiResCache(currentImg);
                if (hiResCache) {
                    // Draw cache without transform (it's already transformed)
                    ctx.restore();
                    ctx.drawImage(hiResCache, 0, 0);
                    ctx.save();
                    ctx.translate(this.state.pan.x, this.state.pan.y);
                    ctx.scale(this.state.zoom, this.state.zoom);
                } else {
                    // Fallback to live rendering
                    activeHistory.forEach((st, idx) => {
                        if (this.state.selection.includes(idx)) return;
                        this.renderObject(ctx, st, 0, 0);
                    });
                }
            }

            // Draw selected items with drag offset
            if (currentImg && currentImg.history && this.state.selection.length > 0) {
                this.state.selection.forEach(idx => {
                    const st = currentImg.history[idx];
                    if (!st || st.deleted) return;
                    let dx = 0, dy = 0;
                    if (this.dragOffset) {
                        dx = this.dragOffset.x;
                        dy = this.dragOffset.y;
                    }
                    this.renderObject(ctx, st, dx, dy);
                });
            }

            // Active stroke (being drawn right now)
            if (this.isDragging && this.currentStroke && this.currentStroke.length > 1 && ['pen','eraser'].includes(this.state.tool)) {
                ctx.save();
                ctx.lineCap='round'; ctx.lineJoin='round';
                ctx.lineWidth = this.state.tool==='eraser' ? this.state.eraserSize : this.state.penSize;
                ctx.strokeStyle = this.state.tool==='eraser' ? (this.state.bg==='transparent'?'#000':this.state.bg) : this.state.penColor;
                if(this.state.tool==='eraser' && this.state.bg==='transparent') ctx.globalCompositeOperation='destination-out';
                ctx.beginPath();
                ctx.moveTo(this.currentStroke[0].x, this.currentStroke[0].y);
                for(let i=1; i<this.currentStroke.length; i++) {
                    ctx.lineTo(this.currentStroke[i].x, this.currentStroke[i].y);
                }
                ctx.stroke();
                ctx.restore();
            }

            if(this.state.selection.length > 0) this.renderSelectionOverlay(ctx, currentImg.history);

            const zb = this.getElement('zoomBtn');
            if (zb) zb.innerText = Math.round(this.state.zoom * 100) + '%';

            if(this.state.guideLines.length > 0) {
                ctx.save();
                ctx.strokeStyle = '#f472b6';
                ctx.lineWidth = 1 / this.state.zoom;
                ctx.setLineDash([4 / this.state.zoom, 4 / this.state.zoom]);
                ctx.beginPath();
                this.state.guideLines.forEach(g => {
                    if(g.type==='v') { ctx.moveTo(g.x, 0); ctx.lineTo(g.x, this.state.viewH); }
                    else { ctx.moveTo(0, g.y); ctx.lineTo(this.state.viewW, g.y); }
                });
                ctx.stroke();
                ctx.restore();
            }

            // Temporary shapes are drawn directly in the input handler during drag
            // to avoid duplication issues. No need to draw them here.
        } catch (e) {
            console.error("Render error:", e);
        } finally {
            ctx.restore();
        }
    },

    renderLasso(ctx, points) {
        if(points.length < 2) return;
        this.render(); // Clear and redraw base
        ctx.save();
        ctx.strokeStyle = '#3b82f6';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length - 1; i++) {
            const xc = (points[i].x + points[i + 1].x) / 2;
            const yc = (points[i].y + points[i + 1].y) / 2;
            ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        ctx.stroke();
        ctx.restore();
    },

    renderObject(ctx, st, dx, dy) {
        if (!st) return; // Safety check
        ctx.save();
        if(st.rotation && st.tool!=='pen') {
            const cx = st.x + st.w/2 + dx;
            const cy = st.y + st.h/2 + dy;
            ctx.translate(cx, cy);
            ctx.rotate(st.rotation);
            ctx.translate(-cx, -cy);
        }
        ctx.translate(dx, dy);

        if(st.tool === 'text') {
            ctx.fillStyle = st.color;
            ctx.font = `${st.size}px sans-serif`;
            ctx.textBaseline = 'top';
            ctx.fillText(st.text, st.x, st.y);
        } else if(st.tool === 'shape') {
            ctx.strokeStyle = st.border; ctx.lineWidth = st.width;
            if(st.fill!=='transparent') { ctx.fillStyle=st.fill; }
            ctx.beginPath();
            const {x,y,w,h} = st;
            const cx = x + w/2, cy = y + h/2;
            const rx = Math.abs(w/2), ry = Math.abs(h/2);

            if(st.shapeType==='rectangle') ctx.rect(x,y,w,h);
            else if(st.shapeType==='circle') {
                ctx.ellipse(cx, cy, rx, ry, 0, 0, 2*Math.PI);
            } else if(st.shapeType==='line') { ctx.moveTo(x,y); ctx.lineTo(x+w,y+h); }
            else if(st.shapeType==='arrow') {
                const head=15; const ang=Math.atan2(h,w);
                ctx.moveTo(x,y); ctx.lineTo(x+w,y+h);
                ctx.lineTo(x+w - head*Math.cos(ang-0.5), y+h - head*Math.sin(ang-0.5));
                ctx.moveTo(x+w,y+h);
                ctx.lineTo(x+w - head*Math.cos(ang+0.5), y+h - head*Math.sin(ang+0.5));
            }
            else if(st.shapeType==='triangle') {
                ctx.moveTo(cx, y);
                ctx.lineTo(x + w, y + h);
                ctx.lineTo(x, y + h);
                ctx.closePath();
            }
            else if(st.shapeType==='diamond') {
                ctx.moveTo(cx, y);
                ctx.lineTo(x + w, cy);
                ctx.lineTo(cx, y + h);
                ctx.lineTo(x, cy);
                ctx.closePath();
            }
            else if(st.shapeType==='star') {
                const spikes = 5;
                const outerR = Math.min(rx, ry);
                const innerR = outerR * 0.5;
                let rot = -Math.PI / 2;
                ctx.moveTo(cx + outerR * Math.cos(rot), cy + outerR * Math.sin(rot));
                for (let i = 0; i < spikes; i++) {
                    rot += Math.PI / spikes;
                    ctx.lineTo(cx + innerR * Math.cos(rot), cy + innerR * Math.sin(rot));
                    rot += Math.PI / spikes;
                    ctx.lineTo(cx + outerR * Math.cos(rot), cy + outerR * Math.sin(rot));
                }
                ctx.closePath();
            }
            else if(st.shapeType==='hexagon') {
                this._drawPolygon(ctx, cx, cy, Math.min(rx, ry), 6);
            }
            else if(st.shapeType==='pentagon') {
                this._drawPolygon(ctx, cx, cy, Math.min(rx, ry), 5);
            }
            else if(st.shapeType==='octagon') {
                this._drawPolygon(ctx, cx, cy, Math.min(rx, ry), 8);
            }

            if(st.fill!=='transparent' && !['line','arrow'].includes(st.shapeType)) ctx.fill();
            ctx.stroke();
            if(this.state.activeShapeRatio) {
                ctx.beginPath(); ctx.strokeStyle = '#f472b6'; ctx.setLineDash([2,2]); ctx.lineWidth=1;
                ctx.moveTo(x,y); ctx.lineTo(x+w, y+h); ctx.stroke();
            }
        } else {
            // Safety check for points
            if (st.pts && st.pts.length > 0) {
                ctx.lineCap='round'; ctx.lineJoin='round'; ctx.lineWidth=st.size;
                ctx.strokeStyle = st.tool==='eraser' ? '#000' : st.color;
                if(st.tool==='eraser') ctx.globalCompositeOperation='destination-out';
                ctx.beginPath();
                ctx.moveTo(st.pts[0].x, st.pts[0].y);
                for(let i=1; i<st.pts.length; i++) ctx.lineTo(st.pts[i].x, st.pts[i].y);
                ctx.stroke();
            }
        }
        ctx.restore();
    },

    renderSelectionOverlay(ctx, hist) {
        let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
        this.state.selection.forEach(idx => {
            const st = hist[idx];
            let bx, by, bw, bh;
            if(st.tool==='pen') {
                 bx=st.pts[0].x; by=st.pts[0].y; let rx=bx, ry=by;
                 st.pts.forEach(p=>{bx=Math.min(bx,p.x);by=Math.min(by,p.y);rx=Math.max(rx,p.x);ry=Math.max(ry,p.y);});
                 bw=rx-bx; bh=ry-by;
            } else { bx=st.x; by=st.y; bw=st.w; bh=st.h; }

            if(this.dragOffset && this.state.selection.includes(idx)) { bx+=this.dragOffset.x; by+=this.dragOffset.y; }

            if(bw<0){bx+=bw; bw=-bw;} if(bh<0){by+=bh; bh=-bh;}
            minX=Math.min(minX,bx); minY=Math.min(minY,by); maxX=Math.max(maxX,bx+bw); maxY=Math.max(maxY,by+bh);
        });

        ctx.save();
        ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 2;
        ctx.strokeRect(minX, minY, maxX-minX, maxY-minY);

        ctx.fillStyle = '#fff'; ctx.lineWidth = 2;
        const drawHandle = (x,y) => { ctx.beginPath(); ctx.arc(x,y,5,0,2*Math.PI); ctx.fill(); ctx.stroke(); };
        drawHandle(minX, minY); drawHandle(maxX, minY);
        drawHandle(maxX, maxY); drawHandle(minX, maxY);

        ctx.beginPath(); ctx.arc((minX+maxX)/2, maxY+20, 10, 0, 2*Math.PI);
        ctx.strokeStyle='#0ea5e9'; ctx.stroke();
        ctx.fillStyle='#0ea5e9'; ctx.font='16px bootstrap-icons'; ctx.fillText('\uF14B', (minX+maxX)/2-8, maxY+26);
        ctx.restore();

        const menu = this.getElement('contextToolbar');
        const canvas = this.getElement('canvas');
        if(menu && canvas) {
            const cr = canvas.getBoundingClientRect();
            const sx = cr.width/this.state.viewW; const sy = cr.height/this.state.viewH;

            menu.style.display = 'flex';
            const screenMinX = (minX * this.state.zoom + this.state.pan.x) * sx;
            const screenMaxX = (maxX * this.state.zoom + this.state.pan.x) * sx;
            const screenMinY = (minY * this.state.zoom + this.state.pan.y) * sy;
            const screenMaxY = (maxY * this.state.zoom + this.state.pan.y) * sy;

            let mx = (screenMinX + screenMaxX)/2;
            let my = (screenMinY) - 50;
            if(my < 10) my = (screenMaxY) + 50;

            menu.style.left = (cr.left + mx - menu.offsetWidth/2) + 'px';
            menu.style.top = (cr.top + my) + 'px';

            // Show/hide edit text button based on selection
            const editTextBtn = this.getElement('ctxEditText');
            if (editTextBtn) {
                const hasTextSelected = this.state.selection.length === 1 &&
                    hist[this.state.selection[0]] &&
                    hist[this.state.selection[0]].tool === 'text';
                editTextBtn.style.display = hasTextSelected ? 'flex' : 'none';
            }
        }
    },

    // Helper to draw regular polygons (pentagon, hexagon, octagon)
    _drawPolygon(ctx, cx, cy, radius, sides) {
        const angle = (2 * Math.PI) / sides;
        const startAngle = -Math.PI / 2; // Start from top
        ctx.moveTo(cx + radius * Math.cos(startAngle), cy + radius * Math.sin(startAngle));
        for (let i = 1; i <= sides; i++) {
            ctx.lineTo(
                cx + radius * Math.cos(startAngle + angle * i),
                cy + radius * Math.sin(startAngle + angle * i)
            );
        }
        ctx.closePath();
    },

    rgbToLab(r,g,b) {
        let r_=r/255, g_=g/255, b_=b/255;
        r_ = r_>0.04045 ? Math.pow((r_+0.055)/1.055, 2.4) : r_/12.92;
        g_ = g_>0.04045 ? Math.pow((g_+0.055)/1.055, 2.4) : g_/12.92;
        b_ = b_>0.04045 ? Math.pow((b_+0.055)/1.055, 2.4) : b_/12.92;
        let x=(r_*0.4124+g_*0.3576+b_*0.1805)/0.95047, y=(r_*0.2126+g_*0.7152+b_*0.0722), z=(r_*0.0193+g_*0.1192+b_*0.9505)/1.08883;
        x = x>0.008856?Math.pow(x,1/3):(7.787*x)+16/116; y=y>0.008856?Math.pow(y,1/3):(7.787*y)+16/116; z=z>0.008856?Math.pow(z,1/3):(7.787*z)+16/116;
        return [(116*y)-16, 500*(x-y), 200*(y-z)];
    }
};