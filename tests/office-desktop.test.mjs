import test from 'node:test';
import assert from 'node:assert/strict';
import { MENUS, THUMBS, createDesktop, drawDesktop, fakeCart, fitTransform, legendFor } from '../client/office/desktop.js';
import { STARTERS, thumbName } from '../client/office/carts.js';
import { GRID, NAMES, defaults, rectOf } from '../client/office/pc-windows.js';
import { createPlayer } from '../client/office/pc-player.js';
import { createBrowser } from '../client/office/pc-browser.js';
import { createNotepad } from '../client/office/pc-notepad.js';
import { useDom, find, findAll } from './fixtures/pc-dom.mjs';

const tick = () => new Promise(r => setImmediate(r));
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const NOW = new Date(2026, 10, 12, 14, 32, 10);
const memory = () => { const data = {}; return { getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; } }; };

// The fake DOM's textContent is a plain field, so textOf gathers a node's own text and its children's.
const has = (n, name) => !!n?.classList?.contains(name);
const textOf = n => n.textContent + n.children.map(textOf).join('');
const shown = n => { for (let at = n; at?.tag; at = at.parent) if (at.hidden) return false; return true; };
const pointer = (node, type, init = {}) => node.dispatch(type, { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, ...init });
const click = (node, init) => { pointer(node, 'pointerdown', init); pointer(node, 'pointerup', init); node.dispatch('click', init); };
const dblclick = (node, init) => { click(node, init); click(node, init); node.dispatch('dblclick', init); };
const key = (node, k, init = {}) => node.dispatch('keydown', { key: k, ...init });
const titleOf = (root, title) => find(root, n => has(n, 'pc-title-text') && textOf(n) === title)?.parent;
const windowOf = (root, title) => titleOf(root, title)?.parent;
const button = (root, title, glyph) => find(titleOf(root, title), n => n.tag === 'button' && n.textContent === glyph);
const task = (root, title) => find(root, n => has(n, 'pc-task') && shown(n) && textOf(n) === title);
const startOf = root => find(root, n => has(n, 'pc-start'));
const startMenuOf = root => find(root, n => has(n, 'pc-start-menu'));
const windowsOf = root => findAll(root, n => has(n, 'pc-window') && !has(n, 'pc-dialog'));
const iframeOf = root => find(root, n => n.tag === 'iframe');
const playing = (d, cart) => { d.play(cart); return iframeOf(d.root); };
const install = (d, cart) => d.install(cart);
const startDrag = node => { pointer(node, 'pointerdown'); pointer(node, 'pointermove', { clientX: 40, clientY: 30 }); };
const openDialogs = root => findAll(root, n => has(n, 'pc-dialog')).length;
const openMenus = root => findAll(root, n => has(n, 'pc-popup')).length;
const dialogText = root => findAll(root, n => has(n, 'pc-dialog-text')).at(-1)?.textContent;
const dialogButton = (root, label) => find(findAll(root, n => has(n, 'pc-dialog')).at(-1), n => n.tag === 'button' && n.textContent === label);
const iconOf = (root, name) => find(root, n => has(n, 'pc-icon-label') && n.textContent === name)?.parent;
const menuItem = (root, text) => find(root, n => has(n, 'pc-menu-item') && shown(n) && textOf(n) === text);
const zoomsOf = root => findAll(root, n => has(n, 'pc-zoom'));
const selectIcon = (d, id) => click(iconOf(d.root, d.view().icons.find(i => i.id === id).name));
const selectedId = d => d.view().icons.find(i => i.selected)?.id;
const searchBox = root => find(root, n => has(n, 'pc-field') && has(n, 'search'));
const legendText = root => find(root, n => has(n, 'pc-legend')).textContent;
const layerOf = root => find(root, n => has(n, 'pc-icons'));
// The open popup's items, as [text, disabled].
const menuItems = root => { const m = findAll(root, n => has(n, 'pc-popup')).at(-1); return m ? findAll(m, n => has(n, 'pc-menu-item')).map(n => [textOf(n), n.getAttribute('aria-disabled') === 'true']) : []; };
const openBrowser = async d => { dblclick(iconOf(d.root, 'Info Highway')); await tick(); };
const windowOps = api => api.posted.filter(b => b.op === 'windows');
const SESSION = { id: 's-alpha', project: 'aiControl', status: 'working' }, OTHER = { id: 's-beta', project: 'aiControl', status: 'idle' };

// A new server desktop: the built-ins and the starters i1-i4 (or `own` icons), then `extra`, placed column by column; `spots` overrides.
function desk({ own, extra = [], windows, spots: over = {} } = {}) {
  const icons = [...(own ?? STARTERS.map((c, n) => ({ id: `i${n + 1}`, kind: 'cart', pid: c.pid, name: c.title, author: c.author, embed: true }))), ...extra];
  const spots = Object.fromEntries(['browser', 'salaries', ...icons.map(i => i.id)].map((id, n) => [id, [Math.floor(n / 5), n % 5]]));
  return { version: 1, icons, spots: { ...spots, ...over }, ...(windows ?? defaults()), imported: false };
}
const LIST = [1, 2, 3].map(i => ({ pid: `c${i}-1`, tid: i, title: `Cart ${i}`, author: `by${i}`, thumb: `pico8_c${i}-1.png`, likes: i, updated: '2026-01-01' }));
// Records GET paths and POSTed bodies. slowAdd holds an add until finishAdd(); failAdd and failWindows make those ops fail;
// failGet fails the first failGets (1) desktop GETs with that reason; failCart fails every cart lookup with that message.
function fakeApi(opts = {}) {
  const server = desk(opts), paths = [], posted = [];
  let held = !!opts.slowAdd, release = null, getFails = opts.failGet ? opts.failGets ?? 1 : 0, last = server.icons.length;
  const api = async (path, body) => {
    if (body === undefined) paths.push(path); else posted.push(structuredClone(body));
    if (path === 'office/pc') {
      if (body === undefined && getFails > 0) { getFails--; throw new Error(opts.failGet); }
      if (body?.op === 'add') {
        if (held) await new Promise(r => { release = r; });
        if (opts.failAdd) throw new Error(opts.failAdd);
        const id = `i${++last}`;
        server.icons.push(body.kind === 'link' ? { id, kind: 'link', url: body.url, name: body.name } : { id, kind: 'cart', pid: body.pid, name: body.name ?? `Info ${body.pid}`, author: '', embed: true });
        server.spots[id] = [9, 4];
      }
      if (body?.op === 'rename') { const icon = server.icons.find(i => i.id === body.id); if (icon) icon.name = body.name; }
      if (body?.op === 'remove') { server.icons = server.icons.filter(i => i.id !== body.id); delete server.spots[body.id]; }
      if (body?.op === 'windows') { if (opts.failWindows) throw new Error(opts.failWindows); Object.assign(server, { windows: body.windows, order: body.order }); }
      if (body?.op === 'move') server.spots[body.id] = body.spot;
      return structuredClone(server);
    }
    if (path.startsWith('office/bbs/list')) return { carts: LIST, more: !!opts.more };
    if (path.startsWith('office/bbs/cart')) {
      if (opts.failCart !== undefined) throw new Error(opts.failCart);
      const q = new URLSearchParams(path.split('?')[1]), tid = q.get('tid'), pid = q.get('pid') ?? `t${tid}-1`;
      return { pid, title: tid ? `Thread ${tid}` : `Info ${pid}`, author: 'someone', thumb: thumbName(pid), embed: !pid.startsWith('blocked') };
    }
    throw new Error('Not found.');
  };
  return Object.assign(api, { paths, posted, finishAdd() { held = false; release?.(); } });
}
function fakeTimers(t) {
  const was = { set: globalThis.setTimeout, clear: globalThis.clearTimeout }, live = new Map();
  let at = 0, id = 0;
  globalThis.setTimeout = (fn, ms = 0) => { live.set(++id, { fn, due: at + ms }); return id; };
  globalThis.clearTimeout = n => { live.delete(n); };
  t.after(() => { globalThis.setTimeout = was.set; globalThis.clearTimeout = was.clear; });
  return {
    pending: () => live.size,
    delays: () => [...live.values()].map(x => x.due - at),
    run(ms) {
      at += ms;
      for (const [n, x] of [...live].sort((a, b) => a[1].due - b[1].due)) if (x.due <= at && live.has(n)) { live.delete(n); x.fn(); }
    },
  };
}
async function sat(t, opts = {}) {
  const doc = useDom(t), timers = fakeTimers(t), api = fakeApi(opts), opened = [];
  let stood = 0;
  const container = doc.createElement('div'); doc.body.append(container);
  const d = createDesktop(container, {
    onShutDown: () => { stood++; }, api, storage: memory(), online: () => true, now: () => NOW,
    reduced: () => opts.reduced ?? false, open: u => opened.push(u),
  });
  d.place(rect(0, 0, 1080, 640)); await tick();
  return { d, doc, timers, api, opened, stood: () => stood };
}

