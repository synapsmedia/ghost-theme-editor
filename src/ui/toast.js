/**
 * Lightweight toast used for success/error notifications from outside the
 * modal context (e.g. "Theme uploaded" after the modal has already closed).
 * Inside the modal we prefer inline banners so errors stay visible for retry.
 */

let current = null;

export function showToast(message, variant = 'info', duration = 4000) {
    if (typeof document === 'undefined') return;
    if (current) {
        current.remove();
        current = null;
    }
    const el = document.createElement('div');
    el.className = `gte-toast gte-toast--${variant}`;
    el.setAttribute('role', 'status');
    el.textContent = message;
    document.body.appendChild(el);
    // Force reflow, then animate in.
    void el.offsetWidth;
    el.classList.add('gte-toast--visible');
    current = el;
    window.setTimeout(() => {
        if (!el.isConnected) return;
        el.classList.remove('gte-toast--visible');
        window.setTimeout(() => el.remove(), 220);
        if (current === el) current = null;
    }, duration);
}
