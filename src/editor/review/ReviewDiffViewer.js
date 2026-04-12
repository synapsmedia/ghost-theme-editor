import {languageFor} from '../editable.js';
import {loadMonaco} from '../loadMonaco.js';

export class ReviewDiffViewer {
    constructor({mountEl}) {
        this.mountEl = mountEl;
        this.editor = null;
        this.originalModel = null;
        this.modifiedModel = null;
        this.renderToken = 0;
    }

    async render(item) {
        await this.ensureEditor();
        await this.updateModels(item);
        this.editor?.layout();
    }

    async ensureEditor() {
        if (this.editor) return;
        const token = ++this.renderToken;
        const monaco = await loadMonaco();
        if (token !== this.renderToken || this.editor) return;

        this.editor = monaco.editor.createDiffEditor(this.mountEl, {
            automaticLayout: true,
            minimap: {enabled: false},
            scrollBeyondLastLine: false,
            wordWrap: 'off',
            theme: 'vs-dark',
            readOnly: true,
            originalEditable: false,
            renderSideBySide: true,
            renderOverviewRuler: false,
            renderIndicators: true,
            overviewRulerLanes: 0,
            fontSize: 13,
            lineHeight: 20,
            fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", monospace',
            scrollbar: {
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8
            }
        });

        this.editor.getOriginalEditor().updateOptions({
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            scrollbar: {
                vertical: 'hidden',
                horizontal: 'hidden',
                verticalScrollbarSize: 0,
                horizontalScrollbarSize: 0
            }
        });

        this.editor.getModifiedEditor().updateOptions({
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            scrollbar: {
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8
            }
        });
    }

    async updateModels(item) {
        if (!this.editor) return;
        const monaco = await loadMonaco();
        const language = languageFor(item.path);

        if (!this.originalModel) {
            this.originalModel = monaco.editor.createModel(item.before ?? '', language);
        } else {
            monaco.editor.setModelLanguage(this.originalModel, language);
            if (this.originalModel.getValue() !== (item.before ?? '')) {
                this.originalModel.setValue(item.before ?? '');
            }
        }

        if (!this.modifiedModel) {
            this.modifiedModel = monaco.editor.createModel(item.after ?? '', language);
        } else {
            monaco.editor.setModelLanguage(this.modifiedModel, language);
            if (this.modifiedModel.getValue() !== (item.after ?? '')) {
                this.modifiedModel.setValue(item.after ?? '');
            }
        }

        this.editor.setModel({
            original: this.originalModel,
            modified: this.modifiedModel
        });
    }

    dispose() {
        this.originalModel?.dispose();
        this.modifiedModel?.dispose();
        this.originalModel = null;
        this.modifiedModel = null;
        this.editor?.dispose();
        this.editor = null;
    }
}
