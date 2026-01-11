
export function initializeSPen(canvasElement) {
    let isPen = false

    // S-Pen uses button ID 5
    const SPEN_BUTTON_ID = 5

    // Marker to identify synthetic events and prevent infinite loops
    const SYNTHETIC_MARKER = '__spen_synthetic__'

    const handlePointerDown = (e) => {
        // Skip synthetic events we created
        if (e[SYNTHETIC_MARKER]) return

        // CRITICAL: Only process if the event target is the canvas or inside it
        if (e.target !== canvasElement && !canvasElement.contains(e.target)) {
            return
        }

        if (e.button === SPEN_BUTTON_ID) {
            // STOP the original event from reaching canvas handlers
            e.stopPropagation()
            e.preventDefault()

            isPen = true

            // Dispatch S-Pen button event for tool switching
            window.dispatchEvent(new CustomEvent('spen-button-down'))

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
                button: 0, // Pretend it's a left-click/touch
                buttons: 1,
                isPrimary: true,
                bubbles: true,
                cancelable: true
            })
            newEvent[SYNTHETIC_MARKER] = true
            canvasElement.dispatchEvent(newEvent)
        }
    }

    const handlePointerMove = (e) => {
        // Skip synthetic events we created
        if (e[SYNTHETIC_MARKER]) return

        if (!isPen) return

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
        if (e[SYNTHETIC_MARKER]) return

        if (isPen) {
            e.stopPropagation()
            e.preventDefault()

            isPen = false

            // Dispatch S-Pen button up event for tool switching
            window.dispatchEvent(new CustomEvent('spen-button-up'))

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
            canvasElement.dispatchEvent(newEvent)
        }
    }

    // Use CAPTURE phase to intercept events BEFORE they reach the canvas
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', handlePointerUp, true)

    return () => {
        window.removeEventListener('pointerdown', handlePointerDown, true)
        window.removeEventListener('pointermove', handlePointerMove, true)
        window.removeEventListener('pointerup', handlePointerUp, true)
    }
}
