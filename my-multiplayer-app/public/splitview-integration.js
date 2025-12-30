/**
 * Split View Integration with Main App (V2)
 * Adds methods to App object for true 50-50 split view
 */

// Function to add split view methods to App
function addSplitViewMethods() {
  // Ensure App exists
  if (!window.App) {
    window.App = {};
  }

  // Add toggle method
  window.App.toggleSplitView = function() {
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
}

// Initialize with retries
let retries = 0;
const maxRetries = 50;

function initializeWithRetry() {
  if (typeof window.App !== 'undefined' && window.App && typeof window.App.toggleSplitView === 'undefined') {
    addSplitViewMethods();
    console.log('Split View V2 Integration loaded successfully');
  } else if (retries < maxRetries) {
    retries++;
    setTimeout(initializeWithRetry, 100);
  } else {
    if (!window.App) {
      window.App = {};
    }
    addSplitViewMethods();
    console.log('Split View V2 Integration loaded with fallback');
  }
}

// Start initialization
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeWithRetry);
} else {
  initializeWithRetry();
}

// Also add a window load listener as final fallback
window.addEventListener('load', () => {
  if (!window.App || typeof window.App.toggleSplitView === 'undefined') {
    addSplitViewMethods();
  }
});
