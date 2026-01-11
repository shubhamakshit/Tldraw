import { useEffect } from 'react'
import { Editor } from 'tldraw'

export function useAndroidIntent(editor: Editor) {
    useEffect(() => {
        if (!editor) return

        const convertUriToFileObject = async (uri: string): Promise<File | null> => {
            try {
                // Priority: Try Android Native Interface for content:// URIs
                if (uri.startsWith('content://') && window.AndroidNative && window.AndroidNative.readContentUri) {
                    console.log("Using AndroidNative to read content URI:", uri);
                    const base64Data = window.AndroidNative.readContentUri(uri);
                    if (base64Data) {
                         const binaryString = atob(base64Data);
                         const bytes = new Uint8Array(binaryString.length);
                         for (let i = 0; i < binaryString.length; i++) {
                             bytes[i] = binaryString.charCodeAt(i);
                         }
                         
                         // Try to get filename from URI
                         let fileName = 'imported_file';
                         try {
                            const parts = uri.split('/');
                            const lastPart = parts[parts.length - 1];
                            if (lastPart) {
                                 fileName = decodeURIComponent(lastPart);
                            }
                         } catch(e) {}
                         
                         // Guess mime type
                         let type = 'application/octet-stream';
                         if (fileName.endsWith('.pdf')) type = 'application/pdf';
                         if (fileName.endsWith('.png')) type = 'image/png';
                         if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) type = 'image/jpeg';

                         return new File([bytes], fileName, { type });
                    }
                }

                if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
                    const { Filesystem } = window.Capacitor.Plugins;
                    
                    // Fallback to Capacitor Filesystem
                    console.log("Using Capacitor Filesystem to read URI:", uri);
                    const fileData = await Filesystem.readFile({
                        path: uri
                    });

                    // Convert base64 data to Blob
                    // fileData.data is base64 string
                    const binaryString = atob(fileData.data as string);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    
                    const fileName = uri.split('/').pop()?.split('?')[0] || 'imported_file';
                    return new File([bytes], fileName, { type: 'application/octet-stream' });
                }
            } catch (error) {
                console.error('Error converting URI to file object:', error);
            }
            return null;
        }

        const forceRedirectToColorRM = (uri: string) => {
            console.log("File intent detected. Redirecting to ColorRM immediately:", uri);
            window.location.href = '/color_rm.html?importPdf=' + encodeURIComponent(uri);
        }

        const handleFile = async (uri: string) => {
            console.log('Received shared file URI:', uri)
            
            // FAST PATH: Redirect immediately if it's a content/file URI, assuming it's for ColorRM
            // This skips reading the file in Tldraw app to save time/errors
            if (uri.startsWith('content://') || uri.startsWith('file://')) {
                forceRedirectToColorRM(uri);
                return;
            }

            try {
                const file = await convertUriToFileObject(uri)
                if (file) {
                    // This fallback is only reachable if for some reason the FAST PATH above was skipped
                    // but convertUriToFileObject still worked (unlikely given the logic above)
                    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
                         forceRedirectToColorRM(uri);
                    } else {
                        editor.putExternalContent({
                            type: 'files',
                            files: [file]
                        })
                    }
                } else {
                    alert('Could not read file from URI: ' + uri)
                }
            } catch (err) {
                console.error('Error handling shared file:', err)
                alert('Error processing shared file')
            }
        }
        
        const handleUrl = (url: string) => {
             console.log('Received shared URL:', url)
             editor.putExternalContent({
                 type: 'url',
                 url: url
             })
        }

        // Define global handlers (Editor version handles the actual drop)
        // We chain with existing handlers if any (from Global)
        const prevHandleFile = window.handleSharedFile;
        window.handleSharedFile = (uri: string) => {
            if (prevHandleFile) prevHandleFile(uri);
            handleFile(uri);
        }

        window.handleSharedFiles = (uris: string[]) => {
            console.log("Editor: Received multiple files, redirecting to ColorRM:", uris);
            if (uris.length > 0) {
                forceRedirectToColorRM(uris[0]);
            }
        }

        const prevHandleUrl = window.handleSharedUrl;
        window.handleSharedUrl = (url: string) => {
            if (prevHandleUrl) prevHandleUrl(url);
            handleUrl(url);
        }
        
        // 1. Process JS-buffered items
        // The Global Intent Listener (in main.tsx) polls native and populates this buffer.
        if (window.pendingFileUri) {
            console.log("Editor: Processing buffered file:", window.pendingFileUri);
            handleFile(window.pendingFileUri)
            window.pendingFileUri = null
        }
        
        if (window.pendingUrl) {
            console.log("Editor: Processing buffered url:", window.pendingUrl);
            handleUrl(window.pendingUrl)
            window.pendingUrl = null
        }

        // REMOVED: Native Polling & Listeners (Moved to useGlobalAndroidIntent)
        // This hook now only reacts to window.handleSharedFile/Url calls and the buffer.

    }, [editor])
}
