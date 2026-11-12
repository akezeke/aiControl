import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktop, fakeCart, fitTransform } from '../client/office/desktop.js';
import { STARTERS, thumbName } from '../client/office/carts.js';
import { defaults } from '../client/office/pc-windows.js';
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
const key = (node, k) => node.dispatch('keydown', { key: k });
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
const openBrowser = async d => { dblclick(iconOf(d.root, 'Info Highway')); await tick(); };
const windowOps = api => api.posted.filter(b => b.op === 'windows');
const SESSION = { id: 's-alpha', project: 'aiControl', status: 'working' }, OTHER = { id: 's-beta', project: 'aiControl', status: 'idle' };

// A new server desktop: the built-ins and the starters i1-i4 (or `own` icons), then `extra`, placed column by column.
function desk({ own, extra = [], windows } = {}) {
  const icons = [...(own ?? STARTERS.map((c, n) => ({ id: `i${n + 1}`, kind: 'cart', pid: c.pid, name: c.title, author: c.author, embed: true }))), ...extra];
  const spots = Object.fromEntries(['browser', 'salaries', ...icons.map(i => i.id)].map((id, n) => [id, [Math.floor(n / 5), n % 5]]));
  return { version: 1, icons, spots, ...(windows ?? defaults()), imported: false };
}
const LIST = [1, 2, 3].map(i => ({ pid: `c${i}-1`, tid: i, title: `Cart ${i}`, author: `by${i}`, thumb: `pico8_c${i}-1.png`, likes: i, updated: '2026-01-01' }));
// Records GET paths and POSTed bodies. slowAdd holds an add until finishAdd(); failAdd and failWindows make those ops fail.
function fakeApi(opts = {}) {
  const server = desk(opts), paths = [], posted = [];
  let held = !!opts.slowAdd, release = null;
  const api = async (path, body) => {
    if (body === undefined) paths.push(path); else posted.push(structuredClone(body));
    if (path === 'office/pc') {
      if (body?.op === 'add') {
        if (held) await new Promise(r => { release = r; });
        if (opts.failAdd) throw new Error(opts.failAdd);
        const id = `i${server.icons.length + 1}`;
        server.icons.push({ id, kind: 'cart', pid: body.pid, name: `Info ${body.pid}`, author: '', embed: true }); server.spots[id] = [9, 4];
      }
      if (body?.op === 'windows') { if (opts.failWindows) throw new Error(opts.failWindows); Object.assign(server, { windows: body.windows, order: body.order }); }
      if (body?.op === 'move') server.spots[body.id] = body.spot;
      return structuredClone(server);
    }
    if (path.startsWith('office/bbs/list')) return { carts: LIST, more: false };
    if (path.startsWith('office/bbs/cart')) {
      const pid = new URLSearchParams(path.split('?')[1]).get('pid');
      return { pid, title: `Info ${pid}`, author: 'someone', thumb: thumbName(pid), embed: !pid.startsWith('blocked') };
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
  const { d, doc, timers, api } = await sat(t, { slowAdd: true }); await openBrowser(d);
  startDrag(titleOf(d.root, 'Featured - Info Highway')); install(d, { pid: 'c-1', title: 'C' });
  d.hide();
  assert.equal(d.root.hidden, true); assert.equal(iframeOf(d.root), undefined); assert.equal(timers.pending(), 0);
  assert.equal(openDialogs(d.root), 0); api.finishAdd(); await tick(); assert.ok(api.posted.some(b => b.op === 'add'));
  assert.equal(doc.listenerCount(), 0);
});

test('icons: the order, tips and arrows; a click selects; opening plays, browses or leaves', async t => {
  const extra = [{ id: 'i5', kind: 'cart', pid: 'blocked-1', name: 'Blocked', author: 'zed', embed: false }, { id: 'i6', kind: 'link', url: 'https://example.com/', name: 'Example' }];
  const { d, api } = await sat(t, { extra });
  assert.deepEqual(findAll(d.root, n => has(n, 'pc-icon-label')).map(n => n.textContent), ['Info Highway', 'salaries.txt', ...STARTERS.map(c => c.title), 'Blocked', 'Example']);
  const celeste = iconOf(d.root, STARTERS[0].title);
  assert.equal(celeste.attributes['data-tip'], STARTERS[0].author); assert.equal(iconOf(d.root, 'Example').attributes['data-tip'], 'https://example.com/');
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
  assert.equal(dialogText(d.root), 'Disk full.');
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

test('reduced motion: no zoom outlines and no sliding Start', async t => {
  const { d } = await sat(t, { reduced: true }); playing(d, { pid: 'a-1', title: 'A' });
  click(button(d.root, 'A - PICO-8', '_')); assert.equal(zoomsOf(d.root).length, 0);
  click(startOf(d.root)); assert.equal(has(startMenuOf(d.root), 'pc-slide'), false);
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
  assert.deepEqual(d.state(), { window: null, cart: null, start: false });
});
