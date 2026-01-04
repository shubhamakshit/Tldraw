import { ColorRmApp } from './ColorRmApp.js';
import { UI } from './UI.js';
import { Registry } from './Registry.js';
import { LiveSyncClient } from './LiveSync.js';
import { CommonPdfImport } from './CommonPdfImport.js';
import { SplitView } from './SplitView.js';
import { PDFLibrary } from './PDFLibrary.js';
import { Config } from './config.js';

// Expose globals for compatibility and debugging
window.UI = UI;
window.Registry = Registry;
window.CommonPdfImport = CommonPdfImport;
window.PDFLibrary = PDFLibrary;
window.Config = Config;

// Initialize the main application instance
const app = new ColorRmApp({ isMain: true });

// Register app with Registry for proper instance binding
Registry.setApp(app);

// Add SplitView integration
app.toggleSplitView = function() {
    SplitView.toggle();
    const btn = document.getElementById('splitViewToggle');
    if (btn) {
        if (SplitView.isEnabled) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    }
};

window.App = app;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Initializing ColorRM ESM...");

    // Initialize common modules
    CommonPdfImport.init(app);
    await SplitView.init();

    // Initialize App with dependencies
    // Note: LiveSyncClient class is passed, App will instantiate it
    await app.init(UI, Registry, LiveSyncClient);

    // Expose LiveSync for debugging
    window.LiveSync = app.liveSync;

    console.log("ColorRM Initialized.");
});
