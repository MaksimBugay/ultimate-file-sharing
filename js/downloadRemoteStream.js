/**
 * Remote Stream Downloader
 * Downloads files from a remote source via a proxy server endpoint.
 */

/**
 * Extracts filename from Content-Disposition header or falls back to URL-based name.
 * @param {Headers} headers - Response headers
 * @param {string} sourceUrl - Original source URL
 * @returns {string} - Extracted or generated filename
 */
function extractFilename(headers, sourceUrl) {
    const contentDisposition = headers.get('Content-Disposition');

    if (contentDisposition) {
        // Try RFC 5987 encoded filename first (filename*=UTF-8''...)
        const utf8Match = contentDisposition.match(/filename\*=UTF-8''(.+?)(?:;|$)/i);
        if (utf8Match) {
            return decodeURIComponent(utf8Match[1]);
        }

        // Try standard filename with quotes
        const quotedMatch = contentDisposition.match(/filename="(.+?)"/i);
        if (quotedMatch) {
            return quotedMatch[1];
        }

        // Try filename without quotes
        const unquotedMatch = contentDisposition.match(/filename=([^;\s]+)/i);
        if (unquotedMatch) {
            return unquotedMatch[1];
        }
    }

    // Fallback: extract from URL
    try {
        const url = new URL(sourceUrl);
        const pathname = url.pathname;
        const segments = pathname.split('/').filter(Boolean);
        return segments.at(-1) || 'download';
    } catch {
        return 'download';
    }
}

/**
 * Downloads a file from a remote source via the server's download endpoint.
 *
 * @param {string} serverBaseUrl - Base URL of the download server (e.g., 'http://localhost:8000')
 * @param {string} sourceUrl - The source URL to download from
 * @param {function} responseHandler - Callback function: (blob, name) => void
 * @param errorHandler
 * @returns {Promise<void>}
 * @throws {Error} - Throws on network errors or HTTP errors
 *
 * @example
 * await downloadRemoteStream(
 *   'http://localhost:8000',
 *   'https://example.com/file.pdf',
 *   (blob, name) => {
 *     console.log(`Downloaded ${name}, size: ${blob.size}`);
 *   }
 * );
 */
async function downloadRemoteStream(serverBaseUrl, sourceUrl, responseHandler, errorHandler) {
    // Validate inputs
    if (!serverBaseUrl || typeof serverBaseUrl !== 'string') {
        throw new TypeError('serverBaseUrl must be a non-empty string');
    }

    if (!sourceUrl || typeof sourceUrl !== 'string') {
        throw new TypeError('sourceUrl must be a non-empty string');
    }

    if (typeof responseHandler !== 'function') {
        throw new TypeError('responseHandler must be a function');
    }

    // Build the download endpoint URL
    const normalizedBase = serverBaseUrl.replace(/\/+$/, '');
    const downloadUrl = new URL(`${normalizedBase}/download`);
    downloadUrl.searchParams.set('source_url', sourceUrl);

    // Fetch the file
    const response = await fetch(downloadUrl.toString(), {
        method: 'GET',
        credentials: 'same-origin',
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        if (typeof errorHandler === 'function') {
            errorHandler(errorText);
            return;
        } else {
            throw new Error(`Download failed: ${response.status} ${response.statusText} - ${errorText}`);
        }
    }

    const filename = extractFilename(response.headers, sourceUrl);

    const blob = await response.blob();

    // Call the response handler with blob and filename
    responseHandler(blob, filename);
}


async function sendDownloadRemoteStreamRequestToBinaryProxy(url, forHuman) {

    const dest = new ClientFilter(
        "PushcaCluster",
        "admin",
        "experimental-publisher-local",
        "BINARY-PROXY-CONNECTION-TO-PUSHER"
    );

    const request = {"url": url, "forHuman": forHuman};

    const response = await PushcaClient.sendGatewayRequest(
        dest,
        GatewayPath.PUBLISH_REMOTE_STREAM,
        stringToByteArray(JSON.stringify(request)),
        15 * 60_000
    );

    if (!response) {
        return null;
    }

    if ('error' === response) {
        return null;
    }

    try {
        const jsonResponseWrapper = JSON.parse(response);
        const responseBytes = base64ToArrayBuffer(jsonResponseWrapper.body);
        const responseStr = arrayBufferToString(responseBytes);
        const jsonObject = JSON.parse(responseStr);
        if (jsonObject.error) {
            alert(jsonObject.error);
        }
        return jsonObject.url;
    } catch (err) {
        console.warn(`Failed download remote stream ${url} attempt: ` + err);
        return null;
    }
}










