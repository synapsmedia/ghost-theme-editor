import {getGhostPaths} from './paths.js';
import {GhostApiError, explainStatus} from './download.js';

/**
 * Upload a replacement theme ZIP to Ghost.
 *
 * CRITICAL (see ANALYSIS.md §4):
 *  - The uploaded filename MUST be `<themeName>.zip` — Ghost derives the theme
 *    name from `zip.name.split('.zip')[0]` in setFromZip, so a mismatch would
 *    create a differently-named theme instead of replacing the target.
 *  - The multipart field name MUST be `file` (multer `.single('file')`).
 *  - We must NOT set Content-Type on the fetch — the browser fills in the
 *    multipart/form-data boundary.
 *
 * Ghost renames the existing theme folder to `<name>_<ObjectId>` before
 * extracting the new one (storage.js:50), so replacement is non-destructive
 * on the server. If the theme was active it is automatically re-activated.
 *
 * @param {string} themeName
 * @param {Blob}   zipBlob
 * @returns {Promise<object>} parsed JSON response from Ghost
 */
export async function uploadTheme(themeName, zipBlob) {
    const {apiRoot} = getGhostPaths();
    const url = `${apiRoot}/themes/upload`;

    const form = new FormData();
    // Ghost derives the theme name from the filename — must match exactly.
    const filename = `${themeName}.zip`;
    form.append('file', zipBlob, filename);

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {Accept: 'application/json'},
            body: form
        });
    } catch (networkError) {
        throw new GhostApiError(
            `Network error while uploading "${themeName}": ${networkError.message}`,
            0,
            networkError
        );
    }

    let body = null;
    try {
        body = await response.json();
    } catch {
        // Non-JSON response — leave body null and rely on status for error
    }

    if (!response.ok) {
        const serverMessage = extractGhostErrorMessage(body);
        throw new GhostApiError(
            serverMessage || explainStatus(response.status, 'upload', themeName),
            response.status,
            body
        );
    }

    return body;
}

function extractGhostErrorMessage(body) {
    if (!body || !Array.isArray(body.errors) || body.errors.length === 0) {
        return null;
    }
    const err = body.errors[0];
    const parts = [err.message, err.context, err.help].filter(Boolean);
    return parts.join(' — ');
}
