/**
 * Split View - Simple & Working
 * Left: Main collaborative canvas (untouched)
 * Right: PDF image viewer for reference (no drawing yet)
 */

const SplitView = {
  isEnabled: false,
  
  // Right panel state
  rightDB: null,
  DB_NAME: 'ColorRMSplitViewSimple',
  DB_VERSION: 1,
  STORE_NAME: 'projects',
  
  currentProject: null,
  currentPage: 1,
  zoom: 1.0,
  panX: 0,
  panY: 0,
  
  // Panning state
  isPanning: false,
  startX: 0,
  startY: 0,
  
  // Cache rendered pages as images
  pageImages: [],

  /**
   * Initialize DB
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
      this.enable();
    } else {
      this.disable();
    }
  },

  /**
   * Enable split view
   */
  enable() {
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
      container.innerHTML = `
        <!-- Panels Container -->
        <div style="display:flex; flex:1; overflow:hidden; gap:1px;">
          <!-- Left: Main Canvas -->
          <div class="split-view-panel" id="leftPanel" style="flex:1;"></div>
          
          <!-- Right: Sidebar + PDF Viewer -->
          <div style="display:flex; flex:1; overflow:hidden;">
            <!-- Right Sidebar with page thumbnails -->
            <div id="rightSidebar" style="width:200px; background:var(--bg-panel); border-right:1px solid var(--border); display:flex; flex-direction:column; overflow:hidden; transition:margin-left 0.3s ease;">
              <div style="padding:12px; border-bottom:1px solid var(--border);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                  <h4 style="margin:0; font-size:0.9rem;">Pages</h4>
                  <button class="btn btn-sm" onclick="SplitView.toggleSidebar()" style="padding:4px 8px;" title="Hide sidebar">
                    <i class="bi bi-chevron-left"></i>
                  </button>
                </div>
                <div style="display:flex; gap:4px;">
                  <button class="btn btn-sm" onclick="SplitView.showProjectManager()" style="flex:1; font-size:0.75rem;">
                    <i class="bi bi-folder"></i>
                  </button>
                  <button class="btn btn-sm" onclick="window.CommonPdfImport?.show(); window.CommonPdfImport?.pick('split')" style="flex:1; font-size:0.75rem;" title="Import PDF">
                    <i class="bi bi-upload"></i>
                  </button>
                </div>
              </div>
              <div id="rightPageThumbs" style="flex:1; overflow-y:auto; padding:8px;"></div>
            </div>
            
            <!-- Right PDF Viewer -->
            <div class="split-view-panel" style="display:flex; flex-direction:column; flex:1;">
              <div style="flex:1; overflow:auto; background:#000; display:flex; align-items:center; justify-content:center; padding:20px;">
                <img id="rightPdfImage" style="max-width:100%; max-height:100%; display:block;">
              </div>
              <!-- Right Navigation Bar -->
              <div class="split-view-footer">
                <div style="display:flex; align-items:center; gap:8px;">
                  <button id="sidebarToggleBtn" class="btn btn-sm" onclick="SplitView.toggleSidebar()" 
                          style="display:none; background:var(--bg-surface); border:1px solid var(--border); padding:8px 12px;" 
                          title="Show sidebar">
                    <i class="bi bi-chevron-right"></i>
                  </button>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                  <button class="btn btn-sm" onclick="SplitView.prevPage()"><i class="bi bi-chevron-left"></i></button>
                  <div style="display:flex; align-items:center; gap:4px;">
                    <input type="number" id="rightPageInput" min="1" value="1" 
                           style="width:50px; padding:4px; text-align:center; background:var(--bg-surface); border:1px solid var(--border); border-radius:4px; color:var(--text);"
                           onchange="SplitView.goToPage(parseInt(this.value))"
                           onkeypress="if(event.key==='Enter') SplitView.goToPage(parseInt(this.value))">
                    <span style="color:#888;">/</span>
                    <span id="rightPageTotal" style="min-width:30px;">--</span>
                  </div>
                  <button class="btn btn-sm" onclick="SplitView.nextPage()"><i class="bi bi-chevron-right"></i></button>
                </div>
                <div style="width:1px; height:20px; background:var(--border);"></div>
                <div style="display:flex; gap:8px; align-items:center;">
                  <button class="btn btn-sm" onclick="SplitView.zoomOut()"><i class="bi bi-zoom-out"></i></button>
                  <span id="rightZoomLevel" style="min-width:60px; text-align:center;">100%</span>
                  <button class="btn btn-sm" onclick="SplitView.zoomIn()"><i class="bi bi-zoom-in"></i></button>
                  <button class="btn btn-sm" onclick="SplitView.resetZoom()" title="Reset to 100%"><i class="bi bi-arrow-counterclockwise"></i></button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      workspace.appendChild(container);
    }
    
    container.style.display = 'flex';
    
    // Move viewport to left panel (save original parent for restoration)
    const leftPanel = document.getElementById('leftPanel');
    if (leftPanel) {
      // Store original parent info
      viewport.dataset.originalParent = 'workspace';
      leftPanel.appendChild(viewport);
    }
    
    // Keep sidebar visible
    if (sidebar) sidebar.style.display = 'flex';
    
    // File import is handled by shared CommonPdfImport (in color_rm.html)
    // (Legacy rightPdfInput removed)
    
    // Setup touch gestures for pinch zoom
    this.setupTouchGestures();
    
    // Load last project
    this.loadLastProject();
    
    console.log('Split view enabled');
  },

  /**
   * Disable split view - FIX: Proper restoration
   */
  disable() {
    const viewport = document.querySelector('.viewport');
    const workspace = document.querySelector('.workspace');
    const sidebar = document.querySelector('.sidebar');
    const container = document.getElementById('splitViewContainer');
    const leftPanel = document.getElementById('leftPanel');
    
    if (!viewport || !workspace) return;
    
    console.log('Disabling split view...');
    console.log('Before - Workspace children:', workspace.children.length);
    
    // Hide container
    if (container) container.style.display = 'none';
    
    // Remove viewport from left panel if it's there
    if (leftPanel && leftPanel.contains(viewport)) {
      leftPanel.removeChild(viewport);
      console.log('Removed viewport from left panel');
    }
    
    // Clear workspace children array to rebuild
    const workspaceChildren = Array.from(workspace.children);
    console.log('Current children:', workspaceChildren.map(c => c.className || c.id));
    
    // Remove viewport and sidebar temporarily
    if (viewport.parentNode === workspace) workspace.removeChild(viewport);
    if (sidebar && sidebar.parentNode === workspace) workspace.removeChild(sidebar);
    
    // Also remove container from workspace if it's a direct child
    if (container && container.parentNode === workspace) {
      workspace.removeChild(container);
      console.log('Removed split container from workspace');
    }
    
    // Re-add in ORIGINAL order: SIDEBAR FIRST, VIEWPORT SECOND, container LAST
    if (sidebar) {
      workspace.appendChild(sidebar);
      sidebar.style.display = 'flex';
    }
    workspace.appendChild(viewport);
    viewport.style.display = 'flex';
    
    if (container) {
      workspace.appendChild(container);
    }
    
    console.log('After - Workspace children:', Array.from(workspace.children).map(c => c.className || c.id));
    console.log('✓ Layout restored - ORIGINAL ORDER: sidebar first, viewport second');
  },

  /**
   * Handle file upload
   */
  async handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file || file.type !== 'application/pdf') return;
    
    try {
      console.log('Loading PDF:', file.name);
      
      // Read as base64
      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => {
          const base64String = reader.result.split(',')[1];
          resolve(base64String);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      
      // Create project
      const projectId = `proj_${Date.now()}`;
      const project = {
        id: projectId,
        name: file.name.replace('.pdf', ''),
        pdfBase64: base64,
        timestamp: Date.now(),
        pageImageCache: {} // Store rendered pages as base64 images
      };
      
      // Save
      await this.saveProject(project);
      
      // Open
      await this.openProject(projectId);
      
    } catch (error) {
      console.error('Error loading PDF:', error);
      alert('Error: ' + error.message);
    }
    
    event.target.value = '';
  },

  /**
   * Save project
   */
  async saveProject(project) {
    const tx = this.rightDB.transaction([this.STORE_NAME], 'readwrite');
    const store = tx.objectStore(this.STORE_NAME);
    
    return new Promise((resolve, reject) => {
      const req = store.put(project);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Get project
   */
  async getProject(projectId) {
    const tx = this.rightDB.transaction([this.STORE_NAME], 'readonly');
    const store = tx.objectStore(this.STORE_NAME);
    
    return new Promise((resolve, reject) => {
      const req = store.get(projectId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Get all projects
   */
  async getAllProjects() {
    const tx = this.rightDB.transaction([this.STORE_NAME], 'readonly');
    const store = tx.objectStore(this.STORE_NAME);
    
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Open project
   */
  async openProject(projectId) {
    const project = await this.getProject(projectId);
    if (!project) return;
    
    this.currentProject = project;
    this.currentPage = 1;
    this.pageImages = [];
    
    console.log('Opening:', project.name);
    
    // Decode base64
    const binaryString = atob(project.pdfBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Load with pdf.js
    if (typeof pdfjsLib === 'undefined') {
      alert('PDF library not loaded');
      return;
    }
    
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    console.log('PDF loaded:', pdf.numPages, 'pages');
    
    // Check if we have cached images
    const hasCachedImages = project.pageImageCache && Object.keys(project.pageImageCache).length > 0;
    
    if (hasCachedImages) {
      console.log('Loading from cached images...');
      // Load from cache (instant)
      for (let i = 1; i <= pdf.numPages; i++) {
        if (project.pageImageCache[`page_${i}`]) {
          this.pageImages[i - 1] = project.pageImageCache[`page_${i}`];
          this.updateSidebarThumbnail(i, this.pageImages[i - 1], pdf.numPages);
        }
      }
    } else {
      console.log('Rendering pages for first time...');
      // Render all pages to images (async)
      for (let i = 1; i <= pdf.numPages; i++) {
        this.renderPageToImage(pdf, i);
      }
    }
    
    // Load last visited page or show first page
    const lastPage = parseInt(localStorage.getItem(`splitView_lastPage_${projectId}`)) || 1;
    const startPage = Math.min(Math.max(lastPage, 1), pdf.numPages);
    
    this.showPage(startPage, pdf.numPages);
  },

  /**
   * Render page to image
   */
  async renderPageToImage(pdf, pageNum) {
    try {
      // Check if page is already cached
      if (this.currentProject?.pageImageCache?.[`page_${pageNum}`]) {
        const cachedImage = this.currentProject.pageImageCache[`page_${pageNum}`];
        this.pageImages[pageNum - 1] = cachedImage;
        
        // Update display if this is current page
        if (pageNum === this.currentPage) {
          this.showPage(this.currentPage, pdf.numPages);
        }
        
        // Update sidebar thumbnail
        this.updateSidebarThumbnail(pageNum, cachedImage, pdf.numPages);
        
        console.log('Loaded page', pageNum, 'from cache');
        return;
      }
      
      // Render page
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2.0 }); // High quality
      
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      
      // Convert to image
      const imageData = canvas.toDataURL('image/png');
      this.pageImages[pageNum - 1] = imageData;
      
      // Save to project cache
      if (this.currentProject) {
        if (!this.currentProject.pageImageCache) {
          this.currentProject.pageImageCache = {};
        }
        this.currentProject.pageImageCache[`page_${pageNum}`] = imageData;
        
        // Save to IndexedDB (debounced - save every 5 pages)
        if (pageNum % 5 === 0 || pageNum === pdf.numPages) {
          await this.saveProject(this.currentProject);
          console.log('Cached pages saved to IndexedDB');
        }
      }
      
      // Update display if this is current page
      if (pageNum === this.currentPage) {
        this.showPage(this.currentPage, pdf.numPages);
      }
      
      // Update sidebar thumbnail
      this.updateSidebarThumbnail(pageNum, imageData, pdf.numPages);
      
    } catch (error) {
      console.error('Error rendering page', pageNum, ':', error);
    }
  },

  /**
   * Update sidebar thumbnail
   */
  updateSidebarThumbnail(pageNum, imageData, totalPages) {
    const thumbsContainer = document.getElementById('rightPageThumbs');
    if (!thumbsContainer) return;
    
    // Create thumbnails container on first call
    if (thumbsContainer.children.length === 0 && pageNum === 1) {
      for (let i = 1; i <= totalPages; i++) {
        const thumbDiv = document.createElement('div');
        thumbDiv.id = `rightThumb${i}`;
        thumbDiv.className = 'page-thumb';
        thumbDiv.style.cssText = 'margin-bottom:8px; cursor:pointer; border:2px solid transparent; border-radius:4px; overflow:hidden;';
        thumbDiv.onclick = () => this.showPage(i, totalPages);
        thumbDiv.innerHTML = `
          <img style="width:100%; display:block; background:#222;">
          <div style="text-align:center; padding:4px; background:var(--bg-surface); font-size:0.75rem;">Page ${i}</div>
        `;
        thumbsContainer.appendChild(thumbDiv);
      }
    }
    
    // Update specific thumbnail
    const thumbDiv = document.getElementById(`rightThumb${pageNum}`);
    if (thumbDiv) {
      const img = thumbDiv.querySelector('img');
      if (img) img.src = imageData;
    }
    
    // Highlight current page
    for (let i = 1; i <= totalPages; i++) {
      const thumb = document.getElementById(`rightThumb${i}`);
      if (thumb) {
        thumb.style.borderColor = i === this.currentPage ? '#fff' : 'transparent';
      }
    }
  },

  /**
   * Show page
   */
  showPage(pageNum, totalPages) {
    const img = document.getElementById('rightPdfImage');
    const pageInput = document.getElementById('rightPageInput');
    const pageTotal = document.getElementById('rightPageTotal');
    
    if (!img) return;
    
    this.currentPage = pageNum;
    
    // Reset pan when changing pages
    this.panX = 0;
    this.panY = 0;
    
    // Update page input and total
    if (pageInput) {
      pageInput.value = pageNum;
      pageInput.max = totalPages;
    }
    if (pageTotal) {
      pageTotal.textContent = totalPages;
    }
    
    if (this.pageImages[pageNum - 1]) {
      img.src = this.pageImages[pageNum - 1];
      this.updateZoom();
    } else {
      img.src = '';
    }
    
    // Update sidebar highlighting
    for (let i = 1; i <= totalPages; i++) {
      const thumb = document.getElementById(`rightThumb${i}`);
      if (thumb) {
        thumb.style.borderColor = i === pageNum ? '#fff' : 'transparent';
      }
    }
    
    // Save last visited page to localStorage
    if (this.currentProject) {
      localStorage.setItem(`splitView_lastPage_${this.currentProject.id}`, pageNum);
    }
  },

  /**
   * Toggle sidebar visibility
   */
  toggleSidebar() {
    const sidebar = document.getElementById('rightSidebar');
    const toggleBtn = document.getElementById('sidebarToggleBtn');
    
    if (!sidebar) return;
    
    const isHidden = sidebar.style.display === 'none';

    if (isHidden) {
      // Show sidebar (restore layout)
      sidebar.style.display = 'flex';
      sidebar.style.marginLeft = '0';
      if (toggleBtn) {
        toggleBtn.style.display = 'none';
      }
    } else {
      // Hide sidebar completely so it doesn't overlap/steal space in overflow:hidden flex layouts
      sidebar.style.display = 'none';
      if (toggleBtn) {
        toggleBtn.style.display = 'inline-flex';
        toggleBtn.style.alignItems = 'center';
        toggleBtn.style.justifyContent = 'center';
      }
    }
  },

  /**
   * Go to specific page
   */
  goToPage(pageNum) {
    if (!this.currentProject || !this.pageImages.length) return;
    
    const total = this.pageImages.length;
    
    if (pageNum < 1 || pageNum > total || isNaN(pageNum)) {
      // Reset to current page
      const input = document.getElementById('rightPageInput');
      if (input) input.value = this.currentPage;
      return;
    }
    
    this.showPage(pageNum, total);
  },

  /**
   * Navigation
   */
  nextPage() {
    if (this.currentProject && this.pageImages.length > 0) {
      const next = Math.min(this.currentPage + 1, this.pageImages.length);
      this.showPage(next, this.pageImages.length);
    }
  },

  prevPage() {
    if (this.currentProject && this.pageImages.length > 0) {
      const prev = Math.max(this.currentPage - 1, 1);
      this.showPage(prev, this.pageImages.length);
    }
  },

  /**
   * Zoom
   */
  zoomIn() {
    this.zoom = Math.min(this.zoom + 0.25, 3.0);
    this.updateZoom();
  },

  zoomOut() {
    this.zoom = Math.max(this.zoom - 0.25, 0.5);
    this.updateZoom();
  },

  resetZoom() {
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.updateZoom();
  },

  updateZoom() {
    const img = document.getElementById('rightPdfImage');
    const zoomLabel = document.getElementById('rightZoomLevel');
    
    if (img) {
      img.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
      img.style.transformOrigin = 'center center';
      img.style.transition = 'transform 0.1s ease-out';
    }
    
    // Update right panel zoom display
    if (zoomLabel) {
      zoomLabel.textContent = Math.round(this.zoom * 100) + '%';
    }
  },

  /**
   * Setup touch gestures for pinch zoom and panning
   */
  setupTouchGestures() {
    const img = document.getElementById('rightPdfImage');
    const container = img?.parentElement;
    if (!img || !container) return;
    
    let initialDistance = 0;
    let initialZoom = 1.0;
    
    const getDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };
    
    // Touch events for pinch zoom
    img.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        initialDistance = getDistance(e.touches);
        initialZoom = this.zoom;
      } else if (e.touches.length === 1) {
        // Single touch for panning
        this.isPanning = true;
        this.startX = e.touches[0].clientX - this.panX;
        this.startY = e.touches[0].clientY - this.panY;
      }
    }, { passive: false });
    
    img.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const currentDistance = getDistance(e.touches);
        const scale = currentDistance / initialDistance;
        this.zoom = Math.max(0.5, Math.min(3.0, initialZoom * scale));
        this.updateZoom();
      } else if (e.touches.length === 1 && this.isPanning) {
        e.preventDefault();
        this.panX = e.touches[0].clientX - this.startX;
        this.panY = e.touches[0].clientY - this.startY;
        this.updateZoom();
      }
    }, { passive: false });
    
    img.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        initialDistance = 0;
      }
      if (e.touches.length === 0) {
        this.isPanning = false;
      }
    });
    
    // Mouse events for panning (desktop)
    img.addEventListener('mousedown', (e) => {
      if (this.zoom > 1.0) {
        this.isPanning = true;
        this.startX = e.clientX - this.panX;
        this.startY = e.clientY - this.panY;
        img.style.cursor = 'grabbing';
        e.preventDefault();
      }
    });
    
    container.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.panX = e.clientX - this.startX;
        this.panY = e.clientY - this.startY;
        this.updateZoom();
      }
    });
    
    container.addEventListener('mouseup', () => {
      if (this.isPanning) {
        this.isPanning = false;
        img.style.cursor = this.zoom > 1.0 ? 'grab' : 'default';
      }
    });
    
    container.addEventListener('mouseleave', () => {
      if (this.isPanning) {
        this.isPanning = false;
        img.style.cursor = this.zoom > 1.0 ? 'grab' : 'default';
      }
    });
    
    // Update cursor based on zoom
    img.style.cursor = this.zoom > 1.0 ? 'grab' : 'default';
    
    console.log('Touch gestures enabled: pinch zoom + panning');
  },

  /**
   * Load last project
   */
  async loadLastProject() {
    try {
      const projects = await this.getAllProjects();
      if (projects.length > 0) {
        projects.sort((a, b) => b.timestamp - a.timestamp);
        await this.openProject(projects[0].id);
      }
    } catch (error) {
      console.log('No previous project');
    }
  },

  /**
   * Show project manager modal
   */
  async showProjectManager() {
    // Create modal if doesn't exist
    let modal = document.getElementById('rightProjectModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'rightProjectModal';
      modal.className = 'overlay';
      modal.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:9999; align-items:center; justify-content:center;';
      modal.innerHTML = `
        <div class="card" style="width:90%; max-width:600px; max-height:80vh; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:center; padding:20px; border-bottom:1px solid var(--border);">
            <h3 style="margin:0;">Local PDF Projects</h3>
            <button onclick="SplitView.closeProjectManager()" style="background:none; border:none; color:#888; cursor:pointer; font-size:1.2rem;">
              <i class="bi bi-x-lg"></i>
            </button>
          </div>
          <div id="rightProjectList" style="flex:1; overflow-y:auto; padding:20px;"></div>
          <div style="padding:20px; border-top:1px solid var(--border); display:flex; gap:10px;">
            <button class="btn btn-primary" onclick="SplitView.closeProjectManager(); window.CommonPdfImport?.show(); window.CommonPdfImport?.pick('split')" style="flex:1;">
              <i class="bi bi-upload"></i> Upload New PDF
            </button>
            <button class="btn" onclick="SplitView.showImportFromMain()" style="flex:1; border:1px solid #333;">
              <i class="bi bi-box-arrow-in-down"></i> Import from Main
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    
    // Load and display projects
    await this.refreshProjectList();
    modal.style.display = 'flex';
  },

  /**
   * Close project manager
   */
  closeProjectManager() {
    const modal = document.getElementById('rightProjectModal');
    if (modal) modal.style.display = 'none';
  },

  /**
   * Refresh project list
   */
  async refreshProjectList() {
    const container = document.getElementById('rightProjectList');
    if (!container) return;
    
    try {
      const projects = await this.getAllProjects();
      
      if (projects.length === 0) {
        container.innerHTML = `
          <div style="text-align:center; padding:40px; color:#666;">
            <i class="bi bi-folder-x" style="font-size:3rem; margin-bottom:10px;"></i>
            <p>No projects yet</p>
            <p style="font-size:0.9rem;">Upload a PDF to get started</p>
          </div>
        `;
        return;
      }
      
      // Sort by timestamp
      projects.sort((a, b) => b.timestamp - a.timestamp);
      
      let html = '<div style="display:flex; flex-direction:column; gap:10px;">';
      
      for (const project of projects) {
        const isActive = this.currentProject && this.currentProject.id === project.id;
        const date = new Date(project.timestamp).toLocaleDateString();
        
        html += `
          <div class="bm-item" style="display:flex; justify-content:space-between; align-items:center; padding:15px; ${isActive ? 'border-color:#fff;' : ''}">
            <div style="flex:1; cursor:pointer;" onclick="SplitView.switchProject('${project.id}')">
              <div style="font-weight:600; margin-bottom:5px;">${project.name}</div>
              <div style="font-size:0.8rem; color:#888;">${date}</div>
            </div>
            <div style="display:flex; gap:8px;">
              ${isActive ? '<span style="color:#0f0; font-size:0.8rem;">● Active</span>' : ''}
              <button class="bm-del" onclick="event.stopPropagation(); SplitView.deleteProject('${project.id}')" title="Delete">
                <i class="bi bi-trash3"></i>
              </button>
            </div>
          </div>
        `;
      }
      
      html += '</div>';
      container.innerHTML = html;
      
    } catch (error) {
      console.error('Error loading projects:', error);
      container.innerHTML = '<div style="color:#f00; padding:20px;">Error loading projects</div>';
    }
  },

  /**
   * Switch to different project
   */
  async switchProject(projectId) {
    try {
      await this.openProject(projectId);
      this.closeProjectManager();
    } catch (error) {
      console.error('Error switching project:', error);
      alert('Error loading project');
    }
  },

  /**
   * Show import from main projects
   */
  async showImportFromMain() {
    // Get main collaborative projects from localStorage
    const mainProjects = this.getMainProjects();
    
    if (mainProjects.length === 0) {
      alert('No collaborative projects found. Upload a PDF to the main canvas first.');
      return;
    }
    
    // Create import modal
    let importModal = document.getElementById('importMainModal');
    if (!importModal) {
      importModal = document.createElement('div');
      importModal.id = 'importMainModal';
      importModal.className = 'overlay';
      importModal.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:10000; align-items:center; justify-content:center;';
      importModal.innerHTML = `
        <div class="card" style="width:90%; max-width:500px; max-height:80vh; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:center; padding:20px; border-bottom:1px solid var(--border);">
            <h3 style="margin:0;">Import from Main Projects</h3>
            <button onclick="SplitView.closeImportModal()" style="background:none; border:none; color:#888; cursor:pointer; font-size:1.2rem;">
              <i class="bi bi-x-lg"></i>
            </button>
          </div>
          <div id="importMainList" style="flex:1; overflow-y:auto; padding:20px;"></div>
        </div>
      `;
      document.body.appendChild(importModal);
    }
    
    // Populate list
    const listContainer = document.getElementById('importMainList');
    let html = '<div style="display:flex; flex-direction:column; gap:10px;">';
    
    for (const project of mainProjects) {
      html += `
        <div class="bm-item" style="display:flex; justify-content:space-between; align-items:center; padding:15px; cursor:pointer;" 
             onclick="SplitView.importProject('${project.id}', '${project.name.replace(/'/g, "\\'")}')">
          <div>
            <div style="font-weight:600;">${project.name}</div>
            <div style="font-size:0.8rem; color:#888;">Click to import as local reference</div>
          </div>
          <i class="bi bi-arrow-right" style="font-size:1.5rem; color:#666;"></i>
        </div>
      `;
    }
    
    html += '</div>';
    listContainer.innerHTML = html;
    
    importModal.style.display = 'flex';
  },

  /**
   * Close import modal
   */
  closeImportModal() {
    const modal = document.getElementById('importMainModal');
    if (modal) modal.style.display = 'none';
  },

  /**
   * Get main collaborative projects from localStorage
   */
  getMainProjects() {
    try {
      // Check localStorage for project list
      const keys = Object.keys(localStorage);
      const projects = [];
      
      for (const key of keys) {
        // Look for project metadata keys
        if (key.startsWith('colorRM_project_') || key.includes('project')) {
          try {
            const data = JSON.parse(localStorage.getItem(key));
            if (data && data.name) {
              projects.push({
                id: key,
                name: data.name,
                data: data
              });
            }
          } catch (e) {
            // Skip invalid entries
          }
        }
      }
      
      return projects;
    } catch (error) {
      console.error('Error reading main projects:', error);
      return [];
    }
  },

  /**
   * Import project from main to local
   */
  async importProject(projectId, projectName) {
    try {
      console.log('Importing project:', projectName);
      
      // Get project data from localStorage
      const projectData = localStorage.getItem(projectId);
      if (!projectData) {
        alert('Project not found');
        return;
      }
      
      const data = JSON.parse(projectData);
      
      // Check if there's PDF data
      if (!data.pdfBase64 && !data.pdf) {
        alert('No PDF data found in this project');
        return;
      }
      
      // Create local project
      const localProjectId = `proj_${Date.now()}`;
      const localProject = {
        id: localProjectId,
        name: projectName + ' (imported)',
        pdfBase64: data.pdfBase64 || data.pdf,
        timestamp: Date.now()
      };
      
      // Save to local storage
      await this.saveProject(localProject);
      
      // Close modals
      this.closeImportModal();
      this.closeProjectManager();
      
      // Open imported project
      await this.openProject(localProjectId);
      
      console.log('Project imported successfully');
      
    } catch (error) {
      console.error('Error importing project:', error);
      alert('Error importing project: ' + error.message);
    }
  },

  /**
   * Delete project
   */
  async deleteProject(projectId) {
    if (!confirm('Delete this project? This cannot be undone.')) return;
    
    try {
      const tx = this.rightDB.transaction([this.STORE_NAME], 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      
      await new Promise((resolve, reject) => {
        const req = store.delete(projectId);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      
      console.log('Project deleted:', projectId);
      
      // If deleted project was active, clear it
      if (this.currentProject && this.currentProject.id === projectId) {
        this.currentProject = null;
        this.currentPage = 1;
        this.pageImages = [];
        
        // Clear display
        const img = document.getElementById('rightPdfImage');
        const info = document.getElementById('rightPageInfo');
        if (img) img.src = '';
        if (info) info.textContent = '--/--';
        
        // Load another project if available
        await this.loadLastProject();
      }
      
      // Refresh list
      await this.refreshProjectList();
      
    } catch (error) {
      console.error('Error deleting project:', error);
      alert('Error deleting project');
    }
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
      console.log('Split View Simple initialized');
    } catch (error) {
      console.error('Init error:', error);
    }
  }
};

// Auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => SplitView.init());
} else {
  SplitView.init();
}
