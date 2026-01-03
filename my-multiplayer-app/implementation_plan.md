# Implementation Plan: Enhanced Naming, Auth, and Cloud Backup

## Phase 1: Smart Board Naming
**Goal:** Replace "Untitled Board" with user-friendly, generated names (e.g., "Cosmic-Meadow", "Azure-Sky").

1.  **Name Generator Utility (`client/utils/nameGenerator.ts`)**
    *   Implement a function `generateBoardName()`.
    *   **Primary:** Fetch from a free API (e.g., `https://random-word-api.herokuapp.com/` or similar).
    *   **Fallback:** Use a local list of Adjectives + Nouns to ensure reliability if the API fails or is slow.
    *   Format: `Adjective-Noun` (Title Case).

2.  **Lobby Integration (`client/pages/Lobby.tsx`)**
    *   Update the "New Board" button handler.
    *   Call `generateBoardName()` before creating the room.
    *   Pass this name to the room creation logic.

3.  **Storage Update (`client/pages/storageUtils.ts`)**
    *   Ensure the generated name is saved to `tldraw_saved_rooms` in localStorage immediately upon creation.

## Phase 2: Simple Authentication
**Goal:** Allow users to create accounts to own their backups.
*Note: Using Cloudflare KV for user storage is recommended for performance and simplicity.*

1.  **Infrastructure (`wrangler.toml`)**
    *   Add a KV Namespace: `TLDRAW_USERS_KV`.
    *   (Alternative if KV not allowed: Store user profiles as JSON objects in the existing R2 bucket under `users/`). *We will plan for KV as it's standard.*

2.  **Worker API (`worker/src/worker.ts`)**
    *   **`POST /api/auth/register`**:
        *   Input: `{ username, password }`.
        *   Check if user exists.
        *   Hash password (using `crypto.subtle` or simple salt+hash if dependencies restricted).
        *   Store in KV/R2.
    *   **`POST /api/auth/login`**:
        *   Input: `{ username, password }`.
        *   Verify hash.
        *   Generate a simple session token (UUID).
        *   Store token in KV with expiration (TTL).
        *   Return `{ token, username }`.
    *   **Middleware**: Create `withAuth` function to validate tokens for protected routes.

3.  **Frontend Auth (`client/components/Auth`)**
    *   Create `LoginModal.tsx` and `RegisterModal.tsx`.
    *   Add `useAuth` hook to manage `user` state and `token` in `localStorage`.
    *   Add "Login/Signup" button to the Lobby and Editor top bar.

## Phase 3: Cloud Backup & Restore
**Goal:** Save local board state to the server and restore it later.

1.  **Backend Endpoints (`worker/src/worker.ts`)**
    *   **`POST /api/backup`** (Protected):
        *   Input: `{ snapshot, roomName, roomId }`.
        *   Save to R2: `backups/{username}/{timestamp}_{roomName}.json`.
    *   **`GET /api/backups`** (Protected):
        *   List files in R2 prefix `backups/{username}/`.
        *   Return list of `{ id, name, date }`.
    *   **`GET /api/backup/:key`** (Protected):
        *   Fetch specific JSON from R2.

2.  **Frontend Integration**
    *   **Backup Action:**
        *   In `client/overrides.ts` or `SettingsMenu`, add "Backup to Cloud".
        *   Function: `editor.store.getSnapshot()`, then POST to API.
    *   **Restore UI (Lobby):**
        *   Add "Cloud Saves" tab in the Lobby.
        *   List user's backups.
        *   "Restore" button: Fetches JSON -> Creates new Room -> Loads snapshot -> Navigates to room.

## Phase 4: Color RM Strategy
**Goal:** Handle the specific "Color RM" app mode.
*   **Observation:** Color RM seems to use a distinct Durable Object (`ColorRmDurableObject`).
*   **Strategy:**
    *   Reuse the same Auth system.
    *   When backing up, tag the metadata with `type: 'color-rm'`.
    *   When restoring, ensure it routes to the correct Durable Object path (`/api/color_rm/...`).

## Execution Order
1.  Implement Board Naming (Client-side, low risk).
2.  Setup KV/R2 and Auth API (Backend).
3.  Implement Frontend Auth UI.
4.  Implement Backup/Restore logic.