test('fitTransform maps the layout onto the projected screen', () => {
  assert.deepEqual(fitTransform([{ x: 100, y: 50 }, { x: 640, y: 50 }, { x: 640, y: 370 }, { x: 100, y: 370 }], 1080, 640), { a: 0.5, b: 0, c: 0, d: 0.5, e: 100, f: 50 });
});
test('the made-up carts are the same picture for the same seed and time, and move', () => {
  assert.deepEqual(fakeCart(3, 1.5), fakeCart(3, 1.5)); assert.notDeepEqual(fakeCart(3, 1.5), fakeCart(3, 2)); assert.notDeepEqual(fakeCart(2, 1.5), fakeCart(3, 1.5));
  assert.ok(fakeCart(2, 0).every(i => i < 16));
});
test('place follows the screen as it moves (a resize)', async t => {
  const { d } = await sat(t); d.place(rect(100, 50, 540, 320)); d.place(rect(10, 20, 1080, 640));
  assert.equal(d.root.style.transform, 'matrix(1, 0, 0, 1, 10, 20)'); assert.equal(d.root.hidden, false);
  d.hide(); assert.equal(d.root.hidden, true);
});
test('a drag goes through the inverse of the screen transform', async t => {
  const { d } = await sat(t); await openBrowser(d); d.place(rect(100, 50, 540, 320));
  const title = titleOf(d.root, 'Featured - Info Highway');
  pointer(title, 'pointerdown', { clientX: 200, clientY: 100 }); pointer(title, 'pointermove', { clientX: 220, clientY: 115 });
  assert.deepEqual([title.parent.style.left, title.parent.style.top], ['100px', '42px']);
});
test('keys stay in the desktop, but Esc goes on unless it closes the Start menu', async t => {
  const { d } = await sat(t);
  assert.equal(key(d.root, 'w').propagationStopped, true); assert.equal(key(d.root, 'Tab').propagationStopped, true);
  assert.equal(key(d.root, 'Escape').propagationStopped, false, 'Esc stands you up');
  click(startOf(d.root)); assert.equal(d.view().start, true);
  assert.equal(key(d.root, 'Escape').propagationStopped, true); assert.equal(d.view().start, false);
});
test('the Start menu opens and shuts over a playing cart without moving its frame (that reloads it)', async t => {
  const { d } = await sat(t); const frame = playing(d, { pid: 'a-1', title: 'A' }), parent = frame.parent;
  let moved = 0; const remove = frame.remove; frame.remove = () => { moved++; remove(); };
  click(startOf(d.root)); assert.equal(startMenuOf(d.root).hidden, false);
  key(d.root, 'Escape'); assert.equal(startMenuOf(d.root).hidden, true);
  assert.equal(moved, 0); assert.equal(iframeOf(d.root), frame); assert.equal(frame.parent, parent); assert.equal(frame.style.display, '');
});

test('front order changes only z-index, never a node or its parent', async t => {
  const { d } = await sat(t); const frame = playing(d, { pid: 'a-1', title: 'A' }); await openBrowser(d);
  const nodes = windowsOf(d.root), parents = nodes.map(n => n.parent);
  click(titleOf(d.root, 'Featured - Info Highway')); click(titleOf(d.root, 'A - PICO-8'));
  assert.deepEqual(windowsOf(d.root), nodes); assert.deepEqual(nodes.map(n => n.parent), parents);
  assert.equal(iframeOf(d.root), frame);
});
test('pausing: minimized or covered hides the same frame, and showing it again restores it', async t => {
  const { d } = await sat(t); const frame = playing(d, { pid: 'a-1', title: 'A' });
  click(button(d.root, 'A - PICO-8', '_')); assert.equal(frame.style.display, 'none');
  click(task(d.root, 'A - PICO-8')); assert.equal(frame.style.display, '');
  await openBrowser(d); assert.equal(frame.style.display, 'none', 'the default browser rect covers the frame');
  click(task(d.root, 'A - PICO-8')); assert.equal(frame.style.display, '', 'fronted');
  assert.equal(iframeOf(d.root), frame);
});
test('standing up mid-drag and mid-install leaves nothing running', async t => {
  const { d, doc, timers, api } = await sat(t, { slowAdd: true }); playing(d, { pid: 'a-1', title: 'A' }); await openBrowser(d);
  startDrag(titleOf(d.root, 'Featured - Info Highway')); install(d, { pid: 'c-1', title: 'C' });
  await tick(); assert.ok(api.posted.some(b => b.op === 'add'), 'the add is out');
  assert.ok(iframeOf(d.root), 'the cart is loaded, only covered');
  d.hide();
  assert.equal(d.root.hidden, true); assert.ok(!iframeOf(d.root), 'the cart is unloaded'); assert.equal(timers.pending(), 0);
  assert.equal(openDialogs(d.root), 0);
  api.finishAdd(); await tick(); await tick();
  assert.ok(d.view().icons.some(i => i.name === 'Info c-1'), 'the add still lands'); assert.equal(openDialogs(d.root), 0);
  assert.equal(doc.listenerCount(), 0);
});
test('a dialog waiting its turn answers null on standing up and is gone at the next sit-down', async t => {
  const { d } = await sat(t);
  const one = d.ui.dialog({ text: 'One' }), two = d.ui.dialog({ text: 'Two' });
  d.hide(); assert.deepEqual([await one, await two], [null, null]);
  d.place(rect(0, 0, 1080, 640)); await tick(); assert.equal(openDialogs(d.root), 0);
});
test('a failed first load says why in one dialog, shows the built-ins, and the next sit-down tries again', async t => {
  const { d, api } = await sat(t, { failGet: 'Server unreachable.', failGets: 2 }); await tick();
  assert.equal(openDialogs(d.root), 1); assert.equal(dialogText(d.root), 'Server unreachable.');
  assert.deepEqual(d.view().icons.map(i => i.id), ['browser', 'salaries']);
  click(dialogButton(d.root, 'OK'));
  dblclick(iconOf(d.root, 'salaries.txt')); await tick(); await tick(); // the save loads first, and fails again
  assert.equal(dialogText(d.root), 'Server unreachable.'); click(dialogButton(d.root, 'OK'));
  d.hide(); d.place(rect(0, 0, 1080, 640)); await tick(); await tick();
  assert.equal(api.paths.filter(p => p === 'office/pc').length, 3); assert.equal(openDialogs(d.root), 0);
  assert.equal(d.view().icons.length, 2 + STARTERS.length);
});

test('icons: the order, tips and arrows; a click selects; opening plays, browses or leaves', async t => {
  const extra = [{ id: 'i5', kind: 'cart', pid: 'blocked-1', name: 'Blocked', author: 'zed', embed: false }, { id: 'i6', kind: 'link', url: 'https://example.com/', name: 'Example' }];
  const { d, api } = await sat(t, { extra });
  assert.deepEqual(findAll(d.root, n => has(n, 'pc-icon-label')).map(n => n.textContent), ['Info Highway', 'salaries.txt', ...STARTERS.map(c => c.title), 'Blocked', 'Example']);
  const celeste = iconOf(d.root, STARTERS[0].title);
  assert.equal(celeste.attributes['data-tip'], STARTERS[0].author); assert.equal(iconOf(d.root, 'Example').attributes['data-tip'], 'https://example.com/');
  assert.equal(iconOf(d.root, 'Blocked').attributes['data-tip'], 'zed · plays only at lexaloffle.com');
  assert.equal(find(celeste, n => n.tag === 'img').attributes.src, '/api/office/bbs/thumb/' + thumbName(STARTERS[0].pid));
  assert.ok(find(celeste, n => has(n, 'pc-icon-arrow'))); assert.ok(find(iconOf(d.root, 'Example'), n => has(n, 'pc-icon-arrow')));
  assert.equal(find(iconOf(d.root, 'Info Highway'), n => has(n, 'pc-icon-arrow')), undefined);
  click(celeste); assert.ok(has(celeste, 'selected')); assert.equal(has(iconOf(d.root, 'Info Highway'), 'selected'), false);
  dblclick(iconOf(d.root, 'Blocked')); await tick();
  assert.equal(shown(titleOf(d.root, 'Info blocked-1 - Info Highway')), true, 'its game page'); assert.equal(iframeOf(d.root), undefined);
  assert.ok(api.paths.includes('office/bbs/cart?pid=blocked-1'));
  dblclick(iconOf(d.root, 'Example')); assert.ok(titleOf(d.root, 'Leaving - Info Highway'));
  dblclick(celeste); assert.equal(iframeOf(d.root).attributes.src, 'https://www.lexaloffle.com/bbs/widget.php?pid=' + STARTERS[0].pid);
});
test('icons: a tap opens (a double tap often sends no dblclick); a mouse click only selects', async t => {
  const { d } = await sat(t), pad = () => windowOf(d.root, 'salaries.txt - Notepad');
  click(iconOf(d.root, 'salaries.txt')); assert.equal(pad().hidden, true);
  click(iconOf(d.root, 'salaries.txt'), { pointerType: 'touch' }); assert.equal(pad().hidden, false);
});
test('icons: a drag snaps to a free cell, a taken cell puts it back; Arrange', async t => {
  const { d, api } = await sat(t), moves = () => api.posted.filter(b => b.op === 'move');
  const i1 = iconOf(d.root, STARTERS[0].title), i2 = iconOf(d.root, STARTERS[1].title);
  assert.deepEqual([i1.style.left, i1.style.top], ['38px', '232px']);
  pointer(i1, 'pointerdown', { clientX: 50, clientY: 250 }); pointer(i1, 'pointermove', { clientX: 372, clientY: 354 }); pointer(i1, 'pointerup', { clientX: 372, clientY: 354 });
  await tick(); assert.deepEqual(moves(), [{ op: 'move', id: 'i1', spot: [3, 3] }]);
  assert.deepEqual([i1.style.left, i1.style.top], [`${24 + 3 * 104 + 14}px`, `${24 + 3 * 104}px`]);
  pointer(i2, 'pointerdown', { clientX: 50, clientY: 350 }); pointer(i2, 'pointermove', { clientX: 154, clientY: 38 }); pointer(i2, 'pointerup', { clientX: 154, clientY: 38 });
  await tick(); assert.equal(moves().length, 1, 'onto i4'); assert.deepEqual([i2.style.left, i2.style.top], ['38px', '336px']);
  d.arrange(); await tick(); assert.deepEqual(api.posted.at(-1), { op: 'arrange' });
});
test('icons: a drop works beside an icon with no spot', async t => {
  const { d, api } = await sat(t, { spots: { i4: null } }), i1 = iconOf(d.root, STARTERS[0].title);
  pointer(i1, 'pointerdown', { clientX: 50, clientY: 250 }); pointer(i1, 'pointermove', { clientX: 372, clientY: 354 }); pointer(i1, 'pointerup', { clientX: 372, clientY: 354 });
  await tick(); assert.deepEqual(api.posted.filter(b => b.op === 'move'), [{ op: 'move', id: 'i1', spot: [3, 3] }]);
});
test('icons: a lost capture or a buttonless mouse move drops the icon where it was, once', async t => {
  const { d, api } = await sat(t), moves = () => api.posted.filter(b => b.op === 'move');
  const i1 = iconOf(d.root, STARTERS[0].title), i2 = iconOf(d.root, STARTERS[1].title);
  pointer(i1, 'pointerdown', { clientX: 50, clientY: 250 }); pointer(i1, 'pointermove', { clientX: 372, clientY: 354 }); i1.dispatch('lostpointercapture', { pointerId: 1 });
  pointer(i1, 'pointermove', { clientX: 600, clientY: 100 }); await tick();
  assert.deepEqual(moves(), [{ op: 'move', id: 'i1', spot: [3, 3] }]); assert.deepEqual([i1.style.left, i1.style.top], [`${24 + 3 * 104 + 14}px`, `${24 + 3 * 104}px`]);
  pointer(i2, 'pointerdown', { clientX: 50, clientY: 350 }); pointer(i2, 'pointermove', { clientX: 570, clientY: 38 }); pointer(i2, 'pointermove', { clientX: 700, clientY: 300, buttons: 0 });
  pointer(i2, 'pointermove', { clientX: 900, clientY: 400 }); await tick();
  assert.deepEqual(moves().slice(1), [{ op: 'move', id: 'i2', spot: [5, 0] }]); assert.deepEqual([i2.style.left, i2.style.top], [`${24 + 5 * 104 + 14}px`, '24px']);
});

