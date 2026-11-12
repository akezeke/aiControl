import { isPid } from './carts.js';
// The boss PC's desktop windows as plain functions (the office's glass windows live in windows.js).
// State is { windows, order }, order back to front; nothing is mutated, every transition returns a new state.
export const WORK = { w: 1080, h: 596 };
export const TITLE = 26;
export const GRID = { x: 24, y: 24, size: 104, cols: 10, rows: 5 };
export const NAMES = ['pico8', 'browser', 'notepad'];
export const FIXED = new Set(['pico8']); // fixed size: never maximised
export const RECTS = {
  pico8: { x: 274, y: 21, w: 532, h: 554 },
  browser: { x: 60, y: 12, w: 900, h: 572 },
  notepad: { x: 300, y: 90, w: 520, h: 400 },
};
const MODES = ['normal', 'min', 'max'];

export const defaults = () => {
  const windows = {};
  for (const n of NAMES) windows[n] = { open: false, mode: 'normal', x: RECTS[n].x, y: RECTS[n].y };
  windows.pico8.cart = null;
  return { windows, order: ['notepad', 'browser', 'pico8'] };
};

// Keep the title bar on screen vertically and at least 80 px of the window horizontally.
export const clampDrag = ({ x, y, w }) => ({
  x: Math.min(Math.max(x, 80 - w), WORK.w - 80),
  y: Math.min(Math.max(y, 0), WORK.h - TITLE),
});

const cartOf = c => c && typeof c === 'object' && isPid(c.pid) && typeof c.title === 'string' && c.title.length >= 1 && c.title.length <= 80
  ? { pid: c.pid, title: c.title } : null;

// Shared with the server: keeps only valid saved fields, everything else falls back to the defaults.
export const normalizeWindows = value => {
  const s = defaults();
  for (const n of NAMES) {
    const v = value?.windows?.[n];
    if (!v || typeof v !== 'object') continue;
    const w = s.windows[n];
    if (typeof v.open === 'boolean') w.open = v.open;
    if (MODES.includes(v.mode) && !(v.mode === 'max' && FIXED.has(n))) w.mode = v.mode;
    const at = clampDrag({ x: Number.isFinite(v.x) ? v.x : w.x, y: Number.isFinite(v.y) ? v.y : w.y, w: RECTS[n].w });
    w.x = at.x; w.y = at.y;
    if (n === 'pico8') w.cart = cartOf(v.cart);
  }
  const o = value?.order;
  if (Array.isArray(o) && o.length === NAMES.length && new Set(o).size === NAMES.length && NAMES.every(n => o.includes(n))) s.order = [...o];
  return s;
};

export const rectOf = (s, n) => {
  const w = s.windows[n];
  return w.mode === 'max' ? { x: 0, y: 0, w: WORK.w, h: WORK.h } : { x: w.x, y: w.y, w: RECTS[n].w, h: RECTS[n].h };
};
// The game's screen inside PICO-8's window (border and title bar excluded).
export const frameRect = s => { const r = rectOf(s, 'pico8'); return { x: r.x + 3, y: r.y + 29, w: 526, h: 522 }; };

const patch = (s, n, p) => ({ ...s, windows: { ...s.windows, [n]: { ...s.windows[n], ...p } } });
export const front = (s, n) => ({ ...s, order: [...s.order.filter(m => m !== n), n] });
export const open = (s, n) => front(patch(s, n, { open: true, mode: s.windows[n].mode === 'min' ? 'normal' : s.windows[n].mode }), n);
export const close = (s, n) => patch(s, n, { open: false });
export const minimize = (s, n) => patch(s, n, { mode: 'min' });
export const toggleMax = (s, n) => FIXED.has(n) ? s : patch(s, n, { mode: s.windows[n].mode === 'max' ? 'normal' : 'max' });
export const restore = (s, n) => front(patch(s, n, { mode: s.windows[n].mode === 'min' ? 'normal' : s.windows[n].mode }), n);
export const moveTo = (s, n, { x, y }) => patch(s, n, clampDrag({ x, y, w: RECTS[n].w }));
export const loadCart = (s, { pid, title }) => { const o = open(s, 'pico8'); return patch(o, 'pico8', { cart: { pid, title } }); };

export const frontmost = s => [...s.order].reverse().find(n => s.windows[n].open && s.windows[n].mode !== 'min') ?? null;

// The parts of rect outside cut, as up to four rects (top, bottom, left, right).
export const subtract = (r, c) => {
  const x1 = Math.max(r.x, c.x), y1 = Math.max(r.y, c.y);
  const x2 = Math.min(r.x + r.w, c.x + c.w), y2 = Math.min(r.y + r.h, c.y + c.h);
  if (x1 >= x2 || y1 >= y2) return [r];
  const out = [];
  if (y1 > r.y) out.push({ x: r.x, y: r.y, w: r.w, h: y1 - r.y });
  if (y2 < r.y + r.h) out.push({ x: r.x, y: y2, w: r.w, h: r.y + r.h - y2 });
  if (x1 > r.x) out.push({ x: r.x, y: y1, w: x1 - r.x, h: y2 - y1 });
  if (x2 < r.x + r.w) out.push({ x: x2, y: y1, w: r.x + r.w - x2, h: y2 - y1 });
  return out;
};
// What of rect shows on the desktop once the rects in above are painted over it.
export const uncovered = (rect, above) => {
  const x1 = Math.max(rect.x, 0), y1 = Math.max(rect.y, 0);
  const x2 = Math.min(rect.x + rect.w, WORK.w), y2 = Math.min(rect.y + rect.h, WORK.h);
  let left = x1 < x2 && y1 < y2 ? [{ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }] : [];
  for (const c of above) left = left.flatMap(r => subtract(r, c));
  return left;
};

export const gameHidden = s => {
  const p = s.windows.pico8;
  if (!p.open || p.mode === 'min') return true;
  const above = s.order.slice(s.order.indexOf('pico8') + 1).filter(n => s.windows[n].open && s.windows[n].mode !== 'min').map(n => rectOf(s, n));
  return uncovered(frameRect(s), above).length === 0;
};

// HH:MM, as the taskbar clock and salaries.txt show it (desktop.js re-exports it).
export const clockOf = date => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
