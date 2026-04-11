import {EditorModal} from '../editor/EditorModal.js';

/**
 * Watches for Ghost Admin's theme action menu to open, and injects an
 * "Edit in Browser" button alongside the "Download" item.
 *
 * Approach (see ANALYSIS.md §2):
 *  - The theme list lives in admin-x-settings (React). Each row is rendered
 *    with id="theme-${theme.name}".
 *  - The "…" menu uses Radix Popover, which portals its content to body with
 *    [data-testid="popover-content"], and sets aria-controls on the trigger.
 *  - When a popover opens with a "Download" button whose trigger is inside a
 *    [id^="theme-"] list item, we inject our button there.
 *
 * The observer is idempotent: every injection is guarded by checking for an
 * existing [data-gte-edit-button] in the popover, and the watcher only acts
 * on added nodes (not on its own DOM mutations).
 */
export function startButtonInjection() {
    if (window.__gteInjectorStarted) return;
    window.__gteInjectorStarted = true;

    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (!(node instanceof Element)) continue;
                // The popover content itself can be the added node, or it can
                // be a descendant (Radix wraps in a positioning container).
                const popovers = collectPopovers(node);
                for (const pop of popovers) tryInjectIntoPopover(pop);
            }
        }
    });

    observer.observe(document.body, {childList: true, subtree: true});

    // Handle any popovers that were already open when we started.
    document
        .querySelectorAll('[data-testid="popover-content"]')
        .forEach(tryInjectIntoPopover);
}

function collectPopovers(node) {
    const out = [];
    if (node.matches && node.matches('[data-testid="popover-content"]')) {
        out.push(node);
    }
    if (node.querySelectorAll) {
        node.querySelectorAll('[data-testid="popover-content"]').forEach((el) => out.push(el));
    }
    return out;
}

function tryInjectIntoPopover(popover) {
    // Already injected?
    if (popover.querySelector('[data-gte-edit-button]')) return;

    // Find the Download button inside this popover.
    const downloadBtn = findDownloadButton(popover);
    if (!downloadBtn) return;

    // Find the trigger element that this popover is attached to, via Radix's
    // aria-controls linkage, so we can walk up to the theme row.
    const themeName = resolveThemeNameForPopover(popover);
    if (!themeName) return;

    const injected = buildInjectedButton(downloadBtn, themeName);
    downloadBtn.parentNode.insertBefore(injected, downloadBtn);
}

function findDownloadButton(popover) {
    const buttons = popover.querySelectorAll('button');
    for (const btn of buttons) {
        // Menu items are plain <button> with their label as textContent.
        const text = (btn.textContent || '').trim();
        if (text === 'Download') return btn;
    }
    return null;
}

function resolveThemeNameForPopover(popover) {
    // Radix sets an id on PopoverPrimitive.Content and aria-controls on its
    // Trigger. Search for the trigger in the main DOM and walk up.
    const popoverId = popover.id;
    let trigger = null;
    if (popoverId) {
        trigger = document.querySelector(`[aria-controls="${CSS.escape(popoverId)}"]`);
    }
    if (!trigger) return null;

    // The id="theme-<name>" is on an inner content div that is a sibling of the
    // action area (not an ancestor of the trigger). Walk up the trigger's ancestors
    // until we find one that contains a [id^="theme-"] descendant.
    let el = trigger.parentElement;
    while (el && el !== document.body) {
        const idEl = el.querySelector('[id^="theme-"]');
        if (idEl) {
            const id = idEl.getAttribute('id') || '';
            if (!id.startsWith('theme-')) return null;
            return id.slice('theme-'.length) || null;
        }
        el = el.parentElement;
    }
    return null;
}

function buildInjectedButton(downloadBtn, themeName) {
    // Copy Ghost's own menu item classes so the visual match is exact. Then
    // add a marker class + data attribute we use for idempotency + targeting.
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${downloadBtn.className} gte-injected-item`;
    btn.dataset.gteEditButton = '1';
    btn.dataset.gteThemeName = themeName;
    btn.textContent = 'Edit in Browser';

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openEditor(themeName);
    });

    return btn;
}

function openEditor(themeName) {
    try {
        const modal = new EditorModal({themeName});
        modal.mount();
    } catch (err) {
        /* eslint-disable no-console */
        console.error('[ghost-theme-editor] Failed to open editor:', err);
        /* eslint-enable no-console */
        window.alert(`Could not open the theme editor: ${err?.message || err}`);
    }
}