test('full grid: no install and no add', async t => {
  const own = Array.from({ length: 48 }, (_, n) => ({ id: `i${n + 1}`, kind: 'cart', pid: `c${n}-1`, name: `C${n}`, author: '', embed: true }));
  const { d, api } = await sat(t, { own });
  install(d, { pid: 'new-1', title: 'New' }); await tick();
  assert.equal(dialogText(d.root), 'Not enough desktop space. Delete some icons first.'); assert.equal(api.posted.some(b => b.op === 'add'), false);
});
test('install: setup completes only after both the second and the add', async t => {
  const { d, timers, api } = await sat(t, { slowAdd: true });
  install(d, { pid: 'new-1', title: 'New' }); await tick();
  assert.equal(dialogText(d.root), 'Installing New…'); assert.ok(find(d.root, n => has(n, 'pc-setup-fill')));
  assert.deepEqual(api.posted.at(-1), { op: 'add', kind: 'cart', pid: 'new-1' });
  timers.run(1000); await tick(); assert.equal(dialogText(d.root), 'Installing New…', 'the add is still out');
  api.finishAdd(); await tick(); assert.equal(dialogText(d.root), 'Setup is complete.'); assert.equal(openDialogs(d.root), 1);
  assert.ok(iconOf(d.root, 'Info new-1'), 'on the desktop');
});
test('install: a fast add still waits for the second', async t => {
  const { d, timers } = await sat(t);
  install(d, { pid: 'new-1', title: 'New' }); await tick(); assert.equal(dialogText(d.root), 'Installing New…');
  timers.run(1000); await tick(); assert.equal(dialogText(d.root), 'Setup is complete.');
});
test('install: a failed add says why, in one dialog', async t => {
  const { d, timers } = await sat(t, { failAdd: 'Already on the desktop.' });
  install(d, { pid: 'new-1', title: 'New' }); await tick(); timers.run(1000); await tick();
  assert.equal(dialogText(d.root), 'Setup failed: Already on the desktop.');
  click(dialogButton(d.root, 'OK')); await tick(); assert.equal(openDialogs(d.root), 0);
});
test('a failed save says so', async t => {
  const { d } = await sat(t, { failWindows: 'Disk full.' }); await openBrowser(d); await tick();
  assert.equal(dialogText(d.root), 'Disk full.'); assert.equal(openDialogs(d.root), 1);
});

test('standing up and sitting down again: ▶ Play, never autoplay; the desktop loads once', async t => {
  const { d, api, doc } = await sat(t);
  assert.equal(doc.activeElement, iconOf(d.root, 'Info Highway'), 'the Info Highway icon is selected at sit-down');
  dblclick(iconOf(d.root, STARTERS[0].title)); assert.ok(iframeOf(d.root));
  d.hide(); d.place(rect(0, 0, 1080, 640)); await tick();
  assert.equal(iframeOf(d.root), undefined);
  const player = find(d.root, n => has(n, 'pc-player')), play = find(player, n => n.tag === 'button' && n.textContent === '▶ Play');
  assert.equal(find(player, n => n.tag === 'img').attributes.src, '/api/office/bbs/thumb/' + thumbName(STARTERS[0].pid)); assert.ok(play);
  assert.equal(api.paths.filter(p => p === 'office/pc').length, 1);
  assert.ok(has(iconOf(d.root, 'Info Highway'), 'selected'));
  click(play); assert.ok(iframeOf(d.root), '▶ Play plays');
});
test('the first sit-down applies the saved windows; a later one keeps the browser page', async t => {
  const windows = defaults(); windows.windows.browser = { open: true, mode: 'normal', x: 100, y: 12 }; windows.order = ['notepad', 'pico8', 'browser'];
  const { d, api } = await sat(t, { windows }); await tick();
  assert.equal(windowOf(d.root, 'Featured - Info Highway').style.left, '100px');
  click(find(d.root, n => n.tag === 'a' && n.textContent === 'Cart 1')); await tick();
  assert.ok(titleOf(d.root, 'Cart 1 - Info Highway'));
  d.hide(); d.place(rect(0, 0, 1080, 640)); await tick();
  assert.equal(shown(titleOf(d.root, 'Cart 1 - Info Highway')), true);
  assert.equal(api.paths.filter(p => p.startsWith('office/bbs/list')).length, 1); assert.equal(api.paths.filter(p => p === 'office/pc').length, 1);
});

