import type { CapacitorConfig } from '@capacitor/cli';

const getServerUrl = () => {
  const env = process.env.CAPACITOR_SERVER_IP_ENV
  if (env === 'local') return 'http://192.168.0.169:5173'
  if (env === 'hf') return 'https://jaimodiji-my-multiplayer-app.hf.space'
  if (env === 'cloudflare') return 'https://multiplayer-template.bossemail.workers.dev'
  return 'http://tshonq.duckdns.org:5173'
}

const getAllowNavigation = () => {
  const env = process.env.CAPACITOR_SERVER_IP_ENV
  if (env === 'local') return '192.168.0.169'
  if (env === 'hf') return 'jaimodiji-my-multiplayer-app.hf.space'
  if (env === 'cloudflare') return 'multiplayer-template.bossemail.workers.dev'
  return 'tshonq.duckdns.org'
}

const config: CapacitorConfig = {
  appId: 'shubham.akshit.tldraw',
  appName: 'TlDraw',
  webDir: 'dist/client',
  server: {
    url: getServerUrl(),
    androidScheme: 'https', // Recommended for HF
    cleartext: true,
    allowNavigation: [getAllowNavigation()]
  },
  android: {
    allowMixedContent: true
  }
};

export default config;