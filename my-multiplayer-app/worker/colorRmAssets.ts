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
