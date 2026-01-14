/**
 * PDF to SVG Conversion Server
 *
 * Runs alongside the Vite dev server on HuggingFace Spaces.
 * Handles PDF to SVG conversion using the pdf2svg binary.
 *
 * Endpoints:
 * - POST /convert/pdf - Upload PDF and get SVG pages
 * - GET /convert/status/:jobId - Check job status
 * - GET /convert/page/:jobId/:pageNum - Download a converted SVG page
 */

import http from 'http';
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const PORT = process.env.PDF_CONVERT_PORT || 7861;
const TEMP_DIR = path.join(os.tmpdir(), 'pdf_convert');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Job storage
const jobs = new Map();

/**
 * Parse multipart form data (simple implementation for file upload)
 */
function parseMultipart(buffer, boundary) {
    const parts = [];
    const boundaryBuffer = Buffer.from(`--${boundary}`);
    let start = buffer.indexOf(boundaryBuffer);

    while (start !== -1) {
        const end = buffer.indexOf(boundaryBuffer, start + boundaryBuffer.length);
        if (end === -1) break;

        const part = buffer.slice(start + boundaryBuffer.length, end);
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
            const headers = part.slice(0, headerEnd).toString();
            const content = part.slice(headerEnd + 4, part.length - 2); // -2 for trailing \r\n

            const nameMatch = headers.match(/name="([^"]+)"/);
            const filenameMatch = headers.match(/filename="([^"]+)"/);

            if (nameMatch) {
                parts.push({
                    name: nameMatch[1],
                    filename: filenameMatch ? filenameMatch[1] : null,
                    content: content
                });
            }
        }
        start = end;
    }
    return parts;
}

/**
 * Get PDF page count using pdfinfo or pdf2svg
 */
function getPdfPageCount(pdfPath) {
    try {
        // Try pdfinfo first
        const output = execSync(`pdfinfo "${pdfPath}" 2>/dev/null | grep -i "Pages:" | awk '{print $2}'`, { encoding: 'utf8' });
        const count = parseInt(output.trim(), 10);
        if (!isNaN(count)) return count;
    } catch (e) {
        // pdfinfo not available, try alternative method
    }

    try {
        // Try using pdf2svg on page 1 to check if it works, then binary search for count
        // This is a fallback if pdfinfo isn't available
        let maxPage = 1;
        let testPage = 1;

        // Test increasing pages until we fail
        while (testPage <= 1000) {
            const testOutput = path.join(TEMP_DIR, `test_${Date.now()}.svg`);
            try {
                execSync(`pdf2svg "${pdfPath}" "${testOutput}" ${testPage} 2>/dev/null`, { encoding: 'utf8' });
                fs.unlinkSync(testOutput);
                maxPage = testPage;
                testPage++;
            } catch (e) {
                break;
            }
        }
        return maxPage;
    } catch (e) {
        console.error('Failed to get page count:', e.message);
        return 1;
    }
}

/**
 * Convert a single PDF page to SVG
 */
async function convertPage(pdfPath, pageNum, outputPath) {
    return new Promise((resolve, reject) => {
        const proc = spawn('pdf2svg', [pdfPath, outputPath, String(pageNum)]);

        let stderr = '';
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (code === 0 && fs.existsSync(outputPath)) {
                resolve(outputPath);
            } else {
                reject(new Error(`pdf2svg failed: ${stderr || 'Unknown error'}`));
            }
        });

        proc.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Process a PDF conversion job
 */
async function processJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) return;

    job.status = 'processing';
    job.updatedAt = Date.now();

    try {
        // Get page count
        const pageCount = getPdfPageCount(job.pdfPath);
        job.pageCount = pageCount;

        // Convert each page
        for (let i = 1; i <= pageCount; i++) {
            const outputPath = path.join(job.outputDir, `page_${i}.svg`);
            await convertPage(job.pdfPath, i, outputPath);
            job.processedPages = i;
            job.updatedAt = Date.now();
            console.log(`[PDF Convert] Job ${jobId}: Page ${i}/${pageCount} converted`);
        }

        job.status = 'completed';
        job.updatedAt = Date.now();
        console.log(`[PDF Convert] Job ${jobId}: Completed - ${pageCount} pages`);

    } catch (e) {
        job.status = 'failed';
        job.error = e.message;
        job.updatedAt = Date.now();
        console.error(`[PDF Convert] Job ${jobId}: Failed -`, e.message);
    }
}

