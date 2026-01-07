# Plan: Fix Paste Detection for "Text" Files

The user is experiencing an issue where pasting a file results in `kind=string, type=text/plain` debug logs, meaning the browser is receiving a path or URI instead of the file blob. This is common with certain OS/Browser combinations or remote desktop setups.

## 1. Diagnose and Inform
**Goal**: Identify when the user is trying to paste a file path and explain why it failed, or try to recover if possible (e.g., if it's a URL).

- **Modify `ColorRmUI.js` global paste listener**:
    - Iterate through `e.clipboardData.items`.
    - If `kind === 'string'`, use `item.getAsString()` to inspect the content.
    - Check if the string looks like a local file path (e.g., starts with `/`, `C:\`, `file://`) or a URL.
    - **Action**:
        - If it's a **local path**: Show a specific Toast/Alert: "Browsers cannot read local files from paths due to security. Please Drag & Drop the file or use the Import button." and **automatically open the file picker**.
        - If it's a **web URL** (http/https) ending in `.pdf` or image extensions: Attempt to fetch and import it automatically (using `fetch(url).then(blob => ...)`).

## 2. Fallback to Async Clipboard API
The synchronous `paste` event `clipboardData` is sometimes more restricted than the async `navigator.clipboard.read()` API.

- **Modify `ColorRmUI.js` global paste listener**:
    - If no files are found in `e.clipboardData.files` or `items`, **attempt to call `navigator.clipboard.read()`**.
    - This might prompt the user for permission, but it could access the file object that the synchronous event missed.
    - This essentially brings the "Smart Import" logic from the button into the global Ctrl+V handler.

## 3. Execution Steps
1.  Edit `public/scripts/modules/ColorRmUI.js`.
2.  Update the `document.addEventListener('paste', ...)` block.
3.  Add logic to handle string items and detect paths/URLs.
4.  Add a fallback to `navigator.clipboard.read()` if the event data is empty/text-only but might contain files.
