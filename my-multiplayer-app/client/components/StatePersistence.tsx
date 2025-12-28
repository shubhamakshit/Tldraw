import { useEffect } from 'react'
import { useEditor } from 'tldraw'

export function StatePersistence({ roomId }: { roomId: string }) {
    const editor = useEditor()
    
    useEffect(() => {
        if (!editor) return
        
        // 1. Load Global Preferences
        const globalPrefsStr = localStorage.getItem('tldraw_global_prefs')
        if (globalPrefsStr) {
            try { 
                const prefs = JSON.parse(globalPrefsStr)
                editor.user.updateUserPreferences(prefs) 
            } catch (e) { 
                console.error('Failed to load preferences:', e) 
            }
        }
        
        // 2. Load Room State (Camera, Grid, etc.)
        const roomStateKey = `tldraw_room_state_${roomId}`
        const savedRoomState = localStorage.getItem(roomStateKey)
        
        if (savedRoomState) {
            try {
                const state = JSON.parse(savedRoomState)
                
                // Restore Page
                if (state.pageId && editor.getPage(state.pageId)) {
                    editor.setCurrentPage(state.pageId)
                }
                
                // Restore Camera
                if (state.camera) {
                    editor.setCamera(state.camera)
                }
                
                // Restore Instance State (safely)
                // We construct a clean object containing only defined booleans
                const newInstanceState: any = {}
                
                if (typeof state.isGridMode === 'boolean') newInstanceState.isGridMode = state.isGridMode
                if (typeof state.isFocusMode === 'boolean') newInstanceState.isFocusMode = state.isFocusMode
                if (typeof state.isDebugMode === 'boolean') newInstanceState.isDebugMode = state.isDebugMode
                if (typeof state.isToolLocked === 'boolean') newInstanceState.isToolLocked = state.isToolLocked
                if (typeof state.exportBackground === 'boolean') newInstanceState.exportBackground = state.exportBackground

                // Only update if we have keys to update
                if (Object.keys(newInstanceState).length > 0) {
                    editor.updateInstanceState(newInstanceState)
                }

            } catch (e) { 
                console.error('Failed to load room state:', e) 
                // Optional: Clear bad state so it doesn't crash next time
                // localStorage.removeItem(roomStateKey) 
            }
        }
        
        // 3. Setup Listeners to Save State
        const cleanupUser = editor.store.listen(() => {
            localStorage.setItem('tldraw_global_prefs', JSON.stringify(editor.user.getUserPreferences()))
        })
        
        const cleanupRoom = editor.store.listen(() => {
            // We debounce this slightly or just save on every change (tldraw store is fast)
            // But we must be careful to check if editor is still mounted/valid inside callbacks if needed
            try {
                const { x, y, z } = editor.getCamera()
                const instanceState = editor.getInstanceState()
                
                const stateToSave = {
                    camera: { x, y, z },
                    pageId: editor.getCurrentPageId(),
                    isGridMode: instanceState.isGridMode,
                    isFocusMode: instanceState.isFocusMode,
                    isDebugMode: instanceState.isDebugMode,
                    isToolLocked: instanceState.isToolLocked,
                    exportBackground: instanceState.exportBackground
                }
                
                localStorage.setItem(roomStateKey, JSON.stringify(stateToSave))
            } catch (e) {
                // Ignore errors during save (e.g. quota exceeded)
            }
        })
        
        return () => {
            cleanupUser()
            cleanupRoom()
        }
    }, [editor, roomId])
    
    return null
}