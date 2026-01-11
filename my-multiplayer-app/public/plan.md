# ColorRM Refactoring Plan

## Overview
This plan identifies redundant code patterns across the ColorRM modules and proposes consolidation strategies while preserving all existing functionality.

**STATUS: IMPLEMENTED** (2026-01-11)

---

## 1. Page Management Consolidation (ColorRmSession.js) [DONE]

### Problem
Three methods contain nearly identical logic:
- `addBlankPage()` (lines 855-980)
- `addImageAsPage()` (lines 982-1094)
- `addTemplatePage()` (lines 1446-1596)

### Redundant Pattern (repeated 3x)
```javascript
// Update all existing pages that come after the insertion point
for (let i = newPageIndex; i < this.state.images.length; i++) {
    this.state.images[i].pageIndex = i + 1;
    this.state.images[i].id = `${this.state.sessionId}_${i + 1}`;
    await this.dbPut('pages', this.state.images[i]);
}

// Insert the new page at the correct position
this.state.images.splice(newPageIndex, 0, pageObj);
await this.dbPut('pages', pageObj);

// Update UI
if (this.state.activeSideTab === 'pages') this.renderPageSidebar();
const pt = this.getElement('pageTotal');
if (pt) pt.innerText = '/ ' + this.state.images.length;

// Navigate or update index logic...

// Update session metadata
const session = await this.dbGet('sessions', this.state.sessionId);
if (session) {
    session.pageCount = this.state.images.length;
    session.idx = this.state.idx;
    await this.dbPut('sessions', session);
    if (this.registry) this.registry.upsert(session);
}

// Upload to backend if collaborative
if (this.config.collaborative && this.state.ownerId) {
    // fetch call...
}

// Liveblocks sync
if (this.liveSync) {
    this.liveSync.updatePageCount(this.state.images.length);
    this.liveSync.notifyPageStructureChange();
}

// Update canvas dimensions
const displayCanvas = this.getElement('canvas');
if (displayCanvas) {
    displayCanvas.width = width;
    displayCanvas.height = height;
    this.state.viewW = width;
    this.state.viewH = height;
}
```

### Solution: Extract Helper Functions

#### A. `_insertPageAtIndex(pageObj, newPageIndex)`
Handles:
- Shifting existing page indices
- Inserting new page into state array
- Persisting to IndexedDB
- Updating UI (sidebar, page total)

#### B. `_updateSessionAfterPageChange(navigateToPage = null)`
Handles:
- Updating session metadata (pageCount, idx)
- Syncing to registry
- Notifying Liveblocks

#### C. `_uploadPageToBackend(pageIndex, blob)`
Handles:
- Collaborative mode check
- Fetch POST to `/api/color_rm/page_upload/...`
- Error handling and toast notifications

#### D. `_updateCanvasDimensions(width, height)`
Handles:
- Setting canvas width/height
- Updating state.viewW/viewH

### Refactored Pattern
```javascript
async addBlankPage(width = 2000, height = 1500, insertAtCurrent = false) {
    const bgColor = document.getElementById('blankPageColor')?.value || '#ffffff';
    const blob = await this._createBlankCanvasBlob(width, height, bgColor);
    const newPageIndex = insertAtCurrent ? this.state.idx + 1 : this.state.images.length;

    const pageObj = this._createPageObject(newPageIndex, blob);
    await this._insertPageAtIndex(pageObj, newPageIndex);

    if (insertAtCurrent) {
        await this.loadPage(newPageIndex);
    } else {
        this._adjustCurrentIndexAfterInsert(newPageIndex);
    }

    await this._updateSessionAfterPageChange();
    await this._uploadPageToBackend(newPageIndex, blob);
    this._updateCanvasDimensions(width, height);

    this.ui.showToast(`Added blank page ${newPageIndex + 1}`);
}
```

---

## 2. Liveblocks Sync Pattern Consolidation [DONE]

### Problem
The following pattern appears 8+ times across ColorRmSession.js:
```javascript
if (this.liveSync) {
    this.liveSync.updatePageCount(this.state.images.length);
    this.liveSync.notifyPageStructureChange();
}
```

### Locations
- `addBlankPage()` - lines 943-966
- `addImageAsPage()` - lines 1075-1081
- `addTemplatePage()` - lines 1577-1583
- `deleteCurrentPage()` - lines 1163-1167
- `reorderPages()` - lines 1723-1728

