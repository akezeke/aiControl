// The boss desk's computer: a 90s desktop with a PICO-8 cart player (Lexaloffle's own BBS widget in a frame). Laid out once at
// LAYOUT and transformed onto the monitor's rectangle on screen; drawDesktop draws the same desktop, from the same numbers, on
// the monitor's canvas, so stepping in and out doesn't jump.
import { PICO_PALETTE } from './pc-icons.js';
import { BROWSE_URL, STARTERS, bbsUrl, cartPid, recentCarts, rememberCart, widgetUrl } from './carts.js';
import { clockOf } from './pc-windows.js';

export const LAYOUT = { w: 1080, h: 640 }; // the monitor canvas's 432 × 256, 2.5 times over
export const TASKBAR = 44, TITLE = 26, BAR = 28, BEVEL = 2;
export const ICON = { x: 24, y: 24, w: 104, h: 104 }, CONSOLE = { w: 64, h: 48 };
// The window holds the widget under its title and the ← back bar. The widget is 95% of its width tall plus a line, so a wider
// frame scrolls; at 526 × 522 its game is at its largest (496 px) and it fits, scrolling off in case a font runs taller.
export const WINDOW = { x: 220, y: 8, w: 640, h: 580 };
export const FRAME = { w: 526, h: 522 };
export { PICO_PALETTE };
const FACE = '#c3c3c3', LIGHT = '#ffffff', SHADE = '#5a5a5a', DESK = '#4a5a78', INK = '#1d2b53', RED = '#ff004d', CREAM = '#fff1e8';
const FONT = 'Silkscreen, monospace';
const SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox';

// The CSS matrix() taking the layout's top-left, top-right and bottom-left corners onto the screen's (transform-origin 0 0).
export function fitTransform([tl, tr, , bl], w, h) {
  return { a: (tr.x - tl.x) / w, b: (tr.y - tl.y) / w, c: (bl.x - tl.x) / h, d: (bl.y - tl.y) / h, e: tl.x, f: tl.y };
}
export { clockOf } from './pc-windows.js';

