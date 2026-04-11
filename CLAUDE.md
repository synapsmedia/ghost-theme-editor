# ghost-theme-editor — Claude Code Guide

A browser-based Ghost theme editor injected into Ghost Admin via `clientExtensions.script`. Single self-contained IIFE bundle — JSZip bundled, Monaco loaded lazily from jsDelivr CDN.

Published to npm as `@synapsmedia/ghost-theme-editor`. Released automatically via semantic-release from the `main` branch.

## Commands

```bash
npm run build   # production IIFE → dist/ghost-theme-editor.js (JSZip bundled, CSS inlined)
npm run dev     # watch mode with inline source maps
npm test        # vitest round-trip tests for zip extract/repack
```

Build output is always a **single file IIFE** at `dist/ghost-theme-editor.js`. JSZip is bundled. CSS from `src/ui/modal.css` is inlined via `?raw` import. Monaco is **not** bundled — it's loaded from jsDelivr at runtime.

## Project layout

```
src/
├── index.js                 — bootstrap; calls startButtonInjection()
├── api/
│   ├── paths.js             — subdir + apiRoot detection from window.location
│   ├── download.js          — GET /ghost/api/admin/themes/:name/download → ArrayBuffer
│   └── upload.js            — POST /ghost/api/admin/themes/upload (multipart field: file)
├── zip/
│   ├── extract.js           — JSZip ArrayBuffer → { files, rootPrefix }
│   └── repack.js            — { files, rootPrefix } → Blob
├── editor/
│   ├── editable.js          — extension whitelist (hbs/css/js/json/md/…) + languageFor()
│   ├── loadMonaco.js        — loads Monaco from jsDelivr CDN via AMD loader, blob-worker pattern
│   ├── FileTree.js          — collapsible DOM tree, right-click context menu, dirty markers
│   ├── FileEditor.js        — Monaco editor pane, per-file ITextModel cache, breadcrumb
│   └── EditorModal.js       — top-level controller (download→extract→edit→repack→upload)
└── ui/
    ├── injectButton.js      — MutationObserver + Radix popover detection → inject button
    ├── icons.js             — inline SVG icons (16×16, currentColor)
    ├── styles.js            — injects modal.css once via <style> tag
    ├── modal.css            — all styles scoped under .gte-* classes (includes context menu)
    └── toast.js             — post-close success/error toasts
```

## Ghost API contracts (don't change without updating ANALYSIS.md)

| Action | Details |
|--------|---------|
| Download theme | `GET ${apiRoot}/themes/${name}/download` — returns `application/zip` |
| Upload theme | `POST ${apiRoot}/themes/upload` — `multipart/form-data`, field name **`file`** |
| Upload filename | **Must be `<themeName>.zip`** — Ghost derives theme name from the filename in `setFromZip`. Wrong filename creates a differently-named theme instead of replacing the target. |
| Auth | Session cookie `ghost-admin-api-session` (httpOnly). Same-origin `fetch()` with `credentials: 'same-origin'` is enough. No CSRF token — Ghost uses Origin-based protection. |
| API root | `${subdir}/ghost/api/admin` — subdir detected from `window.location.pathname` |
| Ghost backup | On upload Ghost renames existing theme to `<name>_<ObjectId>` before replacing. Non-destructive. |

## Monaco editor (loadMonaco.js)

Monaco is loaded from `https://cdn.jsdelivr.net/npm/monaco-editor@0.50.0/min/vs` via its own AMD loader. Key points:

- **Version** is pinned at `MONACO_VERSION = '0.50.0'` in `loadMonaco.js`.
- Workers run via a blob-URL `importScripts()` pattern to avoid cross-origin Worker restrictions.
- Monaco's AMD loader (`window.require`/`window.define`) is left in place after load because Monaco uses it lazily for language tokenizers. Ghost Admin's Ember modules are fully initialized at page load and don't use `window.require` at runtime, so this is safe.
- `loadMonaco()` returns a singleton promise — safe to call many times.
- `FileEditor._createEditor()` is called only when the container is first made visible, so Monaco measures the layout correctly.
- Each unique file path gets its own `ITextModel` (stored in `FileEditor._models`), preserving per-file undo/redo history when switching between files.

## File tree context menu (FileTree.js)

`FileTree` accepts four optional callbacks alongside `onSelect` / `isActive`:

| Callback | Signature | Triggered by |
|----------|-----------|--------------|
| `onCreateFile` | `(parentPath: string)` | "New File" in context menu; `parentPath` is `''` for root, `'dir/'` for a folder |
| `onCreateFolder` | `(parentPath: string)` | "New Folder" in context menu |
| `onRename` | `(path: string, type: 'file' \| 'dir')` | "Rename" in context menu |
| `onDelete` | `(path: string, type: 'file' \| 'dir')` | "Delete" in context menu |

Context menu items per node:
- **Directory node:** New File, New Folder, Rename, Delete
- **File node:** Rename, Delete
- **Empty tree area (no node):** New File, New Folder (root level)

