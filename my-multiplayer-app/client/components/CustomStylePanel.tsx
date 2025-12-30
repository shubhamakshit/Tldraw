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
    const toolId = editor.getCurrentToolId()
    const toolBrush = getBrushOpacityForTool(toolId)
    
    const isGeo = selectedShapes.some(s => s.type === 'geo')
    const hasText = selectedShapes.some(s => 'text' in s.props || s.type === 'text')
    const isArrow = selectedShapes.some(s => s.type === 'arrow' || s.type === 'line')
    
    // Eraser Settings
    const [eraserSettings, setEraserSettings] = useState(getEraserSettings)
    const updateEraserSetting = (key: string) => {
        const newSettings = { ...eraserSettings, [key]: !(eraserSettings as any)[key] }
        setEraserSettings(newSettings)
        localStorage.setItem('tldraw_eraser_settings', JSON.stringify(newSettings))
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
    return (
        <StylePanelContextProvider styles={styles}>
            <div className="tlui-style-panel" style={{ 
                overflowY: 'auto',
                overflowX: 'hidden',
                height: '100%',
                background: editor.user.getIsDarkMode() ? 'rgba(30, 30, 30, 0.4)' : 'rgba(255, 255, 255, 0.4)',
                backdropFilter: 'blur(10px)',
                padding: '8px'
            }}>
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
                
                {isArrow && <StylePanelSplinePicker />}
                
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