test('window ops: a title drag saves once, on pointerup; min, max and close save one each', async t => {
  const { d, api } = await sat(t); await openBrowser(d); await tick();
  const ops = () => windowOps(api).length, n = ops(), name = 'Featured - Info Highway', title = titleOf(d.root, name), win = title.parent;
  startDrag(title); await tick(); assert.equal(ops(), n); assert.deepEqual([win.style.left, win.style.top], ['100px', '42px']);
  pointer(title, 'pointerup', { clientX: 40, clientY: 30 }); await tick(); assert.equal(ops(), n + 1);
  assert.deepEqual(windowOps(api).at(-1).windows.browser, { open: true, mode: 'normal', x: 100, y: 42 });
  click(button(d.root, name, '_')); await tick(); assert.equal(ops(), n + 2); assert.equal(win.hidden, true);
  click(task(d.root, name)); await tick(); assert.equal(ops(), n + 3); assert.equal(win.hidden, false);
  click(button(d.root, name, '□')); await tick(); assert.equal(ops(), n + 4); assert.equal(win.style.width, '1080px');
  click(button(d.root, name, '×')); await tick(); assert.equal(ops(), n + 5); assert.equal(win.hidden, true);
  assert.equal(findAll(d.root, n => has(n, 'pc-task') && shown(n)).length, 0);
});
test('a cancelled title drag goes back and saves nothing', async t => {
  const { d, api } = await sat(t); await openBrowser(d); await tick();
  const n = windowOps(api).length, title = titleOf(d.root, 'Featured - Info Highway');
  startDrag(title); pointer(title, 'pointercancel'); await tick();
  assert.deepEqual([title.parent.style.left, title.parent.style.top], ['60px', '12px']); assert.equal(windowOps(api).length, n);
});
test('a lost capture or a buttonless mouse move ends a title drag where it is, with one save', async t => {
  const { d, api } = await sat(t); await openBrowser(d); await tick();
  const title = titleOf(d.root, 'Featured - Info Highway'), win = title.parent, n = windowOps(api).length, at = () => [win.style.left, win.style.top];
  startDrag(title); title.dispatch('lostpointercapture', { pointerId: 1 }); pointer(title, 'pointermove', { clientX: 200, clientY: 200 }); await tick();
  assert.deepEqual(at(), ['100px', '42px']); assert.equal(windowOps(api).length, n + 1); assert.deepEqual(windowOps(api).at(-1).windows.browser, { open: true, mode: 'normal', x: 100, y: 42 });
  startDrag(title); pointer(title, 'pointermove', { clientX: 80, clientY: 60, buttons: 0 }); pointer(title, 'pointermove', { clientX: 200, clientY: 200 }); await tick();
  assert.deepEqual(at(), ['140px', '72px']); assert.equal(windowOps(api).length, n + 2); assert.deepEqual(windowOps(api).at(-1).windows.browser, { open: true, mode: 'normal', x: 140, y: 72 });
});
test('two taps that wobble 2 px still maximize, and save no move', async t => {
  const { d, api } = await sat(t); await openBrowser(d); await tick();
  const title = titleOf(d.root, 'Featured - Info Highway'), n = windowOps(api).length, touch = { pointerType: 'touch' };
  click(title, touch);
  pointer(title, 'pointerdown', touch); pointer(title, 'pointermove', { ...touch, clientX: 2 }); pointer(title, 'pointerup', { ...touch, clientX: 2 }); await tick();
  assert.equal(title.parent.style.width, '1080px');
  assert.deepEqual(windowOps(api).slice(n).map(o => o.windows.browser), [{ open: true, mode: 'max', x: 60, y: 12 }]);
});
test('_ and × on a window behind send one op each', async t => {
  const { d, api } = await sat(t); await openBrowser(d); playing(d, { pid: 'a-1', title: 'A' }); await tick();
  const name = 'Featured - Info Highway', ops = () => windowOps(api).length;
  let n = ops(); click(button(d.root, name, '_')); await tick();
  assert.equal(ops(), n + 1); assert.equal(windowOps(api).at(-1).windows.browser.mode, 'min');
  click(task(d.root, name)); click(titleOf(d.root, 'A - PICO-8')); await tick(); assert.equal(has(windowOf(d.root, name), 'front'), false);
  n = ops(); click(button(d.root, name, '×')); await tick();
  assert.equal(ops(), n + 1); assert.equal(windowOps(api).at(-1).windows.browser.open, false);
});
test('□ on a window behind fronts and maximizes it in one op', async t => {
  const { d, api } = await sat(t); await openBrowser(d); playing(d, { pid: 'a-1', title: 'A' }); await tick();
  const name = 'Featured - Info Highway', n = windowOps(api).length;
  click(button(d.root, name, '□')); await tick();
  const ops = windowOps(api).slice(n); assert.equal(ops.length, 1);
  assert.equal(ops[0].windows.browser.mode, 'max'); assert.equal(ops[0].order.at(-1), 'browser');
});
test('a window dragged over PICO-8 pauses the game, and dragged off resumes it', async t => {
  const { d } = await sat(t); const frame = playing(d, { pid: 'a-1', title: 'A' });
  dblclick(iconOf(d.root, 'salaries.txt')); assert.equal(frame.style.display, '', 'Notepad covers only part of it');
  const title = titleOf(d.root, 'salaries.txt - Notepad');
  pointer(title, 'pointerdown', { clientX: 400, clientY: 100 }); pointer(title, 'pointermove', { clientX: 900, clientY: 100 }); pointer(title, 'pointerup', { clientX: 900, clientY: 100 });
  playing(d, { pid: 'a-1', title: 'A' }); await openBrowser(d); assert.equal(frame.style.display, 'none', 'the browser covers it');
  const b = titleOf(d.root, 'Featured - Info Highway');
  pointer(b, 'pointerdown', { clientX: 300, clientY: 20 }); pointer(b, 'pointermove', { clientX: 900, clientY: 20 }); assert.equal(frame.style.display, '', 'dragged off');
  pointer(b, 'pointermove', { clientX: 300, clientY: 20 }); assert.equal(frame.style.display, 'none', 'dragged back over');
  pointer(b, 'pointermove', { clientX: 300, clientY: 400 }); pointer(b, 'pointerup', { clientX: 300, clientY: 400 }); assert.equal(frame.style.display, '', 'dragged down off it');
  assert.equal(iframeOf(d.root), frame);
});
test('maximize: a title double-click or two taps toggle the browser; PICO-8 never maximizes', async t => {
  const { d, api } = await sat(t); await openBrowser(d);
  const title = titleOf(d.root, 'Featured - Info Highway'), win = title.parent;
  dblclick(title); assert.deepEqual([win.style.left, win.style.top, win.style.width, win.style.height], ['0px', '0px', '1080px', '596px']);
  assert.ok(button(d.root, 'Featured - Info Highway', '❐'));
  startDrag(title); pointer(title, 'pointerup'); assert.equal(win.style.left, '0px', 'a maximized window does not drag');
  dblclick(title); assert.equal(win.style.width, '900px');
  click(title, { pointerType: 'touch' }); click(title, { pointerType: 'touch' }); assert.equal(win.style.width, '1080px');
  click(title, { pointerType: 'touch' }); click(title, { pointerType: 'touch' }); assert.equal(win.style.width, '900px');
  playing(d, { pid: 'a-1', title: 'A' }); const max = button(d.root, 'A - PICO-8', '□');
  assert.equal(max.disabled, true); assert.equal(max.getAttribute('disabled'), '');
  await tick(); const pico = titleOf(d.root, 'A - PICO-8'), n = windowOps(api).length;
  dblclick(pico); assert.equal(pico.parent.style.width, '532px'); await tick(); assert.equal(windowOps(api).length, n);
});
test('playing saves the cart: an icon opens and fronts PICO-8, with one windows op', async t => {
  const { d, api } = await sat(t); await openBrowser(d); await tick(); const n = windowOps(api).length;
  dblclick(iconOf(d.root, STARTERS[1].title)); await tick();
  const ops = windowOps(api).slice(n); assert.equal(ops.length, 1);
  assert.deepEqual(ops[0].windows.pico8.cart, { pid: STARTERS[1].pid, title: STARTERS[1].title }); assert.equal(ops[0].order.at(-1), 'pico8');
  assert.ok(has(windowOf(d.root, `${STARTERS[1].title} - PICO-8`), 'front'));
});
test('closing PICO-8 stops the game', async t => {
  const { d } = await sat(t); playing(d, { pid: 'a-1', title: 'A' });
  click(button(d.root, 'A - PICO-8', '×')); assert.equal(iframeOf(d.root), undefined); assert.equal(windowOf(d.root, 'A - PICO-8').hidden, true);
});

test('reduced motion: no zoom outlines, no sliding Start, and a setup bar full at once', async t => {
  const { d } = await sat(t, { reduced: true }); playing(d, { pid: 'a-1', title: 'A' });
  click(button(d.root, 'A - PICO-8', '_')); assert.equal(zoomsOf(d.root).length, 0);
  click(startOf(d.root)); assert.equal(has(startMenuOf(d.root), 'pc-slide'), false); key(d.root, 'Escape');
  install(d, { pid: 'new-1', title: 'New' }); const fill = find(d.root, n => has(n, 'pc-setup-fill'));
  assert.deepEqual([fill.style.width, fill.style.animation], ['100%', 'none']);
});
test('motion: three zoom outlines, gone on animationend; Start slides', async t => {
  const { d } = await sat(t); playing(d, { pid: 'a-1', title: 'A' });
  click(button(d.root, 'A - PICO-8', '_')); const zooms = zoomsOf(d.root);
  assert.deepEqual(zooms.map(z => z.style.animationDelay), ['0ms', '50ms', '100ms']);
  for (const z of zooms) z.dispatch('animationend');
  assert.equal(zoomsOf(d.root).length, 0);
  click(startOf(d.root)); assert.ok(has(startMenuOf(d.root), 'pc-slide'));
});

test('salaries.txt follows the office only while it can be seen', async t => {
  const { d } = await sat(t); dblclick(iconOf(d.root, 'salaries.txt'));
  const pad = find(d.root, n => has(n, 'pc-notepad')); assert.match(pad.value, /Everyone fired/);
  d.agents([SESSION]); assert.doesNotMatch(pad.value, /Everyone fired/); const one = pad.value;
  click(button(d.root, 'salaries.txt - Notepad', '_')); d.agents([SESSION, OTHER]); assert.equal(pad.value, one, 'minimized');
  click(task(d.root, 'salaries.txt - Notepad')); assert.equal(pad.value.split('\n').length, one.split('\n').length + 1, 'rebuilt when shown');
  const two = pad.value; await openBrowser(d); d.agents([SESSION]); assert.equal(pad.value, two, 'covered');
});
test('clock: one timeout to the next minute while seated, none once standing', async t => {
  const { d, timers } = await sat(t);
  assert.equal(textOf(find(d.root, n => has(n, 'pc-clock'))), '14:32'); assert.deepEqual(timers.delays(), [50_000]);
  timers.run(50_000); assert.equal(timers.pending(), 1, 'armed again');
  d.hide(); assert.equal(timers.pending(), 0);
});

