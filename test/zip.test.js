import {describe, it, expect} from 'vitest';
import JSZip from 'jszip';
import {extractZip} from '../src/zip/extract.js';
import {repackZip} from '../src/zip/repack.js';

/**
 * Round-trip test: build a synthetic theme ZIP, extract it, mutate a text
 * file, repack, and verify:
 *   - the binary file is preserved byte-for-byte
 *   - the edited text file contains the new content
 *   - the rootPrefix ("casper/") is restored on repack
 */
describe('zip round trip', () => {
    it('extracts + repacks preserving binaries and root prefix', async () => {
        const zip = new JSZip();
        zip.file('casper/package.json', JSON.stringify({name: 'casper', version: '1.0.0'}));
        zip.file('casper/templates/index.hbs', '<h1>Hi</h1>');
        // "binary" PNG header bytes
        const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
        zip.file('casper/assets/logo.png', bytes, {binary: true});

        const originalBuffer = await zip.generateAsync({type: 'arraybuffer'});

        const tree = await extractZip(originalBuffer);
        expect(tree.rootPrefix).toBe('casper/');
        expect(tree.files['package.json'].editable).toBe(true);
        expect(tree.files['templates/index.hbs'].content).toBe('<h1>Hi</h1>');
        expect(tree.files['assets/logo.png'].editable).toBe(false);
        expect(Array.from(tree.files['assets/logo.png'].binary)).toEqual(Array.from(bytes));

        // Edit a text file, mark modified.
        tree.files['templates/index.hbs'].content = '<h1>Hello</h1>';
        tree.files['templates/index.hbs'].modified = true;

        const repacked = await repackZip(tree);
        expect(repacked).toBeInstanceOf(Blob);
        const buffer = await repacked.arrayBuffer();

        const back = await JSZip.loadAsync(buffer);
        const text = await back.file('casper/templates/index.hbs').async('string');
        expect(text).toBe('<h1>Hello</h1>');
        const pkg = await back.file('casper/package.json').async('string');
        expect(JSON.parse(pkg).name).toBe('casper');
        const binAgain = await back.file('casper/assets/logo.png').async('uint8array');
        expect(Array.from(binAgain)).toEqual(Array.from(bytes));
    });

    it('handles flat zips (no common root)', async () => {
        const zip = new JSZip();
        zip.file('package.json', '{}');
        zip.file('default.hbs', '<html></html>');
        const ab = await zip.generateAsync({type: 'arraybuffer'});

        const tree = await extractZip(ab);
        expect(tree.rootPrefix).toBe('');
        expect(tree.files['package.json']).toBeDefined();
        expect(tree.files['default.hbs']).toBeDefined();
    });
});
