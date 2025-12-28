import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'shubham.akshit.tldraw',
  appName: 'TlDraw',
  webDir: 'dist/client',
  server: {
    // 1. ADD THIS LINE: Tells the app to load directly from your Vite server
    url: 'http://192.168.0.169:5173', 
    
    // Existing settings
    androidScheme: 'http', 
    cleartext: true,
    allowNavigation: ['192.168.0.169'] 
  },
  android: {
    allowMixedContent: true
  }
};

export default config;