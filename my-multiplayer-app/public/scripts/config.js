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

        // Check for http:// on localhost with empty or file-like path (Android WebView bundled)
        if (window.location.protocol === 'http:' &&
            window.location.host === 'localhost' &&
            window.location.pathname.startsWith('/')) {
            // This could be bundled Capacitor or local dev - check for Capacitor later
            return false;
        }

        // Check for https:// on localhost (Android secure WebView)
        if (window.location.protocol === 'https:' &&
            window.location.host.includes('localhost')) return true;

        return false;
    },

    // Check if running in remote mode (WebView pointing to server)
    isRemoteMode() {
        if (typeof window === 'undefined') return false;
        const host = window.location.host || '';

        // If host is empty or file-based, not remote mode
        if (!host || host === '') return false;

        return host.includes('hf.space') ||
               host.includes('workers.dev') ||
               host.includes('duckdns.org') ||
               host.includes('192.168.');
        // Note: removed 'localhost' - it should trigger bundled mode detection
    },

    // Force bundled mode check - called after Capacitor is definitely loaded
    isBundledMode() {
        // If Capacitor is present and we're not pointing to a remote server, we're bundled
        if (window.Capacitor && !this.isRemoteMode()) {
            return true;
        }
        return false;
    },

    // Get the API base URL
    // In bundled mode, this returns the full backend URL
    // In remote/web mode, this returns empty string (relative URLs work)
    getApiBase() {
        // Remote mode: relative URLs work
        if (this.isRemoteMode()) {
            return '';
        }

        // Bundled Capacitor mode: need absolute URL to backend
        if (this.isBundledMode() || this.isCapacitor()) {
            const defaultBackend = 'cloudflare'; // REPLACED_BY_BUILD_SCRIPT
            const preferredBackend = localStorage.getItem('color_rm_backend') || defaultBackend;
            const base = this.BACKENDS[preferredBackend] || this.BACKENDS[defaultBackend];
            console.log('[Config] Bundled mode - using backend:', base);
            return base;
        }

        // Web browser: relative URLs work
        return '';
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
        const defaultBackend = 'cloudflare'; // REPLACED_BY_BUILD_SCRIPT
        return {
            isCapacitor: this.isCapacitor(),
            isBundledMode: this.isBundledMode(),
            isRemoteMode: this.isRemoteMode(),
            protocol: window.location.protocol,
            host: window.location.host,
            href: window.location.href,
            apiBase: this.getApiBase(),
            preferredBackend: localStorage.getItem('color_rm_backend') || defaultBackend
        };
    }
};

// Make available globally immediately
if (typeof window !== 'undefined') {
    window.Config = Config;
    console.log('[Config] Initialized:', Config.getDebugInfo());
}
