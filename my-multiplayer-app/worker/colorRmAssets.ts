import { IRequest } from 'itty-router'

export async function handleColorRmUpload(request: IRequest, env: Env) {
    const { roomId } = request.params
    console.log(`[handleColorRmUpload] Uploading base file for roomId: ${roomId}`);
    if (!roomId) {
        return new Response('Missing roomId', { status: 400 })
    }

    if (!request.body) {
        console.error(`[handleColorRmUpload] Missing request body for roomId: ${roomId}`);
        return new Response('Missing request body', { status: 400 })
    }

    const objectKey = `color_rm/base_files/${roomId}`
    const projectName = request.headers.get('x-project-name') ? decodeURIComponent(request.headers.get('x-project-name')!) : 'ColorRM Project'

    try {
        // Get the raw body data
        let bodyData = await request.arrayBuffer();

        // Check if the content type suggests it might be base64 encoded data
        const contentType = request.headers.get('content-type') || '';
        let finalData: ArrayBuffer;

        // If content type is application/json, it might contain base64 data from CapacitorHttp
        if (contentType.includes('application/json')) {
            // Parse the JSON to see if it contains base64 data
            const decoder = new TextDecoder();
            const jsonString = decoder.decode(bodyData);
            console.log(`[handleColorRmUpload] Received JSON content type, raw data length: ${bodyData.byteLength}, content sample: ${jsonString.substring(0, 200)}...`);
            try {
                const jsonData = JSON.parse(jsonString);
                console.log(`[handleColorRmUpload] Parsed JSON object:`, jsonData);

                // Check if the JSON has a 'data' field with base64 content (common CapacitorHttp format)
                if (jsonData.data && typeof jsonData.data === 'string') {
                    // Assume it's base64 encoded, decode it
                    console.log(`[handleColorRmUpload] Detected base64 data in JSON field, length: ${jsonData.data.length}, sample: ${jsonData.data.substring(0, 50)}...`);
                    const base64String = jsonData.data;

                    // Decode base64 to binary
                    const binaryString = atob(base64String);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    finalData = bytes.buffer;
                    console.log(`[handleColorRmUpload] Successfully decoded base64 to binary, size: ${bytes.length} bytes`);
                } else {
                    console.log(`[handleColorRmUpload] No 'data' field found in JSON, using raw body`);
                    // If not base64, use the original body
                    finalData = bodyData;
                }
            } catch (parseError) {
                console.log(`[handleColorRmUpload] JSON parsing failed: ${parseError.message}, using raw data`);
                // If JSON parsing fails, use the original body
                finalData = bodyData;
            }
        } else {
            console.log(`[handleColorRmUpload] Non-JSON content type (${contentType}), using raw body, size: ${bodyData.byteLength} bytes`);
            // For non-JSON content types, use the original body
            finalData = bodyData;
        }

        console.log(`[handleColorRmUpload] Storing base file to R2: ${objectKey}, project: ${projectName}, size: ${finalData.byteLength} bytes`);

        // Create headers with original content type if provided
        const storageHeaders = new Headers(request.headers);
        const originalContentType = request.headers.get('x-original-content-type');
        if (originalContentType) {
            storageHeaders.set('Content-Type', originalContentType);
        }

        // Convert ArrayBuffer to BufferSource for R2 storage
        const blob = new Blob([finalData]);
        await env.TLDRAW_BUCKET.put(objectKey, blob, {
            httpMetadata: storageHeaders,
            customMetadata: { name: projectName }
        })
        console.log(`[handleColorRmUpload] Upload successful for: ${objectKey}`);
        return new Response('Upload successful', { status: 200 })
    } catch (e: any) {
        console.error('Error uploading color_rm file:', e)
        return new Response('Error during upload', { status: 500 })
    }
}

