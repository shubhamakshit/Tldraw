import {
    StylePanelSection,
    StylePanelSubheading,
    StylePanelColorPicker,
    StylePanelDashPicker,
    StylePanelFillPicker,
    StylePanelGeoShapePicker,
    StylePanelSizePicker,
    StylePanelSplinePicker,
    StylePanelFontPicker,
    StylePanelTextAlignPicker,
    StylePanelArrowheadPicker,
    StylePanelArrowKindPicker,
    TldrawUiSlider,
    StylePanelContextProvider,
    TLUiStylePanelProps,
    useEditor,
    track,
    getDefaultColorTheme,
    TldrawUiButton,
    TldrawUiButtonCheck
} from 'tldraw'
import { useState } from 'react'
import { getBrushOpacityForTool, updateBrushOpacityForTool, toolBrushOpacityAtom } from '../utils/brushUtils'
import { getEraserSettings } from '../utils/eraserUtils'

const COLORS = [
    'black', 'grey', 'light-grey', 'white',
    'blue', 'light-blue', 'turquoise', 'green',
    'light-green', 'yellow', 'orange', 'light-red',
    'red', 'light-violet', 'violet'
]

export const CustomStylePanel = track((props: TLUiStylePanelProps) => {
    const editor = useEditor()
    const styles = props.styles ?? editor.getSharedStyles()

    const selectedShapes = editor.getSelectedShapes()

    // Debug log to check for double rendering
    // console.log('[CustomStylePanel] Rendering. Selected:', selectedShapes.length, 'IsLocked:', selectedShapes.every(s => s.isLocked))

    const toolId = editor.getCurrentToolId()
    const toolBrush = getBrushOpacityForTool(toolId)
    
    const isGeo = selectedShapes.some(s => s.type === 'geo') || (selectedShapes.length === 0 && toolId === 'geo')
    const isEquation = selectedShapes.some(s => s.type === 'equation')
    const hasText = selectedShapes.some(s => 'text' in s.props || s.type === 'text') || (selectedShapes.length === 0 && toolId === 'text')
    const isArrow = selectedShapes.some(s => s.type === 'arrow' || s.type === 'line') || (selectedShapes.length === 0 && (toolId === 'arrow' || toolId === 'line'))

    // Check if we should show stroke controls
    // Geo, Arrow, Line, Highlight, Draw, Equation all use stroke color
    // But specific controls like dash/size depend on type.
    // For simplicity, we show the Stroke section if ANY shape supports it.
    const hasStroke = selectedShapes.some(s =>
        ['geo', 'arrow', 'line', 'highlight', 'draw', 'equation', 'note', 'text'].includes(s.type)
    ) || (selectedShapes.length === 0 && ['geo', 'arrow', 'line', 'highlight', 'draw', 'note', 'text'].includes(toolId))

    // Eraser Settings
    const [eraserSettings, setEraserSettings] = useState(getEraserSettings)
    const updateEraserSetting = (key: string) => {
        const newSettings = { ...eraserSettings, [key]: !(eraserSettings as any)[key] }
        setEraserSettings(newSettings)
        localStorage.setItem('tldraw_eraser_settings', JSON.stringify(newSettings))
    }

    // Helper to update equation props
    const updateEquationProp = (prop: string, value: any) => {
        editor.updateShapes(selectedShapes.map(s => {
            if (s.type !== 'equation') return s;
            return {
                id: s.id,
                type: s.type,
                props: { ...s.props, [prop]: value }
            }
        }))
    }

    const handleEquationZoom = (factor: number) => {
        editor.updateShapes(selectedShapes.map(s => {
            if (s.type !== 'equation') return s;
            const currentScaleX = (s.props as any).scaleX ?? 40
            const currentScaleY = (s.props as any).scaleY ?? 40
            return {
                id: s.id,
                type: s.type,
                props: {
                    ...s.props,
                    scaleX: Math.max(1, currentScaleX * factor),
                    scaleY: Math.max(1, currentScaleY * factor)
                }
            }
        }))
    }

    const handleEquationReset = () => {
        editor.updateShapes(selectedShapes.map(s => {
            if (s.type !== 'equation') return s;
            return {
                id: s.id,
                type: s.type,
                props: {
                    ...s.props,
                    scaleX: 40,
                    scaleY: 40,
                    offsetX: 250,
                    offsetY: 250
                }
            }
        }))
    }

    // Drawing tools don't use fill
    const drawingTools = ['draw', 'highlight', 'eraser', 'laser']
    const isDrawingTool = drawingTools.includes(toolId) && selectedShapes.length === 0
    
    // Get color theme for swatches
    const theme = getDefaultColorTheme({ isDarkMode: editor.user.getIsDarkMode() })

    const getOpacity = (key: 'borderOpacity' | 'fillOpacity', defaultValue: number) => {
        if (selectedShapes.length === 0) {
            const toolVal = toolBrush[key]
            return toolVal !== undefined ? toolVal : defaultValue
        }
        const values = selectedShapes.map(s => (s.meta[key] as number) ?? defaultValue)
        return values.every(v => v === values[0]) ? values[0] : defaultValue
    }

    const borderOpacity = getOpacity('borderOpacity', 1.0)
    const fillOpacity = getOpacity('fillOpacity', 0.6)

    const handleOpacityChange = (key: 'borderOpacity' | 'fillOpacity', value: number) => {
        updateBrushOpacityForTool(toolId, { [key]: value })
        if (selectedShapes.length > 0) {
            editor.updateShapes(selectedShapes.map(s => ({
                id: s.id,
                type: s.type,
                meta: { ...s.meta, [key]: value }
            })))
        }
    }
    
    // Get/set fill color (stored in meta.fillColor)
    const getFillColor = () => {
        if (selectedShapes.length === 0) return 'black'
        const colors = selectedShapes.map(s => (s.meta.fillColor as string) || 'black')
        return colors.every(c => c === colors[0]) ? colors[0] : 'black'
    }
    
    const setFillColor = (color: string) => {
        if (selectedShapes.length > 0) {
            editor.updateShapes(selectedShapes.map(s => ({
                id: s.id,
                type: s.type,
                meta: { ...s.meta, fillColor: color }
            })))
        }
    }

    const isLocked = selectedShapes.every(s => s.isLocked)

    const toggleLock = () => {
        editor.updateShapes(selectedShapes.map(s => ({
            id: s.id,
            type: s.type,
            isLocked: !isLocked
        })))
    }

    return (
        <StylePanelContextProvider styles={styles}>
            <div className="tlui-style-panel" style={{
                pointerEvents: 'all',
                backgroundColor: 'var(--color-panel)',
                border: '1px solid var(--color-panel-contrast)',
                borderRadius: 'var(--radius-2)',
                boxShadow: 'var(--shadow-2)'
            }}>
                <div className="tlui-style-panel__content" style={{ maxHeight: 'calc(100vh - 100px)', overflowY: 'auto' }}>

                {selectedShapes.length > 0 && (
                    <StylePanelSection>
                        <div style={{ display: 'flex', gap: '8px' }}>
                             <TldrawUiButton
                                type="normal"
                                onClick={toggleLock}
                                style={{
                                    width: '100%',
                                    justifyContent: 'space-between',
                                    background: isLocked ? 'var(--color-selected-primary)' : 'transparent',
                                    color: isLocked ? 'var(--color-selected-contrast)' : 'inherit'
                                }}
                            >
                                <span style={{ fontSize: '12px', fontWeight: 500 }}>{isLocked ? 'Unlock' : 'Lock'}</span>
                                <TldrawUiButtonCheck checked={isLocked} />
                            </TldrawUiButton>
                        </div>
                    </StylePanelSection>
                )}

                {toolId === 'eraser' && (
                    <StylePanelSection>
                        <StylePanelSubheading>Erase Only</StylePanelSubheading>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {[
                                { label: 'Scribble', key: 'scribble' },
                                { label: 'Text', key: 'text' },
                                { label: 'Shapes', key: 'shapes' },
                                { label: 'Images', key: 'images' }
                            ].map(({ label, key }) => (
                                <TldrawUiButton
                                    key={key}
                                    type="low"
                                    onClick={() => updateEraserSetting(key)}
                                    style={{ 
                                        justifyContent: 'space-between', 
                                        width: '100%',
                                        padding: '4px 8px',
                                        height: '32px',
                                        background: (eraserSettings as any)[key] ? 'var(--color-selected-primary)' : 'transparent',
                                        color: (eraserSettings as any)[key] ? 'var(--color-selected-contrast)' : 'inherit',
                                    }}
                                >
                                    <span style={{ fontSize: '12px', fontWeight: 500 }}>{label}</span>
                                    <TldrawUiButtonCheck checked={(eraserSettings as any)[key]} />
                                </TldrawUiButton>
                            ))}
                        </div>
                    </StylePanelSection>
                )}

                {isGeo && (
                    <StylePanelSection>
                        <StylePanelSubheading>Shape</StylePanelSubheading>
                        <StylePanelGeoShapePicker />
                    </StylePanelSection>
                )}

                {isEquation && (
                    <StylePanelSection>
                        <StylePanelSubheading>Equation Settings</StylePanelSubheading>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {[
                                { label: 'Show Axes', prop: 'showAxes' },
                                { label: 'Show Grid', prop: 'showGrid' },
                                { label: 'Show Numbers', prop: 'showNumbers' },
                                { label: 'Lock Aspect Ratio', prop: 'lockAspectRatio' }
                            ].map(({ label, prop }) => {
                                const value = selectedShapes.every(s => (s.props as any)[prop])
                                return (
                                    <TldrawUiButton
                                        key={prop}
                                        type="low"
                                        onClick={() => updateEquationProp(prop, !value)}
                                        style={{
                                            justifyContent: 'space-between',
                                            width: '100%',
                                            padding: '4px 8px',
                                            height: '32px',
                                            background: value ? 'var(--color-selected-primary)' : 'transparent',
                                            color: value ? 'var(--color-selected-contrast)' : 'inherit',
                                        }}
                                    >
                                        <span style={{ fontSize: '12px', fontWeight: 500 }}>{label}</span>
                                        <TldrawUiButtonCheck checked={value} />
                                    </TldrawUiButton>
                                )
                            })}
                        </div>
                        <div style={{ marginTop: '8px', display: 'flex', gap: '4px' }}>
                            <TldrawUiButton
                                type="normal"
                                onClick={() => handleEquationZoom(1.2)}
                                title="Zoom In"
                                style={{ flex: 1, justifyContent: 'center', background: 'var(--color-low)' }}
                            >
                                +
                            </TldrawUiButton>
                            <TldrawUiButton
                                type="normal"
                                onClick={() => handleEquationZoom(0.8)}
                                title="Zoom Out"
                                style={{ flex: 1, justifyContent: 'center', background: 'var(--color-low)' }}
                            >
                                -
                            </TldrawUiButton>
                            <TldrawUiButton
                                type="normal"
                                onClick={handleEquationReset}
                                title="Reset View"
                                style={{ flex: 1, justifyContent: 'center', background: 'var(--color-low)' }}
                            >
                                ↺
                            </TldrawUiButton>
                        </div>
                    </StylePanelSection>
                )}

                {isArrow && <StylePanelSplinePicker />}

                {hasStroke && (
                    <StylePanelSection>
                        <StylePanelSubheading>Stroke</StylePanelSubheading>
                        <StylePanelColorPicker />
                        <StylePanelDashPicker />
                        <StylePanelSizePicker />
                        <TldrawUiSlider
                            value={Math.round(borderOpacity * 100)}
                            onValueChange={(value) => handleOpacityChange('borderOpacity', value / 100)}
                            min={0}
                            steps={100}
                            label="Stroke Opacity"
                            title="Stroke Opacity"
                        />
                    </StylePanelSection>
                )}

                {isGeo && !isDrawingTool && (
                    <StylePanelSection>
                        <StylePanelSubheading>Fill</StylePanelSubheading>
                        
                        <div style={{ marginBottom: '8px' }}>
                            <div style={{ 
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '4px'
                            }}>
                                {COLORS.map(color => {
                                    const currentFill = getFillColor()
                                    const isActive = currentFill === color
                                    const themeColor = (theme as any)[color]
                                    const colorValue = themeColor?.solid || '#000'
                                    return (
                                        <button
                                            key={color}
                                            onClick={() => setFillColor(color)}
                                            data-state={isActive ? 'selected' : undefined}
                                            aria-label={color}
                                            title={`Fill: ${color}`}
                                            style={{
                                                width: '28px',
                                                height: '28px',
                                                padding: '4px',
                                                border: isActive ? '2px solid var(--color-selected)' : '1px solid var(--color-panel-contrast)',
                                                borderRadius: '4px',
                                                background: colorValue,
                                                cursor: 'pointer',
                                                flexShrink: 0
                                            }}
                                        />
                                    )
                                })}
                            </div>
                        </div>
                        
                        <StylePanelFillPicker />
                        <TldrawUiSlider
                            value={Math.round(fillOpacity * 100)}
                            onValueChange={(value) => handleOpacityChange('fillOpacity', value / 100)}
                            min={0}
                            steps={100}
                            label="Fill Opacity"
                            title="Fill Opacity"
                        />
                    </StylePanelSection>
                )}

                {hasText && (
                    <StylePanelSection>
                        <StylePanelSubheading>Text</StylePanelSubheading>
                        <StylePanelFontPicker />
                        <StylePanelTextAlignPicker />
                    </StylePanelSection>
                )}

                {isArrow && (
                    <StylePanelSection>
                        <StylePanelSubheading>Arrow</StylePanelSubheading>
                        <StylePanelArrowheadPicker />
                        <StylePanelArrowKindPicker />
                    </StylePanelSection>
                )}
                </div>
            </div>
        </StylePanelContextProvider>
    )
})

export function getInitialMetaForOpacity(editor: any) {
    const toolId = editor.getCurrentToolId()
    const all = toolBrushOpacityAtom.get()
    const brush = all[toolId] || all.default
    return {
        fillOpacity: brush.fillOpacity,
        borderOpacity: brush.borderOpacity,
        fillColor: 'black', // Default fill color
    }
}
