import { useEffect, useRef } from 'react'
import { Editor } from 'tldraw'

export function useSPen(editor: Editor) {
    const previousToolRef = useRef<string>('draw')
    
    // State tracking
    const isPenDownRef = useRef<boolean>(false)
    const isInButtonModeRef = useRef<boolean>(false)
    const lastEventRef = useRef<PointerEvent | null>(null)
    
    // DOUBLE TAP TRACKER
    const lastTapTimeRef = useRef<number>(0)

    // 0. Keep track of the "main" tool (the one we want to revert to)
    useEffect(() => {
        const handleEvent = (e: any) => {
            if (e.name === 'tool_change') {
                const current = editor.getCurrentToolId()
                // If we are NOT in button mode, and the new tool isn't the temporary eraser,
                // update our memory of the "previous" (intended) tool.
                if (!isInButtonModeRef.current && current !== 'eraser') {
                    previousToolRef.current = current
                }
            }
        }
        editor.on('event', handleEvent)
        return () => {
            editor.off('event', handleEvent)
        }
    }, [editor])

    useEffect(() => {
        if (!editor) return

        // 1. Independent Pointer State Tracker & Double Tap Detector
        const trackPointer = (e: PointerEvent) => {
            // Only care about the pen
            if (e.pointerType !== 'pen' || !e.isTrusted) return

            lastEventRef.current = e

            if (e.type === 'pointerdown') {
                isPenDownRef.current = true

                // --- GESTURE: HOLD BUTTON + DOUBLE TAP TO UNDO ---
                if (isInButtonModeRef.current) {
                    const now = Date.now()
                    const timeSinceLastTap = now - lastTapTimeRef.current

                    // Check if double tap (within 300ms)
                    if (timeSinceLastTap < 300) {
                        console.log("↩️ S-Pen Gesture: Undo")
                        
                        // 1. Stop this event so we don't draw a second dot
                        e.stopPropagation()
                        e.preventDefault()
                        
                        // 2. Perform Undo
                        // We undo twice: once to remove the 'dot' from the first tap, 
                        // and once to undo the actual action you wanted to undo.
                        // (If the first tap didn't erase anything, tldraw ignores the extra undo safely)
                        editor.undo()
                        setTimeout(() => editor.undo(), 50)

                        return // Stop processing
                    }
                    
                    lastTapTimeRef.current = now
                }
                // ------------------------------------------------
            }
            
            if (e.type === 'pointerup' || e.type === 'pointercancel') {
                isPenDownRef.current = false
            }
        }

        // 2. The "Hot Swap" Function (Draw <-> Eraser)
        const performHotSwap = (newTool: string) => {
            const lastEvent = lastEventRef.current
            
            // If pen isn't touching screen, just switch tool
            if (!isPenDownRef.current || !lastEvent) {
                editor.setCurrentTool(newTool)
                return
            }

            // If pen IS touching, cut the line and switch
            const target = document.elementFromPoint(lastEvent.clientX, lastEvent.clientY) || window

            // A. End current stroke
            target.dispatchEvent(new PointerEvent('pointerup', {
                bubbles: true, cancelable: true, view: window,
                clientX: lastEvent.clientX, clientY: lastEvent.clientY,
                pointerId: lastEvent.pointerId, pointerType: 'pen', isPrimary: true,
                buttons: 0, pressure: 0
            }))

            // B. Switch tool
            editor.setCurrentTool(newTool)

            // C. Start new stroke (delayed slightly for state machine)
            setTimeout(() => {
                target.dispatchEvent(new PointerEvent('pointerdown', {
                    bubbles: true, cancelable: true, view: window,
                    clientX: lastEvent.clientX, clientY: lastEvent.clientY,
                    pointerId: lastEvent.pointerId, pointerType: 'pen', isPrimary: true,
                    buttons: 1, 
                    pressure: lastEvent.pressure || 0.5,
                    tiltX: lastEvent.tiltX, tiltY: lastEvent.tiltY
                }))
            }, 0)
        }

        const onButtonDown = () => {
            isInButtonModeRef.current = true // Mark button as active
            const currentTool = editor.getCurrentToolId()
            if (currentTool !== 'eraser') {
                previousToolRef.current = currentTool
                performHotSwap('eraser')
            }
        }

        const onButtonUp = () => {
            isInButtonModeRef.current = false // Mark button as inactive

            // Only switch back if we are currently on the eraser
            // (If user manually switched tool while button was held, don't revert)
            if (editor.getCurrentToolId() === 'eraser') {
                performHotSwap(previousToolRef.current)
            }
        }

        // Listeners
        window.addEventListener('spen-button-down', onButtonDown)
        window.addEventListener('spen-button-up', onButtonUp)
        
        // Capture phase (true) is critical to intercept the double tap before tldraw
        window.addEventListener('pointerdown', trackPointer, { capture: true })
        window.addEventListener('pointerup', trackPointer, { capture: true })
        window.addEventListener('pointercancel', trackPointer, { capture: true })
        window.addEventListener('pointermove', trackPointer, { capture: true })

        return () => {
            window.removeEventListener('spen-button-down', onButtonDown)
            window.removeEventListener('spen-button-up', onButtonUp)
            window.removeEventListener('pointerdown', trackPointer, { capture: true })
            window.removeEventListener('pointerup', trackPointer, { capture: true })
            window.removeEventListener('pointercancel', trackPointer, { capture: true })
            window.removeEventListener('pointermove', trackPointer, { capture: true })
        }
    }, [editor])
}