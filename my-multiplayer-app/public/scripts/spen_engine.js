
export function initializeSPen(canvasElement) {
    let isPen = false
    let lastEvent = null

    // S-Pen uses button ID 5
    const SPEN_BUTTON_ID = 5

    const handlePointerDown = (e) => {
        // CRITICAL: Only dispatch if the event target is the canvas or inside it
        if (e.target !== canvasElement && !canvasElement.contains(e.target)) {
            return
        }

        if (e.button === SPEN_BUTTON_ID) {
            isPen = true
            // Dispatch a synthetic 'touchstart' or 'pointerdown' event
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
        // IF we started inside. But for S-Pen hover/move, we generally want it scoped.
        // However, standard pointer capture should handle drags.

        // For simple robust behavior: if isPen is true, we keep dispatching.
        // If isPen is false, we check target.

        if (!isPen && (e.target !== canvasElement && !canvasElement.contains(e.target))) {
            return
        }

        if (isPen) {
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
        if (isPen) {
            isPen = false
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
