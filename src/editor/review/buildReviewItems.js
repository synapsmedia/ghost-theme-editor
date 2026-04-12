export function buildReviewItems(modifiedEntries, deletedEntries) {
    const items = [];

    for (const {path, file} of modifiedEntries) {
        if (!file.editable) {
            items.push({
                id: `binary:${path}`,
                path,
                kind: 'binary',
                status: file.isNew ? 'added' : 'modified',
                editable: false,
                before: '',
                after: ''
            });
            continue;
        }

        const before = file.original ?? '';
        const after = file.content ?? '';
        if (before === after) continue;

        items.push({
            id: `text:${path}`,
            path,
            kind: 'text',
            status: file.isNew ? 'added' : 'modified',
            editable: true,
            before,
            after
        });
    }

    for (const entry of [...deletedEntries].sort((a, b) => a.path.localeCompare(b.path))) {
        if (entry.binary) {
            items.push({
                id: `binary-deleted:${entry.path}`,
                path: entry.path,
                kind: 'binary',
                status: 'deleted',
                editable: false,
                before: '',
                after: ''
            });
        } else {
            items.push({
                id: `text-deleted:${entry.path}`,
                path: entry.path,
                kind: 'text',
                status: 'deleted',
                editable: true,
                before: entry.original ?? '',
                after: ''
            });
        }
    }

    return items.sort((a, b) => a.path.localeCompare(b.path));
}
