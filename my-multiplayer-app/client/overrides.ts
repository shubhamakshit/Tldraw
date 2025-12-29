import { TLUiOverrides } from 'tldraw'
import { exportToImage } from './utils/exportUtils'

export const getUiOverrides = (roomId: string): TLUiOverrides => {
    return {
        actions: (editor, actions) => {
            const newActions = { ...actions }

            const safeExport = async (id: string) => {
                console.log(`Intercepted export action: ${id}`)
                await exportToImage(editor, roomId)
            }

            // Override all common export actions
            const exportActions = [
                'export-as-png',
                'export-as-svg',
                'export-as-json',
                'export-all-as-png',
                'export-all-as-svg',
                'export-selected-as-png',
                'export-selected-as-svg'
            ]

            exportActions.forEach(id => {
                if (newActions[id]) {
                    newActions[id] = {
                        ...newActions[id],
                        onSelect: async () => await safeExport(id)
                    }
                }
            })

            return newActions
        },
    }
}