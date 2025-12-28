// --- SINGLE SOURCE OF TRUTH ---
// Update this single line when your IP changes
export const SERVER_IP = '192.168.0.169'

export const SERVER_PORT = '5173'

// Base HTTP URL (Used for Assets and Links)
export const SERVER_URL = `http://${SERVER_IP}:${SERVER_PORT}`

// Base WebSocket URL (Used for Tldraw Sync)
export const WS_URL = `ws://${SERVER_IP}:${SERVER_PORT}`