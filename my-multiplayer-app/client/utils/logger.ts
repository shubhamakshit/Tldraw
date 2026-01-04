// Global Console Logger - Vercel-inspired design
// Works with React and vanilla JS

const STYLES = `
#logger-fab {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: #000;
    border: 1px solid #333;
    color: #fff;
    font-size: 20px;
    cursor: pointer;
    z-index: 99998;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 14px rgba(0,0,0,0.25);
    transition: transform 0.15s ease, background 0.15s ease;
}
#logger-fab:hover {
    transform: scale(1.05);
    background: #111;
}
#logger-fab:active {
    transform: scale(0.95);
}
#logger-fab .badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: #f00;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
}

#logger-modal {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(4px);
    z-index: 99999;
    display: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
#logger-modal.open {
    display: flex;
    align-items: center;
    justify-content: center;
}

#logger-container {
    width: 90%;
    max-width: 900px;
    height: 80%;
    max-height: 700px;
    background: #0a0a0a;
    border: 1px solid #333;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
}

#logger-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #333;
    background: #0a0a0a;
}
#logger-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 500;
    color: #fafafa;
    display: flex;
    align-items: center;
    gap: 8px;
}
#logger-header h3::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #22c55e;
    animation: pulse 2s infinite;
}
@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

#logger-actions {
    display: flex;
    gap: 8px;
}
#logger-actions button {
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid #333;
    background: transparent;
    color: #888;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    gap: 6px;
}
#logger-actions button:hover {
    background: #1a1a1a;
    color: #fafafa;
    border-color: #444;
}
#logger-actions button.primary {
    background: #fafafa;
    color: #0a0a0a;
    border-color: #fafafa;
}
#logger-actions button.primary:hover {
    background: #e5e5e5;
}
#logger-actions button.danger {
    color: #f87171;
    border-color: #7f1d1d;
}
#logger-actions button.danger:hover {
    background: #7f1d1d;
    color: #fafafa;
}

#logger-filters {
    display: flex;
    gap: 4px;
    padding: 12px 20px;
    border-bottom: 1px solid #222;
    background: #0a0a0a;
}
.filter-btn {
    padding: 6px 12px;
    border-radius: 20px;
    border: none;
    background: transparent;
    color: #666;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
}
.filter-btn:hover {
    color: #999;
}
.filter-btn.active {
    background: #1a1a1a;
    color: #fafafa;
}
.filter-btn .count {
    margin-left: 4px;
    padding: 2px 6px;
    border-radius: 10px;
    background: #222;
    font-size: 11px;
}

#logger-content {
    flex: 1;
    overflow-y: auto;
    padding: 0;
    background: #0a0a0a;
}
#logger-content::-webkit-scrollbar {
    width: 8px;
}
#logger-content::-webkit-scrollbar-track {
    background: #0a0a0a;
}
#logger-content::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 4px;
}

.log-entry {
    display: flex;
    padding: 10px 20px;
    border-bottom: 1px solid #1a1a1a;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 12px;
    line-height: 1.5;
    transition: background 0.1s ease;
}
.log-entry:hover {
    background: #111;
}
.log-entry.error {
    background: rgba(239, 68, 68, 0.1);
    border-left: 3px solid #ef4444;
}
.log-entry.warn {
    background: rgba(245, 158, 11, 0.1);
    border-left: 3px solid #f59e0b;
}
.log-entry .time {
    color: #666;
    margin-right: 12px;
    white-space: nowrap;
    min-width: 85px;
}
.log-entry .level {
    margin-right: 12px;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    min-width: 50px;
    text-align: center;
}
.log-entry .level.log { background: #1e3a5f; color: #60a5fa; }
.log-entry .level.info { background: #1e3a5f; color: #60a5fa; }
.log-entry .level.warn { background: #422006; color: #fbbf24; }
.log-entry .level.error { background: #450a0a; color: #f87171; }
.log-entry .level.debug { background: #1a1a2e; color: #a78bfa; }
.log-entry .msg {
    color: #e5e5e5;
    word-break: break-all;
    white-space: pre-wrap;
    flex: 1;
}

#logger-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-top: 1px solid #333;
    background: #0a0a0a;
    font-size: 12px;
    color: #666;
}

#logger-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
    font-size: 14px;
}
#logger-empty svg {
    margin-bottom: 16px;
    opacity: 0.5;
}
`;