/**
 * Handle HTTP requests
 */
async function handleRequest(req, res) {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Health check
    if (url.pathname === '/convert/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', pdf2svg: true }));
        return;
    }

    // Upload PDF
    if (req.method === 'POST' && url.pathname === '/convert/pdf') {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', async () => {
            try {
                const buffer = Buffer.concat(chunks);
                const contentType = req.headers['content-type'] || '';

                let pdfBuffer;

                if (contentType.includes('multipart/form-data')) {
                    const boundary = contentType.split('boundary=')[1];
                    const parts = parseMultipart(buffer, boundary);
                    const filePart = parts.find(p => p.filename && p.filename.endsWith('.pdf'));
                    if (!filePart) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'No PDF file found' }));
                        return;
                    }
                    pdfBuffer = filePart.content;
                } else if (contentType === 'application/pdf') {
                    pdfBuffer = buffer;
                } else {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid content type' }));
                    return;
                }

                // Create job
                const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const jobDir = path.join(TEMP_DIR, jobId);
                fs.mkdirSync(jobDir, { recursive: true });

                const pdfPath = path.join(jobDir, 'source.pdf');
                fs.writeFileSync(pdfPath, pdfBuffer);

                const job = {
                    id: jobId,
                    status: 'pending',
                    pageCount: 0,
                    processedPages: 0,
                    pdfPath: pdfPath,
                    outputDir: jobDir,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                };

                jobs.set(jobId, job);

                // Start processing async
                processJob(jobId);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    jobId,
                    status: 'pending',
                    statusUrl: `/convert/status/${jobId}`
                }));

            } catch (e) {
                console.error('Upload error:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // Check job status
    const statusMatch = url.pathname.match(/^\/convert\/status\/(.+)$/);
    if (req.method === 'GET' && statusMatch) {
        const jobId = statusMatch[1];
        const job = jobs.get(jobId);

        if (!job) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Job not found' }));
            return;
        }

        const pages = [];
        if (job.status === 'completed' || job.processedPages > 0) {
            for (let i = 1; i <= job.processedPages; i++) {
                pages.push({
                    page: i,
                    url: `/convert/page/${jobId}/${i}`
                });
            }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            id: job.id,
            status: job.status,
            pageCount: job.pageCount,
            processedPages: job.processedPages,
            error: job.error,
            pages: pages
        }));
        return;
    }

    // Download page
    const pageMatch = url.pathname.match(/^\/convert\/page\/(.+)\/(\d+)$/);
    if (req.method === 'GET' && pageMatch) {
        const jobId = pageMatch[1];
        const pageNum = parseInt(pageMatch[2], 10);
        const job = jobs.get(jobId);

        if (!job) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Job not found' }));
            return;
        }

        const svgPath = path.join(job.outputDir, `page_${pageNum}.svg`);
        if (!fs.existsSync(svgPath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Page not found' }));
            return;
        }

        const svgContent = fs.readFileSync(svgPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        res.end(svgContent);
        return;
    }

    // 404 for unknown routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
}

// Create server
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
    console.log(`[PDF Convert Server] Running on port ${PORT}`);
    console.log(`[PDF Convert Server] Endpoints:`);
    console.log(`  POST /convert/pdf - Upload PDF file`);
    console.log(`  GET /convert/status/:jobId - Check job status`);
    console.log(`  GET /convert/page/:jobId/:pageNum - Download SVG page`);
});

// Cleanup old jobs periodically (every 30 minutes)
setInterval(() => {
    const now = Date.now();
    const maxAge = 2 * 60 * 60 * 1000; // 2 hours

    for (const [jobId, job] of jobs.entries()) {
        if (now - job.createdAt > maxAge) {
            // Clean up files
            try {
                if (fs.existsSync(job.outputDir)) {
                    fs.rmSync(job.outputDir, { recursive: true, force: true });
                }
            } catch (e) {
                console.error(`[PDF Convert] Failed to cleanup job ${jobId}:`, e.message);
            }
            jobs.delete(jobId);
            console.log(`[PDF Convert] Cleaned up old job: ${jobId}`);
        }
    }
}, 30 * 60 * 1000);
