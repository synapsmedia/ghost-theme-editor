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

        this.dirtyBadge = document.createElement('span');
        this.dirtyBadge.className = 'gte-toolbar__badge';
        this.dirtyBadge.textContent = '0 files modified';
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
        this.fileEditor.setFile(path, file.content ?? '', {focus: focusEditor});
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
        this.saveBtn.disabled = n === 0 || this.status === 'saving';
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
                }
                f.modified = false;
            }
            this.deletedCount = 0;
            this.status = 'ready';
            this.updateDirtyBadge();
            this.fileTree.refresh();
            this.hideBanner();
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
                this.fileEditor.setFile(newPath, file.content ?? '');
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
                    this.fileEditor.setFile(newFilePath, file.content ?? '');
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
        this.root.removeEventListener('keydown', this.onKeydown);
        this.root.remove();
        document.body.style.overflow = this.prevBodyOverflow ?? '';
        this.fileEditor?.dispose();
        try {
            this.previousFocus?.focus?.();
        } catch {
            // ignore
        }
    }
}