test('dialogs: one at a time; Enter presses the default; Esc gives null', async t => {
  const { d } = await sat(t);
  const first = d.ui.dialog({ icon: 'question', text: 'One?', buttons: ['Yes', 'No'], initial: 1 }), second = d.ui.dialog({ icon: 'info', text: 'Two', buttons: ['OK'] });
  assert.equal(openDialogs(d.root), 1); assert.equal(dialogText(d.root), 'One?');
  assert.equal(key(d.root, 'Enter').defaultPrevented, true); assert.equal(await first, 'No');
  assert.equal(dialogText(d.root), 'Two'); assert.equal(key(d.root, 'Escape').propagationStopped, true); assert.equal(await second, null);
  assert.equal(openDialogs(d.root), 0);
});
test('focus: back where it was when the last dialog or a menu closes, else the desktop; never left on a hidden window', async t => {
  const { d, doc } = await sat(t), icon = iconOf(d.root, 'Info Highway'), on = n => doc.activeElement === n; // not equal(): a node diff prints the whole tree
  assert.equal(d.root.tabIndex, -1); assert.ok(on(icon));
  const one = d.ui.dialog({ text: 'One' }), two = d.ui.dialog({ text: 'Two' });
  click(dialogButton(d.root, 'OK')); assert.ok(on(dialogButton(d.root, 'OK')), 'the next one has it');
  click(dialogButton(d.root, 'OK')); await one; await two; assert.ok(on(icon), 'after the last dialog');
  d.ui.menu([{ label: '&Open', run() {} }], { x: 0, y: 0 }); click(menuItem(d.root, 'Open')); assert.ok(on(icon), 'after a menu');
  doc.body.focus(); const three = d.ui.dialog({ text: 'Three' }); click(dialogButton(d.root, 'OK')); await three;
  assert.ok(on(d.root), 'it came from outside the desktop');
  dblclick(iconOf(d.root, 'salaries.txt')); const pad = find(d.root, n => has(n, 'pc-notepad')); pad.focus();
  click(button(d.root, 'salaries.txt - Notepad', '×')); assert.ok(on(d.root), 'not on the closed Notepad');
});
test('menus: & marks the letter, - separates, disabled does nothing; a menu bar opens its menu', async t => {
  const { d } = await sat(t); const ran = [];
  d.ui.menu([{ label: '&Open', run: () => ran.push('open') }, '-', { label: 'Re&name', disabled: true, run: () => ran.push('rename') }], { x: 10, y: 10 });
  assert.equal(openMenus(d.root), 1); assert.ok(find(d.root, n => has(n, 'pc-menu-sep')));
  const open = menuItem(d.root, 'Open'), rename = menuItem(d.root, 'Rename');
  assert.equal(find(open, n => n.tag === 'u').textContent, 'O'); assert.equal(find(rename, n => n.tag === 'u').textContent, 'n');
  assert.equal(rename.getAttribute('aria-disabled'), 'true'); click(rename); assert.deepEqual(ran, []);
  click(open); assert.deepEqual(ran, ['open']); assert.equal(openMenus(d.root), 0);
  dblclick(iconOf(d.root, 'salaries.txt')); click(menuItem(d.root, 'File')); assert.equal(openMenus(d.root), 1);
  click(menuItem(d.root, 'Save')); await tick(); assert.equal(dialogText(d.root), 'Access is denied. Only HR may change salaries.');
});
test('Start: Programs and Documents open windows; Shut down… stands you up', async t => {
  const { d, stood } = await sat(t); const start = startOf(d.root);
  click(start); assert.ok(has(start, 'pressed')); assert.ok(find(startMenuOf(d.root), n => n.textContent === 'Boss 98'));
  click(menuItem(d.root, 'Programs ▸')); click(menuItem(d.root, 'Notepad'));
  assert.equal(d.view().start, false); assert.equal(windowOf(d.root, 'salaries.txt - Notepad').hidden, false);
  click(start); click(menuItem(d.root, 'Programs ▸')); click(menuItem(d.root, 'Info Highway')); await tick();
  assert.equal(windowOf(d.root, 'Featured - Info Highway').hidden, false);
  click(start); click(menuItem(d.root, 'Documents ▸')); assert.ok(menuItem(d.root, 'salaries.txt'));
  click(menuItem(d.root, 'Shut down…')); assert.equal(stood(), 1); assert.equal(d.view().start, false); assert.equal(openMenus(d.root), 0);
});
test('view and version: what the monitor draws', async t => {
  const { d } = await sat(t); const v = d.view();
  assert.deepEqual(v.icons[0], { id: 'browser', name: 'Info Highway', kind: 'browser', spot: [0, 0], thumb: null, selected: true });
  assert.deepEqual(v.icons[1], { id: 'salaries', name: 'salaries.txt', kind: 'salaries', spot: [0, 1], thumb: null, selected: false });
  assert.deepEqual(v.icons[2], { id: 'i1', name: STARTERS[0].title, kind: 'cart', spot: [0, 2], thumb: thumbName(STARTERS[0].pid), selected: false });
  assert.deepEqual([v.windows, v.tasks, v.start], [[], [], false]);
  let at = d.version(); click(startOf(d.root)); assert.ok(d.version() > at); assert.equal(d.view().start, true);
  key(d.root, 'Escape'); at = d.version(); playing(d, { pid: 'a-1', title: 'A' }); assert.ok(d.version() > at);
  assert.deepEqual(d.view().windows, [{ name: 'pico8', title: 'A - PICO-8', rect: { x: 274, y: 21, w: 532, h: 554 }, front: true, mode: 'normal', state: { cart: { pid: 'a-1', title: 'A' } } }]);
  assert.deepEqual(d.view().tasks, [{ name: 'pico8', title: 'A - PICO-8', pressed: true }]);
  at = d.version(); await openBrowser(d); assert.ok(d.version() > at);
  const b = d.view().windows.at(-1); assert.equal(b.name, 'browser'); assert.equal(b.front, true); assert.equal(b.state.page.kind, 'list'); assert.equal(b.state.page.carts.length, 3);
  assert.equal(d.state, undefined, 'the monitor draws view()');
});
// A stand-in Image that lists what's made; on.load() is its load.
function images(t) {
  const made = [], was = globalThis.Image;
  globalThis.Image = class { constructor() { made.push(this); this.on = {}; } addEventListener(type, fn) { this.on[type] = fn; } };
  t.after(() => { if (was) globalThis.Image = was; else delete globalThis.Image; });
  return made;
}
const canvas = () => new Proxy({}, { get: (o, k) => k in o ? o[k] : () => ({ addColorStop() {} }), set: (o, k, v) => { o[k] = v; return true; } });
test('images are only asked for by a draw: none while seated, each once standing, and each load is a change', async t => {
  const made = images(t), { d } = await sat(t), url = '/api/office/bbs/thumb/';
  playing(d, { pid: 'a-1', title: 'A' }); await openBrowser(d); d.view();
  assert.equal(d.image(thumbName('a-1')), null); assert.equal(made.length, 0, 'seated: the desktop shows its own');
  d.hide();
  const draw = () => drawDesktop(canvas(), d.view(), { clock: '14:32', image: d.image });
  draw(); const asked = made.map(i => i.src);
  assert.ok(asked.includes(url + thumbName('a-1')), "the stopped game's"); assert.ok(asked.includes(url + thumbName(STARTERS[0].pid)), "an icon's");
  assert.equal(new Set(asked).size, asked.length, 'one each');
  draw(); assert.equal(made.length, asked.length, 'drawn again: the same images');
  const v = d.version(), [first, second] = made;
  first.on.load(); second.on.load(); assert.equal(d.version(), v + 2, 'each load is a change');
  assert.equal(d.image(first.src.slice(url.length)), first, 'loaded: drawn');
  assert.equal(d.image(made.at(-1).src.slice(url.length)), null, 'not loaded yet: the icon instead');
});
// The monitor draws each window's menubar from MENUS: the window's own menus() without their & keys, and none without menus().
test("the monitor's menubars are the windows' own menus", t => {
  const doc = useDom(t), labels = mod => mod.menus?.().map(m => m.label.replace('&', ''));
  const mods = {
    pico8: createPlayer({ doc, online: () => true }),
    browser: createBrowser({ doc, api: async () => ({}), ui: {}, installed: () => false, onPlay() {}, onInstall() {}, open() {} }),
    notepad: createNotepad({ doc, ui: {} }),
  };
  assert.deepEqual(Object.keys(mods), NAMES, 'every window'); assert.ok(Object.keys(MENUS).every(n => NAMES.includes(n)));
  for (const n of NAMES) assert.deepEqual(MENUS[n], labels(mods[n]), n);
  assert.equal(MENUS.pico8, undefined, 'PICO-8 has no menus()');
});
// One draw's asks all fit in the thumbnail cache, so none puts out another the same draw needs: a cart in every grid cell, the
// most Info Highway shows of a long list (as it is and maximised) and the stopped game.
test('the thumbnail cache holds more than one draw can ask for', () => {
  const icons = [], carts = Array.from({ length: 500 }, (_, i) => ({ pid: `b-${i}` }));
  for (let col = 0; col < GRID.cols; col++) for (let row = 0; row < GRID.rows; row++) icons.push({ id: `${col}-${row}`, name: 'Cart', kind: 'cart', spot: [col, row], thumb: thumbName(`c-${col}${row}`), selected: false });
  for (const mode of ['normal', 'max']) {
    const s = defaults(), asked = new Set(); s.windows.browser.mode = mode;
    const win = (name, state) => ({ name, title: name, rect: rectOf(s, name), front: name === 'browser', mode: s.windows[name].mode, state });
    const view = { icons, windows: [win('pico8', { cart: { pid: 'g-1', title: 'G' } }), win('browser', { page: { kind: 'list', carts } })], tasks: [], start: false };
    drawDesktop(canvas(), view, { clock: '14:32', image: n => { asked.add(n); return null; } });
    assert.ok(asked.size > GRID.cols * GRID.rows + 1, `${mode}: every icon, the game and a page`);
    assert.ok(THUMBS > asked.size, `${mode}: ${asked.size} asked, ${THUMBS} kept`);
  }
});

