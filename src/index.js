/**
 * ghost-theme-editor
 *
 * Entry point. Loaded into Ghost Admin via config.clientExtensions.script.
 * Everything after this file is vanilla DOM — we make NO assumptions about
 * Ghost Admin's internal Ember or React trees and only read public-looking
 * DOM attributes (id="theme-…", data-testid="popover-content", etc).
 *
 * See ANALYSIS.md for the contracts we depend on.
 */

import {startButtonInjection} from './ui/injectButton.js';

// eslint-disable-next-line no-undef
const VERSION = typeof __GTE_VERSION__ !== 'undefined' ? __GTE_VERSION__ : 'dev';

function bootstrap() {
    // The extension only makes sense inside Ghost Admin. Ghost already gates
    // script loading behind `session.isAuthenticated && session.user`, but
    // belt-and-braces: if we're not under /ghost/, do nothing.
    if (!window.location.pathname.includes('/ghost/')) return;

    try {
        startButtonInjection();
        /* eslint-disable no-console */
        console.info(
            `%c[ghost-theme-editor] ${VERSION} ready — open a theme's "…" menu to see the editor.`,
            'color:#14b886'
        );
        /* eslint-enable no-console */
    } catch (err) {
        /* eslint-disable no-console */
        console.error('[ghost-theme-editor] failed to start:', err);
        /* eslint-enable no-console */
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, {once: true});
} else {
    bootstrap();
}
