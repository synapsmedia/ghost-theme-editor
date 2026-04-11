/**
 * Tiny inline SVG icons used by the editor. Each function returns an
 * SVGElement that the caller can append directly to the DOM.
 *
 * All icons are 16x16, currentColor stroke/fill so they inherit from CSS.
 */

const NS = 'http://www.w3.org/2000/svg';

function svg(attrs, children) {
    const el = document.createElementNS(NS, 'svg');
    el.setAttribute('xmlns', NS);
    el.setAttribute('width', '16');
    el.setAttribute('height', '16');
    el.setAttribute('viewBox', '0 0 16 16');
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', 'currentColor');
    el.setAttribute('stroke-width', '1.5');
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('aria-hidden', 'true');
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    for (const child of children || []) el.appendChild(child);
    return el;
}

function path(d) {
    const el = document.createElementNS(NS, 'path');
    el.setAttribute('d', d);
    return el;
}

function circle(cx, cy, r, fill) {
    const el = document.createElementNS(NS, 'circle');
    el.setAttribute('cx', String(cx));
    el.setAttribute('cy', String(cy));
    el.setAttribute('r', String(r));
    if (fill) el.setAttribute('fill', 'currentColor');
    return el;
}

export const icons = {
    folderClosed: () => svg({}, [path('M1.5 4.5 A1 1 0 0 1 2.5 3.5 H6 l2 2 H13.5 A1 1 0 0 1 14.5 6.5 V12 A1 1 0 0 1 13.5 13 H2.5 A1 1 0 0 1 1.5 12 Z')]),
    folderOpen: () => svg({}, [path('M1.5 12.5 V4.5 A1 1 0 0 1 2.5 3.5 H6 l2 2 H13.5 A1 1 0 0 1 14.5 6.5 V7.5 M1.5 12.5 L3 7.5 H15 L13.5 12.5 Z')]),
    file: () => svg({}, [path('M4 1.5 H9 L12.5 5 V14 A0.5 0.5 0 0 1 12 14.5 H4 A0.5 0.5 0 0 1 3.5 14 V2 A0.5 0.5 0 0 1 4 1.5 Z'), path('M9 1.5 V5 H12.5')]),
    fileText: () => svg({}, [path('M4 1.5 H9 L12.5 5 V14 A0.5 0.5 0 0 1 12 14.5 H4 A0.5 0.5 0 0 1 3.5 14 V2 A0.5 0.5 0 0 1 4 1.5 Z'), path('M9 1.5 V5 H12.5'), path('M5.5 8 H10.5'), path('M5.5 10.5 H10.5'), path('M5.5 13 H8.5')]),
    close: () => svg({}, [path('M3 3 L13 13'), path('M13 3 L3 13')]),
    chevronRight: () => svg({}, [path('M6 4 L10 8 L6 12')]),
    chevronDown: () => svg({}, [path('M4 6 L8 10 L12 6')]),
    dot: () => svg({}, [circle(8, 8, 3, true)]),
    edit: () => svg({}, [path('M2 14 L5 13 L13 5 L11 3 L3 11 Z'), path('M10 4 L12 6')])
};
