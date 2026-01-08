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

    // BUG FIX: Track when the pointer went down to detect accidental strokes
    const pointerDownTimeRef = useRef<number>(0)

    // PERFORMANCE: Throttle pointer event tracking
    const lastUpdateTimeRef = useRef<number>(0)

    // INPUT INTELLIGENCE: Finger vs Pen
    const lastPenActivityTimeRef = useRef<number>(0)
    const intendedToolRef = useRef<string>('draw')
    const isTouchModeRef = useRef<boolean>(false)

    // 0. Keep track of the "main" tool (the one we want to revert to)
    useEffect(() => {
        // Optimized: Use sideEffects to track tool changes instead of global event listener
        // This avoids processing every single pointer event
        const cleanup = editor.sideEffects.registerAfterChangeHandler('instance_page_state', (prev, next) => {
            // Check if tool changed (checking standard prop names for Tldraw records)
            // @ts-ignore - 'toolId' or 'selectedToolId' depending on version
            const prevTool = (prev as any).selectedToolId ?? (prev as any).toolId
            const nextTool = (next as any).selectedToolId ?? (next as any).toolId

            if (prevTool !== nextTool) {
                const current = nextTool
                // If we are NOT in button mode AND NOT in forced touch (hand) mode,
                // and the new tool isn't the temporary eraser,
                // update our memory of the "previous" (intended) tool.
                if (!isInButtonModeRef.current && !isTouchModeRef.current && current !== 'eraser' && current !== 'hand') {
                    previousToolRef.current = current
                    intendedToolRef.current = current
                }
            }
        })

        return cleanup
    }, [editor])

    useEffect(() => {
        if (!editor) return

        // 1. Independent Pointer State Tracker & Double Tap Detector
        const trackPointer = (e: PointerEvent) => {
            // TRACK PEN ACTIVITY
            if (e.pointerType === 'pen') {
                lastPenActivityTimeRef.current = Date.now()

                // If we were in forced touch mode (hand), and pen comes back,
                // revert to the intended drawing tool immediately.
                if (e.type === 'pointerdown' && isTouchModeRef.current) {
                     // Check if current is hand (it should be)
                     if (editor.getCurrentToolId() === 'hand') {
                         editor.setCurrentTool(intendedToolRef.current)
                     }
                     isTouchModeRef.current = false
                }
            }
            // INPUT INTELLIGENCE: FINGER NAVIGATION
            else if (e.pointerType === 'touch' && e.type === 'pointerdown') {
                const now = Date.now()
                // If pen was active recently (1s) AND pen is not currently down (to allow multitouch gestures if supported)
                // Note: If pen IS down, tldraw handles gestures separately, but we shouldn't switch tool mid-stroke.
                const penRecentlyActive = (now - lastPenActivityTimeRef.current) < 1000

                if (penRecentlyActive && !isPenDownRef.current) {
                    const currentTool = editor.getCurrentToolId()
                    // If we are in a drawing tool, switch to hand for this touch
                    if (['draw', 'highlight', 'eraser'].includes(currentTool)) {
                        intendedToolRef.current = currentTool
                        editor.setCurrentTool('hand')
                        isTouchModeRef.current = true
                        // We don't need to prevent default; Tldraw will now see 'hand' tool and pan instead of draw
                    }
                } else if (!penRecentlyActive && isTouchModeRef.current) {
                    // Pen not active for a while, revert to intended tool if we were in touch mode
                    // This allows finger drawing if user puts pen down for >1s
                    // However, we only do this if we are initiating a new touch.
                    // If we are "stuck" in hand mode, revert.
                     editor.setCurrentTool(intendedToolRef.current)
                     isTouchModeRef.current = false
                }
            }

            // Only care about the pen for specific S Pen logic below
            if (e.pointerType !== 'pen' || !e.isTrusted) return

            // PERFORMANCE: Always update on down/up/cancel, but throttle move
            if (e.type === 'pointermove') {
                const now = Date.now()
                // Update at most ~120Hz (8ms)
                if (now - lastUpdateTimeRef.current < 8) {
                    return
                }
                lastUpdateTimeRef.current = now
            }

            lastEventRef.current = e

            if (e.type === 'pointerdown') {
                isPenDownRef.current = true
                pointerDownTimeRef.current = Date.now()

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
                        editor.undo()

                        // PERFORMANCE: Use queueMicrotask instead of setTimeout for tighter timing
                        queueMicrotask(() => editor.undo())

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
            const currentTool = editor.getCurrentToolId()
            const strokeDuration = Date.now() - pointerDownTimeRef.current
            const isAccidentalEraser = currentTool === 'eraser' && newTool !== 'eraser' && strokeDuration < 250

            target.dispatchEvent(new PointerEvent(isAccidentalEraser ? 'pointercancel' : 'pointerup', {
                bubbles: true, cancelable: true, view: window,
                clientX: lastEvent.clientX, clientY: lastEvent.clientY,
                pointerId: lastEvent.pointerId, pointerType: 'pen', isPrimary: true,
                buttons: 0, pressure: 0
            }))

            // B. Switch tool
            editor.setCurrentTool(newTool)

            // C. Start new stroke (delayed slightly for state machine)
            const isDrawingTool = ['draw', 'highlight', 'eraser', 'laser', 'scribble'].includes(newTool)

            if (isDrawingTool) {
                queueMicrotask(() => {
                    target.dispatchEvent(new PointerEvent('pointerdown', {
                        bubbles: true, cancelable: true, view: window,
                        clientX: lastEvent.clientX, clientY: lastEvent.clientY,
                        pointerId: lastEvent.pointerId, pointerType: 'pen', isPrimary: true,
                        buttons: 1,
                        pressure: lastEvent.pressure || 0.5,
                        tiltX: lastEvent.tiltX, tiltY: lastEvent.tiltY
                    }))
                })
            }
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
        // And also to intercept touch events for navigation mode
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
