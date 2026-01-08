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

    // 0. Keep track of the "main" tool (the one we want to revert to)
    useEffect(() => {
        // Optimized: Use sideEffects to track tool changes instead of global event listener
        // This avoids processing every single pointer event
        const cleanup = editor.sideEffects.registerAfterChangeHandler('instance_page_state', (prev, next) => {
            // Check if tool changed (checking standard prop names for Tldraw records)
            // @ts-ignore - 'toolId' or 'selectedToolId' depending on version, checking changes blindly is safer via getter if needed,
            // but we can just check if the ID implies a tool change.
            // Actually, simplest is to just check editor.getCurrentToolId() which is fast.

            const prevTool = (prev as any).selectedToolId ?? (prev as any).toolId
            const nextTool = (next as any).selectedToolId ?? (next as any).toolId

            if (prevTool !== nextTool) {
                const current = nextTool
                // If we are NOT in button mode, and the new tool isn't the temporary eraser,
                // update our memory of the "previous" (intended) tool.
                if (!isInButtonModeRef.current && current !== 'eraser') {
                    previousToolRef.current = current
                }
            }
        })

        return cleanup
    }, [editor])

    useEffect(() => {
        if (!editor) return

        // 1. Independent Pointer State Tracker & Double Tap Detector
        const trackPointer = (e: PointerEvent) => {
            // Only care about the pen
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
                        // We undo twice: once to remove the 'dot' from the first tap, 
                        // and once to undo the actual action you wanted to undo.
                        // (If the first tap didn't erase anything, tldraw ignores the extra undo safely)
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
            // BUG FIX: If we are switching FROM eraser TO draw, and the stroke was very short (< 250ms),
            // it's likely an "accidental" eraser stroke caused by race conditions (Pen Down before Button Up).
            // In this case, use 'pointercancel' to revert the erasure instead of 'pointerup' which commits it.
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
            // CRITICAL FIX: Only restart stroke for drawing tools.
            // Restarting stroke for 'select' or 'hand' causes unwanted clicks/drags.
            const isDrawingTool = ['draw', 'highlight', 'eraser', 'laser', 'scribble'].includes(newTool)

            if (isDrawingTool) {
                // PERFORMANCE: Remove setTimeout delays (use synchronous switching or microtask)
                // Using queueMicrotask allows the engine to finish the current event loop (tool switch)
                // before processing the new pointerdown, but without the min ~4ms delay of setTimeout.
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
        // PERFORMANCE: Using capture phase is good.
        // We attach to window to catch everything, but tracking move can be expensive.
        // We added throttling above to mitigate.
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
