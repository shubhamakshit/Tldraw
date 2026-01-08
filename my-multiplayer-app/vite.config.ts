import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

const capEnv = process.env.CAPACITOR_SERVER_IP_ENV || '';
let defaultBackend = 'cloudflare';
if (capEnv === 'bundled-hf') {
  defaultBackend = 'hf';
}

export default defineConfig({
  plugins: [cloudflare(), react()],
  define: {
    '__DEFAULT_BACKEND__': JSON.stringify(defaultBackend)
  },
  server: {
    host: '0.0.0.0', // Listen on all interfaces
    port: Number(process.env.PORT) || 7860,
    strictPort: true,
    // THE FIX: Allow HF and local hosts
    allowedHosts: true, 
  },
})
