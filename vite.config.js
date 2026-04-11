import {defineConfig} from 'vite';
import {readFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Vite config for ghost-theme-editor.
 *
 * Output: a single self-contained IIFE at dist/ghost-theme-editor.js.
 *
 * - JSZip is bundled in (no runtime CDN dependency).
 * - CSS from src/ui/modal.css is inlined at build time via the ?raw import in
 *   src/ui/styles.js, so the final bundle contains exactly one JS file.
 * - No external globals; the IIFE is fully self-contained and runs without
 *   reading anything from window except standard browser APIs.
 */
export default defineConfig(({mode}) => ({
    build: {
        target: 'es2019',
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: mode === 'development' ? 'inline' : false,
        minify: mode === 'production',
        lib: {
            entry: resolve(__dirname, 'src/index.js'),
            name: 'GhostThemeEditor',
            formats: ['iife'],
            fileName: () => 'ghost-theme-editor.js'
        },
        rollupOptions: {
            // Nothing is external — everything must be bundled.
            external: [],
            output: {
                // Single file output; avoid chunk splitting for a lib IIFE.
                inlineDynamicImports: true,
                extend: true
            }
        }
    },
    define: {
        __GTE_VERSION__: JSON.stringify(
            JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version
        )
    }
}));
