import type { CapacitorConfig } from '@capacitor/cli';

// Environment options:
// - 'local'      : WebView loads from local dev server (live reload)
// - 'hf'         : WebView loads from HuggingFace server
// - 'cloudflare' : WebView loads from Cloudflare server
// - 'bundled-hf' : Assets bundled in APK, API calls to HuggingFace
// - 'bundled-cf' : Assets bundled in APK, API calls to Cloudflare
// - default      : WebView loads from tshonq.duckdns.org

const env = process.env.CAPACITOR_SERVER_IP_ENV || 'bundled-cf';

// Backend URLs for API calls when using bundled assets
const BACKENDS = {
  hf: 'https://jaimodiji-my-multiplayer-app.hf.space',
  cf: 'https://multiplayer-template.bossemail.workers.dev'
};

const getConfig = (): CapacitorConfig => {
  const baseConfig: CapacitorConfig = {
    appId: 'shubham.akshit.tldraw',
    appName: 'TlDraw',
    webDir: 'dist/client',
    android: {
      allowMixedContent: true
    }
  };

  // Bundled modes: Assets are local, only API calls go to server
  if (env === 'bundled-hf') {
    return {
      ...baseConfig,
      // No server.url = load from bundled assets
      android: {
        ...baseConfig.android,
      },
      plugins: {
        CapacitorHttp: {
          enabled: true // Use native HTTP for CORS-free API calls
        }
      }
    };
  }

  if (env === 'bundled-cf' || env === 'bundled') {
    return {
      ...baseConfig,
      plugins: {
        CapacitorHttp: {
          enabled: true
        }
      }
    };
  }

  // Remote modes: WebView loads everything from server
  let serverUrl: string;
  let allowNavigation: string;

  switch (env) {
    case 'local':
      serverUrl = 'http://192.168.0.169:5173';
      allowNavigation = '192.168.0.169';
      break;
    case 'hf':
      serverUrl = BACKENDS.hf;
      allowNavigation = 'jaimodiji-my-multiplayer-app.hf.space';
      break;
    case 'cloudflare':
      serverUrl = BACKENDS.cloudflare;
      allowNavigation = 'multiplayer-template.bossemail.workers.dev';
      break;
    default:
      serverUrl = 'http://tshonq.duckdns.org:5173';
      allowNavigation = 'tshonq.duckdns.org';
  }

  return {
    ...baseConfig,
    server: {
      url: serverUrl,
      androidScheme: 'https',
      cleartext: true,
      allowNavigation: [allowNavigation]
    }
  };
};

const config = getConfig();

export default config;
