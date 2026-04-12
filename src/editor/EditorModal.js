import {FileTree} from './FileTree.js';
import {FileEditor} from './FileEditor.js';
import {extractZip} from '../zip/extract.js';
import {repackZip} from '../zip/repack.js';
import {downloadTheme, GhostApiError} from '../api/download.js';
import {uploadTheme} from '../api/upload.js';
import {ensureStylesInjected} from '../ui/styles.js';
import {icons} from '../ui/icons.js';
import {showToast} from '../ui/toast.js';
import {isEditable} from './editable.js';
import {buildReviewItems} from './review/buildReviewItems.js';
import {ReviewDiffViewer} from './review/ReviewDiffViewer.js';
import {buildReviewSummary, getModifiedEntries, resolveReviewSelection} from './review/reviewSummary.js';

/**
 * Top-level controller for the editor. One instance is created per "Edit in
 * Browser" click; it mounts a full-screen overlay into document.body, downloads
 * the target theme, extracts it, and owns the in-memory tree until the user
 * discards or uploads.
 */
export class EditorModal {
    constructor({themeName}) {
        this.themeName = themeName;
        this.tree = null;       // extracted tree: { files, rootPrefix, ... }
        this.activePath = null;
        this.status = 'idle';   // 'idle' | 'loading' | 'ready' | 'saving' | 'error'
        this.error = null;
        this.deletedCount = 0;  // tracks file deletions (removed entries don't appear in dirtyCount)
        this.deletedEntries = [];
        this.reviewItems = [];
        this.reviewSelectedId = null;
        this.reviewDiffViewer = null;
        this.previousFocus = document.activeElement;

        ensureStylesInjected();
        this.buildDom();
    }

    // ---------- DOM construction ----------

