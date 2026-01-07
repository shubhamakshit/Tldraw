export const ColorRmRenderer = {
    // Invalidate the cached canvas (call when history changes)
    invalidateCache() {
        this.cache.isDirty = true;
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

    // Build the cached canvas with all committed strokes
    buildCommittedCache(ctx, currentImg) {
        if (!this.cache.isDirty && this.cache.committedCanvas) {
            return;  // Cache is valid
        }

        const activeHistory = currentImg?.history?.filter(st => !st.deleted) || [];

        // Create or resize offscreen canvas
        if (!this.cache.committedCanvas ||
            this.cache.committedCanvas.width !== this.state.viewW ||
            this.cache.committedCanvas.height !== this.state.viewH) {
            this.cache.committedCanvas = document.createElement('canvas');
            this.cache.committedCanvas.width = this.state.viewW;
            this.cache.committedCanvas.height = this.state.viewH;
            this.cache.committedCtx = this.cache.committedCanvas.getContext('2d');
        }

        const cacheCtx = this.cache.committedCtx;
        cacheCtx.clearRect(0, 0, this.state.viewW, this.state.viewH);

        // Draw all non-selected, committed strokes to cache
        activeHistory.forEach((st, idx) => {
            // Skip items being dragged (they'll be drawn live)
            if (this.state.selection.includes(idx)) return;
            this.renderObject(cacheCtx, st, 0, 0);
        });

        this.cache.isDirty = false;
        this.cache.lastHistoryLength = currentImg?.history?.length || 0;
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

            // Build cached canvas if needed (only rebuilds when dirty)
            this.buildCommittedCache(ctx, currentImg);

            // Draw the cached committed strokes
            if (this.cache.committedCanvas) {
                ctx.drawImage(this.cache.committedCanvas, 0, 0);
            }

            // Draw selected items with drag offset (these are live, not cached)
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
            if(st.shapeType==='rectangle') ctx.rect(x,y,w,h);
            else if(st.shapeType==='circle') {
                ctx.ellipse(x+w/2, y+h/2, Math.abs(w/2), Math.abs(h/2), 0, 0, 2*Math.PI);
            } else if(st.shapeType==='line') { ctx.moveTo(x,y); ctx.lineTo(x+w,y+h); }
            else if(st.shapeType==='arrow') {
                const head=15; const ang=Math.atan2(h,w);
                ctx.moveTo(x,y); ctx.lineTo(x+w,y+h);
                ctx.lineTo(x+w - head*Math.cos(ang-0.5), y+h - head*Math.sin(ang-0.5));
                ctx.moveTo(x+w,y+h);
                ctx.lineTo(x+w - head*Math.cos(ang+0.5), y+h - head*Math.sin(ang+0.5));
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
        }
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