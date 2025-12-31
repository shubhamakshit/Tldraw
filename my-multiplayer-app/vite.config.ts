import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [cloudflare(), react()],
  server: {
    host: '0.0.0.0', // Listen on all interfaces
    port: Number(process.env.PORT) || 7860,
    strictPort: true,
    // THE FIX: Allow HF and local hosts
    allowedHosts: true, 
  },
})