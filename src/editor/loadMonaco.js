/**
 * Loads Monaco Editor from the jsdelivr CDN exactly once, returning a promise
 * that resolves to the `window.monaco` object.
 *
 * Uses Monaco's own AMD loader (`vs/loader.js`). We intentionally do NOT
 * restore `window.require`/`window.define` after loading because Monaco
 * registers language tokenizers lazily via AMD after the initial load; if the
 * AMD system is torn down, those registrations silently fail and syntax
 * highlighting is lost. Ghost Admin's Ember modules are fully initialized at
 * page-load time and do not rely on `window.require` at runtime, so leaving
 * Monaco's AMD loader in place is safe.
 *
 * Workers are spun up via a blob-URL `importScripts()` pattern so that
 * cross-origin CDN scripts are allowed in all modern browsers.
 */

const MONACO_VERSION = '0.50.0';
const MONACO_CDN = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;

let _promise = null;

export function loadMonaco() {
    if (_promise) return _promise;
    _promise = _load();
    return _promise;
}

async function _load() {
    if (window.monaco) return window.monaco;

    // Workers loaded from a CDN URL need to run importScripts() via a blob so
    // the browser treats them as same-origin.
    window.MonacoEnvironment = {
        getWorker(_, label) {
            let workerPath;
            if (label === 'json') {
                workerPath = `${MONACO_CDN}/language/json/json.worker.js`;
            } else if (label === 'css' || label === 'scss' || label === 'less') {
                workerPath = `${MONACO_CDN}/language/css/css.worker.js`;
            } else if (label === 'html' || label === 'handlebars' || label === 'razor') {
                workerPath = `${MONACO_CDN}/language/html/html.worker.js`;
            } else if (label === 'typescript' || label === 'javascript') {
                workerPath = `${MONACO_CDN}/language/typescript/ts.worker.js`;
            } else {
                workerPath = `${MONACO_CDN}/editor/editor.worker.js`;
            }
            const blob = new Blob(
                [`importScripts('${workerPath}');`],
                {type: 'application/javascript'}
            );
            return new Worker(URL.createObjectURL(blob));
        }
    };

    await loadScript(`${MONACO_CDN}/loader.js`);

    // window.require is now Monaco's AMD loader. Configure it and load the
    // full editor bundle (includes all built-in language tokenizers).
    const monacoRequire = window.require;
    monacoRequire.config({paths: {vs: MONACO_CDN}});

    await new Promise((resolve, reject) => {
        monacoRequire(['vs/editor/editor.main'], resolve, reject);
    });

    return window.monaco;
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`Failed to load Monaco from CDN: ${src}`));
        document.head.appendChild(s);
    });
}