interface LogEntry {
    timestamp: Date;
    level: string;
    message: string;
}

declare global {
    interface Window {
        Logger: typeof Logger;
        AndroidNative?: {
            saveBlob: (base64: string, filename: string, mimeType: string) => void;
            writeLog: (level: string, message: string) => void;
            getLogFilePath: () => string;
        };
    }
}

export const Logger = {
    logs: [] as LogEntry[],
    maxLogs: 2000,
    errorCount: 0,
    filter: 'all',
    isInitialized: false,
    originalConsole: null as any,

    init() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        // Inject styles
        const style = document.createElement('style');
        style.textContent = STYLES;
        document.head.appendChild(style);

        // Create FAB and Modal
        this.createUI();

        // Store original console methods
        this.originalConsole = {
            log: console.log.bind(console),
            warn: console.warn.bind(console),
            error: console.error.bind(console),
            info: console.info.bind(console),
            debug: console.debug.bind(console)
        };

        // Intercept console methods
        const self = this;
        console.log = (...args: any[]) => { self.capture('log', args); self.originalConsole.log(...args); };
        console.warn = (...args: any[]) => { self.capture('warn', args); self.originalConsole.warn(...args); };
        console.error = (...args: any[]) => { self.capture('error', args); self.originalConsole.error(...args); };
        console.info = (...args: any[]) => { self.capture('info', args); self.originalConsole.info(...args); };
        console.debug = (...args: any[]) => { self.capture('debug', args); self.originalConsole.debug(...args); };

        // Capture uncaught errors
        window.addEventListener('error', (e) => {
            self.capture('error', [`Uncaught: ${e.message} at ${e.filename}:${e.lineno}`]);
        });
        window.addEventListener('unhandledrejection', (e) => {
            self.capture('error', [`Promise: ${(e.reason as any)?.message || e.reason}`]);
        });

        this.capture('info', ['🚀 Logger initialized']);
    },

    createUI() {
        // FAB Button
        const fab = document.createElement('button');
        fab.id = 'logger-fab';
        fab.innerHTML = `<span style="font-family: monospace;">›_</span><span class="badge" style="display:none">0</span>`;
        fab.onclick = () => this.toggle();
        document.body.appendChild(fab);

        // Modal
        const modal = document.createElement('div');
        modal.id = 'logger-modal';
        modal.innerHTML = `
            <div id="logger-container">
                <div id="logger-header">
                    <h3>Console</h3>
                    <div id="logger-actions">
                        <button onclick="window.Logger.clear()">Clear</button>
                        <button onclick="window.Logger.copyToClipboard()">Copy</button>
                        <button class="primary" onclick="window.Logger.export()">Export</button>
                        <button class="danger" onclick="window.Logger.toggle()">✕</button>
                    </div>
                </div>
                <div id="logger-filters">
                    <button class="filter-btn active" data-filter="all" onclick="window.Logger.setFilter('all')">All<span class="count" id="count-all">0</span></button>
                    <button class="filter-btn" data-filter="error" onclick="window.Logger.setFilter('error')">Errors<span class="count" id="count-error">0</span></button>
                    <button class="filter-btn" data-filter="warn" onclick="window.Logger.setFilter('warn')">Warnings<span class="count" id="count-warn">0</span></button>
                    <button class="filter-btn" data-filter="log" onclick="window.Logger.setFilter('log')">Logs<span class="count" id="count-log">0</span></button>
                </div>
                <div id="logger-content"></div>
                <div id="logger-footer">
                    <span id="logger-stats"></span>
                    <span id="logger-path"></span>
                </div>
            </div>
        `;
        modal.onclick = (e) => { if (e.target === modal) this.toggle(); };
        document.body.appendChild(modal);
    },

    capture(level: string, args: any[]) {
        const timestamp = new Date();
        const message = args.map(arg => {
            if (arg === null) return 'null';
            if (arg === undefined) return 'undefined';
            if (typeof arg === 'object') {
                try { return JSON.stringify(arg, null, 2); }
                catch { return String(arg); }
            }
            return String(arg);
        }).join(' ');

        this.logs.push({ timestamp, level, message });

        if (level === 'error') {
            this.errorCount++;
            this.updateBadge();
        }

        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }

        // Write to Android if available
        if (window.AndroidNative?.writeLog) {
            try { window.AndroidNative.writeLog(level.toUpperCase(), message); } catch {}
        }
    },

    updateBadge() {
        const badge = document.querySelector('#logger-fab .badge') as HTMLElement;
        if (badge) {
            badge.style.display = this.errorCount > 0 ? 'flex' : 'none';
            badge.textContent = this.errorCount > 99 ? '99+' : String(this.errorCount);
        }
    },

    toggle() {
        const modal = document.getElementById('logger-modal');
        if (modal?.classList.contains('open')) {
            modal.classList.remove('open');
        } else {
            modal?.classList.add('open');
            this.render();
        }
    },

    setFilter(filter: string) {
        this.filter = filter;
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', (btn as HTMLElement).dataset.filter === filter);
        });
        this.render();
    },

    render() {
        const content = document.getElementById('logger-content');
        if (!content) return;

        const filtered = this.filter === 'all'
            ? this.logs
            : this.logs.filter(l => l.level === this.filter);

        // Update counts
        const counts: Record<string, number> = { all: this.logs.length, error: 0, warn: 0, log: 0, info: 0, debug: 0 };
        this.logs.forEach(l => counts[l.level] = (counts[l.level] || 0) + 1);
        counts.log += counts.info + counts.debug;

        ['all', 'error', 'warn', 'log'].forEach(k => {
            const el = document.getElementById(`count-${k}`);
            if (el) el.textContent = String(counts[k]);
        });

        if (filtered.length === 0) {
            content.innerHTML = `
                <div id="logger-empty">
                    <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                        <path d="M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                    </svg>
                    <span>No logs yet</span>
                </div>
            `;
            return;
        }

        content.innerHTML = filtered.map(log => {
            const time = log.timestamp.toLocaleTimeString('en-US', { hour12: false });
            const levelClass = log.level;
            const entryClass = ['error', 'warn'].includes(log.level) ? log.level : '';
            return `
                <div class="log-entry ${entryClass}">
                    <span class="time">${time}</span>
                    <span class="level ${levelClass}">${log.level}</span>
                    <span class="msg">${this.escapeHtml(log.message)}</span>
                </div>
            `;
        }).join('');

        content.scrollTop = content.scrollHeight;

        // Update footer
        const stats = document.getElementById('logger-stats');
        if (stats) stats.textContent = `${filtered.length} entries`;

        const path = document.getElementById('logger-path');
        if (path && window.AndroidNative?.getLogFilePath) {
            try { path.textContent = window.AndroidNative.getLogFilePath(); } catch {}
        }
    },

    escapeHtml(str: string) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    getLogsText() {
        return this.logs.map(l => {
            const ts = l.timestamp.toISOString();
            return `[${ts}] [${l.level.toUpperCase()}] ${l.message}`;
        }).join('\n');
    },

    export() {
        const content = this.getLogsText();
        const filename = `logs_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;

        if (window.AndroidNative?.saveBlob) {
            const blob = new Blob([content], { type: 'text/plain' });
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                window.AndroidNative!.saveBlob(result.split(',')[1], filename, 'text/plain');
            };
            reader.readAsDataURL(blob);
            return;
        }

        const blob = new Blob([content], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
    },

    async copyToClipboard() {
        try {
            await navigator.clipboard.writeText(this.getLogsText());
            this.capture('info', ['📋 Logs copied to clipboard']);
            this.render();
        } catch {
            prompt('Copy logs:', this.getLogsText().slice(0, 5000));
        }
    },

    clear() {
        this.logs = [];
        this.errorCount = 0;
        this.updateBadge();
        this.capture('info', ['🗑️ Logs cleared']);
        this.render();
    }
};

// Initialize function for import
export function initLogger() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => Logger.init());
    } else {
        Logger.init();
    }
    window.Logger = Logger;
}
