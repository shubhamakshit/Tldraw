// public/spen_engine.js

export function initializeSPen(canvasElement) {
    let isPen = false
    let lastEvent = null

    // S-Pen uses button ID 5
    const SPEN_BUTTON_ID = 5

    const handlePointerDown = (e) => {
        if (e.button === SPEN_BUTTON_ID) {
            isPen = true
            // Dispatch a synthetic 'touchstart' or 'pointerdown' event
            // that `color_rm`'s drawing logic can understand.
            const newEvent = new PointerEvent('pointerdown', {
                ...e,
                button: 0, // Pretend it's a left-click/touch
                isPrimary: true,
            })
            lastEvent = newEvent
            canvasElement.dispatchEvent(newEvent)
            e.preventDefault()
        }
    }

    const handlePointerMove = (e) => {
        if (isPen) {
            const newEvent = new PointerEvent('pointermove', {
                ...e,
                button: 0,
                isPrimary: true,
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
            })
            canvasElement.dispatchEvent(newEvent)
            e.preventDefault()
        }
    }

    // We need to listen on the window to catch pointerup events
    // that might happen outside the canvas.
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    // Return a cleanup function
    return () => {
        window.removeEventListener('pointerdown', handlePointerDown)
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
    }
}