export async function handleColorRmDownload(request: IRequest, env: Env) {
    const { roomId } = request.params
    console.log(`[handleColorRmDownload] Fetching base file for roomId: ${roomId}`);
    if (!roomId) {
        return new Response('Missing roomId', { status: 400 })
    }

    const objectKey = `color_rm/base_files/${roomId}`
    console.log(`[handleColorRmDownload] Object key: ${objectKey}`);

    try {
        const obj = await env.TLDRAW_BUCKET.get(objectKey)

        if (!obj) {
            console.log(`[handleColorRmDownload] Base file NOT FOUND for key: ${objectKey}`);
            return new Response('Base file not found', { status: 404 })
        }

        console.log(`[handleColorRmDownload] Base file FOUND, size: ${obj.size} bytes`);

        // Additional debugging: Check if the content looks like base64
        const buffer = await obj.arrayBuffer();
        const uint8Array = new Uint8Array(buffer.slice(0, 100)); // Check first 100 bytes
        const textSample = new TextDecoder().decode(uint8Array);

        // Check if it looks like base64 content (contains only base64 chars and padding)
        // But exclude common binary file headers like PDF (%PDF-), JPEG (ÿØÿ), PNG (‰PNG), etc.
        if (textSample.startsWith('%PDF-') ||
            (textSample.charCodeAt(0) === 0xFF && textSample.charCodeAt(1) === 0xD8) || // JPEG
            textSample.startsWith('\x89PNG') || // PNG
            textSample.startsWith('<svg')) {   // SVG
            // Recognized binary file header, not base64
            console.log(`[handleColorRmDownload] File appears to be proper binary data (recognized header). Sample: ${textSample.substring(0, 50)}...`);
        } else {
            // Check if it looks like base64 content (contains only base64 chars and padding)
            const base64Pattern = /^[A-Za-z0-9+/]{10,}/; // At least 10 chars to be considered base64
            if (base64Pattern.test(textSample.replace(/\s/g, ''))) {
                console.log(`[handleColorRmDownload] WARNING: File appears to be base64 encoded instead of binary! Sample: ${textSample.substring(0, 50)}...`);
            } else {
                console.log(`[handleColorRmDownload] File appears to be proper binary data. Sample: ${textSample.substring(0, 50)}...`);
            }
        }

        const headers = new Headers()
        obj.writeHttpMetadata(headers)
        headers.set('etag', obj.httpEtag)

        // Use the buffer we already read instead of obj.body to avoid stream disturbance
        return new Response(buffer, { headers })
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
        // Get the raw body data
        let bodyData = await request.arrayBuffer();

        // Check if the content type suggests it might be base64 encoded data
        const contentType = request.headers.get('content-type') || '';
        let finalData: ArrayBuffer;

        // If content type is application/json, it might contain base64 data
        if (contentType.includes('application/json')) {
            // Parse the JSON to see if it contains base64 data
            const decoder = new TextDecoder();
            const jsonString = decoder.decode(bodyData);
            console.log(`[PageUpload] Received JSON content type, raw data length: ${bodyData.byteLength}, content sample: ${jsonString.substring(0, 200)}...`);
            try {
                const jsonData = JSON.parse(jsonString);
                console.log(`[PageUpload] Parsed JSON object:`, jsonData);

                // Check if the JSON has a 'data' field with base64 content
                if (jsonData.data && typeof jsonData.data === 'string') {
                    // Assume it's base64 encoded, decode it
                    console.log(`[PageUpload] Detected base64 data in JSON field, length: ${jsonData.data.length}, sample: ${jsonData.data.substring(0, 50)}...`);
                    const base64String = jsonData.data;

                    // Decode base64 to binary
                    const binaryString = atob(base64String);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    finalData = bytes.buffer;
                    console.log(`[PageUpload] Successfully decoded base64 to binary, size: ${bytes.length} bytes`);
                } else {
                    console.log(`[PageUpload] No 'data' field found in JSON, using raw body`);
                    // If not base64, use the original body
                    finalData = bodyData;
                }
            } catch (parseError) {
                // If JSON parsing fails, use the original body
                console.log(`[PageUpload] JSON parsing failed: ${parseError.message}, using raw data`);
                finalData = bodyData;
            }
        } else {
            console.log(`[PageUpload] Non-JSON content type (${contentType}), using raw body, size: ${bodyData.byteLength} bytes`);
            // For non-JSON content types, use the original body
            finalData = bodyData;
        }

        // Create headers with original content type if provided
        const storageHeaders = new Headers(request.headers);
        const originalContentType = request.headers.get('x-original-content-type');
        if (originalContentType) {
            storageHeaders.set('Content-Type', originalContentType);
        }

        // Convert ArrayBuffer to BufferSource for R2 storage
        const blob = new Blob([finalData]);
        await env.TLDRAW_BUCKET.put(objectKey, blob, {
            httpMetadata: storageHeaders,
            customMetadata: { name: projectName, pageId: pageId }
        })
        console.log(`[PageUpload] Stored page: ${objectKey}, size: ${finalData.byteLength} bytes, original content type: ${originalContentType || 'unknown'}`)
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

        console.log(`[PageDownload] Page file FOUND for ${pageId}, size: ${obj.size} bytes`);

        // Additional debugging: Check if the content looks like base64
        const buffer = await obj.arrayBuffer();
        const uint8Array = new Uint8Array(buffer.slice(0, 100)); // Check first 100 bytes
        const textSample = new TextDecoder().decode(uint8Array);

        // Check if it looks like base64 content (contains only base64 chars and padding)
        // But exclude common binary file headers like PDF (%PDF-), JPEG (ÿØÿ), PNG (‰PNG), etc.
        if (textSample.startsWith('%PDF-') ||
            (textSample.charCodeAt(0) === 0xFF && textSample.charCodeAt(1) === 0xD8) || // JPEG
            textSample.startsWith('\x89PNG') || // PNG
            textSample.startsWith('<svg')) {   // SVG
            // Recognized binary file header, not base64
            console.log(`[PageDownload] Page ${pageId} appears to be proper binary data (recognized header). Sample: ${textSample.substring(0, 50)}...`);
        } else {
            // Check if it looks like base64 content (contains only base64 chars and padding)
            const base64Pattern = /^[A-Za-z0-9+/]{10,}/; // At least 10 chars to be considered base64
            if (base64Pattern.test(textSample.replace(/\s/g, ''))) {
                console.log(`[PageDownload] WARNING: Page ${pageId} appears to be base64 encoded instead of binary! Sample: ${textSample.substring(0, 50)}...`);
            } else {
                console.log(`[PageDownload] Page ${pageId} appears to be proper binary data. Sample: ${textSample.substring(0, 50)}...`);
            }
        }

        const headers = new Headers()
        obj.writeHttpMetadata(headers)
        headers.set('etag', obj.httpEtag)

        // Use the buffer we already read instead of obj.body to avoid stream disturbance
        return new Response(buffer, { headers })
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

// =============================================
// PAGE HISTORY API
// Store base history (from SVG imports) in R2
// Liveblocks only syncs deltas (new strokes)
// =============================================

// Upload base history for a page (used for SVG imports)
export async function handleColorRmHistoryUpload(request: IRequest, env: Env) {
    const { roomId, pageId } = request.params
    if (!roomId || !pageId) {
        return new Response('Missing roomId or pageId', { status: 400 })
    }

    if (!request.body) {
        return new Response('Missing request body', { status: 400 })
    }

    const objectKey = `color_rm/history/${roomId}/${pageId}`

    try {
        const body = await request.text()
        // Validate it's valid JSON array
        const parsed = JSON.parse(body)
        if (!Array.isArray(parsed)) {
            return new Response('History must be an array', { status: 400 })
        }

        await env.TLDRAW_BUCKET.put(objectKey, body, {
            httpMetadata: { contentType: 'application/json' }
        })
        console.log(`[HistoryUpload] Stored ${parsed.length} items for page: ${pageId}`)
        return new Response(JSON.stringify({ success: true, count: parsed.length }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        })
    } catch (e: any) {
        console.error('Error uploading page history:', e)
        return new Response(JSON.stringify({ error: e.message }), { status: 500 })
    }
}

// Download base history for a page
export async function handleColorRmHistoryDownload(request: IRequest, env: Env) {
    const { roomId, pageId } = request.params
    if (!roomId || !pageId) {
        return new Response('Missing roomId or pageId', { status: 400 })
    }

    const objectKey = `color_rm/history/${roomId}/${pageId}`

    try {
        const obj = await env.TLDRAW_BUCKET.get(objectKey)

        if (!obj) {
            // No base history - return empty array
            return new Response('[]', {
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
        console.error('Error downloading page history:', e)
        return new Response(JSON.stringify({ error: e.message }), { status: 500 })
    }
}

// Delete base history for a page
export async function handleColorRmHistoryDelete(request: IRequest, env: Env) {
    const { roomId, pageId } = request.params
    if (!roomId || !pageId) {
        return new Response('Missing roomId or pageId', { status: 400 })
    }

    const objectKey = `color_rm/history/${roomId}/${pageId}`

    try {
        await env.TLDRAW_BUCKET.delete(objectKey)
        console.log('Deleted page history:', objectKey)
        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        })
    } catch (e: any) {
        console.error('Error deleting page history:', e)
        return new Response(JSON.stringify({ error: e.message }), { status: 500 })
    }
}

// =============================================
// MODIFICATIONS API - R2 STORAGE FOR LARGE MODS
// Used when modification count exceeds Liveblocks limits
// =============================================

// Upload modifications for a page (used when >50 modifications)
export async function handleColorRmModificationsUpload(request: IRequest, env: Env) {
    const { roomId, pageId } = request.params
    if (!roomId || !pageId) {
        return new Response('Missing roomId or pageId', { status: 400 })
    }

    if (!request.body) {
        return new Response('Missing request body', { status: 400 })
    }

    const objectKey = `color_rm/modifications/${roomId}/${pageId}`

    try {
        const body = await request.text()
        // Validate it's valid JSON
        const parsed = JSON.parse(body)

        await env.TLDRAW_BUCKET.put(objectKey, body, {
            httpMetadata: { contentType: 'application/json' }
        })
        const modCount = parsed.modifications ? Object.keys(parsed.modifications).length : 0
        console.log(`[ModificationsUpload] Stored ${modCount} modifications for page: ${pageId}`)
        return new Response(JSON.stringify({ success: true, count: modCount }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        })
    } catch (e: any) {
        console.error('Error uploading page modifications:', e)
        return new Response(JSON.stringify({ error: e.message }), { status: 500 })
    }
}

// Download modifications for a page
export async function handleColorRmModificationsDownload(request: IRequest, env: Env) {
    const { roomId, pageId } = request.params
    if (!roomId || !pageId) {
        return new Response('Missing roomId or pageId', { status: 400 })
    }

    const objectKey = `color_rm/modifications/${roomId}/${pageId}`

    try {
        const obj = await env.TLDRAW_BUCKET.get(objectKey)

        if (!obj) {
            // No modifications - return empty object
            return new Response(JSON.stringify({ modifications: {}, timestamp: 0 }), {
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
        console.error('Error downloading page modifications:', e)
        return new Response(JSON.stringify({ error: e.message }), { status: 500 })
    }
}

// Delete modifications for a page
export async function handleColorRmModificationsDelete(request: IRequest, env: Env) {
    const { roomId, pageId } = request.params
    if (!roomId || !pageId) {
        return new Response('Missing roomId or pageId', { status: 400 })
    }

    const objectKey = `color_rm/modifications/${roomId}/${pageId}`

    try {
        await env.TLDRAW_BUCKET.delete(objectKey)
        console.log('Deleted page modifications:', objectKey)
        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        })
    } catch (e: any) {
        console.error('Error deleting page modifications:', e)
        return new Response(JSON.stringify({ error: e.message }), { status: 500 })
    }
}