The context menu is appended to `document.body` with `position: fixed; z-index: 2147483002` (above the modal at 2147483000 and toast at 2147483001). It is dismissed on the next `mousedown` outside of it (using a capture-phase listener deferred via `setTimeout` to avoid self-dismissal).

## File management (EditorModal.js)

`EditorModal` implements the four handler methods that `FileTree` calls:

### `handleCreateFile(parentPath)`
- Prompts for filename via `window.prompt`.
- Validates: non-empty, no `..`, no leading `/`.
- Errors (via `showToast`) if path already exists.
- Creates file entry: `{ editable, content: '', original: '', modified: true, … }`.
- Expands the parent folder in the tree, refreshes, opens file in editor if editable.

### `handleCreateFolder(parentPath)`
- Prompts for folder name.
- Creates a `.gitkeep` placeholder file at `<folderPath>/.gitkeep` (binary, `modified: true`).
- Expands the new folder in the tree.

### `handleRenameNode(path, type)`
- Prompts pre-filled with the current name.
- **File:** renames the single entry in `tree.files`, updates `activePath` and editor if open.
- **Folder:** renames all files whose path starts with the folder prefix; updates expanded state.
- Marks all affected files as `modified: true`.

### `handleDeleteNode(path, type)`
- Confirms via `window.confirm`.
- **File:** deletes the entry; clears editor if it was active.
- **Folder:** deletes all files under the folder prefix; clears editor if active file was inside.
- Increments `this.deletedCount` for each deleted file (deletions don't leave `modified` entries behind, so they need separate tracking for the dirty badge and Save button).

### Dirty tracking

`dirtyCount()` returns `this.deletedCount + (modified file count)`. `deletedCount` is reset to 0 after a successful upload.

## Injection strategy (injectButton.js)

Ghost Admin's theme list is in admin-x-settings (React). Each row has `id="theme-${name}"`. The "…" menu uses Radix Popover — content portals to `document.body` with `data-testid="popover-content"`.

**Flow:**
1. `MutationObserver` on `document.body` (childList + subtree).
2. On any added node, look for `[data-testid="popover-content"]` containing a `<button>Download</button>`.
3. Find the corresponding trigger via `[aria-controls="<popover-content-id>"]`, walk up to `[id^="theme-"]`.
4. Extract theme name from `id.slice("theme-".length)`.
5. Insert `<button data-gte-edit-button>Edit in Browser</button>` before the Download button. Classes copied from the Download button for visual match.
6. Guard: skip if `[data-gte-edit-button]` already in popover (idempotent).
7. `window.__gteInjectorStarted` prevents double-observer.

## Default theme handling

Ghost's built-in themes (`casper`, `source`) cannot be overwritten via upload. `EditorModal.DEFAULT_THEMES` is a static Set of these names. `resolveUploadName()` returns `<theme>-edited` for default themes, and the user is prompted before upload explaining the rename.

## CSS scope

All styles are under `.gte-*` class prefixes. Injected as a single `<style data-gte-styles>` tag (once). Z-index layers:
- `2147483000` — modal root overlay
- `2147483001` — toast
- `2147483002` — context menu

## Ghost config to activate

```json
"clientExtensions": {
  "script": {
    "src": "https://cdn.jsdelivr.net/npm/@synapsmedia/ghost-theme-editor/dist/ghost-theme-editor.js",
    "container": "<div id=\"ghost-theme-editor-root\"></div>"
  }
}
```

Set in `config.production.json`. Requires Ghost restart. Script loads only for authenticated users.

## Key design rules

- **No framework assumption** — vanilla DOM only in `injectButton.js`. Never import Ember or React APIs.
- **Binaries are Uint8Array throughout** — never decode to string. `extract.js` splits into `editable` (text) and `binary` (Uint8Array). `repack.js` writes binary files with `{ binary: true }`.
- **rootPrefix preservation** — `extract.js` detects a common top-level dir (e.g. `casper/`) and strips it for display. `repack.js` re-prepends it so Ghost recognizes the theme name from the ZIP structure.
- **Scoped CSS** — all selectors under `.gte-*`. Do not add global selectors.
- **Monaco not bundled** — never import Monaco directly. Always go through `loadMonaco()` which manages the singleton CDN load.

## Where to find the Ghost source

Upstream Ghost repo: https://github.com/TryGhost/Ghost. Key files:
- Injection config: `ghost/admin/app/templates/application.hbs:42-46`
- API routes: `ghost/core/core/server/web/api/endpoints/admin/routes.js:203-233`
- Theme upload logic: `ghost/core/core/server/services/themes/storage.js:48-95`
- Themes UI: `apps/admin-x-settings/src/components/settings/site/theme/advanced-theme-settings.tsx`
- Menu component: `apps/admin-x-design-system/src/global/menu.tsx`
- Popover: `apps/admin-x-design-system/src/global/popover.tsx`

Full analysis with exact line references: [ANALYSIS.md](./ANALYSIS.md)
