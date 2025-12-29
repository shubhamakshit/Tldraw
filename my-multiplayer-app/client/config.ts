// --- SINGLE SOURCE OF TRUTH ---
const VITE_PREVIEW_URL = import.meta.env.VITE_PREVIEW_URL

let BASE_URL: string

if (VITE_PREVIEW_URL) {
	BASE_URL = VITE_PREVIEW_URL.replace(/^(https?:\/\/)/, '')
} else {
	const SERVER_IP = import.meta.env.VITE_APP_ENV === 'local' ? '192.168.0.169' : 'tshonq.duckdns.org'
	const SERVER_PORT = '5173'
	BASE_URL = `${SERVER_IP}:${SERVER_PORT}`
}

// Base HTTP URL (Used for Assets and Links)
export const SERVER_URL = `http://${BASE_URL}`

// Base WebSocket URL (Used for Tldraw Sync)
export const WS_URL = `ws://${BASE_URL}`