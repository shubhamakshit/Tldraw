// Runtime configuration for ColorRM
// This file is used to configure API endpoints when running in bundled mode

export const Config = {
    // Detect if running in Capacitor
    isCapacitor: typeof window !== 'undefined' && window.Capacitor !== undefined,

    // Backend URLs
    BACKENDS: {
        hf: 'https://jaimodiji-my-multiplayer-app.hf.space',
        cloudflare: 'https://multiplayer-template.bossemail.workers.dev'
    },

    // Get the API base URL
    // In bundled mode, this returns the full backend URL
    // In remote/web mode, this returns empty string (relative URLs work)
    getApiBase() {
        // If running in browser (not Capacitor), use relative URLs
        if (!this.isCapacitor) {
            return '';
        }

        // Check if we're loading from a remote server (server.url is set)
        // In that case, relative URLs work fine
        if (window.location.protocol === 'https:' || window.location.protocol === 'http:') {
            const host = window.location.host;
            if (host.includes('hf.space') || host.includes('workers.dev') || host.includes('duckdns.org')) {
                return ''; // Remote mode, relative URLs work
            }
        }

        // Bundled mode: need absolute URL to backend
        // Default to Cloudflare, can be overridden via localStorage
        const preferredBackend = localStorage.getItem('color_rm_backend') || 'cloudflare';
        return this.BACKENDS[preferredBackend] || this.BACKENDS.cloudflare;
    },

    // Helper to make API URL
    apiUrl(path) {
        const base = this.getApiBase();
        // Ensure path starts with /
        const normalizedPath = path.startsWith('/') ? path : '/' + path;
        return base + normalizedPath;
    },

    // Set preferred backend (for bundled mode)
    setBackend(backend) {
        if (this.BACKENDS[backend]) {
            localStorage.setItem('color_rm_backend', backend);
            console.log(`Backend set to: ${backend} (${this.BACKENDS[backend]})`);
        }
    }
};

// Make available globally
window.Config = Config;