// Keys, menus and the legend (Task 12).
test('legendFor: a line per context; the browser gives its own', () => {
  assert.equal(legendFor('desktop'), '←→↑↓ Move   Enter Open   M Menu   Esc Stand up');
  assert.equal(legendFor('menu'), '←→↑↓ Move   Enter Choose   Esc Close');
  assert.equal(legendFor('dialog'), 'Enter OK   Esc Cancel');
  assert.equal(legendFor('pico8'), 'Enter/Z Play   Tab Next   Esc Stand up');
  assert.equal(legendFor('notepad'), 'Tab Next   Esc Stand up');
  assert.equal(legendFor('browser'), '');
});
test('Esc closes the menu, then the dialog, then stands you up', async t => {
  const { d } = await sat(t);
  selectIcon(d, 'browser'); key(d.root, 'm'); assert.equal(openMenus(d.root), 1);
  key(d.root, 'd'); assert.equal(openDialogs(d.root), 0, 'built-in: Delete is disabled');
  assert.equal(key(d.root, 'Escape').propagationStopped, true); assert.equal(openMenus(d.root), 0);
  selectIcon(d, 'i1'); key(d.root, 'm'); key(d.root, 'd');
  assert.equal(openMenus(d.root), 0); assert.equal(dialogText(d.root), "Are you sure you want to delete 'Celeste Classic 2'?");
  assert.equal(key(d.root, 'Escape').propagationStopped, true); assert.equal(openDialogs(d.root), 0);
  assert.equal(key(d.root, 'Escape').propagationStopped, false, 'the office stands you up');
});
test('text fields keep letters; Tab, Enter and Esc still work', async t => {
  const { d, api } = await sat(t); await openBrowser(d); const box = searchBox(d.root); box.focus();
  for (const k of ['z', 'x', 'm', 's', 'Backspace']) assert.equal(key(box, k).defaultPrevented, false, k);
  box.value = 'snake'; key(box, 'Enter'); await tick(); assert.ok(api.paths.includes('office/bbs/list?q=snake&page=1'));
});
test('the legend follows the selection and gives way to the status on a click', async t => {
  const { d } = await sat(t); key(d.root, 'ArrowRight');
  assert.equal(legendText(d.root), '←→↑↓ Move   Enter Open   M Menu   Esc Stand up');
  d.root.dispatch('pointerdown', { pointerType: 'mouse' }); assert.equal(legendText(d.root), '');
});
test('desktop arrows and Enter', async t => {
  const { d, doc } = await sat(t); assert.equal(selectedId(d), 'browser');
  key(d.root, 'ArrowDown'); assert.equal(selectedId(d), 'salaries'); assert.ok(doc.activeElement === iconOf(d.root, 'salaries.txt'));
  key(d.root, 'ArrowRight'); assert.equal(selectedId(d), 'i4', 'the nearest one that way');
  key(d.root, 'ArrowLeft'); key(d.root, 'ArrowUp'); assert.equal(selectedId(d), 'browser', 'nothing above: it stays');
  key(d.root, 'ArrowDown'); key(d.root, 'm'); assert.equal(legendText(d.root), legendFor('menu')); key(d.root, 'Escape');
  assert.equal(key(d.root, 'Enter').defaultPrevented, true); assert.equal(windowOf(d.root, 'salaries.txt - Notepad').hidden, false);
});
test('desktop Tab: the icons, then Start, then the task buttons, round again', async t => {
  const { d, doc } = await sat(t); playing(d, { pid: 'a-1', title: 'A' }); click(layerOf(d.root));
  const on = n => doc.activeElement === n, tab = (shiftKey = false) => key(d.root, 'Tab', { shiftKey });
  tab(); assert.ok(on(iconOf(d.root, 'Info Highway'))); assert.equal(selectedId(d), 'browser');
  for (let i = 0; i < 5; i++) tab();
  assert.ok(on(iconOf(d.root, STARTERS[3].title))); assert.equal(selectedId(d), 'i4');
  tab(); assert.ok(on(startOf(d.root))); tab(); assert.ok(on(task(d.root, 'A - PICO-8')));
  tab(); assert.ok(on(iconOf(d.root, 'Info Highway'))); tab(true); assert.ok(on(task(d.root, 'A - PICO-8')));
  assert.equal(key(d.root, 'Enter').defaultPrevented, true); assert.equal(windowOf(d.root, 'A - PICO-8').hidden, true, 'its task minimizes it');
});
test('Start by keys: Enter opens it, → opens a submenu, ← shuts it, letters pick', async t => {
  const { d, doc } = await sat(t);
  startOf(d.root).focus(); key(d.root, 'Enter'); assert.equal(d.view().start, true); assert.equal(legendText(d.root), legendFor('menu'));
  key(d.root, 'ArrowRight'); assert.deepEqual(menuItems(d.root).map(([text]) => text), ['Info Highway', 'Notepad']);
  key(d.root, 'ArrowLeft'); assert.equal(openMenus(d.root), 0);
  key(d.root, 'ArrowDown'); assert.ok(doc.activeElement === menuItem(d.root, 'Documents ▸'));
  key(d.root, 'p'); key(d.root, 'n'); assert.equal(d.view().start, false); assert.equal(windowOf(d.root, 'salaries.txt - Notepad').hidden, false);
  assert.equal(legendText(d.root), legendFor('notepad'));
});
test('menu bar by keyboard: Tab reaches File, Enter opens it, → moves to Go, Esc closes it', async t => {
  const { d, doc } = await sat(t); await openBrowser(d);
  const file = menuItem(d.root, 'File'), go = menuItem(d.root, 'Go'), texts = () => menuItems(d.root).map(([text]) => text);
  key(d.root, 'Tab'); assert.ok(doc.activeElement === file);
  assert.equal(key(d.root, 'Enter').defaultPrevented, true); assert.ok(texts().includes('Install'));
  key(d.root, 'ArrowRight'); assert.equal(openMenus(d.root), 1); assert.ok(texts().includes('Back'));
  key(d.root, 'Escape'); assert.equal(openMenus(d.root), 0); assert.ok(doc.activeElement === go);
  key(d.root, 'ArrowDown'); assert.ok(texts().includes('Back'), '↓ opens it too');
});
test('Z plays, X goes back', async t => {
  const { d } = await sat(t); await openBrowser(d);
  key(d.root, 'ArrowRight'); key(d.root, 'z'); await tick(); await tick();
  assert.equal(iframeOf(d.root).attributes.src, 'https://www.lexaloffle.com/bbs/widget.php?pid=c1-1'); assert.ok(titleOf(d.root, 'Cart 1 - PICO-8'));
  click(task(d.root, 'Featured - Info Highway')); click(find(d.root, n => n.tag === 'a' && n.textContent === 'Cart 2')); await tick();
  assert.ok(titleOf(d.root, 'Cart 2 - Info Highway'));
  assert.equal(key(d.root, 'x').defaultPrevented, true); assert.ok(titleOf(d.root, 'Featured - Info Highway'));
});
test('M then I installs', async t => {
  const { d, api } = await sat(t); await openBrowser(d);
  key(d.root, 'ArrowRight'); assert.equal(legendText(d.root), '', 'the browser shows its own');
  assert.match(textOf(find(d.root, n => has(n, 'pc-status'))), /Enter\/Z Play/);
  key(d.root, 'm'); assert.equal(openMenus(d.root), 1);
  key(d.root, 'i'); assert.equal(dialogText(d.root), 'Installing Cart 1…'); await tick();
  assert.deepEqual(api.posted.filter(b => b.op === 'add'), [{ op: 'add', kind: 'cart', pid: 'c1-1' }]);
});
test('S and Ctrl+F search; on a game page S selects the address', async t => {
  const { d, doc } = await sat(t); await openBrowser(d);
  key(d.root, 's'); assert.ok(doc.activeElement === searchBox(d.root));
  d.root.focus(); assert.equal(key(d.root, 'f', { ctrlKey: true }).defaultPrevented, true); assert.ok(doc.activeElement === searchBox(d.root));
  click(find(d.root, n => n.tag === 'a' && n.textContent === 'Cart 2')); await tick();
  key(d.root, 's'); const field = find(d.root, n => has(n, 'pc-field') && has(n, 'address'));
  assert.ok(doc.activeElement === field); assert.ok(field.value.length > 0); assert.deepEqual([field.selectionStart, field.selectionEnd], [0, field.value.length]);
});
test('Tab wraps round the front window; Shift+Tab goes back; Tab leaves a field', async t => {
  const { d, doc } = await sat(t); await openBrowser(d);
  const cart3 = find(d.root, n => n.tag === 'a' && n.textContent === 'Cart 3'); cart3.focus();
  assert.equal(key(d.root, 'Tab').defaultPrevented, true); assert.ok(doc.activeElement === menuItem(d.root, 'File'));
  key(d.root, 'Tab', { shiftKey: true }); assert.ok(doc.activeElement === cart3);
  const box = searchBox(d.root); box.focus(); key(box, 'Tab');
  assert.ok(doc.activeElement === find(d.root, n => n.tag === 'button' && n.textContent === 'Search'));
});
test('Tab walks the page down to Next and back, scrolling the page to show each (a whole card), and nothing outside the window', async t => {
  const { d, doc } = await sat(t, { more: true }); await openBrowser(d);
  const page = find(d.root, n => has(n, 'pc-page')), link = text => find(d.root, n => n.tag === 'a' && n.textContent === text);
  const card = text => find(d.root, n => has(n, 'pc-card') && n.contains(link(text)));
  const next = find(d.root, n => n.tag === 'button' && n.textContent === 'Next »');
  // Layout as a browser has it: the page shows 400px of 2000, Cart 1's card at its top, Cart 2's midway, Cart 3's and Next
  // far down. The links themselves aren't measured: what's shown is a link's card.
  Object.assign(page, { offsetTop: 60, offsetParent: null, clientTop: 0, clientHeight: 400, scrollHeight: 2000, scrollTop: 0 });
  [[card('Cart 1'), 100, 180], [card('Cart 2'), 800, 180], [card('Cart 3'), 1600, 180], [next, 1900, 20]].forEach(([n, y, h]) => Object.assign(n, { offsetParent: page, offsetTop: y, offsetHeight: h }));
  Object.assign(d.root, { clientHeight: 640, scrollHeight: 4000, scrollTop: 0 });
  link('Cart 3').focus(); key(d.root, 'Tab');
  assert.ok(doc.activeElement === next); assert.equal(page.scrollTop, 1520);
  key(d.root, 'Tab', { shiftKey: true }); assert.equal(page.scrollTop, 1520, "Cart 3's card is in view: nothing scrolls");
  key(d.root, 'Tab', { shiftKey: true }); assert.ok(doc.activeElement === link('Cart 2')); assert.equal(page.scrollTop, 800);
  key(d.root, 'Tab', { shiftKey: true }); assert.equal(page.scrollTop, 100);
  assert.equal(d.root.scrollTop, 0);
});
test('context menus per target: an icon, the bare desktop, a browser card; right-click and a long press', async t => {
  const { d, timers } = await sat(t), layer = layerOf(d.root), touch = { pointerType: 'touch' };
  iconOf(d.root, 'Info Highway').dispatch('contextmenu', { clientX: 60, clientY: 60 });
  assert.deepEqual(menuItems(d.root), [['Open', false], ['Rename', true], ['Delete', true]]);
  iconOf(d.root, STARTERS[0].title).dispatch('contextmenu');
  assert.deepEqual(menuItems(d.root), [['Open', false], ['Rename', false], ['Delete', false]]); assert.equal(selectedId(d), 'i1');
  assert.equal(layer.dispatch('contextmenu', { clientX: 500, clientY: 300 }).defaultPrevented, true);
  assert.deepEqual(menuItems(d.root), [['New shortcut…', false], ['Arrange icons', false]]); key(d.root, 'Escape');
  await openBrowser(d); key(d.root, 'ArrowRight'); key(d.root, 'm');
  const browserItems = [['Play', false], ['Install', false], ['Open in new tab ↗', false]];
  assert.deepEqual(menuItems(d.root), browserItems); key(d.root, 'Escape');
  find(d.root, n => has(n, 'pc-card')).dispatch('contextmenu'); assert.deepEqual(menuItems(d.root), browserItems); key(d.root, 'Escape');
  assert.equal(openMenus(d.root), 0);
  const i2 = iconOf(d.root, STARTERS[1].title);
  pointer(i2, 'pointerdown', touch); timers.run(499); assert.equal(openMenus(d.root), 0);
  timers.run(1); assert.deepEqual(menuItems(d.root).map(([text]) => text), ['Open', 'Rename', 'Delete']);
  pointer(i2, 'pointerup', touch); assert.equal(iframeOf(d.root), undefined, 'letting go opens nothing'); key(d.root, 'Escape');
  pointer(layer, 'pointerdown', touch); pointer(layer, 'pointermove', { ...touch, clientX: 6, clientY: 6 }); timers.run(500);
  assert.equal(openMenus(d.root), 0, 'moved 8.5 px'); pointer(layer, 'pointerup', touch);
  pointer(layer, 'pointerdown', touch); pointer(layer, 'pointerup', touch); timers.run(500); assert.equal(openMenus(d.root), 0, 'let go');
  pointer(layer, 'pointerdown', touch); pointer(layer, 'pointercancel', touch); timers.run(500); assert.equal(openMenus(d.root), 0, 'cancelled');
  pointer(layer, 'pointerdown', touch); pointer(layer, 'pointermove', { ...touch, clientX: 5 }); timers.run(500);
  assert.equal(openMenus(d.root), 1, 'a 5 px wobble still holds'); key(d.root, 'Escape'); pointer(layer, 'pointerup', touch);
  assert.equal(timers.pending(), 1, 'only the clock');
  pointer(layer, 'pointerdown', touch); d.hide(); assert.equal(timers.pending(), 0, 'standing up clears it');
});
test('rename in place: Enter sends rename, Esc sends nothing, a press elsewhere commits', async t => {
  const { d, doc, api } = await sat(t), field = () => find(d.root, n => has(n, 'pc-rename')), renames = () => api.posted.filter(b => b.op === 'rename');
  selectIcon(d, 'i1'); key(d.root, 'm'); key(d.root, 'r');
  assert.ok(doc.activeElement === field()); assert.equal(field().value, STARTERS[0].title);
  assert.equal(find(iconOf(d.root, STARTERS[0].title), n => has(n, 'pc-icon-label')).style.visibility, 'hidden');
  assert.equal(key(field(), 'a').defaultPrevented, false, 'letters go in');
  field().value = 'Celeste'; assert.equal(key(field(), 'Enter').defaultPrevented, true); await tick();
  assert.deepEqual(renames(), [{ op: 'rename', id: 'i1', name: 'Celeste' }]);
  assert.equal(field(), undefined); assert.ok(doc.activeElement === iconOf(d.root, 'Celeste'));
  key(d.root, 'm'); key(d.root, 'r'); field().value = 'Nope';
  assert.equal(key(field(), 'Escape').propagationStopped, true); await tick();
  assert.equal(renames().length, 1); assert.equal(field(), undefined); assert.ok(doc.activeElement === iconOf(d.root, 'Celeste'));
  key(d.root, 'm'); key(d.root, 'r'); field().value = 'Celeste 3'; click(layerOf(d.root)); await tick();
  assert.deepEqual(renames().at(-1), { op: 'rename', id: 'i1', name: 'Celeste 3' }); assert.ok(iconOf(d.root, 'Celeste 3'));
});
test('New shortcut: https adds a link named after its host, ftp:// is refused, a thread link installs', async t => {
  const { d, doc, api } = await sat(t), layer = layerOf(d.root), adds = () => api.posted.filter(b => b.op === 'add');
  const shortcut = (link, name = '') => {
    layer.dispatch('contextmenu'); key(d.root, 'n');
    const [l, n] = findAll(findAll(d.root, x => has(x, 'pc-dialog')).at(-1), x => x.tag === 'input');
    assert.ok(doc.activeElement === l, 'Link has focus'); l.value = link; n.value = name; key(l, 'Enter');
  };
  shortcut('https://example.org/games'); await tick(); await tick();
  assert.deepEqual(adds().at(-1), { op: 'add', kind: 'link', url: 'https://example.org/games', name: 'example.org' }); assert.ok(iconOf(d.root, 'example.org'));
  shortcut('https://example.net/', 'Example'); await tick(); await tick(); assert.equal(adds().at(-1).name, 'Example');
  shortcut('ftp://x'); await tick(); assert.equal(dialogText(d.root), 'Only https:// links can be shortcuts.'); assert.equal(adds().length, 2);
  click(dialogButton(d.root, 'OK'));
  shortcut('https://www.lexaloffle.com/bbs/?tid=12345'); await tick(); await tick();
  assert.ok(api.paths.includes('office/bbs/cart?tid=12345')); assert.equal(dialogText(d.root), 'Installing Thread 12345…');
});
test('a focused game gets every key; a press outside it gives them back, and Enter goes back in', async t => {
  const { d, doc } = await sat(t); const frame = playing(d, { pid: 'a-1', title: 'A' }); frame.focus();
  for (const k of ['m', 'ArrowDown', 'Enter', 'Tab', 'z']) {
    const e = key(d.root, k); assert.equal(e.defaultPrevented, false, k); assert.ok(doc.activeElement === frame, k);
  }
  assert.equal(openMenus(d.root), 0);
  click(titleOf(d.root, 'A - PICO-8')); assert.ok(doc.activeElement === d.root);
  key(d.root, 'Enter'); assert.ok(doc.activeElement === frame);
});
test('PICO-8 stopped: Tab reaches ▶ Play, the legend says so, and Z plays', async t => {
  const { d } = await sat(t); playing(d, { pid: 'a-1', title: 'A' }); d.hide(); d.place(rect(0, 0, 1080, 640)); await tick();
  assert.equal(iframeOf(d.root), undefined);
  click(titleOf(d.root, 'A - PICO-8')); key(d.root, 'Tab'); assert.equal(legendText(d.root), legendFor('pico8'));
  key(d.root, 'z'); assert.ok(iframeOf(d.root)); assert.equal(legendText(d.root), '', 'the game has the keys');
});
test('removed focus comes back inside the desktop', async t => {
  const { d, doc } = await sat(t), gone = () => doc.createElement('button'), inside = () => d.root.contains(doc.activeElement);
  gone().focus(); d.arrange(); await tick(); assert.ok(doc.activeElement === d.root, 'after a re-render');
  gone().focus(); click(layerOf(d.root)); assert.ok(inside(), 'after a click');
  gone().focus(); key(d.root, 'ArrowRight'); assert.ok(inside(), 'after a key');
  await openBrowser(d); const link = find(d.root, n => n.tag === 'a' && n.textContent === 'Cart 1'); link.focus(); click(link);
  assert.ok(inside(), 'its page replaced the card'); await tick(); assert.ok(inside());
  selectIcon(d, 'i1'); key(d.root, 'm'); key(d.root, 'd'); key(d.root, 'Enter'); await tick(); await tick();
  assert.equal(iconOf(d.root, STARTERS[0].title), undefined); assert.ok(doc.activeElement === d.root, 'the deleted icon had it');
});

