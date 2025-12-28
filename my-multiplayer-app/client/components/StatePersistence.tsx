import { useEffect } from 'react'
import { useEditor } from 'tldraw'

export function StatePersistence({ roomId }: { roomId: string }) {
    const editor = useEditor()
    
    useEffect(() => {
        if (!editor) return
        
        // Load Global Prefs
        const globalPrefsStr = localStorage.getItem('tldraw_global_prefs')
        if (globalPrefsStr) {
            try { 
                editor.user.updateUserPreferences(JSON.parse(globalPrefsStr)) 
            } catch (e) { console.error(e) }
        }
        
        // Load Room State
        const roomStateKey = `tldraw_room_state_${roomId}`
        const savedRoomState = localStorage.getItem(roomStateKey)
        if (savedRoomState) {
            try {
                const state = JSON.parse(savedRoomState)
                if (state.pageId && editor.getPage(state.pageId)) editor.setCurrentPage(state.pageId)
                if (state.camera) editor.setCamera(state.camera)
                editor.updateInstanceState({
                    isGridMode: state.isGridMode,
                    isFocusMode: state.isFocusMode,
                    isDebugMode: state.isDebugMode,
                    isToolLocked: state.isToolLocked,
                    exportBackground: state.exportBackground,
                })
            } catch (e) { console.error(e) }
        }
        
        // Listeners
        const cleanupUser = editor.store.listen(() => {
            localStorage.setItem('tldraw_global_prefs', JSON.stringify(editor.user.getUserPreferences()))
        })
        
        const cleanupRoom = editor.store.listen(() => {
            const { x, y, z } = editor.getCamera()
            const instanceState = editor.getInstanceState()
            localStorage.setItem(roomStateKey, JSON.stringify({
                camera: { x, y, z },
                pageId: editor.getCurrentPageId(),
                isGridMode: instanceState.isGridMode,
                // ... add other state props as needed
            }))
        })
        
        return () => {
            cleanupUser()
            cleanupRoom()
        }
    }, [editor, roomId])
    
    return null
}