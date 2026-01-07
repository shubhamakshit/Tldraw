import { ColorRmApp } from './ColorRmApp.js';
import { CommonPdfImport } from './CommonPdfImport.js';
import { PDFLibrary } from './PDFLibrary.js';

/**
 * Split View - Full-featured local drawing viewer
 * Uses a second ColorRmApp instance in non-collaborative mode
 */

// Minimal UI stub for split view (no dashboard, toasts are optional)
const SplitViewUI = {
    showDashboard() {},
    hideDashboard() {},
    showToast(msg) { console.log('SplitView:', msg); },
    showInput(title, placeholder, callback) {
        // Use window.UI.showPrompt if available, otherwise fallback
        if (window.UI && window.UI.showPrompt) {
            window.UI.showPrompt(title, placeholder).then(text => {
                if (text) callback(text);
            });
        } else {
            const text = prompt(title);
            if (text) callback(text);
        }
    },
    showConfirm(title, message) {
        if (window.UI && window.UI.showConfirm) {
            return window.UI.showConfirm(title, message);
        }
        return Promise.resolve(confirm(message));
    },
    showAlert(title, message) {
        if (window.UI && window.UI.showAlert) {
            return window.UI.showAlert(title, message);
        }
        alert(message);
        return Promise.resolve();
    },
    showExportModal() {},
    showLoader() {},
    hideLoader() {},
    toggleLoader(show, msg) {
        // Simple console feedback for split view
        if (show) console.log('SplitView Loading:', msg || '...');
        else console.log('SplitView: Loading complete');
    },
    updateProgress(percent, msg) {
        console.log(`SplitView Progress: ${Math.round(percent)}% - ${msg || ''}`);
    },
    setSyncStatus(status) {}
};

