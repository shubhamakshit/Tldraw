import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'shubham.akshit.tldraw',
  appName: 'TlDraw',
  webDir: 'dist/client',
  server: {
    // 1. ADD THIS LINE: Tells the app to load directly from your Vite server
    url: process.env.CAPACITOR_SERVER_IP_ENV === 'local' ? 'http://192.168.0.169:5173' : 'http://tshonq.duckdns.org:5173', 
    
    // Existing settings
    androidScheme: 'http', 
    cleartext: true,
    allowNavigation: [process.env.CAPACITOR_SERVER_IP_ENV === 'local' ? '192.168.0.169' : 'tshonq.duckdns.org'] 
  },
  android: {
    allowMixedContent: true
  }
};

export default config;