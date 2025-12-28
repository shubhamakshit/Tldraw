import { TLAssetStore, uniqueId } from 'tldraw'
// 1. IMPORT CONFIG
import { SERVER_URL } from './config'

export const multiplayerAssetStore: TLAssetStore = {
    async upload(_asset, file) {
        const id = uniqueId()
        const objectName = `${id}-${file.name}`.replace(/[^a-zA-Z0-9.]/g, '-')
        
        // 2. USE CONFIG
        const url = `${SERVER_URL}/api/uploads/${objectName}`

        const response = await fetch(url, {
            method: 'POST',
            body: file,
        })

        if (!response.ok) {
            throw new Error(`Failed to upload asset: ${response.statusText}`)
        }

        return { src: url }
    },

    resolve(asset) {
        return asset.props.src
    },
}