/**
 * Mirrors the subdir / apiRoot detection from
 * apps/admin-x-framework/src/utils/helpers.ts (getGhostPaths). Keeping the
 * logic identical means the extension works in subdirectory Ghost installs
 * (e.g. example.com/blog/ghost/…).
 */
export function getGhostPaths() {
    const path = window.location.pathname;
    const ghostIdx = path.indexOf('/ghost/');
    const subdir = ghostIdx >= 0 ? path.slice(0, ghostIdx) : '';
    return {
        subdir,
        adminRoot: `${subdir}/ghost/`,
        apiRoot: `${subdir}/ghost/api/admin`
    };
}
