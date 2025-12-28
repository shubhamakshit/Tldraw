import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [cloudflare(), react()],
  server: {
    host: '0.0.0.0', // Listen on all interfaces
    port: 5173,
    strictPort: true,
    // THE FIX: Allow your IP and localhost to bypass the Cloudflare security check
    allowedHosts: ['localhost', '192.168.0.169', '.local','192.168.0.102','tshonq.duckdns.org'], 
  },
  appType: 'spa',
})