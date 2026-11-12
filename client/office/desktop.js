// The boss desk's computer, "Boss 98": a 90s desktop laid out once at LAYOUT and transformed onto the monitor's rectangle on
// screen. Icons come from the server desktop (pc-store.js); three windows (PICO-8, Info Highway, Notepad) sit over them, with a
// taskbar and Start. drawDesktop draws the monitor's picture from the same numbers, so stepping in and out doesn't jump.
// While seated only these run on their own: the clock's one timeout to the next minute, an install's one-second timer, and a cart
// while its frame can be seen. hide() (standing up) stops all of it: the cart, a drag, menus and dialogs, both timers.
// The pausing rule: every render pauses the player unless seated and some of its frame is uncovered (W.gameHidden), so a
// minimised, covered or closed game never runs.
import { PICO_PALETTE, ICONS, iconCanvas } from './pc-icons.js';
import { STARTERS, thumbName } from './carts.js';
import * as W from './pc-windows.js';
import { createPcStore } from './pc-store.js';
import { createPlayer } from './pc-player.js';
import { createBrowser } from './pc-browser.js';
import { createNotepad } from './pc-notepad.js';

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

// The CSS matrix() taking the layout's top-left, top-right and bottom-left corners onto the screen's (transform-origin 0 0).
export function fitTransform([tl, tr, , bl], w, h) {
  return { a: (tr.x - tl.x) / w, b: (tr.y - tl.y) / w, c: (bl.x - tl.x) / h, d: (bl.y - tl.y) / h, e: tl.x, f: tl.y };
}
export { clockOf } from './pc-windows.js';

const GLYPHS = { pico8: ICONS.console, browser: ICONS.globe, notepad: ICONS.notepad };
const TASKS = ['browser', 'notepad', 'pico8']; // the taskbar's fixed order
const BUILTINS = [{ id: 'browser', kind: 'browser', name: 'Info Highway' }, { id: 'salaries', kind: 'salaries', name: 'salaries.txt' }];
const ROOM = W.GRID.cols * W.GRID.rows - BUILTINS.length; // icons the grid holds besides the built-ins
const TAP = 400, SLOP = 4; // ms between two taps that maximise; px a pointer moves before an icon drags
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const shownIn = (s, n) => s.windows[n].open && s.windows[n].mode !== 'min';

