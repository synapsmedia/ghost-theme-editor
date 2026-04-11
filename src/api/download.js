import {getGhostPaths} from './paths.js';

/**
 * Fetch a Ghost theme ZIP by name.
 *
 * Uses the session cookie Ghost Admin is already carrying — no token plumbing
 * needed, no CSRF token needed, because Ghost's CSRF protection is origin-based
 * and our script is same-origin with Ghost Admin (see ANALYSIS.md §5).
 *
 * @param {string} themeName
 * @returns {Promise<ArrayBuffer>}
 */
export async function downloadTheme(themeName) {
    const {apiRoot} = getGhostPaths();
    const url = `${apiRoot}/themes/${encodeURIComponent(themeName)}/download`;

    let response;
    try {
        response = await fetch(url, {
            method: 'GET',
            credentials: 'same-origin',
            // Hint Ghost (and any upstream proxy) that we want the raw zip.
            headers: {Accept: 'application/zip, application/octet-stream, */*'}
        });
    } catch (networkError) {
        throw new GhostApiError(
            `Network error while downloading "${themeName}": ${networkError.message}`,
            0,
            networkError
        );
    }

    if (!response.ok) {
        throw new GhostApiError(
            explainStatus(response.status, 'download', themeName),
            response.status
        );
    }

    return response.arrayBuffer();
}

function explainStatus(status, action, themeName) {
    switch (status) {
        case 401:
            return `Not authorized to ${action} "${themeName}". Your Ghost session may have expired — reload the page and sign in again.`;
        case 403:
            return `Forbidden: your Ghost account does not have permission to ${action} themes.`;
        case 404:
            return `Theme "${themeName}" was not found on this Ghost install.`;
        case 413:
            return `The theme ZIP is too large for Ghost to accept.`;
        case 500:
        case 502:
        case 503:
        case 504:
            return `Ghost returned a ${status} error while trying to ${action} "${themeName}". Try again in a moment.`;
        default:
            return `Ghost returned HTTP ${status} while trying to ${action} "${themeName}".`;
    }
}

export class GhostApiError extends Error {
    constructor(message, status = 0, cause) {
        super(message);
        this.name = 'GhostApiError';
        this.status = status;
        if (cause) this.cause = cause;
    }
}

// Re-exported so callers can share the status translator.
export {explainStatus};