### Solution: `_syncPageStructureToLive()`
```javascript
_syncPageStructureToLive() {
    if (!this.liveSync) return;
    this.liveSync.updatePageCount(this.state.images.length);
    this.liveSync.notifyPageStructureChange();
}
```

---

## 3. Canvas Dimension Update Consolidation [DONE]

### Problem
The following pattern appears 6+ times:
```javascript
const displayCanvas = this.getElement('canvas');
if (displayCanvas) {
    displayCanvas.width = width;
    displayCanvas.height = height;
    this.state.viewW = width;
    this.state.viewH = height;
}
```

### Locations
- `addBlankPage()` - lines 972-979
- `addImageAsPage()` - lines 1084-1091
- `resizeCurrentPage()` - lines 1263-1271
- `applyPageSizeToAll()` - lines 1430-1438
- `addTemplatePage()` - lines 1585-1593

### Solution: `_setCanvasDimensions(width, height)`
```javascript
_setCanvasDimensions(width, height) {
    const displayCanvas = this.getElement('canvas');
    if (displayCanvas) {
        displayCanvas.width = width;
        displayCanvas.height = height;
    }
    this.state.viewW = width;
    this.state.viewH = height;
}
```

---

## 4. Session Metadata Update Consolidation [DONE]

### Problem
The following pattern appears 5+ times:
```javascript
const session = await this.dbGet('sessions', this.state.sessionId);
if (session) {
    session.pageCount = this.state.images.length;
    session.idx = this.state.idx;
    await this.dbPut('sessions', session);
    if (this.registry) this.registry.upsert(session);
}
```

### Solution: `_persistSessionMetadata(extraFields = {})`
```javascript
async _persistSessionMetadata(extraFields = {}) {
    const session = await this.dbGet('sessions', this.state.sessionId);
    if (!session) return;

    session.pageCount = this.state.images.length;
    session.idx = this.state.idx;
    session.lastMod = Date.now();
    Object.assign(session, extraFields);

    await this.dbPut('sessions', session);
    if (this.registry) this.registry.upsert(session);
}
```

---

## 5. Page Upload Pattern Consolidation [DONE]

### Problem
Similar fetch calls for page upload appear 3 times:
```javascript
const uploadRes = await fetch(
    window.Config?.apiUrl(`/api/color_rm/page_upload/${this.state.sessionId}/${pageIndex}`)
    || `/api/color_rm/page_upload/${this.state.sessionId}/${pageIndex}`,
    {
        method: 'POST',
        body: blob,
        headers: {
            'Content-Type': 'image/jpeg',
            'x-project-name': encodeURIComponent(this.state.projectName)
        }
    }
);
```

### Solution: `_uploadPageBlob(pageIndex, blob)`
```javascript
async _uploadPageBlob(pageIndex, blob) {
    if (!this.config.collaborative || !this.state.ownerId) return false;

    try {
        const url = window.Config?.apiUrl(`/api/color_rm/page_upload/${this.state.sessionId}/${pageIndex}`)
                 || `/api/color_rm/page_upload/${this.state.sessionId}/${pageIndex}`;

        const res = await fetch(url, {
            method: 'POST',
            body: blob,
            headers: {
                'Content-Type': blob.type || 'image/jpeg',
                'x-project-name': encodeURIComponent(this.state.projectName)
            }
        });

        if (!res.ok) {
            console.error('Page upload failed:', await res.text());
            return false;
        }
        return true;
    } catch (err) {
        console.error('Error uploading page:', err);
        return false;
    }
}
```

---

## 6. Page Object Creation Consolidation [DONE]

### Problem
Page object structure repeated 5+ times:
```javascript
const pageObj = {
    id: `${this.state.sessionId}_${pageIndex}`,
    sessionId: this.state.sessionId,
    pageIndex: pageIndex,
    blob: blob,
    history: []
};
```

### Solution: `_createPageObject(pageIndex, blob)`
```javascript
_createPageObject(pageIndex, blob) {
    return {
        id: `${this.state.sessionId}_${pageIndex}`,
        sessionId: this.state.sessionId,
        pageIndex: pageIndex,
        blob: blob,
        history: []
    };
}
```

---

## 7. History Drawing Consolidation (ColorRmSession.js + ColorRmExport.js) [SKIPPED]

### Problem
`drawHistoryOntoCanvas()` in ColorRmSession.js (lines 1280-1364) and export drawing logic in ColorRmExport.js (lines 144-159) share similar rendering code.

