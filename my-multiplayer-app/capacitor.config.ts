import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'shubham.akshit.tldraw',
  appName: 'TlDraw',
  webDir: 'dist/client',
  server: {
    // 1. ADD THIS LINE: Tells the app to load directly from your Vite server
    url: 'http://tshonq.duckdns.org:5173', 
    
    // Existing settings
    androidScheme: 'http', 
    cleartext: true,
    allowNavigation: ['tshonq.duckdns.org'] 
  },
  android: {
    allowMixedContent: true
  }
};

export default config;