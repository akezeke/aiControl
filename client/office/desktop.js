// The boss desk's computer, "Boss 98": a 90s desktop laid out once at LAYOUT and transformed onto the monitor's rectangle on
// screen. Icons come from the server desktop (pc-store.js); three windows (PICO-8, Info Highway, Notepad) sit over them, with a
// taskbar and Start. drawDesktop draws the monitor's picture of view() from the same numbers, so stepping in and out doesn't
// jump; drawGeneric is v1's picture, for a friend at the desk.
// While seated only these run on their own: the clock's one timeout to the next minute, an install's one-second timer, a touch's
// half-second long press, and a cart while its frame can be seen. hide() (standing up) stops all of it: the cart, a drag, menus,
// dialogs, a rename and the timers.
// The pausing rule: every render pauses the player unless seated and some of its frame is uncovered (W.gameHidden), so a
// minimised, covered or closed game never runs.
import { PICO_PALETTE, ICONS, iconCanvas, paint } from './pc-icons.js';
import { STARTERS, thumbName, listUrl } from './carts.js';
import * as W from './pc-windows.js';
import { createPcStore } from './pc-store.js';
import { createPlayer, draw as drawPlayer } from './pc-player.js';
import { createBrowser, readAddress, draw as drawBrowser } from './pc-browser.js';
import { createNotepad, draw as drawNotepad } from './pc-notepad.js';

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

// The taskbar's key legend for what has the keys; '' where a window shows its own (Info Highway's status bar) or a game has them.
export function legendFor(context) {
  return {
    desktop: '←→↑↓ Move   Enter Open   M Menu   Esc Stand up', menu: '←→↑↓ Move   Enter Choose   Esc Close',
    dialog: 'Enter OK   Esc Cancel', pico8: 'Enter/Z Play   Tab Next   Esc Stand up', notepad: 'Tab Next   Esc Stand up',
  }[context] ?? '';
}

const GLYPHS = { pico8: ICONS.console, browser: ICONS.globe, notepad: ICONS.notepad };
const TASKS = ['browser', 'notepad', 'pico8']; // the taskbar's fixed order
const BUILTINS = [{ id: 'browser', kind: 'browser', name: 'Info Highway' }, { id: 'salaries', kind: 'salaries', name: 'salaries.txt' }];
const ROOM = W.GRID.cols * W.GRID.rows - BUILTINS.length; // icons the grid holds besides the built-ins
const TAP = 400, SLOP = 4; // ms between two taps that maximise; px a pointer moves before a drag starts
// A mouse that moves with no button down missed its pointerup (let go outside the page, say): its drag ends there.
const missedUp = e => e.pointerType === 'mouse' && e.buttons === 0;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const shownIn = (s, n) => s.windows[n].open && s.windows[n].mode !== 'min';
export const THUMBS = 128; // the monitor's thumbnails kept: more than one draw asks for (50 icons, a page of 18 and a game)

