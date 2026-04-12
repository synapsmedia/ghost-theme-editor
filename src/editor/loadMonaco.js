/**
 * Loads Monaco Editor from the jsdelivr CDN exactly once, returning a promise
 * that resolves to the `window.monaco` object.
 *
 * Uses Monaco's own AMD loader (`vs/loader.js`). After Monaco finishes loading
 * we restore `window.require` to a proxy that routes AMD-style calls (array
 * deps + callback) to Monaco's AMD loader and CommonJS-style calls (string) to
 * the original Ghost Admin / Ember `require`. This prevents the
 * "Unrecognized require call" errors that occur when Ghost Admin's Ember vendor
 * bundle calls `require('some-ember-module')` and encounters Monaco's AMD
 * loader instead of the original one.
 *
 * Workers are spun up via a blob-URL `importScripts()` pattern so that
 * cross-origin CDN scripts are allowed in all modern browsers.
 */

const MONACO_VERSION = '0.55.1';
const MONACO_CDN = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;

let _promise = null;

export function loadMonaco() {
    if (_promise) return _promise;
    _promise = _load();
    return _promise;
}

async function _load() {
    if (window.monaco) return window.monaco;

    // Preserve the original window.require (Ghost Admin / Ember loader) before
    // Monaco's loader.js overwrites it with its own AMD require.
    const originalRequire = window.require;

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

    // Restore window.require as a proxy so Ghost Admin's Ember modules
    // continue to work. AMD-style calls (array deps) go to Monaco; CommonJS-
    // style calls (string) go to the original Ember require.
    if (originalRequire) {
        window.require = function proxyRequire(deps, callback, errback) {
            if (Array.isArray(deps)) {
                return monacoRequire(deps, callback, errback);
            }
            return originalRequire(deps);
        };
        // Copy over any properties the original require had (e.g. .entries)
        Object.assign(window.require, originalRequire);
    }

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