    buildDom() {
        this.root = document.createElement('div');
        this.root.className = 'gte-modal-root';
        this.root.setAttribute('role', 'dialog');
        this.root.setAttribute('aria-modal', 'true');
        this.root.setAttribute('aria-label', `Edit theme ${this.themeName}`);

        this.modal = document.createElement('div');
        this.modal.className = 'gte-modal';
        this.root.appendChild(this.modal);

        // Toolbar
        this.toolbar = document.createElement('div');
        this.toolbar.className = 'gte-toolbar';
        this.modal.appendChild(this.toolbar);

        const title = document.createElement('div');
        title.className = 'gte-toolbar__title';
        title.innerHTML = '';
        this.titleName = document.createElement('span');
        this.titleName.textContent = this.themeName;
        title.appendChild(this.titleName);
        const sub = document.createElement('span');
        sub.className = 'gte-toolbar__subtitle';
        sub.textContent = '— Ghost theme';
        title.appendChild(sub);
        this.toolbar.appendChild(title);

        this.dirtyBadge = document.createElement('button');
        this.dirtyBadge.type = 'button';
        this.dirtyBadge.className = 'gte-toolbar__badge';
        this.dirtyBadge.textContent = '0 files modified';
        this.dirtyBadge.title = 'Review all changes';
        this.dirtyBadge.disabled = true;
        this.dirtyBadge.addEventListener('click', () => this.showReview());
        this.toolbar.appendChild(this.dirtyBadge);

        const spacer = document.createElement('div');
        spacer.className = 'gte-toolbar__spacer';
        this.toolbar.appendChild(spacer);

        this.shortcutsBtn = document.createElement('button');
        this.shortcutsBtn.type = 'button';
        this.shortcutsBtn.className = 'gte-btn gte-btn--ghost gte-btn--icon';
        this.shortcutsBtn.textContent = '?';
        this.shortcutsBtn.title = 'Keyboard shortcuts';
        this.shortcutsBtn.setAttribute('aria-label', 'Keyboard shortcuts');
        this.shortcutsBtn.addEventListener('click', () => this.toggleShortcuts());
        this.toolbar.appendChild(this.shortcutsBtn);

        this.cancelBtn = document.createElement('button');
        this.cancelBtn.type = 'button';
        this.cancelBtn.className = 'gte-btn gte-btn--ghost';
        this.cancelBtn.textContent = 'Cancel';
        this.cancelBtn.addEventListener('click', () => this.requestClose());
        this.toolbar.appendChild(this.cancelBtn);

        this.saveBtn = document.createElement('button');
        this.saveBtn.type = 'button';
        this.saveBtn.className = 'gte-btn gte-btn--primary';
        this.saveBtn.textContent = 'Save & Upload';
        this.saveBtn.disabled = true;
        this.saveBtn.addEventListener('click', () => this.handleSave());
        this.toolbar.appendChild(this.saveBtn);

        // Body (tree + editor)
        this.body = document.createElement('div');
        this.body.className = 'gte-body';
        this.modal.appendChild(this.body);

        this.loading = document.createElement('div');
        this.loading.className = 'gte-loading';
        const spinner = document.createElement('div');
        spinner.className = 'gte-spinner';
        this.loading.appendChild(spinner);
        const loadingText = document.createElement('div');
        loadingText.textContent = `Downloading "${this.themeName}"…`;
        this.loading.appendChild(loadingText);
        this.body.appendChild(this.loading);

        // Banner (errors / status), below the body
        this.banner = document.createElement('div');
        this.banner.className = 'gte-banner';
        this.banner.style.display = 'none';
        this.modal.appendChild(this.banner);

        this.shortcutOverlay = document.createElement('div');
        this.shortcutOverlay.className = 'gte-shortcuts';
        this.shortcutOverlay.style.display = 'none';
        this.shortcutOverlay.addEventListener('click', (e) => {
            if (e.target === this.shortcutOverlay) this.hideShortcuts();
        });

        this.shortcutPanel = document.createElement('div');
        this.shortcutPanel.className = 'gte-shortcuts__panel';
        this.shortcutPanel.setAttribute('role', 'dialog');
        this.shortcutPanel.setAttribute('aria-modal', 'true');
        this.shortcutPanel.setAttribute('aria-label', 'Keyboard shortcuts');

        const shortcutTitle = document.createElement('h3');
        shortcutTitle.className = 'gte-shortcuts__title';
        shortcutTitle.textContent = 'Keyboard shortcuts';
        this.shortcutPanel.appendChild(shortcutTitle);

        const shortcutList = document.createElement('dl');
        shortcutList.className = 'gte-shortcuts__list';
        const entries = [
            ['Cmd/Ctrl + S', 'Save and upload changes'],
            ['Esc', 'Close modal (asks before discarding changes)'],
            ['Arrow Up/Down', 'Move selection in file tree'],
            ['Arrow Right', 'Open selected folder in file tree'],
            ['Arrow Left', 'Close selected folder in file tree'],
            ['Enter / Space', 'Toggle selected folder or open selected file'],
            ['F2', 'Rename selected tree item'],
            ['Delete', 'Delete selected tree item']
        ];
        for (const [key, desc] of entries) {
            const dt = document.createElement('dt');
            dt.textContent = key;
            const dd = document.createElement('dd');
            dd.textContent = desc;
            shortcutList.appendChild(dt);
            shortcutList.appendChild(dd);
        }
        this.shortcutPanel.appendChild(shortcutList);

        const shortcutNote = document.createElement('p');
        shortcutNote.className = 'gte-shortcuts__note';
        shortcutNote.textContent = 'Tree shortcuts work when the file tree is focused.';
        this.shortcutPanel.appendChild(shortcutNote);

        const shortcutCopyright = document.createElement('p');
        shortcutCopyright.className = 'gte-shortcuts__copyright';
        shortcutCopyright.appendChild(document.createTextNode('Copyright (c) 2026 Synaps Media. Licensed under the MIT License. '));
        const licenseLink = document.createElement('a');
        licenseLink.className = 'gte-shortcuts__copyright-link';
        licenseLink.href = 'https://github.com/synapsmedia/ghost-theme-editor/blob/main/LICENSE';
        licenseLink.target = '_blank';
        licenseLink.rel = 'noopener noreferrer';
        licenseLink.textContent = 'View license';
        shortcutCopyright.appendChild(licenseLink);
        this.shortcutPanel.appendChild(shortcutCopyright);

        const closeShortcutsBtn = document.createElement('button');
        closeShortcutsBtn.type = 'button';
        closeShortcutsBtn.className = 'gte-btn gte-btn--ghost';
        closeShortcutsBtn.textContent = 'Close';
        closeShortcutsBtn.addEventListener('click', () => this.hideShortcuts());
        this.shortcutPanel.appendChild(closeShortcutsBtn);

        this.shortcutOverlay.appendChild(this.shortcutPanel);
        this.modal.appendChild(this.shortcutOverlay);

        this.reviewOverlay = document.createElement('div');
        this.reviewOverlay.className = 'gte-review';
        this.reviewOverlay.style.display = 'none';
        this.reviewOverlay.addEventListener('click', (e) => {
            if (e.target === this.reviewOverlay) this.hideReview();
        });

        this.reviewPanel = document.createElement('div');
        this.reviewPanel.className = 'gte-review__panel';

        const reviewTitle = document.createElement('h3');
        reviewTitle.className = 'gte-review__title';
        reviewTitle.textContent = 'All changes';
        this.reviewPanel.appendChild(reviewTitle);

        this.reviewSummary = document.createElement('div');
        this.reviewSummary.className = 'gte-review__summary';
        this.reviewPanel.appendChild(this.reviewSummary);

        this.reviewLayout = document.createElement('div');
        this.reviewLayout.className = 'gte-review__layout';

        this.reviewList = document.createElement('div');
        this.reviewList.className = 'gte-review__list';
        this.reviewLayout.appendChild(this.reviewList);

        this.reviewDiffPane = document.createElement('div');
        this.reviewDiffPane.className = 'gte-review__diff-pane';
        this.reviewDiffHeader = document.createElement('div');
        this.reviewDiffHeader.className = 'gte-review__diff-header';

        this.reviewDiffTitle = document.createElement('span');
        this.reviewDiffTitle.className = 'gte-review__diff-title';
        this.reviewDiffHeader.appendChild(this.reviewDiffTitle);

        this.reviewDiffHeaderActions = document.createElement('div');
        this.reviewDiffHeaderActions.className = 'gte-review__diff-actions';

        this.reviewOpenEditorBtn = document.createElement('button');
        this.reviewOpenEditorBtn.type = 'button';
        this.reviewOpenEditorBtn.className = 'gte-btn gte-btn--ghost gte-review__btn';
        this.reviewOpenEditorBtn.textContent = 'Open in editor';
        this.reviewOpenEditorBtn.addEventListener('click', () => this.openSelectedInEditor());
        this.reviewDiffHeaderActions.appendChild(this.reviewOpenEditorBtn);

        this.reviewRevertBtn = document.createElement('button');
        this.reviewRevertBtn.type = 'button';
        this.reviewRevertBtn.className = 'gte-btn gte-btn--ghost gte-review__btn';
        this.reviewRevertBtn.textContent = 'Revert file';
        this.reviewRevertBtn.addEventListener('click', () => this.revertSelectedReviewItem());
        this.reviewDiffHeaderActions.appendChild(this.reviewRevertBtn);

        this.reviewDiffHeader.appendChild(this.reviewDiffHeaderActions);
        this.reviewDiffPane.appendChild(this.reviewDiffHeader);
        this.reviewDiffMount = document.createElement('div');
        this.reviewDiffMount.className = 'gte-review__diff';
        this.reviewDiffPane.appendChild(this.reviewDiffMount);
        this.reviewDiffViewer = new ReviewDiffViewer({mountEl: this.reviewDiffMount});

        this.reviewDiffEmpty = document.createElement('div');
        this.reviewDiffEmpty.className = 'gte-review__empty';
        this.reviewDiffEmpty.style.display = 'none';
        this.reviewDiffPane.appendChild(this.reviewDiffEmpty);
        this.reviewLayout.appendChild(this.reviewDiffPane);

        this.reviewPanel.appendChild(this.reviewLayout);

        const reviewActions = document.createElement('div');
        reviewActions.className = 'gte-review__actions';

        this.reviewRevertAllBtn = document.createElement('button');
        this.reviewRevertAllBtn.type = 'button';
        this.reviewRevertAllBtn.className = 'gte-btn gte-btn--ghost';
        this.reviewRevertAllBtn.textContent = 'Revert all';
        this.reviewRevertAllBtn.addEventListener('click', () => this.revertAllReviewItems());
        reviewActions.appendChild(this.reviewRevertAllBtn);

        const reviewSpacer = document.createElement('div');
        reviewSpacer.className = 'gte-toolbar__spacer';
        reviewActions.appendChild(reviewSpacer);

        const closeReviewBtn = document.createElement('button');
        closeReviewBtn.type = 'button';
        closeReviewBtn.className = 'gte-btn gte-btn--ghost';
        closeReviewBtn.textContent = 'Close';
        closeReviewBtn.addEventListener('click', () => this.hideReview());
        reviewActions.appendChild(closeReviewBtn);

        this.reviewPanel.appendChild(reviewActions);
        this.reviewOverlay.appendChild(this.reviewPanel);
        this.modal.appendChild(this.reviewOverlay);

        // Keyboard handler
        this.onKeydown = (e) => {
            const isModifierSave = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's';
            if (isModifierSave) {
                e.preventDefault();
                e.stopPropagation();
                this.handleSave();
                return;
            }

            if (e.key === 'Escape') {
                e.stopPropagation();
                if (this.reviewOverlay.style.display !== 'none') {
                    this.hideReview();
                    return;
                }
                if (this.shortcutOverlay.style.display !== 'none') {
                    this.hideShortcuts();
                    return;
                }
                this.requestClose();
            }
        };
        this.root.addEventListener('keydown', this.onKeydown);

        // Click on backdrop (not on modal itself) also prompts close.
        this.root.addEventListener('click', (e) => {
            if (e.target === this.root) this.requestClose();
        });
    }

