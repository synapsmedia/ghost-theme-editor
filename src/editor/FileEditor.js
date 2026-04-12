import {languageFor} from './editable.js';
import {loadMonaco} from './loadMonaco.js';

/**
 * Monaco-based code editor pane.
 *
 * External surface (unchanged from the textarea version):
 *   new FileEditor({onChange})  — construct + build DOM; starts CDN prefetch
 *   .el                         — the root element to append
 *   .setFile(path, content)     — switch to a file (async-safe, fire-and-forget)
 *   .getValue()                 — current editor content
 *   .dispose()                  — clean up Monaco models + editor instance
 *
 * Design choice: the Monaco editor instance is created the FIRST time setFile()
 * makes the container visible, not in the constructor. Monaco must measure the
 * container's font metrics and layout on creation; doing that while the
 * container is hidden (display:none / zero-size) causes syntax highlighting to
 * not wire up. We still start the CDN fetch immediately so the load is
 * overlapped with the theme download.
 *
 * Each unique file path gets its own ITextModel so undo/redo history is
 * preserved when switching between files.
 */
export class FileEditor {
    constructor({onChange}) {
        this.onChange = onChange;
        this.currentPath = null;
        this._editor = null;                 // monaco.editor.IStandaloneCodeEditor
        this._diffEditor = null;             // monaco.editor.IStandaloneDiffEditor
        this._models = new Map();            // path → modified ITextModel
        this._originalModels = new Map();    // path → original ITextModel
        this._modelSubscriptions = new Map();// path → IDisposable
        this._creating = false;              // guard against concurrent create calls
        this._creatingDiff = false;
        this.viewMode = 'edit';

        this.el = document.createElement('div');
        this.el.className = 'gte-editor';

        this.breadcrumb = document.createElement('div');
        this.breadcrumb.className = 'gte-editor__breadcrumb';
        this.el.appendChild(this.breadcrumb);

        this.body = document.createElement('div');
        this.body.className = 'gte-editor__body';
        this.body.style.display = 'flex';
        this.body.style.flex = '1';
        this.body.style.minHeight = '0';
        this.el.appendChild(this.body);

        this.placeholder = document.createElement('div');
        this.placeholder.className = 'gte-editor__placeholder';
        this.placeholder.textContent = 'Select a file from the tree to start editing.';
        this.body.appendChild(this.placeholder);

        this.monacoContainer = document.createElement('div');
        this.monacoContainer.className = 'gte-editor__monaco';
        this.monacoContainer.style.display = 'none';
        this.body.appendChild(this.monacoContainer);

        this.diffContainer = document.createElement('div');
        this.diffContainer.className = 'gte-editor__diff';
        this.diffContainer.style.display = 'none';
        this.body.appendChild(this.diffContainer);

        this.renderBreadcrumb(null);

        // Kick off the CDN fetch immediately so Monaco is ready (or nearly so)
        // by the time the user clicks the first file. Errors are suppressed here
        // and surfaced when setFile() is actually called.
        loadMonaco().catch(() => {});
    }

