/**
 * Defines which file extensions are considered editable text.
 *
 * A file is editable if its extension (lowercased, no dot) is in EDITABLE_EXTS.
 * Everything else — images, fonts, binaries — is treated as opaque bytes and
 * round-tripped byte-for-byte through extract → repack.
 */

export const EDITABLE_EXTS = new Set([
    'hbs',
    'handlebars',
    'html',
    'htm',
    'css',
    'scss',
    'sass',
    'less',
    'js',
    'mjs',
    'cjs',
    'json',
    'md',
    'markdown',
    'txt',
    'yml',
    'yaml',
    'svg', // treat SVG as editable text
    'xml'
]);

export function getExtension(path) {
    const i = path.lastIndexOf('.');
    if (i < 0) return '';
    const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    if (i < slash) return '';
    return path.slice(i + 1).toLowerCase();
}

export function isEditable(path) {
    return EDITABLE_EXTS.has(getExtension(path));
}

/**
 * Best-effort language identifier for syntax highlighting or display.
 */
export function languageFor(path) {
    const ext = getExtension(path);
    switch (ext) {
        case 'hbs':
        case 'handlebars':
            return 'handlebars';
        case 'html':
        case 'htm':
            return 'html';
        case 'css':
        case 'scss':
        case 'sass':
        case 'less':
            return 'css';
        case 'js':
        case 'mjs':
        case 'cjs':
            return 'javascript';
        case 'json':
            return 'json';
        case 'md':
        case 'markdown':
            return 'markdown';
        case 'yml':
        case 'yaml':
            return 'yaml';
        case 'svg':
        case 'xml':
            return 'xml';
        default:
            return 'plaintext';
    }
}
