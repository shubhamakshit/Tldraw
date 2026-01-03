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