    // ---------- Lifecycle ----------

    async mount() {
        document.body.appendChild(this.root);
        // Disable scroll on body while the modal is open.
        this.prevBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        try {
            this.modal.focus?.();
        } catch {
            // focus is best-effort
        }
        await this.loadTheme();
    }

    async loadTheme() {
        this.status = 'loading';
        try {
            const buffer = await downloadTheme(this.themeName);
            this.tree = await extractZip(buffer);
            this.status = 'ready';
            this.renderReady();
        } catch (err) {
            this.status = 'error';
            this.error = err;
            this.renderError(err);
        }
    }

    renderReady() {
        // Remove loading state, mount FileTree + FileEditor.
        this.loading.remove();

        this.fileTree = new FileTree({
            files: this.tree.files,
            onSelect: (path) => this.selectFile(path),
            isActive: (path) => path === this.activePath,
            onCreateFile: (parentPath) => this.handleCreateFile(parentPath),
            onCreateFolder: (parentPath) => this.handleCreateFolder(parentPath),
            onRename: (path, type) => this.handleRenameNode(path, type),
            onDelete: (path, type) => this.handleDeleteNode(path, type)
        });
        this.fileEditor = new FileEditor({
            onChange: (path, value) => this.handleEdit(path, value)
        });

        this.body.appendChild(this.fileTree.el);
        this.body.appendChild(this.fileEditor.el);
        this.fileTree.render();

        // Auto-select a sensible default: package.json if present, else first editable file
        const preferred = this.pickDefaultFile();
        if (preferred) this.selectFile(preferred, {focusEditor: true});

        this.updateDirtyBadge();
    }

