import { ColorRmRenderer } from './modules/ColorRmRenderer.js';
import { ColorRmStorage } from './modules/ColorRmStorage.js';
import { ColorRmBox } from './modules/ColorRmBox.js';
import { ColorRmInput } from './modules/ColorRmInput.js';
import { ColorRmUI } from './modules/ColorRmUI.js';
import { ColorRmSession } from './modules/ColorRmSession.js';
import { ColorRmExport } from './modules/ColorRmExport.js';
import { PerformanceManager } from './modules/ColorRmPerformance.js';

export class ColorRmApp {
    constructor(config = {}) {
        this.config = {
            isMain: true,
            container: null,
            collaborative: true, // Set to false for local-only mode (split view)
            dbName: 'ColorRM_SOTA_V12', // Allow separate DB for split view
            ...config
        };

        this.container = this.config.container;

        this.state = {
            sessionId: null, images: [], idx: 0,
            colors: [], customSwatches: JSON.parse(localStorage.getItem('crm_custom_colors') || '[]'),
            strict: 15, tool: 'none', bg: 'transparent',
            penColor: '#ef4444', penSize: 3, eraserSize: 20, eraserType: 'stroke',
            textSize: 40,
            shapeType: 'rectangle', shapeBorder: '#3b82f6', shapeFill: 'transparent', shapeWidth: 3,
            selection: [], dlSelection: [], isLivePreview: false, guideLines: [], activeShapeRatio: false, previewOn: false,
            bookmarks: [], activeSideTab: 'tools', projectName: "Untitled", baseFileName: null,
            clipboardBox: [],
            ownerId: null, pageLocked: false,
            selectedSessions: new Set(), isMultiSelect: false, showCursors: true,
            zoom: 1, pan: { x: 0, y: 0 },
            // Eraser options
            eraserOptions: {
                scribble: true,
                text: true,
                shapes: true,
                images: false
            }
        };

        this.cache = {
            currentImg: null,
            lab: null,
            // Offscreen canvas for caching committed strokes
            committedCanvas: null,
            committedCtx: null,
            lastHistoryLength: 0,  // Track when to invalidate cache
            isDirty: true  // Flag to rebuild cache
        };
        this.db = null;

        // Performance flags
        this.renderPending = false;
        this.saveTimeout = null;
        this.ui = null;
        this.liveSync = null;
        this.registry = null;
        this.iroP = null;

        // SOTA Performance Manager
        this.performanceManager = new PerformanceManager();

        this.lastCursorUpdateTime = 0;
        this.cursorUpdateThrottle = 30; // 30ms throttle, approx 33fps
    }

