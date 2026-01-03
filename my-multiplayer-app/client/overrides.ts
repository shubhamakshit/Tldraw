import { TLUiOverrides } from 'tldraw'
import { exportToImage } from './utils/exportUtils'

export const getUiOverrides = (roomId: string): TLUiOverrides => {
    return {
        actions: (editor, actions) => {
            const newActions = { ...actions }

            const safeExport = async (format: 'png' | 'svg' | 'pdf' = 'png') => {
                console.log(`Intercepted export action for format: ${format}`)
                await exportToImage(editor, roomId, format)
            }

            // Override PNG export actions
            const pngActions = [
                'export-as-png',
                'export-all-as-png',
                'export-selected-as-png',
            ]
            pngActions.forEach(id => {
                if (newActions[id]) {
                    newActions[id] = {
                        ...newActions[id],
                        onSelect: async () => await safeExport('png')
                    }
                }
            })

            // Override SVG export actions
            const svgActions = [
                'export-as-svg',
                'export-all-as-svg',
                'export-selected-as-svg'
            ]
            svgActions.forEach(id => {
                if (newActions[id]) {
                    newActions[id] = {
                        ...newActions[id],
                        onSelect: async () => await safeExport('svg')
                    }
                }
            })

            // JSON export (leave as default or handle if needed)
            if (newActions['export-as-json']) {
                 // For now, let default JSON export happen or redirect if you want native share
                 // If you want to use the new "Download File" logic instead:
                 // newActions['export-as-json'] = { ... }
            }

            return newActions
        },
    }
}