export function createDesktop(container, {
  onShutDown, api, storage, online = () => navigator.onLine, now = () => new Date(),
  reduced = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  open: openTab = url => { globalThis.open?.(url, '_blank', 'noopener,noreferrer'); },
} = {}) {
  const make = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };
  const button = (className, text, onClick) => { const n = make('button', className, text); n.type = 'button'; if (onClick) n.addEventListener('click', onClick); return n; };
  // The layer is transformed; a scroll into view would shift it. lastFocus also follows focusin (keepFocus).
  const focus = n => { if (n) { n.focus({ preventScroll: true }); lastFocus = n; } };
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
  const letterOf = label => { const at = label.indexOf('&'); return at >= 0 && at < label.length - 1 ? label[at + 1].toLowerCase() : null; };

  let ws = W.defaults(), seated = false, restored = false, sessions = [], version = 0, start = false, selected = 'browser';
  let drag = null, menu = null, dialog = null, dialogPrev = null, lastTap = null, titleKind = 'mouse', iconKind = 'mouse', padSeen = false;
  let clockTimer = null, lastError = 'Desktop unavailable.', matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, transform = '';
  const dialogs = [], jobs = new Set(), zooms = new Set(), iconNodes = new Map();
  // Keys: deskKeys gives them to the desktop though a window is in front; keyMode shows the legend until a press; press is a touch
  // held for a context menu; rename is the field over an icon's label; titles are the menu bar titles, each opening its menu.
  let deskKeys = false, keyMode = false, press = null, rename = null, lastFocus = null;
  const titles = new Map();
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
  const player = createPlayer({ online, canFocus: () => seated && shownIn(ws, 'pico8') && W.frontmost(ws) === 'pico8' });
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
  root.tabIndex = -1; // focus falls back here, so keys stay in the desktop
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
    const max = button('pc-button', '□', () => change(W.toggleMax(W.front(ws, name), name))); // fronts too, in the one op
    const shut = button('pc-button', '×', () => closeWindow(name));
    min.setAttribute('aria-label', 'Minimize'); shut.setAttribute('aria-label', 'Close');
    if (W.FIXED.has(name)) { max.disabled = true; max.setAttribute('disabled', ''); }
    const buttons = make('div', 'pc-title-buttons'); buttons.append(min, max, shut);
    title.append(text, buttons);
    node.append(title);
    if (mod.menus) node.append(menubar(name, mod));
    node.append(mod.node);
    // A press fronts the window, except on _ □ ×: those make their own change, so each sends one op.
    node.addEventListener('pointerdown', e => {
      if (buttons.contains(e.target) && !e.target.disabled) return;
      if (W.frontmost(ws) !== name) change(W.front(ws, name));
    });

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
      if (!mine(e)) return;
      if (missedUp(e)) { endDrag(false); return; }
      if (!drag.movable) return;
      const p = toLayout(e, drag.box), dx = p.x - drag.from.x, dy = p.y - drag.from.y;
      if (!drag.moved && Math.hypot(dx, dy) <= SLOP) return; // a tap that wobbles is still a tap
      change(W.moveTo(ws, name, { x: drag.at.x + dx, y: drag.at.y + dy }), false);
      drag.moved = true;
    });
    // The window stays where the drag left it and is saved; only a real pointerup counts as a tap.
    function endDrag(tapped) {
      const d = drag; drag = null; release(title, d.pointer);
      if (d.moved || d.fronted) save();
      // A finger or a pen maximises with two taps; a double tap often sends no dblclick.
      if (!tapped || d.moved || d.kind === 'mouse') return;
      const at = +now();
      if (lastTap?.name === name && at - lastTap.at < TAP) { lastTap = null; change(W.toggleMax(ws, name)); } else lastTap = { name, at };
    }
    title.addEventListener('pointerup', e => { if (mine(e)) endDrag(true); });
    title.addEventListener('lostpointercapture', e => { if (mine(e)) endDrag(false); });
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
      items.push(item); bar.append(item); titles.set(item, () => openAt(i));
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
  const startMenu = make('div', 'pc-start-menu'), startList = make('div', 'pc-menu'), startItems = [], opens = new Map(), startRuns = new Map();
  startMenu.hidden = true; startList.setAttribute('role', 'menu');
  const startItem = (label, run, sub) => {
    const item = button('pc-menu-item', null, () => run(item)); item.setAttribute('role', 'menuitem'); mnemonic(item, label);
    if (sub) { item.setAttribute('aria-haspopup', 'menu'); opens.set(item, () => run(item)); }
    startRuns.set(item, { key: letterOf(label), run: () => run(item) });
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
  startMenu.append(make('div', 'pc-banner', 'Boss 98'), startList);

  root.append(iconLayer, ...W.NAMES.map(n => wins[n].node), startMenu, taskbar);
  // A press outside an open menu or Start closes it; on the bare desktop it also clears the selection.
  root.addEventListener('pointerdown', e => {
    const t = e.target;
    if (menu && !menu.node.contains(t) && !menu.owner?.contains(t)) closeMenu();
    if (start && !startMenu.contains(t) && !startButton.contains(t) && !menu?.node.contains(t)) closeStart();
    if (t === iconLayer) select(null);
  }, true);
  // Keys stay in here, so the desktop's own controls work and don't walk you about (onKey). The one keydown listener.
  // A key that is part of an IME composition is the field's (its Enter picks a word, its Esc drops it).
  root.addEventListener('keydown', e => {
    if (e.isComposing) { e.stopPropagation(); return; }
    keyMode = true; onKey(e); showLegend();
  });
  // A press: the legends give way to the status (Info Highway's too), a game lets go of the keys, a rename is kept, and the keys
  // go where it landed (in a window, focus outside it falls back to root, as a browser's press on a spot that takes no focus does).
  // A touch held still for half a second is a right-click.
  root.addEventListener('pointerdown', e => {
    const t = e.target, onRename = !!rename && t === rename.input, inLayer = iconLayer.contains(t), id = inLayer ? iconAt(t) : null;
    const win = W.NAMES.find(n => wins[n].node.contains(t));
    keyMode = false; browser.endLegend();
    if (document.activeElement?.tagName === 'IFRAME') focus(root);
    if (rename && !onRename) endRename(true);
    if (inLayer) { deskKeys = true; if (!onRename) focus(id ? iconNodes.get(id)?.node : root); }
    else if (win) { deskKeys = false; if (!wins[win].node.contains(document.activeElement)) focus(root); }
    if (e.pointerType === 'touch') startPress(e);
    showLegend();
  }, true);
  root.addEventListener('pointermove', e => {
    if (press && !press.done && e.pointerId === press.id && Math.hypot((e.clientX ?? 0) - press.x, (e.clientY ?? 0) - press.y) > STILL) endPress();
  }, true);
  root.addEventListener('pointerup', endPress, true);
  root.addEventListener('pointercancel', endPress, true);
  // Right-click (or the browser's own long press): our menu, except in a text field.
  root.addEventListener('contextmenu', e => {
    const t = e.target;
    if (isField(t)) return;
    e.preventDefault();
    if (press?.done || menu?.node.contains(t) || dialog?.node.contains(t)) return;
    if (press) { clearTimeout(press.timer); press.timer = null; press.done = true; }
    if (drag && !drag.moved) cancelDrag();
    contextMenu(t, toLayout(e, boxOf()));
  });
  root.addEventListener('focusin', e => { lastFocus = e.target; });
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
    // Focus never stays on something hidden: it would drop out of the desktop, and keys would walk you about.
    const active = document.activeElement;
    if (seated && active !== root && root.contains(active) && !usable(active)) focus(root);
    keepFocus();
    // salaries.txt is rebuilt when it comes into view, and on agents() only while it's in view.
    const pad = seated && visible('notepad');
    if (pad && !padSeen) notepad.update(sessions, now(), true);
    padSeen = pad;
    showLegend();
    bump();
  }
  // Still on the desktop and nothing on the way up is hidden (a closed window, the shut Start menu).
  function usable(n) {
    for (let at = n; at; at = at.parentNode) { if (at === root) return !root.hidden; if (at.hidden) return false; }
    return false;
  }
  function refocus(prev) { focus(usable(prev) ? prev : root); }
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
    const top = W.frontmost(ws); if (top && top !== W.frontmost(was)) deskKeys = false; // a window come to the front has the keys
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
  // A window brought up gets the keys; one minimised leaves them on its button.
  function taskClick(name) {
    const w = ws.windows[name], down = w.mode !== 'min' && W.frontmost(ws) === name;
    change(w.mode === 'min' ? W.restore(ws, name) : down ? W.minimize(ws, name) : W.front(ws, name));
    if (!down) keysTo(name);
  }
  function openWindow(name, { home = true } = {}) {
    closeStart();
    if (name === 'notepad' && !ws.windows.notepad.open) notepad.open(sessions, now());
    change(W.open(ws, name));
    if (name === 'browser' && home && !browser.page()) { browser.home(); render(); }
    keysTo(name);
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
    keysTo('pico8');
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
  // Focus stays on an icon that is rebuilt (a rename) or moved in the page (an append blurs it); a rename whose icon went is dropped.
  function renderIcons() {
    const list = iconList(), ids = new Set(list.map(i => i.id)), order = [], active = document.activeElement;
    let rebuilt = null;
    for (const [id, n] of iconNodes) if (!ids.has(id)) { n.node.remove(); iconNodes.delete(id); }
    for (const icon of list) {
      const sig = JSON.stringify([icon.kind, icon.name, icon.pid, icon.url, icon.author]);
      let n = iconNodes.get(icon.id);
      if (!n || n.sig !== sig) { if (n && n.node === active) rebuilt = icon.id; n?.node.remove(); n = { node: buildIcon(icon), sig }; iconNodes.set(icon.id, n); }
      n.icon = icon;
      if (!(drag?.type === 'icon' && drag.id === icon.id)) position(n.node, icon.spot);
      n.node.classList.toggle('selected', selected === icon.id);
      order.push(n.node);
    }
    const kids = [...iconLayer.children].filter(k => k !== rename?.input);
    if (kids.length !== order.length || order.some((n, i) => kids[i] !== n)) iconLayer.append(...order);
    if (rename && iconNodes.get(rename.id)?.node !== rename.node) endRename(false);
    if (rebuilt) focus(iconNodes.get(rebuilt)?.node);
    else if (seated && active !== document.activeElement && iconLayer.contains(active)) focus(active);
    keepFocus();
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
    // A cart whose author turned embedding off opens its page (open()), which says so; the tip says it first.
    const tip = icon.kind === 'cart' ? [icon.author, !icon.embed && 'plays only at lexaloffle.com'].filter(Boolean).join(' · ') : icon.kind === 'link' ? icon.url : '';
    if (tip) node.setAttribute('data-tip', tip);
    node.append(art, make('span', 'pc-icon-label', icon.name));

    const mine = e => drag?.type === 'icon' && drag.node === node && drag.pointer === e.pointerId;
    node.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !iconLayer.contains(node)) return; // gone: a rename the press committed rebuilt it
      iconKind = e.pointerType; select(id);
      const box = boxOf(), spot = iconNodes.get(id)?.icon.spot ?? [0, 0];
      const from = toLayout(e, box);
      drag = { type: 'icon', id, node, pointer: e.pointerId, box, from, last: from, base: cellXY(spot), moved: false, kind: e.pointerType };
      capture(node, e.pointerId);
    });
    node.addEventListener('pointermove', e => {
      if (!mine(e)) return;
      if (missedUp(e)) { endDrag(false, drag.last); return; }
      const p = toLayout(e, drag.box), dx = p.x - drag.from.x, dy = p.y - drag.from.y;
      if (!drag.moved && Math.hypot(dx, dy) <= SLOP) return;
      drag.moved = true; drag.last = p; node.style.left = `${drag.base.x + centre + dx}px`; node.style.top = `${drag.base.y + dy}px`;
    });
    // Dropped where the pointer last was; only a real pointerup counts as a tap.
    function endDrag(tapped, at) {
      const d = drag; drag = null; release(node, d.pointer);
      if (d.moved) dropIcon(d, at);
      else if (tapped && d.kind !== 'mouse') openIcon(id); // a finger or a pen opens with one tap
    }
    node.addEventListener('pointerup', e => { if (mine(e)) endDrag(true, toLayout(e, drag.box)); });
    node.addEventListener('lostpointercapture', e => { if (mine(e)) endDrag(false, drag.last); });
    node.addEventListener('pointercancel', e => { if (mine(e)) cancelDrag(); });
    node.addEventListener('dblclick', () => { if (iconKind === 'mouse') openIcon(id); });
    return node;
  }
  function dropIcon(d, p) {
    const { size, cols, rows } = W.GRID, spots = store.desktop().spots, was = spots[d.id];
    const col = clamp(Math.round((d.base.x - W.GRID.x + p.x - d.from.x) / size), 0, cols - 1);
    const row = clamp(Math.round((d.base.y - W.GRID.y + p.y - d.from.y) / size), 0, rows - 1);
    const taken = Object.entries(spots).some(([other, s]) => other !== d.id && s?.[0] === col && s?.[1] === row);
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
    const prev = menu ? menu.prev : document.activeElement; // a menu that replaces another returns focus where the first found it
    closeMenu();
    const node = make('div', 'pc-menu pc-popup'), entries = [], list = items.filter(item => item !== '-');
    node.setAttribute('role', 'menu');
    for (const item of items) {
      if (item === '-') { node.append(make('div', 'pc-menu-sep')); continue; }
      const b = button('pc-menu-item', null, () => choose(item));
      b.setAttribute('role', 'menuitem'); mnemonic(b, item.label);
      if (item.disabled) b.setAttribute('aria-disabled', 'true');
      entries.push(b); node.append(b);
    }
    root.append(node);
    const w = node.offsetWidth || 0, h = node.offsetHeight || 0;
    node.style.left = `${clamp(at.x, 0, Math.max(0, LAYOUT.w - w))}px`; node.style.top = `${clamp(at.y, 0, Math.max(0, LAYOUT.h - h))}px`;
    menu = { node, owner, prev, entries, items: list, onLeft, onRight }; // its keys: menuKey
    focus(entries.find(b => !b.hasAttribute('aria-disabled')));
    showLegend(); bump();
  }
  function choose(item) {
    if (item.disabled) return;
    closeMenu(); closeStart(); item.run(); render();
  }
  // Focus in the menu goes back where it was before (or to the owner, on Esc); a press elsewhere has already moved it.
  function closeMenu(toOwner = false) {
    if (!menu) return;
    const m = menu, had = m.node.contains(document.activeElement); menu = null; m.node.remove();
    if (toOwner && m.owner) focus(m.owner); else if (had && seated) refocus(m.prev);
    showLegend(); bump();
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
  // `focus`: a field in `extra` to start on instead of the default button.
  function openDialog({ icon = 'info', text, buttons: labels = ['OK'], initial = 0, extra = null, focus: first = null }) {
    const d = { icon, text, labels, initial, extra, first, buttons: [], node: null, done: false };
    d.promise = new Promise(resolve => { d.resolve = resolve; });
    d.close = value => finish(d, value);
    // Not seated: no dialog nobody sees, so an op that fails after you stand up stays dropped (the store is back on the server's desktop).
    if (!seated) { d.done = true; d.resolve(null); return d; }
    dialogs.push(d);
    if (!dialog) { dialogPrev = document.activeElement; nextDialog(); }
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
      focus(d.first ?? d.buttons[d.initial] ?? d.buttons[0]);
    } else if (seated) refocus(dialogPrev); // the last one closed
    showLegend(); bump();
  }
  function finish(d, value) {
    if (d.done) return;
    d.done = true;
    const at = dialogs.indexOf(d); if (at >= 0) dialogs.splice(at, 1);
    d.resolve(value);
    if (dialog === d) { d.node.remove(); dialog = null; nextDialog(); }
  }

  // Install: "setup" takes at least a second and ends only once the server has added the icon (or said why not).
  // `cart.name`: the icon's name, given in New shortcut (else the cart's title).
  function install(cart) {
    if (!seated || full()) return;
    const bar = make('div', 'pc-progress'), fill = make('div', 'pc-setup-fill');
    if (reduced()) Object.assign(fill.style, { width: '100%', animation: 'none' }); // full at once
    bar.append(fill);
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
    send({ op: 'add', kind: 'cart', pid: cart.pid, ...(cart.name ? { name: cart.name } : {}) }, m => { job.reason = m; }).then(done);
  }
  function full() {
    if (store.desktop().icons.length < ROOM) return false;
    ui.dialog({ icon: 'warn', text: 'Not enough desktop space. Delete some icons first.', buttons: ['OK'] });
    return true;
  }

  // Keys: every shortcut is one key (Ctrl/Cmd+F is S). They go to the open menu, dialog, rename or Start, else to the window
  // holding focus, else to the desktop when an icon or taskbar button holds it, else to the front window unless the desktop was
  // pressed last or had no window in front at the sit-down (deskKeys). Text fields keep their letters (and an IME's keys); a
  // focused game gets every key; Esc closes the top menu, dialog, rename or Start, and with none open goes on and stands you up.
  const isField = n => n?.tagName === 'INPUT' || n?.tagName === 'TEXTAREA';
  const control = n => n?.tagName === 'BUTTON' || n?.tagName === 'A';
  const plain = e => !(e.ctrlKey || e.metaKey || e.altKey);
  const connected = n => { for (let at = n; at; at = at.parentNode) if (at === document) return true; return false; };
  const iconAt = t => { for (const [id, n] of iconNodes) if (n.node.contains(t)) return id; return null; };
  const byGrid = (a, b) => a.spot[0] - b.spot[0] || a.spot[1] - b.spot[1];
  const STEP = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const LONG = 500, STILL = 8; // ms a touch is held for a context menu; client px it may wobble meanwhile
  // A re-render or close that took the focused node out of the page leaves focus nowhere (the body): it comes back to the desktop.
  function keepFocus() {
    if (!seated) return;
    const a = document.activeElement;
    if (!a || !connected(a) || (a === document.body && lastFocus && !root.contains(lastFocus))) focus(root);
  }
  function keysTo(name) {
    deskKeys = false;
    if (seated && !wins[name].node.contains(document.activeElement)) focus(root);
  }
  // The window holding focus; an icon, Start or task button holding it is the desktop's (Enter acts on it); root, where focus
  // falls back, goes to the front window unless the desktop has the keys.
  function keyOwner() {
    const active = document.activeElement, top = W.frontmost(ws);
    const win = W.NAMES.find(n => shownIn(ws, n) && wins[n].node.contains(active));
    if (win) return win;
    if (active !== root && root.contains(active)) return 'desktop';
    return !top || deskKeys ? 'desktop' : top;
  }
  // At a sit-down, and when the saved windows come back: the front window has the keys, else the desktop on its selected icon.
  // An open menu, dialog, rename or Start keeps its focus.
  function seatKeys() {
    const top = W.frontmost(ws);
    deskKeys = !top;
    if (!menu && !dialog && !rename && !start) focus(top ? root : iconNodes.get(selected)?.node ?? root);
  }
  function keyContext() {
    if (menu || start) return 'menu';
    if (dialog) return dialog.buttons.length ? 'dialog' : null;
    if (rename) return 'dialog';
    const owner = keyOwner();
    return owner === 'pico8' ? (player.playing() ? null : 'pico8') : owner === 'browser' ? null : owner;
  }
  function showLegend() {
    const text = keyMode && seated ? legendFor(keyContext()) : '';
    if (legend.textContent !== text) { legend.textContent = text; bump(); }
  }
  function onKey(e) {
    const k = e.key;
    if (document.activeElement?.tagName === 'IFRAME') { if (k !== 'Escape') e.stopPropagation(); return; }
    if (k === 'Escape') {
      if (menu) closeMenu(true);
      else if (dialog) { if (dialog.buttons.length) finish(dialog, null); }
      else if (rename) endRename(false);
      else if (start) { closeStart(); focus(startButton); }
      else return;
      e.stopPropagation(); return;
    }
    e.stopPropagation();
    keepFocus();
    if (menu) { menuKey(e); return; }
    if (dialog) {
      if (k === 'Enter') {
        e.preventDefault();
        const at = dialog.buttons.indexOf(document.activeElement), pick = at >= 0 ? at : dialog.initial;
        if (dialog.buttons[pick]) finish(dialog, dialog.labels[pick]);
      } else if (k === 'Tab') { e.preventDefault(); cycle(tabStops(dialog.node), e.shiftKey); }
      return;
    }
    if (rename) { if (k === 'Enter' || k === 'Tab') { e.preventDefault(); endRename(true); } return; }
    if (start) { startKey(e); return; }
    const owner = keyOwner();
    if (owner === 'desktop') deskKey(e); else windowKey(e, owner);
  }
  // Space stays the browser's click on a focused item.
  function menuKey(e) {
    const k = e.key;
    if (k === ' ') return;
    e.preventDefault();
    if (k === 'ArrowUp' || k === 'ArrowDown') walk(menu.entries, e);
    else if (k === 'ArrowLeft') menu.onLeft?.();
    else if (k === 'ArrowRight') menu.onRight?.();
    else if (k === 'Enter') { const at = menu.entries.indexOf(document.activeElement); if (at >= 0) choose(menu.items[at]); }
    else if (plain(e) && k.length === 1) { const item = menu.items.find(i => letterOf(i.label) === k.toLowerCase()); if (item) choose(item); }
  }
  function startKey(e) {
    const k = e.key, active = document.activeElement;
    if (k === ' ') return;
    e.preventDefault();
    if (k === 'ArrowUp' || k === 'ArrowDown') walk(startItems, e);
    else if (k === 'ArrowRight') opens.get(active)?.();
    else if (k === 'Enter') { if (active === startButton) closeStart(); else startRuns.get(active)?.run(); }
    else if (plain(e) && k.length === 1) [...startRuns.values()].find(r => r.key === k.toLowerCase())?.run();
  }
  function deskKey(e) {
    if (!plain(e)) return;
    const k = e.key, active = document.activeElement;
    if (STEP[k]) { e.preventDefault(); arrow(k); }
    else if (k === 'Enter' || k === 'z' || k === 'Z') {
      e.preventDefault();
      const task = TASKS.find(n => tasks[n].node === active);
      if (active === startButton) openStart(); else if (task) taskClick(task); else if (selected) openIcon(selected);
    } else if (k === 'm' || k === 'M' || k === 'ContextMenu') { e.preventDefault(); deskMenu(); }
    else if (k === 'Tab') { e.preventDefault(); deskTab(e.shiftKey); }
  }
  function windowKey(e, name) {
    const win = wins[name].node, k = e.key;
    if (!win.contains(document.activeElement)) focus(root);
    const active = document.activeElement;
    if (isField(active)) {
      if (k === 'Tab' && plain(e)) { e.preventDefault(); cycle(tabStops(win), e.shiftKey); }
      else if (name === 'browser' && (k === 'Enter' || ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'f')) && browser.key(e)) { e.preventDefault(); render(); }
      return;
    }
    if (plain(e) && (k === 'Enter' || k === 'ArrowDown') && titles.has(active)) { e.preventDefault(); titles.get(active)(); return; }
    if (name === 'browser' && browser.key(e)) { e.preventDefault(); render(); return; }
    if (!plain(e)) return;
    if (k === 'Tab') { e.preventDefault(); cycle(tabStops(win), e.shiftKey); }
    else if (name === 'browser' && (k === 'm' || k === 'M' || k === 'ContextMenu')) {
      e.preventDefault();
      const items = browser.contextItems();
      if (items.length) ui.menu(items, keyPoint(active, W.rectOf(ws, name)));
    } else if (name === 'pico8' && (k === 'Enter' || k === 'z' || k === 'Z')) {
      if (k === 'Enter' && control(active) && !player.node.contains(active)) return; // the button's own click
      e.preventDefault();
      if (player.playing()) focus(player.frame()); else if (player.cart()) play(player.cart());
    }
  }
  // The nearest icon that way, straight on before aside (ties go in grid order); none that way stays put.
  function arrow(k) {
    const list = iconList().filter(i => i.spot).sort(byGrid), cur = list.find(i => i.id === selected), [dx, dy] = STEP[k];
    let to = cur ?? list[0], best = Infinity;
    if (cur) for (const i of list) {
      const x = i.spot[0] - cur.spot[0], y = i.spot[1] - cur.spot[1], along = x * dx + y * dy, score = along + 2 * Math.abs(dx ? y : x);
      if (along > 0 && score < best) { best = score; to = i; }
    }
    if (!to) return;
    select(to.id); focus(iconNodes.get(to.id)?.node);
  }
  function deskMenu() {
    const icon = iconNodes.get(selected)?.icon;
    if (icon?.spot) { const c = cellXY(icon.spot); ui.menu(iconMenu(icon.id), { x: c.x + centre + 38, y: c.y + 40 }); }
    else ui.menu(deskItems(), { x: W.GRID.x, y: W.GRID.y });
  }
  // The desktop's Tab: the icons in grid order, Start, then the task buttons.
  function deskTab(back) {
    const icons = iconList().filter(i => i.spot).sort(byGrid);
    const stops = [...icons.map(i => iconNodes.get(i.id)?.node), startButton, ...TASKS.map(n => tasks[n].node).filter(n => !n.hidden)].filter(Boolean);
    const to = cycle(stops, back), icon = icons.find(i => iconNodes.get(i.id)?.node === to);
    if (icon) select(icon.id);
  }
  // What Tab reaches in a window or dialog, in page order: enabled controls not hidden (the title bar's _ □ × are left out).
  function tabStops(scope) {
    const out = [], TAGS = ['BUTTON', 'INPUT', 'TEXTAREA', 'IFRAME', 'SELECT'];
    const stop = n => (TAGS.includes(n.tagName) || (n.tagName === 'A' && (n.hasAttribute('href') || n.hasAttribute('tabindex'))))
      && !n.disabled && !n.hasAttribute('disabled') && n.getAttribute('aria-disabled') !== 'true' && n.getAttribute('tabindex') !== '-1';
    (function visit(n) {
      for (const k of [...n.children]) {
        if (k.hidden || k.style?.display === 'none' || k.classList?.contains('pc-title')) continue;
        if (stop(k)) out.push(k);
        visit(k);
      }
    })(scope);
    return out;
  }
  function cycle(list, back) {
    const n = list.length; if (!n) return null;
    const at = list.indexOf(document.activeElement), to = list[at < 0 ? (back ? n - 1 : 0) : (at + (back ? n - 1 : 1)) % n];
    focus(to); return to;
  }
  // Where a menu opened by key goes: under the focused item, else mid-window.
  function keyPoint(n, r) {
    const b = n?.getBoundingClientRect?.();
    return b && (b.width || b.height) ? toLayout({ clientX: b.left, clientY: b.bottom }, boxOf()) : { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  // Context menus: an icon's, the bare desktop's, and Info Highway's on a cart.
  function contextMenu(t, at) {
    const id = iconAt(t);
    if (id) { select(id); ui.menu(iconMenu(id), at); }
    else if (t === iconLayer) ui.menu(deskItems(), at);
    else if (shownIn(ws, 'browser') && browser.node.contains(t)) {
      browser.pick(t); // the card under it, or none
      const items = browser.contextItems();
      if (items.length) ui.menu(items, at);
    }
  }
  function iconMenu(id) {
    const icon = iconNodes.get(id)?.icon, own = !!icon && !BUILTINS.some(b => b.id === id);
    const remove = () => ui.dialog({ icon: 'question', text: `Are you sure you want to delete '${icon.name}'?`, buttons: ['Yes', 'No'] })
      .then(answer => { if (answer === 'Yes') send({ op: 'remove', id }); });
    return [{ label: '&Open', run: () => openIcon(id) }, { label: '&Rename', disabled: !own, run: () => startRename(id) }, { label: '&Delete', disabled: !own, run: remove }];
  }
  const deskItems = () => [{ label: '&New shortcut…', run: newShortcut }, { label: '&Arrange icons', run: () => send({ op: 'arrange' }) }];
  // A touch on an icon, the desktop or Info Highway (not a field) held still for LONG ms. The only timer keys and menus add.
  function startPress(e) {
    endPress();
    const t = e.target;
    if (isField(t) || !(iconLayer.contains(t) || (shownIn(ws, 'browser') && browser.node.contains(t)))) return;
    press = { x: e.clientX ?? 0, y: e.clientY ?? 0, id: e.pointerId, target: t, done: false, timer: null };
    press.timer = setTimeout(() => {
      const p = press; p.done = true; p.timer = null;
      if (drag) cancelDrag();
      contextMenu(p.target, toLayout({ clientX: p.x, clientY: p.y }, boxOf()));
    }, LONG);
  }
  function endPress() { if (press?.timer) clearTimeout(press.timer); press = null; }

  // Rename: a field over the label. Enter, Tab or a press elsewhere keeps the name; Esc drops it.
  function startRename(id) {
    const n = iconNodes.get(id), spot = n?.icon.spot;
    if (!seated || !spot) return;
    endRename(false);
    const input = make('input', 'pc-field pc-rename'), label = [...n.node.children].find(k => k.classList.contains('pc-icon-label')), c = cellXY(spot);
    input.type = 'text'; input.setAttribute('maxlength', '40'); input.setAttribute('aria-label', 'Name'); input.value = n.icon.name;
    Object.assign(input.style, { position: 'absolute', zIndex: '1', left: `${c.x + centre}px`, top: `${c.y + 40}px`, width: '76px', padding: '1px 2px', font: 'inherit', textAlign: 'center' });
    label.style.visibility = 'hidden';
    rename = { id, input, label, node: n.node };
    iconLayer.append(input); focus(input); input.select?.();
    showLegend(); bump();
  }
  function endRename(commit) {
    const r = rename; if (!r) return;
    rename = null; r.input.remove(); r.label.style.visibility = '';
    const name = r.input.value.trim(), icon = iconNodes.get(r.id)?.icon;
    if (commit && name && icon && name !== icon.name) send({ op: 'rename', id: r.id, name: name.slice(0, 40) });
    if (seated) focus(iconNodes.get(r.id)?.node ?? root);
    showLegend(); bump();
  }

  // New shortcut: a cart or thread link installs the cart; another https link (or a BBS list) is a link icon.
  function newShortcut() {
    if (full()) return;
    const form = make('div'), link = make('input', 'pc-field'), name = make('input', 'pc-field');
    Object.assign(form.style, { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 6px', alignItems: 'center', padding: '0 12px 8px' });
    link.type = name.type = 'text'; link.setAttribute('maxlength', '500'); name.setAttribute('maxlength', '40');
    link.setAttribute('aria-label', 'Link'); name.setAttribute('aria-label', 'Name');
    form.append(make('span', null, 'Link'), link, make('span', null, 'Name'), name);
    ui.dialog({ icon: 'globe', text: 'New shortcut', buttons: ['OK', 'Cancel'], extra: form, focus: link })
      .then(answer => { if (answer === 'OK') addShortcut(link.value, name.value); });
  }
  function addShortcut(text, label) {
    text = String(text ?? '').trim();
    const name = String(label ?? '').trim().slice(0, 40), r = readAddress(text);
    if (!text) return;
    if (r.kind === 'cart') install({ pid: r.pid, title: name || r.pid, name: name || undefined });
    else if (r.kind === 'thread') {
      api('office/bbs/cart?tid=' + encodeURIComponent(r.tid))
        .then(info => { if (seated) install({ pid: info.pid, title: name || info.title || info.pid, name: name || undefined }); }, e => showError(e?.message || 'Cannot find the cart in that thread.'));
    } else if (r.kind === 'away' || r.kind === 'list') {
      if (full()) return;
      const url = r.kind === 'list' ? listUrl(r) : r.url;
      send({ op: 'add', kind: 'link', url, name: name || new URL(url).hostname.slice(0, 40) });
    } else ui.dialog({ icon: 'warn', text: 'Only https:// links can be shortcuts.', buttons: ['OK'] });
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
    select('browser');
    // A failed load says why once; only the built-ins show, and the next sit-down tries again.
    if (store.loaded()) { if (!restored) restoreSaved(); }
    else {
      store.load().then(ok => {
        if (!seated) return;
        if (!ok) showError(store.error());
        else if (!restored) { restoreSaved(); seatKeys(); }
      });
    }
    seatKeys();
    // ▶ Play, never autoplay.
    player.show(ws.windows.pico8.cart);
    render();
  }
  function hide() {
    if (!seated) return;
    seated = false; keyMode = false;
    cancelDrag(); closeMenu(); closeStart(); endPress(); endRename(false);
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
  // The monitor's thumbnails (drawDesktop's `image`): made on a draw's first ask, never while seated (the desktop's own <img>s
  // show them then). Each load bumps version(), so loads in one frame make one redraw; one that fails stays null (the icon).
  const thumbs = new Map(); // name -> { img, loaded }, the least recently asked first
  function image(name) {
    let entry = thumbs.get(name);
    if (entry) thumbs.delete(name);
    else if (seated) return null;
    else {
      const img = new Image(), made = { img, loaded: false };
      img.addEventListener('load', () => { made.loaded = true; bump(); }, { once: true });
      img.src = '/api/office/bbs/thumb/' + name;
      if (thumbs.size >= THUMBS) thumbs.delete(thumbs.keys().next().value);
      entry = made;
    }
    thumbs.set(name, entry);
    return entry.loaded ? entry.img : null;
  }

  renderIcons(); render();
  return {
    root, ui, place, hide, install, play, image,
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
    dispose() { hide(); root.remove(); },
  };
}

// The monitor's picture of view(), onto a context already scaled to LAYOUT, in pc.css's boxes and colours: the teal, the icons,
// the windows back to front (each module draws its own client area), the taskbar and clock, and Start if it's open. The key
// legend is left off: it's for whoever's seated. `image(name)`: a loaded thumbnail or null (createDesktop's image).
const SYSTEM = "Tahoma, 'MS Sans Serif', Arial, sans-serif", GRAY = '#c0c0c0', DARK = '#808080', NAVY = '#000080', SKY = '#1084d0';
const CHECKER = '#e0e0e0'; // a pressed task's 1 px checker of gray and white, averaged
// The box-shadow bevels as [top-left, bottom-right] rings, outermost first.
const RAISED = [['#dfdfdf', '#000'], ['#fff', DARK]], BUTTON = [['#fff', '#000'], ['#dfdfdf', DARK]], PRESSED = [['#000', '#fff'], [DARK, '#dfdfdf']], SUNK = [[DARK, '#fff']];
// The windows' menus() labels (a test holds them to it: menus() needs a module made), and their bar's height.
export const MENUS = { browser: ['File', 'Go', 'Help'], notepad: ['File'] };
const MENUBAR = 20;
const DRAWS = { pico8: drawPlayer, browser: drawBrowser, notepad: drawNotepad };
export function drawDesktop(g, view, { clock, image }) {
  const width = s => g.measureText?.(s)?.width ?? 0;
  // Cut to `max` px with an ellipsis, as text-overflow does.
  const fit = (s, max) => {
    if (width(s) <= max) return s;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (width(s.slice(0, mid) + '…') <= max) lo = mid; else hi = mid - 1; }
    return s.slice(0, lo) + '…';
  };
  const say = (s, x, y, color, { bold = false, align = 'left', max = Infinity } = {}) => {
    g.font = `${bold ? 'bold ' : ''}12px ${SYSTEM}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle';
    g.fillText(fit(String(s), max), x, y);
  };
  const edges = (x, y, w, h, rings) => rings.forEach(([lt, rb], i) => {
    g.fillStyle = lt; g.fillRect(x + i, y + i, w - 2 * i, 1); g.fillRect(x + i, y + i, 1, h - 2 * i);
    g.fillStyle = rb; g.fillRect(x + i, y + h - 1 - i, w - 2 * i, 1); g.fillRect(x + w - 1 - i, y + i, 1, h - 2 * i);
  });
  const box = (x, y, w, h, rings, fill = GRAY) => { g.fillStyle = fill; g.fillRect(x, y, w, h); edges(x, y, w, h, rings); };
  const fade = (x0, y0, x1, y1) => { const f = g.createLinearGradient(x0, y0, x1, y1); f.addColorStop(0, NAVY); f.addColorStop(1, SKY); return f; };
  const glyph = (name, x, y) => paint(g, GLYPHS[name], x, y, 16 / GLYPHS[name].w);
  g.fillStyle = '#008080'; g.fillRect(0, 0, LAYOUT.w, LAYOUT.h);
  g.imageSmoothingEnabled = false;

  // Icons, 76 px wide in their cell: the art (a cart's thumbnail once loaded) with a shortcut's arrow, and the label under it.
  for (const icon of view.icons) {
    if (!icon.spot) continue;
    const left = W.GRID.x + icon.spot[0] * W.GRID.size + (W.GRID.size - 76) / 2, top = W.GRID.y + icon.spot[1] * W.GRID.size, ax = left + 22, ay = top + 4;
    const img = icon.thumb ? image(icon.thumb) : null;
    if (img) g.drawImage(img, ax, ay, 32, 32);
    else paint(g, icon.kind === 'cart' ? ICONS.cart : icon.kind === 'salaries' ? ICONS.notepad : ICONS.globe, ax, ay);
    if (icon.kind === 'cart' || icon.kind === 'link') paint(g, ICONS.arrow, ax, ay + 22);
    g.font = `12px ${SYSTEM}`; const label = fit(icon.name, 66), w = width(label) + 6;
    if (icon.selected) { g.fillStyle = NAVY; g.fillRect(left + 38 - w / 2, top + 40, w, 17); }
    say(label, left + 38, top + 48.5, '#fff', { align: 'center' });
  }

  // Windows, back to front: the frame, the title bar (the front one's blue fades across), _ □ × and the menubar.
  for (const win of view.windows) {
    const { x, y, w, h } = win.rect, tx = x + 3, ty = y + 3, tw = w - 6, bar = MENUS[win.name] ? MENUBAR : 0;
    box(x, y, w, h, RAISED);
    g.fillStyle = win.front ? fade(tx, 0, tx + tw, 0) : DARK; g.fillRect(tx, ty, tw, TITLE);
    glyph(win.name, tx + 2, ty + 5);
    say(win.title, tx + 22, ty + TITLE / 2, win.front ? '#fff' : GRAY, { bold: true, max: tw - 92 });
    [['_', false], [win.mode === 'max' ? '❐' : '□', W.FIXED.has(win.name)], ['×', false]].forEach(([mark, off], i) => {
      const bx = tx + tw - 66 + i * 22, by = ty + 3;
      box(bx, by, 20, 20, BUTTON);
      if (off) say(mark, bx + 11, by + 11, '#fff', { align: 'center' });
      say(mark, bx + 10, by + 10, off ? DARK : '#000', { align: 'center' });
    });
    let mx = tx + 2;
    for (const label of MENUS[win.name] ?? []) { say(label, mx + 6, ty + TITLE + MENUBAR / 2, '#000'); mx += width(label) + 14; }
    const client = { x: tx, y: ty + TITLE + bar, w: tw, h: h - 6 - TITLE - bar };
    g.save(); g.beginPath(); g.rect(client.x, client.y, client.w, client.h); g.clip();
    DRAWS[win.name](g, client, { ...win.state, image });
    g.restore();
  }

  // The taskbar: Start, a button per open window (the front one's pressed) and the clock.
  const top = LAYOUT.h - TASKBAR, by = top + 6;
  g.fillStyle = GRAY; g.fillRect(0, top, LAYOUT.w, TASKBAR);
  g.fillStyle = '#dfdfdf'; g.fillRect(0, top, LAYOUT.w, 1); g.fillStyle = '#fff'; g.fillRect(0, top + 1, LAYOUT.w, 1);
  const down = view.start ? 1 : 0;
  box(4, by, 64, 32, view.start ? PRESSED : BUTTON); say('Start', 36 + down, by + 16 + down, '#000', { bold: true, align: 'center' });
  view.tasks.forEach((task, i) => {
    const x = 72 + i * 164, d = task.pressed ? 1 : 0;
    box(x, by, 160, 32, task.pressed ? PRESSED : BUTTON, task.pressed ? CHECKER : GRAY);
    glyph(task.name, x + 8 + d, by + 8 + d);
    say(task.title, x + 28 + d, by + 16 + d, '#000', { bold: task.pressed, max: 124 });
  });
  edges(LAYOUT.w - 68, top + 8, 64, 28, SUNK); say(clock, LAYOUT.w - 36, top + 22, '#000', { align: 'center' });

  // Start: the banner up its left side, Programs and Documents, a rule and Shut down….
  if (!view.start) return;
  const mh = 3 + 3 * 22 + 8 + 3, my = top - mh;
  box(4, my, 190, mh, RAISED);
  g.fillStyle = fade(0, my + mh - 3, 0, my + 3); g.fillRect(7, my + 3, 22, mh - 6);
  g.save(); g.translate(18, my + mh - 7); g.rotate(-Math.PI / 2); say('Boss 98', 0, 0, GRAY, { bold: true }); g.restore();
  let iy = my + 3;
  for (const item of ['Programs ▸', 'Documents ▸', null, 'Shut down…']) {
    if (!item) { g.fillStyle = DARK; g.fillRect(34, iy + 3, 155, 1); g.fillStyle = '#fff'; g.fillRect(34, iy + 4, 155, 1); iy += 8; continue; }
    say(item, 46, iy + 11, '#000'); iy += 22;
  }
}

// v1's picture, for a friend at the boss desk (desktops are never shared), onto a context already scaled to LAYOUT. `game`:
// 128 × 128 palette indexes, played in the PICO-8 window (their made-up cart).
export function drawGeneric(g, state, { clock, game = null }) {
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