    pickDefaultFile() {
        const files = this.tree.files;
        if (files['package.json']) return 'package.json';
        const keys = Object.keys(files).sort();
        for (const k of keys) {
            if (files[k].editable) return k;
        }
        return null;
    }

    renderError(err) {
        this.loading.remove();
        this.banner.style.display = 'block';
        this.banner.className = 'gte-banner gte-banner--error';
        this.banner.textContent =
            err instanceof GhostApiError
                ? err.message
                : `Something went wrong: ${err?.message || err}`;

        const retry = document.createElement('div');
        retry.style.marginTop = '8px';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gte-btn';
        btn.textContent = 'Retry';
        btn.addEventListener('click', () => {
            this.banner.style.display = 'none';
            const l = document.createElement('div');
            l.className = 'gte-loading';
            const spinner = document.createElement('div');
            spinner.className = 'gte-spinner';
            l.appendChild(spinner);
            const t = document.createElement('div');
            t.textContent = `Downloading "${this.themeName}"…`;
            l.appendChild(t);
            this.body.appendChild(l);
            this.loading = l;
            this.loadTheme();
        });
        retry.appendChild(btn);
        this.banner.appendChild(retry);
    }

    // ---------- Editing ----------

    selectFile(path, {focusEditor = false} = {}) {
        if (!this.tree) return;
        const file = this.tree.files[path];
        if (!file || !file.editable) return;
        this.activePath = path;
        this.fileEditor.setFile(path, file.content ?? '', {
            focus: focusEditor,
            originalContent: file.original ?? file.content ?? ''
        });
        this.fileTree.refresh();
    }

    handleEdit(path, value) {
        const file = this.tree.files[path];
        if (!file || !file.editable) return;
        file.content = value;
        const wasModified = file.modified;
        file.modified = file.content !== file.original;
        if (file.modified !== wasModified) {
            this.fileTree.refresh();
        }
        this.updateDirtyBadge();
    }

    handleRevertFile(path) {
        if (!this.tree) return;
        const file = this.tree.files[path];
        if (!file || !file.editable) return;
        if (file.content === file.original) return;

        if (file.isNew) {
            delete this.tree.files[path];
            if (this.activePath === path) {
                this.activePath = null;
                this.fileEditor.setFile(null);
            }
            this.fileTree.refresh();
            this.updateDirtyBadge();
            return;
        }

        file.content = file.original ?? '';
        file.modified = false;

        if (this.activePath === path) {
            this.fileEditor.setFile(path, file.content ?? '', {
                originalContent: file.original ?? ''
            });
        }

        this.fileTree.refresh();
        this.updateDirtyBadge();
    }

