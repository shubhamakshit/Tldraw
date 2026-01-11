import { useEffect } from 'react'

export function useGlobalAndroidIntent() {
    useEffect(() => {
        const forceRedirectToColorRM = (uri: string) => {
            console.log("[Global] File intent detected. Redirecting to ColorRM immediately:", uri);
            window.location.href = '/color_rm.html?importPdf=' + encodeURIComponent(uri);
        }

        const handleFile = async (uri: string) => {
            console.log('[Global] Received shared file URI:', uri)
            
            // FAST PATH: Redirect immediately if it's a content/file URI, assuming it's for ColorRM
            if (uri.startsWith('content://') || uri.startsWith('file://')) {
                forceRedirectToColorRM(uri);
                return;
            }
            
            // For other file types, buffer them
            console.log('[Global] Non-PDF file buffered:', uri);
            window.pendingFileUri = uri;
        }

        const handleFiles = (uris: string[]) => {
            console.log('[Global] Received multiple shared files:', uris);
            // Store URIs in sessionStorage so ColorRM can retrieve them after redirect
            // This prevents the data from being lost if the native buffer is cleared by the first read
            sessionStorage.setItem('pending_shared_uris', JSON.stringify(uris));
            
            // For multiple files, we always redirect to ColorRM with a special param or just the first one
            // ColorRM will then check sessionStorage for the full list
            if (uris.length > 0) {
                forceRedirectToColorRM(uris[0]);
            }
        }
        
        const handleUrl = (url: string) => {
             console.log('[Global] Received shared URL:', url)
             // Buffer URL for later
             window.pendingUrl = url;
        }

        // Define global handlers override
        window.handleSharedFile = (uri: string) => {
            handleFile(uri)
        }

        window.handleSharedFiles = (uris: string[]) => {
            handleFiles(uris)
        }

        window.handleSharedUrl = (url: string) => {
            handleUrl(url)
        }
        
        // 1. Process JS-buffered items
        if (window.pendingFileUri) {
            handleFile(window.pendingFileUri)
        }
        
        if (window.pendingUrl) {
            handleUrl(window.pendingUrl)
        }

        const checkNativeBuffer = () => {
            if (window.AndroidNative) {
                console.log("[Global] AndroidNative interface found. Checking buffer...");
                try {
                    const pendingFile = window.AndroidNative.getPendingFileUri?.();
                    if (pendingFile) {
                        console.log('[Global] Found native pending file:', pendingFile);
                        handleFile(pendingFile);
                    }

                    const pendingFiles = window.AndroidNative.getPendingFileUris?.();
                    if (pendingFiles) {
                        console.log('[Global] Found native pending files:', pendingFiles);
                        try {
                            const uris = JSON.parse(pendingFiles);
                            if (Array.isArray(uris) && uris.length > 0) {
                                handleFiles(uris);
                            }
                        } catch (e) {
                            console.error("[Global] Error parsing pending files JSON:", e);
                        }
                    }

                    const pendingText = window.AndroidNative.getPendingSharedText?.();
                    if (pendingText) {
                        console.log('[Global] Found native pending text:', pendingText);
                        handleUrl(pendingText);
                    }
                } catch (e) {
                    console.error("[Global] Error checking native pending intents:", e);
                }
            } else {
                console.warn("[Global] AndroidNative interface NOT found. Native intent buffer unavailable.");
                // alert("Debug: Native Bridge NOT detected. Please rebuild the Android app.");
            }
        }

        // 2. Poll Native-buffered items immediately
        checkNativeBuffer();

        // 3. Listen for App Resume (for background intents)
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
            const App = window.Capacitor.Plugins.App;

            App.addListener('appStateChange', (state: any) => {
                if (state.isActive) {
                    console.log("[Global] App resumed, checking native buffer...");
                    checkNativeBuffer();
                }
            });

            App.addListener('appUrlOpen', (data: any) => {
                console.log('[Global] App opened with URL:', data);
                if (data.url) {
                     if (data.url.startsWith('file://') || data.url.startsWith('content://')) {
                         forceRedirectToColorRM(data.url);
                     } else {
                         handleUrl(data.url);
                     }
                }
            });

            const checkAppLaunchUrl = async () => {
                try {
                    const result = await App.getLaunchUrl();
                    if (result && result.url) {
                        console.log('[Global] App launched with URL: ' + result.url);
                        if (result.url.startsWith('file://') || result.url.startsWith('content://')) {
                             forceRedirectToColorRM(result.url);
                        } else {
                             handleUrl(result.url);
                        }
                    }
                } catch (e) {
                    console.error("[Global] Error checking launch URL:", e);
                }
            };
            checkAppLaunchUrl();
        }

    }, [])
}