// The DOM laid over the city: its buttons, and everything that talks or names a place.
import { glyph } from './glyphs.js';
import { clearOf, offMap, placeBubble } from './view.js';

const TAIL = 6, INK = '#2e222f';
const POP = [{ transform: 'scale(.6)' }, { transform: 'scale(1.15)', offset: .5 }, { transform: 'scale(1)' }], POP_TIMING = { duration: 220, easing: 'steps(5)', composite: 'add' };

// A 7 x 7 pixel icon, so that no emoji brings in a colour from outside the palette.
function iconOf(emoji) {
  const shape = glyph(emoji);
  if (!shape) return null;
  const canvas = document.createElement('canvas'); canvas.className = 'icon'; canvas.width = shape.w; canvas.height = shape.h;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = INK;
  shape.rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') ctx.fillRect(x, y, 1, 1); }));
  return canvas;
}

// Drawn on the same pixel grid as the city, so that no font brings its own idea of a plus sign.
const pixels = path => `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" fill-rule="evenodd" shape-rendering="crispEdges" aria-hidden="true"><path d="${path}"/></svg>`;
const FOLDER = 'M1 3h6v2h8v9H1zM3 7v5h10V7z';

// Anchors are in the city's screen coordinates: `project` turns them into CSS pixels, so a pan only has to rewrite transforms.
export function createLabels(box, { onSession, onHood, onHoodHover = () => {}, onPlantHover = () => {}, onPlantTap = () => {}, inTheWay = () => [] }) {
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
    // A bubble is held on the map by its tail, so its own width doesn't keep it there.
    const [ax, ay] = project(entry.ax, entry.ay), off = offMap(ax, ay, entry.bubble ? 0 : entry.w ?? 0, width, height);
    if (off !== entry.off) { entry.off = off; entry.node.hidden = off; }
    if (off) return;
    if (entry.w === null) { entry.w = entry.node.offsetWidth; entry.h = entry.node.offsetHeight; }
    let x, y;
    if (entry.bubble) {
      const spot = placeBubble(ax, ay, entry.w, entry.h + TAIL, width, height);
      x = spot.x; y = spot.y;
      if (spot.tail !== entry.tail) { entry.tail = spot.tail; entry.bubble.style.left = `${Math.round(spot.tail)}px`; }
    } else {
      // A sign stands on its project's corner, with its tail on the spot; pushed off by something in the way, a tail would point at nothing.
      const sign = entry.key.startsWith('s:'), want = { x: ax - entry.w / 2, y: sign ? ay - entry.h - TAIL : ay - entry.h / 2 };
      ({ x, y } = clearOf({ ...want, w: entry.w, h: entry.h }, taken, width, height));
      if (sign) entry.node.classList.toggle('adrift', x !== want.x || y !== want.y);
    }
    // Others dodge the exact spot: the rounded one differs by up to a pixel from frame to frame.
    entry.fx = x; entry.fy = y; x = Math.round(x); y = Math.round(y);
    if (x !== entry.x || y !== entry.y) { entry.x = x; entry.y = y; entry.node.style.transform = `translate(${x}px, ${y}px)`; }
  };
  const anchor = (entry, ax, ay) => { const moved = entry.ax !== ax || entry.ay !== ay; entry.ax = ax; entry.ay = ay; return moved; };
  const sweep = (prefix, keep) => { for (const [key, entry] of shown) if (key.startsWith(prefix) && !keep.has(key)) { entry.node.remove(); shown.delete(key); } };
  const settle = entry => { if (project) place(entry); };

  return {
    // items: [{ id, ax, ay, name, bubble: { icon, text, highlight, terse } | null, unread, dim, mood: 'working' | 'asleep' | null }]. A building with nothing to say still has its name.
    sync(items, step) {
      layer.classList.toggle('icons', step === 1); layer.classList.toggle('near', step > 2);
      const keep = new Set();
      for (const { id, ax, ay, name, bubble, unread, dim, mood } of items) {
        if (!bubble && !name) continue;
        const key = `b:${id}`; keep.add(key);
        const entry = shown.get(key) || add(key, 'button', 'city-bubble');
        if (!entry.bubble) { entry.node.onclick = () => onSession(id); entry.bubble = document.createElement('i'); entry.bubble.className = 'tail'; }
        const sig = `${name}|${bubble?.icon}|${bubble?.text}|${!!bubble?.highlight}|${!!bubble?.terse}|${!!unread}|${step === 1}`;
        if (sig !== entry.sig) {
          // A bubble whose news has changed, rather than its wording, pops. On top of wherever it's been placed.
          const news = `${bubble?.icon}|${!!bubble?.highlight}`;
          if (entry.sig && news !== entry.news && !matchMedia('(prefers-reduced-motion: reduce)').matches) entry.node.animate(POP, POP_TIMING);
          entry.news = news;
          entry.sig = sig; entry.w = null; entry.tail = null;
          const icon = iconOf(bubble?.icon), said = bubble?.text || '', words = [name, said].filter(Boolean).join(': '), dot = document.createElement('b'), rows = [];
          dot.className = 'dot';
          if (name) { const row = document.createElement('span'); row.className = 'name'; row.textContent = name; rows.push(row); }
          if (icon || said) { const row = document.createElement('span'), text = document.createElement('span'); row.className = 'said'; text.className = 'text'; text.textContent = said; row.append(...(icon ? [icon] : []), text); rows.push(row); }
          const body = document.createElement('span'); body.className = 'body'; body.append(...rows);
          entry.node.replaceChildren(body, dot, entry.bubble);
          entry.node.title = words; entry.node.setAttribute('aria-label', words || 'Open session');
          entry.node.classList.toggle('high', !!bubble?.highlight); entry.node.classList.toggle('unread', !!unread); entry.node.classList.toggle('bare', !icon); entry.node.classList.toggle('terse', !!bubble?.terse);
        }
        entry.node.classList.toggle('dim', !!dim && !bubble?.highlight);
        entry.node.classList.toggle('working', mood === 'working'); entry.node.classList.toggle('asleep', mood === 'asleep');
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
        // Only a mouse: a finger has no hover to end, and its tap selects the project anyway.
        entry.node.onpointerenter = event => { if (event.pointerType === 'mouse') onHoodHover(key); };
        entry.node.onpointerleave = () => onHoodHover(null);
        entry.node.onfocus = () => onHoodHover(key);
        entry.node.onblur = () => onHoodHover(null);
        if (entry.sig !== name) { entry.sig = name; entry.w = null; entry.node.innerHTML = pixels(FOLDER); entry.node.append(name); entry.node.title = `Project: ${name}`; entry.node.setAttribute('aria-label', `Project ${name}`); }
        entry.node.classList.toggle('selected', !!selected);
        anchor(entry, ax, ay); settle(entry);
      }
      sweep('s:', keep);
    },
    // tags: [{ key, text, title, high, ax, ay, plant }]. A plant's stands over its chimneys, so it answers for the plant.
    tags(list) {
      const keep = new Set();
      for (const { key, text, title, high, meter, ax, ay, plant } of list) {
        const id = `t:${key}`; keep.add(id);
        const entry = shown.get(id) || add(id, 'div', 'city-tag');
        if (plant) {
          entry.node.onpointerenter = event => { if (event.pointerType === 'mouse') onPlantHover(plant); };
          entry.node.onpointerleave = () => onPlantHover(null);
          entry.node.onclick = event => { if (event.pointerType !== 'mouse') onPlantTap(plant); };
        }
        if (entry.sig !== text) { entry.sig = text; entry.w = null; entry.node.textContent = text; }
        entry.node.title = title; entry.node.classList.toggle('high', !!high); entry.node.classList.toggle('gauge', meter !== undefined);
        if (meter !== undefined) entry.node.style.setProperty('--used', `${Math.min(100, Math.max(0, meter))}%`);
        anchor(entry, ax, ay); settle(entry);
      }
      sweep('t:', keep);
    },
    // Bubbles first, then the names around them: neither the controls nor anything that talks may hide a project's name or a plant's, nor one name another.
    move(next, boxW, boxH) {
      project = next; width = boxW; height = boxH;
      const taken = inTheWay(), names = [];
      for (const entry of shown.values()) {
        if (!entry.bubble) { names.push(entry); continue; }
        place(entry);
        if (!entry.off) taken.push({ x: entry.fx, y: entry.fy, w: entry.w, h: entry.h + TAIL });
      }
      for (const entry of names) { place(entry, taken); if (!entry.off) taken.push({ x: entry.fx, y: entry.fy, w: entry.w, h: entry.h }); }
    },
    dispose() { layer.remove(); shown.clear(); },
  };
}

