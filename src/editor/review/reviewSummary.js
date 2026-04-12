export function getModifiedEntries(files) {
    return Object.entries(files || {})
        .filter(([, file]) => file.modified)
        .map(([path, file]) => ({path, file}))
        .sort((a, b) => a.path.localeCompare(b.path));
}

export function buildReviewSummary(modifiedEntries, deletedEntries) {
    const editableChanged = modifiedEntries.filter(({file}) => file.editable).length;
    const binaryChanged = modifiedEntries.filter(({file}) => !file.editable).length;
    const deleted = deletedEntries.length;
    return `${editableChanged} editable changed, ${binaryChanged} binary changed, ${deleted} deleted`;
}

export function resolveReviewSelection(reviewItems, selectedId) {
    if (reviewItems.length === 0) return null;
    if (!selectedId) return reviewItems[0].id;
    return reviewItems.some((item) => item.id === selectedId) ? selectedId : reviewItems[0].id;
}
