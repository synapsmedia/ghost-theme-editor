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
        this._editor = null;            // monaco.editor.IStandaloneCodeEditor
        this._models = new Map();       // path → monaco.editor.ITextModel
        this._creating = false;         // guard against concurrent create calls

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

            this._editor.onDidChangeModelContent(() => {
                if (this.currentPath && this.onChange) {
                    this.onChange(this.currentPath, this._editor.getValue());
                }
            });
        } finally {
            this._creating = false;
        }
    }

    _applyFile(path, content) {
        const monaco = window.monaco;
        const language = languageFor(path);
        let model = this._models.get(path);
        if (!model) {
            model = monaco.editor.createModel(content ?? '', language);
            this._models.set(path, model);
        } else if (model.getValue() !== (content ?? '')) {
            model.setValue(content ?? '');
        }
        this._editor.setModel(model);
        this._editor.focus();
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
        this.breadcrumb.appendChild(lang);
    }

    /**
     * Switch to a file. Safe to call before Monaco is loaded; the first call
     * also triggers editor creation (on a now-visible container).
     *
     * Returns a Promise that resolves once the model is set, but callers may
     * treat it as fire-and-forget.
     */
    async setFile(path, content) {
        this.currentPath = path;

        if (path === null) {
            this.monacoContainer.style.display = 'none';
            this.placeholder.style.display = 'flex';
            this.renderBreadcrumb(null);
            return;
        }

        // Show the container BEFORE creating the editor so Monaco can measure it.
        this.monacoContainer.style.display = 'block';
        this.placeholder.style.display = 'none';
        this.renderBreadcrumb(path);

        await this._createEditor();

        // If the user switched files while we were awaiting, apply the latest
        // requested path rather than the one that triggered this call.
        if (this.currentPath !== null) {
            this._applyFile(this.currentPath, content);
        }
    }

    getValue() {
        return this._editor ? this._editor.getValue() : '';
    }

    dispose() {
        for (const model of this._models.values()) {
            model.dispose();
        }
        this._models.clear();
        if (this._editor) {
            this._editor.dispose();
            this._editor = null;
        }
    }
}