// Task 12 review fixes. Keys go to the focused node, as in a browser: key(doc.activeElement, ...).
const statusText = root => textOf(find(root, n => has(n, 'pc-status')));
const linkOf = (root, title) => find(root, n => n.tag === 'a' && n.textContent === title);
test('Enter on Start or a task button acts on it, though a window is in front', async t => {
  const { d, doc, api } = await sat(t), at = () => doc.activeElement, page = 'Featured - Info Highway'; await openBrowser(d);
  click(startOf(d.root)); key(at(), 'Escape'); assert.ok(at() === startOf(d.root));
  key(at(), 'Enter'); assert.equal(d.view().start, true, 'Start opens again');
  assert.deepEqual(api.paths.filter(p => p.startsWith('office/bbs/cart')), [], 'no card played');
  key(at(), 'Escape'); key(at(), 'Tab'); assert.ok(at() === task(d.root, page));
  key(at(), 'Enter'); assert.equal(windowOf(d.root, page).hidden, true, 'its task minimizes it'); assert.ok(at() === task(d.root, page));
  key(at(), 'Enter'); assert.equal(windowOf(d.root, page).hidden, false, 'and brings it back, with the keys');
  key(at(), 'ArrowRight'); assert.ok(at() === linkOf(d.root, 'Cart 1'));
  click(startOf(d.root)); key(at(), 'Escape'); key(at(), 'Tab'); assert.ok(at() === task(d.root, page));
  pointer(titleOf(d.root, page), 'pointerdown'); pointer(titleOf(d.root, page), 'pointerup'); assert.ok(at() === d.root, 'a press on the window takes the keys there');
  key(at(), 'ArrowRight'); assert.ok(at() === linkOf(d.root, 'Cart 2'));
});
test('sitting down to a window in front gives it the keys; with none, the desktop has them', async t => {
  const windows = defaults(); windows.windows.browser = { open: true, mode: 'normal', x: 100, y: 12 }; windows.order = ['notepad', 'pico8', 'browser'];
  const { d, doc } = await sat(t, { windows }), at = () => doc.activeElement; await tick();
  key(at(), 'ArrowDown'); assert.ok(at() === linkOf(d.root, 'Cart 1')); assert.equal(selectedId(d), 'browser', 'the icons stay put');
  assert.equal(legendText(d.root), ''); assert.match(statusText(d.root), /Enter\/Z Play/, 'the browser\'s legend');
  d.hide(); d.place(rect(0, 0, 1080, 640)); key(at(), 'ArrowRight'); assert.ok(at() === linkOf(d.root, 'Cart 2'), 'again at the next sit-down');
  click(task(d.root, 'Featured - Info Highway')); d.hide(); d.place(rect(0, 0, 1080, 640));
  key(at(), 'ArrowDown'); assert.equal(selectedId(d), 'salaries', 'minimized: the desktop');
});
test('keys still reach the desktop after a re-render takes the focused icon away', async t => {
  const { d, doc } = await sat(t), at = () => doc.activeElement;
  key(at(), 'ArrowDown'); key(at(), 'ArrowDown'); assert.equal(selectedId(d), 'i1');
  key(at(), 'm'); key(at(), 'd'); key(at(), 'Enter'); await tick(); await tick();
  assert.equal(iconOf(d.root, STARTERS[0].title), undefined); assert.ok(at() === d.root, 'not left on the body');
  key(at(), 'ArrowDown'); assert.equal(selectedId(d), 'browser', 'the desktop still has the keys');
});
test('a focused icon keeps focus when the icons are put back in the page', async t => {
  const { d, doc } = await sat(t); key(doc.activeElement, 'ArrowDown'); const salaries = iconOf(d.root, 'salaries.txt');
  assert.ok(doc.activeElement === salaries);
  d.install({ pid: 'z-1', title: 'Z' }); await tick(); await tick();
  assert.ok(iconOf(d.root, 'Info z-1'), 'the new icon is in'); assert.ok(doc.activeElement === salaries);
});
for (const [failCart, text] of [['Lexaloffle is not answering.', 'Lexaloffle is not answering.'], ['', 'Cannot find the cart in that thread.']]) {
  test(`New shortcut: a thread whose cart can't be looked up says "${text}"`, async t => {
    const { d, doc, api } = await sat(t, { failCart });
    layerOf(d.root).dispatch('contextmenu'); key(doc.activeElement, 'n');
    const link = doc.activeElement; link.value = 'https://www.lexaloffle.com/bbs/?tid=12345'; key(link, 'Enter'); await tick(); await tick();
    assert.ok(api.paths.includes('office/bbs/cart?tid=12345')); assert.equal(dialogText(d.root), text);
  });
}
test('a press on the title or menu bar ends Info Highway\'s key legend', async t => {
  const { d, doc } = await sat(t), page = 'Featured - Info Highway'; await openBrowser(d);
  for (const n of [titleOf(d.root, page), find(windowOf(d.root, page), x => has(x, 'pc-menubar'))]) {
    key(doc.activeElement, 'ArrowRight'); assert.match(statusText(d.root), /Enter\/Z Play/);
    pointer(n, 'pointerdown'); pointer(n, 'pointerup'); assert.equal(statusText(d.root), 'Done');
  }
});
test('a right-click on the bare page shows no card menu, though a card was selected', async t => {
  const { d, doc } = await sat(t); await openBrowser(d);
  key(doc.activeElement, 'ArrowRight'); assert.ok(doc.activeElement === linkOf(d.root, 'Cart 1'));
  const grid = find(d.root, n => has(n, 'pc-cards'));
  assert.equal(grid.dispatch('contextmenu').defaultPrevented, true); assert.equal(openMenus(d.root), 0);
});
test('a right-click on a card picks that card', async t => {
  const { d, doc } = await sat(t); await openBrowser(d);
  const card = findAll(d.root, n => has(n, 'pc-card'))[2];
  find(card, n => n.tag === 'img').dispatch('contextmenu');
  assert.deepEqual(menuItems(d.root).map(([text]) => text), ['Play', 'Install', 'Open in new tab ↗']);
  click(menuItem(d.root, 'Install')); assert.equal(dialogText(d.root), 'Installing Cart 3…');
  assert.ok(doc.activeElement === linkOf(d.root, 'Cart 3'), 'its link has focus');
});
test('keys in an IME composition are the field\'s: Enter commits no rename, dialog or search', async t => {
  const { d, doc, api } = await sat(t), ime = { isComposing: true }, field = () => find(d.root, n => has(n, 'pc-rename'));
  selectIcon(d, 'i1'); key(doc.activeElement, 'm'); key(doc.activeElement, 'r'); field().value = 'Céleste';
  const e = key(field(), 'Enter', ime); assert.equal(e.defaultPrevented, false); assert.equal(e.propagationStopped, true, 'not the office\'s either');
  key(field(), 'Escape', ime); await tick();
  assert.ok(field(), 'still renaming'); assert.deepEqual(api.posted.filter(b => b.op === 'rename'), []);
  key(field(), 'Escape');
  layerOf(d.root).dispatch('contextmenu'); key(doc.activeElement, 'n'); const link = doc.activeElement; link.value = 'https://example.org/';
  key(link, 'Enter', ime); await tick(); assert.equal(openDialogs(d.root), 1, 'the dialog stays'); key(link, 'Escape');
  await openBrowser(d); const box = searchBox(d.root); box.focus(); box.value = 'snake';
  key(box, 'Enter', ime); await tick(); assert.equal(api.paths.some(p => p.includes('q=snake')), false, 'no search');
  key(box, 'Enter'); await tick(); assert.ok(api.paths.includes('office/bbs/list?q=snake&page=1'));
});
test('a page that loads late leaves a playing game its focus', async t => {
  const { d, doc } = await sat(t); await openBrowser(d);
  click(linkOf(d.root, 'Cart 2')); const frame = playing(d, { pid: 'a-1', title: 'A' }); frame.focus();
  await tick(); await tick();
  assert.ok(find(d.root, n => n.tag === 'button' && n.textContent === '▶ Play'), 'the page is in'); assert.ok(doc.activeElement === frame);
});

test('a loading cart takes focus only while its window is in front', async t => {
  const { d, doc } = await sat(t); const frame = playing(d, { pid: 'a-1', title: 'A' }); await openBrowser(d);
  frame.dispatch('load'); assert.notEqual(doc.activeElement, frame, 'Info Highway is in front');
  click(task(d.root, 'A - PICO-8')); frame.dispatch('load'); assert.equal(doc.activeElement, frame, 'PICO-8 is in front');
});
