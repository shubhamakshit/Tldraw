// --- SINGLE SOURCE OF TRUTH ---
const VITE_PREVIEW_URL = import.meta.env.VITE_PREVIEW_URL

const BACKENDS = {
    hf: 'https://jaimodiji-my-multiplayer-app.hf.space',
    cloudflare: 'https://multiplayer-template.bossemail.workers.dev'
};

const VERSION = "1.0.5-" + Date.now();
console.log(`[Config] Version: ${VERSION}`);
console.log(`[Config] window.location:`, {
    origin: window.location.origin,
    protocol: window.location.protocol,
    host: window.location.host
});

let origin = window.location.origin

// Helper to detect if we are in a "remote" mode (served from a server, not bundled)
const isRemoteMode = () => {
    const host = window.location.host;
    return host.includes('hf.space') ||
           host.includes('workers.dev') ||
           host.includes('duckdns.org') ||
           host.includes('192.168.');
};

// Helper to detect Capacitor
const isCapacitor = () => {
    return !!(window as any).Capacitor;
};

if (VITE_PREVIEW_URL) {
    console.log(`[Config] Using VITE_PREVIEW_URL: ${VITE_PREVIEW_URL}`);
    origin = VITE_PREVIEW_URL.replace(/\/$/, '')
} else if (isCapacitor() && !isRemoteMode()) {
    // We are likely in bundled mode on a device
    const preferredBackend = localStorage.getItem('color_rm_backend') || 'cloudflare';
    origin = (BACKENDS as any)[preferredBackend] || BACKENDS.cloudflare;
    console.log(`[Config] Capacitor bundled mode detected. Using backend: ${origin}`);
}

// Force WSS if we are on HTTPS
export const SERVER_URL = origin
export const WS_URL = origin.replace(/^http/, 'ws')

export const apiUrl = (path: string) => {
    // Ensure path starts with /
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    return SERVER_URL + normalizedPath;
}

console.log(`[Config] FINAL -> SERVER_URL: ${SERVER_URL}, WS_URL: ${WS_URL}`);