export function createDesktop(container, {
  onShutDown, api, storage, online = () => navigator.onLine, now = () => new Date(),
  reduced = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  open: openTab = url => { globalThis.open?.(url, '_blank', 'noopener,noreferrer'); },
} = {}) {
  const make = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };
  const button = (className, text, onClick) => { const n = make('button', className, text); n.type = 'button'; if (onClick) n.addEventListener('click', onClick); return n; };
  const focus = n => n?.focus({ preventScroll: true }); // the layer is transformed; a scroll into view would shift it
  const capture = (n, id) => { try { n.setPointerCapture?.(id); } catch { /* the pointer is gone */ } };
  const release = (n, id) => { try { n.releasePointerCapture?.(id); } catch { /* already released */ } };
  // '&' marks the letter a key picks; it is underlined.
  const mnemonic = (n, label) => {
    const at = label.indexOf('&');
    if (at < 0 || at === label.length - 1) { n.append(label); return; }
    const before = label.slice(0, at), after = label.slice(at + 2);
    if (before) n.append(before);
    n.append(make('u', null, label[at + 1]));
    if (after) n.append(after);
  };

  let ws = W.defaults(), seated = false, restored = false, sessions = [], version = 0, start = false, selected = 'browser';
  let drag = null, menu = null, dialog = null, lastTap = null, titleKind = 'mouse', iconKind = 'mouse', padSeen = false;
  let clockTimer = null, lastError = 'Desktop unavailable.', matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, transform = '';
  const dialogs = [], jobs = new Set(), zooms = new Set(), iconNodes = new Map();
  const bump = () => { version++; };

  const store = createPcStore({
    api, storage,
    onChange: () => { renderIcons(); browser.refreshInstalled(); bump(); },
    onError: m => { lastError = m; },
  });
  // Every op goes through here: a failure says why in a dialog, unless the caller handles it.
  const send = (op, onFail) => store.apply(op).then(v => { if (v === null) (onFail ?? showError)(lastError); return v; });
  const showError = text => ui.dialog({ icon: 'error', text, buttons: ['OK'] });
  const save = () => { restored = true; send({ op: 'windows', windows: ws.windows, order: ws.order }); };
  const installed = pid => store.desktop().icons.some(i => i.kind === 'cart' && i.pid === pid);

  const ui = { dialog: spec => openDialog(spec).promise, menu: (items, at, opts) => openMenu(items, at, opts) };
  const player = createPlayer({ online });
  player.onPlay(cart => play(cart));
  const notepad = createNotepad({ ui });
  notepad.onClose(() => closeWindow('notepad'));
  // The browser's fetches re-render once it has shown the reply, so its title and task follow the page.
  const browserApi = (path, body) => {
    const p = new Promise(resolve => resolve(api(path, body))), later = () => queueMicrotask(render);
    p.then(later, later);
    return p;
  };
  const browser = createBrowser({ api: browserApi, ui, installed, onPlay: cart => play(cart), onInstall: cart => install(cart), open: url => openTab(url) });
  browser.onClose(() => closeWindow('browser'));
  const MODS = { pico8: player, browser, notepad };

  const root = make('div', 'office-desktop'); root.hidden = true;
  const iconLayer = make('div', 'pc-icons');
  const boxOf = () => container.getBoundingClientRect?.() ?? { left: 0, top: 0 };
  // A pointer on screen, back into layout px through the inverse of the screen transform.
  const toLayout = (e, box) => {
    const { a, b, c, d, e: tx, f: ty } = matrix, det = a * d - b * c || 1;
    const x = (e.clientX ?? 0) - box.left - tx, y = (e.clientY ?? 0) - box.top - ty;
    return { x: (d * x - c * y) / det, y: (-b * x + a * y) / det };
  };

  // Windows: made once and never moved in the page (a moved frame reloads its cart); fronting changes only z-index.
  const wins = {};
  for (const name of W.NAMES) wins[name] = buildWindow(name);
  function buildWindow(name) {
    const mod = MODS[name], node = make('div', 'pc-window'), title = make('div', 'pc-title'), text = make('div', 'pc-title-text'), label = make('span');
    text.append(iconCanvas(GLYPHS[name], 1), label);
    const min = button('pc-button', '_', () => change(W.minimize(ws, name)));
    const max = button('pc-button', '□', () => change(W.toggleMax(ws, name)));
    const shut = button('pc-button', '×', () => closeWindow(name));
    min.setAttribute('aria-label', 'Minimize'); shut.setAttribute('aria-label', 'Close');
    if (W.FIXED.has(name)) { max.disabled = true; max.setAttribute('disabled', ''); }
    const buttons = make('div', 'pc-title-buttons'); buttons.append(min, max, shut);
    title.append(text, buttons);
    node.append(title);
    if (mod.menus) node.append(menubar(name, mod));
    node.append(mod.node);
    node.addEventListener('pointerdown', () => { if (W.frontmost(ws) !== name) change(W.front(ws, name)); });

    title.addEventListener('pointerdown', e => {
      if (e.button !== 0 || buttons.contains(e.target)) return;
      titleKind = e.pointerType;
      const fronted = W.frontmost(ws) !== name;
      if (fronted) change(W.front(ws, name), false);
      const box = boxOf(), w = ws.windows[name];
      drag = { type: 'window', name, node: title, pointer: e.pointerId, box, from: toLayout(e, box), at: { x: w.x, y: w.y }, start: ws, moved: false, fronted, movable: w.mode !== 'max', kind: e.pointerType };
      capture(title, e.pointerId);
    });
    const mine = e => drag?.node === title && drag.pointer === e.pointerId;
    title.addEventListener('pointermove', e => {
      if (!mine(e) || !drag.movable) return;
      const p = toLayout(e, drag.box);
      change(W.moveTo(ws, name, { x: drag.at.x + p.x - drag.from.x, y: drag.at.y + p.y - drag.from.y }), false);
      drag.moved = true;
    });
    title.addEventListener('pointerup', e => {
      if (!mine(e)) return;
      const d = drag; drag = null; release(title, d.pointer);
      if (d.moved || d.fronted) save();
      // A finger or a pen maximises with two taps; a double tap often sends no dblclick.
      if (d.moved || d.kind === 'mouse') return;
      const at = +now();
      if (lastTap?.name === name && at - lastTap.at < TAP) { lastTap = null; change(W.toggleMax(ws, name)); } else lastTap = { name, at };
    });
    title.addEventListener('pointercancel', e => { if (mine(e)) cancelDrag(); });
    title.addEventListener('dblclick', e => { if (titleKind === 'mouse' && !buttons.contains(e.target)) change(W.toggleMax(ws, name)); });
    return { node, label, max };
  }
  function menubar(name, mod) {
    const bar = make('div', 'pc-menubar'), items = [];
    const openAt = i => {
      const item = items[i], r = W.rectOf(ws, name), n = items.length;
      openMenu(mod.menus()[i].items, { x: r.x + (item.offsetLeft || 0), y: r.y + (item.offsetTop || 0) + (item.offsetHeight || 0) },
        { onLeft: () => openAt((i + n - 1) % n), onRight: () => openAt((i + 1) % n) }, item);
    };
    mod.menus().forEach((m, i) => {
      const item = button('pc-menu-item', null, () => (menu?.owner === item ? closeMenu() : openAt(i)));
      item.setAttribute('aria-haspopup', 'menu'); mnemonic(item, m.label);
      items.push(item); bar.append(item);
    });
    return bar;
  }

  // Taskbar: Start, a button per open window, the key legend and the clock.
  const startButton = button('pc-button pc-start', 'Start', () => (start ? closeStart() : openStart()));
  startButton.setAttribute('aria-haspopup', 'menu');
  const tasks = {};
  for (const name of TASKS) {
    const label = make('span'), node = button('pc-button pc-task', null, () => taskClick(name));
    node.append(iconCanvas(GLYPHS[name], 1), label);
    tasks[name] = { node, label };
  }
  const legend = make('span', 'pc-legend'), clock = make('div', 'pc-clock');
  const taskbar = make('div', 'pc-taskbar');
  taskbar.append(startButton, ...TASKS.map(n => tasks[n].node), legend, clock);

  // Start: Programs and Documents open beside it; Shut down… stands you up.
  const startMenu = make('div', 'pc-start-menu'), startList = make('div', 'pc-menu'), startItems = [], opens = new Map();
  startMenu.hidden = true; startList.setAttribute('role', 'menu');
  const startItem = (label, run, sub) => {
    const item = button('pc-menu-item', null, () => run(item)); item.setAttribute('role', 'menuitem'); mnemonic(item, label);
    if (sub) { item.setAttribute('aria-haspopup', 'menu'); opens.set(item, () => run(item)); }
    startItems.push(item); return item;
  };
  const submenu = items => item => {
    if (menu?.owner === item) { closeMenu(); return; }
    openMenu(items, { x: (startMenu.offsetLeft || 0) + (startMenu.offsetWidth || 0) - 3, y: (startMenu.offsetTop || 0) + (item.offsetTop || 0) }, { onLeft: () => closeMenu(true) }, item);
  };
  startList.append(
    startItem('&Programs ▸', submenu([{ label: '&Info Highway', run: () => openWindow('browser') }, { label: '&Notepad', run: () => openWindow('notepad') }]), true),
    startItem('&Documents ▸', submenu([{ label: '&salaries.txt', run: () => openWindow('notepad') }]), true),
    make('div', 'pc-menu-sep'),
    startItem('Sh&ut down…', () => { closeStart(); onShutDown?.(); }),
  );
  startList.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') walk(startItems, e);
    else if (e.key === 'ArrowRight' && opens.has(document.activeElement)) { e.preventDefault(); opens.get(document.activeElement)(); }
  });
  startMenu.append(make('div', 'pc-banner', 'Boss 98'), startList);

  root.append(iconLayer, ...W.NAMES.map(n => wins[n].node), startMenu, taskbar);
  // A press outside an open menu or Start closes it; on the bare desktop it also clears the selection.
  root.addEventListener('pointerdown', e => {
    const t = e.target;
    if (menu && !menu.node.contains(t) && !menu.owner?.contains(t)) closeMenu();
    if (start && !startMenu.contains(t) && !startButton.contains(t) && !menu?.node.contains(t)) closeStart();
    if (t === iconLayer) select(null);
  }, true);
  // Keys stay in here, so the desktop's own controls work and don't walk you about. Esc closes the top menu, dialog or Start;
  // with none open it goes on and stands you up.
  root.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (menu) closeMenu(true);
      else if (dialog) { if (dialog.buttons.length) finish(dialog, null); }
      else if (start) { closeStart(); focus(startButton); }
      else return;
      e.stopPropagation(); return;
    }
    e.stopPropagation();
    if (e.key === 'Enter' && dialog) {
      e.preventDefault();
      const at = dialog.buttons.indexOf(document.activeElement), pick = at >= 0 ? at : dialog.initial;
      if (dialog.buttons[pick]) finish(dialog, dialog.labels[pick]);
    }
  });
  // The browser changes its page on its own clicks; the titles follow.
  root.addEventListener('click', () => render());
  container.append(root);

  function render() {
    const top = W.frontmost(ws);
    for (const name of W.NAMES) {
      const w = ws.windows[name], win = wins[name], r = W.rectOf(ws, name), title = MODS[name].title();
      win.node.hidden = !shownIn(ws, name);
      Object.assign(win.node.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, zIndex: String(10 + ws.order.indexOf(name)) });
      win.node.classList.toggle('front', name === top);
      win.label.textContent = title;
      win.max.textContent = w.mode === 'max' ? '❐' : '□';
      win.max.setAttribute('aria-label', w.mode === 'max' ? 'Restore' : 'Maximize');
      const task = tasks[name];
      task.node.hidden = !w.open; task.node.classList.toggle('pressed', name === top); task.label.textContent = title;
      task.node.setAttribute('data-tip', title);
    }
    startButton.classList.toggle('pressed', start); startMenu.hidden = !start;
    player.pause(!seated || W.gameHidden(ws));
    // salaries.txt is rebuilt when it comes into view, and on agents() only while it's in view.
    const pad = seated && visible('notepad');
    if (pad && !padSeen) notepad.update(sessions, now(), true);
    padSeen = pad;
    bump();
  }
  const visible = n => {
    if (!shownIn(ws, n)) return false;
    const above = ws.order.slice(ws.order.indexOf(n) + 1).filter(m => shownIn(ws, m)).map(m => W.rectOf(ws, m));
    return W.uncovered(W.rectOf(ws, n), above).length > 0;
  };
  const same = (a, b) => JSON.stringify([a.windows, a.order]) === JSON.stringify([b.windows, b.order]);
  // The one way windows change: renders, zooms what was minimised or restored, and saves unless a drag is still going.
  function change(next, keep = true) {
    if (next === ws || same(next, ws)) return;
    const was = ws; ws = next;
    if (!reduced()) for (const n of W.NAMES) if (was.windows[n].open && ws.windows[n].open && shownIn(was, n) !== shownIn(ws, n)) zoom(n, was);
    render();
    if (keep) save();
  }
  // Three dotted outlines between the window and its task button, one after another (pc.css times them).
  function zoom(name, was) {
    const toTask = shownIn(was, name), b = tasks[name].node, win = W.rectOf(toTask ? was : ws, name);
    const task = { x: b.offsetLeft || 0, y: W.WORK.h + (b.offsetTop || 0), w: b.offsetWidth || 0, h: b.offsetHeight || 0 };
    const [from, to] = toTask ? [win, task] : [task, win], mix = (k, f) => Math.round(from[k] + (to[k] - from[k]) * f);
    [0.25, 0.5, 0.75].forEach((f, i) => {
      const z = make('div', 'pc-zoom');
      Object.assign(z.style, { left: `${mix('x', f)}px`, top: `${mix('y', f)}px`, width: `${mix('w', f)}px`, height: `${mix('h', f)}px`, animationDelay: `${i * 50}ms` });
      z.addEventListener('animationend', () => { z.remove(); zooms.delete(z); }, { once: true });
      zooms.add(z); root.append(z);
    });
  }
  function taskClick(name) {
    const w = ws.windows[name];
    change(w.mode === 'min' ? W.restore(ws, name) : W.frontmost(ws) === name ? W.minimize(ws, name) : W.front(ws, name));
  }
  function openWindow(name, { home = true } = {}) {
    closeStart();
    if (name === 'notepad' && !ws.windows.notepad.open) notepad.open(sessions, now());
    change(W.open(ws, name));
    if (name === 'browser' && home && !browser.page()) { browser.home(); render(); }
  }
  function closeWindow(name) {
    if (name === 'pico8') player.stop(); else if (name === 'browser') browser.close();
    change(W.close(ws, name));
  }
  // Opens PICO-8 in front with the cart; the same cart already running isn't loaded again.
  function play(cart) {
    closeMenu(); closeStart();
    if (!(player.playing() && player.cart()?.pid === cart.pid)) player.play(cart);
    change(W.loadCart(ws, cart));
  }
  function browse(page) { openWindow('browser', { home: false }); browser.go(page); render(); }

  // Icons: the built-ins, then the server's, each at its grid cell. A drag snaps to a free cell; a taken one puts it back.
  const iconList = () => { const d = store.desktop(); return [...BUILTINS, ...d.icons].map(i => ({ ...i, spot: d.spots[i.id] ?? null })); };
  const cellXY = ([col, row]) => ({ x: W.GRID.x + col * W.GRID.size, y: W.GRID.y + row * W.GRID.size });
  const centre = (W.GRID.size - 76) / 2; // .pc-icon is 76 px wide
  function position(node, spot) {
    node.hidden = !spot;
    if (!spot) return;
    const { x, y } = cellXY(spot); node.style.left = `${x + centre}px`; node.style.top = `${y}px`;
  }
  function renderIcons() {
    const list = iconList(), ids = new Set(list.map(i => i.id)), order = [];
    for (const [id, n] of iconNodes) if (!ids.has(id)) { n.node.remove(); iconNodes.delete(id); }
    for (const icon of list) {
      const sig = JSON.stringify([icon.kind, icon.name, icon.pid, icon.url, icon.author]);
      let n = iconNodes.get(icon.id);
      if (!n || n.sig !== sig) { n?.node.remove(); n = { node: buildIcon(icon), sig }; iconNodes.set(icon.id, n); }
      n.icon = icon;
      if (!(drag?.type === 'icon' && drag.id === icon.id)) position(n.node, icon.spot);
      n.node.classList.toggle('selected', selected === icon.id);
      order.push(n.node);
    }
    const kids = iconLayer.children;
    if (kids.length !== order.length || order.some((n, i) => kids[i] !== n)) iconLayer.append(...order);
  }
  function buildIcon(icon) {
    const id = icon.id, node = button('pc-icon'), art = make('div', 'pc-icon-art');
    const arrow = () => { const a = iconCanvas(ICONS.arrow, 1); a.classList.add('pc-icon-arrow'); return a; };
    if (icon.kind === 'cart') {
      const img = make('img'), shortcut = arrow();
      img.setAttribute('src', '/api/office/bbs/thumb/' + thumbName(icon.pid)); img.setAttribute('alt', '');
      img.addEventListener('load', bump, { once: true });
      img.addEventListener('error', () => { art.replaceChildren(iconCanvas(ICONS.cart, 1), shortcut); bump(); }, { once: true });
      art.append(img, shortcut);
    } else if (icon.kind === 'link') art.append(iconCanvas(ICONS.globe, 1), arrow());
    else art.append(iconCanvas(icon.kind === 'browser' ? ICONS.globe : ICONS.notepad, 1));
    const tip = icon.kind === 'cart' ? icon.author : icon.kind === 'link' ? icon.url : '';
    if (tip) node.setAttribute('data-tip', tip);
    node.append(art, make('span', 'pc-icon-label', icon.name));

    const mine = e => drag?.type === 'icon' && drag.node === node && drag.pointer === e.pointerId;
    node.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      iconKind = e.pointerType; select(id);
      const box = boxOf(), spot = iconNodes.get(id)?.icon.spot ?? [0, 0];
      drag = { type: 'icon', id, node, pointer: e.pointerId, box, from: toLayout(e, box), base: cellXY(spot), moved: false, kind: e.pointerType };
      capture(node, e.pointerId);
    });
    node.addEventListener('pointermove', e => {
      if (!mine(e)) return;
      const p = toLayout(e, drag.box), dx = p.x - drag.from.x, dy = p.y - drag.from.y;
      if (!drag.moved && Math.hypot(dx, dy) <= SLOP) return;
      drag.moved = true; node.style.left = `${drag.base.x + centre + dx}px`; node.style.top = `${drag.base.y + dy}px`;
    });
    node.addEventListener('pointerup', e => {
      if (!mine(e)) return;
      const d = drag; drag = null; release(node, d.pointer);
      if (d.moved) dropIcon(d, toLayout(e, d.box));
      else if (d.kind !== 'mouse') openIcon(id); // a finger or a pen opens with one tap
    });
    node.addEventListener('pointercancel', e => { if (mine(e)) cancelDrag(); });
    node.addEventListener('dblclick', () => { if (iconKind === 'mouse') openIcon(id); });
    return node;
  }
  function dropIcon(d, p) {
    const { size, cols, rows } = W.GRID, spots = store.desktop().spots, was = spots[d.id];
    const col = clamp(Math.round((d.base.x - W.GRID.x + p.x - d.from.x) / size), 0, cols - 1);
    const row = clamp(Math.round((d.base.y - W.GRID.y + p.y - d.from.y) / size), 0, rows - 1);
    const taken = Object.entries(spots).some(([other, s]) => other !== d.id && s[0] === col && s[1] === row);
    if (taken || (was?.[0] === col && was?.[1] === row)) position(d.node, was);
    else send({ op: 'move', id: d.id, spot: [col, row] });
  }
  function openIcon(id) {
    const icon = iconNodes.get(id)?.icon;
    if (!icon) return;
    if (icon.kind === 'browser') openWindow('browser');
    else if (icon.kind === 'salaries') openWindow('notepad');
    else if (icon.kind === 'cart') { if (icon.embed) play({ pid: icon.pid, title: icon.name }); else browse({ kind: 'game', pid: icon.pid }); }
    else if (icon.kind === 'link') browse({ kind: 'away', url: icon.url });
  }
  function select(id) {
    if (selected === id) return;
    selected = id;
    for (const [other, n] of iconNodes) n.node.classList.toggle('selected', other === id);
    bump();
  }
  // A window drag goes back where it started (it was never saved); an icon goes back to its cell.
  function cancelDrag() {
    const d = drag; if (!d) return;
    drag = null; release(d.node, d.pointer);
    if (d.type === 'window') { change(d.start, false); if (d.fronted) save(); } else position(d.node, store.desktop().spots[d.id]);
  }

  // Menus: one popup at a time, in layout px. Items are { label, run, disabled } or '-' for a line.
  function openMenu(items, at, { onLeft, onRight } = {}, owner = null) {
    closeMenu();
    const node = make('div', 'pc-menu pc-popup'), entries = [];
    node.setAttribute('role', 'menu');
    for (const item of items) {
      if (item === '-') { node.append(make('div', 'pc-menu-sep')); continue; }
      const b = button('pc-menu-item', null, () => {
        if (item.disabled) return;
        closeMenu(); closeStart(); item.run(); render();
      });
      b.setAttribute('role', 'menuitem'); mnemonic(b, item.label);
      if (item.disabled) b.setAttribute('aria-disabled', 'true');
      entries.push(b); node.append(b);
    }
    node.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') walk(entries, e);
      else if (e.key === 'ArrowLeft' && onLeft) { e.preventDefault(); onLeft(); }
      else if (e.key === 'ArrowRight' && onRight) { e.preventDefault(); onRight(); }
    });
    root.append(node);
    const w = node.offsetWidth || 0, h = node.offsetHeight || 0;
    node.style.left = `${clamp(at.x, 0, Math.max(0, LAYOUT.w - w))}px`; node.style.top = `${clamp(at.y, 0, Math.max(0, LAYOUT.h - h))}px`;
    menu = { node, owner };
    focus(entries.find(b => !b.hasAttribute('aria-disabled')));
    bump();
  }
  function closeMenu(toOwner = false) {
    if (!menu) return;
    const m = menu; menu = null; m.node.remove();
    if (toOwner) focus(m.owner);
    bump();
  }
  // ↑ and ↓ walk a menu's enabled items, wrapping.
  function walk(items, e) {
    const list = items.filter(b => !b.hasAttribute('aria-disabled')), n = list.length;
    e.preventDefault();
    if (!n) return;
    const at = list.indexOf(document.activeElement), down = e.key === 'ArrowDown';
    focus(list[at < 0 ? (down ? 0 : n - 1) : (at + (down ? 1 : n - 1)) % n]);
  }
  function openStart() { closeMenu(); start = true; startMenu.classList.toggle('pc-slide', !reduced()); render(); focus(startItems[0]); }
  function closeStart() {
    if (!start) return;
    start = false;
    if (menu?.owner && startMenu.contains(menu.owner)) closeMenu();
    render();
  }

  // Dialogs: one at a time over everything; the rest wait their turn. Not seated, a dialog answers null at once.
  function openDialog({ icon = 'info', text, buttons: labels = ['OK'], initial = 0, extra = null }) {
    const d = { icon, text, labels, initial, extra, buttons: [], node: null, done: false };
    d.promise = new Promise(resolve => { d.resolve = resolve; });
    d.close = value => finish(d, value);
    if (!seated) { d.done = true; d.resolve(null); return d; }
    dialogs.push(d);
    if (!dialog) nextDialog();
    return d;
  }
  function nextDialog() {
    const d = dialog = dialogs.shift() ?? null;
    if (d) {
      const backdrop = make('div', 'pc-dialog-backdrop'), box = make('div', 'pc-window pc-dialog front');
      box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true');
      const title = make('div', 'pc-title'), text = make('div', 'pc-title-text'), body = make('div', 'pc-dialog-body'), row = make('div', 'pc-dialog-buttons');
      text.append(make('span', null, 'Boss 98')); title.append(text);
      body.append(iconCanvas(ICONS[d.icon] ?? ICONS.info, 1), make('p', 'pc-dialog-text', d.text));
      d.buttons = d.labels.map(label => button('pc-button', label, () => finish(d, label)));
      row.append(...d.buttons);
      box.append(title, body, ...(d.extra ? [d.extra] : []), row);
      backdrop.append(box); root.append(backdrop); d.node = backdrop;
      focus(d.buttons[d.initial] ?? d.buttons[0]);
    }
    bump();
  }
  function finish(d, value) {
    if (d.done) return;
    d.done = true;
    const at = dialogs.indexOf(d); if (at >= 0) dialogs.splice(at, 1);
    d.resolve(value);
    if (dialog === d) { d.node.remove(); dialog = null; nextDialog(); }
  }

  // Install: "setup" takes at least a second and ends only once the server has added the icon (or said why not).
  function install(cart) {
    if (!seated) return;
    if (store.desktop().icons.length >= ROOM) { ui.dialog({ icon: 'warn', text: 'Not enough desktop space. Delete some icons first.', buttons: ['OK'] }); return; }
    const bar = make('div', 'pc-progress'); bar.append(make('div', 'pc-setup-fill'));
    const setup = openDialog({ icon: 'info', text: `Installing ${cart.title}…`, buttons: [], extra: bar });
    const job = { left: 2, reason: null, cancelled: false, timer: null };
    const done = () => {
      if (--job.left > 0 || job.cancelled) return;
      jobs.delete(job); setup.close(null);
      ui.dialog(job.reason === null ? { icon: 'info', text: 'Setup is complete.', buttons: ['OK'] }
        : { icon: 'error', text: `Setup failed: ${job.reason.replace(/\.$/, '')}.`, buttons: ['OK'] });
    };
    job.timer = setTimeout(() => { job.timer = null; done(); }, 1000);
    jobs.add(job);
    send({ op: 'add', kind: 'cart', pid: cart.pid }, m => { job.reason = m; }).then(done);
  }

  function tickClock() {
    const t = now();
    clock.textContent = W.clockOf(t);
    clearTimeout(clockTimer);
    clockTimer = setTimeout(tickClock, 60_000 - (t.getSeconds() * 1000 + t.getMilliseconds()));
    bump();
  }
  // The saved windows, once, at the first sit-down after the desktop loads (unless the windows were changed meanwhile).
  function restoreSaved() {
    restored = true;
    ws = W.normalizeWindows(store.desktop());
    player.show(ws.windows.pico8.cart);
    if (ws.windows.notepad.open) notepad.open(sessions, now());
    if (ws.windows.browser.open && !browser.page()) browser.home();
    render();
  }
  // Each frame while seated: onto the monitor's four corners on screen (top-left, top-right, bottom-right, bottom-left).
  function place(corners) {
    matrix = fitTransform(corners, LAYOUT.w, LAYOUT.h);
    const { a, b, c, d, e, f } = matrix, next = `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
    if (next !== transform) root.style.transform = transform = next;
    if (seated) return;
    seated = true; root.hidden = false;
    tickClock();
    select('browser'); focus(iconNodes.get('browser')?.node);
    if (!restored) {
      if (store.loaded()) restoreSaved();
      else store.load().then(ok => { if (ok && seated && !restored) restoreSaved(); });
    }
    // ▶ Play, never autoplay.
    player.show(ws.windows.pico8.cart);
    render();
  }
  function hide() {
    if (!seated) return;
    seated = false;
    cancelDrag(); closeMenu(); closeStart();
    for (const d of [...dialogs]) finish(d, null); // the waiting ones first, so none is shown on the way out
    if (dialog) finish(dialog, null);
    clearTimeout(clockTimer); clockTimer = null;
    for (const job of jobs) { job.cancelled = true; clearTimeout(job.timer); }
    jobs.clear();
    for (const z of zooms) z.remove();
    zooms.clear();
    player.stop();
    root.hidden = true; padSeen = false;
    render();
  }
  const stateOf = n => n === 'pico8' ? { cart: ws.windows.pico8.cart } : n === 'browser' ? { page: browser.page() } : { text: notepad.node.value };

  renderIcons(); render();
  return {
    root, ui, place, hide, install, play,
    arrange: () => send({ op: 'arrange' }),
    agents(list) {
      sessions = list;
      const shown = seated && visible('notepad');
      notepad.update(list, now(), shown);
      if (shown) bump();
    },
    // What the monitor draws while seated; version() changes whenever it would draw something else.
    view() {
      const top = W.frontmost(ws);
      return {
        icons: iconList().map(i => ({ id: i.id, name: i.name, kind: i.kind, spot: i.spot && [...i.spot], thumb: i.kind === 'cart' ? thumbName(i.pid) : null, selected: selected === i.id })),
        windows: ws.order.filter(n => shownIn(ws, n)).map(n => ({ name: n, title: MODS[n].title(), rect: W.rectOf(ws, n), front: n === top, mode: ws.windows[n].mode, state: stateOf(n) })),
        tasks: TASKS.filter(n => ws.windows[n].open).map(n => ({ name: n, title: MODS[n].title(), pressed: n === top })),
        start,
      };
    },
    version: () => version,
    // boss.js draws the idle monitor from this until Task 13 draws view().
    state: () => ({ window: null, cart: null, start }),
    dispose() { hide(); root.remove(); },
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