    /**
     * Create the Monaco editor instance now that the container is visible.
     * Must only be called once; subsequent calls are no-ops.
     */
    async _createEditor() {
        if (this._editor || this._creating) return;
        this._creating = true;
        try {
            const monaco = await loadMonaco();
            // Re-check: another call might have raced us (shouldn't happen, but safe).
            if (this._editor) return;

            this._editor = monaco.editor.create(this.monacoContainer, {
                automaticLayout: true,      // ResizeObserver-based resize
                minimap: {enabled: false},
                scrollBeyondLastLine: false,
                wordWrap: 'off',
                theme: 'vs-dark',           // modal is always dark
                fontSize: 13,
                lineHeight: 20,
                fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", monospace',
                tabSize: 2,
                insertSpaces: true,
                renderLineHighlight: 'gutter',
                smoothScrolling: true,
                scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8
                }
            });

        } finally {
            this._creating = false;
        }
    }

    async _createDiffEditor() {
        if (this._diffEditor || this._creatingDiff) return;
        this._creatingDiff = true;
        try {
            const monaco = await loadMonaco();
            if (this._diffEditor) return;

            this._diffEditor = monaco.editor.createDiffEditor(this.diffContainer, {
                automaticLayout: true,
                minimap: {enabled: false},
                scrollBeyondLastLine: false,
                wordWrap: 'off',
                theme: 'vs-dark',
                fontSize: 13,
                lineHeight: 20,
                fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", monospace',
                renderSideBySide: true,
                renderOverviewRuler: false,
                readOnly: false,
                originalEditable: false,
                renderIndicators: true,
                overviewRulerLanes: 0,
                scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8
                }
            });

            this._diffEditor.getOriginalEditor().updateOptions({
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true,
                scrollbar: {
                    vertical: 'hidden',
                    horizontal: 'hidden',
                    verticalScrollbarSize: 0,
                    horizontalScrollbarSize: 0
                }
            });
            this._diffEditor.getModifiedEditor().updateOptions({
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true,
                scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8
                }
            });
        } finally {
            this._creatingDiff = false;
        }
    }

    _ensureModels(path, content, originalContent) {
        const monaco = window.monaco;
        const language = languageFor(path);

        let modifiedModel = this._models.get(path);
        if (!modifiedModel) {
            modifiedModel = monaco.editor.createModel(content ?? '', language);
            this._models.set(path, modifiedModel);
            const sub = modifiedModel.onDidChangeContent(() => {
                if (this.currentPath === path && this.onChange) {
                    this.onChange(path, modifiedModel.getValue());
                }
                if (this.currentPath === path) this.renderBreadcrumb(path);
            });
            this._modelSubscriptions.set(path, sub);
        } else if ((content ?? '') !== modifiedModel.getValue()) {
            modifiedModel.setValue(content ?? '');
        }

        let baselineModel = this._originalModels.get(path);
        if (!baselineModel) {
            baselineModel = monaco.editor.createModel(originalContent ?? content ?? '', language);
            this._originalModels.set(path, baselineModel);
        } else if (originalContent !== undefined && (originalContent ?? '') !== baselineModel.getValue()) {
            baselineModel.setValue(originalContent ?? '');
        }

        return {modifiedModel, baselineModel};
    }

    _canShowDiff(path) {
        if (!path) return false;
        const modifiedModel = this._models.get(path);
        const baselineModel = this._originalModels.get(path);
        if (!modifiedModel || !baselineModel) return false;
        return modifiedModel.getValue() !== baselineModel.getValue();
    }

    _syncEditorVisibility({focus = false} = {}) {
        const canDiff = this._canShowDiff(this.currentPath);
        const showDiff = this.viewMode === 'diff' && canDiff;

        this.monacoContainer.style.display = showDiff ? 'none' : 'block';
        this.diffContainer.style.display = showDiff ? 'block' : 'none';

        if (focus) {
            if (showDiff) {
                this._diffEditor?.getModifiedEditor().focus();
            } else {
                this._editor?.focus();
            }
        }
    }

    _applyFile(path, content, originalContent) {
        const {modifiedModel, baselineModel} = this._ensureModels(path, content, originalContent);
        this._editor.setModel(modifiedModel);
        if (this._diffEditor) {
            this._diffEditor.setModel({
                original: baselineModel,
                modified: modifiedModel
            });
        }
    }

    renderBreadcrumb(path) {
        this.breadcrumb.innerHTML = '';
        if (!path) {
            const hint = document.createElement('span');
            hint.textContent = 'No file selected';
            this.breadcrumb.appendChild(hint);
            return;
        }
        const label = document.createElement('span');
        const strong = document.createElement('strong');
        strong.textContent = path;
        label.appendChild(strong);
        this.breadcrumb.appendChild(label);

        const lang = document.createElement('span');
        lang.className = 'gte-lang';
        lang.textContent = languageFor(path);

        const controls = document.createElement('div');
        controls.className = 'gte-editor__controls';
        controls.appendChild(lang);

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = `gte-editor__view-btn${this.viewMode === 'edit' || !this._canShowDiff(path) ? ' gte-editor__view-btn--active' : ''}`;
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => this.setViewMode('edit'));
        controls.appendChild(editBtn);

        const diffBtn = document.createElement('button');
        diffBtn.type = 'button';
        diffBtn.className = `gte-editor__view-btn${this.viewMode === 'diff' && this._canShowDiff(path) ? ' gte-editor__view-btn--active' : ''}`;
        diffBtn.textContent = 'Diff';
        diffBtn.disabled = !this._canShowDiff(path);
        diffBtn.addEventListener('click', () => this.setViewMode('diff'));
        controls.appendChild(diffBtn);

        this.breadcrumb.appendChild(controls);
    }

    setViewMode(mode) {
        if (mode !== 'edit' && mode !== 'diff') return;
        this.viewMode = mode;
        if (this.currentPath) {
            this._syncEditorVisibility();
            this.renderBreadcrumb(this.currentPath);
        }
    }

    updateOriginal(path, originalContent) {
        const model = this._originalModels.get(path);
        if (model && model.getValue() !== (originalContent ?? '')) {
            model.setValue(originalContent ?? '');
        }
        if (this.currentPath === path) {
            if (this.viewMode === 'diff' && !this._canShowDiff(path)) {
                this.viewMode = 'edit';
            }
            this._syncEditorVisibility();
            this.renderBreadcrumb(path);
        }
    }

    /**
     * Switch to a file. Safe to call before Monaco is loaded; the first call
     * also triggers editor creation (on a now-visible container).
     *
     * Returns a Promise that resolves once the model is set, but callers may
     * treat it as fire-and-forget.
     */
    async setFile(path, content, {focus = false, originalContent} = {}) {
        const requestedPath = path;
        this.currentPath = path;

        if (path === null) {
            this.monacoContainer.style.display = 'none';
            this.placeholder.style.display = 'flex';
            this.diffContainer.style.display = 'none';
            this.renderBreadcrumb(null);
            return;
        }

        // Show the container BEFORE creating the editor so Monaco can measure it.
        this.monacoContainer.style.display = 'block';
        this.diffContainer.style.display = 'none';
        this.placeholder.style.display = 'none';
        this.renderBreadcrumb(path);

        await this._createEditor();
        await this._createDiffEditor();

        // If the user switched files while we were awaiting, apply the latest
        // requested path rather than the one that triggered this call.
        if (this.currentPath !== requestedPath || this.currentPath === null) return;

        this._applyFile(requestedPath, content, originalContent);
        this._syncEditorVisibility({focus});
        this.renderBreadcrumb(requestedPath);
    }

    getValue() {
        return this._editor ? this._editor.getValue() : '';
    }

    dispose() {
        for (const sub of this._modelSubscriptions.values()) {
            sub.dispose();
        }
        this._modelSubscriptions.clear();
        for (const model of this._models.values()) {
            model.dispose();
        }
        this._models.clear();
        for (const model of this._originalModels.values()) {
            model.dispose();
        }
        this._originalModels.clear();
        if (this._editor) {
            this._editor.dispose();
            this._editor = null;
        }
        if (this._diffEditor) {
            this._diffEditor.dispose();
            this._diffEditor = null;
        }
    }
}
