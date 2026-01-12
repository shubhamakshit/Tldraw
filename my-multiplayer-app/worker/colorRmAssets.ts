import { IRequest } from 'itty-router'

export async function handleColorRmUpload(request: IRequest, env: Env) {
    const { roomId } = request.params
    if (!roomId) {
        return new Response('Missing roomId', { status: 400 })
    }

    if (!request.body) {
        return new Response('Missing request body', { status: 400 })
    }

    const objectKey = `color_rm/base_files/${roomId}`
    const projectName = request.headers.get('x-project-name') ? decodeURIComponent(request.headers.get('x-project-name')!) : 'ColorRM Project'

    try {
        await env.TLDRAW_BUCKET.put(objectKey, request.body, {
            httpMetadata: request.headers,
            customMetadata: { name: projectName }
        })
        return new Response('Upload successful', { status: 200 })
    } catch (e: any) {
        console.error('Error uploading color_rm file:', e)
        return new Response('Error during upload', { status: 500 })
    }
}

export async function handleColorRmDownload(request: IRequest, env: Env) {
    const { roomId } = request.params
    if (!roomId) {
        return new Response('Missing roomId', { status: 400 })
    }

    const objectKey = `color_rm/base_files/${roomId}`

    try {
        const obj = await env.TLDRAW_BUCKET.get(objectKey)

        if (!obj) {
            return new Response('Base file not found', { status: 404 })
        }

        const headers = new Headers()
        obj.writeHttpMetadata(headers)
        headers.set('etag', obj.httpEtag)

        return new Response(obj.body, { headers })
    } catch (e: any) {
        console.error('Error downloading color_rm file:', e)
        return new Response('Error during download', { status: 500 })
    }
}

export async function handleColorRmDelete(request: IRequest, env: Env) {
    const { roomId } = request.params
    if (!roomId) {
        return new Response('Missing roomId', { status: 400 })
    }

    const objectKey = `color_rm/base_files/${roomId}`

    try {
        await env.TLDRAW_BUCKET.delete(objectKey)
        console.log('Deleted color_rm base file:', objectKey)
        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        })
    } catch (e: any) {
        console.error('Error deleting color_rm file:', e)
        return new Response(JSON.stringify({ error: e.message }), { status: 500 })
    }
}

// =============================================
// UUID-BASED PAGE SYSTEM
// Pages are stored by unique ID (not index)
// - PDF pages: "pdf_0", "pdf_1", etc.
// - User-added pages: UUID like "user_abc123"
// =============================================

// Upload a page by its unique ID (pageId)
export async function handleColorRmPageUpload(request: IRequest, env: Env) {
    const { roomId, pageId } = request.params
    if (!roomId || !pageId) {
        return new Response('Missing roomId or pageId', { status: 400 })
    }

    if (!request.body) {
        return new Response('Missing request body', { status: 400 })
    }

    // Store page by UUID, not index
    const objectKey = `color_rm/pages/${roomId}/${pageId}`
    const projectName = request.headers.get('x-project-name') ? decodeURIComponent(request.headers.get('x-project-name')!) : 'ColorRM Project'

    try {
        await env.TLDRAW_BUCKET.put(objectKey, request.body, {
            httpMetadata: request.headers,
            customMetadata: { name: projectName, pageId: pageId }
        })
        console.log(`[PageUpload] Stored page: ${objectKey}`)
        return new Response('Page upload successful', { status: 200 })
    } catch (e: any) {
        console.error('Error uploading color_rm page file:', e)
        return new Response('Error during page upload', { status: 500 })
    }
}

// Download a page by its unique ID (pageId)
export async function handleColorRmPageDownload(request: IRequest, env: Env) {
    const { roomId, pageId } = request.params
    if (!roomId || !pageId) {
        return new Response('Missing roomId or pageId', { status: 400 })
    }

    const objectKey = `color_rm/pages/${roomId}/${pageId}`

    try {
        const obj = await env.TLDRAW_BUCKET.get(objectKey)

        if (!obj) {
            console.log(`[PageDownload] Page not found: ${objectKey}`)
            return new Response('Page file not found', { status: 404 })
        }

        const headers = new Headers()
        obj.writeHttpMetadata(headers)
        headers.set('etag', obj.httpEtag)

        return new Response(obj.body, { headers })
    } catch (e: any) {
        console.error('Error downloading color_rm page file:', e)
        return new Response('Error during page download', { status: 500 })
    }
}

// Delete a page by its unique ID (pageId)
export async function handleColorRmPageDelete(request: IRequest, env: Env) {
    const { roomId, pageId } = request.params
    if (!roomId || !pageId) {
        return new Response('Missing roomId or pageId', { status: 400 })
    }

    const objectKey = `color_rm/pages/${roomId}/${pageId}`

    try {
        await env.TLDRAW_BUCKET.delete(objectKey)
        console.log('Deleted color_rm page file:', objectKey)
        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        })
    } catch (e: any) {
        console.error('Error deleting color_rm page file:', e)
        return new Response(JSON.stringify({ error: e.message }), { status: 500 })
    }
}

// =============================================
// PAGE STRUCTURE API
// Returns the ordered list of page IDs for a room
// Structure is stored in R2 as JSON
// =============================================

export async function handleGetPageStructure(request: IRequest, env: Env) {
    const { roomId } = request.params
    if (!roomId) {
        return new Response('Missing roomId', { status: 400 })
    }

    const objectKey = `color_rm/structure/${roomId}`

    try {
        const obj = await env.TLDRAW_BUCKET.get(objectKey)

        if (!obj) {
            // No structure yet - return empty array
            return new Response(JSON.stringify({
                pageIds: [],
                pdfPageCount: 0
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        }

        const data = await obj.text()
        return new Response(data, {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        })
    } catch (e: any) {
        console.error('Error getting page structure:', e)
        return new Response(JSON.stringify({ error: e.message }), { status: 500 })
    }
}

export async function handleSetPageStructure(request: IRequest, env: Env) {
    const { roomId } = request.params
    if (!roomId) {
        return new Response('Missing roomId', { status: 400 })
    }

    if (!request.body) {
        return new Response('Missing request body', { status: 400 })
    }

    const objectKey = `color_rm/structure/${roomId}`

    try {
        const body = await request.text()
        // Validate JSON
        const parsed = JSON.parse(body)
        if (!Array.isArray(parsed.pageIds)) {
            return new Response('Invalid structure: pageIds must be an array', { status: 400 })
        }

        await env.TLDRAW_BUCKET.put(objectKey, body, {
            httpMetadata: { contentType: 'application/json' }
        })

        console.log(`[PageStructure] Updated structure for ${roomId}: ${parsed.pageIds.length} pages`)
        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        })
    } catch (e: any) {
        console.error('Error setting page structure:', e)
        return new Response(JSON.stringify({ error: e.message }), { status: 500 })
    }
}

// List all page IDs stored for a room (for debugging/recovery)
export async function handleListPages(request: IRequest, env: Env) {
    const { roomId } = request.params
    if (!roomId) {
        return new Response('Missing roomId', { status: 400 })
    }

    const prefix = `color_rm/pages/${roomId}/`

    try {
        const list = await env.TLDRAW_BUCKET.list({ prefix })
        const pageIds = list.objects.map(obj => obj.key.replace(prefix, ''))

        return new Response(JSON.stringify({
            roomId,
            pageIds,
            count: pageIds.length
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        })
    } catch (e: any) {
        console.error('Error listing pages:', e)
        return new Response(JSON.stringify({ error: e.message }), { status: 500 })
    }
}
