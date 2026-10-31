// The DOM laid over the city: its buttons, and everything that talks or names a place.
import { glyph } from './glyphs.js';
import { placeBubble } from './view.js';

const TAIL = 6, OFF_SIDE = 24, OFF_TOP = 48, INK = '#2e222f';

// A 7 x 7 pixel icon, so that no emoji brings in a colour from outside the palette.
function iconOf(emoji) {
  const shape = glyph(emoji);
  if (!shape) return null;
  const canvas = document.createElement('canvas'); canvas.className = 'icon'; canvas.width = shape.w; canvas.height = shape.h;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = INK;
  shape.rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') ctx.fillRect(x, y, 1, 1); }));
  return canvas;
}

// Anchors are in the city's screen coordinates: `project` turns them into CSS pixels, so a pan only has to rewrite transforms.
export function createLabels(box, { onSession, onHood }) {
  const layer = document.createElement('div'); layer.className = 'city-labels'; box.append(layer);
  const shown = new Map();
  let project = null, width = 0, height = 0;
  const add = (key, tag, className) => {
    const node = document.createElement(tag); node.className = className;
    if (tag === 'button') node.type = 'button';
    const entry = { key, node, ax: 0, ay: 0, w: null, h: 0, x: null, y: null, tail: null, off: null, sig: null };
    shown.set(key, entry); layer.append(node);
    return entry;
  };
  const place = entry => {
    const [ax, ay] = project(entry.ax, entry.ay), off = ax < -OFF_SIDE || ax > width + OFF_SIDE || ay < -OFF_TOP || ay > height + OFF_SIDE;
    if (off !== entry.off) { entry.off = off; entry.node.hidden = off; }
    if (off) return;
    if (entry.w === null) { entry.w = entry.node.offsetWidth; entry.h = entry.node.offsetHeight; }
    let x, y;
    if (entry.bubble) {
      const spot = placeBubble(ax, ay, entry.w, entry.h + TAIL, width, height);
      x = spot.x; y = spot.y;
      if (spot.tail !== entry.tail) { entry.tail = spot.tail; entry.bubble.style.left = `${Math.round(spot.tail)}px`; }
    } else { x = ax - entry.w / 2; y = ay - entry.h / 2; }
    x = Math.round(x); y = Math.round(y);
    if (x !== entry.x || y !== entry.y) { entry.x = x; entry.y = y; entry.node.style.transform = `translate(${x}px, ${y}px)`; }
  };
  const anchor = (entry, ax, ay) => { const moved = entry.ax !== ax || entry.ay !== ay; entry.ax = ax; entry.ay = ay; return moved; };
  const sweep = (prefix, keep) => { for (const [key, entry] of shown) if (key.startsWith(prefix) && !keep.has(key)) { entry.node.remove(); shown.delete(key); } };
  const settle = entry => { if (project) place(entry); };

  return {
    // items: [{ id, ax, ay, bubble: { icon, text, highlight } | null, unread, dim }]
    sync(items, step) {
      layer.classList.toggle('icons', step === 1);
      const keep = new Set();
      for (const { id, ax, ay, bubble, unread, dim } of items) {
        if (!bubble) continue;
        const key = `b:${id}`; keep.add(key);
        const entry = shown.get(key) || add(key, 'button', 'city-bubble');
        if (!entry.bubble) { entry.node.onclick = () => onSession(id); entry.bubble = document.createElement('i'); entry.bubble.className = 'tail'; }
        const sig = `${bubble.icon}|${bubble.text}|${!!bubble.highlight}|${!!unread}|${step === 1}`;
        if (sig !== entry.sig) {
          entry.sig = sig; entry.w = null; entry.tail = null;
          const icon = iconOf(bubble.icon), text = document.createElement('span'), dot = document.createElement('b');
          text.className = 'text'; text.textContent = bubble.text || ''; dot.className = 'dot';
          entry.node.replaceChildren(...(icon ? [icon] : []), text, dot, entry.bubble);
          entry.node.title = bubble.text || ''; entry.node.setAttribute('aria-label', bubble.text || 'Open session');
          entry.node.classList.toggle('high', !!bubble.highlight); entry.node.classList.toggle('unread', !!unread); entry.node.classList.toggle('bare', !icon);
        }
        entry.node.classList.toggle('dim', !!dim && !bubble.highlight);
        anchor(entry, ax, ay); settle(entry);
      }
      sweep('b:', keep);
    },
    // signs: [{ key, name, ax, ay, selected }]
    signs(list) {
      const keep = new Set();
      for (const { key, name, ax, ay, selected } of list) {
        const id = `s:${key}`; keep.add(id);
        const entry = shown.get(id) || add(id, 'button', 'city-sign');
        // Back on the scene afterwards, so that Tab moves the cursor this just put on a lot.
        entry.node.onclick = event => { event.currentTarget.blur(); onHood(key); };
        if (entry.sig !== name) { entry.sig = name; entry.w = null; entry.node.textContent = name; entry.node.title = name; }
        entry.node.classList.toggle('selected', !!selected);
        anchor(entry, ax, ay); settle(entry);
      }
      sweep('s:', keep);
    },
    // tags: [{ key, text, title, ax, ay }]
    tags(list) {
      const keep = new Set();
      for (const { key, text, title, ax, ay } of list) {
        const id = `t:${key}`; keep.add(id);
        const entry = shown.get(id) || add(id, 'div', 'city-tag');
        if (entry.sig !== text) { entry.sig = text; entry.w = null; entry.node.textContent = text; entry.node.title = title; }
        anchor(entry, ax, ay); settle(entry);
      }
      sweep('t:', keep);
    },
    move(next, boxW, boxH) { project = next; width = boxW; height = boxH; shown.forEach(place); },
    dispose() { layer.remove(); shown.clear(); },
  };
}

export function createControls(box, { onRotate, onFit, onNext, onList, onNew }) {
  const bar = document.createElement('div'); bar.className = 'city-controls'; box.append(bar);
  const button = (className, text, title, onclick) => { const b = document.createElement('button'); b.type = 'button'; b.className = className; b.textContent = text; b.title = title; b.setAttribute('aria-label', title); b.onclick = onclick; bar.append(b); return b; };
  const lost = document.createElement('div'); lost.className = 'city-lost'; lost.textContent = 'Connection lost'; lost.hidden = true; bar.append(lost);
  const waiting = button('city-waiting', '', 'Next waiting (N)', () => onNext()); waiting.hidden = true;
  button('', '⟲', 'Turn left (Q)', () => onRotate(-1));
  button('', '⟳', 'Turn right (E)', () => onRotate(1));
  // Drawn, because no font on most machines has a "fit" glyph and an empty box isn't an icon.
  button('', '', 'Fit city (F)', () => onFit()).innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><path d="M1 1h5v2H3v3H1zM10 1h5v5h-2V3h-3zM1 10h2v3h3v2H1zM13 10h2v5h-5v-2h3z"/></svg>';
  button('', '+', 'New project', event => onNew(event.currentTarget));
  button('', '☰', 'Show the list', () => onList());
  return {
    setWaiting(n) { waiting.hidden = !n; waiting.textContent = `⚠ ${n}`; },
    setLost(on) { lost.hidden = !on; },
    dispose() { bar.remove(); },
  };
}
