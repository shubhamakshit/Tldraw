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

            const u = cvs.toDataURL('image/jpeg', 0.85);
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

            pdfDoc.addImage(u, 'JPEG', offsetX, offsetY, scaledW, scaledH);

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

        const fName = (this.state.projectName || "Export").replace(/[^a-z0-9]/gi, '_');

        try {
            const blob = pdfDoc.output('blob');

            if (this.saveBlobNative(blob, `${fName}.pdf`)) {
                // Handled by Android
            } else {
                const file = new File([blob], `${fName}.pdf`, { type: 'application/pdf' });

                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: 'Export PDF',
                        text: 'Here is your exported PDF.'
                    });
                } else {
                    pdfDoc.save(`${fName}.pdf`);
                }
            }
        } catch (e) {
            console.error("PDF Export failed:", e);
            pdfDoc.save(`${fName}.pdf`);
        }

        this.ui.toggleLoader(false);
    }
};