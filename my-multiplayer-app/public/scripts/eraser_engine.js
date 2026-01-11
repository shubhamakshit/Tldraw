
export function initializeEraserPen(canvasElement, onEraserStateChange = null) {
    let isErasing = false

    // Stylus eraser button - most styluses use button 5 (Samsung S-Pen, Wacom, etc.)
    // Some may use button 32, so we check for both
    const ERASER_BUTTON_IDS = [5, 32]

    // Marker to identify synthetic events and prevent infinite loops
    const SYNTHETIC_MARKER = '__eraser_synthetic__'

    console.log('[EraserEngine] Initialized. Listening for buttons:', ERASER_BUTTON_IDS)
    console.log('[EraserEngine] Canvas element:', canvasElement)
    console.log('[EraserEngine] Callback provided:', !!onEraserStateChange)

    const handlePointerDown = (e) => {
        // Skip synthetic events we created
        if (e[SYNTHETIC_MARKER]) {
            return
        }

        // Check if target is canvas
        const isCanvasTarget = e.target === canvasElement || canvasElement.contains(e.target)

        if (!isCanvasTarget) {
            return
        }

        // Check if this is an eraser button
        if (ERASER_BUTTON_IDS.includes(e.button)) {
            console.log('[EraserEngine] ✓ ERASER BUTTON', e.button, 'DETECTED! Activating eraser mode')

            // STOP the original event from reaching canvas handlers
            e.stopPropagation()
            e.preventDefault()

            isErasing = true

            // Notify callback of eraser state change BEFORE dispatching synthetic event
            if (onEraserStateChange) {
                console.log('[EraserEngine] Calling onEraserStateChange(true)')
                onEraserStateChange(true)
            }

            // Dispatch a synthetic 'pointerdown' event with button 0
            const newEvent = new PointerEvent('pointerdown', {
                clientX: e.clientX,
                clientY: e.clientY,
                screenX: e.screenX,
                screenY: e.screenY,
                pointerId: e.pointerId,
                pointerType: e.pointerType,
                pressure: e.pressure,
                width: e.width,
                height: e.height,
                tiltX: e.tiltX,
                tiltY: e.tiltY,
                button: 0,
                buttons: 1,
                isPrimary: true,
                bubbles: true,
                cancelable: true
            })
            newEvent[SYNTHETIC_MARKER] = true
            console.log('[EraserEngine] Dispatching synthetic pointerdown to canvas')
            canvasElement.dispatchEvent(newEvent)
        }
    }

    const handlePointerMove = (e) => {
        // Skip synthetic events we created
        if (e[SYNTHETIC_MARKER]) return

        if (!isErasing) return

        // Stop original event and dispatch synthetic one
        e.stopPropagation()
        e.preventDefault()

        const newEvent = new PointerEvent('pointermove', {
            clientX: e.clientX,
            clientY: e.clientY,
            screenX: e.screenX,
            screenY: e.screenY,
            pointerId: e.pointerId,
            pointerType: e.pointerType,
            pressure: e.pressure,
            width: e.width,
            height: e.height,
            tiltX: e.tiltX,
            tiltY: e.tiltY,
            button: 0,
            buttons: 1,
            isPrimary: true,
            bubbles: true,
            cancelable: true
        })
        newEvent[SYNTHETIC_MARKER] = true
        canvasElement.dispatchEvent(newEvent)
    }

    const handlePointerUp = (e) => {
        // Skip synthetic events we created
        if (e[SYNTHETIC_MARKER]) {
            return
        }

        if (isErasing) {
            console.log('[EraserEngine] Ending eraser mode')
            e.stopPropagation()
            e.preventDefault()

            isErasing = false

            // Notify callback of eraser state change
            if (onEraserStateChange) {
                console.log('[EraserEngine] Calling onEraserStateChange(false)')
                onEraserStateChange(false)
            }

            const newEvent = new PointerEvent('pointerup', {
                clientX: e.clientX,
                clientY: e.clientY,
                screenX: e.screenX,
                screenY: e.screenY,
                pointerId: e.pointerId,
                pointerType: e.pointerType,
                pressure: e.pressure,
                width: e.width,
                height: e.height,
                tiltX: e.tiltX,
                tiltY: e.tiltY,
                button: 0,
                buttons: 0,
                isPrimary: true,
                bubbles: true,
                cancelable: true
            })
            newEvent[SYNTHETIC_MARKER] = true
            console.log('[EraserEngine] Dispatching synthetic pointerup')
            canvasElement.dispatchEvent(newEvent)
        }
    }

    // Use CAPTURE phase to intercept events BEFORE they reach the canvas
    console.log('[EraserEngine] Adding event listeners with capture phase')
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', handlePointerUp, true)

    return () => {
        console.log('[EraserEngine] Cleanup: removing event listeners')
        window.removeEventListener('pointerdown', handlePointerDown, true)
        window.removeEventListener('pointermove', handlePointerMove, true)
        window.removeEventListener('pointerup', handlePointerUp, true)
    }
}
