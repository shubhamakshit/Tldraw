import { useState } from 'react'
import { track, useEditor, useValue, TldrawUiButton, TldrawUiButtonCheck } from 'tldraw'
import { getEraserSettings } from '../utils/eraserUtils'

export const EraserOptionsPanel = track(() => {
    const editor = useEditor()
    const isEraser = useValue('isEraser', () => editor.getCurrentToolId() === 'eraser', [editor])
    const [settings, setSettings] = useState(getEraserSettings)

    if (!isEraser) return null

    const updateSetting = (key: string) => {
        const newSettings = { ...settings, [key]: !(settings as any)[key] }
        setSettings(newSettings)
        localStorage.setItem('tldraw_eraser_settings', JSON.stringify(newSettings))
    }

    return (
        <div style={{
            position: 'absolute',
            top: 80,
            right: 12,
            background: 'var(--color-panel)',
            border: '1px solid var(--color-divider)',
            borderRadius: 'var(--radius-medium)',
            padding: '4px',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            boxShadow: 'var(--shadow-3)',
            width: '130px'
        }}>
            <div style={{ 
                fontSize: '10px', 
                fontWeight: 800, 
                padding: '6px 8px 4px', 
                opacity: 0.6, 
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
            }}>
                Erase only:
            </div>
            <EraserButton label="Scribble" active={settings.scribble} onClick={() => updateSetting('scribble')} />
            <EraserButton label="Text" active={settings.text} onClick={() => updateSetting('text')} />
            <EraserButton label="Shapes" active={settings.shapes} onClick={() => updateSetting('shapes')} />
            <EraserButton label="Images" active={settings.images} onClick={() => updateSetting('images')} />
        </div>
    )
})

function EraserButton({ label, active, onClick }: { label: string, active: boolean, onClick: () => void }) {
    return (
        <TldrawUiButton
            type="low"
            onClick={onClick}
            style={{ 
                justifyContent: 'space-between', 
                width: '100%',
                padding: '4px 8px',
                height: '32px',
                background: active ? 'var(--color-selected-primary)' : 'transparent',
                color: active ? 'var(--color-selected-contrast)' : 'inherit',
            }}
        >
            <span style={{ fontSize: '12px', fontWeight: 500 }}>{label}</span>
            <TldrawUiButtonCheck checked={active} />
        </TldrawUiButton>
    )
}