    async init(ui, registry, LiveSyncClient) {
        this.ui = ui;
        this.registry = registry;

        // 1. Initialize Database (use configured DB name)
        this.db = await new Promise(r => {
            const req = indexedDB.open(this.config.dbName, 2);
            req.onupgradeneeded = e => {
                const d = e.target.result;
                if(!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', { keyPath: 'id' });
                if(!d.objectStoreNames.contains('pages')) d.createObjectStore('pages', { keyPath: 'id' }).createIndex('sessionId','sessionId');
                if(!d.objectStoreNames.contains('folders')) d.createObjectStore('folders', { keyPath: 'id' });
            };
            req.onsuccess = e => r(e.target.result);
        });

        // Only sync registry for collaborative mode
        if (this.config.collaborative && this.registry) {
            await this.registry.sync();
        }

        // 2. Setup UI
        this.setupUI();
        this.setupDrawing();
        this.makeDraggable();
        this.setupShortcuts();

        // Check for PDF import redirect immediately
        const urlParams = new URLSearchParams(window.location.search);
        const importPdfUri = urlParams.get('importPdf');
        
        // Priority: Check session storage for pending MULTI-FILE imports
        // If found, we skip the URL param to avoid double import (one from URL, one from storage)
        const hasPendingFiles = sessionStorage.getItem('pending_shared_uris');
        
        if (importPdfUri && !hasPendingFiles) {
             console.log("ColorRmApp: Found importPdf param early:", importPdfUri);
             this.ui.showToast("Importing PDF...");
        }

        // 3. Initialize PDF.js Worker
        if (window.pdfjsLib) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        // 4. Initialize Liveblocks Room & Project Mapping (only for collaborative mode)
        let ownerId, projectId;

        if (this.config.collaborative && LiveSyncClient) {
            this.liveSync = new LiveSyncClient(this);

            // Failsafe for missing userId
            const regUser = this.registry ? this.registry.getUsername() : null;
            if (regUser) this.liveSync.userId = regUser;

            if (!this.liveSync.userId) {
                this.liveSync.userId = `user_${Math.random().toString(36).substring(2, 9)}`;
                localStorage.setItem('color_rm_user_id', this.liveSync.userId);
            }
        } else {
             // Ensure LiveSync is null if not collaborative
             this.liveSync = null;
        }

        if (this.config.isMain) {
            // Parse URL for Main App
            const hashPath = window.location.hash.replace(/^#\/?/, '');
            const parts = hashPath.split('/').filter(Boolean);
            ownerId = parts[1];
            projectId = parts[2];

            // If owner or project is missing from URL, try to load last project OR show dashboard
            // SKIP THIS IF IMPORTING PDF - we will create a new project anyway
            if ((!ownerId || !projectId) && !importPdfUri) {
                const lastSess = await this.db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
                if (lastSess && lastSess.length > 0) {
                    const latest = lastSess.sort((a,b) => b.lastMod - a.lastMod)[0];
                    ownerId = latest.ownerId || (this.liveSync ? this.liveSync.userId : 'local');
                    projectId = latest.id;
                    window.location.replace(`#/color_rm/${ownerId}/${projectId}`);
                } else {
                    this.ui.showDashboard();
                    return;
                }
            }
        } else {
            // Secondary App: Use config provided IDs or default to empty/new
            ownerId = this.config.ownerId || (this.liveSync ? this.liveSync.userId : 'local');
            projectId = this.config.projectId;

            if (!projectId) {
                // If no project provided for split view, wait for PDF import
                console.log("ColorRmApp (Secondary): No projectId provided. Ready for import.");
                return;
            }
        }

        // If not importing, open session normally
        if (!importPdfUri) {
            this.state.ownerId = ownerId;
            this.state.sessionId = projectId;

            await this.openSession(projectId);

            // Only initialize LiveSync for collaborative mode
            if (this.config.collaborative && this.liveSync) {
                await this.liveSync.init(ownerId, projectId);
            }

            // 5. Sync Base File (only for collaborative mode)
            if (this.config.collaborative) {
                try {
                    const res = await fetch(window.Config?.apiUrl(`/api/color_rm/base_file/${projectId}`) || `/api/color_rm/base_file/${projectId}`, { method: 'GET' });
                    if (res.ok) {
                        if (this.state.images.length === 0) {
                            console.log("Liveblocks: Downloading base file from server...");
                            const blob = await res.blob();
                            await this.importBaseFile(blob);
                            if (this.liveSync && this.liveSync.syncHistory) this.liveSync.syncHistory();
                        }
                    } else if (res.status === 404) {
                        if (this.state.images.length > 0 && this.state.images[0].blob) {
                            console.log("Liveblocks: Server missing base file. Healing/Uploading...");
                            this.reuploadBaseFile();
                        }
                    }
                } catch(e) {
                    console.error("Liveblocks: Sync check error:", e);
                }
            }
        }

        // 6. Initialize Android Intent Handling for URLs and PDF files
        this.initializeAndroidIntentHandling();

        // 7. Process PDF Import if present AND no pending files in storage
        if (importPdfUri && !hasPendingFiles) {
             console.log("ColorRmApp: Processing deferred importPdf:", importPdfUri);
             // Clean URL
             window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
             
             // Execute immediately with safety wrapper
             try {
                 console.log("ColorRmApp: Executing handlePdfFileFromUri NOW for:", importPdfUri);
                 this.handlePdfFileFromUri(importPdfUri);
             } catch(e) {
                 console.error("ColorRmApp: CRITICAL ERROR handling importPdf:", e);
                 this.ui.showToast("Critical Error Importing PDF");
             }
        }
    }

    // Initialize Android Intent Handling for URLs and PDF files
    initializeAndroidIntentHandling() {
        console.log("ColorRmApp: initializeAndroidIntentHandling started");
        
        // Expose global handler for Native Android calls (MainActivity.java)
        window.handleSharedFile = (uri) => {
            console.log("ColorRmApp: Global handleSharedFile called with:", uri);
            this.handlePdfFileFromUri(uri);
        };
        
        window.handleSharedUrl = (url) => {
            console.log("ColorRmApp: Global handleSharedUrl called with:", url);
            this.handleIncomingUrl(url);
        };

        window.handleSharedFiles = (uris) => {
            console.log("ColorRmApp: Global handleSharedFiles called with:", uris);
            this.handlePdfFilesFromUris(uris);
        };

        const checkNative = () => {
            if (window.AndroidNative) {
                try {
                    const pendingFile = window.AndroidNative.getPendingFileUri?.();
                    if (pendingFile) {
                        console.log('ColorRmApp: Found native pending file:', pendingFile);
                        this.handlePdfFileFromUri(pendingFile);
                    }

                    const pendingFiles = window.AndroidNative.getPendingFileUris?.();
                    if (pendingFiles) {
                         console.log('ColorRmApp: Found native pending files:', pendingFiles);
                         try {
                             const uris = JSON.parse(pendingFiles);
                             if (Array.isArray(uris) && uris.length > 0) {
                                 this.handlePdfFilesFromUris(uris);
                             }
                         } catch (e) {
                             console.error("ColorRmApp: Error parsing pending files JSON:", e);
                         }
                    }

                    const pendingText = window.AndroidNative.getPendingSharedText?.();
                    if (pendingText) {
                        console.log('ColorRmApp: Found native pending text:', pendingText);
                        this.handleIncomingUrl(pendingText);
                    }
                } catch (e) {
                    console.error("ColorRmApp: Error checking native pending intents:", e);
                }
            }
        };

        // 1. Process JS-buffered items
        if (window.pendingFileUri) {
            console.log("ColorRmApp: Processing buffered file intent:", window.pendingFileUri);
            this.handlePdfFileFromUri(window.pendingFileUri);
            window.pendingFileUri = null;
        }

        if (window.pendingUrl) {
            console.log("ColorRmApp: Processing buffered url intent:", window.pendingUrl);
            this.handleIncomingUrl(window.pendingUrl);
            window.pendingUrl = null;
        }

        // Check sessionStorage for multi-file imports from React redirect
        const sessionUris = sessionStorage.getItem('pending_shared_uris');
        if (sessionUris) {
            try {
                console.log("ColorRmApp: Found pending URIs in storage");
                const uris = JSON.parse(sessionUris);
                sessionStorage.removeItem('pending_shared_uris'); // Clear immediately
                if (Array.isArray(uris) && uris.length > 0) {
                    this.handlePdfFilesFromUris(uris);
                    return; // Skip native check to avoid double processing if one matches
                }
            } catch (e) {
                console.error("ColorRmApp: Error parsing session URIs", e);
            }
        }

        // 2. Poll Native-buffered items immediately
        checkNative();

        // 3. Setup Capacitor Listeners (if available)
        if (window.Capacitor && window.Capacitor.Plugins) {
            const { Plugins } = window.Capacitor;
            const App = Plugins.App;

            if (App) {
                App.addListener('appUrlOpen', (data) => {
                    console.log('ColorRmApp: App URL opened:', data.url);
                    if (data.url) {
                        if (data.url.startsWith('file://') || data.url.startsWith('content://')) {
                            this.handlePdfFileFromUri(data.url);
                        } else {
                            this.handleIncomingUrl(data.url);
                        }
                    }
                });

                App.addListener('appStateChange', (state) => {
                    if (state.isActive) {
                        console.log("ColorRmApp: App resumed, checking native buffer...");
                        checkNative();
                    }
                });

                // Check launch URL
                App.getLaunchUrl().then(ret => {
                    if (ret && ret.url) {
                        console.log('ColorRmApp: Launch URL:', ret.url);
                        if (ret.url.startsWith('file://') || ret.url.startsWith('content://')) {
                            this.handlePdfFileFromUri(ret.url);
                        } else {
                            this.handleIncomingUrl(ret.url);
                        }
                    }
                });
            }
        }
    }

    // Check for initial intent when app starts
    async checkInitialIntent() {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
            try {
                const { App } = window.Capacitor.Plugins;
                const launchInfo = await App.getLaunchUri();

                if (launchInfo && launchInfo.url) {
                    const url = launchInfo.url;
                    console.log('Initial launch URL:', url);

                    // Check if it's a file URL
                    if (url.startsWith('file://') || url.startsWith('content://')) {
                        if (url.toLowerCase().endsWith('.pdf')) {
                            console.log('PDF file opened via initial intent:', url);
                            this.handlePdfFileFromUri(url);
                        }
                    } else {
                        // Handle as regular URL
                        this.handleIncomingUrl(url);
                    }
                }
            } catch (error) {
                console.error('Error checking initial intent:', error);
            }
        }
    }

    // Handle incoming URLs (deep links, project links, etc.)
    handleIncomingUrl(url) {
        try {
            // Check for file/content schemes first
            if (url.startsWith('file://') || url.startsWith('content://')) {
                console.log("ColorRmApp: Handling content/file URI directly:", url);
                this.handlePdfFileFromUri(url);
                return;
            }

            const parsedUrl = new URL(url);
            const pathname = parsedUrl.pathname;
            const hash = parsedUrl.hash;

            // Check if this is a ColorRM project URL
            const colorRmRegex = /\/color_rm\/([^\/]+)\/([^\/]+)/;
            const match = pathname.match(colorRmRegex) || hash.match(colorRmRegex);

            if (match) {
                // Extract ownerId and projectId from the URL
                const ownerId = match[1];
                const projectId = match[2];

                // Switch to the specified project
                this.switchProject(ownerId, projectId);
            } else {
                // For other URLs, try to parse as a hash route
                const hashRoute = hash.replace(/^#\/?/, '');
                if (hashRoute) {
                    // Navigate using the hash router
                    window.location.hash = `#${hashRoute}`;
                    // Reload the page to handle the new route
                    location.reload();
                }
            }
        } catch (error) {
            console.error('Error handling incoming URL:', error);
        }
    }

    // Handle incoming PDF files from file path
    async handlePdfFile(filePath) {
        try {
            // For file paths, we need to read the file differently
            // This function handles traditional file paths
            const file = await this.convertFilePathToFileObject(filePath);

            if (file) {
                // Check if a project with the same name already exists
                const fileName = filePath.split('/').pop() || 'imported_pdf.pdf';
                const projectName = fileName.replace(/\.[^/.]+$/, ""); // Remove extension
                const existingProjects = await this.dbGetAll('sessions');
                const existingProject = existingProjects.find(proj => proj.name === projectName);

                if (existingProject) {
                    // Ask user if they want to create a new project or open existing
                    const choice = await this.ui.showPrompt(
                        "Project Already Exists",
                        "Type 'open' to open existing project, or 'new' to create a new one",
                        "open"
                    );

                    if (choice && choice.toLowerCase() === 'new') {
                        // Create new project with PDF
                        await this.createProjectFromPdf(file, `${projectName}_copy`);
                    } else {
                        // Open existing project
                        this.switchProject(existingProject.ownerId || 'local', existingProject.id);
                    }
                } else {
                    // Create new project with PDF
                    await this.createProjectFromPdf(file, projectName);
                }
            }
        } catch (error) {
            console.error('Error handling PDF file:', error);
            this.ui.showToast('Error opening PDF file');
        }
    }

    // Handle incoming PDF files from URI (file:// or content://)
    async handlePdfFileFromUri(uri) {
        console.log("handlePdfFileFromUri: Starting with URI:", uri);
        try {
            // Convert URI to file object
            const file = await this.convertUriToFileObject(uri);

            if (file) {
                console.log("handlePdfFileFromUri: File object created:", file.name, file.size, file.type);
                // Check if a project with the same name already exists
                // Use file.name as it's more reliable (handled in convertUriToFileObject)
                const fileName = file.name;
                const projectName = fileName.replace(/\.[^/.]+$/, ""); // Remove extension
                const existingProjects = await this.dbGetAll('sessions');
                const existingProject = existingProjects.find(proj => proj.name === projectName);

                if (existingProject) {
                    console.log("handlePdfFileFromUri: Project exists, asking user...");
                    // Ask user if they want to create a new project or open existing
                    const choice = await this.ui.showPrompt(
                        "Project Already Exists",
                        "Type 'open' to open existing project, or 'new' to create a new one",
                        "open"
                    );

                    if (choice && choice.toLowerCase() === 'new') {
                        // Create new project with PDF
                        await this.createProjectFromPdf(file, `${projectName}_copy`);
                    } else {
                        // Open existing project
                        this.switchProject(existingProject.ownerId || 'local', existingProject.id);
                    }
                } else {
                    console.log("handlePdfFileFromUri: Creating new project...");
                    // Create new project with PDF
                    await this.createProjectFromPdf(file, projectName);
                }
            } else {
                console.error("handlePdfFileFromUri: Failed to create File object from URI");
                this.ui.showToast('Failed to load file from shared URI');
            }
        } catch (error) {
            console.error('Error handling PDF file from URI:', error);
            this.ui.showToast('Error opening PDF file');
        }
    }

    // Handle multiple incoming PDF files from URIs
    async handlePdfFilesFromUris(uris) {
        console.log("handlePdfFilesFromUris: Starting with URIs:", uris);
        try {
            this.ui.showToast("Processing multiple files...");
            const files = [];
            
            for (const uri of uris) {
                const file = await this.convertUriToFileObject(uri);
                if (file) {
                    files.push(file);
                } else {
                    console.error("Failed to convert URI to file:", uri);
                }
            }

            if (files.length > 0) {
                console.log(`handlePdfFilesFromUris: Converted ${files.length} files. Starting bulk import loop...`);
                this.handleExternalFiles(files);
            } else {
                this.ui.showToast("Failed to process shared files");
            }
        } catch (error) {
            console.error('Error handling multiple PDF files:', error);
            this.ui.showToast('Error opening files');
        }
    }

    async handleExternalFiles(files) {
        this.ui.toggleLoader(true, `Importing ${files.length} projects...`);
        // We set isBulkImporting to true to influence project naming logic in ColorRmSession
        this.isBulkImporting = true; 

        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                
                // Create a unique project name based on the file
                const firstFileName = file.name || `Imported Project ${i+1}`;
                const projectName = firstFileName.replace(/\.[^/.]+$/, "");
                const projectId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                const ownerId = this.liveSync?.userId || 'local';

                this.ui.updateProgress((i / files.length) * 100, `Creating project ${i + 1} of ${files.length}: ${projectName}...`);
                console.log(`handleExternalFiles: Creating project ${i+1}/${files.length}: ${projectName}`);

                // 1. Create the new project structure
                await this.createNewProject(false, projectId, ownerId, projectName);
                
                // 2. Import the file into this project
                // Note: passing skipUpload=false so it uploads to server if online
                // passing lazy=true so it only gets metadata (page count) and doesn't process images yet
                await this.handleImport({ target: { files: [file] } }, false, true);
                
                // Small delay to ensure DB writes settle before next iteration
                await new Promise(r => setTimeout(r, 500));
            }
        } catch(e) {
            console.error("Bulk import failed:", e);
            this.ui.showToast("Import error occurred");
        } finally {
            this.isBulkImporting = false;
            this.ui.toggleLoader(false);
            this.ui.showToast(`Imported ${files.length} projects`);
            
            // Reload the session list or dashboard to show new projects
            // If we are currently in a project view, we might want to go to dashboard
            this.ui.showDashboard();
            if (this.loadSessionList) this.loadSessionList();
        }
    }

