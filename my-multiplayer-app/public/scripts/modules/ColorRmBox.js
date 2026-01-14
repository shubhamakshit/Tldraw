export const ColorRmBox = {
    // --- The Clipboard Box Feature ---
    // Stores vector data for full quality export (no rasterization)
    // Falls back to raster for background images only
    addToBox(x, y, w, h, srcOrBlob=null, pageIdx=null) {
        if(!this.state.clipboardBox) this.state.clipboardBox = [];

        const currentPageIdx = (pageIdx !== null) ? pageIdx : this.state.idx;
        const currentPage = this.state.images[currentPageIdx];

        // If a Blob was passed directly (legacy raster support)
        if (srcOrBlob instanceof Blob) {
            this.state.clipboardBox.push({
                id: Date.now() + Math.random(),
                type: 'raster',
                blob: srcOrBlob,
                blobUrl: null,
                w: w, h: h,
                pageIdx: currentPageIdx
            });
            this.ui.showToast("Added to Box (raster)");
            this.saveSessionState();
            if(this.state.activeSideTab === 'box') this.renderBox();
            return;
        }

        // If a base64 dataURL was passed (legacy support), convert to Blob
        if (srcOrBlob && typeof srcOrBlob === 'string' && srcOrBlob.startsWith('data:')) {
            fetch(srcOrBlob)
                .then(res => res.blob())
                .then(blob => {
                    this.state.clipboardBox.push({
                        id: Date.now() + Math.random(),
                        type: 'raster',
                        blob: blob,
                        blobUrl: null,
                        w: w, h: h,
                        pageIdx: currentPageIdx
                    });
                    this.ui.showToast("Added to Box (raster)");
                    this.saveSessionState();
                    if(this.state.activeSideTab === 'box') this.renderBox();
                });
            return;
        }

        // Capture vector data from the region
        const capturedItems = [];
        const bounds = { x, y, w, h, maxX: x + w, maxY: y + h };

        if (currentPage && currentPage.history) {
            currentPage.history.forEach(item => {
                if (item.deleted) return;

                // Check if item intersects with capture region
                if (this._itemIntersectsRegion(item, bounds)) {
                    // Deep clone the item and translate to local coordinates
                    const clonedItem = JSON.parse(JSON.stringify(item));
                    this._translateItemToLocal(clonedItem, x, y);
                    capturedItems.push(clonedItem);
                }
            });
        }

        // Also capture background if page has one
        let backgroundBlob = null;
        if (currentPage && currentPage.blob && !currentPage.isInfinite) {
            // For pages with background, we'll capture just the region
            // This is done asynchronously
            this._captureBackgroundRegion(currentPage.blob, x, y, w, h).then(blob => {
                this.state.clipboardBox.push({
                    id: Date.now() + Math.random(),
                    type: 'vector',
                    history: capturedItems,
                    backgroundBlob: blob,
                    blobUrl: null,
                    x: 0, y: 0,
                    w: w, h: h,
                    originalBounds: { x, y, w, h },
                    pageIdx: currentPageIdx,
                    isInfinite: currentPage.isInfinite || false,
                    vectorGrid: currentPage.vectorGrid || null
                });
                this.ui.showToast(`Added ${capturedItems.length} items to Box (vector)`);
                this.saveSessionState();
                if(this.state.activeSideTab === 'box') this.renderBox();
            });
        } else {
            // Infinite canvas or no background - just store vectors
            this.state.clipboardBox.push({
                id: Date.now() + Math.random(),
                type: 'vector',
                history: capturedItems,
                backgroundBlob: null,
                blobUrl: null,
                x: 0, y: 0,
                w: w, h: h,
                originalBounds: { x, y, w, h },
                pageIdx: currentPageIdx,
                isInfinite: currentPage?.isInfinite || false,
                vectorGrid: currentPage?.vectorGrid || null
            });
            this.ui.showToast(`Added ${capturedItems.length} items to Box (vector)`);
            this.saveSessionState();
            if(this.state.activeSideTab === 'box') this.renderBox();
        }
    },

    /**
     * Check if an item intersects with a region
     */
    _itemIntersectsRegion(item, bounds) {
        let itemBounds;

        if (item.tool === 'pen' || item.tool === 'eraser') {
            if (!item.pts || item.pts.length === 0) return false;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of item.pts) {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
            }
            const pad = (item.size || 3) / 2;
            itemBounds = { x: minX - pad, y: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
        } else if (item.tool === 'group' && item.children) {
            // For groups, check if any child intersects
            return item.children.some(child => this._itemIntersectsRegion(child, bounds));
        } else {
            // Shapes, text, images
            itemBounds = {
                x: item.x || 0,
                y: item.y || 0,
                maxX: (item.x || 0) + (item.w || 0),
                maxY: (item.y || 0) + (item.h || 0)
            };
        }

        // Check intersection
        return !(itemBounds.maxX < bounds.x || itemBounds.x > bounds.maxX ||
                 itemBounds.maxY < bounds.y || itemBounds.y > bounds.maxY);
    },

    /**
     * Translate item coordinates to local (relative to capture origin)
     */
    _translateItemToLocal(item, originX, originY) {
        if (item.tool === 'pen' || item.tool === 'eraser') {
            if (item.pts) {
                item.pts.forEach(p => {
                    p.x -= originX;
                    p.y -= originY;
                });
            }
        } else if (item.tool === 'group' && item.children) {
            item.x = (item.x || 0) - originX;
            item.y = (item.y || 0) - originY;
            item.children.forEach(child => this._translateItemToLocal(child, 0, 0));
        } else {
            item.x = (item.x || 0) - originX;
            item.y = (item.y || 0) - originY;
        }
    },

    /**
     * Capture a region of a background image as a blob
     */
    async _captureBackgroundRegion(blob, x, y, w, h) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                const cvs = document.createElement('canvas');
                cvs.width = w;
                cvs.height = h;
                const ctx = cvs.getContext('2d');

                // Draw the cropped region
                ctx.drawImage(img, x, y, w, h, 0, 0, w, h);

                cvs.toBlob(resolve, 'image/jpeg', 0.92);
                URL.revokeObjectURL(img.src);
            };
            img.src = URL.createObjectURL(blob);
        });
    },

    captureFullPage() {
        const currentPage = this.state.images[this.state.idx];
        if (!currentPage) return;

        // For full page, capture all content
        if (currentPage.isInfinite) {
            // Calculate content bounds for infinite canvas
            const bounds = this._calculatePageContentBounds(currentPage);
            if (bounds) {
                const padding = 50;
                this.addToBox(
                    bounds.minX - padding,
                    bounds.minY - padding,
                    bounds.maxX - bounds.minX + padding * 2,
                    bounds.maxY - bounds.minY + padding * 2
                );
            } else {
                this.ui.showToast("No content to capture");
            }
        } else {
            // Regular page - use view dimensions
            this.addToBox(0, 0, this.state.viewW, this.state.viewH);
        }
    },

    /**
     * Calculate content bounds for a page
     */
    _calculatePageContentBounds(page) {
        if (!page.history || page.history.length === 0) return null;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let hasContent = false;

        for (const item of page.history) {
            if (item.deleted) continue;

            if (item.tool === 'pen' || item.tool === 'eraser') {
                if (item.pts) {
                    for (const p of item.pts) {
                        minX = Math.min(minX, p.x);
                        minY = Math.min(minY, p.y);
                        maxX = Math.max(maxX, p.x);
                        maxY = Math.max(maxY, p.y);
                        hasContent = true;
                    }
                }
            } else {
                minX = Math.min(minX, item.x || 0);
                minY = Math.min(minY, item.y || 0);
                maxX = Math.max(maxX, (item.x || 0) + (item.w || 0));
                maxY = Math.max(maxY, (item.y || 0) + (item.h || 0));
                hasContent = true;
            }
        }

        if (!hasContent) return null;
        return { minX, minY, maxX, maxY };
    },

    async addRangeToBox() {
        const txt = this.getElement('boxRangeInput').value.trim();
        if(!txt) {
            this.ui.showToast("Please enter a range (e.g. 1, 3-5)");
            return;
        }

        const indices = [];
        const set = new Set();
        txt.split(',').forEach(p => {
            if(p.includes('-')) {
                const [s,e] = p.split('-').map(n=>parseInt(n));
                if(!isNaN(s) && !isNaN(e)) for(let k=s; k<=e; k++) if(k>0 && k<=this.state.images.length) set.add(k-1);
            } else { const n=parseInt(p); if(!isNaN(n) && n>0 && n<=this.state.images.length) set.add(n-1); }
        });
        indices.push(...Array.from(set).sort((a,b)=>a-b));

        if(indices.length === 0) {
            this.ui.showToast("No valid pages found in range");
            return;
        }

        this.ui.toggleLoader(true, "Adding Pages to Box (Vector)...");

        for(let i=0; i<indices.length; i++) {
            const idx = indices[i];
            this.ui.updateProgress((i/indices.length)*100, `Processing Page ${idx+1}`);
            const item = this.state.images[idx];
            if (!item) continue;

            // Store full page as vector data
            if(!this.state.clipboardBox) this.state.clipboardBox = [];

            this.state.clipboardBox.push({
                id: Date.now() + Math.random(),
                type: 'vector',
                history: item.history ? JSON.parse(JSON.stringify(item.history.filter(h => !h.deleted))) : [],
                backgroundBlob: item.blob || null,
                blobUrl: null,
                x: 0, y: 0,
                w: this.state.viewW,
                h: this.state.viewH,
                originalBounds: { x: 0, y: 0, w: this.state.viewW, h: this.state.viewH },
                pageIdx: idx,
                isInfinite: item.isInfinite || false,
                vectorGrid: item.vectorGrid || null
            });

            await new Promise(r => setTimeout(r, 0));
        }

        this.ui.toggleLoader(false);
        this.getElement('boxRangeInput').value = '';
        this.ui.showToast(`Added ${indices.length} pages to Box (vector)`);
        this.saveSessionState();
        if(this.state.activeSideTab === 'box') this.renderBox();
    },

    renderBox() {
        const el = this.getElement('boxList');
        if (!el) return;

        // Revoke old blob URLs to prevent memory leaks
        if (this.boxBlobUrls) {
            this.boxBlobUrls.forEach(url => URL.revokeObjectURL(url));
        }
        this.boxBlobUrls = [];

        el.innerHTML = '';
        const countEl = this.getElement('boxCount');
        if (countEl) countEl.innerText = (this.state.clipboardBox || []).length;

        if(!this.state.clipboardBox || this.state.clipboardBox.length === 0) {
            el.innerHTML = '<div style="grid-column:1/-1; color:#666; text-align:center; padding:20px;">Box is empty. Use Capture Tool or Add Full Page.</div>';
            return;
        }

        this.state.clipboardBox.forEach((item, idx) => {
            const div = document.createElement('div');
            div.className = 'box-item';

            // Handle vector items - render a thumbnail
            if (item.type === 'vector') {
                this._renderVectorThumbnail(item).then(url => {
                    if (url) {
                        this.boxBlobUrls.push(url);
                        const im = div.querySelector('img');
                        if (im) im.src = url;
                    }
                });
                const im = new Image();
                im.style.background = '#1a1a2e';
                im.alt = `Vector (${item.history?.length || 0} items)`;
                div.appendChild(im);

                // Add vector badge
                const badge = document.createElement('span');
                badge.className = 'box-badge';
                badge.textContent = 'V';
                badge.title = `Vector: ${item.history?.length || 0} items`;
                badge.style.cssText = 'position:absolute;top:2px;left:2px;background:#10b981;color:white;font-size:10px;padding:2px 4px;border-radius:3px;';
                div.appendChild(badge);
            } else {
                // Raster items (legacy)
                const im = new Image();
                if (item.blob) {
                    const url = URL.createObjectURL(item.blob);
                    this.boxBlobUrls.push(url);
                    im.src = url;
                } else if (item.src) {
                    im.src = item.src;  // Legacy base64 support
                }
                div.appendChild(im);
            }

            const btn = document.createElement('button');
            btn.className = 'box-del';
            btn.innerHTML = '<i class="bi bi-trash"></i>';
            btn.onclick = () => {
                // Revoke the URL for this item if it has one
                if (item.blob && item.blobUrl) {
                    URL.revokeObjectURL(item.blobUrl);
                }
                this.state.clipboardBox.splice(idx, 1);
                this.saveSessionState();
                this.renderBox();
            };
            div.appendChild(btn);
            el.appendChild(div);
        });
    },

    /**
     * Render a vector item to a thumbnail for display
     */
    async _renderVectorThumbnail(item) {
        const thumbSize = 150;
        const cvs = document.createElement('canvas');
        cvs.width = thumbSize;
        cvs.height = thumbSize;
        const ctx = cvs.getContext('2d');

        // Calculate scale to fit
        const scale = Math.min(thumbSize / item.w, thumbSize / item.h);
        const offsetX = (thumbSize - item.w * scale) / 2;
        const offsetY = (thumbSize - item.h * scale) / 2;

        // Draw background
        if (item.backgroundBlob) {
            try {
                const img = new Image();
                const url = URL.createObjectURL(item.backgroundBlob);
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                    img.src = url;
                });
                ctx.drawImage(img, offsetX, offsetY, item.w * scale, item.h * scale);
                URL.revokeObjectURL(url);
            } catch (e) {
                ctx.fillStyle = '#1a1a2e';
                ctx.fillRect(0, 0, thumbSize, thumbSize);
            }
        } else if (item.isInfinite) {
            ctx.fillStyle = item.vectorGrid?.bgStyle === 'light' ? '#f8fafc' : '#1a1a2e';
            ctx.fillRect(0, 0, thumbSize, thumbSize);
        } else {
            ctx.fillStyle = '#333';
            ctx.fillRect(0, 0, thumbSize, thumbSize);
        }

        // Draw history items
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        if (item.history) {
            for (const st of item.history) {
                if (st.deleted) continue;
                this._renderItemToContext(ctx, st);
            }
        }
        ctx.restore();

        return new Promise(resolve => {
            cvs.toBlob(blob => {
                if (blob) {
                    resolve(URL.createObjectURL(blob));
                } else {
                    resolve(null);
                }
            }, 'image/png');
        });
    },

    /**
     * Render a single history item to canvas context
     */
    _renderItemToContext(ctx, st) {
        ctx.save();

        if (st.rotation && st.tool !== 'pen' && st.tool !== 'eraser') {
            const cx = st.x + st.w / 2;
            const cy = st.y + st.h / 2;
            ctx.translate(cx, cy);
            ctx.rotate(st.rotation);
            ctx.translate(-cx, -cy);
        }

        if (st.tool === 'pen' || st.tool === 'eraser') {
            if (st.pts && st.pts.length > 0) {
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.lineWidth = st.size || 3;
                ctx.strokeStyle = st.tool === 'eraser' ? '#000' : (st.color || '#000');
                if (st.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';

                ctx.beginPath();
                ctx.moveTo(st.pts[0].x, st.pts[0].y);
                for (let i = 1; i < st.pts.length; i++) {
                    ctx.lineTo(st.pts[i].x, st.pts[i].y);
                }
                ctx.stroke();
            }
        } else if (st.tool === 'text') {
            ctx.fillStyle = st.color || '#000';
            ctx.font = `${st.size || 16}px sans-serif`;
            ctx.textBaseline = 'top';
            ctx.fillText(st.text || '', st.x || 0, st.y || 0);
        } else if (st.tool === 'shape') {
            ctx.strokeStyle = st.border || '#000';
            ctx.lineWidth = st.width || 2;
            if (st.fill && st.fill !== 'transparent') {
                ctx.fillStyle = st.fill;
            }

            const { x, y, w, h, shapeType } = st;
            ctx.beginPath();

            if (shapeType === 'rectangle') {
                ctx.rect(x, y, w, h);
            } else if (shapeType === 'circle') {
                ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, 2 * Math.PI);
            } else if (shapeType === 'line') {
                ctx.moveTo(x, y);
                ctx.lineTo(x + w, y + h);
            }

            if (st.fill && st.fill !== 'transparent' && !['line', 'arrow'].includes(shapeType)) {
                ctx.fill();
            }
            ctx.stroke();
        } else if (st.tool === 'group' && st.children) {
            for (const child of st.children) {
                this._renderItemToContext(ctx, child);
            }
        }

        ctx.restore();
    },

    async clearBox() {
        const confirmed = await this.ui.showConfirm("Clear Box", "Clear all items in Box?");
        if(confirmed) {
            // Revoke all blob URLs
            if (this.boxBlobUrls) {
                this.boxBlobUrls.forEach(url => URL.revokeObjectURL(url));
                this.boxBlobUrls = [];
            }
            this.state.clipboardBox = [];
            this.saveSessionState();
            this.renderBox();
        }
    },

    addBoxTag(t, area) {
        const id = area === 'header' ? 'boxHeaderTxt' : 'boxLabelTxt';
        const el = this.getElement(id);
        if(el) el.value += " " + t;
    },

    processTags(text, context = {}) {
        const now = new Date();
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        let res = text.replace('{date}', now.toLocaleDateString())
                      .replace('{day}', days[now.getDay()])
                      .replace('{time}', now.toLocaleTimeString())
                      .replace('{count}', (this.state.clipboardBox||[]).length);

        if(context.seq !== undefined) res = res.replace('{seq}', context.seq);
        if(context.page !== undefined) res = res.replace('{page}', context.page);

        return res;
    },

    async generateBoxImage() {
        if(!this.state.clipboardBox || this.state.clipboardBox.length === 0) {
            this.ui.showToast("Box is empty");
            return;
        }

        this.ui.toggleLoader(true, "Generating Sheets...");

        const cols = parseInt(this.getElement('boxCols').value);
        const pad = 50;
        const A4W = 2480;
        const A4H = 3508;
        const colW = (A4W - (pad * (cols + 1))) / cols;

        // Configs
        const practiceOn = this.getElement('boxPracticeOn').checked;
        const practiceCol = this.getElement('boxPracticeColor').value;
        const labelsOn = this.getElement('boxLabelsOn').checked;
        const labelPos = this.getElement('boxLabelsPos').value;
        const labelTxt = this.getElement('boxLabelTxt').value;
        const labelH = labelsOn ? 60 : 0;

        // Pagination State
        let pages = [];
        let currentCanvas = document.createElement('canvas');
        currentCanvas.width = A4W; currentCanvas.height = A4H;
        let ctx = currentCanvas.getContext('2d');

        // Helper to start new page
        const initPage = () => {
             ctx.fillStyle = "#ffffff"; ctx.fillRect(0,0, A4W, A4H);
             return this.getElement('boxHeaderOn').checked ? 150 : pad;
        };

        let currentY = initPage();

        // 1. Organize into Rows
        const rows = [];
        for(let i = 0; i < this.state.clipboardBox.length; i += cols) {
             const rowItems = this.state.clipboardBox.slice(i, i + cols);

             // Calculate Heights
             const effectiveImgW = practiceOn ? (colW/2 - 10) : colW;

             const rowHeights = rowItems.map(item => item.h * (effectiveImgW / item.w));
             const maxRowH = Math.max(...rowHeights);

             rows.push({
                 items: rowItems.map((item, idx) => ({
                     item,
                     finalH: item.h * (effectiveImgW / item.w),
                     seq: i + idx + 1
                 })),
                 height: maxRowH + labelH + pad
             });
        }

        // 2. Draw Loop
        for(let r=0; r<rows.length; r++) {
            const row = rows[r];

            // Check Pagination
            if((currentY + row.height + (this.getElement('boxFooterOn').checked ? 100 : 0)) > A4H) {
                this.drawHeaderFooter(ctx, A4W, A4H);
                pages.push(currentCanvas);

                currentCanvas = document.createElement('canvas');
                currentCanvas.width = A4W; currentCanvas.height = A4H;
                ctx = currentCanvas.getContext('2d');
                currentY = initPage();
            }

            // Draw Row
            for(let c=0; c<row.items.length; c++) {
                const {item, finalH, seq} = row.items[c];
                const x = pad + (c * colW);
                const y = currentY;

                // Draw Image
                const im = new Image();
                if (item.blob) {
                    im.src = URL.createObjectURL(item.blob);
                } else {
                    im.src = item.src;
                }
                await new Promise(res => im.onload = res);

                const effectiveImgW = practiceOn ? (colW/2 - 10) : colW;
                ctx.drawImage(im, x, y, effectiveImgW, finalH);

                if (item.blob) URL.revokeObjectURL(im.src);

                // Draw Practice Space
                if (practiceOn) {
                    ctx.fillStyle = practiceCol === 'black' ? '#000000' : '#f0f0f0';
                    ctx.fillRect(x + colW/2, y, colW/2 - 10, finalH);
                }

                // Draw Label
                if (labelsOn) {
                    ctx.fillStyle = "#333333";
                    ctx.font = "24px Arial";
                    ctx.textAlign = "center";
                    const labelY = labelPos === 'top' ? y - 10 : y + finalH + 30;
                    // Use item.pageIdx + 1 (original document page) instead of generated sheet page
                    ctx.fillText(this.processTags(labelTxt, {seq, page: item.pageIdx + 1}), x + colW/2, labelY);
                }
            }
            currentY += row.height;
        }

        // Finalize last page
        this.drawHeaderFooter(ctx, A4W, A4H);
        pages.push(currentCanvas);

        this.ui.toggleLoader(false);

        const format = this.getElement('boxExportFormat') ? this.getElement('boxExportFormat').value : 'zip';

        // High quality export option
        const boxHiQuality = this.getElement('boxHiQuality');
        const hiQuality = boxHiQuality ? boxHiQuality.checked : false;

        if (format === 'pdf') {
             if (!window.jspdf) {
                 this.ui.showToast("jsPDF library not loaded");
                 return;
             }
             this.ui.toggleLoader(true, "Generating PDF...");

             // A4 Size in mm: 210 x 297. Canvas is 2480x3508 (approx 300dpi for A4)
             const pdf = new window.jspdf.jsPDF({
                 orientation: 'p',
                 unit: 'mm',
                 format: 'a4',
                 compress: true
             });

             const pdfW = 210;
             const pdfH = 297;

             for(let i=0; i<pages.length; i++) {
                 this.ui.updateProgress((i/pages.length)*100, `Adding Page ${i+1}/${pages.length}...`);
                 if (i > 0) pdf.addPage();

                 const pCanvas = pages[i];
                 const imgFormat = hiQuality ? 'image/png' : 'image/jpeg';
                 const imgQuality = hiQuality ? 1.0 : 0.85;
                 const pdfFormat = hiQuality ? 'PNG' : 'JPEG';
                 const imgData = pCanvas.toDataURL(imgFormat, imgQuality);
                 pdf.addImage(imgData, pdfFormat, 0, 0, pdfW, pdfH);

                 await new Promise(r => setTimeout(r, 0));
             }
             
             // Use the export module's sanitizeFilename method
             const sanitizedProjectName = this.sanitizeFilename ? this.sanitizeFilename(this.state.projectName) : this.state.projectName.replace(/[^a-z0-9]/gi, '_');
             const filename = `${sanitizedProjectName}_Sheets.pdf`;

             try {
                 const blob = pdf.output('blob');
                 if (this.saveBlobNative(blob, filename)) {
                    // Handled by Android bridge
                 } else {
                     const file = new File([blob], filename, { type: 'application/pdf' });
                     if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        await navigator.share({
                            files: [file],
                            title: 'Export PDF',
                            text: 'Here is your exported PDF.'
                        });
                     } else {
                         pdf.save(filename);
                     }
                 }
             } catch(e) {
                 console.error(e);
                 pdf.save(filename);
             }
             this.ui.toggleLoader(false);
             return;
        }

        // --- IMPROVED EXPORT LOGIC FOR ANDROID ---
        try {
            // Use the export module's sanitizeFilename method
            const sanitizedProjectName = this.sanitizeFilename ? this.sanitizeFilename(this.state.projectName) : this.state.projectName.replace(/[^a-z0-9]/gi, '_');

            if(pages.length === 1) {
                const blob = await new Promise(r => pages[0].toBlob(r, 'image/png'));
                const filename = `${sanitizedProjectName}_Sheet.png`;

                if (this.saveBlobNative(blob, filename)) {
                    // Handled by Android bridge
                } else {
                    const file = new File([blob], filename, { type: 'image/png' });
                    if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        await navigator.share({
                            files: [file],
                            title: 'Export Sheet',
                            text: 'Here is the exported sheet.'
                        });
                    } else {
                        const a = document.createElement('a');
                        a.download = filename;
                        a.href = URL.createObjectURL(blob);
                        a.click();
                    }
                }
            } else {
                this.ui.toggleLoader(true, "Zipping...");
                // Note: JSZip should be available globally
                if (!window.JSZip) {
                    throw new Error("JSZip library not loaded");
                }
                const zip = new window.JSZip();

                // High quality: always PNG. Normal: use JPEG for smaller sizes
                const useJpeg = !hiQuality && (pages.length > 2 || (window.Capacitor !== undefined));
                const format = useJpeg ? 'image/jpeg' : 'image/png';
                const ext = useJpeg ? 'jpg' : 'png';
                const quality = useJpeg ? 0.85 : undefined;

                for(let i=0; i<pages.length; i++) {
                    this.ui.updateProgress((i/pages.length)*100, `Compressing ${i+1}/${pages.length}...`);
                    const blob = await new Promise(r => pages[i].toBlob(r, format, quality));
                    zip.file(`${sanitizedProjectName}_Sheet_${i+1}.${ext}`, blob);
                    await new Promise(r => setTimeout(r, 0));
                }

                this.ui.updateProgress(100, "Generating zip...");
                // Use STORE compression for high quality (faster, no quality loss)
                const compressionLevel = hiQuality ? 0 : 6;
                const content = await zip.generateAsync({
                    type: "blob",
                    compression: hiQuality ? "STORE" : "DEFLATE",
                    compressionOptions: { level: compressionLevel }
                });

                const filename = `${sanitizedProjectName}_Sheets.zip`;

                if (this.saveBlobNative(content, filename)) {
                    // Handled by Android bridge
                } else {
                    const file = new File([content], filename, { type: 'application/zip' });
                    if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        await navigator.share({
                            files: [file],
                            title: 'Export Sheets',
                            text: 'Here are the exported sheets.'
                        });
                    } else {
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(content);
                        a.download = filename;
                        a.click();
                    }
                }
            }
        } catch (e) {
            console.error("Export failed:", e);
            this.ui.showToast("Export failed: " + e.message);
        }
        this.ui.toggleLoader(false);
    },

    drawHeaderFooter(ctx, w, h) {
        ctx.fillStyle = "#333333";
        ctx.textAlign = "center";
        ctx.font = "30px Arial";

        if(this.getElement('boxHeaderOn').checked) {
            const txt = this.processTags(this.getElement('boxHeaderTxt').value);
            ctx.fillText(txt, w/2, 80);
            ctx.fillRect(30, 100, w-60, 2);
        }

        if(this.getElement('boxFooterOn').checked) {
            const txt = this.processTags(this.getElement('boxFooterTxt').value);
            ctx.fillRect(30, h-100, w-60, 2);
            ctx.fillText(txt, w/2, h-60);
        }
    }
};