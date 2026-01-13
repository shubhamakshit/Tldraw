export const ColorRmRenderer = {
    // Invalidate the cached canvas (call when history changes)
    invalidateCache() {
        this.cache.isDirty = true;
        this.cache.hiResCache = null; // Clear high-res cache
        this._previewCache = null; // Clear preview cache
        // Also invalidate performance manager caches
        if (this.performanceManager) {
            this.performanceManager.invalidateAll();
        }
    },

    // Invalidate only the preview cache (call when colors/strict change)
    invalidatePreviewCache() {
        this._previewCache = null;
        this._previewCacheKey = null;
    },

    // Render vector grid for infinite canvas (high DPI support)
    _renderVectorGrid(ctx, currentPage) {
        if (!currentPage || !currentPage.isInfinite || !currentPage.vectorGrid) return;

        const grid = currentPage.vectorGrid;
        const bounds = currentPage.bounds || { minX: 0, minY: 0, maxX: 4000, maxY: 3000 };
        const gridSize = grid.gridSize || 100;
        const zoom = this.state.zoom;
        const pan = this.state.pan;

        // Calculate visible area in world coordinates
        const viewW = this.state.viewW / zoom;
        const viewH = this.state.viewH / zoom;
        const worldX = -pan.x / zoom;
        const worldY = -pan.y / zoom;

        // Calculate grid bounds (only render visible grids)
        const startX = Math.floor(worldX / gridSize) * gridSize;
        const startY = Math.floor(worldY / gridSize) * gridSize;
        const endX = Math.ceil((worldX + viewW) / gridSize) * gridSize;
        const endY = Math.ceil((worldY + viewH) / gridSize) * gridSize;

        ctx.save();

        // Parse grid color with opacity
        const gridColorHex = grid.gridColor || '#ffffff';
        const r = parseInt(gridColorHex.slice(1, 3), 16) || 255;
        const g = parseInt(gridColorHex.slice(3, 5), 16) || 255;
        const b = parseInt(gridColorHex.slice(5, 7), 16) || 255;
        const opacity = grid.gridOpacity || 0.05;
        const gridColorRgba = `rgba(${r}, ${g}, ${b}, ${opacity})`;

        if (grid.gridStyle === 'subtle' || grid.gridStyle === 'lines') {
            ctx.strokeStyle = gridColorRgba;
            // Scale line width based on zoom for consistent appearance
            ctx.lineWidth = (grid.gridStyle === 'lines' ? 1 : 0.5) / zoom;

            ctx.beginPath();

            // Vertical lines
            for (let x = startX; x <= endX; x += gridSize) {
                ctx.moveTo(x, startY);
                ctx.lineTo(x, endY);
            }
            // Horizontal lines
            for (let y = startY; y <= endY; y += gridSize) {
                ctx.moveTo(startX, y);
                ctx.lineTo(endX, y);
            }

            ctx.stroke();
        } else if (grid.gridStyle === 'dots') {
            ctx.fillStyle = gridColorRgba;
            const dotSpacing = 50;
            // Scale dot size based on zoom
            const dotSize = Math.max(1, 2 / zoom);

            const dotStartX = Math.floor(worldX / dotSpacing) * dotSpacing;
            const dotStartY = Math.floor(worldY / dotSpacing) * dotSpacing;
            const dotEndX = Math.ceil((worldX + viewW) / dotSpacing) * dotSpacing;
            const dotEndY = Math.ceil((worldY + viewH) / dotSpacing) * dotSpacing;

            for (let x = dotStartX; x < dotEndX; x += dotSpacing) {
                for (let y = dotStartY; y < dotEndY; y += dotSpacing) {
                    ctx.beginPath();
                    ctx.arc(x, y, dotSize, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // Draw center crosshair (at origin 0,0)
        ctx.strokeStyle = grid.bgStyle === 'light' ? 'rgba(99, 102, 241, 0.3)' : 'rgba(139, 92, 246, 0.2)';
        ctx.lineWidth = 2 / zoom;

        ctx.beginPath();
        ctx.moveTo(-50, 0);
        ctx.lineTo(50, 0);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, -50);
        ctx.lineTo(0, 50);
        ctx.stroke();

        ctx.restore();
    },

    // Render complete vector background for infinite canvas (background fill + grid)
    // This provides crisp rendering at any zoom level
    _renderVectorBackground(ctx, currentPage) {
        if (!currentPage || !currentPage.isInfinite || !currentPage.vectorGrid) return;

        const grid = currentPage.vectorGrid;
        const bounds = currentPage.bounds || { minX: 0, minY: 0, maxX: 4000, maxY: 3000 };
        const zoom = this.state.zoom;
        const pan = this.state.pan;

        // Calculate visible area in world coordinates
        const viewW = this.state.viewW / zoom;
        const viewH = this.state.viewH / zoom;
        const worldX = -pan.x / zoom;
        const worldY = -pan.y / zoom;

        // Expand visible area slightly for smoother panning
        const padding = 100;
        const visMinX = worldX - padding;
        const visMinY = worldY - padding;
        const visMaxX = worldX + viewW + padding;
        const visMaxY = worldY + viewH + padding;

        ctx.save();

        // --- RENDER BACKGROUND FILL ---
        // Use the visible area bounds for the background (slightly larger than viewport)
        const bgMinX = Math.min(visMinX, bounds.minX);
        const bgMinY = Math.min(visMinY, bounds.minY);
        const bgMaxX = Math.max(visMaxX, bounds.maxX);
        const bgMaxY = Math.max(visMaxY, bounds.maxY);

        if (grid.bgStyle === 'dark') {
            // Gradient background for dark theme
            const gradW = bgMaxX - bgMinX;
            const gradH = bgMaxY - bgMinY;
            const gradient = ctx.createLinearGradient(bgMinX, bgMinY, bgMaxX, bgMaxY);
            gradient.addColorStop(0, '#1a1a2e');
            gradient.addColorStop(0.5, '#16213e');
            gradient.addColorStop(1, '#0f3460');
            ctx.fillStyle = gradient;
        } else if (grid.bgStyle === 'light') {
            // Gradient background for light theme
            const gradient = ctx.createLinearGradient(bgMinX, bgMinY, bgMaxX, bgMaxY);
            gradient.addColorStop(0, '#f8fafc');
            gradient.addColorStop(0.5, '#f1f5f9');
            gradient.addColorStop(1, '#e2e8f0');
            ctx.fillStyle = gradient;
        } else {
            // Custom solid color
            ctx.fillStyle = grid.customBgColor || '#1a1a2e';
        }

        ctx.fillRect(bgMinX, bgMinY, bgMaxX - bgMinX, bgMaxY - bgMinY);

        // --- RENDER GRID ---
        const gridSize = grid.gridSize || 100;

        // Calculate grid bounds (only render visible grids)
        const startX = Math.floor(visMinX / gridSize) * gridSize;
        const startY = Math.floor(visMinY / gridSize) * gridSize;
        const endX = Math.ceil(visMaxX / gridSize) * gridSize;
        const endY = Math.ceil(visMaxY / gridSize) * gridSize;

        // Parse grid color with opacity
        const gridColorHex = grid.gridColor || '#ffffff';
        const r = parseInt(gridColorHex.slice(1, 3), 16) || 255;
        const g = parseInt(gridColorHex.slice(3, 5), 16) || 255;
        const b = parseInt(gridColorHex.slice(5, 7), 16) || 255;
        const opacity = grid.gridOpacity || 0.05;
        const gridColorRgba = `rgba(${r}, ${g}, ${b}, ${opacity})`;

        if (grid.gridStyle === 'subtle' || grid.gridStyle === 'lines') {
            ctx.strokeStyle = gridColorRgba;
            // Scale line width based on zoom for consistent appearance
            ctx.lineWidth = (grid.gridStyle === 'lines' ? 1 : 0.5) / zoom;

            ctx.beginPath();

            // Vertical lines
            for (let x = startX; x <= endX; x += gridSize) {
                ctx.moveTo(x, startY);
                ctx.lineTo(x, endY);
            }
            // Horizontal lines
            for (let y = startY; y <= endY; y += gridSize) {
                ctx.moveTo(startX, y);
                ctx.lineTo(endX, y);
            }

            ctx.stroke();
        } else if (grid.gridStyle === 'dots') {
            ctx.fillStyle = gridColorRgba;
            const dotSpacing = 50;
            // Scale dot size based on zoom
            const dotSize = Math.max(1, 2 / zoom);

            const dotStartX = Math.floor(visMinX / dotSpacing) * dotSpacing;
            const dotStartY = Math.floor(visMinY / dotSpacing) * dotSpacing;
            const dotEndX = Math.ceil(visMaxX / dotSpacing) * dotSpacing;
            const dotEndY = Math.ceil(visMaxY / dotSpacing) * dotSpacing;

            for (let x = dotStartX; x < dotEndX; x += dotSpacing) {
                for (let y = dotStartY; y < dotEndY; y += dotSpacing) {
                    ctx.beginPath();
                    ctx.arc(x, y, dotSize, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // Draw center crosshair (at origin 0,0)
        ctx.strokeStyle = grid.bgStyle === 'light' ? 'rgba(99, 102, 241, 0.3)' : 'rgba(139, 92, 246, 0.2)';
        ctx.lineWidth = 2 / zoom;

        ctx.beginPath();
        ctx.moveTo(-50, 0);
        ctx.lineTo(50, 0);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, -50);
        ctx.lineTo(0, 50);
        ctx.stroke();

        ctx.restore();
    },

    // Request a debounced preview render
    requestPreviewRender() {
        if (this._previewDebounceTimer) {
            clearTimeout(this._previewDebounceTimer);
        }
        this._previewDebounceTimer = setTimeout(() => {
            this._previewCache = null; // Force rebuild
            this.render();
        }, 50); // 50ms debounce for preview updates
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

    // Adaptive stroke cache threshold based on device performance
    _getStrokeCacheThreshold() {
        // On mobile/low-end devices, cache earlier
        if (this._strokeCacheThreshold) return this._strokeCacheThreshold;

        // Check for low-end device hints
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        const cores = navigator.hardwareConcurrency || 4;
        const isLowEnd = isMobile || cores <= 4;

        this._strokeCacheThreshold = isLowEnd ? 50 : 100;
        return this._strokeCacheThreshold;
    },

    // Build or update spatial index for infinite canvas
    _ensureSpatialIndex(currentImg) {
        if (!currentImg?.isInfinite || !this.performanceManager) return;

        const history = currentImg.history?.filter(st => !st.deleted) || [];

        // Check if we need to rebuild the index
        const currentHistoryLength = history.length;
        if (this._lastIndexedHistoryLength === currentHistoryLength &&
            this._lastIndexedPageId === currentImg.pageId) {
            return; // Index is up to date
        }

        // Build spatial index with current bounds
        const bounds = currentImg.bounds || {
            minX: 0, minY: 0,
            maxX: this.state.viewW,
            maxY: this.state.viewH
        };

        this.performanceManager.buildSpatialIndex(history, {
            x: bounds.minX,
            y: bounds.minY,
            w: bounds.maxX - bounds.minX,
            h: bounds.maxY - bounds.minY
        });

        this._lastIndexedHistoryLength = currentHistoryLength;
        this._lastIndexedPageId = currentImg.pageId;
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

        // Check if this is an infinite canvas page
        const currentImg = this.state.images[this.state.idx];
        const isInfiniteCanvas = currentImg?.isInfinite === true;

        try {
            ctx.save();
            ctx.translate(this.state.pan.x, this.state.pan.y);
            ctx.scale(this.state.zoom, this.state.zoom);

            // For infinite canvas, render vector background instead of bitmap for crispness
            if (isInfiniteCanvas && currentImg.vectorGrid) {
                this._renderVectorBackground(ctx, currentImg);
            }
            // Preview logic - with caching for performance
            else if(this.state.previewOn || (this.tempHex && this.state.pickerMode==='remove')) {
                let targets = this.state.colors.map(x=>x.lab);
                if(this.tempHex) {
                    const i = parseInt(this.tempHex.slice(1), 16);
                    targets.push(this.rgbToLab((i>>16)&255, (i>>8)&255, i&255));
                }
                if(targets.length > 0) {
                    // Generate cache key based on colors, strict, and tempHex
                    const cacheKey = JSON.stringify({
                        colors: targets,
                        strict: this.state.strict,
                        tempHex: this.tempHex,
                        viewW: this.state.viewW,
                        viewH: this.state.viewH
                    });

                    // Use cached preview if available and valid
                    if (this._previewCache && this._previewCacheKey === cacheKey) {
                        ctx.drawImage(this._previewCache, 0, 0);
                    } else {
                        // Build preview canvas
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

                        // Cache the result
                        this._previewCache = tmpC;
                        this._previewCacheKey = cacheKey;

                        ctx.drawImage(tmpC, 0, 0);
                    }
                } else {
                    ctx.drawImage(this.cache.currentImg, 0, 0, this.state.viewW, this.state.viewH);
                }
            } else {
                ctx.drawImage(this.cache.currentImg, 0, 0, this.state.viewW, this.state.viewH);
            }

            const activeHistory = currentImg?.history?.filter(st => !st.deleted) || [];

            // HYBRID RENDERING: Use cache when idle, render live when interacting
            const isInteracting = this.isDragging || this.state.selection.length > 0;
            const cacheThreshold = this._getStrokeCacheThreshold();

            // SOTA: Build/update spatial index for infinite canvas
            if (isInfiniteCanvas) {
                this._ensureSpatialIndex(currentImg);
            }

            // SOTA: Use optimized rendering for infinite canvas with many strokes
            const useSOTARendering = isInfiniteCanvas &&
                                      this.performanceManager &&
                                      activeHistory.length > 100;

            if (useSOTARendering) {
                // SOTA OPTIMIZED RENDERING for infinite canvas
                const viewport = { width: this.state.viewW, height: this.state.viewH };

                // Query only visible strokes using quadtree
                const visibleStrokes = this.performanceManager.queryVisible(
                    viewport, this.state.zoom, this.state.pan
                );

                // Filter out selected strokes and apply LOD
                visibleStrokes.forEach((st) => {
                    const idx = activeHistory.indexOf(st);
                    if (this.state.selection.includes(idx)) return;

                    // Apply LOD simplification for zoomed-out views
                    if (st.tool === 'pen' && st.pts) {
                        const simplifiedPts = this.performanceManager.getSimplifiedPoints(st, this.state.zoom);
                        this.renderObject(ctx, { ...st, pts: simplifiedPts }, 0, 0);
                    } else {
                        this.renderObject(ctx, st, 0, 0);
                    }
                });
            } else if (isInteracting || activeHistory.length < cacheThreshold) {
                // LIVE RENDERING: Always render strokes directly for crispness
                // Used when drawing, selecting, or when stroke count is low
                activeHistory.forEach((st, idx) => {
                    if (this.state.selection.includes(idx)) return;
                    // Viewport culling for infinite canvas
                    if (isInfiniteCanvas && st.tool === 'pen' && !this.isStrokeVisible(st)) return;
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
                        // Viewport culling for infinite canvas
                        if (isInfiniteCanvas && st.tool === 'pen' && !this.isStrokeVisible(st)) return;
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

            if(this.state.guideLines && this.state.guideLines.length > 0) {
                ctx.save();
                ctx.strokeStyle = '#f472b6';
                ctx.lineWidth = 1 / this.state.zoom;
                ctx.setLineDash([4 / this.state.zoom, 4 / this.state.zoom]);
                ctx.beginPath();
                this.state.guideLines.forEach(g => {
                    if(g.type === 'vertical' || g.type === 'v') {
                        ctx.moveTo(g.x, g.y1 || 0);
                        ctx.lineTo(g.x, g.y2 || this.state.viewH);
                    } else if(g.type === 'horizontal' || g.type === 'h') {
                        ctx.moveTo(g.x1 || 0, g.y);
                        ctx.lineTo(g.x2 || this.state.viewW, g.y);
                    }
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

        // Handle group objects - render all children
        if(st.tool === 'group') {
            // Calculate offset from original children positions
            const originalBounds = this._getGroupBounds ? this._getGroupBounds(st.children) : { minX: st.x, minY: st.y };
            const groupDx = st.x - originalBounds.minX;
            const groupDy = st.y - originalBounds.minY;

            st.children.forEach(child => {
                // Apply group offset to children
                let childDx = groupDx;
                let childDy = groupDy;
                this.renderObject(ctx, child, childDx, childDy);
            });
            ctx.restore();
            return;
        }

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

            const menuWidth = menu.offsetWidth || 200;
            const menuHeight = menu.offsetHeight || 40;
            const handleSize = 20; // Size of corner resize handles + margin
            const margin = 15;

            // Calculate center X, but ensure we don't overlap corner handles
            let mx = (screenMinX + screenMaxX) / 2;

            // Position above selection by default
            let my = screenMinY - menuHeight - margin;

            // If too close to top, position below selection
            if (my < 10) {
                my = screenMaxY + margin;
            }

            // Ensure menu stays away from corner handles - shift horizontally if needed
            const selectionWidth = screenMaxX - screenMinX;
            if (selectionWidth < menuWidth + handleSize * 2) {
                // Selection is narrow - center the menu but ensure it clears the handles
                mx = (screenMinX + screenMaxX) / 2;
            }

            // Clamp to screen bounds
            const finalX = Math.max(10, Math.min(cr.width - menuWidth - 10, mx - menuWidth / 2));
            const finalY = Math.max(10, Math.min(cr.height - menuHeight - 10, my));

            menu.style.left = (cr.left + finalX) + 'px';
            menu.style.top = (cr.top + finalY) + 'px';

            // Close the context dropdown when selection changes
            const selectionKey = this.state.selection.slice().sort().join(',');
            if (this._lastSelectionKey !== selectionKey) {
                this._lastSelectionKey = selectionKey;
                const ctxDrop = this.getElement('ctxDrop');
                if (ctxDrop) ctxDrop.classList.remove('show');
            }

            // Show/hide edit text button based on selection
            const editTextBtn = this.getElement('ctxEditText');
            if (editTextBtn) {
                const hasTextSelected = this.state.selection.length === 1 &&
                    hist[this.state.selection[0]] &&
                    hist[this.state.selection[0]].tool === 'text';
                editTextBtn.style.display = hasTextSelected ? 'flex' : 'none';
            }

            // Show/hide group/ungroup buttons based on selection
            const groupBtn = this.getElement('ctxGroup');
            const ungroupBtn = this.getElement('ctxUngroup');
            const groupMenu = document.getElementById('ctxGroupMenu');
            const ungroupMenu = document.getElementById('ctxUngroupMenu');

            // Can group if 2+ non-group items selected
            const canGroup = this.state.selection.length >= 2;
            // Can ungroup if exactly 1 group is selected
            const hasGroupSelected = this.state.selection.length === 1 &&
                hist[this.state.selection[0]] &&
                hist[this.state.selection[0]].tool === 'group';

            if (groupBtn) groupBtn.style.display = canGroup ? 'flex' : 'none';
            if (ungroupBtn) ungroupBtn.style.display = hasGroupSelected ? 'flex' : 'none';
            if (groupMenu) groupMenu.style.display = canGroup ? 'block' : 'none';
            if (ungroupMenu) ungroupMenu.style.display = hasGroupSelected ? 'block' : 'none';
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

    // Helper to get combined bounding box for group children
    _getGroupBounds(items) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        items.forEach(item => {
            let bounds;
            if (item.tool === 'pen' || item.tool === 'eraser') {
                if (!item.pts || item.pts.length === 0) return;
                let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
                item.pts.forEach(p => {
                    pMinX = Math.min(pMinX, p.x);
                    pMinY = Math.min(pMinY, p.y);
                    pMaxX = Math.max(pMaxX, p.x);
                    pMaxY = Math.max(pMaxY, p.y);
                });
                bounds = { minX: pMinX, minY: pMinY, maxX: pMaxX, maxY: pMaxY };
            } else {
                let x = item.x, y = item.y, w = item.w || 0, h = item.h || 0;
                if (w < 0) { x += w; w = -w; }
                if (h < 0) { y += h; h = -h; }
                bounds = { minX: x, minY: y, maxX: x + w, maxY: y + h };
            }
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
        });

        return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
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