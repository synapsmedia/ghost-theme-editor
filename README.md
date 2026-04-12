# Ghost Theme Editor

<img width="1133" height="611" alt="image" src="https://github.com/user-attachments/assets/e5d14c1e-54c1-480e-9a64-413531a861ef" />

A browser-based [Ghost](https://github.com/TryGhost/Ghost) theme editor that injects itself into Ghost Admin and lets you edit, create, rename, and delete theme files directly in your browser — no ZIP downloads, no local tooling, no redeploy cycle. Useful for live fixes, quick tweaks, and authoring themes on any device.

- **Monaco editor** — the same editor engine as VS Code, with syntax highlighting for Handlebars, CSS, JavaScript, JSON, YAML, and more.
- **Diff + review workflow** — inspect per-file diffs in the editor and review all changed files from a dedicated changes panel before uploading.
- **Full file management** — right-click any file or folder in the tree to create, rename, or delete. New files open immediately for editing.
- **Default theme support** — Ghost's built-in themes (`casper`, `source`) can't be overwritten directly; the editor automatically uploads edits as a new `<theme>-edited` theme.
- **Single JS file** — no runtime CDN dependencies beyond Monaco (loaded from jsDelivr on first open). Drop one URL into Ghost config and you're done.
- **Same-origin auth** — reuses Ghost Admin's existing session cookie; no re-authentication.
- **Non-destructive** — Ghost automatically validates the theme before replacing it. The editor confirms every upload and keeps unsaved changes visible until you explicitly discard them.

## Usage

> [!TIP]
> If you are hosting your Ghost site on [Synaps Media](https://www.synapsmedia.com), Ghost Theme Editor is already installed. Enjoy!

The package is published to npm as [`@synapsmedia/ghost-theme-editor`](https://www.npmjs.com/package/@synapsmedia/ghost-theme-editor) and served via jsDelivr — no build step needed.

### 1. Add to Ghost config

Open `config.production.json` and add:

```jsonc
{
  "clientExtensions": {
    "script": {
      "src": "https://cdn.jsdelivr.net/npm/@synapsmedia/ghost-theme-editor/dist/ghost-theme-editor.js",
      "container": "<div id=\"ghost-theme-editor-root\"></div>"
    }
  }
}
```

To pin to a specific version (recommended for production stability):

```jsonc
"src": "https://cdn.jsdelivr.net/npm/@synapsmedia/ghost-theme-editor@1.0.0/dist/ghost-theme-editor.js"
```

### 2. Restart Ghost

```bash
ghost restart
```

Then hard-reload Ghost Admin (⌘⇧R / Ctrl⇧R) to pick up the new config.

### 3. Verify

Open Ghost Admin → Settings → Design & branding → Change theme → Installed. Expand any installed theme's "…" menu. You should see **Edit in Browser** above the existing **Download** item.

Open DevTools → Console to confirm:

```
[ghost-theme-editor] 1.0.0 ready — open a theme's "…" menu to see the editor.
```

## How it works

```
┌──────────────────────────────────────────────────────────────────┐
│  Ghost Admin (authenticated session)                             │
│                                                                  │
│  ┌────────────────────────┐        ┌──────────────────────────┐  │
│  │ Installed Themes list  │        │  ghost-theme-editor.js   │  │
│  │ (admin-x React)        │        │                          │  │
│  │                        │        │  ├─ MutationObserver     │  │
│  │  …menu → Download      │◄──────►│  ├─ Injects "Edit in     │  │
│  │         Edit in        │        │  │   Browser" button     │  │
│  │         Browser  ✱     │        │  ├─ Downloads theme ZIP  │  │
│  └────────────────────────┘        │  │   via Admin API       │  │
│                                    │  ├─ Extracts in memory   │  │
│  ┌────────────────────────┐        │  │   (JSZip, bundled)    │  │
│  │ Full-screen modal      │◄──────►│  ├─ Edit modal:          │  │
│  │  tree │ Monaco editor  │        │  │   tree + Monaco       │  │
│  │       │                │        │  ├─ Repack + upload      │  │
│  │  Save & Upload         │        │  │   to Admin API        │  │
│  └────────────────────────┘        │  └─ Ghost replaces theme │  │
│                                    │     (old version kept    │  │
│                                    │      as backup)          │  │
└──────────────────────────────────────────────────────────────────┘
```

Ghost's `clientExtensions.script` config lets an operator specify a JavaScript file that Ghost Admin loads for authenticated users. See [`ANALYSIS.md`](./ANALYSIS.md) for the full trace of Ghost's codebase and the contracts this extension depends on.

## Requirements

- Ghost **6.x**
- An authenticated Ghost Admin session. The script loads only for authenticated users — Ghost's `showScriptExtension` getter checks `session.isAuthenticated && session.user`.
- Ability to edit Ghost's `config.production.json` (or equivalent env vars).

## Using the editor

<img width="1069" height="475" alt="image" src="https://github.com/user-attachments/assets/e265768f-53da-43d5-8162-890d9cf36b74" />

1. Click **Edit in Browser** from any theme's "…" menu.
2. The editor downloads the theme ZIP via `/ghost/api/admin/themes/<name>/download` (session cookie, same origin — no re-auth required).
3. The file tree on the left shows every file. Editable text files (`.hbs`, `.css`, `.js`, `.json`, `.md`, `.txt`, `.svg`, `.yaml`, …) are clickable. Binary files (images, fonts, WOFF) appear grayed out and are preserved byte-for-byte through the round trip.
4. Click any editable file to open it in the Monaco editor. A dot next to the filename marks it as modified. Use the breadcrumb's **Edit / Diff** toggle to inspect a per-file diff.
5. **Right-click** any file or folder in the tree for a context menu:
   - **On a folder:** New File, New Folder, Rename, Delete
   - **On a file:** Rename, Delete
   - **On the tree background:** New File, New Folder (created at the root)
   - New files open immediately in the editor if the extension is editable.
   - Creating a folder adds a `.gitkeep` placeholder so it appears in the tree.
6. Click the toolbar's modified-files badge to open the all-changes review panel.
   - Review changed files in a list with status badges (`added`, `modified`, `deleted`).
   - Open any file in a split diff viewer.
   - Revert individual files or use **Revert all**.
7. Click **Save & Upload** when ready.
   - You'll be asked to confirm the number of changed/added/deleted files.
   - The modified tree is repacked as a ZIP (JSZip, DEFLATE).
   - The ZIP is uploaded as `multipart/form-data` to `/ghost/api/admin/themes/upload`.
   - Ghost renames the existing theme folder as a backup, extracts the new ZIP, and re-activates the theme if it was active.
   - If you're editing a default Ghost theme (`casper`, `source`), the upload is redirected to `<theme>-edited` — a new theme is created with your changes while the original is left untouched.
8. Cancel / press Esc / click the backdrop to close. Unsaved changes prompt for confirmation before discarding.

## Architecture

```
src/
├── index.js                — bootstrap; starts the button injector
├── api/
│   ├── paths.js            — subdir + apiRoot detection (mirrors Ghost's getGhostPaths)
│   ├── download.js         — fetch theme ZIP → ArrayBuffer
│   └── upload.js           — POST FormData with zipBlob + correct filename
├── zip/
│   ├── extract.js          — JSZip → { files: { path: {editable, content|binary, …} }, rootPrefix }
│   └── repack.js           — file tree → Blob (preserves root prefix, binaries, permissions)
├── editor/
│   ├── editable.js         — extension whitelist + language detector
│   ├── loadMonaco.js       — loads Monaco Editor from jsDelivr CDN (AMD, blob-worker pattern)
│   ├── FileTree.js         — collapsible tree, right-click context menu, dirty markers
│   ├── FileEditor.js       — Monaco editor pane, per-file models, breadcrumb, language badge
│   └── EditorModal.js      — top-level controller: download → extract → edit → repack → upload
└── ui/
    ├── injectButton.js     — MutationObserver, Radix popover detection, button injection
    ├── icons.js            — inline SVG icons
    ├── styles.js           — inlines modal.css via ?raw
    ├── modal.css           — scoped .gte-* classes, dark theme, responsive
    └── toast.js            — post-close success/error notifications
```

Design principles:

- **No framework.** The injected script never assumes Ember or React is running. It reads only stable, public-looking DOM attributes: `id="theme-<name>"`, `data-testid="popover-content"`, the Radix `aria-controls` linkage.
- **Idempotent injection.** `startButtonInjection()` guards on `window.__gteInjectorStarted`, and every popover injection checks for a pre-existing `[data-gte-edit-button]` before inserting.
- **Binaries are untouched.** `extract.js` splits files into `editable` (UTF-8 text) and `binary` (`Uint8Array`). `repack.js` writes binaries directly — images, fonts, and other assets survive unchanged.
- **Monaco loaded lazily.** Monaco is loaded from jsDelivr on the first time the editor is opened, not on page load. The CDN fetch is kicked off as a prefetch when the editor module initializes, overlapping with the theme ZIP download.
- **Filename matters.** Ghost's upload handler derives the theme name from the uploaded filename. `upload.js` always sets it to `<themeName>.zip`.

## Self-hosting

If you prefer to host the bundle yourself (e.g. to avoid CDN dependencies or pin offline):

```bash
npm install
npm run build
```

This produces a self-contained IIFE at `dist/ghost-theme-editor.js`. JSZip is bundled in; the modal CSS is inlined. Monaco itself is always loaded from jsDelivr at runtime — it is intentionally not bundled due to its size (~3 MB).

Host the file at any HTTPS URL and point `clientExtensions.script.src` at it. No CORS configuration is required since it loads as a plain `<script src>`.

## Development

```bash
npm install
npm run dev           # vite build --watch (writes dist/ on every change)
npm run build         # production minified bundle
npm test              # zip round-trip tests (vitest)
```

Point `clientExtensions.script.src` at `http://localhost:<port>/ghost-theme-editor.js` during development. You'll need to serve `dist/` separately (e.g. `npx serve dist`), since Vite's dev server targets HTML entry points rather than raw IIFEs.

## Troubleshooting

**`Edit in Browser` button doesn't appear**

- Check DevTools → Console for a `[ghost-theme-editor]` log line. If absent, the script didn't load.
- Confirm `clientExtensions.script` is present in `GET /ghost/api/admin/config`.
- Check DevTools → Network for a 200 on the `ghost-theme-editor.js` request.

**403 / CSP / mixed-content error**

Ghost itself sets no Content-Security-Policy. The culprit is usually a reverse proxy. Add the jsDelivr host to your `script-src` directive, and `style-src 'unsafe-inline'` because the editor injects a `<style>` tag.

**Monaco editor doesn't load**

Monaco is loaded from `https://cdn.jsdelivr.net/npm/monaco-editor@0.50.0/`. If the CDN is blocked, check network access from the browser. The editor will show an error in the banner.

**"Upload failed" after editing a default theme**

Default Ghost themes (`casper`, `source`) cannot be overwritten. The editor will prompt to upload as `<theme>-edited` instead. Accept the prompt to create a new theme with your changes.

## Limitations

- **Diff is text-only.** Editable text files support diff/review. Binary files are preserved byte-for-byte, but visual/binary diffs are not shown.
- **No multi-user coordination.** If two people edit the same theme simultaneously, last writer wins. Ghost's backup-on-replace means the previous version is recoverable but not automatically merged.
- **Theme validation is server-side.** Ghost's theme validator runs on upload. If your edits produce an invalid theme, the error messages are surfaced in the editor's banner so you can fix and retry.
- **In-memory only.** Everything runs in browser memory, so the tab must stay open during editing. For very large themes with many binary assets, the initial download and extract may be slow.

## License

MIT — see [`LICENSE`](./LICENSE).

© [Synaps Media](https://www.synapsmedia.com)
