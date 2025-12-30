/**
 * Split View - Final Implementation
 * Left: Collaborative canvas (existing system)
 * Right: Local canvas with separate PDF (shares same tools)
 */

const SplitView = {
  // State
  isEnabled: false,
  
  // Right panel DB (separate from main collaborative DB)
  rightDB: null,
  DB_NAME: 'ColorRMSplitViewRight',
  DB_VERSION: 1,
  STORE_NAME: 'rightPDF',
  
  // Right panel state
  rightPdfData: null,
  rightPdfDoc: null,
  rightCurrentPage: 1,
  rightCanvas: null,
  rightCtx: null,
  rightZoom: 1.5,

  /**
   * Initialize right panel IndexedDB
   */
  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.rightDB = request.result;
        resolve(this.rightDB);
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
    
    if (!viewport || !workspace) return;
    
    // Create split container
    let container = document.getElementById('splitViewContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'splitViewContainer';
      container.className = 'split-view-container';
      container.innerHTML = `
        <div class="split-view-panel" id="leftPanel"></div>
        <div class="split-view-panel">
          <div class="split-view-header">
            <span>Reference PDF (Local)</span>
            <input type="file" id="rightPdfInput" accept=".pdf" style="display:none">
            <button class="btn btn-sm" onclick="document.getElementById('rightPdfInput').click()">
              <i class="bi bi-upload"></i> Upload
            </button>
          </div>
          <div class="split-view-canvas-wrapper">
            <canvas id="rightCanvas"></canvas>
          </div>
          <div class="split-view-footer">
            <button class="btn btn-sm" onclick="SplitView.prevPage()"><i class="bi bi-chevron-left"></i></button>
            <span id="rightPageInfo">--/--</span>
            <button class="btn btn-sm" onclick="SplitView.nextPage()"><i class="bi bi-chevron-right"></i></button>
            <div style="width:1px; height:20px; background:var(--border); margin:0 8px;"></div>
            <button class="btn btn-sm" onclick="SplitView.zoomOut()" title="Zoom Out"><i class="bi bi-zoom-out"></i></button>
            <span style="font-size:0.75rem; min-width:50px; text-align:center;" id="rightZoomLevel">150%</span>
            <button class="btn btn-sm" onclick="SplitView.zoomIn()" title="Zoom In"><i class="bi bi-zoom-in"></i></button>
          </div>
        </div>
      `;
      workspace.appendChild(container);
    }
    
    container.style.display = 'flex';
    
    // Move main viewport to left panel
    const leftPanel = document.getElementById('leftPanel');
    if (leftPanel && viewport.parentNode !== leftPanel) {
      leftPanel.appendChild(viewport);
      viewport.style.display = 'flex';
    }
    
    // Keep sidebar visible for tools (don't hide it)
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.style.display = 'flex';
      console.log('Sidebar kept visible for tools');
    }
    
    // Setup right canvas
    setTimeout(() => this.setupRightCanvas(), 100);
  },

  /**
   * Disable split view and restore layout properly
   */
  disable() {
    const viewport = document.querySelector('.viewport');
    const workspace = document.querySelector('.workspace');
    const sidebar = document.querySelector('.sidebar');
    const container = document.getElementById('splitViewContainer');
    
    console.log('Disabling split view...');
    
    if (container) container.style.display = 'none';
    
    // Restore viewport to its original position
    const leftPanel = document.getElementById('leftPanel');
    if (leftPanel && leftPanel.contains(viewport)) {
      // Remove from left panel
      leftPanel.removeChild(viewport);
      
      // Find correct position in workspace
      // Viewport should be FIRST child, before sidebar
      const firstChild = workspace.firstChild;
      if (firstChild) {
        workspace.insertBefore(viewport, firstChild);
      } else {
        workspace.appendChild(viewport);
      }
      
      viewport.style.display = 'flex';
      console.log('Viewport restored to workspace');
    }
    
    // Show sidebar
    if (sidebar) {
      sidebar.style.display = 'flex';
      console.log('Sidebar restored');
    }
    
    console.log('✓ Split view disabled, layout restored');
  },

  /**
   * Setup right canvas
   */
  setupRightCanvas() {
    this.rightCanvas = document.getElementById('rightCanvas');
    if (!this.rightCanvas) {
      console.error('Right canvas not found');
      return;
    }
    
    this.rightCtx = this.rightCanvas.getContext('2d', { willReadFrequently: true });
    console.log('Right canvas initialized');
    
    // Setup file input
    const input = document.getElementById('rightPdfInput');
    if (input) {
      input.addEventListener('change', (e) => this.loadPDF(e));
    }
    
    // Load existing PDF if any
    this.loadExistingPDF();
  },

  /**
   * Load PDF file
   */
  async loadPDF(event) {
    const file = event.target.files[0];
    if (!file || file.type !== 'application/pdf') {
      alert('Please select a PDF file');
      return;
    }
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfData = {
        id: 'rightPDF',
        name: file.name,
        data: arrayBuffer,
        timestamp: Date.now()
      };
      
      // Save to IndexedDB
      const transaction = this.rightDB.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      await new Promise((resolve, reject) => {
        const request = store.put(pdfData);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      
      console.log('PDF saved to right panel DB');
      await this.openPDF(arrayBuffer);
      
    } catch (error) {
      console.error('Error loading PDF:', error);
      alert('Error loading PDF');
    }
    
    event.target.value = '';
  },

  /**
   * Load existing PDF from DB
   */
  async loadExistingPDF() {
    try {
      const transaction = this.rightDB.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.get('rightPDF');
      
      request.onsuccess = async () => {
        const pdfData = request.result;
        if (pdfData) {
          console.log('Loading existing PDF from DB');
          await this.openPDF(pdfData.data);
        }
      };
    } catch (error) {
      console.log('No existing PDF');
    }
  },

  /**
   * Open PDF
   */
  async openPDF(arrayBuffer) {
    if (typeof pdfjsLib === 'undefined') {
      console.error('pdfjsLib not loaded');
      return;
    }
    
    const uint8Array = new Uint8Array(arrayBuffer);
    this.rightPdfDoc = await pdfjsLib.getDocument({ data: uint8Array }).promise;
    this.rightCurrentPage = 1;
    
    console.log('PDF loaded with', this.rightPdfDoc.numPages, 'pages');
    await this.renderPage(1);
  },

  /**
   * Render page with current zoom
   */
  async renderPage(pageNum) {
    if (!this.rightPdfDoc || !this.rightCanvas) return;
    
    if (pageNum < 1 || pageNum > this.rightPdfDoc.numPages) return;
    
    this.rightCurrentPage = pageNum;
    
    // Update page info
    const pageInfo = document.getElementById('rightPageInfo');
    if (pageInfo) {
      pageInfo.textContent = `${pageNum}/${this.rightPdfDoc.numPages}`;
    }
    
    const page = await this.rightPdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: this.rightZoom });
    
    // Set canvas size
    this.rightCanvas.width = viewport.width;
    this.rightCanvas.height = viewport.height;
    
    // Render PDF
    await page.render({
      canvasContext: this.rightCtx,
      viewport: viewport
    }).promise;
    
    console.log('Page', pageNum, 'rendered at', Math.round(this.rightZoom * 100) + '% zoom');
  },

  /**
   * Navigation
   */
  async nextPage() {
    if (this.rightPdfDoc && this.rightCurrentPage < this.rightPdfDoc.numPages) {
      await this.renderPage(this.rightCurrentPage + 1);
    }
  },

  async prevPage() {
    if (this.rightPdfDoc && this.rightCurrentPage > 1) {
      await this.renderPage(this.rightCurrentPage - 1);
    }
  },

  /**
   * Zoom controls
   */
  async zoomIn() {
    if (this.rightZoom < 3.0) {
      this.rightZoom += 0.25;
      this.updateZoomDisplay();
      await this.renderPage(this.rightCurrentPage);
    }
  },

  async zoomOut() {
    if (this.rightZoom > 0.5) {
      this.rightZoom -= 0.25;
      this.updateZoomDisplay();
      await this.renderPage(this.rightCurrentPage);
    }
  },

  updateZoomDisplay() {
    const zoomEl = document.getElementById('rightZoomLevel');
    if (zoomEl) {
      zoomEl.textContent = Math.round(this.rightZoom * 100) + '%';
    }
  },

  /**
   * Initialize
   */
  async init() {
    try {
      // Setup pdf.js worker
      if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }
      
      await this.initDB();
      console.log('Split View initialized');
    } catch (error) {
      console.error('Error initializing split view:', error);
    }
  }
};

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => SplitView.init());
} else {
  SplitView.init();
}
