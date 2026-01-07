import { PDFLibrary } from './PDFLibrary.js';

/**
 * CommonPdfImport - Bridge between PDFLibrary and ColorRM apps
 * Handles PDF selection/import for both main and split view apps
 */
export const CommonPdfImport = {
    target: null, // 'main' | 'split'
    app: null,
    splitViewApp: null,

    /**
     * Show PDF library for target app
     * @param {'main'|'split'} target - Which app to import into
     */
    showLibrary(target = 'main') {
        this.target = target;

        PDFLibrary.show(async (pdf) => {
            await this.importPdf(pdf);
        });
    },

    /**
     * Import selected PDF into target app
     */
    async importPdf(pdf) {
        if (!pdf || !pdf.blob) {
            console.error('CommonPdfImport: Invalid PDF entry');
            return;
        }

        // Create a File object from the blob for handleImport
        const file = new File([pdf.blob], pdf.name + '.pdf', { type: 'application/pdf' });

        if (this.target === 'split') {
            // Import into split view
            const splitApp = this.splitViewApp || window.SplitView?.app;
            if (splitApp) {
                await this.importIntoApp(splitApp, file, pdf.name);
            } else {
                console.warn('CommonPdfImport: Split view app not available');
                if (window.UI?.showToast) window.UI.showToast('Split View is not ready');
            }
        } else {
            // Import into main app
            const mainApp = this.app || window.App;
            if (mainApp && mainApp.handleImport) {
                await mainApp.handleImport({ target: { files: [file] } }, false);
            } else {
                console.warn('CommonPdfImport: Main app not available');
                if (window.UI?.showToast) window.UI.showToast('Main app is not ready');
            }
        }
    },

    /**
     * Import PDF into a specific ColorRmApp instance
     */
    async importIntoApp(app, file, name) {
        if (!app) return;

        try {
            // Create a new session for this PDF
            const projectId = `sv_${Date.now()}`;

            // Create session in app's database
            await app.dbPut('sessions', {
                id: projectId,
                name: name,
                pageCount: 0,
                lastMod: Date.now(),
                ownerId: 'local',
                idx: 0,
                bookmarks: [],
                clipboardBox: [],
                state: null
            });

            // Set as current session
            app.state.sessionId = projectId;
            app.state.projectName = name;

            // Import the PDF
            await app.importBaseFile(file);

            // Fix: Save metadata to SplitView's project list so it appears in "Local Projects"
            if (window.SplitView && window.SplitView.app === app) {
                await window.SplitView.saveProjectMeta(projectId, name);
                console.log('CommonPdfImport: Saved to SplitView project list');
            }

            console.log('CommonPdfImport: Imported into app:', name);
        } catch (error) {
            console.error('CommonPdfImport: Import failed:', error);
            if (window.UI?.showToast) window.UI.showToast('Import failed: ' + error.message);
        }
    },

    /**
     * Initialize with app references
     */
    init(mainApp) {
        if (mainApp) {
            this.app = mainApp;
        }
        window.CommonPdfImport = this;
        window.PDFLibrary = PDFLibrary;
    },

    /**
     * Set split view app reference
     */
    setSplitViewApp(app) {
        this.splitViewApp = app;
    },

    // Legacy methods for backwards compatibility
    show() {
        this.showLibrary('main');
    },

    pick(target) {
        this.showLibrary(target);
    }
};
