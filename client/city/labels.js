// The DOM laid over the city: its buttons, and everything that talks or names a place.
import { glyph } from './glyphs.js';
import { clearOf, placeBubble } from './view.js';

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
  const place = (entry, taken = []) => {
    const [ax, ay] = project(entry.ax, entry.ay), off = ax < -OFF_SIDE || ax > width + OFF_SIDE || ay < -OFF_TOP || ay > height + OFF_SIDE;
    if (off !== entry.off) { entry.off = off; entry.node.hidden = off; }
    if (off) return;
    if (entry.w === null) { entry.w = entry.node.offsetWidth; entry.h = entry.node.offsetHeight; }
    let x, y;
    if (entry.bubble) {
      const spot = placeBubble(ax, ay, entry.w, entry.h + TAIL, width, height);
      x = spot.x; y = spot.y;
      if (spot.tail !== entry.tail) { entry.tail = spot.tail; entry.bubble.style.left = `${Math.round(spot.tail)}px`; }
    } else ({ x, y } = clearOf({ x: ax - entry.w / 2, y: ay - entry.h / 2, w: entry.w, h: entry.h }, taken, width, height));
    x = Math.round(x); y = Math.round(y);
    if (x !== entry.x || y !== entry.y) { entry.x = x; entry.y = y; entry.node.style.transform = `translate(${x}px, ${y}px)`; }
  };
  const anchor = (entry, ax, ay) => { const moved = entry.ax !== ax || entry.ay !== ay; entry.ax = ax; entry.ay = ay; return moved; };
  const sweep = (prefix, keep) => { for (const [key, entry] of shown) if (key.startsWith(prefix) && !keep.has(key)) { entry.node.remove(); shown.delete(key); } };
  const settle = entry => { if (project) place(entry); };

  return {
    // items: [{ id, ax, ay, name, bubble: { icon, text, highlight } | null, unread, dim }]. A building with nothing to say still has its name.
    sync(items, step) {
      layer.classList.toggle('icons', step === 1); layer.classList.toggle('near', step > 2);
      const keep = new Set();
      for (const { id, ax, ay, name, bubble, unread, dim } of items) {
        if (!bubble && !name) continue;
        const key = `b:${id}`; keep.add(key);
        const entry = shown.get(key) || add(key, 'button', 'city-bubble');
        if (!entry.bubble) { entry.node.onclick = () => onSession(id); entry.bubble = document.createElement('i'); entry.bubble.className = 'tail'; }
        const sig = `${name}|${bubble?.icon}|${bubble?.text}|${!!bubble?.highlight}|${!!unread}|${step === 1}`;
        if (sig !== entry.sig) {
          entry.sig = sig; entry.w = null; entry.tail = null;
          const icon = iconOf(bubble?.icon), said = bubble?.text || '', words = [name, said].filter(Boolean).join(': '), dot = document.createElement('b'), rows = [];
          dot.className = 'dot';
          if (name) { const row = document.createElement('span'); row.className = 'name'; row.textContent = name; rows.push(row); }
          if (icon || said) { const row = document.createElement('span'), text = document.createElement('span'); row.className = 'said'; text.className = 'text'; text.textContent = said; row.append(...(icon ? [icon] : []), text); rows.push(row); }
          const body = document.createElement('span'); body.className = 'body'; body.append(...rows);
          entry.node.replaceChildren(body, dot, entry.bubble);
          entry.node.title = words; entry.node.setAttribute('aria-label', words || 'Open session');
          entry.node.classList.toggle('high', !!bubble?.highlight); entry.node.classList.toggle('unread', !!unread); entry.node.classList.toggle('bare', !icon);
        }
        entry.node.classList.toggle('dim', !!dim && !bubble?.highlight);
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
    // tags: [{ key, text, title, high, ax, ay }]
    tags(list) {
      const keep = new Set();
      for (const { key, text, title, high, ax, ay } of list) {
        const id = `t:${key}`; keep.add(id);
        const entry = shown.get(id) || add(id, 'div', 'city-tag');
        if (entry.sig !== text) { entry.sig = text; entry.w = null; entry.node.textContent = text; }
        entry.node.title = title; entry.node.classList.toggle('high', !!high);
        anchor(entry, ax, ay); settle(entry);
      }
      sweep('t:', keep);
    },
    // Bubbles first, then the signs around them: nothing that talks may hide a project's name, nor one name another.
    move(next, boxW, boxH) {
      project = next; width = boxW; height = boxH;
      const taken = [], signs = [];
      for (const entry of shown.values()) {
        if (entry.key.startsWith('s:')) { signs.push(entry); continue; }
        place(entry);
        if (entry.bubble && !entry.off) taken.push({ x: entry.x, y: entry.y, w: entry.w, h: entry.h + TAIL });
      }
      for (const entry of signs) { place(entry, taken); if (!entry.off) taken.push({ x: entry.x, y: entry.y, w: entry.w, h: entry.h }); }
    },
    dispose() { layer.remove(); shown.clear(); },
  };
}

export function createControls(box, { onFit, onNext, onList, onNew }) {
  const bar = document.createElement('div'); bar.className = 'city-controls'; box.append(bar);
  const button = (className, text, title, onclick) => { const b = document.createElement('button'); b.type = 'button'; b.className = className; b.textContent = text; b.title = title; b.setAttribute('aria-label', title); b.onclick = onclick; bar.append(b); return b; };
  const lost = document.createElement('div'); lost.className = 'city-lost'; lost.textContent = 'Connection lost'; lost.hidden = true; bar.append(lost);
  const waiting = button('city-waiting', '', 'Next waiting (N)', () => onNext()); waiting.hidden = true;
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
