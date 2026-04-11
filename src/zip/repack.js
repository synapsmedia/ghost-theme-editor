import JSZip from 'jszip';

/**
 * Repack an in-memory file tree (see extract.js for shape) back into a ZIP Blob.
 *
 * Contracts:
 *  - Editable files are written as UTF-8 text from their (possibly modified)
 *    `content` string.
 *  - Binary files are written from their preserved `binary` Uint8Array,
 *    byte-for-byte, with the same compression.
 *  - Entries are placed back under `rootPrefix` if one was detected during
 *    extract, so the ZIP layout matches what Ghost originally shipped and
 *    `setFromZip` in Ghost's themes/storage.js will recognize the theme name.
 *  - Unix/DOS permissions and modification dates are preserved where JSZip
 *    exposes them.
 *
 * Returns a Blob with MIME type "application/zip".
 */
export async function repackZip(tree) {
    const zip = new JSZip();
    const prefix = tree.rootPrefix || '';

    for (const [displayPath, file] of Object.entries(tree.files)) {
        const zipPath = prefix + displayPath;

        const options = {
            date: file.date,
            createFolders: true
        };
        if (file.unixPermissions != null) options.unixPermissions = file.unixPermissions;
        if (file.dosPermissions != null) options.dosPermissions = file.dosPermissions;

        if (file.editable) {
            zip.file(zipPath, file.content ?? '', options);
        } else {
            zip.file(zipPath, file.binary, {...options, binary: true});
        }
    }

    return zip.generateAsync({
        type: 'blob',
        mimeType: 'application/zip',
        compression: 'DEFLATE',
        compressionOptions: {level: 6}
    });
}
