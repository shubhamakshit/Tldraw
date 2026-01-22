/**
 * Network Utilities - Shared helpers for network operations
 * Provides timeout-enabled fetch and consistent error handling
 */

/**
 * Fetch with timeout - wraps fetch with AbortController timeout
 * @param {string} url - The URL to fetch
 * @param {object} options - Fetch options
 * @param {number} timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error(`Request timeout after ${timeoutMs}ms: ${url}`);
        }
        throw error;
    }
}

/**
 * Fetch with retry - retries failed requests with exponential backoff
 * @param {string} url - The URL to fetch
 * @param {object} options - Fetch options
 * @param {number} maxRetries - Max retry attempts (default: 3)
 * @param {number} baseDelayMs - Base delay between retries (default: 1000)
 * @param {number} timeoutMs - Timeout per request (default: 30000)
 * @param {function} onRetry - Optional callback(attempt, error) called before each retry
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, maxRetries = 3, baseDelayMs = 1000, timeoutMs = 30000, onRetry = null) {
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fetchWithTimeout(url, options, timeoutMs);
        } catch (error) {
            lastError = error;

            if (attempt < maxRetries) {
                const delay = baseDelayMs * Math.pow(2, attempt);
                if (onRetry) {
                    onRetry(attempt + 1, error);
                }
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }

    throw lastError;
}

/**
 * Upload with progress - performs upload with progress callback
 * Uses XMLHttpRequest for progress events
 * @param {string} url - The URL to upload to
 * @param {FormData|Blob|string} data - The data to upload
 * @param {object} options - Options including headers, method, timeout
 * @param {function} onProgress - Progress callback(percent, loaded, total)
 * @returns {Promise<{status: number, response: any}>}
 */
export function uploadWithProgress(url, data, options = {}, onProgress = null) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const method = options.method || 'POST';
        const timeout = options.timeout || 120000; // 2 minute default for uploads

        xhr.open(method, url);

        // Set headers
        if (options.headers) {
            for (const [key, value] of Object.entries(options.headers)) {
                xhr.setRequestHeader(key, value);
            }
        }

        // Set timeout
        xhr.timeout = timeout;

        // Progress handler
        if (onProgress && xhr.upload) {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = (e.loaded / e.total) * 100;
                    onProgress(percent, e.loaded, e.total);
                }
            };
        }

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const response = xhr.responseText ? JSON.parse(xhr.responseText) : null;
                    resolve({ status: xhr.status, response });
                } catch {
                    resolve({ status: xhr.status, response: xhr.responseText });
                }
            } else {
                reject(new Error(`Upload failed with status ${xhr.status}: ${xhr.statusText}`));
            }
        };

        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.ontimeout = () => reject(new Error(`Upload timeout after ${timeout}ms`));
        xhr.onabort = () => reject(new Error('Upload aborted'));

        xhr.send(data);
    });
}

/**
 * Safe JSON fetch - fetches and parses JSON with error handling
 * @param {string} url - The URL to fetch
 * @param {object} options - Fetch options
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<{ok: boolean, data: any, error: string|null}>}
 */
export async function safeJsonFetch(url, options = {}, timeoutMs = 30000) {
    try {
        const response = await fetchWithTimeout(url, options, timeoutMs);

        if (!response.ok) {
            return {
                ok: false,
                data: null,
                error: `HTTP ${response.status}: ${response.statusText}`
            };
        }

        const data = await response.json();
        return { ok: true, data, error: null };
    } catch (error) {
        return {
            ok: false,
            data: null,
            error: error.message || 'Unknown network error'
        };
    }
}

// Default timeout constants
export const TIMEOUT = {
    SHORT: 10000,   // 10 seconds - for metadata/small requests
    MEDIUM: 30000,  // 30 seconds - default
    LONG: 60000,    // 60 seconds - for large operations
    UPLOAD: 120000  // 2 minutes - for file uploads
};
