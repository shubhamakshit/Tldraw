import { useEffect, useMemo } from 'react'
import { useEditor } from 'tldraw'
import debounce from 'lodash.debounce'

export function StatePersistence({ roomId }: { roomId: string }) {
    const editor = useEditor()
    
    // Create a debounced save function that persists across renders
    const saveRoomState = useMemo(() => debounce((editorInstance: any, key: string) => {
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
            
            // Use requestIdleCallback for non-critical writes if available
            if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(() => {
                    try {
                        localStorage.setItem(key, JSON.stringify(stateToSave))
                    } catch (e) {
                        console.warn('localStorage quota exceeded:', e)
                    }
                }, { timeout: 2000 })
            } else {
                // Fallback for environments without requestIdleCallback
                setTimeout(() => {
                     try {
                        localStorage.setItem(key, JSON.stringify(stateToSave))
                    } catch (e) {
                        console.warn('localStorage quota exceeded:', e)
                    }
                }, 0)
            }
        } catch (e) {
            // Ignore errors
        }
    }, 2000), []) // Debounce for 2 seconds

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
            // Optimization: Defer user pref save
             if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(() => {
                     localStorage.setItem('tldraw_global_prefs', JSON.stringify(editor.user.getUserPreferences()))
                }, { timeout: 2000 })
             } else {
                 setTimeout(() => {
                    localStorage.setItem('tldraw_global_prefs', JSON.stringify(editor.user.getUserPreferences()))
                 }, 0)
             }
        })
        
        const cleanupRoom = editor.store.listen((change) => {
             // Optimization: Only save if relevant fields changed
            // Using 'any' cast to avoid TS errors with strict typing of changes
            const changes = (change as any).changes;
            if (changes && (changes.camera || changes.page || changes.instance_page_state)) {
                saveRoomState(editor, roomStateKey)
            } else if (!changes) {
                 // Fallback if changes object isn't as expected, but event fired
                 saveRoomState(editor, roomStateKey);
            }
        }, {
            scope: 'document',
        })
        
        return () => {
            cleanupUser()
            cleanupRoom()
            saveRoomState.cancel()
        }
    }, [editor, roomId, saveRoomState])
    
    return null
}