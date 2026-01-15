import { handleUnfurlRequest } from 'cloudflare-workers-unfurl'
import { AutoRouter, error, IRequest } from 'itty-router'
import { handleAssetDownload, handleAssetUpload } from './assetUploads'
import { handleColorRmDownload, handleColorRmUpload, handleColorRmDelete, handleColorRmPageUpload, handleColorRmPageDownload, handleColorRmPageDelete, handleGetPageStructure, handleSetPageStructure, handleListPages, handleColorRmHistoryUpload, handleColorRmHistoryDownload, handleColorRmHistoryDelete, handleColorRmModificationsUpload, handleColorRmModificationsDownload, handleColorRmModificationsDelete } from './colorRmAssets'
import { handlePdfUpload, handlePdfJobStatus, handlePdfPageDownload, handlePdfJobDelete } from './pdfToSvg'
import { Liveblocks } from '@liveblocks/node'

// make sure our sync durable object is made available to cloudflare
export { TldrawDurableObject } from './TldrawDurableObject'
export { ColorRmDurableObject } from './ColorRmDurableObject'
export { YjsDurableObject } from './YjsDurableObject'

// we use itty-router (https://itty.dev/) to handle routing. in this example we turn on CORS because
// we're hosting the worker separately to the client. you should restrict this to your own domain.
const router = AutoRouter<IRequest, [env: Env, ctx: ExecutionContext]>({
	catch: (e) => {
		console.error(e)
		return error(e)
	},
})
    .get('/api/hello', () => new Response('Hello from Worker!'))
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
	// Yjs WebSocket connections for beta sync (routed to YjsDurableObject)
	.get('/yjs/:roomId', (request, env) => {
		const id = env.YJS_DURABLE_OBJECT.idFromName(request.params.roomId)
		const room = env.YJS_DURABLE_OBJECT.get(id)
		return room.fetch(request.url, { headers: request.headers, body: request.body })
	})

    // Maintainer Stats Route
    .get('/api/maintainer/stats', async (_request, env) => {
        try {
            const list = await env.TLDRAW_BUCKET.list();
            let totalSize = 0;
            const objects = list.objects.map(obj => {
                totalSize += obj.size;
                return {
                    key: obj.key,
                    size: obj.size,
                    uploaded: obj.uploaded
                };
            });

            return new Response(JSON.stringify({
                status: "ok",
                r2: {
                    bucket_name: "TLDRAW_BUCKET",
                    object_count: objects.length,
                    total_size_bytes: totalSize,
                    objects: objects.slice(0, 100)
                },
                environment: {
                    platform: "Cloudflare Workers",
                    uptime: performance.now()
                }
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    })

    // Maintainer: List Rooms
    .get('/api/maintainer/rooms', async (_request, env) => {
        try {
            // 1. Get Tldraw Rooms (Prefix: rooms/)
            const tldrawList = await env.TLDRAW_BUCKET.list({ prefix: 'rooms/', include: ['customMetadata'] });
            const tldrawRooms = tldrawList.objects.map(obj => ({
                id: obj.key.replace('rooms/', ''),
                name: obj.customMetadata?.name || 'Untitled Board',
                lastUsed: obj.uploaded
            }));

            // 2. Get ColorRM Rooms (Prefix: color_rm/base_files/)
            const colorRmList = await env.TLDRAW_BUCKET.list({ prefix: 'color_rm/base_files/', include: ['customMetadata'] });
            const colorRmRooms = colorRmList.objects.map(obj => ({
                id: obj.key.replace('color_rm/base_files/', ''),
                name: obj.customMetadata?.name || 'ColorRM Project',
                lastUsed: obj.uploaded
            }));

            return new Response(JSON.stringify({
                tldraw: tldrawRooms,
                color_rm: colorRmRooms
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    })

    // Maintainer: Delete R2 Object
    .delete('/api/maintainer/r2/:key', async (request, env) => {
        try {
            const key = decodeURIComponent(request.params.key);
            await env.TLDRAW_BUCKET.delete(key);
            return new Response(JSON.stringify({ success: true }));
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    })

    // Maintainer: Nuke DO Storage
    .post('/api/maintainer/nuke-do/:type/:roomId', async (request, env) => {
        try {
            const { type, roomId } = request.params;
            let doNamespace;
            if (type === 'tldraw') doNamespace = env.TLDRAW_DURABLE_OBJECT;
            else if (type === 'color_rm') doNamespace = env.COLORM_DURABLE_OBJECT;
            else throw new Error("Invalid DO type");

            const id = doNamespace.idFromName(roomId);
            const stub = doNamespace.get(id);
            
            // We'll send a special internal header/request to the DO to tell it to nuke itself
            return stub.fetch('http://do/internal/nuke', { method: 'POST' });
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

        try {
            // Race condition to prevent worker hanging indefinitely
            const authPromise = session.authorize();
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Auth timed out")), 5000)
            );

            const { status, body } = await Promise.race([authPromise, timeoutPromise]) as any;
            return new Response(body, { status });
        } catch (e: any) {
            console.error("Liveblocks Auth Error:", e);
            return new Response(JSON.stringify({ error: e.message || "Auth Failed" }), { status: 500 });
        }
    })

    // --- Authentication Routes ---

    .post('/api/auth/register', async (request, env) => {
        try {
            const { username, password } = await request.json() as any;
            if (!username || !password) return new Response('Missing username or password', { status: 400 });

            const existing = await env.TLDRAW_USERS_KV.get(`user:${username}`);
            if (existing) return new Response('Username already taken', { status: 409 });

            // Simple SHA-256 hash for the password
            const msgBuffer = new TextEncoder().encode(password);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashHex = hashArray(hashBuffer);

            await env.TLDRAW_USERS_KV.put(`user:${username}`, JSON.stringify({
                passwordHash: hashHex,
                created: Date.now()
            }));

            return new Response(JSON.stringify({ success: true, username }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    })

    .post('/api/auth/login', async (request, env) => {
        try {
            const { username, password } = await request.json() as any;
            if (!username || !password) return new Response('Missing credentials', { status: 400 });

            const userStr = await env.TLDRAW_USERS_KV.get(`user:${username}`);
            if (!userStr) return new Response('Invalid credentials', { status: 401 });

            const user = JSON.parse(userStr);

            // Hash input to compare
            const msgBuffer = new TextEncoder().encode(password);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashHex = hashArray(hashBuffer);

            if (hashHex !== user.passwordHash) {
                return new Response('Invalid credentials', { status: 401 });
            }

            // Generate Token
            const token = crypto.randomUUID();
            // Store token -> username mapping, valid for 7 days
            await env.TLDRAW_USERS_KV.put(`token:${token}`, username, { expirationTtl: 60 * 60 * 24 * 7 });

            return new Response(JSON.stringify({ token, username }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    })

    // --- Backup & Restore Routes ---

    .post('/api/backup', async (request, env) => {
        const auth = await authenticate(request, env);
        if (!auth) return new Response('Unauthorized', { status: 401 });

        try {
            const { snapshot, roomName, roomId, type } = await request.json() as any;
            const timestamp = Date.now();
            // Safe key generation
            const safeName = (roomName || 'Untitled').replace(/[^a-zA-Z0-9-]/g, '_');
            const key = `backups/${auth.username}/${timestamp}_${safeName}.json`;

            await env.TLDRAW_BUCKET.put(key, JSON.stringify(snapshot), {
                customMetadata: {
                    originalId: roomId,
                    roomName: roomName,
                    type: type || 'tldraw',
                    backupDate: new Date().toISOString()
                }
            });

            return new Response(JSON.stringify({ success: true, key }), { headers: { 'Content-Type': 'application/json' }});
        } catch (e: any) {
             return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    })

    .get('/api/backups', async (request, env) => {
        const auth = await authenticate(request, env);
        if (!auth) return new Response('Unauthorized', { status: 401 });

        try {
            const prefix = `backups/${auth.username}/`;
            const list = await env.TLDRAW_BUCKET.list({ prefix, include: ['customMetadata'] });

            const backups = list.objects.map(obj => ({
                key: obj.key,
                name: obj.customMetadata?.roomName || obj.key.split('_').pop()?.replace('.json', '') || 'Unknown',
                date: obj.uploaded,
                size: obj.size,
                type: obj.customMetadata?.type || 'tldraw',
                originalId: obj.customMetadata?.originalId
            })).sort((a, b) => b.date.getTime() - a.date.getTime());

            return new Response(JSON.stringify({ backups }), { headers: { 'Content-Type': 'application/json' }});
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    })

    .delete('/api/backup/:key', async (request, env) => {
        const auth = await authenticate(request, env);
        if (!auth) return new Response('Unauthorized', { status: 401 });

        const key = decodeURIComponent(request.params.key);

        // Security check: Ensure user is only accessing their own backups
        if (!key.startsWith(`backups/${auth.username}/`)) {
             return new Response('Forbidden', { status: 403 });
        }

        try {
            await env.TLDRAW_BUCKET.delete(key);
            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' }});
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    })

    .get('/api/backup/:key', async (request, env) => {
        const auth = await authenticate(request, env);
        if (!auth) return new Response('Unauthorized', { status: 401 });

        const key = decodeURIComponent(request.params.key);

        // Security check: Ensure user is only accessing their own backups
        if (!key.startsWith(`backups/${auth.username}/`)) {
             return new Response('Forbidden', { status: 403 });
        }

        const obj = await env.TLDRAW_BUCKET.get(key);
        if (!obj) return new Response('Not found', { status: 404 });

        return new Response(obj.body, { headers: { 'Content-Type': 'application/json' }});
    })

	// New routes for color_rm base file sync
	.post('/api/color_rm/upload/:roomId', handleColorRmUpload)
	.get('/api/color_rm/base_file/:roomId', handleColorRmDownload)
	.delete('/api/color_rm/base_file/:roomId', handleColorRmDelete)

	// UUID-based page routes (pageId can be "pdf_0", "pdf_1", "user_abc123", etc.)
	.post('/api/color_rm/page/:roomId/:pageId', handleColorRmPageUpload)
	.get('/api/color_rm/page/:roomId/:pageId', handleColorRmPageDownload)
	.delete('/api/color_rm/page/:roomId/:pageId', handleColorRmPageDelete)

	// Page structure API - ordered list of page IDs
	.get('/api/color_rm/page_structure/:roomId', handleGetPageStructure)
	.post('/api/color_rm/page_structure/:roomId', handleSetPageStructure)
	.get('/api/color_rm/pages/:roomId', handleListPages)

	// Page history API - base history stored in R2 (for SVG imports)
	// Liveblocks only syncs deltas, base history is fetched from R2
	.post('/api/color_rm/history/:roomId/:pageId', handleColorRmHistoryUpload)
	.get('/api/color_rm/history/:roomId/:pageId', handleColorRmHistoryDownload)
	.delete('/api/color_rm/history/:roomId/:pageId', handleColorRmHistoryDelete)

	// Page modifications API - R2 storage for large modification sets
	// Used when modification count exceeds Liveblocks limits (>50 items)
	.post('/api/color_rm/modifications/:roomId/:pageId', handleColorRmModificationsUpload)
	.get('/api/color_rm/modifications/:roomId/:pageId', handleColorRmModificationsDownload)
	.delete('/api/color_rm/modifications/:roomId/:pageId', handleColorRmModificationsDelete)

	// --- PDF to SVG Conversion (Experimental) ---
	// Upload PDF and create conversion job
	.post('/api/color_rm/pdf/:roomId', handlePdfUpload)
	// Get job status
	.get('/api/color_rm/pdf/:roomId/job/:jobId', handlePdfJobStatus)
	// Download converted SVG page
	.get('/api/color_rm/pdf/:roomId/job/:jobId/page/:pageNum', handlePdfPageDownload)
	// Delete job and all files
	.delete('/api/color_rm/pdf/:roomId/job/:jobId', handlePdfJobDelete)

    // --- Color RM Registry Routes ---

    // Clear all projects from registry (for debugging/maintenance)
    .delete('/api/color_rm/registry', async (request, env) => {
        const auth = await authenticate(request, env);
        if (!auth) return new Response('Unauthorized', { status: 401 });

        try {
            const registryKey = `registry:${auth.username}`;
            await env.TLDRAW_USERS_KV.put(registryKey, JSON.stringify([]));
            console.log('Registry cleared for user:', auth.username);
            return new Response(JSON.stringify({ success: true, message: 'Registry cleared' }), { headers: { 'Content-Type': 'application/json' }});
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    })

    .get('/api/color_rm/registry', async (request, env) => {
        const auth = await authenticate(request, env);
        if (!auth) return new Response('Unauthorized', { status: 401 });

        try {
            const registryStr = await env.TLDRAW_USERS_KV.get(`registry:${auth.username}`);
            const registry = registryStr ? JSON.parse(registryStr) : [];

            const foldersStr = await env.TLDRAW_USERS_KV.get(`folders:${auth.username}`);
            const folders = foldersStr ? JSON.parse(foldersStr) : [];

            return new Response(JSON.stringify({ projects: registry, folders: folders }), { headers: { 'Content-Type': 'application/json' }});
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    })

    .post('/api/color_rm/registry', async (request, env) => {
        const auth = await authenticate(request, env);
        if (!auth) return new Response('Unauthorized', { status: 401 });

        try {
            const { project } = await request.json() as any;
            if (!project || !project.id) return new Response('Invalid project data', { status: 400 });

            const registryKey = `registry:${auth.username}`;
            const registryStr = await env.TLDRAW_USERS_KV.get(registryKey);
            let registry = registryStr ? JSON.parse(registryStr) : [];

            // Upsert: Remove existing entry with same ID if present
            registry = registry.filter((p: any) => p.id !== project.id);
            // Add new/updated project
            registry.push(project);

            await env.TLDRAW_USERS_KV.put(registryKey, JSON.stringify(registry));

            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' }});
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    })

    .delete('/api/color_rm/registry/:projectId', async (request, env) => {
        const auth = await authenticate(request, env);
        if (!auth) return new Response('Unauthorized', { status: 401 });

        const projectId = request.params.projectId;
        console.log('DELETE registry request for project:', projectId, 'user:', auth.username);

        try {
            const registryKey = `registry:${auth.username}`;
            const registryStr = await env.TLDRAW_USERS_KV.get(registryKey);

            if (!registryStr) {
                console.log('Registry already empty for user:', auth.username);
                return new Response(JSON.stringify({ success: true, message: 'Registry already empty' }));
            }

            let registry = JSON.parse(registryStr);
            const initialLength = registry.length;
            registry = registry.filter((p: any) => p.id !== projectId);

            console.log('Registry before:', initialLength, 'after:', registry.length);

            if (registry.length !== initialLength) {
                await env.TLDRAW_USERS_KV.put(registryKey, JSON.stringify(registry));
                console.log('Registry updated for user:', auth.username);
            } else {
                console.log('Project not found in registry:', projectId);
            }

            return new Response(JSON.stringify({ success: true, deleted: initialLength !== registry.length }), { headers: { 'Content-Type': 'application/json' }});
        } catch (e: any) {
            console.error('Delete error:', e);
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    })

    // --- Folder Registry Routes ---

    .post('/api/color_rm/registry/folder', async (request, env) => {
        const auth = await authenticate(request, env);
        if (!auth) return new Response('Unauthorized', { status: 401 });

        try {
            const { folder } = await request.json() as any;
            if (!folder || !folder.id) return new Response('Invalid folder data', { status: 400 });

            const foldersKey = `folders:${auth.username}`;
            const foldersStr = await env.TLDRAW_USERS_KV.get(foldersKey);
            let folders = foldersStr ? JSON.parse(foldersStr) : [];

            // Upsert: Remove existing entry with same ID if present
            folders = folders.filter((f: any) => f.id !== folder.id);
            // Add new/updated folder
            folders.push(folder);

            await env.TLDRAW_USERS_KV.put(foldersKey, JSON.stringify(folders));

            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' }});
        } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    })

    .delete('/api/color_rm/registry/folder/:folderId', async (request, env) => {
        const auth = await authenticate(request, env);
        if (!auth) return new Response('Unauthorized', { status: 401 });

        const folderId = request.params.folderId;

        try {
            const foldersKey = `folders:${auth.username}`;
            const foldersStr = await env.TLDRAW_USERS_KV.get(foldersKey);
            if (!foldersStr) return new Response(JSON.stringify({ success: true })); // Already empty

            let folders = JSON.parse(foldersStr);
            const initialLength = folders.length;
            folders = folders.filter((f: any) => f.id !== folderId);

            if (folders.length !== initialLength) {
                await env.TLDRAW_USERS_KV.put(foldersKey, JSON.stringify(folders));
            }

            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' }});
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
	.all('*', (request) => {
        console.log(`[Worker] Route not found: ${request.method} ${request.url}`);
		return new Response('Not found', { status: 404 })
	})

export default {
	fetch: router.fetch,
}

// --- Helpers ---

async function authenticate(request: IRequest, env: Env) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

    const token = authHeader.split(' ')[1];
    const username = await env.TLDRAW_USERS_KV.get(`token:${token}`);
    if (!username) return null;

    return { username };
}

function hashArray(buffer: ArrayBuffer) {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}
