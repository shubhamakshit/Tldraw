import { track, useEditor, TldrawUiMenuItem } from 'tldraw'
import { LockIcon } from './Icons'

export const LockStatus = track(() => {
    const editor = useEditor()
    const selectedShapes = editor.getSelectedShapes()
    const hasLocked = selectedShapes.some(s => s.isLocked)

    if (!hasLocked) return null

    return (
        <div className="tlui-toast" style={{
            position: 'absolute',
            bottom: 120,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            pointerEvents: 'none'
        }}>
            <LockIcon size={16} />
            <span>Selection Locked</span>
        </div>
    )
})

export const ToggleLockMenuItem = track(() => {
    const editor = useEditor()
    const selectedShapes = editor.getSelectedShapes()
    if (selectedShapes.length === 0) return null

    const allLocked = selectedShapes.every((s) => s.isLocked)

    return (
        <TldrawUiMenuItem
            id="toggle-lock"
            label={allLocked ? 'Unlock' : 'Lock'}
            icon={allLocked ? 'unlock' : 'lock'}
            onSelect={() => {
                editor.updateShapes(
                    selectedShapes.map((s) => ({
                        id: s.id,
                        type: s.type,
                        isLocked: !allLocked,
                    }))
                )
            }}
        />
    )
})
