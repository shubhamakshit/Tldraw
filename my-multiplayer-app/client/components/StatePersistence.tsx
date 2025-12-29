import { useEffect, useMemo } from 'react'
import { useEditor } from 'tldraw'
import throttle from 'lodash.throttle'

export function StatePersistence({ roomId }: { roomId: string }) {
    const editor = useEditor()
    
    // Create a throttled save function that persists across renders
    const saveRoomState = useMemo(() => throttle((editorInstance: any, key: string) => {
        try {
            const { x, y, z } = editorInstance.getCamera()
            const instanceState = editorInstance.getInstanceState()
            
            const stateToSave = {
                camera: { x, y, z },
                pageId: editorInstance.getCurrentPageId(),
                isGridMode: instanceState.isGridMode,
                isFocusMode: instanceState.isFocusMode,
                isDebugMode: instanceState.isDebugMode,
                isToolLocked: instanceState.isToolLocked,
                exportBackground: instanceState.exportBackground
            }
            
            localStorage.setItem(key, JSON.stringify(stateToSave))
        } catch (e) {
            // Ignore errors
        }
    }, 1000), [])

    useEffect(() => {
        if (!editor) return
        
        // 1. Load Global Preferences & Sanitize
        const globalPrefsStr = localStorage.getItem('tldraw_global_prefs')
        if (globalPrefsStr) {
            try {
                const savedPrefs = JSON.parse(globalPrefsStr)
                const sanitizedPrefs: any = {}

                // Get the default preferences to know what keys are valid
                const defaultPrefs = editor.user.getUserPreferences()

                // This is a migration: if the old isDarkMode property is present,
                // we want to convert it to the new `colorScheme` property.
                if (typeof savedPrefs.isDarkMode === 'boolean') {
                    savedPrefs.colorScheme = savedPrefs.isDarkMode ? 'dark' : 'light'
                    delete savedPrefs.isDarkMode
                }

                // Only copy over the keys that are present in the default preferences
                for (const key in defaultPrefs) {
                    if (key in savedPrefs) {
                        sanitizedPrefs[key] = savedPrefs[key]
                    }
                }

                editor.user.updateUserPreferences(sanitizedPrefs)
            } catch (e) {
                console.error('Failed to load and apply preferences:', e)
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
            }
        }
        
        // 3. Setup Listeners to Save State
        const cleanupUser = editor.store.listen(() => {
            localStorage.setItem('tldraw_global_prefs', JSON.stringify(editor.user.getUserPreferences()))
        })
        
        const cleanupRoom = editor.store.listen(() => {
            saveRoomState(editor, roomStateKey)
        })
        
        return () => {
            cleanupUser()
            cleanupRoom()
            saveRoomState.cancel()
        }
    }, [editor, roomId, saveRoomState])
    
    return null
}