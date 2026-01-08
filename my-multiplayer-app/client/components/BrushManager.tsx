import { useEffect } from 'react'
import { useEditor, react } from 'tldraw'
import { toolBrushStylesAtom } from '../utils/brushUtils'

// Helper: Fast shallow comparison to avoid JSON.stringify
function stylesEqual(a: any, b: any): boolean {
    if (a === b) return true
    if (!a || !b) return false

    const keysA = Object.keys(a)
    const keysB = Object.keys(b)

    if (keysA.length !== keysB.length) return false

    for (const key of keysA) {
        if (a[key] !== b[key]) return false
    }

    return true
}

// Helper: Shallow clone
function cloneStyles(styles: any): any {
    return { ...styles }
}

export function BrushManager() {
    const editor = useEditor()

    // Tools that should have completely independent styles
    const DRAWING_TOOLS = ['draw', 'highlight']

    // 1. Capture tools' brushes ONLY when user actively changes them (not on tool switch)
    useEffect(() => {
        let previousStyles: Record<string, any> = {}
        let previousTool = editor.getCurrentToolId()
        
        const unreact = react('capture-user-brush', () => {
            const selection = editor.getSelectedShapeIds()
            const toolId = editor.getCurrentToolId()
            const activeStyles = editor.getInstanceState().stylesForNextShape
            
            // Skip select tool
            if (toolId === 'select') return

            // Detect if tool changed
            const toolChanged = toolId !== previousTool
            previousTool = toolId
            
            // For drawing tools: ONLY capture if user changes style while already on the tool
            // Do NOT capture when switching TO the tool (prevents contamination)
            if (DRAWING_TOOLS.includes(toolId)) {
                if (toolChanged) {
                    // Just switched to this tool - don't capture, just record current state
                    previousStyles[toolId] = cloneStyles(activeStyles)
                    return
                }
                
                // Already on this tool - check if user changed something
                const prevForThisTool = previousStyles[toolId]
                if (prevForThisTool && !stylesEqual(prevForThisTool, activeStyles)) {
                    // User actively changed the style! Save it.
                    const currentStored = toolBrushStylesAtom.get()
                    toolBrushStylesAtom.set({
                        ...currentStored,
                        [toolId]: cloneStyles(activeStyles)
                    })
                    previousStyles[toolId] = cloneStyles(activeStyles)
                }
                return
            }
            
            // For non-drawing tools: capture when no selection
            if (selection.length === 0) {
                const currentStored = toolBrushStylesAtom.get()
                if (!stylesEqual(currentStored[toolId], activeStyles)) {
                    toolBrushStylesAtom.set({
                        ...currentStored,
                        [toolId]: cloneStyles(activeStyles)
                    })
                }
            }
        })
        
        return () => {
            unreact()
        }
    }, [editor])

    // 2. Restore the saved brush for ALL tools (including drawing tools)
    useEffect(() => {
        const restoreBrush = () => {
            const toolId = editor.getCurrentToolId()
            
            // Skip select tool only
            if (toolId === 'select') return

            const storedStyles = toolBrushStylesAtom.get()[toolId]
            if (storedStyles && Object.keys(storedStyles).length > 0) {
                editor.run(() => {
                    for (const [id, value] of Object.entries(storedStyles)) {
                        // Use the internal style ID to set the next style
                        editor.setStyleForNextShapes({ id } as any, value, { history: 'ignore' })
                    }
                }, { history: 'ignore' })
            }
        }

        // Restore when:
        // - Tool changes
        // - Selection is cleared
        // - A pointer operation finishes (to overwrite tldraw's auto-sync-to-selection)
        
        const handleEvent = (e: any) => {
            if (e.name === 'tool_change') {
                restoreBrush()
            }
            if (e.name === 'pointer_up') {
                // Optimization: Use requestAnimationFrame instead of setTimeout
                requestAnimationFrame(restoreBrush)
            }
        }

        editor.on('event', handleEvent)
        
        // Also watch for selection becoming empty via react
        const unreact = react('restore-on-deselect', () => {
            const selection = editor.getSelectedShapeIds()
            if (selection.length === 0) {
                restoreBrush()
            }
        })

        return () => {
            editor.off('event', handleEvent)
            unreact()
        }
    }, [editor])

    // 3. EXPLICIT PROTECTION: Prevent drawing tools from syncing styles from selections
    useEffect(() => {
        let lastToolId = editor.getCurrentToolId()
        
        return react('block-drawing-tool-sync', () => {
            const toolId = editor.getCurrentToolId()
            const selection = editor.getSelectedShapeIds()
            
            // Detect tool change
            if (toolId !== lastToolId) {
                lastToolId = toolId
                
                // If we switched TO a drawing tool AND there's a selection
                // Force restore the drawing tool's saved styles immediately
                if (DRAWING_TOOLS.includes(toolId) && selection.length > 0) {
                    const storedStyles = toolBrushStylesAtom.get()[toolId]
                    if (storedStyles && Object.keys(storedStyles).length > 0) {
                        // Multiple aggressive restores to override tldraw's sync
                        // Using requestAnimationFrame chain for better timing
                         const restore = () => {
                             editor.run(() => {
                                for (const [id, value] of Object.entries(storedStyles)) {
                                    editor.setStyleForNextShapes({ id } as any, value, { history: 'ignore' })
                                }
                            }, { history: 'ignore' })
                         }

                        requestAnimationFrame(() => {
                            restore();
                            requestAnimationFrame(() => {
                                restore();
                                requestAnimationFrame(restore);
                            });
                        });
                    }
                }
            }
        })
    }, [editor])

    return null
}