    revertDeletedEntry(path) {
        const idx = this.deletedEntries.findIndex((entry) => entry.path === path);
        if (idx < 0) return false;
        const entry = this.deletedEntries[idx];
        if (entry.binary) {
            showToast('Cannot restore deleted binary files yet.', 'error');
            return false;
        }
        if (this.tree.files[path]) {
            // A file was recreated at this path after deletion. Restore
            // the original content so the revert is meaningful, then mark
            // it unmodified only if it matches the original.
            const existing = this.tree.files[path];
            if (existing.editable) {
                existing.content = entry.original ?? '';
                existing.original = entry.original ?? '';
                existing.modified = false;
                if (this.activePath === path) {
                    this.fileEditor.setFile(path, existing.content, {
                        originalContent: existing.original
                    });
                }
            }
            this.deletedEntries.splice(idx, 1);
            this.deletedCount = Math.max(0, this.deletedCount - 1);
            return true;
        }
        this.tree.files[path] = {
            path,
            zipPath: (this.tree.rootPrefix || '') + path,
            editable: true,
            content: entry.original ?? '',
            original: entry.original ?? '',
            binary: null,
            modified: false,
            date: new Date(),
            unixPermissions: null,
            dosPermissions: null
        };
        this.deletedEntries.splice(idx, 1);
        this.deletedCount = Math.max(0, this.deletedCount - 1);
        return true;
    }

    dirtyCount() {
        if (!this.tree) return 0;
        let n = this.deletedCount;
        for (const f of Object.values(this.tree.files)) if (f.modified) n++;
        return n;
    }

    updateDirtyBadge() {
        const n = this.dirtyCount();
        this.dirtyBadge.textContent = n === 1 ? '1 file modified' : `${n} files modified`;
        this.dirtyBadge.classList.toggle('gte-toolbar__badge--dirty', n > 0);
        this.dirtyBadge.disabled = n === 0;
        this.saveBtn.disabled = n === 0 || this.status === 'saving';
        if (this.reviewOverlay?.style.display !== 'none') {
            this.renderReview();
        }
    }

    // ---------- Save ----------

    /** Ghost's built-in themes cannot be overwritten; uploads must be renamed. */
    static DEFAULT_THEMES = new Set(['source', 'casper']);

    /** Returns the name to use as the upload filename (and new theme name). */
    resolveUploadName() {
        if (EditorModal.DEFAULT_THEMES.has(this.themeName)) {
            return `${this.themeName}-edited`;
        }
        return this.themeName;
    }

    async handleSave() {
        if (this.status === 'saving') return;
        const count = this.dirtyCount();
        if (count === 0) return;

        const uploadName = this.resolveUploadName();
        const isRename = uploadName !== this.themeName;

        const confirmMessage = isRename
            ? `"${this.themeName}" is a built-in Ghost theme and cannot be overwritten.\n\nYour changes will be uploaded as a new theme called "${uploadName}".\n\nDo you want to continue?`
            : `Upload ${count} modified file${count === 1 ? '' : 's'} and replace the "${this.themeName}" theme on this Ghost install?\n\nGhost will keep a backup of the previous version automatically.`;

        const proceed = window.confirm(confirmMessage);
        if (!proceed) return;

        this.status = 'saving';
        this.saveBtn.disabled = true;
        this.cancelBtn.disabled = true;
        this.showBanner('Packing and uploading theme…', 'info');

        try {
            const blob = await repackZip(this.tree);
            await uploadTheme(uploadName, blob);

            // If uploaded under a new name, update our internal state so
            // subsequent saves in this session target the renamed theme.
            if (isRename) {
                this.themeName = uploadName;
                this.titleName.textContent = uploadName;
                this.root.setAttribute('aria-label', `Edit theme ${uploadName}`);
            }

            // Mark all files as clean (new baseline).
            for (const f of Object.values(this.tree.files)) {
                if (f.editable) {
                    f.original = f.content;
                    this.fileEditor.updateOriginal(f.path, f.original ?? '');
                }
                f.modified = false;
                f.isNew = false;
            }
            this.deletedCount = 0;
            this.deletedEntries = [];
            this.status = 'ready';
            this.updateDirtyBadge();
            this.fileTree.refresh();
            this.hideBanner();
            if (this.reviewOverlay.style.display !== 'none') {
                this.renderReview();
            }
            showToast(`Theme "${uploadName}" uploaded successfully.`, 'success');
            this.cancelBtn.disabled = false;
        } catch (err) {
            this.status = 'ready';
            this.cancelBtn.disabled = false;
            this.saveBtn.disabled = false;
            const message = err instanceof GhostApiError
                ? err.message
                : `Upload failed: ${err?.message || err}`;
            this.showBanner(message, 'error');
        }
    }

    // ---------- File management ----------

