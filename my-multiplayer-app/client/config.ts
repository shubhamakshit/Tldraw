// --- SINGLE SOURCE OF TRUTH ---
const VITE_PREVIEW_URL = import.meta.env.VITE_PREVIEW_URL

const VERSION = "1.0.5-" + Date.now();
console.log(`[Config] Version: ${VERSION}`);
console.log(`[Config] window.location:`, {
    origin: window.location.origin,
    protocol: window.location.protocol,
    host: window.location.host
});

let origin = window.location.origin

if (VITE_PREVIEW_URL) {
    console.log(`[Config] Using VITE_PREVIEW_URL: ${VITE_PREVIEW_URL}`);
    origin = VITE_PREVIEW_URL.replace(/\/$/, '')
}

// Force WSS if we are on HTTPS
export const SERVER_URL = origin
export const WS_URL = origin.replace(/^http/, 'ws')

console.log(`[Config] FINAL -> SERVER_URL: ${SERVER_URL}, WS_URL: ${WS_URL}`);