export function createControls(box, { onFit, onNext, onList, onNew }) {
  const bar = document.createElement('div'); bar.className = 'city-controls'; box.append(bar);
  const button = (className, text, title, onclick) => { const b = document.createElement('button'); b.type = 'button'; b.className = className; b.textContent = text; b.title = title; b.setAttribute('aria-label', title); b.onclick = onclick; bar.append(b); return b; };
  const lost = document.createElement('div'); lost.className = 'city-lost'; lost.textContent = 'Connection lost'; lost.hidden = true; bar.append(lost);
  const waiting = button('city-waiting', '', 'Next waiting (N)', () => onNext()); waiting.hidden = true;
  waiting.innerHTML = `${pixels('M7 1h2v2h1v2h1v2h1v2h1v2h1v3H1v-3h1V9h1V7h1V5h1V3h2zM7 5v5h2V5zM7 11v2h2v-2z')}<span></span>`;
  button('', '', 'Fit city (F)', () => onFit()).innerHTML = pixels('M1 1h5v2H3v3H1zM10 1h5v5h-2V3h-3zM1 10h2v3h3v2H1zM13 10h2v5h-5v-2h3z');
  button('', '', 'New project', event => onNew(event.currentTarget)).innerHTML = pixels('M7 2h2v5h5v2H9v5H7V9H2V7h5z');
  button('', '', 'Show the list', () => onList()).innerHTML = pixels('M2 3h12v2H2zM2 7h12v2H2zM2 11h12v2H2z');
  return {
    rects() { return [{ x: bar.offsetLeft, y: bar.offsetTop, w: bar.offsetWidth, h: bar.offsetHeight }]; },
    setWaiting(n) { waiting.hidden = !n; waiting.lastChild.textContent = n; },
    setLost(on) { lost.hidden = !on; },
    dispose() { bar.remove(); },
  };
}