    handleCreateFile(parentPath) {
        const rawName = window.prompt('New file name:');
        if (!rawName) return;
        const name = rawName.trim();
        if (!name || name.includes('..') || name.startsWith('/')) {
            showToast('Invalid file name.', 'error');
            return;
        }
        const fullPath = parentPath ? `${parentPath}${name}` : name;
        if (this.tree.files[fullPath]) {
            showToast(`"${fullPath}" already exists.`, 'error');
            return;
        }
        const editable = isEditable(fullPath);
        this.tree.files[fullPath] = {
            path: fullPath,
            zipPath: (this.tree.rootPrefix || '') + fullPath,
            editable,
            content: editable ? '' : null,
            original: editable ? '' : null,
            binary: editable ? null : new Uint8Array(0),
            modified: true,
            isNew: true,
            date: new Date(),
            unixPermissions: null,
            dosPermissions: null
        };
        // Ensure the parent folder is expanded
        if (parentPath) this.fileTree.expanded.add(parentPath);
        this.fileTree.refresh();
        this.updateDirtyBadge();
        if (editable) this.selectFile(fullPath);
    }

    handleCreateFolder(parentPath) {
        const rawName = window.prompt('New folder name:');
        if (!rawName) return;
        const name = rawName.trim();
        if (!name || name.includes('..') || name.includes('/') || name.startsWith('.')) {
            showToast('Invalid folder name.', 'error');
            return;
        }
        const folderPath = parentPath ? `${parentPath}${name}/` : `${name}/`;
        const keepPath = `${folderPath}.gitkeep`;
        if (this.tree.files[keepPath]) {
            showToast(`Folder "${name}" already exists.`, 'error');
            return;
        }
        this.tree.files[keepPath] = {
            path: keepPath,
            zipPath: (this.tree.rootPrefix || '') + keepPath,
            editable: false,
            content: null,
            original: null,
            binary: new Uint8Array(0),
            modified: true,
            isNew: true,
            date: new Date(),
            unixPermissions: null,
            dosPermissions: null
        };
        if (parentPath) this.fileTree.expanded.add(parentPath);
        this.fileTree.expanded.add(folderPath);
        this.fileTree.refresh();
        this.updateDirtyBadge();
    }

    handleRenameNode(path, type) {
        if (type === 'file') {
            const parts = path.split('/');
            const oldName = parts[parts.length - 1];
            const newName = window.prompt('Rename to:', oldName);
            if (!newName) return;
            const trimmed = newName.trim();
            if (!trimmed || trimmed === oldName) return;
            if (trimmed.includes('/') || trimmed.includes('..')) {
                showToast('Invalid file name.', 'error');
                return;
            }
            const newPath = [...parts.slice(0, -1), trimmed].join('/');
            if (this.tree.files[newPath]) {
                showToast(`"${newPath}" already exists.`, 'error');
                return;
            }
            const file = this.tree.files[path];
            file.path = newPath;
            file.zipPath = (this.tree.rootPrefix || '') + newPath;
            file.modified = true;
            this.tree.files[newPath] = file;
            delete this.tree.files[path];
            if (this.activePath === path) {
                this.activePath = newPath;
                this.fileEditor.setFile(newPath, file.content ?? '', {
                    originalContent: file.original ?? file.content ?? ''
                });
            }
        } else {
            // dir: path ends with '/', e.g. "partials/"
            const withoutSlash = path.slice(0, -1);
            const parts = withoutSlash.split('/');
            const oldName = parts[parts.length - 1];
            const newName = window.prompt('Rename folder to:', oldName);
            if (!newName) return;
            const trimmed = newName.trim();
            if (!trimmed || trimmed === oldName) return;
            if (trimmed.includes('/') || trimmed.includes('..')) {
                showToast('Invalid folder name.', 'error');
                return;
            }
            const newFolderPath = [...parts.slice(0, -1), trimmed].join('/') + '/';
            const affected = Object.keys(this.tree.files).filter(p => p.startsWith(path));
            for (const oldFilePath of affected) {
                const file = this.tree.files[oldFilePath];
                const newFilePath = newFolderPath + oldFilePath.slice(path.length);
                file.path = newFilePath;
                file.zipPath = (this.tree.rootPrefix || '') + newFilePath;
                file.modified = true;
                this.tree.files[newFilePath] = file;
                delete this.tree.files[oldFilePath];
                if (this.activePath === oldFilePath) {
                    this.activePath = newFilePath;
                    this.fileEditor.setFile(newFilePath, file.content ?? '', {
                        originalContent: file.original ?? file.content ?? ''
                    });
                }
            }
            if (this.fileTree.expanded.has(path)) {
                this.fileTree.expanded.delete(path);
                this.fileTree.expanded.add(newFolderPath);
            }
        }
        this.fileTree.refresh();
        this.updateDirtyBadge();
    }

