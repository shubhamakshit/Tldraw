import { handleUnfurlRequest } from 'cloudflare-workers-unfurl'
import { AutoRouter, error, IRequest } from 'itty-router'
import { handleAssetDownload, handleAssetUpload } from './assetUploads'
import { handleColorRmDownload, handleColorRmUpload } from './colorRmAssets'
import { Liveblocks } from '@liveblocks/node'

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
    .get('/api/hello', () => new Response('Hello from Worker!'))
    .get('/_storage-info', async (request, env) => {
        const list = await env.TLDRAW_BUCKET.list();
        return new Response(JSON.stringify(list.objects, null, 2), { headers: { 'Content-Type': 'application/json' } });
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

    // Storage Info Route
    .get('/api/storage-info', async (request, env) => {
        console.log("Worker: Received request for /api/storage-info");
        try {
            const list = await env.TLDRAW_BUCKET.list();
            const objects = list.objects.map(obj => ({
                key: obj.key,
                size: obj.size,
                uploaded: obj.uploaded
            }));
            
            return new Response(JSON.stringify({
                bucket: env.TLDRAW_BUCKET.constructor.name,
                total_objects: objects.length,
                objects: objects
            }, null, 2), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    })

    // Liveblocks Auth
	.post('/api/liveblocks-auth', async (request, env) => {
		if (!env.LIVEBLOCKS_SECRET_KEY) {
			return new Response('Missing LIVEBLOCKS_SECRET_KEY', { status: 500 })
		}
		
		const liveblocks = new Liveblocks({
			secret: env.LIVEBLOCKS_SECRET_KEY,
		})

		// Generate random user for anonymous access
		const userId = `user_${Math.random().toString(36).substring(2, 9)}`;
        const userInfo = {
            name: "Anonymous",
            color: "#" + Math.floor(Math.random()*16777215).toString(16)
        };

		const session = liveblocks.prepareSession(
			userId,
			{ userInfo }
		)

        // Parse body to get room ID
        let room;
        try {
            const body = await request.json() as any;
            room = body.room;
        } catch(e) {}

        if (room) {
            session.allow(room, session.FULL_ACCESS);
        }

		const { status, body } = await session.authorize()
		return new Response(body, { status })
	})

	// New routes for color_rm base file sync
	.post('/api/color_rm/upload/:roomId', handleColorRmUpload)
	.get('/api/color_rm/base_file/:roomId', handleColorRmDownload)

    // Storage Info Route
    .get('/api/storage-info', async (request, env) => {
        console.log("Worker: Received request for /api/storage-info");
        try {
            const list = await env.TLDRAW_BUCKET.list();
            const objects = list.objects.map(obj => ({
                key: obj.key,
                size: obj.size,
                uploaded: obj.uploaded
            }));
            
            return new Response(JSON.stringify({
                bucket: env.TLDRAW_BUCKET.constructor.name,
                total_objects: objects.length,
                objects: objects
            }, null, 2), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    })

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
