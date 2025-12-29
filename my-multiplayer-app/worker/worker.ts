import { handleUnfurlRequest } from 'cloudflare-workers-unfurl'
import { AutoRouter, error, IRequest } from 'itty-router'
import { handleAssetDownload, handleAssetUpload } from './assetUploads'
import { handleColorRmDownload, handleColorRmUpload } from './colorRmAssets'

// make sure our sync durable object is made available to cloudflare
export { TldrawDurableObject } from './TldrawDurableObject'
export { ColorRmDurableObject } from './ColorRmDurableObject'

// we use itty-router (https://itty.dev/) to handle routing. in this example we turn on CORS because
// we're hosting the worker separately to the client. you should restrict this to your own domain.
const router = AutoRouter<IRequest, [env: Env, ctx: ExecutionContext]>({
	catch: (e) => {
		console.error(e)
		return error(e)
	},
})
	// requests to /connect are routed to the Durable Object, and handle realtime websocket syncing
	.get('/api/connect/:roomId', (request, env) => {
		const id = env.TLDRAW_DURABLE_OBJECT.idFromName(request.params.roomId)
		const room = env.TLDRAW_DURABLE_OBJECT.get(id)
		return room.fetch(request.url, { headers: request.headers, body: request.body })
	})
    // Metadata requests are also routed to the Durable Object
    .get('/api/meta/:roomId', (request, env) => {
        const id = env.TLDRAW_DURABLE_OBJECT.idFromName(request.params.roomId)
        const room = env.TLDRAW_DURABLE_OBJECT.get(id)
        return room.fetch(request.url, { headers: request.headers, body: request.body })
    })
    .post('/api/meta/:roomId', (request, env) => {
        const id = env.TLDRAW_DURABLE_OBJECT.idFromName(request.params.roomId)
        const room = env.TLDRAW_DURABLE_OBJECT.get(id)
        return room.fetch(request.url, { method: request.method, headers: request.headers, body: request.body })
    })
	// requests to /color_rm/connect are routed to the ColorRm Durable Object
	.get('/api/color_rm/connect/:roomId', (request, env) => {
		const id = env.COLORM_DURABLE_OBJECT.idFromName(request.params.roomId)
		const room = env.COLORM_DURABLE_OBJECT.get(id)
		return room.fetch(request.url, { headers: request.headers, body: request.body })
	})

	// New routes for color_rm base file sync
	.post('/api/color_rm/upload/:roomId', handleColorRmUpload)
	.get('/api/color_rm/base_file/:roomId', handleColorRmDownload)

	// assets can be uploaded to the bucket under /uploads:
	.post('/api/uploads/:uploadId', handleAssetUpload)

	// they can be retrieved from the bucket too:
	.get('/api/uploads/:uploadId', handleAssetDownload)

	// bookmarks need to extract metadata from pasted URLs:
	.get('/api/unfurl', handleUnfurlRequest)
	.all('*', () => {
		return new Response('Not found', { status: 404 })
	})

export default {
	fetch: router.fetch,
}
