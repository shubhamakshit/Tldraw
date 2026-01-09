export const ColorRmBox = {
    // --- The Clipboard Box Feature ---
    // Now uses Blobs instead of base64 for ~10x memory savings
    addToBox(x, y, w, h, srcOrBlob=null, pageIdx=null) {
        const createItem = (blob) => {
            if(!this.state.clipboardBox) this.state.clipboardBox = [];
            this.state.clipboardBox.push({
                id: Date.now() + Math.random(),
                blob: blob,  // Store as Blob, not base64
                blobUrl: null,  // Lazy-create URL when rendering
                w: w, h: h,
                pageIdx: (pageIdx !== null) ? pageIdx : this.state.idx
            });

            this.ui.showToast("Added to Box!");
            this.saveSessionState();
            if(this.state.activeSideTab === 'box') this.renderBox();
        };

        // If a Blob was passed directly
        if (srcOrBlob instanceof Blob) {
            createItem(srcOrBlob);
            return;
        }

        // If a base64 dataURL was passed (legacy support), convert to Blob
        if (srcOrBlob && typeof srcOrBlob === 'string' && srcOrBlob.startsWith('data:')) {
            fetch(srcOrBlob)
                .then(res => res.blob())
                .then(blob => createItem(blob));
            return;
        }

        // Capture from canvas
        const cvs = this.getElement('canvas');
        const ctx = cvs.getContext('2d');
        const id = ctx.getImageData(x, y, w, h);
        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        tmp.getContext('2d').putImageData(id, 0, 0);

        // Use toBlob instead of toDataURL
        tmp.toBlob(blob => {
            createItem(blob);
        }, 'image/jpeg', 0.85);
    },

    captureFullPage() {
        const cvs = this.getElement('canvas');
        this.addToBox(0, 0, cvs.width, cvs.height);
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

        this.ui.toggleLoader(true, "Capturing Pages...");
        const cvs = document.createElement('canvas');
        const ctx = cvs.getContext('2d');

        for(let i=0; i<indices.length; i++) {
            const idx = indices[i];
            this.ui.updateProgress((i/indices.length)*100, `Processing Page ${idx+1}`);
            const item = this.state.images[idx];

            // Render Page to Canvas
            const img = new Image();
            img.src = URL.createObjectURL(item.blob);
            await new Promise(r => img.onload = r);

            cvs.width = img.width; cvs.height = img.height;
            ctx.drawImage(img, 0, 0);

            // Apply Edits (History) to Canvas
            if(item.history && item.history.length > 0) {
                item.history.forEach(st => {
                    ctx.save();
                    if(st.rotation && st.tool!=='pen') {
                        const cx = st.x + st.w/2; const cy = st.y + st.h/2;
                        ctx.translate(cx, cy); ctx.rotate(st.rotation); ctx.translate(-cx, -cy);
                    }
                    if(st.tool === 'text') { ctx.fillStyle = st.color; ctx.font = `${st.size}px sans-serif`; ctx.textBaseline = 'top'; ctx.fillText(st.text, st.x, st.y); }
                    else if(st.tool === 'shape') {
                        ctx.strokeStyle = st.border; ctx.lineWidth = st.width; if(st.fill!=='transparent') { ctx.fillStyle=st.fill; }
                        ctx.beginPath(); const {x,y,w,h} = st;
                        if(st.shapeType==='rectangle') ctx.rect(x,y,w,h); else if(st.shapeType==='circle') ctx.ellipse(x+w/2, y+h/2, Math.abs(w/2), Math.abs(h/2), 0, 0, 2*Math.PI); else if(st.shapeType==='line') { ctx.moveTo(x,y); ctx.lineTo(x+w,y+h); }
                        if(st.fill!=='transparent' && !['line','arrow'].includes(st.shapeType)) ctx.fill(); ctx.stroke();
                    } else {
                        ctx.lineCap='round'; ctx.lineJoin='round'; ctx.lineWidth=st.size; ctx.strokeStyle = st.tool==='eraser' ? '#000' : st.color; if(st.tool==='eraser') ctx.globalCompositeOperation='destination-out';
                        ctx.beginPath(); if(st.pts.length) ctx.moveTo(st.pts[0].x, st.pts[0].y); for(let j=1; j<st.pts.length; j++) ctx.lineTo(st.pts[j].x, st.pts[j].y); ctx.stroke();
                    }
                    ctx.restore();
                });
            }

            // Use toBlob instead of toDataURL for memory efficiency
            const blob = await new Promise(r => cvs.toBlob(r, 'image/jpeg', 0.85));
            this.addToBox(0, 0, cvs.width, cvs.height, blob, idx);
            await new Promise(r => setTimeout(r, 0));
        }

        this.ui.toggleLoader(false);
        this.getElement('boxRangeInput').value = '';
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
            const im = new Image();

            // Support both new Blob format and legacy base64 src format
            if (item.blob) {
                const url = URL.createObjectURL(item.blob);
                this.boxBlobUrls.push(url);
                im.src = url;
            } else if (item.src) {
                im.src = item.src;  // Legacy base64 support
            }

            div.appendChild(im);

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
                 const imgData = pCanvas.toDataURL('image/jpeg', 0.85);
                 pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH);
                 
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

                // Use JPEG for smaller file sizes (especially on Android)
                const useJpeg = pages.length > 2 || (window.Capacitor !== undefined);
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
                const content = await zip.generateAsync({
                    type: "blob",
                    compression: "DEFLATE",
                    compressionOptions: { level: 6 }
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