    handleDeleteNode(path, type) {
        if (type === 'file') {
            const name = path.split('/').pop();
            if (!window.confirm(`Delete "${name}"?`)) return;
            this.trackDeletedEntry(path, this.tree.files[path]);
            delete this.tree.files[path];
            this.deletedCount++;
            if (this.activePath === path) {
                this.activePath = null;
                this.fileEditor.setFile(null);
            }
        } else {
            const affected = Object.keys(this.tree.files).filter(p => p.startsWith(path));
            const folderName = path.slice(0, -1).split('/').pop();
            const fileWord = affected.length === 1 ? 'file' : 'files';
            if (!window.confirm(`Delete folder "${folderName}" and all ${affected.length} ${fileWord} inside?`)) return;
            let activeDeleted = false;
            for (const p of affected) {
                this.trackDeletedEntry(p, this.tree.files[p]);
                delete this.tree.files[p];
                this.deletedCount++;
                if (this.activePath === p) activeDeleted = true;
            }
            if (activeDeleted) {
                this.activePath = null;
                this.fileEditor.setFile(null);
            }
        }
        this.fileTree.refresh();
        this.updateDirtyBadge();
        if (this.reviewOverlay.style.display !== 'none') {
            this.renderReview();
        }
    }

    trackDeletedEntry(path, file) {
        if (!file) return;
        const existingIdx = this.deletedEntries.findIndex((entry) => entry.path === path);
        const entry = {
            path,
            editable: !!file.editable,
            original: file.editable ? (file.original ?? file.content ?? '') : null,
            binary: !file.editable
        };
        if (existingIdx >= 0) this.deletedEntries[existingIdx] = entry;
        else this.deletedEntries.push(entry);
    }

    showBanner(message, variant = 'info') {
        this.banner.style.display = 'block';
        this.banner.className = `gte-banner${variant === 'error' ? ' gte-banner--error' : variant === 'success' ? ' gte-banner--success' : ''}`;
        this.banner.textContent = message;
    }

    hideBanner() {
        this.banner.style.display = 'none';
        this.banner.textContent = '';
    }

    toggleShortcuts() {
        if (this.shortcutOverlay.style.display === 'none') {
            this.showShortcuts();
        } else {
            this.hideShortcuts();
        }
    }

    showShortcuts() {
        this.shortcutOverlay.style.display = 'flex';
    }

    hideShortcuts() {
        this.shortcutOverlay.style.display = 'none';
    }

    showReview() {
        if (this.dirtyCount() === 0) return;
        this.reviewOverlay.style.display = 'flex';
        this.renderReview();
    }

    hideReview() {
        this.reviewOverlay.style.display = 'none';
    }

    renderReview() {
        const modifiedEntries = getModifiedEntries(this.tree?.files || {});
        this.reviewSummary.textContent = buildReviewSummary(modifiedEntries, this.deletedEntries);

        this.reviewItems = buildReviewItems(modifiedEntries, this.deletedEntries);
        this.reviewRevertAllBtn.disabled = this.reviewItems.length === 0;

        if (this.reviewItems.length === 0) {
            this.reviewList.innerHTML = '<div class="gte-review__empty">No changes.</div>';
            this.reviewDiffTitle.textContent = 'No file selected';
            this.reviewOpenEditorBtn.disabled = true;
            this.reviewRevertBtn.disabled = true;
            this.reviewDiffMount.style.display = 'none';
            this.reviewDiffEmpty.textContent = 'Select a file to review.';
            this.reviewDiffEmpty.style.display = 'block';
            return;
        }

        this.reviewSelectedId = resolveReviewSelection(this.reviewItems, this.reviewSelectedId);

        this.renderReviewList();
        this.renderReviewSelection(this.reviewSelectedId);
    }

