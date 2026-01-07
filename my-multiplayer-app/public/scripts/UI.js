export const UI = {
    showDashboard: () => {
        const db = document.getElementById('dashboardModal');
        if (db) db.style.display='flex';
        if (window.App && window.App.loadSessionList) window.App.loadSessionList();
    },
    hideDashboard: () => {
        const db = document.getElementById('dashboardModal');
        if (db) db.style.display='none';
    },
    showExportModal: () => {
        const em = document.getElementById('exportModal');
        if (em) em.style.display='flex';
        if (window.App && window.App.renderDlGrid) window.App.renderDlGrid();
    },
    toggleLoader: (show, text) => {
        const loader = document.getElementById('loader');
        if (loader) loader.style.display = show ? 'grid' : 'none';
        if(text) {
            const lt = document.getElementById('loadText');
            if (lt) lt.innerText = text;
        }
        if(show) {
            const pb = document.getElementById('progBar');
            if (pb) pb.style.width='0%';
            const pd = document.getElementById('progDetail');
            if (pd) pd.innerText='';
        }
    },
    updateProgress: (pct, msg) => {
        const pb = document.getElementById('progBar');
        if (pb) pb.style.width = pct + '%';
        const pd = document.getElementById('progDetail');
        if (msg && pd) pd.innerText = msg;
    },
    showInput: (title, placeholder, callback) => {
        const m = document.getElementById('inputModal');
        const i = document.getElementById('inputField');
        const b = document.getElementById('inputConfirmBtn');
        const t = document.getElementById('inputTitle');

        if (!m || !i || !b) return;

        if (t) t.innerText = title;
        i.value = '';
        i.placeholder = placeholder;
        m.style.display = 'flex';
        i.focus();

        const confirm = () => {
            const val = i.value.trim();
            if(val) {
                m.style.display = 'none';
                callback(val);
            }
        };
        b.onclick = confirm;
        i.onkeydown = (e) => { if(e.key==='Enter') confirm(); };
    },
    showToast: (msg) => {
        const t = document.getElementById('toast');
        if (!t) return;
        t.innerText = msg;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2000);
    },
    showConfirm: (title, message, onConfirm, onCancel = null) => {
        return new Promise((resolve) => {
            // Check for existing confirm modal or create one dynamically
            let modal = document.getElementById('confirmModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'confirmModal';
                modal.className = 'overlay';
                modal.innerHTML = `
                    <div class="card" style="max-width:360px;">
                        <h3 id="confirmTitle" style="margin:0 0 12px 0"></h3>
                        <p id="confirmMessage" style="margin:0 0 20px 0; color:#888; font-size:0.9rem; line-height:1.5;"></p>
                        <div style="display:flex; justify-content:flex-end; gap:8px;">
                            <button class="btn" id="confirmCancelBtn">Cancel</button>
                            <button class="btn" id="confirmOkBtn" style="background:#ef4444; border-color:#ef4444; color:white;">Confirm</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }

            const titleEl = document.getElementById('confirmTitle');
            const msgEl = document.getElementById('confirmMessage');
            const okBtn = document.getElementById('confirmOkBtn');
            const cancelBtn = document.getElementById('confirmCancelBtn');

            if (titleEl) titleEl.innerText = title;
            if (msgEl) msgEl.innerText = message;
            modal.style.display = 'flex';

            const cleanup = () => {
                modal.style.display = 'none';
                okBtn.onclick = null;
                cancelBtn.onclick = null;
            };

            okBtn.onclick = () => {
                cleanup();
                if (onConfirm) onConfirm();
                resolve(true);
            };
            cancelBtn.onclick = () => {
                cleanup();
                if (onCancel) onCancel();
                resolve(false);
            };
        });
    },
    showAlert: (title, message) => {
        return new Promise((resolve) => {
            let modal = document.getElementById('alertModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'alertModal';
                modal.className = 'overlay';
                modal.innerHTML = `
                    <div class="card" style="max-width:360px;">
                        <h3 id="alertTitle" style="margin:0 0 12px 0"></h3>
                        <p id="alertMessage" style="margin:0 0 20px 0; color:#888; font-size:0.9rem; line-height:1.5;"></p>
                        <div style="display:flex; justify-content:flex-end;">
                            <button class="btn btn-primary" id="alertOkBtn">OK</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }

            const titleEl = document.getElementById('alertTitle');
            const msgEl = document.getElementById('alertMessage');
            const okBtn = document.getElementById('alertOkBtn');

            if (titleEl) titleEl.innerText = title;
            if (msgEl) msgEl.innerText = message;
            modal.style.display = 'flex';

            okBtn.onclick = () => {
                modal.style.display = 'none';
                resolve();
            };
        });
    },
    showPrompt: (title, placeholder, defaultValue = '') => {
        return new Promise((resolve) => {
            let modal = document.getElementById('promptModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'promptModal';
                modal.className = 'overlay';
                modal.innerHTML = `
                    <div class="card" style="max-width:360px;">
                        <h3 id="promptTitle" style="margin:0 0 12px 0"></h3>
                        <input type="text" id="promptInput" class="opt-input" style="width:100%; margin-bottom:16px;">
                        <div style="display:flex; justify-content:flex-end; gap:8px;">
                            <button class="btn" id="promptCancelBtn">Cancel</button>
                            <button class="btn btn-primary" id="promptOkBtn">OK</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }

            const titleEl = document.getElementById('promptTitle');
            const inputEl = document.getElementById('promptInput');
            const okBtn = document.getElementById('promptOkBtn');
            const cancelBtn = document.getElementById('promptCancelBtn');

            if (titleEl) titleEl.innerText = title;
            if (inputEl) {
                inputEl.placeholder = placeholder;
                inputEl.value = defaultValue;
            }
            modal.style.display = 'flex';
            inputEl.focus();

            const cleanup = () => {
                modal.style.display = 'none';
                okBtn.onclick = null;
                cancelBtn.onclick = null;
                inputEl.onkeydown = null;
            };

            const submit = () => {
                const val = inputEl.value;
                cleanup();
                resolve(val);
            };

            okBtn.onclick = submit;
            cancelBtn.onclick = () => {
                cleanup();
                resolve(null);
            };
            inputEl.onkeydown = (e) => { if(e.key==='Enter') submit(); };
        });
    },
    setSyncStatus: (status) => {
        const el = document.getElementById('syncStatus');
        if (!el) return;

        if (status === 'saved') {
            el.innerHTML = '<span style="color:#fff">●</span> Synced';
            setTimeout(() => { if(el.innerText.includes('Synced')) el.innerHTML = ''; }, 3000);
        } else if (status === 'syncing') {
            el.innerHTML = '<span style="color:#888">○</span> Saving';
        } else if (status === 'offline') {
            el.innerHTML = '<span style="color:#ff4d4d">●</span> Offline';
        } else if (status === 'new') {
            el.innerHTML = '<span style="color:#fff">●</span> New Project';
            setTimeout(() => el.innerHTML = '', 5000);
        }
    }
};
