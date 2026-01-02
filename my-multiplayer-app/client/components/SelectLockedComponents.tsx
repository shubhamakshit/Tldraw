import {
    track,
    useEditor,
    useValue,
    TldrawUiButton,
    TldrawUiButtonIcon,
    atom,
    Box,
    react,
    TldrawUiButtonCheck
} from 'tldraw'
import { useEffect, useRef } from 'react'
import { LockIcon } from './Icons'

export const getSelectLockedSignal = (editor: any) => {
    if (!editor._selectLockedSignal) {
        editor._selectLockedSignal = atom('selectLocked', !!editor._selectLocked)
    }
    return editor._selectLockedSignal
}

export const SelectOptionsPanel = track(() => {
    const editor = useEditor()
    const isSelect = useValue('isSelect', () => editor.getCurrentToolId() === 'select', [editor])
    const isSelectLocked = useValue('isSelectLocked', () => getSelectLockedSignal(editor).get(), [editor])

    if (!isSelect) return null

    return (
        <div className="tlui-menu" style={{
            position: 'absolute',
            bottom: 60,
            left: 12,
            zIndex: 1000,
            borderRadius: 'var(--radius-2)',
            boxShadow: 'var(--shadow-2)',
            backgroundColor: 'var(--color-panel)',
            border: '1px solid var(--color-panel-contrast)',
            padding: '4px',
            pointerEvents: 'all',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
        }}>
            <TldrawUiButton
                type="normal"
                onClick={() => {
                    const signal = getSelectLockedSignal(editor)
                    const next = !signal.get()
                    signal.set(next)
                    ;(editor as any)._selectLocked = next
                    editor.emit('select-locked-changed' as any)
                }}
                style={{
                    justifyContent: 'flex-start',
                    padding: '8px 12px',
                    height: '32px',
                    background: isSelectLocked ? 'var(--color-selected-primary)' : 'transparent',
                    color: isSelectLocked ? 'var(--color-selected-contrast)' : 'var(--color-text)',
                    borderRadius: 'var(--radius-1)'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <LockIcon size={14} />
                    <span style={{ fontSize: '12px', fontWeight: 500 }}>Select Locked</span>
                    <TldrawUiButtonCheck checked={isSelectLocked} />
                </div>
            </TldrawUiButton>
        </div>
    )
})

export const SelectLockedToggle = track(() => {
    const editor = useEditor()
    const isSelectLocked = useValue('isSelectLocked', () => getSelectLockedSignal(editor).get(), [editor])

    return (
        <TldrawUiButton
            type="icon"
            title="Select Locked Objects"
            isActive={isSelectLocked}
            onClick={() => {
                const signal = getSelectLockedSignal(editor)
                const next = !signal.get()
                signal.set(next)
                ;(editor as any)._selectLocked = next
                editor.emit('select-locked-changed' as any)
            }}
        >
            <TldrawUiButtonIcon icon={isSelectLocked ? 'lock' : 'unlock'} />
        </TldrawUiButton>
    )
})

export function SelectLockedLogic() {
    const editor = useEditor()

    // Handle click-to-select locked shapes
    // We use a capturing listener on the window to intercept the event BEFORE Tldraw processes it.
    // This prevents Tldraw from treating the click on a locked shape as a background click (which deselects everything).
    useEffect(() => {
        const handlePointerDown = (e: PointerEvent) => {
            const isSelectLocked = getSelectLockedSignal(editor).get()
            if (!isSelectLocked) return

            // Only intervene if we are using the select tool
            if (editor.getCurrentToolId() !== 'select') return

            // Basic check: is this a click on the canvas?
            const target = e.target as HTMLElement

            // Allow clicks on UI elements (context menus, panels) to pass through
            if (target.closest('.tl-ui-layout') || target.closest('.tl-context-menu')) return

            // Allow clicks on interactive elements inside shapes
            if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.closest('button')) return

            if (!target || !target.closest('.tl-canvas')) return

            // Convert screen point to page point
            const point = editor.screenToPage({ x: e.clientX, y: e.clientY })

            // Find if we hit a locked shape
            // We check hitInside: true because we want to select filled shapes by clicking inside
            // Using a slightly larger margin for easier selection
            const zoom = editor.getZoomLevel()
            const margin = 5 / zoom
            const shape = editor.getShapeAtPoint(point, { hitInside: true, margin })

            if (shape && shape.isLocked) {
                // We found a locked shape!
                // Stop Tldraw from processing this event (which would clear selection)
                e.stopPropagation()
                e.preventDefault()

                // Select the shape
                editor.setSelectedShapes([shape.id])
                return
            }
        }

        // Use capture: true to intercept before Tldraw
        window.addEventListener('pointerdown', handlePointerDown, { capture: true })

        return () => {
            window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
        }
    }, [editor])

    // Handle drag-to-select (brush) locked shapes
    useEffect(() => {
        return react('check-brush-locked', () => {
            const isSelectLocked = getSelectLockedSignal(editor).get()
            if (!isSelectLocked) return
            if (editor.getCurrentToolId() !== 'select') return

            const brushModel = editor.getInstanceState().brush
            if (!brushModel) return

            // Standard brush logic for locked shapes
            const brush = Box.From(brushModel)
            const shapes = editor.getCurrentPageShapesSorted()

            // Find all locked shapes that collide with the brush
            const lockedInBrush = new Set(shapes.filter(shape => {
                if (!shape.isLocked) return false
                const bounds = editor.getShapePageBounds(shape)
                if (!bounds) return false
                return brush.collides(bounds)
            }).map(s => s.id))

            // Get current selection
            const currentSelected = new Set(editor.getSelectedShapeIds())

            // Add any locked shapes that are in the brush but not selected
            let needsUpdate = false
            const newSelection = new Set(currentSelected)

            for (const id of lockedInBrush) {
                if (!currentSelected.has(id)) {
                    newSelection.add(id)
                    needsUpdate = true
                }
            }

            if (needsUpdate) {
                 editor.setSelectedShapes(Array.from(newSelection))
            }
        })
    }, [editor])

    return null
}
