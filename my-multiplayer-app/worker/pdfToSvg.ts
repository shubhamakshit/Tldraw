/**
 * PDF to SVG Conversion Handler (Experimental)
 *
 * This module handles server-side PDF to SVG conversion using external services
 * or libraries. Due to Cloudflare Workers limitations, we use a queue-based
 * approach for processing.
 *
 * Flow:
 * 1. Client uploads PDF
 * 2. Server stores PDF in R2 and creates a job
 * 3. Job processes PDF pages to SVG (via external service or scheduled task)
 * 4. Client polls for job status and downloads results
 */

interface PdfJob {
    id: string;
    roomId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    pageCount: number;
    processedPages: number;
    error?: string;
    createdAt: number;
    updatedAt: number;
}

interface Env {
    TLDRAW_BUCKET: R2Bucket;
}

/**
 * Upload a PDF file and create a conversion job
 */
export async function handlePdfUpload(request: Request, env: Env): Promise<Response> {
    try {
        const url = new URL(request.url);
        const roomId = url.pathname.split('/')[4]; // /api/color_rm/pdf/:roomId

        if (!roomId) {
            return new Response(JSON.stringify({ error: 'Room ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return new Response(JSON.stringify({ error: 'No file provided' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Generate job ID
        const jobId = `pdf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Store PDF in R2
        const pdfKey = `pdf_jobs/${roomId}/${jobId}/source.pdf`;
        await env.TLDRAW_BUCKET.put(pdfKey, file);

        // Create job metadata
        const job: PdfJob = {
            id: jobId,
            roomId,
            status: 'pending',
            pageCount: 0,
            processedPages: 0,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        // Store job metadata
        const jobKey = `pdf_jobs/${roomId}/${jobId}/job.json`;
        await env.TLDRAW_BUCKET.put(jobKey, JSON.stringify(job));

        // Note: Actual PDF processing would be triggered here
        // Options:
        // 1. Use a Queue (Cloudflare Queues) to process async
        // 2. Call an external PDF-to-SVG service API
        // 3. Use a scheduled worker with pdf.js or similar

        // For now, we return the job ID for the client to poll
        return new Response(JSON.stringify({
            jobId,
            status: 'pending',
            message: 'PDF uploaded. Processing will begin shortly.',
            pollUrl: `/api/color_rm/pdf/${roomId}/job/${jobId}`
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (e) {
        console.error('PDF upload error:', e);
        return new Response(JSON.stringify({ error: 'Upload failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

/**
 * Get job status
 */
export async function handlePdfJobStatus(request: Request, env: Env): Promise<Response> {
    try {
        const url = new URL(request.url);
        const parts = url.pathname.split('/');
        const roomId = parts[4];
        const jobId = parts[6];

        if (!roomId || !jobId) {
            return new Response(JSON.stringify({ error: 'Room ID and Job ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const jobKey = `pdf_jobs/${roomId}/${jobId}/job.json`;
        const jobObj = await env.TLDRAW_BUCKET.get(jobKey);

        if (!jobObj) {
            return new Response(JSON.stringify({ error: 'Job not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const job = JSON.parse(await jobObj.text()) as PdfJob;

        // List available SVG pages
        const svgPrefix = `pdf_jobs/${roomId}/${jobId}/pages/`;
        const listed = await env.TLDRAW_BUCKET.list({ prefix: svgPrefix });
        const pages = listed.objects
            .filter(obj => obj.key.endsWith('.svg'))
            .map(obj => {
                const pageNum = obj.key.match(/page_(\d+)\.svg/)?.[1];
                return pageNum ? parseInt(pageNum) : null;
            })
            .filter(n => n !== null)
            .sort((a, b) => (a as number) - (b as number));

        return new Response(JSON.stringify({
            ...job,
            availablePages: pages,
            downloadUrls: pages.map(p => `/api/color_rm/pdf/${roomId}/job/${jobId}/page/${p}`)
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (e) {
        console.error('Job status error:', e);
        return new Response(JSON.stringify({ error: 'Status check failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

/**
 * Download a converted SVG page
 */
export async function handlePdfPageDownload(request: Request, env: Env): Promise<Response> {
    try {
        const url = new URL(request.url);
        const parts = url.pathname.split('/');
        const roomId = parts[4];
        const jobId = parts[6];
        const pageNum = parts[8];

        if (!roomId || !jobId || !pageNum) {
            return new Response(JSON.stringify({ error: 'Room ID, Job ID, and page number required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const svgKey = `pdf_jobs/${roomId}/${jobId}/pages/page_${pageNum}.svg`;
        const svgObj = await env.TLDRAW_BUCKET.get(svgKey);

        if (!svgObj) {
            return new Response(JSON.stringify({ error: 'Page not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(await svgObj.text(), {
            headers: {
                'Content-Type': 'image/svg+xml',
                'Cache-Control': 'public, max-age=31536000'
            }
        });

    } catch (e) {
        console.error('Page download error:', e);
        return new Response(JSON.stringify({ error: 'Download failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

/**
 * Process a PDF job (called by scheduled worker or queue handler)
 * This is a placeholder - actual implementation depends on PDF library choice
 *
 * Options for PDF processing:
 * 1. pdf.js (Mozilla) - Can render to canvas, need to convert to SVG
 * 2. pdf2svg via external service (like AWS Lambda with pdf2svg binary)
 * 3. CloudConvert API or similar commercial service
 * 4. Self-hosted conversion service
 */
export async function processPdfJob(env: Env, roomId: string, jobId: string): Promise<void> {
    const jobKey = `pdf_jobs/${roomId}/${jobId}/job.json`;

    try {
        // Update status to processing
        const jobObj = await env.TLDRAW_BUCKET.get(jobKey);
        if (!jobObj) return;

        const job = JSON.parse(await jobObj.text()) as PdfJob;
        job.status = 'processing';
        job.updatedAt = Date.now();
        await env.TLDRAW_BUCKET.put(jobKey, JSON.stringify(job));

        // Get the PDF file
        const pdfKey = `pdf_jobs/${roomId}/${jobId}/source.pdf`;
        const pdfObj = await env.TLDRAW_BUCKET.get(pdfKey);
        if (!pdfObj) {
            throw new Error('PDF file not found');
        }

        // TODO: Implement actual PDF to SVG conversion
        // This would typically involve:
        // 1. Loading PDF with pdf.js or similar
        // 2. Rendering each page
        // 3. Converting to SVG format
        // 4. Storing each page as SVG in R2

        // For now, mark as completed (placeholder)
        job.status = 'completed';
        job.updatedAt = Date.now();
        await env.TLDRAW_BUCKET.put(jobKey, JSON.stringify(job));

    } catch (e) {
        // Update job with error
        const jobObj = await env.TLDRAW_BUCKET.get(jobKey);
        if (jobObj) {
            const job = JSON.parse(await jobObj.text()) as PdfJob;
            job.status = 'failed';
            job.error = e instanceof Error ? e.message : 'Unknown error';
            job.updatedAt = Date.now();
            await env.TLDRAW_BUCKET.put(jobKey, JSON.stringify(job));
        }
    }
}

/**
 * Delete a PDF job and all associated files
 */
export async function handlePdfJobDelete(request: Request, env: Env): Promise<Response> {
    try {
        const url = new URL(request.url);
        const parts = url.pathname.split('/');
        const roomId = parts[4];
        const jobId = parts[6];

        if (!roomId || !jobId) {
            return new Response(JSON.stringify({ error: 'Room ID and Job ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // List and delete all files for this job
        const prefix = `pdf_jobs/${roomId}/${jobId}/`;
        const listed = await env.TLDRAW_BUCKET.list({ prefix });

        for (const obj of listed.objects) {
            await env.TLDRAW_BUCKET.delete(obj.key);
        }

        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (e) {
        console.error('Job delete error:', e);
        return new Response(JSON.stringify({ error: 'Delete failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
