
export function initializeEraserPen(canvasElement, onEraserStateChange = null) {
    let isErasing = false
    let lastEvent = null

    // Standard stylus eraser uses button ID 32
    const ERASER_BUTTON_ID = 32

    const handlePointerDown = (e) => {
        // CRITICAL: Only dispatch if the event target is the canvas or inside it
        if (e.target !== canvasElement && !canvasElement.contains(e.target)) {
            return
        }

        if (e.button === ERASER_BUTTON_ID) {
            isErasing = true

            // Notify callback of eraser state change
            if (onEraserStateChange) {
                onEraserStateChange(true)
            }

            // Dispatch a synthetic 'pointerdown' event
            const newEvent = new PointerEvent('pointerdown', {
                ...e,
                button: 0, // Pretend it's a left-click/touch
                isPrimary: true,
                bubbles: true,
                cancelable: true
            })
            lastEvent = newEvent
            // Dispatch specifically to the canvas
            canvasElement.dispatchEvent(newEvent)
            e.preventDefault()
        }
    }

    const handlePointerMove = (e) => {
        // If we are dragging, we might be outside the canvas, but we still want to track it
        // IF we started inside. But for eraser hover/move, we generally want it scoped.
        // However, standard pointer capture should handle drags.

        // For simple robust behavior: if isErasing is true, we keep dispatching.
        // If isErasing is false, we check target.

        if (!isErasing && (e.target !== canvasElement && !canvasElement.contains(e.target))) {
            return
        }

        if (isErasing) {
            const newEvent = new PointerEvent('pointermove', {
                ...e,
                button: 0,
                isPrimary: true,
                bubbles: true,
                cancelable: true
            })
            lastEvent = newEvent
            canvasElement.dispatchEvent(newEvent)
            e.preventDefault()
        }
    }

    const handlePointerUp = (e) => {
        if (isErasing) {
            isErasing = false

            // Notify callback of eraser state change
            if (onEraserStateChange) {
                onEraserStateChange(false)
            }

            const newEvent = new PointerEvent('pointerup', {
                ...e,
                button: 0,
                isPrimary: true,
                bubbles: true,
                cancelable: true
            })
            canvasElement.dispatchEvent(newEvent)
            e.preventDefault()
        }
    }

    // We still listen on window to catch events that bubble up or happen globally (like up outside)
    // but we added target checks in Down and Move to prevent cross-talk.
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
        window.removeEventListener('pointerdown', handlePointerDown)
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
    }
}
