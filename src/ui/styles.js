// Vite inlines the CSS file as a string at build time via ?raw.
// The CSS is then injected via a single <style> tag on demand.
import css from './modal.css?raw';

let injected = false;

export function ensureStylesInjected() {
    if (injected) return;
    if (typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.setAttribute('data-gte-styles', '1');
    style.textContent = css;
    document.head.appendChild(style);
    injected = true;
}
