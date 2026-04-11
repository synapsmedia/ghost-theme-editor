import JSZip from 'jszip';
import {isEditable} from '../editor/editable.js';

/**
 * Extract a Ghost theme ZIP (as ArrayBuffer) into an in-memory file tree.
 *
 * Returned shape:
 *
 *   {
 *     files: {
 *       "templates/index.hbs": {
 *         path:      "templates/index.hbs",
 *         editable:  true,
 *         content:   "...",          // string — only for editable files
 *         binary:    null,            // Uint8Array — only for binary files
 *         original:  "...",           // for editable: original text (for dirty check)
 *         modified:  false,
 *         date:      <Date from ZIP entry>,
 *         unixPermissions: <number|null>,
 *         dosPermissions:  <number|null>
 *       },
 *       ...
 *     },
 *     rootPrefix: "casper/",     // common top-level folder inside the ZIP, if any
 *     createdAt:  <Date>
 *   }
 *
 * `rootPrefix` is preserved so repack can reproduce the original ZIP layout.
 * Ghost themes are traditionally zipped with a single top-level folder
 * (e.g. "casper/templates/index.hbs") but also accepts a flat zip; we handle both.
 *
 * Editable files are decoded as UTF-8 text. Binary files are preserved as
 * Uint8Array byte-for-byte — we NEVER round-trip them through text.
 */
export async function extractZip(arrayBuffer) {
    const zip = await JSZip.loadAsync(arrayBuffer);

    const files = {};
    const entries = [];

    zip.forEach((relativePath, entry) => {
        if (entry.dir) return;
        entries.push([relativePath, entry]);
    });

    // Detect a single common top-level directory. If every file is under
    // "<dir>/…" for the same "<dir>", we treat that as rootPrefix and strip
    // it from the displayed tree. Repack restores it.
    const rootPrefix = detectCommonRoot(entries.map(([p]) => p));

    for (const [relativePath, entry] of entries) {
        const displayPath = rootPrefix
            ? relativePath.slice(rootPrefix.length)
            : relativePath;

        // Skip if stripping leaves us with an empty name (should not happen)
        if (!displayPath) continue;

        const editable = isEditable(displayPath);
        const base = {
            path: displayPath,
            zipPath: relativePath, // original path inside the ZIP
            editable,
            modified: false,
            date: entry.date || new Date(),
            unixPermissions: entry.unixPermissions ?? null,
            dosPermissions: entry.dosPermissions ?? null
        };

        if (editable) {
            let text;
            try {
                text = await entry.async('string');
            } catch (err) {
                // Fall through to binary if decode fails.
                const bytes = await entry.async('uint8array');
                files[displayPath] = {
                    ...base,
                    editable: false,
                    content: null,
                    original: null,
                    binary: bytes
                };
                continue;
            }
            files[displayPath] = {
                ...base,
                content: text,
                original: text,
                binary: null
            };
        } else {
            const bytes = await entry.async('uint8array');
            files[displayPath] = {
                ...base,
                content: null,
                original: null,
                binary: bytes
            };
        }
    }

    return {
        files,
        rootPrefix,
        createdAt: new Date()
    };
}

/**
 * Given a list of file paths, return the common top-level directory (with a
 * trailing slash) if every path starts with the same directory. Otherwise
 * returns the empty string.
 */
function detectCommonRoot(paths) {
    if (paths.length === 0) return '';
    const first = paths[0];
    const slashIdx = first.indexOf('/');
    if (slashIdx <= 0) return '';
    const prefix = first.slice(0, slashIdx + 1);
    for (const p of paths) {
        if (!p.startsWith(prefix)) return '';
    }
    return prefix;
}
