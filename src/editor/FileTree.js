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
        this._contextMenu = null;
        this._onDocMouseDown = this._onDocMouseDown.bind(this);

        this.el = document.createElement('nav');
        this.el.className = 'gte-tree';
        this.el.setAttribute('aria-label', 'Theme files');

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
                row.addEventListener('click', () => {
                    if (this.expanded.has(node.path)) this.expanded.delete(node.path);
                    else this.expanded.add(node.path);
                    this.render();
                });
                row.addEventListener('contextmenu', (e) => {
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

                row.addEventListener('click', () => {
                    if (editable && this.onSelect) this.onSelect(file.path);
                });
                row.addEventListener('contextmenu', (e) => {
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
