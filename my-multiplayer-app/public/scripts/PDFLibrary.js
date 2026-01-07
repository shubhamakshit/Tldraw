/**
 * PDFLibrary - Shared PDF storage for ColorRM apps
 * Both main (collaborative) and split view (local) apps can access this library
 */

export const PDFLibrary = {
    DB_NAME: 'ColorRM_PDFLibrary',
    DB_VERSION: 1,
    STORE_NAME: 'pdfs',

    db: null,
    modal: null,
    onSelect: null, // Callback when PDF is selected

    /**
     * Initialize the PDF library database
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                console.log('PDFLibrary: Database initialized');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
                    store.createIndex('name', 'name', { unique: false });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    },

    /**
     * Upload a PDF to the library
     */
    async upload(file) {
        if (!this.db) await this.init();
        if (!file || !file.type.includes('pdf')) {
            throw new Error('Invalid file type. Please select a PDF.');
        }

        const id = `pdf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const name = file.name.replace('.pdf', '').replace('.PDF', '');

        const entry = {
            id,
            name,
            blob: file,
            size: file.size,
            timestamp: Date.now()
        };

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            const req = store.put(entry);

            req.onsuccess = () => {
                console.log('PDFLibrary: Uploaded', name);
                resolve(entry);
            };
            req.onerror = () => reject(req.error);
        });
    },

    /**
     * Get all PDFs in the library
     */
    async getAll() {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([this.STORE_NAME], 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const req = store.getAll();

            req.onsuccess = () => {
                const results = req.result || [];
                results.sort((a, b) => b.timestamp - a.timestamp);
                resolve(results);
            };
            req.onerror = () => reject(req.error);
        });
    },

    /**
     * Get a specific PDF by ID
     */
    async get(id) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([this.STORE_NAME], 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const req = store.get(id);

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    /**
     * Delete a PDF from the library
     */
    async delete(id) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            const req = store.delete(id);

            req.onsuccess = () => {
                console.log('PDFLibrary: Deleted', id);
                resolve();
            };
            req.onerror = () => reject(req.error);
        });
    },

    /**
     * Format file size for display
     */
    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },

    /**
     * Create and inject the modal HTML
     */
    createModal() {
        if (document.getElementById('pdfLibraryModal')) return;

        const modal = document.createElement('div');
        modal.id = 'pdfLibraryModal';
        modal.className = 'overlay';
        modal.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:10000; align-items:center; justify-content:center;';

        modal.innerHTML = `
            <div class="card" style="width:90%; max-width:600px; max-height:85vh; display:flex; flex-direction:column;">
                <!-- Header -->
                <div style="display:flex; justify-content:space-between; align-items:center; padding:20px; border-bottom:1px solid var(--border);">
                    <div>
                        <h3 style="margin:0; font-size:1.2rem;">PDF Library</h3>
                        <p style="margin:4px 0 0; font-size:0.75rem; color:#666;">Select a PDF to open or upload a new one</p>
                    </div>
                    <button id="pdfLibraryClose" class="btn btn-icon" style="background:none; border:none;">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>

                <!-- Upload Area -->
                <div id="pdfLibraryDropzone" style="margin:16px; padding:24px; border:2px dashed #333; border-radius:8px; text-align:center; cursor:pointer; transition:all 0.2s;">
                    <i class="bi bi-cloud-arrow-up" style="font-size:2rem; color:#666;"></i>
                    <p style="margin:8px 0 0; color:#888; font-size:0.85rem;">Click or drag PDF here to upload</p>
                    <input type="file" id="pdfLibraryInput" accept=".pdf" style="display:none;">
                </div>

                <!-- PDF List -->
                <div style="flex:1; overflow-y:auto; padding:0 16px 16px;">
                    <div id="pdfLibraryList"></div>
                </div>

                <!-- Footer -->
                <div style="padding:16px; border-top:1px solid var(--border); display:flex; gap:12px;">
                    <button id="pdfLibraryCancel" class="btn" style="flex:1; justify-content:center;">
                        Cancel
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modal = modal;
        this.bindModalEvents();
    },

    /**
     * Bind modal event handlers
     */
    bindModalEvents() {
        const modal = this.modal;
        if (!modal) return;

        // Close buttons
        modal.querySelector('#pdfLibraryClose').onclick = () => this.hide();
        modal.querySelector('#pdfLibraryCancel').onclick = () => this.hide();

        // Click outside to close
        modal.onclick = (e) => {
            if (e.target === modal) this.hide();
        };

        // Dropzone
        const dropzone = modal.querySelector('#pdfLibraryDropzone');
        const input = modal.querySelector('#pdfLibraryInput');

        dropzone.onclick = () => input.click();

        dropzone.ondragover = (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'var(--primary)';
            dropzone.style.background = 'rgba(59, 130, 246, 0.1)';
        };

        dropzone.ondragleave = () => {
            dropzone.style.borderColor = '#333';
            dropzone.style.background = 'transparent';
        };

        dropzone.ondrop = async (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '#333';
            dropzone.style.background = 'transparent';

            const file = e.dataTransfer.files[0];
            if (file) await this.handleUpload(file);
        };

        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) await this.handleUpload(file);
            input.value = '';
        };
    },

    /**
     * Handle file upload
     */
    async handleUpload(file) {
        try {
            await this.upload(file);
            await this.refreshList();
        } catch (err) {
            if (window.UI?.showToast) window.UI.showToast('Upload failed: ' + err.message);
        }
    },

    /**
     * Refresh the PDF list
     */
    async refreshList() {
        const container = document.getElementById('pdfLibraryList');
        if (!container) return;

        const pdfs = await this.getAll();

        if (pdfs.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:40px; color:#666;">
                    <i class="bi bi-file-earmark-pdf" style="font-size:3rem; opacity:0.3;"></i>
                    <p style="margin-top:12px;">No PDFs in library</p>
                </div>
            `;
            return;
        }

        container.innerHTML = '';

        pdfs.forEach(pdf => {
            const date = new Date(pdf.timestamp).toLocaleDateString();
            const item = document.createElement('div');
            item.className = 'bm-item';
            item.style.cssText = 'display:flex; align-items:center; gap:12px; padding:14px; margin-bottom:8px; cursor:pointer;';

            item.innerHTML = `
                <i class="bi bi-file-earmark-pdf" style="font-size:1.5rem; color:#ef4444;"></i>
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${pdf.name}</div>
                    <div style="font-size:0.75rem; color:#666;">${this.formatSize(pdf.size)} &bull; ${date}</div>
                </div>
                <button class="pdf-delete-btn bm-del" data-id="${pdf.id}" title="Delete" style="opacity:0.5;">
                    <i class="bi bi-trash3"></i>
                </button>
            `;

            // Select PDF
            item.onclick = (e) => {
                if (e.target.closest('.pdf-delete-btn')) return;
                this.selectPdf(pdf);
            };

            // Delete button
            item.querySelector('.pdf-delete-btn').onclick = async (e) => {
                e.stopPropagation();
                const confirmed = window.UI?.showConfirm
                    ? await window.UI.showConfirm('Delete PDF', `Delete "${pdf.name}"?`)
                    : confirm(`Delete "${pdf.name}"?`);
                if (confirmed) {
                    await this.delete(pdf.id);
                    await this.refreshList();
                }
            };

            container.appendChild(item);
        });
    },

    /**
     * Handle PDF selection
     */
    selectPdf(pdf) {
        this.hide();
        if (this.onSelect) {
            this.onSelect(pdf);
        }
    },

    /**
     * Show the library modal
     * @param {Function} callback - Called with selected PDF entry
     */
    async show(callback) {
        this.createModal();
        this.onSelect = callback;

        if (this.modal) {
            this.modal.style.display = 'flex';
            await this.refreshList();
        }
    },

    /**
     * Hide the library modal
     */
    hide() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
    }
};

// Auto-initialize
PDFLibrary.init().catch(console.error);
