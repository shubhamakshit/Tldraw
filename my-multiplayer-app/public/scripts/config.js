// Runtime configuration for ColorRM
// This file is used to configure API endpoints when running in bundled mode

export const Config = {
    // Backend URLs
    BACKENDS: {
        hf: 'https://jaimodiji-my-multiplayer-app.hf.space',
        cloudflare: 'https://multiplayer-template.bossemail.workers.dev'
    },

    // Detect if running in Capacitor (check multiple indicators)
    isCapacitor() {
        if (typeof window === 'undefined') return false;

        // Check for Capacitor object
        if (window.Capacitor) return true;

        // Check for capacitor:// protocol (bundled mode)
        if (window.location.protocol === 'capacitor:') return true;

        // Check for file:// with capacitor in path
        if (window.location.protocol === 'file:' &&
            window.location.href.includes('capacitor')) return true;

        return false;
    },

    // Check if running in remote mode (WebView pointing to server)
    isRemoteMode() {
        if (typeof window === 'undefined') return false;
        const host = window.location.host || '';
        return host.includes('hf.space') ||
               host.includes('workers.dev') ||
               host.includes('duckdns.org') ||
               host.includes('localhost') ||
               host.includes('192.168.');
    },

    // Get the API base URL
    // In bundled mode, this returns the full backend URL
    // In remote/web mode, this returns empty string (relative URLs work)
    getApiBase() {
        // Remote mode: relative URLs work
        if (this.isRemoteMode()) {
            return '';
        }

        // Web browser (not Capacitor): relative URLs work
        if (!this.isCapacitor()) {
            return '';
        }

        // Bundled Capacitor mode: need absolute URL to backend
        const preferredBackend = localStorage.getItem('color_rm_backend') || 'cloudflare';
        const base = this.BACKENDS[preferredBackend] || this.BACKENDS.cloudflare;
        console.log('[Config] Using backend:', base);
        return base;
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
            console.log(`[Config] Backend set to: ${backend} (${this.BACKENDS[backend]})`);
            return true;
        }
        return false;
    },

    // Debug info
    getDebugInfo() {
        return {
            isCapacitor: this.isCapacitor(),
            isRemoteMode: this.isRemoteMode(),
            protocol: window.location.protocol,
            host: window.location.host,
            apiBase: this.getApiBase(),
            preferredBackend: localStorage.getItem('color_rm_backend') || 'cloudflare'
        };
    }
};

// Make available globally immediately
if (typeof window !== 'undefined') {
    window.Config = Config;
    console.log('[Config] Initialized:', Config.getDebugInfo());
}