    // Convert file path to File object
    async convertFilePathToFileObject(filePath) {
        try {
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
                const { Filesystem } = window.Capacitor.Plugins;

                // Read the PDF file
                const fileData = await Filesystem.readFile({
                    path: filePath
                });

                // Convert base64 data to Blob
                const binaryString = atob(fileData.data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                const blob = new Blob([bytes], { type: 'application/pdf' });

                // Create a file object from the blob
                const fileName = filePath.split('/').pop() || 'imported_pdf.pdf';
                return new File([blob], fileName, { type: 'application/pdf' });
            }
        } catch (error) {
            console.error('Error converting file path to file object:', error);
        }
        return null;
    }

    // Convert URI to File object
    async convertUriToFileObject(uri) {
        console.log("convertUriToFileObject: Converting:", uri);
        try {
            // Priority: Try Android Native Interface for content:// URIs
            if (uri.startsWith('content://') && window.AndroidNative && window.AndroidNative.readContentUri) {
                console.log("Using AndroidNative to read content URI:", uri);
                const base64Data = window.AndroidNative.readContentUri(uri);
                if (base64Data) {
                     console.log("AndroidNative read successful, data length:", base64Data.length);
                     const binaryString = atob(base64Data);
                     const bytes = new Uint8Array(binaryString.length);
                     for (let i = 0; i < binaryString.length; i++) {
                         bytes[i] = binaryString.charCodeAt(i);
                     }
                     const blob = new Blob([bytes], { type: 'application/pdf' });
                     
                     // Try to get filename from URI
                     let fileName = 'imported_pdf.pdf';
                     
                     // 1. Try Native getFileName
                     if (window.AndroidNative && window.AndroidNative.getFileName) {
                         const nativeName = window.AndroidNative.getFileName(uri);
                         if (nativeName) fileName = nativeName;
                     } 
                     // 2. Fallback to URI parsing
                     else {
                         try {
                            const parts = uri.split('/');
                            const lastPart = parts[parts.length - 1];
                            if (lastPart && lastPart.indexOf('.') > -1) {
                                 fileName = decodeURIComponent(lastPart);
                            }
                         } catch(e) {}
                     }
                     
                     console.log("Created File object:", fileName);
                     return new File([blob], fileName, { type: 'application/pdf' });
                } else {
                    console.error("AndroidNative returned null/empty for URI");
                }
            }

            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
                const { Filesystem } = window.Capacitor.Plugins;

                // For content:// URIs, we need to handle them differently
                // First, try to read directly if it's a file:// URI
                if (uri.startsWith('file://')) {
                    const filePath = uri.substring(7); // Remove 'file://' prefix
                    return await this.convertFilePathToFileObject(filePath);
                } else if (uri.startsWith('content://')) {
                    // Fallback to Capacitor Filesystem if Native interface didn't work
                    console.warn("AndroidNative not available, trying Capacitor Filesystem for content URI");
                    const fileData = await Filesystem.readFile({
                        path: uri
                    });

                    // Convert base64 data to Blob
                    const binaryString = atob(fileData.data);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    const blob = new Blob([bytes], { type: 'application/pdf' });

                    // Create a file object from the blob
                    const fileName = uri.split('/').pop().split('?')[0] || 'imported_pdf.pdf';
                    return new File([blob], fileName, { type: 'application/pdf' });
                }
            }
        } catch (error) {
            console.error('Error converting URI to file object:', error);
        }
        return null;
    }

    // Create a new project from a PDF file
    async createProjectFromPdf(file, projectName) {
        try {
            // Generate a unique project ID
            const projectId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const ownerId = this.liveSync?.userId || 'local';

            // Create a new project
            await this.createNewProject(false, projectId, ownerId, projectName);

            // Import the PDF file
            const event = { target: { files: [file] } };
            await this.handleImport(event, true); // Pass true to skip upload for local file

            this.ui.showToast(`Created new project from PDF: ${projectName}`);
        } catch (error) {
            console.error('Error creating project from PDF:', error);
            this.ui.showToast('Error creating project from PDF');
        }
    }

    // Check for any pending intents when app becomes active
    async checkPendingIntents() {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
            try {
                const { App } = window.Capacitor.Plugins;
                const savedIntent = await App.getLaunchUri();

                if (savedIntent && savedIntent.url) {
                    // Check if it's a file URL or content URL
                    const url = savedIntent.url;
                    if (url.startsWith('file://') || url.startsWith('content://')) {
                         this.handlePdfFileFromUri(url);
                    } else {
                        this.handleIncomingUrl(url);
                    }
                }
            } catch (error) {
                console.error('Error checking pending intents:', error);
            }
        }
    }

    getElement(id) {
        if (this.container) {
            // Try scoped lookup first
            const el = this.container.querySelector(`#${id}`);
            if (el) return el;

            // Optional: fallback to class or data attribute if we move away from IDs
            const dataEl = this.container.querySelector(`[data-id="${id}"]`);
            if (dataEl) return dataEl;

            // When container is set, do NOT fall back to document.getElementById
            return null;
        }
        return document.getElementById(id);
    }

    async openSession(id) {
        this.state.sessionId = id;
        const session = await this.dbGet('sessions', id);
        if(session) {
            this.state.projectName = session.name || "Untitled";
            this.state.ownerId = session.ownerId || this.state.ownerId;
            const titleEl = this.getElement('headerTitle');
            if (titleEl) titleEl.innerText = session.name;
            if(session.state) Object.assign(this.state, session.state);
            if(!this.state.bookmarks) this.state.bookmarks = [];
            if(!this.state.clipboardBox) this.state.clipboardBox = [];
            if(this.state.showCursors === undefined) this.state.showCursors = true;
            // SOTA preference defaults
            if(!this.state.eraserOptions) this.state.eraserOptions = { scribble: true, text: true, shapes: true, images: false };
            if(!this.state.lassoOptions) this.state.lassoOptions = { scribble: true, text: true, shapes: true, images: true };
            if(this.state.eraserType === undefined) this.state.eraserType = 'stroke';
            if(this.state.stabilization === undefined) this.state.stabilization = 0;
            if(this.state.holdToShape === undefined) this.state.holdToShape = false;
            if(this.state.spenEngineEnabled === undefined) this.state.spenEngineEnabled = true;
            const cToggle = this.getElement('cursorToggle');
            if(cToggle) cToggle.checked = this.state.showCursors;
            this.renderBookmarks();
            if(this.liveSync && this.liveSync.renderCursors) this.liveSync.renderCursors();
        }

        return new Promise((resolve) => {
            const q = this.db.transaction('pages').objectStore('pages').index('sessionId').getAll(id);
            q.onsuccess = () => {
                this.state.images = q.result.sort((a,b)=>a.pageIndex-b.pageIndex);
                this.ui.hideDashboard();
                this.updateLockUI();
                const targetIdx = (session && session.idx !== undefined) ? session.idx : 0;
                if(this.state.images.length>0) {
                    this.loadPage(targetIdx).then(resolve);
                } else {
                    resolve();
                }
                if(this.state.activeSideTab === 'pages') this.renderPageSidebar();
                if(this.state.activeSideTab === 'box') this.renderBox();
            }
            q.onerror = () => resolve();
        });
    }

    async loadPage(i, broadcast = true) {
        if(i<0 || i>=this.state.images.length) return;

        // Debounce rapid navigation - queue the target and animate to it
        const now = Date.now();
        const navigationCooldown = 150; // ms between actual page loads

        if (this._lastNavTime && now - this._lastNavTime < navigationCooldown) {
            // Queue this as the target page
            this._queuedPage = i;
            if (!this._navDebounceTimer) {
                this._navDebounceTimer = setTimeout(() => {
                    this._navDebounceTimer = null;
                    if (this._queuedPage !== null && this._queuedPage !== this.state.idx) {
                        this.loadPage(this._queuedPage, broadcast);
                    }
                    this._queuedPage = null;
                }, navigationCooldown);
            }
            return;
        }
        this._lastNavTime = now;

        // Determine animation direction
        const direction = i > this.state.idx ? 'left' : 'right';
        const viewport = this.getElement('viewport');
        const canvas = this.getElement('canvas');

        // Skip animation if only one page or same page
        const shouldAnimate = this.state.images.length > 1 && this.state.idx !== i;

        // Apply exit animation
        if (canvas && viewport && shouldAnimate) {
            canvas.style.transition = 'transform 0.2s ease-out, opacity 0.15s ease-out';
            canvas.style.transform = direction === 'left' ? 'translateX(-30px)' : 'translateX(30px)';
            canvas.style.opacity = '0.3';

            // Wait for exit animation
            await new Promise(r => setTimeout(r, 100));
        }

        // Auto-compact current page before switching (if leaving a page)
        if (this.state.idx !== i && this.state.images[this.state.idx]) {
            this.checkAutoCompact();
        }

        // Invalidate cache when loading new page
        this.invalidateCache();

        // Mark this as a local page change to prevent sync conflicts
        if (broadcast && this.liveSync) {
            this.liveSync.lastLocalPageChange = Date.now();
        }

        if (this.liveSync) {
            const project = this.liveSync.getProject();
            if (project) {
                const remoteHistory = project.get("pagesHistory").get(i.toString());
                if (remoteHistory) {
                    this.state.images[i].history = remoteHistory.toArray();
                }
            }
        }

        if (broadcast && this.state.pageLocked && this.state.ownerId !== this.liveSync.userId) {
            this.ui.showToast("Page is locked by presenter.");
            return;
        }

        let item = this.state.images[i];
        if (!item) {
            console.warn(`Page ${i} missing from state. Skipping loadPage.`);
            return;
        }

        // If the page doesn't have a blob, try to fetch it from the backend
        if (!item.blob && this.config.collaborative && this.state.ownerId) {
            try {
                const response = await fetch(window.Config?.apiUrl(`/api/color_rm/page_file/${this.state.sessionId}/${i}`) || `/api/color_rm/page_file/${this.state.sessionId}/${i}`);
                if (response.ok) {
                    const blob = await response.blob();
                    item.blob = blob;
                    // Update the database with the fetched blob
                    await this.dbPut('pages', item);
                } else {
                    console.warn(`Page ${i} not found on backend. Attempting to fetch from base file...`);
                    // If page not found, try to get base file (first page)
                    if (i === 0) {
                        const baseResponse = await fetch(window.Config?.apiUrl(`/api/color_rm/base_file/${this.state.sessionId}`) || `/api/color_rm/base_file/${this.state.sessionId}`);
                        if (baseResponse.ok) {
                            const blob = await baseResponse.blob();
                            item.blob = blob;
                            await this.dbPut('pages', item);
                        }
                    }
                }
            } catch (err) {
                console.error(`Error fetching page ${i} from backend:`, err);
            }
        }

        if (!item || !item.blob) {
            console.warn(`Page ${i} missing blob data. Skipping loadPage.`);
            return;
        }

        this.state.idx = i;
        const pageInput = this.getElement('pageInput');
        if (pageInput) pageInput.value = i + 1;
        const pageTotal = this.getElement('pageTotal');
        if (pageTotal) pageTotal.innerText = '/ ' + this.state.images.length;

        this.renderBookmarks();

        if(!item.history) item.history = [];

        // Revoke old page blob URL to prevent memory leak
        if (this.currentPageBlobUrl) {
            URL.revokeObjectURL(this.currentPageBlobUrl);
        }

        const img = new Image();
        this.currentPageBlobUrl = URL.createObjectURL(item.blob);
        img.src = this.currentPageBlobUrl;
        return new Promise((resolve) => {
            img.onload = () => {
                this.cache.currentImg = img;

                const c = this.getElement('canvas');
                if (!c) return resolve();
                const max = 2000;
                let w=img.width, h=img.height;
                if(w>max || h>max) { const r = Math.min(max/w, max/h); w*=r; h*=r; }
                c.width=w; c.height=h; this.state.viewW=w; this.state.viewH=h;

                // Toggle infinite canvas mode for seamless fullscreen display
                const viewport = this.getElement('viewport');
                if (viewport) {
                    if (item.isInfinite) {
                        viewport.classList.add('infinite-canvas-mode');
                        // For infinite canvas, resize canvas to fill viewport
                        const vRect = viewport.getBoundingClientRect();
                        c.width = vRect.width;
                        c.height = vRect.height;
                        this.state.viewW = c.width;
                        this.state.viewH = c.height;
                    } else {
                        viewport.classList.remove('infinite-canvas-mode');
                    }
                }

                const ctx = c.getContext('2d', {willReadFrequently:true});
                ctx.drawImage(img,0,0,w,h);
                const d = ctx.getImageData(0,0,w,h).data;
                this.cache.lab = new Float32Array(w*h*3);
                for(let k=0,j=0; k<d.length; k+=4,j+=3) {
                    const [l,a,b] = this.rgbToLab(d[k],d[k+1],d[k+2]);
                    this.cache.lab[j]=l; this.cache.lab[j+1]=a; this.cache.lab[j+2]=b;
                }

                // Apply enter animation (only if multiple pages)
                if (canvas && shouldAnimate) {
                    canvas.style.transform = direction === 'left' ? 'translateX(30px)' : 'translateX(-30px)';
                    canvas.style.opacity = '0.3';
                    // Force reflow
                    canvas.offsetHeight;
                    // Animate in
                    canvas.style.transition = 'transform 0.2s ease-out, opacity 0.15s ease-out';
                    canvas.style.transform = 'translateX(0)';
                    canvas.style.opacity = '1';
                } else if (canvas) {
                    // Reset any lingering transform/opacity without animation
                    canvas.style.transition = 'none';
                    canvas.style.transform = 'translateX(0)';
                    canvas.style.opacity = '1';
                }

                this.render();
                if (broadcast) {
                    this.saveSessionState();
                    // Use debounced page navigation notification
                    if (this.liveSync) {
                        this.liveSync.notifyPageNavigation(this.state.idx);
                    }
                }
                resolve();
            };
        });
    }
}

// Mixin all modules into the prototype
Object.assign(ColorRmApp.prototype, ColorRmRenderer);
Object.assign(ColorRmApp.prototype, ColorRmStorage);
Object.assign(ColorRmApp.prototype, ColorRmBox);
Object.assign(ColorRmApp.prototype, ColorRmInput);
Object.assign(ColorRmApp.prototype, ColorRmUI);
Object.assign(ColorRmApp.prototype, ColorRmSession);
Object.assign(ColorRmApp.prototype, ColorRmExport);

// Ensure the app instance has access to export methods for other modules
ColorRmApp.prototype.sanitizeFilename = ColorRmExport.sanitizeFilename;

// The methods are already properly mixed in via Object.assign, so no need to rebind them
// The functions are already bound to the prototype correctly