    renderReviewList() {
        this.reviewList.innerHTML = '';
        for (const item of this.reviewItems) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `gte-review__item${item.id === this.reviewSelectedId ? ' gte-review__item--active' : ''}`;
            button.addEventListener('click', () => this.renderReviewSelection(item.id));

            const status = document.createElement('span');
            status.className = `gte-review__item-status gte-review__item-status--${item.status}`;
            status.textContent = item.status;
            button.appendChild(status);

            const label = document.createElement('span');
            label.className = 'gte-review__item-path';
            label.textContent = item.path;
            button.appendChild(label);

            this.reviewList.appendChild(button);
        }
    }

    getSelectedReviewItem() {
        if (!this.reviewSelectedId) return null;
        return this.reviewItems.find((item) => item.id === this.reviewSelectedId) || null;
    }

    openSelectedInEditor() {
        const item = this.getSelectedReviewItem();
        if (!item || !item.editable || item.status === 'deleted') return;
        this.hideReview();
        this.selectFile(item.path, {focusEditor: true});
    }

    revertSelectedReviewItem() {
        const item = this.getSelectedReviewItem();
        if (!item) return;

        if (item.status === 'deleted') {
            if (item.editable) {
                const restored = this.revertDeletedEntry(item.path);
                if (restored) {
                    this.fileTree.refresh();
                    this.updateDirtyBadge();
                    this.renderReview();
                }
            } else {
                showToast('Cannot revert binary files yet.', 'error');
            }
            return;
        }

        this.handleRevertFile(item.path);
        const currentIndex = this.reviewItems.findIndex((entry) => entry.id === item.id);
        this.renderReview();
        if (this.reviewItems.length === 0) {
            this.hideReview();
            return;
        }
        const nextIndex = Math.min(currentIndex, this.reviewItems.length - 1);
        this.reviewSelectedId = this.reviewItems[nextIndex].id;
        this.renderReviewSelection(this.reviewSelectedId);
    }

    revertAllReviewItems() {
        const total = this.reviewItems.length;
        if (total === 0) return;
        const ok = window.confirm(`Revert all ${total} change${total === 1 ? '' : 's'}?`);
        if (!ok) return;

        let clearedActive = false;
        for (const [path, file] of Object.entries(this.tree.files)) {
            if (!file.modified) continue;

            if (file.isNew) {
                delete this.tree.files[path];
                if (this.activePath === path) {
                    this.activePath = null;
                    clearedActive = true;
                }
                continue;
            }

            if (!file.editable) continue;
            file.content = file.original ?? '';
            file.modified = false;
            if (this.activePath === path) {
                this.fileEditor.setFile(path, file.content ?? '', {
                    originalContent: file.original ?? ''
                });
            }
        }

        if (clearedActive) {
            this.fileEditor.setFile(null);
        }

        const restorable = this.deletedEntries.filter((entry) => !entry.binary);
        for (const entry of restorable) {
            this.tree.files[entry.path] = {
                path: entry.path,
                zipPath: (this.tree.rootPrefix || '') + entry.path,
                editable: true,
                content: entry.original ?? '',
                original: entry.original ?? '',
                binary: null,
                modified: false,
                date: new Date(),
                unixPermissions: null,
                dosPermissions: null
            };
        }

        this.deletedEntries = this.deletedEntries.filter((entry) => entry.binary);
        this.deletedCount = this.deletedEntries.length;

        this.fileTree.refresh();
        this.updateDirtyBadge();
        this.renderReview();

        if (this.reviewItems.length === 0) {
            this.hideReview();
            return;
        }

        if (this.deletedEntries.length > 0) {
            showToast('Some deleted binary files could not be restored.', 'error');
        }
    }

    async renderReviewSelection(id) {
        const item = this.reviewItems.find((entry) => entry.id === id);
        if (!item) return;

        this.reviewSelectedId = id;
        this.renderReviewList();

        this.reviewDiffTitle.textContent = `${item.path} (${item.status})`;
        this.reviewOpenEditorBtn.disabled = !item.editable || item.status === 'deleted';
        this.reviewRevertBtn.disabled = !item.editable;

        if (!item.editable) {
            this.reviewDiffMount.style.display = 'none';
            this.reviewDiffEmpty.textContent = 'Binary file change. Diff is not available.';
            this.reviewDiffEmpty.style.display = 'block';
            return;
        }

        this.reviewDiffEmpty.style.display = 'none';
        this.reviewDiffMount.style.display = 'block';
        await this.reviewDiffViewer.render(item);
    }

    // ---------- Close ----------

    requestClose() {
        if (this.status === 'saving') return;
        const dirty = this.dirtyCount();
        if (dirty > 0) {
            const ok = window.confirm(
                `You have ${dirty} unsaved file${dirty === 1 ? '' : 's'}. Discard changes and close?`
            );
            if (!ok) return;
        }
        this.close();
    }

    close() {
        this.hideShortcuts();
        this.hideReview();
        this.root.removeEventListener('keydown', this.onKeydown);
        this.root.remove();
        document.body.style.overflow = this.prevBodyOverflow ?? '';
        this.reviewDiffViewer?.dispose();
        this.reviewDiffViewer = null;
        this.fileEditor?.dispose();
        try {
            this.previousFocus?.focus?.();
        } catch {
            // ignore
        }
    }
}
