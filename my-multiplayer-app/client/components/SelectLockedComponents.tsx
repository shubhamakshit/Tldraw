import { 
    track, 
    useEditor, 
    useValue, 
    TldrawUiButton, 
    TldrawUiButtonIcon,
    atom, 
    Box,
    react
} from 'tldraw'
import { useEffect } from 'react'
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
        <div style={{
            position: 'absolute',
            bottom: 84,
            left: 12,
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            background: 'var(--tl-color-panel)',
            padding: '8px',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            border: '1px solid var(--tl-color-divider)',
            minWidth: '150px'
        }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--tl-color-text)', textAlign: 'center' }}>Select Options</div>
            <TldrawUiButton
                type="low"
                onClick={() => {
                    const signal = getSelectLockedSignal(editor)
                    const next = !signal.get()
                    signal.set(next)
                    ;(editor as any)._selectLocked = next
                    editor.emit('select-locked-changed' as any)
                }}
                style={{
                    justifyContent: 'flex-start',
                    padding: '4px 8px',
                    height: '32px',
                    background: isSelectLocked ? 'var(--tl-color-selected)' : 'transparent',
                    color: isSelectLocked ? 'white' : 'var(--tl-color-text)',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '16px', display: 'flex', justifyContent: 'center' }}>
                        {isSelectLocked ? <LockIcon size={14} /> : <div style={{ width: 14, height: 14, border: '1px solid currentColor', borderRadius: '2px' }} />}
                    </div>
                    <span>Select Locked</span>
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
    useEffect(() => {
        const handleEvent = (event: any) => {
            if (event.name !== 'pointer_down') return
            
            const isSelectLocked = getSelectLockedSignal(editor).get()
            if (!isSelectLocked) return
            if (editor.getCurrentToolId() !== 'select') return
            
            const { x, y } = editor.inputs.currentPagePoint
            const pagePoint = { x, y }
            
            const shapes = editor.getCurrentPageShapesSorted()
            let target = null
            for (let i = shapes.length - 1; i >= 0; i--) {
                const shape = shapes[i]
                if (shape.isLocked && editor.isPointInShape(shape, pagePoint, { hitInside: true, margin: 0 })) {
                    target = shape
                    break
                }
            }
            
            if (target) {
                setTimeout(() => {
                    editor.setSelectedShapes([target!.id])
                }, 50)
            }
        }
        
        editor.on('event', handleEvent)
        return () => {
            editor.off('event', handleEvent)
        }
    }, [editor])

    // Handle drag-to-select (brush) locked shapes - OPTIMIZED
    useEffect(() => {
        return react('check-brush-locked', () => {
            const isSelectLocked = getSelectLockedSignal(editor).get()
            if (!isSelectLocked) return
            if (editor.getCurrentToolId() !== 'select') return

            const brushModel = editor.getInstanceState().brush
            if (!brushModel) return

            const brush = Box.From(brushModel)
            const shapes = editor.getCurrentPageShapesSorted()
            const lockedInBrush = shapes.filter(shape => {
                if (!shape.isLocked) return false
                const bounds = editor.getShapePageBounds(shape)
                if (!bounds) return false
                return brush.collides(bounds)
            })

            if (lockedInBrush.length > 0) {
                const currentSelected = new Set(editor.getSelectedShapeIds())
                let changed = false
                for (const shape of lockedInBrush) {
                    if (!currentSelected.has(shape.id)) {
                        currentSelected.add(shape.id)
                        changed = true
                    }
                }
                if (changed) {
                    editor.setSelectedShapes(Array.from(currentSelected))
                }
            }
        })
    }, [editor])
    
    return null
}