import {icons} from '../ui/icons.js';

/**
 * Renders a collapsible file/folder tree from a flat file map.
 *
 * Usage:
 *
 *   const tree = new FileTree({
 *     files,                              // { "path/to/file.hbs": {editable, modified, ...} }
 *     onSelect: (path) => {...},
 *     isActive: (path) => path === activePath,
 *     onCreateFile: (parentPath) => {...},   // parentPath = '' for root, 'dir/' for folder
 *     onCreateFolder: (parentPath) => {...},
 *     onRename: (path, type) => {...},        // type = 'file' | 'dir'
 *     onDelete: (path, type) => {...},
 *   });
 *   container.appendChild(tree.el);
 *   tree.render();
 *   // later: tree.refresh() to reflect dirty markers / active change
 *
 * Folders are expanded by default on first render.
 */
export class FileTree {
    constructor({files, onSelect, isActive, onCreateFile, onCreateFolder, onRename, onDelete}) {
        this.files = files;
        this.onSelect = onSelect;
        this.isActive = isActive;
        this.onCreateFile = onCreateFile;
        this.onCreateFolder = onCreateFolder;
        this.onRename = onRename;
        this.onDelete = onDelete;
        this.expanded = new Set(['']); // '' is the root, always open
        this.selectedPath = null;
        this.selectedType = null;
        this._contextMenu = null;
        this._onDocMouseDown = this._onDocMouseDown.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);

        this.el = document.createElement('nav');
        this.el.className = 'gte-tree';
        this.el.setAttribute('aria-label', 'Theme files');
        this.el.setAttribute('tabindex', '0');
        this.el.setAttribute('role', 'tree');
        this.el.addEventListener('keydown', this._onKeyDown);