### Decision
SKIPPED - The two implementations serve different purposes (resize uses scaling, export uses 1:1). The abstraction cost outweighs the benefit for ~15 lines of similar code.

---

## 8. UI Page List Update Pattern [DONE]

### Problem
The following pattern appears 4+ times:
```javascript
if (this.state.activeSideTab === 'pages') this.renderPageSidebar();
const pt = this.getElement('pageTotal');
if (pt) pt.innerText = '/ ' + this.state.images.length;
```

### Solution: `_refreshPageUI()`
```javascript
_refreshPageUI() {
    if (this.state.activeSideTab === 'pages') this.renderPageSidebar();
    const pt = this.getElement('pageTotal');
    if (pt) pt.innerText = '/ ' + this.state.images.length;
    const pageInput = this.getElement('pageInput');
    if (pageInput) pageInput.value = this.state.idx + 1;
}
```

---

## 9. Modal Creation Pattern (ColorRmSession.js) [DEFERRED]

### Problem
`reorderPages()` creates modal HTML inline (lines 1599-1616). Similar patterns may exist elsewhere.

### Decision
DEFERRED - Only one occurrence found. Not worth abstracting for a single use case.

---

## 10. Index Adjustment After Insert Pattern [DONE]

### Problem
After inserting a page, index adjustment logic is repeated:
```javascript
if (insertAtCurrent) {
    await this.loadPage(newPageIndex);
} else {
    if (this.state.idx >= newPageIndex) {
        this.state.idx++;
    }
    const pageInput = this.getElement('pageInput');
    if (pageInput) pageInput.value = this.state.idx + 1;
}
```

### Solution: `_handlePostInsertNavigation(newPageIndex, navigateToNew)`
```javascript
async _handlePostInsertNavigation(newPageIndex, navigateToNew) {
    if (navigateToNew) {
        await this.loadPage(newPageIndex);
    } else if (this.state.idx >= newPageIndex) {
        this.state.idx++;
        const pageInput = this.getElement('pageInput');
        if (pageInput) pageInput.value = this.state.idx + 1;
    }
}
```

---

## Implementation Order

1. **Phase 1 - Core Helpers** (Low risk) [COMPLETED]
   - `_createPageObject()`
   - `_setCanvasDimensions()`
   - `_syncPageStructureToLive()`
   - `_refreshPageUI()`

2. **Phase 2 - Storage Helpers** (Medium risk) [COMPLETED]
   - `_persistSessionMetadata()`
   - `_uploadPageBlob()`

3. **Phase 3 - Complex Helpers** (Higher risk) [COMPLETED]
   - `_insertPageAtIndex()`
   - `_handlePostInsertNavigation()`
   - `_createBlankCanvasBlob()` (bonus helper added)

4. **Phase 4 - Apply to Methods** [COMPLETED]
   - Refactor `addBlankPage()` - reduced ~125 lines to ~38 lines
   - Refactor `addImageAsPage()` - reduced ~113 lines to ~46 lines
   - Refactor `addTemplatePage()` - reduced ~150 lines to ~91 lines
   - Refactor `deleteCurrentPage()` - reduced ~68 lines to ~55 lines
   - Refactor `resizeCurrentPage()` - consolidated canvas updates
   - Refactor `applyPageSizeToAll()` - consolidated canvas updates
   - Refactor `reorderPages()` - consolidated Liveblocks sync

5. **Phase 5 - Cross-module Consolidation** [SKIPPED]
   - Shared history rendering helper - minimal benefit, different use cases

---

## Actual Line Changes

| Module | Before | After | Change |
|--------|--------|-------|--------|
| ColorRmSession.js | 1749 | ~1520 | ~229 lines removed (~13%) |

**Helpers Added:** 9 new helper functions (~70 lines)
**Net Reduction:** ~159 lines with significantly improved maintainability

---

## Testing Checklist

After each phase, verify:
- [x] Adding blank page works (append & insert modes)
- [x] Adding image as page works
- [x] Adding template pages works (graph, lined, white)
- [x] Deleting pages works
- [x] Resizing pages works
- [x] Page reordering works
- [x] PDF export includes all history/drawings
- [x] Liveblocks sync notifies collaborators
- [x] Session metadata persists across reload
- [x] Collaborative upload succeeds
- [x] Canvas dimensions update correctly

---

## Notes

- All helper methods should be prefixed with `_` to indicate internal use
- Helpers should be added to ColorRmSession.js (not a separate module) to maintain `this` context
- Each helper should be self-contained and testable
- No behavioral changes - only structural consolidation
