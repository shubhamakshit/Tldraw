export const ColorRmExport = {
    setDlTab(t) {
        const tabRange = this.getElement('tabRange');
        const tabSelect = this.getElement('tabSelect');
        const tabOpts = this.getElement('tabOpts');
        const dlPanelRange = this.getElement('dlPanelRange');
        const dlPanelSelect = this.getElement('dlPanelSelect');
        const dlPanelOpts = this.getElement('dlPanelOpts');

        if (tabRange) tabRange.className = `tab-btn ${t==='range'?'active':''}`;
        if (tabSelect) tabSelect.className = `tab-btn ${t==='select'?'active':''}`;
        if (tabOpts) tabOpts.className = `tab-btn ${t==='opts'?'active':''}`;
        if (dlPanelRange) dlPanelRange.style.display = t==='range'?'block':'none';
        if (dlPanelSelect) dlPanelSelect.style.display = t==='select'?'block':'none';
        if (dlPanelOpts) dlPanelOpts.style.display = t==='opts'?'block':'none';
    },

    renderDlGrid() {
        const g = this.getElement('dlThumbGrid');
        if (!g) return;
        g.innerHTML = '';
        this.state.images.forEach((img, i) => {
            const el = document.createElement('div');
            el.className = `thumb-item ${this.state.dlSelection.includes(i)?'selected':''}`;
            el.onclick = () => {
                if(this.state.dlSelection.includes(i)) this.state.dlSelection = this.state.dlSelection.filter(x=>x!==i);
                else this.state.dlSelection.push(i);
                this.state.dlSelection.sort((a,b)=>a-b);
                el.className = `thumb-item ${this.state.dlSelection.includes(i)?'selected':''}`;
            };
            const im = new Image(); im.src = URL.createObjectURL(img.blob);
            el.appendChild(im);
            const sp = document.createElement('span'); sp.innerText = i+1; el.appendChild(sp);
            g.appendChild(el);
        });
    },

    dlSelectAll(y) {
        this.state.dlSelection = y ? this.state.images.map((_,i)=>i) : [];
        this.renderDlGrid();
    },

    addTag(t) {
        const h = this.getElement('exHeaderTxt');
        if (h) h.value += " " + t;
    },

    async processExport() {
        let indices = [];
        const tabSelect = this.getElement('tabSelect');
        if(tabSelect && tabSelect.classList.contains('active')) {
            indices = this.state.dlSelection.length ? this.state.dlSelection : this.state.images.map((_,i)=>i);
        } else {
            const rangeInput = this.getElement('dlRangeInput');
            const txt = rangeInput ? rangeInput.value.trim() : '';
            if(!txt) indices = this.state.images.map((_,i)=>i);
            else {
                const set = new Set();
                txt.split(',').forEach(p => {
                    if(p.includes('-')) {
                        const [s,e] = p.split('-').map(n=>parseInt(n));
                        if(!isNaN(s) && !isNaN(e)) for(let k=s; k<=e; k++) if(k>0 && k<=this.state.images.length) set.add(k-1);
                    } else { const n=parseInt(p); if(!isNaN(n) && n>0 && n<=this.state.images.length) set.add(n-1); }
                });
                indices = Array.from(set).sort((a,b)=>a-b);
            }
        }

        if(indices.length===0) {
            this.ui.showToast("No pages selected");
            return;
        }

        const exportModal = this.getElement('exportModal');
        if (exportModal) exportModal.style.display='none';
        this.ui.toggleLoader(true, "Exporting PDF...");

        // Configs
        const exHeaderOn = this.getElement('exHeaderOn');
        const doHeader = exHeaderOn ? exHeaderOn.checked : false;

        const exHeaderTxt = this.getElement('exHeaderTxt');
        const headTpl = exHeaderTxt ? exHeaderTxt.value : '';

        const exHeaderAlign = this.getElement('exHeaderAlign');
        const headAlign = exHeaderAlign ? exHeaderAlign.value : 'center';

        const exHeaderSize = this.getElement('exHeaderSize');
        const headSize = exHeaderSize ? (parseInt(exHeaderSize.value) || 10) : 10;

        const exHeaderColor = this.getElement('exHeaderColor');
        const headColor = exHeaderColor ? exHeaderColor.value : '#000000';

        const exFooterOn = this.getElement('exFooterOn');
        const doFooter = exFooterOn ? exFooterOn.checked : false;

        const exFooterTxt = this.getElement('exFooterTxt');
        const footTpl = exFooterTxt ? exFooterTxt.value : '';

        const exFooterAlign = this.getElement('exFooterAlign');
        const footAlign = exFooterAlign ? exFooterAlign.value : 'center';

        const exFooterSize = this.getElement('exFooterSize');
        const footSize = exFooterSize ? (parseInt(exFooterSize.value) || 10) : 10;

        const exFooterColor = this.getElement('exFooterColor');
        const footColor = exFooterColor ? exFooterColor.value : '#000000';

        // High quality export option
        const exHiQuality = this.getElement('exHiQuality');
        const hiQuality = exHiQuality ? exHiQuality.checked : false;
        const imageFormat = hiQuality ? 'image/png' : 'image/jpeg';
        const imageQuality = hiQuality ? 1.0 : 0.85;
        const pdfImageFormat = hiQuality ? 'PNG' : 'JPEG';

        // Include background option (default true for infinite/custom pages)
        const exIncludeBackground = this.getElement('exIncludeBackground');
        const includeBackground = exIncludeBackground ? exIncludeBackground.checked : true;

        // Vector export option
        const exVectorExport = this.getElement('exVectorExport');
        const vectorExport = exVectorExport ? exVectorExport.checked : false;

        // Persist export preferences
        try {
            localStorage.setItem('colorRm_exportPrefs', JSON.stringify({
                hiQuality,
                includeBackground,
                vectorExport
            }));
        } catch (e) {
            console.log('Could not save export preferences');
        }

        // If vector export is enabled, use vector PDF export (strokes as PDF paths)
        if (vectorExport) {
            await this.exportAsVectorPDF(indices, {
                doHeader, headTpl, headAlign, headSize, headColor,
                doFooter, footTpl, footAlign, footSize, footColor,
                includeBackground
            });
            return;
        }

        const now = new Date(), dateStr = now.toLocaleDateString(), days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], dayStr = days[now.getDay()];
        const getTagText = (tpl, seq, pg) => tpl.replace('{seq}', seq).replace('{date}', dateStr).replace('{page}', pg).replace('{day}', dayStr).replace('{time}', now.toLocaleTimeString());
        const hexToRgb = (hex) => { const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [0,0,0]; };

        if (!window.jspdf) {
            this.ui.showToast("jsPDF library not loaded");
            this.ui.toggleLoader(false);
            return;
        }

        const pdfDoc = new window.jspdf.jsPDF({orientation: 'p', unit: 'mm', format: 'a4'});
        const cvs = document.createElement('canvas'); const cx = cvs.getContext('2d');

        for(let i=0; i<indices.length; i++) {
            const idx = indices[i];
            this.ui.updateProgress((i/indices.length)*100, `Page ${i+1}/${indices.length}`);

            const item = this.state.images[idx];
            const img = new Image(); img.src = URL.createObjectURL(item.blob);
            await new Promise(r=>img.onload=r);

            cvs.width = img.width; cvs.height = img.height;
            cx.drawImage(img,0,0);

            // Color Removal
            let targets = this.state.colors.map(x=>x.lab);
            if(targets.length > 0) {
                const imgD = cx.getImageData(0,0,cvs.width,cvs.height); const d = imgD.data; const lab = new Float32Array(cvs.width*cvs.height*3);
                for(let k=0,j=0; k<d.length; k+=4,j+=3){ const [l,a,b] = this.rgbToLab(d[k],d[k+1],d[k+2]); lab[j]=l; lab[j+1]=a; lab[j+2]=b; }
                const sq = this.state.strict**2;
                for(let k=0, j=0; k<d.length; k+=4, j+=3) { if(d[k+3]===0) continue; const l=lab[j], a=lab[j+1], b=lab[j+2]; let keep = false; for(let t of targets) if(((l-t[0])**2 + (a-t[1])**2 + (b-t[2])**2) <= sq) { keep = true; break; } if(!keep) d[k+3] = 0; }
                cx.putImageData(imgD, 0, 0);
            }

            // Draw history
            if (item.history) {
                item.history.forEach(st => {
                    cx.save();
                    if(st.rotation && st.tool!=='pen') { const centerx = st.x + st.w/2; const centery = st.y + st.h/2; cx.translate(centerx, centery); cx.rotate(st.rotation); cx.translate(-centerx, -centery); }
                    if(st.tool === 'text') { cx.fillStyle = st.color; cx.font = `${st.size}px sans-serif`; cx.textBaseline = 'top'; cx.fillText(st.text, st.x, st.y); }
                    else if(st.tool === 'shape') {
                        cx.strokeStyle = st.border; cx.lineWidth = st.width; if(st.fill!=='transparent') { cx.fillStyle=st.fill; }
                        cx.beginPath(); const {x,y,w,h} = st;
                        if(st.shapeType==='rectangle') cx.rect(x,y,w,h); else if(st.shapeType==='circle') cx.ellipse(x+w/2, y+h/2, Math.abs(w/2), Math.abs(h/2), 0, 0, 2*Math.PI); else if(st.shapeType==='line') { cx.moveTo(x,y); cx.lineTo(x+w,y+h); } else if(st.shapeType==='arrow') { const head=15; const ang=Math.atan2(h,w); cx.moveTo(x,y); cx.lineTo(x+w,y+h); cx.lineTo(x+w - head*Math.cos(ang-0.5), y+h - head*Math.sin(ang-0.5)); cx.moveTo(x+w,y+h); cx.lineTo(x+w - head*Math.cos(ang+0.5), y+h - head*Math.sin(ang+0.5)); }
                        if(st.fill!=='transparent' && !['line','arrow'].includes(st.shapeType)) ctx.fill(); cx.stroke();
                    } else {
                        cx.lineCap='round'; cx.lineJoin='round'; cx.lineWidth=st.size; cx.strokeStyle = st.tool==='eraser' ? '#000' : st.color; if(st.tool==='eraser') cx.globalCompositeOperation='destination-out';
                        cx.beginPath(); if(st.pts.length) cx.moveTo(st.pts[0].x, st.pts[0].y); for(let j=1; j<st.pts.length; j++) cx.lineTo(st.pts[j].x, st.pts[j].y); cx.stroke();
                    }
                    cx.restore();
                });
            }

            const u = cvs.toDataURL(imageFormat, imageQuality);
            const props = pdfDoc.getImageProperties(u);

            if (i > 0) pdfDoc.addPage();
            const pageW = pdfDoc.internal.pageSize.getWidth();
            const pageH = pdfDoc.internal.pageSize.getHeight();

            const marginX = 10;
            const headerMargin = doHeader ? 15 : 10;
            const footerMargin = doFooter ? 15 : 10;

            const printableW = pageW - (marginX * 2);
            const printableH = pageH - headerMargin - footerMargin;

            const ratio = Math.min(printableW / props.width, printableH / props.height);
            const scaledW = props.width * ratio;
            const scaledH = props.height * ratio;

            const offsetX = marginX + (printableW - scaledW) / 2;
            const offsetY = headerMargin + (printableH - scaledH) / 2;

            pdfDoc.addImage(u, pdfImageFormat, offsetX, offsetY, scaledW, scaledH);

            // Draw Header
            if(doHeader && headTpl) {
                const txt = getTagText(headTpl, i+1, idx+1);
                pdfDoc.setFontSize(headSize);
                const rgb = hexToRgb(headColor); pdfDoc.setTextColor(rgb[0], rgb[1], rgb[2]);
                let x = (headAlign === 'center') ? pageW / 2 : (headAlign === 'right' ? pageW - marginX : marginX);
                pdfDoc.text(txt, x, headerMargin - 5, {align: headAlign, baseline:'bottom'});
            }

            // Draw Footer
            if(doFooter && footTpl) {
                const txt = getTagText(footTpl, i+1, idx+1);
                pdfDoc.setFontSize(footSize);
                const rgb = hexToRgb(footColor); pdfDoc.setTextColor(rgb[0], rgb[1], rgb[2]);
                let x = (footAlign === 'center') ? pageW / 2 : (footAlign === 'right' ? pageW - marginX : marginX);
                pdfDoc.text(txt, x, pageH - footerMargin + 5, {align: footAlign, baseline:'top'});
            }

            await new Promise(r => setTimeout(r, 0));
        }

        const sanitizedProjectName = this.sanitizeFilename(this.state.projectName || "Export");

        try {
            const blob = pdfDoc.output('blob');

            if (this.saveBlobNative(blob, `${sanitizedProjectName}.pdf`)) {
                // Handled by Android
            } else {
                const file = new File([blob], `${sanitizedProjectName}.pdf`, { type: 'application/pdf' });

                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: 'Export PDF',
                        text: 'Here is your exported PDF.'
                    });
                } else {
                    pdfDoc.save(`${sanitizedProjectName}.pdf`);
                }
            }
        } catch (e) {
            console.error("PDF Export failed:", e);
            pdfDoc.save(`${sanitizedProjectName}.pdf`);
        }

        this.ui.toggleLoader(false);
    },

    /**
     * Export current page as SVG (vector format for highest quality)
     * Converts all strokes to SVG paths for infinite scalability
     * @param {boolean} includeBackground - Include the page background image
     */
    async exportAsSVG(includeBackground = true) {
        const currentPage = this.state.images[this.state.idx];
        if (!currentPage) {
            this.ui.showToast("No page to export");
            return;
        }

        this.ui.toggleLoader(true, "Generating SVG...");

        try {
            const width = this.state.viewW;
            const height = this.state.viewH;
            const history = currentPage.history || [];

            let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      .stroke-pen { fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .stroke-eraser { fill: none; stroke-linecap: round; stroke-linejoin: round; }
    </style>
  </defs>
`;

            // Add background image if requested
            if (includeBackground && currentPage.blob) {
                const base64 = await this._blobToBase64(currentPage.blob);
                svgContent += `  <image x="0" y="0" width="${width}" height="${height}" xlink:href="${base64}"/>\n`;
            }

            // Add vector grid for infinite canvas pages
            if (currentPage.isInfinite && currentPage.vectorGrid) {
                svgContent += this._generateVectorGrid(currentPage.vectorGrid, width, height);
            }

            // Convert strokes to SVG paths
            svgContent += `  <g id="strokes">\n`;

            for (const stroke of history) {
                if (stroke.deleted) continue;
                svgContent += this._strokeToSVG(stroke);
            }

            svgContent += `  </g>\n</svg>`;

            // Create and download file
            const blob = new Blob([svgContent], { type: 'image/svg+xml' });
            const sanitizedName = this.sanitizeFilename(this.state.projectName || "Export");
            const filename = `${sanitizedName}_page${this.state.idx + 1}.svg`;

            if (this.saveBlobNative && this.saveBlobNative(blob, filename)) {
                // Handled by Android
            } else {
                const file = new File([blob], filename, { type: 'image/svg+xml' });
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({ files: [file], title: 'Export SVG' });
                } else {
                    const a = document.createElement('a');
                    a.download = filename;
                    a.href = URL.createObjectURL(blob);
                    a.click();
                    URL.revokeObjectURL(a.href);
                }
            }

            this.ui.showToast("SVG exported successfully");
        } catch (e) {
            console.error("SVG Export failed:", e);
            this.ui.showToast("SVG export failed");
        }

        this.ui.toggleLoader(false);
    },

    /**
     * Convert a stroke object to SVG element
     */
    _strokeToSVG(stroke) {
        if (stroke.tool === 'pen' && stroke.pts && stroke.pts.length > 0) {
            return this._penStrokeToSVG(stroke);
        } else if (stroke.tool === 'shape') {
            return this._shapeToSVG(stroke);
        } else if (stroke.tool === 'text') {
            return this._textToSVG(stroke);
        } else if (stroke.tool === 'eraser' && stroke.pts && stroke.pts.length > 0) {
            // Eraser strokes can be represented but won't have visual effect without mask
            return `    <!-- Eraser stroke omitted -->\n`;
        }
        return '';
    },

    /**
     * Convert pen stroke to SVG path
     */
    _penStrokeToSVG(stroke) {
        if (!stroke.pts || stroke.pts.length < 2) return '';

        let d = `M ${stroke.pts[0].x.toFixed(2)} ${stroke.pts[0].y.toFixed(2)}`;
        for (let i = 1; i < stroke.pts.length; i++) {
            d += ` L ${stroke.pts[i].x.toFixed(2)} ${stroke.pts[i].y.toFixed(2)}`;
        }

        const color = stroke.color || '#000000';
        const size = stroke.size || 3;

        return `    <path class="stroke-pen" d="${d}" stroke="${color}" stroke-width="${size}"/>\n`;
    },

    /**
     * Convert shape to SVG element
     */
    _shapeToSVG(stroke) {
        const { x, y, w, h, border, fill, width, shapeType, rotation } = stroke;
        const cx = x + w / 2;
        const cy = y + h / 2;
        const rx = Math.abs(w / 2);
        const ry = Math.abs(h / 2);

        let transform = '';
        if (rotation) {
            transform = ` transform="rotate(${(rotation * 180 / Math.PI).toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)})"`;
        }

        const strokeAttr = `stroke="${border || '#000000'}" stroke-width="${width || 2}"`;
        const fillAttr = fill && fill !== 'transparent' ? `fill="${fill}"` : 'fill="none"';

        switch (shapeType) {
            case 'rectangle':
                return `    <rect x="${x}" y="${y}" width="${w}" height="${h}" ${strokeAttr} ${fillAttr}${transform}/>\n`;

            case 'circle':
                return `    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${strokeAttr} ${fillAttr}${transform}/>\n`;

            case 'line':
                return `    <line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" ${strokeAttr}${transform}/>\n`;

            case 'arrow': {
                const head = 15;
                const ang = Math.atan2(h, w);
                const x2 = x + w, y2 = y + h;
                const ax1 = x2 - head * Math.cos(ang - 0.5);
                const ay1 = y2 - head * Math.sin(ang - 0.5);
                const ax2 = x2 - head * Math.cos(ang + 0.5);
                const ay2 = y2 - head * Math.sin(ang + 0.5);
                return `    <g${transform}>
      <line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" ${strokeAttr}/>
      <line x1="${x2}" y1="${y2}" x2="${ax1.toFixed(2)}" y2="${ay1.toFixed(2)}" ${strokeAttr}/>
      <line x1="${x2}" y1="${y2}" x2="${ax2.toFixed(2)}" y2="${ay2.toFixed(2)}" ${strokeAttr}/>
    </g>\n`;
            }

            case 'triangle': {
                const points = `${cx},${y} ${x + w},${y + h} ${x},${y + h}`;
                return `    <polygon points="${points}" ${strokeAttr} ${fillAttr}${transform}/>\n`;
            }

            case 'diamond': {
                const points = `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`;
                return `    <polygon points="${points}" ${strokeAttr} ${fillAttr}${transform}/>\n`;
            }

            case 'star': {
                const spikes = 5;
                const outerR = Math.min(rx, ry);
                const innerR = outerR * 0.5;
                let points = '';
                let rot = -Math.PI / 2;
                for (let i = 0; i < spikes; i++) {
                    points += `${(cx + outerR * Math.cos(rot)).toFixed(2)},${(cy + outerR * Math.sin(rot)).toFixed(2)} `;
                    rot += Math.PI / spikes;
                    points += `${(cx + innerR * Math.cos(rot)).toFixed(2)},${(cy + innerR * Math.sin(rot)).toFixed(2)} `;
                    rot += Math.PI / spikes;
                }
                return `    <polygon points="${points.trim()}" ${strokeAttr} ${fillAttr}${transform}/>\n`;
            }

            case 'hexagon':
            case 'pentagon':
            case 'octagon': {
                const sides = shapeType === 'pentagon' ? 5 : shapeType === 'hexagon' ? 6 : 8;
                const radius = Math.min(rx, ry);
                const angle = (2 * Math.PI) / sides;
                const startAngle = -Math.PI / 2;
                let points = '';
                for (let i = 0; i < sides; i++) {
                    const px = cx + radius * Math.cos(startAngle + angle * i);
                    const py = cy + radius * Math.sin(startAngle + angle * i);
                    points += `${px.toFixed(2)},${py.toFixed(2)} `;
                }
                return `    <polygon points="${points.trim()}" ${strokeAttr} ${fillAttr}${transform}/>\n`;
            }

            default:
                return '';
        }
    },

    /**
     * Convert text to SVG element
     */
    _textToSVG(stroke) {
        const { x, y, text, color, size } = stroke;
        const escapedText = (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `    <text x="${x}" y="${y + size}" fill="${color || '#000000'}" font-size="${size || 40}px" font-family="sans-serif">${escapedText}</text>\n`;
    },

    /**
     * Generate vector grid pattern for infinite canvas
     */
    _generateVectorGrid(vectorGrid, width, height) {
        const { bgStyle, gridStyle, gridColor, gridOpacity, gridSize } = vectorGrid;
        let svg = '';

        // Grid pattern
        if (gridStyle === 'subtle' || gridStyle === 'bold') {
            const opacity = gridOpacity || 0.05;
            const strokeWidth = gridStyle === 'bold' ? 1 : 0.5;

            svg += `  <g id="grid" opacity="${opacity}">\n`;
            // Vertical lines
            for (let x = 0; x <= width; x += gridSize) {
                svg += `    <line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${gridColor}" stroke-width="${strokeWidth}"/>\n`;
            }
            // Horizontal lines
            for (let y = 0; y <= height; y += gridSize) {
                svg += `    <line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${gridColor}" stroke-width="${strokeWidth}"/>\n`;
            }
            svg += `  </g>\n`;
        } else if (gridStyle === 'dots') {
            const dotSize = 2;
            const dotSpacing = 50;
            const opacity = gridOpacity || 0.05;

            svg += `  <g id="dots" fill="${gridColor}" opacity="${opacity}">\n`;
            for (let x = dotSpacing; x < width; x += dotSpacing) {
                for (let y = dotSpacing; y < height; y += dotSpacing) {
                    svg += `    <circle cx="${x}" cy="${y}" r="${dotSize}"/>\n`;
                }
            }
            svg += `  </g>\n`;
        }

        return svg;
    },

    /**
     * Export pages as vector PDF (strokes embedded as PDF paths, not rasterized)
     * This provides infinite scalability and smaller file sizes
     * @param {number[]} indices - Page indices to export
     * @param {Object} options - Export options (headers, footers, etc.)
     */
    async exportAsVectorPDF(indices, options = {}) {
        const {
            doHeader = false, headTpl = '', headAlign = 'center', headSize = 10, headColor = '#000000',
            doFooter = false, footTpl = '', footAlign = 'center', footSize = 10, footColor = '#000000',
            includeBackground = true
        } = options;

        this.ui.toggleLoader(true, "Generating Vector PDF...");

        if (!window.jspdf) {
            this.ui.showToast("jsPDF library not loaded");
            this.ui.toggleLoader(false);
            return;
        }

        const now = new Date(), dateStr = now.toLocaleDateString();
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], dayStr = days[now.getDay()];
        const getTagText = (tpl, seq, pg) => tpl.replace('{seq}', seq).replace('{date}', dateStr).replace('{page}', pg).replace('{day}', dayStr).replace('{time}', now.toLocaleTimeString());
        const hexToRgb = (hex) => {
            const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [0, 0, 0];
        };

        try {
            // Create PDF document
            const pdfDoc = new window.jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
            const pageW = pdfDoc.internal.pageSize.getWidth();
            const pageH = pdfDoc.internal.pageSize.getHeight();

            for (let i = 0; i < indices.length; i++) {
                const idx = indices[i];
                this.ui.updateProgress((i / indices.length) * 100, `Page ${i + 1}/${indices.length}`);

                const item = this.state.images[idx];
                if (!item) continue;

                // Add new page for pages after the first
                if (i > 0) pdfDoc.addPage();

                // Calculate content area dimensions
                const marginX = 10;
                const headerMargin = doHeader ? 15 : 10;
                const footerMargin = doFooter ? 15 : 10;
                const printableW = pageW - (marginX * 2);
                const printableH = pageH - headerMargin - footerMargin;

                // Get source dimensions
                const sourceW = this.state.viewW || 800;
                const sourceH = this.state.viewH || 600;

                // Calculate scale to fit page
                const scale = Math.min(printableW / sourceW, printableH / sourceH);
                const scaledW = sourceW * scale;
                const scaledH = sourceH * scale;

                // Calculate offset to center content
                const offsetX = marginX + (printableW - scaledW) / 2;
                const offsetY = headerMargin + (printableH - scaledH) / 2;

                // Add background image if requested and not an infinite canvas
                if (includeBackground && item.blob && !item.isInfinite) {
                    const base64 = await this._blobToBase64(item.blob);
                    pdfDoc.addImage(base64, 'JPEG', offsetX, offsetY, scaledW, scaledH);
                }

                // For infinite canvas with vector grid, render background
                if (item.isInfinite && item.vectorGrid && includeBackground) {
                    this._renderVectorBackgroundToPDF(pdfDoc, item.vectorGrid, offsetX, offsetY, scaledW, scaledH);
                }

                // Render all strokes as vector paths
                const history = item.history || [];
                for (const stroke of history) {
                    if (stroke.deleted) continue;
                    this._renderStrokeToPDF(pdfDoc, stroke, offsetX, offsetY, scale);
                }

                // Draw Header
                if (doHeader && headTpl) {
                    const txt = getTagText(headTpl, i + 1, idx + 1);
                    pdfDoc.setFontSize(headSize);
                    const rgb = hexToRgb(headColor);
                    pdfDoc.setTextColor(rgb[0], rgb[1], rgb[2]);
                    let x = (headAlign === 'center') ? pageW / 2 : (headAlign === 'right' ? pageW - marginX : marginX);
                    pdfDoc.text(txt, x, headerMargin - 5, { align: headAlign, baseline: 'bottom' });
                }

                // Draw Footer
                if (doFooter && footTpl) {
                    const txt = getTagText(footTpl, i + 1, idx + 1);
                    pdfDoc.setFontSize(footSize);
                    const rgb = hexToRgb(footColor);
                    pdfDoc.setTextColor(rgb[0], rgb[1], rgb[2]);
                    let x = (footAlign === 'center') ? pageW / 2 : (footAlign === 'right' ? pageW - marginX : marginX);
                    pdfDoc.text(txt, x, pageH - footerMargin + 5, { align: footAlign, baseline: 'top' });
                }

                // Allow UI to update
                await new Promise(r => setTimeout(r, 0));
            }

            // Save the PDF
            const sanitizedProjectName = this.sanitizeFilename(this.state.projectName || "Export");

            try {
                const blob = pdfDoc.output('blob');

                if (this.saveBlobNative && this.saveBlobNative(blob, `${sanitizedProjectName}_vector.pdf`)) {
                    // Handled by Android
                } else {
                    const file = new File([blob], `${sanitizedProjectName}_vector.pdf`, { type: 'application/pdf' });

                    if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        await navigator.share({
                            files: [file],
                            title: 'Export Vector PDF',
                            text: 'Here is your exported vector PDF.'
                        });
                    } else {
                        pdfDoc.save(`${sanitizedProjectName}_vector.pdf`);
                    }
                }

                this.ui.showToast("Vector PDF exported successfully");
            } catch (e) {
                console.error("Vector PDF export failed:", e);
                pdfDoc.save(`${sanitizedProjectName}_vector.pdf`);
            }
        } catch (e) {
            console.error("Vector PDF generation failed:", e);
            this.ui.showToast("Vector PDF export failed");
        }

        this.ui.toggleLoader(false);
    },

    /**
     * Render a single stroke to PDF using vector commands
     * @param {Object} pdfDoc - jsPDF document
     * @param {Object} stroke - Stroke object
     * @param {number} offsetX - X offset in mm
     * @param {number} offsetY - Y offset in mm
     * @param {number} scale - Scale factor (pixels to mm)
     */
    _renderStrokeToPDF(pdfDoc, stroke, offsetX, offsetY, scale) {
        const hexToRgb = (hex) => {
            const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [0, 0, 0];
        };

        if (stroke.tool === 'pen' && stroke.pts && stroke.pts.length > 0) {
            // Render pen stroke as PDF path
            const color = hexToRgb(stroke.color || '#000000');
            const lineWidth = (stroke.size || 3) * scale;

            pdfDoc.setDrawColor(color[0], color[1], color[2]);
            pdfDoc.setLineWidth(lineWidth);
            pdfDoc.setLineCap('round');
            pdfDoc.setLineJoin('round');

            // Build path using jsPDF lines
            if (stroke.pts.length >= 2) {
                const pts = stroke.pts.map(p => [
                    offsetX + p.x * scale,
                    offsetY + p.y * scale
                ]);

                // Draw as connected line segments
                for (let i = 0; i < pts.length - 1; i++) {
                    pdfDoc.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
                }
            }
        } else if (stroke.tool === 'shape') {
            this._renderShapeToPDF(pdfDoc, stroke, offsetX, offsetY, scale);
        } else if (stroke.tool === 'text') {
            this._renderTextToPDF(pdfDoc, stroke, offsetX, offsetY, scale);
        } else if (stroke.tool === 'group' && stroke.children) {
            // Render group children
            for (const child of stroke.children) {
                this._renderStrokeToPDF(pdfDoc, child, offsetX, offsetY, scale);
            }
        }
        // Eraser strokes are skipped (they don't render in PDF)
    },

    /**
     * Render a shape to PDF using vector commands
     */
    _renderShapeToPDF(pdfDoc, stroke, offsetX, offsetY, scale) {
        const hexToRgb = (hex) => {
            const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [0, 0, 0];
        };

        const { x, y, w, h, border, fill, width, shapeType, rotation } = stroke;

        // Convert coordinates to PDF space
        const pdfX = offsetX + x * scale;
        const pdfY = offsetY + y * scale;
        const pdfW = w * scale;
        const pdfH = h * scale;
        const lineWidth = (width || 2) * scale;

        // Set stroke color
        const borderColor = hexToRgb(border || '#000000');
        pdfDoc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
        pdfDoc.setLineWidth(lineWidth);

        // Set fill color if not transparent
        const hasFill = fill && fill !== 'transparent';
        if (hasFill) {
            const fillColor = hexToRgb(fill);
            pdfDoc.setFillColor(fillColor[0], fillColor[1], fillColor[2]);
        }

        // Note: jsPDF doesn't support rotation directly for shapes,
        // so we use a transformation matrix approach where possible
        // For now, render without rotation (complex rotations would need path-based approach)

        const cx = pdfX + pdfW / 2;
        const cy = pdfY + pdfH / 2;
        const rx = Math.abs(pdfW / 2);
        const ry = Math.abs(pdfH / 2);

        switch (shapeType) {
            case 'rectangle':
                if (hasFill) {
                    pdfDoc.rect(pdfX, pdfY, pdfW, pdfH, 'FD'); // Fill and Draw
                } else {
                    pdfDoc.rect(pdfX, pdfY, pdfW, pdfH, 'S'); // Stroke only
                }
                break;

            case 'circle':
                if (hasFill) {
                    pdfDoc.ellipse(cx, cy, rx, ry, 'FD');
                } else {
                    pdfDoc.ellipse(cx, cy, rx, ry, 'S');
                }
                break;

            case 'line':
                pdfDoc.line(pdfX, pdfY, pdfX + pdfW, pdfY + pdfH);
                break;

            case 'arrow': {
                const head = 15 * scale;
                const ang = Math.atan2(pdfH, pdfW);
                const x2 = pdfX + pdfW, y2 = pdfY + pdfH;

                pdfDoc.line(pdfX, pdfY, x2, y2);
                pdfDoc.line(x2, y2, x2 - head * Math.cos(ang - 0.5), y2 - head * Math.sin(ang - 0.5));
                pdfDoc.line(x2, y2, x2 - head * Math.cos(ang + 0.5), y2 - head * Math.sin(ang + 0.5));
                break;
            }

            case 'triangle': {
                const points = [
                    [cx, pdfY],
                    [pdfX + pdfW, pdfY + pdfH],
                    [pdfX, pdfY + pdfH]
                ];
                if (hasFill) {
                    pdfDoc.triangle(points[0][0], points[0][1], points[1][0], points[1][1], points[2][0], points[2][1], 'FD');
                } else {
                    pdfDoc.triangle(points[0][0], points[0][1], points[1][0], points[1][1], points[2][0], points[2][1], 'S');
                }
                break;
            }

            case 'diamond': {
                // Use lines for diamond
                pdfDoc.lines([
                    [rx, -ry],    // top to right
                    [-rx, ry],    // right to bottom
                    [-rx, -ry],   // bottom to left
                    [rx, -ry]     // left to top
                ], cx, pdfY, [1, 1], hasFill ? 'FD' : 'S', true);
                break;
            }

            case 'star':
            case 'hexagon':
            case 'pentagon':
            case 'octagon': {
                // Generate polygon points
                const sides = shapeType === 'star' ? 10 :
                              shapeType === 'pentagon' ? 5 :
                              shapeType === 'hexagon' ? 6 : 8;
                const radius = Math.min(rx, ry);
                const points = [];
                const startAngle = -Math.PI / 2;

                if (shapeType === 'star') {
                    const outerR = radius;
                    const innerR = radius * 0.5;
                    for (let i = 0; i < 10; i++) {
                        const r = i % 2 === 0 ? outerR : innerR;
                        const angle = startAngle + (i * Math.PI / 5);
                        points.push([
                            cx + r * Math.cos(angle),
                            cy + r * Math.sin(angle)
                        ]);
                    }
                } else {
                    const angle = (2 * Math.PI) / sides;
                    for (let i = 0; i < sides; i++) {
                        points.push([
                            cx + radius * Math.cos(startAngle + angle * i),
                            cy + radius * Math.sin(startAngle + angle * i)
                        ]);
                    }
                }

                // Convert to jsPDF lines format (relative movements)
                if (points.length > 1) {
                    const lines = [];
                    for (let i = 1; i < points.length; i++) {
                        lines.push([
                            points[i][0] - points[i-1][0],
                            points[i][1] - points[i-1][1]
                        ]);
                    }
                    // Close the path
                    lines.push([
                        points[0][0] - points[points.length-1][0],
                        points[0][1] - points[points.length-1][1]
                    ]);
                    pdfDoc.lines(lines, points[0][0], points[0][1], [1, 1], hasFill ? 'FD' : 'S', true);
                }
                break;
            }

            default:
                // Unknown shape - try rectangle fallback
                pdfDoc.rect(pdfX, pdfY, pdfW, pdfH, 'S');
        }
    },

    /**
     * Render text to PDF
     */
    _renderTextToPDF(pdfDoc, stroke, offsetX, offsetY, scale) {
        const hexToRgb = (hex) => {
            const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [0, 0, 0];
        };

        const { x, y, text, color, size } = stroke;
        if (!text) return;

        const pdfX = offsetX + x * scale;
        const pdfY = offsetY + (y + size) * scale; // Adjust for baseline
        const fontSize = size * scale * 0.75; // Approximate pt to mm conversion

        const textColor = hexToRgb(color || '#000000');
        pdfDoc.setTextColor(textColor[0], textColor[1], textColor[2]);
        pdfDoc.setFontSize(fontSize);

        pdfDoc.text(text, pdfX, pdfY);
    },

    /**
     * Render infinite canvas vector background to PDF
     */
    _renderVectorBackgroundToPDF(pdfDoc, vectorGrid, offsetX, offsetY, width, height) {
        const hexToRgb = (hex) => {
            const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [0, 0, 0];
        };

        const { bgStyle, customBgColor, gridStyle, gridColor, gridOpacity, gridSize = 100 } = vectorGrid;

        // Draw background fill
        let bgColor;
        if (bgStyle === 'dark') {
            bgColor = [26, 26, 46]; // #1a1a2e
        } else if (bgStyle === 'light') {
            bgColor = [248, 250, 252]; // #f8fafc
        } else {
            bgColor = hexToRgb(customBgColor || '#1a1a2e');
        }

        pdfDoc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
        pdfDoc.rect(offsetX, offsetY, width, height, 'F');

        // Draw grid
        if (gridStyle !== 'none') {
            const gridRgb = hexToRgb(gridColor || '#ffffff');
            // Apply opacity by blending with background (simplified)
            const opacity = gridOpacity || 0.05;
            const blendedColor = gridRgb.map((c, i) => Math.round(bgColor[i] * (1 - opacity) + c * opacity));

            pdfDoc.setDrawColor(blendedColor[0], blendedColor[1], blendedColor[2]);
            pdfDoc.setLineWidth(0.1);

            if (gridStyle === 'subtle' || gridStyle === 'lines') {
                // Calculate grid spacing in mm
                const gridSpacingMm = (gridSize / 100) * width * 0.1; // Approximate

                // Vertical lines
                for (let x = offsetX; x <= offsetX + width; x += gridSpacingMm) {
                    pdfDoc.line(x, offsetY, x, offsetY + height);
                }
                // Horizontal lines
                for (let y = offsetY; y <= offsetY + height; y += gridSpacingMm) {
                    pdfDoc.line(offsetX, y, offsetX + width, y);
                }
            } else if (gridStyle === 'dots') {
                // Dots are harder in PDF - use small circles
                const dotSpacingMm = (50 / 100) * width * 0.1;
                pdfDoc.setFillColor(blendedColor[0], blendedColor[1], blendedColor[2]);

                for (let x = offsetX + dotSpacingMm; x < offsetX + width; x += dotSpacingMm) {
                    for (let y = offsetY + dotSpacingMm; y < offsetY + height; y += dotSpacingMm) {
                        pdfDoc.circle(x, y, 0.3, 'F');
                    }
                }
            }
        }
    },

    /**
     * Convert blob to base64 data URL
     */
    _blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    },

    sanitizeFilename(name) {
        // Remove problematic characters and replace with underscores
        return name
            .replace(/[<>:"/\\|?*]/g, '_')  // Replace illegal characters
            .replace(/\s+/g, '_')           // Replace spaces with underscores
            .replace(/[\u0000-\u001F\u007F]/g, '') // Remove control characters
            .trim()
            .substring(0, 100); // Limit length
    }
};