export function createDesktop(container, { onShutDown, storage, online = () => navigator.onLine, now = () => new Date() }) {
  const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const button = (className, text, onClick) => { const node = make('button', className, text); node.type = 'button'; node.addEventListener('click', onClick); return node; };
  const link = (text, href) => { const node = make('a', 'office-desktop-link', text); node.setAttribute('href', href); node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); return node; };
  const state = { window: null, cart: null, start: false };
  let frame = null, refused = false, offline = false, clock = '';

  const root = make('div', 'office-desktop'); root.hidden = true;
  // A mouse double-clicks it open, as on any desktop; a finger or a pen taps once (a double tap often sends no dblclick).
  let tapped = false;
  const icon = button('office-desktop-icon', null, () => { if (tapped) openPico(); }), label = make('span', 'office-desktop-label', 'PICO-8');
  icon.append(make('span', 'office-desktop-console'), label);
  icon.addEventListener('pointerdown', event => { tapped = event.pointerType !== 'mouse'; });
  icon.addEventListener('dblclick', () => openPico());
  icon.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); openPico(); } });
  const pico = make('div', 'office-desktop-window'), body = make('div', 'office-desktop-body'), title = make('div', 'office-desktop-title');
  title.append(make('span', null, 'PICO-8'), button('office-desktop-close', '✕', () => closePico()));
  pico.append(title, body);
  const start = button('office-desktop-start office-desktop-bevel', 'Start', () => (state.start ? closeStart() : openStart()));
  const time = make('span', 'office-desktop-clock'), taskbar = make('div', 'office-desktop-taskbar'), menu = make('div', 'office-desktop-menu office-desktop-bevel');
  taskbar.append(start, time);
  menu.append(button('office-desktop-item', 'Shut down', () => { closeStart(); onShutDown(); }));
  root.append(icon, pico, menu, taskbar);
  // Keys stay in here, so its buttons and the paste box work and don't walk you about; Esc stands you up unless it closes Start.
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape') event.stopPropagation();
    else if (state.start) { closeStart(); event.stopPropagation(); }
  });
  container.append(root);

  function list() {
    const bar = make('div', 'office-desktop-bar'), input = make('input', 'office-desktop-paste');
    input.type = 'text'; input.setAttribute('placeholder', 'Cart link'); input.setAttribute('aria-label', 'Cart link'); input.setAttribute('spellcheck', 'false');
    input.addEventListener('keydown', event => { if (event.key === 'Enter') paste(input.value); });
    bar.append(input, button('office-desktop-bevel', 'Open', () => paste(input.value)));
    const rows = make('ul', 'office-desktop-list'), row = (text, sub, pid) => {
      const item = make('li'), play = button('office-desktop-cart', text, () => openCart(pid));
      if (sub) play.append(make('small', null, sub));
      item.append(play, link('BBS ↗', bbsUrl(pid))); rows.append(item);
    };
    for (const cart of STARTERS) row(cart.title, cart.author, cart.pid);
    for (const pid of recentCarts(storage)) row(`Cart #${pid}`, null, pid);
    const browse = make('li'); browse.append(link('Browse BBS ↗', BROWSE_URL)); rows.append(browse);
    return [bar, ...(refused ? [make('p', 'office-desktop-note', "Paste the cart's Embed link")] : []), rows];
  }
  function cartView() {
    const bar = make('div', 'office-desktop-bar'), stage = make('div', 'office-desktop-stage');
    bar.append(button('office-desktop-bevel', '← Back', () => back()));
    if (offline) stage.append(make('p', null, 'Offline: carts load from lexaloffle.com'));
    // Shows till the widget paints over it. A failed load paints the browser's own error page over it instead.
    else stage.append(make('p', null, 'Loading…'), frame);
    return [bar, stage];
  }
  function render() {
    pico.hidden = state.window !== 'pico'; menu.hidden = !state.start;
    if (!pico.hidden) body.replaceChildren(...(frame || offline ? cartView() : list()));
    else body.replaceChildren();
  }
  // Taking the frame out of the page stops the cart and its sound.
  const drop = () => { frame?.remove(); frame = null; state.cart = null; offline = false; };

  // Only the menu: building the window again would move a playing cart's frame, and a moved frame loads again.
  function openStart() { state.start = true; menu.hidden = false; }
  function closeStart() { state.start = false; menu.hidden = true; }
  function openPico() { state.window = 'pico'; state.start = false; refused = false; render(); }
  function closePico() { drop(); state.window = null; render(); icon.focus({ preventScroll: true }); }
  function back() { drop(); refused = false; render(); }
  function openCart(pid) {
    drop(); state.window = 'pico'; state.start = false; refused = false;
    if (!online()) offline = true;
    else {
      frame = make('iframe');
      for (const [name, value] of Object.entries({ src: widgetUrl(pid), title: `Cart #${pid}`, width: String(FRAME.w), height: String(FRAME.h), scrolling: 'no', referrerpolicy: 'no-referrer', allow: 'fullscreen; gamepad; autoplay', sandbox: SANDBOX })) frame.setAttribute(name, value);
      const loaded = frame; frame.addEventListener('load', () => loaded.focus());
      state.cart = pid;
    }
    render();
  }
  function paste(text) {
    const pid = cartPid(text);
    if (!pid) { refused = true; render(); return; }
    rememberCart(storage, pid); openCart(pid);
  }

  render();
  return {
    root, openStart, openPico, openCart, paste,
    state: () => ({ ...state }),
    // Each frame while it's shown: onto the monitor's four corners on screen (top-left, top-right, bottom-right, bottom-left).
    place(corners) {
      const { a, b, c, d, e, f } = fitTransform(corners, LAYOUT.w, LAYOUT.h);
      root.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
      const minute = clockOf(now()); if (minute !== clock) time.textContent = clock = minute;
      if (root.hidden) { root.hidden = false; icon.focus({ preventScroll: true }); }
    },
    hide() { drop(); state.window = null; state.start = false; refused = false; render(); root.hidden = true; },
    dispose() { drop(); root.remove(); },
  };
}