export const SplitView = {
    isEnabled: false,
    app: null, // ColorRmApp instance for split view

    // IndexedDB for project list (separate from main app)
    rightDB: null,
    DB_NAME: 'ColorRMSplitViewFull',
    DB_VERSION: 1,
    STORE_NAME: 'projects',

    /**
     * Initialize DB for project metadata
     */
    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.rightDB = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
                }
            };
        });
    },

    /**
     * Toggle split view
     */
    async toggle() {
        if (!this.rightDB) await this.initDB();

        this.isEnabled = !this.isEnabled;

        if (this.isEnabled) {
            await this.enable();
        } else {
            this.disable();
        }
    },

    /**
     * Enable split view
     */
    async enable() {
        const viewport = document.querySelector('.viewport');
        const workspace = document.querySelector('.workspace');
        const sidebar = document.querySelector('.sidebar');

        if (!viewport || !workspace) return;

        // Create container
        let container = document.getElementById('splitViewContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'splitViewContainer';
            container.className = 'split-view-container';
            container.innerHTML = this.getHTML();
            workspace.appendChild(container);
        }

        container.style.display = 'flex';

        // Move main viewport to left panel
        const leftPanel = document.getElementById('leftPanel');
        if (leftPanel) {
            viewport.dataset.originalParent = 'workspace';
            leftPanel.appendChild(viewport);
        }

        // Keep main sidebar visible
        if (sidebar) sidebar.style.display = 'flex';

        // Initialize the split view app
        await this.initApp();

        // Bind events
        this.bindEvents();

        // Load last project if available
        await this.loadLastProject();

        console.log('Split view enabled (full drawing mode)');
    },

    /**
     * Get HTML for split view panel
     */
    getHTML() {
        return `
        <!-- Panels Container -->
        <div style="display:flex; flex:1; overflow:hidden; gap:1px;">
          <!-- Left: Main Canvas -->
          <div class="split-view-panel" id="leftPanel" style="flex:1;"></div>

          <!-- Right: Full Drawing App -->
          <div id="rightAppContainer" style="display:flex; flex:1; overflow:hidden; position:relative;">

            <!-- Right Sidebar -->
            <div id="svSidebar" class="sidebar" style="width:200px; border-left:none; border-right:1px solid var(--border); display:flex; flex-direction:column; z-index:40;">

              <!-- Sidebar Tabs -->
              <div class="sb-tabs">
                <div class="sb-tab active" id="svTabTools" data-tab="tools">Tools</div>
                <div class="sb-tab" id="svTabPages" data-tab="pages">Pages</div>
                <div class="sb-tab" id="svHideSidebar" style="flex:0; padding:14px; min-width:40px; cursor:pointer;" title="Hide sidebar"><i class="bi bi-chevron-left"></i></div>
              </div>

              <!-- Tools Panel -->
              <div class="sidebar-content" id="svPanelTools" style="padding:16px;">
                <div class="control-section">
                  <h4>Instruments</h4>
                  <div class="tool-row">
                    <button class="btn tool-btn" id="svToolNone" data-tool="none"><i class="bi bi-cursor"></i> Move</button>
                    <button class="btn tool-btn" id="svToolHand" data-tool="hand"><i class="bi bi-hand-index-thumb"></i> Hand</button>
                  </div>
                  <div class="tool-row">
                    <button class="btn tool-btn" id="svToolPen" data-tool="pen"><i class="bi bi-pen"></i> Pen</button>
                    <button class="btn tool-btn" id="svToolEraser" data-tool="eraser"><i class="bi bi-eraser"></i> Erase</button>
                  </div>
                  <div class="tool-row">
                    <button class="btn tool-btn" id="svToolShape" data-tool="shape"><i class="bi bi-square"></i> Shape</button>
                    <button class="btn tool-btn" id="svToolLasso" data-tool="lasso"><i class="bi bi-bounding-box-circles"></i> Lasso</button>
                  </div>
                </div>

                <!-- Tool Settings -->
                <div class="control-section" id="svToolSettings" style="margin-top:16px;">
                  <h4>Settings</h4>

                  <!-- Pen Colors -->
                  <div id="svPenColors" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">
                    <div class="color-dot" style="background:#ef4444" data-color="#ef4444"></div>
                    <div class="color-dot" style="background:#3b82f6" data-color="#3b82f6"></div>
                    <div class="color-dot" style="background:#22c55e" data-color="#22c55e"></div>
                    <div class="color-dot" style="background:#eab308" data-color="#eab308"></div>
                    <div class="color-dot" style="background:#000000" data-color="#000000"></div>
                    <div class="color-dot" style="background:#ffffff; border-color:#666;" data-color="#ffffff"></div>
                  </div>

                  <!-- Size Slider -->
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:0.7rem; color:#888;">Size</span>
                    <input type="range" id="svBrushSize" min="1" max="50" value="3" class="slider" style="flex:1">
                  </div>

                  <!-- Shape Options (shown when shape tool selected) -->
                  <div id="svShapeOptions" style="display:none; margin-top:12px;">
                    <div class="shape-grid" style="grid-template-columns: repeat(4, 1fr);">
                      <div class="shape-btn" data-shape="rectangle"><i class="bi bi-square"></i></div>
                      <div class="shape-btn" data-shape="circle"><i class="bi bi-circle"></i></div>
                      <div class="shape-btn" data-shape="line"><i class="bi bi-dash-lg"></i></div>
                      <div class="shape-btn" data-shape="arrow"><i class="bi bi-arrow-right"></i></div>
                    </div>
                  </div>

                  <!-- Eraser Options -->
                  <div id="svEraserOptions" style="display:none; margin-top:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                      <span style="font-size:0.8rem; color:#aaa">Stroke Eraser</span>
                      <label class="switch" style="transform:scale(0.8)">
                        <input type="checkbox" id="svStrokeEraser">
                        <span class="slider-switch"></span>
                      </label>
                    </div>
                  </div>
                </div>

                <!-- Preview Toggle -->
                <div class="control-section" style="margin-top:16px;">
                  <div style="display:flex; align-items:center; justify-content:space-between; padding:10px; border:1px solid #222; border-radius:6px; background:#0a0a0a;">
                    <span style="font-size:0.75rem; color:#888; font-weight:600; text-transform:uppercase;">Preview</span>
                    <label class="switch">
                      <input type="checkbox" id="svPreviewToggle">
                      <span class="slider-switch"></span>
                    </label>
                  </div>
                </div>

                <!-- Import Button -->
                <div class="control-section" style="margin-top:auto; padding-top:16px;">
                  <button class="btn btn-primary" id="svImportBtn" style="width:100%; justify-content:center;">
                    <i class="bi bi-folder-plus"></i> PDF Library
                  </button>
                  <button class="btn" id="svProjectsBtn" style="width:100%; justify-content:center; margin-top:8px; border-color:#444;">
                    <i class="bi bi-folder"></i> My Projects
                  </button>
                </div>
              </div>

              <!-- Pages Panel -->
              <div class="sidebar-content" id="svPanelPages" style="display:none; padding:16px;">
                <div id="svPageList" class="sb-page-grid" style="grid-template-columns: 1fr; gap:10px;"></div>
              </div>
            </div>

            <!-- Right Viewport (Canvas Area) -->
            <div id="viewport" class="viewport" style="position:relative; background:#000; flex:1; display:flex; align-items:center; justify-content:center; overflow:hidden;">

              <!-- Floating Sidebar Toggle -->
              <button id="svSidebarToggle" class="btn btn-icon"
                      style="position:absolute; top:12px; left:12px; z-index:100; display:none; background:var(--bg-panel); border:1px solid var(--border);"
                      title="Show Sidebar">
                <i class="bi bi-layout-sidebar"></i>
              </button>

              <!-- Canvas -->
              <canvas id="canvas" oncontextmenu="return false;"></canvas>

              <!-- Context Toolbar for selections -->
              <div id="contextToolbar" class="context-toolbar">
                <button class="ctx-btn" title="Delete" id="svDeleteBtn"><i class="bi bi-trash3"></i></button>
              </div>

              <!-- Navigation Island -->
              <div class="nav-island">
                <button class="btn btn-icon" id="svPrevPage" style="background:transparent; border:none; border-radius:4px;"><i class="bi bi-chevron-left"></i></button>

                <div style="display:flex; align-items:center; gap:4px; font-family:monospace; font-size:0.8rem; font-weight:700;">
                  <input type="number" id="svPageInput" style="background:transparent; border:none; color:white; width:32px; text-align:right; padding:2px;" min="1" value="1">
                  <span id="svPageTotal" style="color:#555;">/ --</span>
                </div>

                <button class="btn btn-icon" id="svNextPage" style="background:transparent; border:none; border-radius:4px;"><i class="bi bi-chevron-right"></i></button>

                <div style="width:1px; height:16px; background:#333;"></div>

                <button id="svZoomReset" class="btn btn-sm" style="background:transparent; border:none; font-family:monospace; font-size:0.75rem; min-width:50px; color:#888;">100%</button>

                <div style="width:1px; height:16px; background:#333;"></div>

                <button class="btn btn-icon" id="svUndo" style="background:transparent; border:none; border-radius:4px;"><i class="bi bi-arrow-counterclockwise" style="font-size:0.8rem"></i></button>
              </div>

              <!-- Status Badge -->
              <div style="position:absolute; top:12px; right:12px; display:flex; gap:8px;">
                <div class="badge" style="background:rgba(255,255,255,0.05); color:#888; font-size:0.6rem; padding:4px 8px;">LOCAL</div>
              </div>
            </div>
          </div>
        </div>
        `;
    },

    /**
     * Initialize ColorRmApp for split view
     */
    async initApp() {
        const container = document.getElementById('rightAppContainer');
        if (!container) return;

        // Create the split view app instance
        this.app = new ColorRmApp({
            isMain: false,
            container: container,
            collaborative: false, // No LiveSync
            dbName: 'ColorRM_SplitView_V1' // Separate database
        });

        // Initialize with minimal UI (no registry sync, no LiveSync)
        await this.app.init(SplitViewUI, null, null);

        // Expose for debugging
        window.SplitViewApp = this.app;

        // Register with CommonPdfImport
        CommonPdfImport.setSplitViewApp(this.app);

        console.log('SplitView ColorRmApp initialized');
    },

    /**
     * Bind all event handlers
     */
    bindEvents() {
        // Sidebar toggle
        const hideSidebar = document.getElementById('svHideSidebar');
        const showSidebar = document.getElementById('svSidebarToggle');
        const svSidebar = document.getElementById('svSidebar');

        if (hideSidebar) {
            hideSidebar.onclick = () => {
                svSidebar.style.display = 'none';
                showSidebar.style.display = 'flex';
            };
        }
        if (showSidebar) {
            showSidebar.onclick = () => {
                svSidebar.style.display = 'flex';
                showSidebar.style.display = 'none';
            };
        }

        // Sidebar tabs
        document.getElementById('svTabTools')?.addEventListener('click', () => this.switchTab('tools'));
        document.getElementById('svTabPages')?.addEventListener('click', () => this.switchTab('pages'));

        // Tool buttons
        document.querySelectorAll('#svSidebar [data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.tool;
                this.setTool(tool);
            });
        });

        // Color dots
        document.querySelectorAll('#svPenColors .color-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                if (this.app) {
                    this.app.state.penColor = dot.dataset.color;
                    this.app.state.shapeBorder = dot.dataset.color;
                }
            });
        });

        // Brush size slider
        const sizeSlider = document.getElementById('svBrushSize');
        if (sizeSlider) {
            sizeSlider.addEventListener('input', (e) => {
                if (this.app) {
                    const val = parseInt(e.target.value);
                    this.app.state.penSize = val;
                    this.app.state.eraserSize = val;
                    this.app.state.shapeWidth = val;
                }
            });
        }

        // Shape buttons
        document.querySelectorAll('#svShapeOptions [data-shape]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (this.app) {
                    document.querySelectorAll('#svShapeOptions [data-shape]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.app.state.shapeType = btn.dataset.shape;
                }
            });
        });

        // Stroke eraser toggle
        const strokeEraser = document.getElementById('svStrokeEraser');
        if (strokeEraser) {
            strokeEraser.addEventListener('change', (e) => {
                if (this.app) {
                    this.app.state.eraserType = e.target.checked ? 'stroke' : 'pixel';
                }
            });
        }

        // Preview toggle
        const previewToggle = document.getElementById('svPreviewToggle');
        if (previewToggle) {
            previewToggle.addEventListener('change', (e) => {
                if (this.app) {
                    this.app.state.previewOn = e.target.checked;
                    this.app.render();
                }
            });
        }

        // Navigation
        document.getElementById('svPrevPage')?.addEventListener('click', () => this.app?.loadPage(this.app.state.idx - 1));
        document.getElementById('svNextPage')?.addEventListener('click', () => this.app?.loadPage(this.app.state.idx + 1));
        document.getElementById('svUndo')?.addEventListener('click', () => this.app?.undo());
        document.getElementById('svZoomReset')?.addEventListener('click', () => {
            if (this.app) {
                this.app.state.zoom = 1;
                this.app.state.pan = { x: 0, y: 0 };
                this.app.render();
                this.updateZoomDisplay();
            }
        });

        // Page input
        const pageInput = document.getElementById('svPageInput');
        if (pageInput) {
            pageInput.addEventListener('change', (e) => {
                const page = parseInt(e.target.value) - 1;
                this.app?.loadPage(page);
            });
        }

        // Import button - show PDF library
        document.getElementById('svImportBtn')?.addEventListener('click', () => {
            CommonPdfImport.showLibrary('split');
        });

        // Projects button
        document.getElementById('svProjectsBtn')?.addEventListener('click', () => this.showProjectManager());

        // Delete button
        document.getElementById('svDeleteBtn')?.addEventListener('click', () => this.app?.deleteSelected());

        // Hook into app's render to update page info
        if (this.app) {
            const originalLoadPage = this.app.loadPage.bind(this.app);
            this.app.loadPage = async (i, broadcast) => {
                await originalLoadPage(i, broadcast);
                this.updatePageInfo();
                this.updateZoomDisplay();
            };

            // Also update on render for zoom changes
            const originalRender = this.app.render.bind(this.app);
            this.app.render = () => {
                originalRender();
                this.updateZoomDisplay();
            };
        }
    },

    /**
     * Switch sidebar tab
     */
    switchTab(tab) {
        document.getElementById('svTabTools')?.classList.toggle('active', tab === 'tools');
        document.getElementById('svTabPages')?.classList.toggle('active', tab === 'pages');
        document.getElementById('svPanelTools').style.display = tab === 'tools' ? 'flex' : 'none';
        document.getElementById('svPanelPages').style.display = tab === 'pages' ? 'block' : 'none';

        if (tab === 'pages') {
            this.renderPageThumbnails();
        }
    },

    /**
     * Set active tool
     */
    setTool(tool) {
        if (!this.app) return;

        this.app.setTool(tool);

        // Update button states
        document.querySelectorAll('#svSidebar [data-tool]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });

        // Show/hide tool-specific options
        document.getElementById('svShapeOptions').style.display = tool === 'shape' ? 'block' : 'none';
        document.getElementById('svEraserOptions').style.display = tool === 'eraser' ? 'block' : 'none';
    },

    /**
     * Update page info display
     */
    updatePageInfo() {
        if (!this.app) return;
        const pageInput = document.getElementById('svPageInput');
        const pageTotal = document.getElementById('svPageTotal');

        if (pageInput) pageInput.value = this.app.state.idx + 1;
        if (pageTotal) pageTotal.textContent = `/ ${this.app.state.images.length}`;
    },

    /**
     * Update zoom display
     */
    updateZoomDisplay() {
        if (!this.app) return;
        const zoomBtn = document.getElementById('svZoomReset');
        if (zoomBtn) {
            zoomBtn.textContent = Math.round(this.app.state.zoom * 100) + '%';
        }
    },

    /**
     * Render page thumbnails in sidebar
     */
    renderPageThumbnails() {
        if (!this.app) return;
        const container = document.getElementById('svPageList');
        if (!container) return;

        container.innerHTML = '';

        this.app.state.images.forEach((img, idx) => {
            const item = document.createElement('div');
            item.className = 'sb-page-item';
            item.style.cssText = 'aspect-ratio: auto; cursor: pointer; position: relative;';
            if (idx === this.app.state.idx) item.classList.add('active');

            const imgEl = document.createElement('img');
            imgEl.style.cssText = 'width:100%; display:block; border-radius:4px; border:1px solid #333;';

            // Create thumbnail from blob
            if (img.blob) {
                const url = URL.createObjectURL(img.blob);
                imgEl.src = url;
                imgEl.onload = () => URL.revokeObjectURL(url);
            }

            const num = document.createElement('div');
            num.className = 'sb-page-num';
            num.textContent = idx + 1;

            item.appendChild(imgEl);
            item.appendChild(num);
            item.onclick = () => {
                this.app.loadPage(idx);
                this.renderPageThumbnails(); // Refresh to update active state
            };

            container.appendChild(item);
        });
    },

    /**
     * Disable split view
     */
    disable() {
        const viewport = document.querySelector('.viewport');
        const workspace = document.querySelector('.workspace');
        const sidebar = document.querySelector('.sidebar');
        const container = document.getElementById('splitViewContainer');
        const leftPanel = document.getElementById('leftPanel');

        if (!viewport || !workspace) return;

        console.log('Disabling split view...');

        if (container) container.style.display = 'none';

        if (leftPanel && leftPanel.contains(viewport)) {
            leftPanel.removeChild(viewport);
        }

        if (viewport.parentNode === workspace) workspace.removeChild(viewport);
        if (sidebar && sidebar.parentNode === workspace) workspace.removeChild(sidebar);
        if (container && container.parentNode === workspace) workspace.removeChild(container);

        if (sidebar) {
            workspace.appendChild(sidebar);
            sidebar.style.display = 'flex';
        }
        workspace.appendChild(viewport);
        viewport.style.display = 'flex';

        if (container) workspace.appendChild(container);

        console.log('Split view disabled');
    },

    /**
     * Handle PDF import for split view (called by CommonPdfImport)
     * This is now a simpler wrapper since CommonPdfImport handles most logic
     */
    async handlePdfImport(file) {
        if (!this.app || !file) return;

        try {
            console.log('SplitView: Importing PDF:', file.name);

            const projectName = file.name.replace(/\.pdf$/i, '');

            // Let CommonPdfImport handle the actual import
            await CommonPdfImport.importIntoApp(this.app, file, projectName);

            // Update page info
            this.updatePageInfo();
            this.renderPageThumbnails();

            // Save to project list
            await this.saveProjectMeta(this.app.state.sessionId, projectName);

            console.log('SplitView: PDF imported successfully');

        } catch (error) {
            console.error('SplitView: Error importing PDF:', error);
            SplitViewUI.showAlert('Import Error', 'Error importing PDF: ' + error.message);
        }
    },

    /**
     * Save project metadata
     */
    async saveProjectMeta(id, name) {
        if (!this.rightDB) return;

        const tx = this.rightDB.transaction([this.STORE_NAME], 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);

        await new Promise((resolve, reject) => {
            const req = store.put({
                id: id,
                name: name,
                timestamp: Date.now()
            });
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },

    /**
     * Get all projects
     */
    async getAllProjects() {
        if (!this.rightDB) return [];

        const tx = this.rightDB.transaction([this.STORE_NAME], 'readonly');
        const store = tx.objectStore(this.STORE_NAME);

        return new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    },

    /**
     * Load last project
     */
    async loadLastProject() {
        try {
            const projects = await this.getAllProjects();
            if (projects.length > 0) {
                projects.sort((a, b) => b.timestamp - a.timestamp);
                const lastProject = projects[0];

                // Try to open the session
                await this.app.openSession(lastProject.id);
                this.updatePageInfo();
                this.renderPageThumbnails();
            }
        } catch (error) {
            console.log('SplitView: No previous project to load');
        }
    },

    /**
     * Show project manager
     */
    async showProjectManager() {
        let modal = document.getElementById('svProjectModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'svProjectModal';
            modal.className = 'overlay';
            modal.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:9999; align-items:center; justify-content:center;';
            modal.innerHTML = `
                <div class="card" style="width:90%; max-width:500px; max-height:80vh; display:flex; flex-direction:column;">
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:20px; border-bottom:1px solid var(--border);">
                        <h3 style="margin:0;">Local Projects</h3>
                        <button id="svCloseProjectModal" style="background:none; border:none; color:#888; cursor:pointer; font-size:1.2rem;">
                            <i class="bi bi-x-lg"></i>
                        </button>
                    </div>
                    <div id="svProjectList" style="flex:1; overflow-y:auto; padding:20px;"></div>
                    <div style="padding:20px; border-top:1px solid var(--border);">
                        <button class="btn btn-primary" id="svImportNewBtn" style="width:100%;">
                            <i class="bi bi-folder-plus"></i> Open PDF Library
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            document.getElementById('svCloseProjectModal').onclick = () => modal.style.display = 'none';
            document.getElementById('svImportNewBtn').onclick = () => {
                modal.style.display = 'none';
                CommonPdfImport.showLibrary('split');
            };
        }

        // Populate list
        await this.refreshProjectList();
        modal.style.display = 'flex';
    },

    /**
     * Refresh project list
     */
    async refreshProjectList() {
        const container = document.getElementById('svProjectList');
        if (!container) return;

        const projects = await this.getAllProjects();

        if (projects.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:40px; color:#666;">
                    <i class="bi bi-folder-x" style="font-size:3rem; margin-bottom:10px;"></i>
                    <p>No projects yet</p>
                </div>
            `;
            return;
        }

        projects.sort((a, b) => b.timestamp - a.timestamp);

        container.innerHTML = '';
        projects.forEach(project => {
            const isActive = this.app && this.app.state.sessionId === project.id;
            const date = new Date(project.timestamp).toLocaleDateString();

            const item = document.createElement('div');
            item.className = 'bm-item';
            item.style.cssText = `display:flex; justify-content:space-between; align-items:center; padding:15px; margin-bottom:8px; ${isActive ? 'border-color:#fff;' : ''}`;

            item.innerHTML = `
                <div style="flex:1; cursor:pointer;" class="proj-name">
                    <div style="font-weight:600; margin-bottom:5px;">${project.name}</div>
                    <div style="font-size:0.8rem; color:#888;">${date}</div>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    ${isActive ? '<span style="color:#0f0; font-size:0.8rem;">● Active</span>' : ''}
                    <button class="bm-del proj-del" title="Delete"><i class="bi bi-trash3"></i></button>
                </div>
            `;

            item.querySelector('.proj-name').onclick = async () => {
                await this.app.openSession(project.id);
                this.updatePageInfo();
                this.renderPageThumbnails();
                document.getElementById('svProjectModal').style.display = 'none';
            };

            item.querySelector('.proj-del').onclick = async (e) => {
                e.stopPropagation();
                await this.deleteProject(project.id);
            };

            container.appendChild(item);
        });
    },

    /**
     * Delete project
     */
    async deleteProject(projectId) {
        const confirmed = await SplitViewUI.showConfirm('Delete Project', 'Delete this project?');
        if (!confirmed) return;

        // Delete from project list DB
        if (this.rightDB) {
            const tx = this.rightDB.transaction([this.STORE_NAME], 'readwrite');
            await new Promise(resolve => {
                const req = tx.objectStore(this.STORE_NAME).delete(projectId);
                req.onsuccess = resolve;
            });
        }

        // Delete pages and session from app's DB
        if (this.app && this.app.db) {
            // Delete pages
            const tx = this.app.db.transaction(['pages', 'sessions'], 'readwrite');
            const pagesStore = tx.objectStore('pages');
            const sessionsStore = tx.objectStore('sessions');

            const pages = await new Promise(resolve => {
                const req = pagesStore.index('sessionId').getAll(projectId);
                req.onsuccess = () => resolve(req.result);
            });

            for (const page of pages) {
                pagesStore.delete(page.id);
            }
            sessionsStore.delete(projectId);
        }

        // If this was the active project, clear the view
        if (this.app && this.app.state.sessionId === projectId) {
            this.app.state.images = [];
            this.app.state.sessionId = null;
            this.app.render();
            this.updatePageInfo();
        }

        await this.refreshProjectList();
    },

    /**
     * Initialize
     */
    async init() {
        try {
            if (typeof pdfjsLib !== 'undefined') {
                pdfjsLib.GlobalWorkerOptions.workerSrc =
                    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            }

            await this.initDB();
            console.log('Split View (Full) initialized');

            // Expose for CommonPdfImport
            window.SplitView = this;
        } catch (error) {
            console.error('SplitView init error:', error);
        }
    }
};
