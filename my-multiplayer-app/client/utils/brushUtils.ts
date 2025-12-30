import { atom } from 'tldraw'

// Store the full 'brush' (active style) state per tool
// This ensures that 'draw' can be solid while 'geo' is dashed, etc.
// Drawing tools default to solid, shape tools can be whatever user sets
export const toolBrushStylesAtom = atom('toolBrushStyles', {
    draw: { 'tldraw:dash': 'draw' }, // draw and highlight default to solid/draw style
    highlight: { 'tldraw:dash': 'draw' },
    geo: {},
    note: {},
    text: {},
    arrow: {},
    line: {},
    default: {}
} as Record<string, any>)

// Specialized atoms for our custom meta-opacities
export const toolBrushOpacityAtom = atom('toolBrushOpacity', {
    draw: { borderOpacity: 1.0, fillOpacity: 0.6 },
    geo: { borderOpacity: 1.0, fillOpacity: 0.6 },
    default: { borderOpacity: 1.0, fillOpacity: 0.6 }
} as Record<string, { borderOpacity: number, fillOpacity: number }>)

export function getBrushOpacityForTool(toolId: string) {
    const all = toolBrushOpacityAtom.get()
    return all[toolId] || all.default
}

export function updateBrushOpacityForTool(toolId: string, patch: any) {
    const all = toolBrushOpacityAtom.get()
    const current = all[toolId] || all.default
    toolBrushOpacityAtom.set({
        ...all,
        [toolId]: { ...current, ...patch }
    })
}