// The monitor's picture of the same desktop, onto a context already scaled to LAYOUT. `game`: 128 × 128 palette indexes, played
// in the PICO-8 window (a friend's made-up cart).
export function drawDesktop(g, state, { clock, game = null }) {
  const bevel = (x, y, w, h, sunk = false) => {
    g.fillStyle = FACE; g.fillRect(x, y, w, h);
    g.fillStyle = sunk ? SHADE : LIGHT; g.fillRect(x, y, w, BEVEL); g.fillRect(x, y, BEVEL, h);
    g.fillStyle = sunk ? LIGHT : SHADE; g.fillRect(x, y + h - BEVEL, w, BEVEL); g.fillRect(x + w - BEVEL, y, BEVEL, h);
  };
  const text = (value, x, y, size, color, align = 'left') => { g.fillStyle = color; g.font = `${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(value, x, y); };
  g.fillStyle = DESK; g.fillRect(0, 0, LAYOUT.w, LAYOUT.h);

  // The icon: our own little console, as the CSS draws it.
  const cx = ICON.x + (ICON.w - CONSOLE.w) / 2, cy = ICON.y + 8;
  g.fillStyle = '#000'; g.fillRect(cx, cy, CONSOLE.w, CONSOLE.h);
  g.fillStyle = PICO_PALETTE[6]; g.fillRect(cx + 2, cy + 2, CONSOLE.w - 4, CONSOLE.h - 4);
  g.fillStyle = '#000'; g.fillRect(cx + 6, cy + 6, 36, 28); g.fillStyle = INK; g.fillRect(cx + 8, cy + 8, 32, 24);
  g.fillStyle = RED; g.fillRect(cx + 48, cy + 10, 8, 8); g.fillStyle = PICO_PALETTE[12]; g.fillRect(cx + 48, cy + 22, 8, 8);
  text('PICO-8', ICON.x + ICON.w / 2, cy + CONSOLE.h + 20, 16, LIGHT, 'center');

  // The taskbar, its Start button and clock, and the Start menu.
  const bar = LAYOUT.h - TASKBAR;
  g.fillStyle = FACE; g.fillRect(0, bar, LAYOUT.w, TASKBAR); g.fillStyle = LIGHT; g.fillRect(0, bar, LAYOUT.w, BEVEL);
  bevel(6, bar + 6, 88, 32, state.start); text('Start', 50, bar + 22, 16, '#000', 'center');
  bevel(LAYOUT.w - 94, bar + 6, 88, 32, true); text(clock, LAYOUT.w - 50, bar + 22, 16, '#000', 'center');
  if (state.start) { bevel(6, bar - 44, 200, 44); text('Shut down', 18, bar - 22, 16, '#000'); }

  if (state.window !== 'pico') return;
  const { x, y, w, h } = WINDOW, ix = x + BEVEL, iw = w - 2 * BEVEL, top = y + BEVEL + TITLE, ih = h - 2 * BEVEL - TITLE;
  bevel(x, y, w, h);
  g.fillStyle = INK; g.fillRect(ix, y + BEVEL, iw, TITLE); text('PICO-8', ix + 8, y + BEVEL + TITLE / 2, 16, CREAM);
  g.fillStyle = RED; g.fillRect(ix + iw - 23, y + BEVEL + 3, 20, 20); text('✕', ix + iw - 13, y + BEVEL + TITLE / 2, 14, CREAM, 'center');
  if (game) {
    // Nearest neighbour, a run of one colour at a time.
    const scale = Math.floor(Math.min(iw, ih) / 128), ox = ix + (iw - 128 * scale) / 2, oy = top + (ih - 128 * scale) / 2;
    g.fillStyle = '#000'; g.fillRect(ix, top, iw, ih);
    for (let row = 0; row < 128; row++) for (let col = 0; col < 128;) {
      const colour = game[row * 128 + col]; let end = col + 1; while (end < 128 && game[row * 128 + end] === colour) end++;
      g.fillStyle = PICO_PALETTE[colour]; g.fillRect(ox + col * scale, oy + row * scale, (end - col) * scale, scale); col = end;
    }
    return;
  }
  bevel(ix, top, iw, BAR);
  if (state.cart) { g.fillStyle = '#000'; g.fillRect(ix, top + BAR, iw, ih - BAR); return; }
  g.fillStyle = CREAM; g.fillRect(ix, top + BAR, iw, ih - BAR);
  STARTERS.forEach((cart, i) => text(cart.title, ix + 12, top + BAR + 22 + i * 32, 16, INK));
}

// A made-up cart, for a friend at the boss desk: the same picture for the same seed and moment. Even seeds are a runner,
// odd ones a shooter. Palette indexes, 128 × 128.
const hash = n => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };
const DIGITS = [0x7b6f, 0x2c97, 0x73e7, 0x73cf, 0x5bc9, 0x79cf, 0x79ef, 0x7249, 0x7bef, 0x7bcf]; // 3 × 5, top row first
export function fakeCart(seed, t) {
  const px = new Uint8Array(128 * 128), set = (x, y, c) => { x = Math.floor(x); y = Math.floor(y); if (x >= 0 && y >= 0 && x < 128 && y < 128) px[y * 128 + x] = c; };
  const box = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c); };
  const score = (value, x, y, c) => [...String(value)].forEach((d, k) => { for (let b = 0; b < 15; b++) if (DIGITS[d] >> (14 - b) & 1) set(x + k * 4 + b % 3, y + Math.floor(b / 3), c); });
  const s = hash(seed) & 0xffff;
  if (seed % 2 === 0) {
    // The runner: blocks scroll by under a jumper, over gaps the seed picks.
    px.fill(12); box(0, 0, 128, 20, 1);
    const scroll = t * 48, first = Math.floor(scroll / 8);
    for (let k = 0; k < 18; k++) {
      const block = first + k; if (block % 7 !== 0 && hash(block + s) % 9 === 0) continue;
      const x = block * 8 - scroll, high = hash(block * 3 + s) % 5 === 0 ? 8 : 0;
      box(x, 104 - high, 8, 24 + high, 4); box(x, 104 - high, 8, 2, 11); box(x + 7, 106 - high, 1, 22 + high, 5);
    }
    const jump = Math.abs(Math.sin(t * 3.2)) * 26, y = 96 - jump;
    box(28, y, 8, 8, 8); box(30, y + 2, 2, 2, 7); box(33, y + 2, 2, 2, 7); box(29, y + 8, 2, 2, 1); box(33, y + 8, 2, 2, 1);
    score(Math.floor(t * 10) % 100000, 4, 4, 7);
  } else {
    // The shooter: stars stream down past a ship that weaves and fires at a wave on sine paths.
    for (let i = 0; i < 48; i++) { const speed = 10 + hash(i + s) % 30; set(hash(i * 7 + s) % 128, (hash(i * 13 + s) % 128 + t * speed) % 128, i % 5 ? 5 : 6); }
    const ship = 64 + Math.sin(t * 1.1 + s) * 40;
    box(ship - 1, 108, 3, 3, 7); box(ship - 4, 111, 9, 4, 12); box(ship - 4, 115, 2, 2, 8); box(ship + 3, 115, 2, 2, 8);
    for (let k = 0; k < 6; k++) { const age = (t * 4 + k / 6) % 1; box(ship, 106 - age * 110, 1, 3, 10); }
    for (let i = 0; i < 6; i++) {
      const ex = 64 + Math.sin(t * 1.3 + i * 1.7 + s) * 48, ey = 18 + i * 11 + Math.sin(t * 2 + i) * 6, c = i % 2 ? 14 : 8;
      box(ex - 3, ey, 7, 3, c); box(ex - 3, ey + 3, 2, 2, c); box(ex + 2, ey + 3, 2, 2, c); set(ex - 1, ey + 1, 7); set(ex + 1, ey + 1, 7);
    }
    score(Math.floor(t * 25) % 100000, 4, 4, 7);
  }
  return px;
}