        // Right-click on empty tree area → root-level create actions
        this.el.addEventListener('contextmenu', (e) => {
            if (!e.target.closest('.gte-tree__node')) {
                this._showContextMenu(e, [
                    {label: 'New File', action: () => this.onCreateFile?.('')},
                    {label: 'New Folder', action: () => this.onCreateFolder?.('')}
                ]);
            }
        });
    }

    // ---------- Context menu ----------

    _showContextMenu(e, items) {
        e.preventDefault();
        e.stopPropagation();
        this._dismissMenu();

        const menu = document.createElement('ul');
        menu.className = 'gte-context-menu';

        for (const {label, action, danger} of items) {
            const li = document.createElement('li');
            li.className = 'gte-context-menu__item' + (danger ? ' gte-context-menu__item--danger' : '');
            li.textContent = label;
            li.addEventListener('mousedown', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this._dismissMenu();
                action();
            });
            menu.appendChild(li);
        }

        document.body.appendChild(menu);
        this._contextMenu = menu;

        // Position within viewport
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const approxH = items.length * 34 + 8;
        const x = Math.max(4, Math.min(e.clientX, vw - 188));
        const y = Math.max(4, Math.min(e.clientY, vh - approxH - 4));
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        // Defer so this same event doesn't immediately dismiss the menu
        setTimeout(() => {
            document.addEventListener('mousedown', this._onDocMouseDown, true);
        }, 0);
    }

    _onDocMouseDown(e) {
        if (this._contextMenu && !this._contextMenu.contains(e.target)) {
            this._dismissMenu();
        }
    }

    _dismissMenu() {
        if (this._contextMenu) {
            this._contextMenu.remove();
            this._contextMenu = null;
        }
        document.removeEventListener('mousedown', this._onDocMouseDown, true);
    }

    _dirExists(path) {
        for (const filePath of Object.keys(this.files)) {
            if (filePath.startsWith(path)) return true;
        }
        return false;
    }

    _findActivePath() {
        if (!this.isActive) return null;
        for (const filePath of Object.keys(this.files)) {
            if (this.isActive(filePath)) return filePath;
        }
        return null;
    }

    _ensureSelection() {
        const selectedIsFile = this.selectedType === 'file' && this.selectedPath && this.files[this.selectedPath];
        const selectedIsDir = this.selectedType === 'dir' && this.selectedPath && this._dirExists(this.selectedPath);
        if (selectedIsFile || selectedIsDir) return;

        this.selectedPath = null;
        this.selectedType = null;

        const activePath = this._findActivePath();
        if (activePath) {
            this.selectedPath = activePath;
            this.selectedType = 'file';
        }
    }

    _setSelection(path, type) {
        this.selectedPath = path;
        this.selectedType = type;
    }

    _selectedRowElement() {
        if (!this.selectedPath || !this.selectedType) return null;
        return this.el.querySelector(`.gte-tree__node[data-path="${CSS.escape(this.selectedPath)}"][data-type="${this.selectedType}"]`);
    }

    _visibleRows() {
        return Array.from(this.el.querySelectorAll('.gte-tree__node'));
    }

    _selectRowAtIndex(rows, index) {
        const row = rows[index];
        if (!row) return;
        this._setSelection(row.dataset.path, row.dataset.type);
        this.render();
        this._selectedRowElement()?.scrollIntoView({block: 'nearest'});
    }

    _onKeyDown(e) {
        if (e.defaultPrevented) return;
        const rows = this._visibleRows();
        if (!rows.length) return;

        const currentIndex = this.selectedPath && this.selectedType
            ? rows.findIndex((row) => row.dataset.path === this.selectedPath && row.dataset.type === this.selectedType)
            : -1;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIndex = currentIndex < 0 ? 0 : Math.min(rows.length - 1, currentIndex + 1);
            this._selectRowAtIndex(rows, nextIndex);
            return;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prevIndex = currentIndex < 0 ? rows.length - 1 : Math.max(0, currentIndex - 1);
            this._selectRowAtIndex(rows, prevIndex);
            return;
        }

        if (e.key === 'ArrowRight') {
            if (this.selectedType !== 'dir' || !this.selectedPath) return;
            e.preventDefault();
            if (!this.expanded.has(this.selectedPath)) {
                this.expanded.add(this.selectedPath);
                this.render();
            }
            return;
        }

        if (e.key === 'ArrowLeft') {
            if (this.selectedType !== 'dir' || !this.selectedPath) return;
            e.preventDefault();
            if (this.expanded.has(this.selectedPath)) {
                this.expanded.delete(this.selectedPath);
                this.render();
            }
            return;
        }

        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!this.selectedPath || !this.selectedType) return;
            if (this.selectedType === 'dir') {
                if (this.expanded.has(this.selectedPath)) this.expanded.delete(this.selectedPath);
                else this.expanded.add(this.selectedPath);
                this.render();
                return;
            }
            const file = this.files[this.selectedPath];
            if (file?.editable) this.onSelect?.(this.selectedPath);
            return;
        }

        if (e.key === 'F2') {
            if (!this.selectedPath || !this.selectedType) return;
            e.preventDefault();
            this.onRename?.(this.selectedPath, this.selectedType);
            return;
        }

        if (e.key === 'Delete') {
            if (!this.selectedPath || !this.selectedType) return;
            e.preventDefault();
            this.onDelete?.(this.selectedPath, this.selectedType);
        }
    }

    /**
     * Build a nested structure:
     *   { type: 'dir', name, path, children: { name → node } }
     *   { type: 'file', name, path, file: <fileEntry> }
     */
    buildTree() {
        const root = {type: 'dir', name: '', path: '', children: new Map()};
        const paths = Object.keys(this.files).sort();

        for (const path of paths) {
            const parts = path.split('/');
            let cursor = root;
            for (let i = 0; i < parts.length; i++) {
                const name = parts[i];
                const isLast = i === parts.length - 1;
                if (isLast) {
                    cursor.children.set(name, {
                        type: 'file',
                        name,
                        path,
                        file: this.files[path]
                    });
                } else {
                    let child = cursor.children.get(name);
                    if (!child) {
                        const dirPath = parts.slice(0, i + 1).join('/') + '/';
                        child = {
                            type: 'dir',
                            name,
                            path: dirPath,
                            children: new Map()
                        };
                        cursor.children.set(name, child);
                    }
                    cursor = child;
                }
            }
        }

        // First render: expand the top-level folders by default.
        if (this.expanded.size === 1) {
            for (const child of root.children.values()) {
                if (child.type === 'dir') this.expanded.add(child.path);
            }
        }

        return root;
    }

    render() {
        this._ensureSelection();
        this.el.innerHTML = '';
        if (Object.keys(this.files).length === 0) {
            const empty = document.createElement('div');
            empty.className = 'gte-tree__empty';
            empty.textContent = 'No files.';
            this.el.appendChild(empty);
            return;
        }
        const root = this.buildTree();
        const list = document.createElement('ul');
        this.renderChildren(root, list, 0);
        this.el.appendChild(list);
    }

    renderChildren(parent, listEl, depth) {
        // Sort: dirs first, then files, each alphabetically.
        const entries = [...parent.children.values()].sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        for (const node of entries) {
            const li = document.createElement('li');
            const row = document.createElement('div');
            row.className = 'gte-tree__node';
            row.style.paddingLeft = `${8 + depth * 12}px`;
            row.dataset.path = node.path;
            row.dataset.type = node.type;
            row.setAttribute('role', 'treeitem');
            row.setAttribute('aria-selected', this.selectedPath === node.path && this.selectedType === node.type ? 'true' : 'false');

            if (this.selectedPath === node.path && this.selectedType === node.type) {
                row.classList.add('gte-tree__node--selected');
            }

            const chev = document.createElement('span');
            chev.className = 'gte-tree__chev';
            const iconWrap = document.createElement('span');
            iconWrap.className = 'gte-tree__icon';
            const label = document.createElement('span');
            label.className = 'gte-tree__label';
            label.textContent = node.name;

            if (node.type === 'dir') {
                const isOpen = this.expanded.has(node.path);
                chev.appendChild(isOpen ? icons.chevronDown() : icons.chevronRight());
                iconWrap.appendChild(isOpen ? icons.folderOpen() : icons.folderClosed());
                row.appendChild(chev);
                row.appendChild(iconWrap);
                row.appendChild(label);
                row.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                row.addEventListener('mousedown', () => this.el.focus());
                row.addEventListener('click', () => {
                    this._setSelection(node.path, 'dir');
                    if (this.expanded.has(node.path)) this.expanded.delete(node.path);
                    else this.expanded.add(node.path);
                    this.render();
                });
                row.addEventListener('contextmenu', (e) => {
                    this._setSelection(node.path, 'dir');
                    this.render();
                    this._showContextMenu(e, [
                        {label: 'New File', action: () => this.onCreateFile?.(node.path)},
                        {label: 'New Folder', action: () => this.onCreateFolder?.(node.path)},
                        {label: 'Rename', action: () => this.onRename?.(node.path, 'dir')},
                        {label: 'Delete', action: () => this.onDelete?.(node.path, 'dir'), danger: true}
                    ]);
                });
                li.appendChild(row);
                if (isOpen) {
                    const childList = document.createElement('ul');
                    this.renderChildren(node, childList, depth + 1);
                    li.appendChild(childList);
                }
            } else {
                chev.className = 'gte-tree__chev gte-tree__chev--leaf';
                const file = node.file;
                const editable = file.editable;
                iconWrap.appendChild(editable ? icons.fileText() : icons.file());
                row.appendChild(chev);
                row.appendChild(iconWrap);
                row.appendChild(label);
                row.removeAttribute('aria-expanded');

                if (file.modified) {
                    const dot = document.createElement('span');
                    dot.className = 'gte-tree__dirty';
                    dot.title = 'Modified';
                    row.appendChild(dot);
                }

                if (!editable) {
                    row.classList.add('gte-tree__node--binary');
                    row.title = 'Binary file (preserved unchanged)';
                }

                if (this.isActive && this.isActive(file.path)) {
                    row.classList.add('gte-tree__node--active');
                }

                row.addEventListener('mousedown', () => this.el.focus());
                row.addEventListener('click', () => {
                    this._setSelection(file.path, 'file');
                    if (editable && this.onSelect) this.onSelect(file.path);
                    this.render();
                });
                row.addEventListener('contextmenu', (e) => {
                    this._setSelection(file.path, 'file');
                    this.render();
                    this._showContextMenu(e, [
                        {label: 'Rename', action: () => this.onRename?.(node.path, 'file')},
                        {label: 'Delete', action: () => this.onDelete?.(node.path, 'file'), danger: true}
                    ]);
                });
                li.appendChild(row);
            }
            listEl.appendChild(li);
        }
    }

    refresh() {
        this.render();
    }
}
