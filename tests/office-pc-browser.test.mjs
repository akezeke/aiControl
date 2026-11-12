import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowser, readAddress, addressOf, draw } from '../client/office/pc-browser.js';
import { useDom, find, findAll } from './fixtures/pc-dom.mjs';

test('readAddress, every row', () => {
  const cases = [
    ['https://www.lexaloffle.com/bbs/?pid=porklike-2#p', { kind: 'cart', pid: 'porklike-2' }],
    ['165759', { kind: 'cart', pid: '165759' }], ['porklike-2', { kind: 'cart', pid: 'porklike-2' }],
    ['https://www.lexaloffle.com/bbs/?tid=148484', { kind: 'thread', tid: '148484' }],
    ['https://www.lexaloffle.com/bbs/?cat=7#sub=2&mode=carts&orderby=featured&page=2', { kind: 'list', tab: 'featured', page: 2, q: '' }],
    ['https://example.com/x', { kind: 'away', url: 'https://example.com/x' }],
    ['http://example.com/', { kind: 'tab', url: 'http://example.com/' }],
    ['  snake game ', { kind: 'search', q: 'snake game' }],
    ['x'.repeat(80), { kind: 'search', q: 'x'.repeat(60) }],
    ['javascript:alert(1)', { kind: 'search', q: 'javascript:alert(1)' }],
  ];
  for (const [input, want] of cases) assert.deepEqual(readAddress(input), want, input);
});
test('addresses shown', () => {
  assert.equal(addressOf({ kind: 'list', tab: 'featured', page: 1, q: '' }), 'https://www.lexaloffle.com/bbs/?cat=7#sub=2&mode=carts&orderby=featured&page=1');
  assert.equal(addressOf({ kind: 'game', pid: 'a-1' }), 'https://www.lexaloffle.com/bbs/?pid=a-1');
  assert.equal(addressOf({ kind: 'away', url: 'https://example.com/' }), 'https://example.com/');
  assert.equal(addressOf({ kind: 'error', address: 'https://x/' }), 'https://x/');
});

const rows = n => Array.from({ length: n }, (_, i) => ({ pid: `c${i}-1`, tid: i, title: `Cart ${i}`, author: `by${i}`, thumb: `pico8_c${i}-1.png`, likes: i, updated: `2026-01-${String(i + 1).padStart(2, '0')}` }));
const HELP = { icon: 'info', text: 'Help is not available. Please contact your system administrator.', buttons: ['OK'] };
const ABOUT = { icon: 'info', text: 'Info Highway 2.0 · Best viewed at 1080 × 640.', buttons: ['OK'] };

function setup(t, { fail = false, more = true, stale = false, installed = () => false } = {}) {
  const doc = useDom(t), calls = [], played = [], installs = [], opened = [], dialogs = [];
  let failing = fail;
  const api = async path => {
    calls.push(path);
    if (failing) throw new Error('down');
    if (path.startsWith('office/bbs/list')) return { carts: rows(30), more, ...(stale && { stale: true }) };
    const pid = new URLSearchParams(path.split('?')[1]).get('pid') ?? 'tid-1';
    return { pid, title: `Info ${pid}`, author: 'someone', thumb: `pico8_${pid}.png`, embed: !pid.startsWith('blocked') };
  };
  const b = createBrowser({ doc, api, ui: { dialog: o => { dialogs.push(o); return Promise.resolve('OK'); } }, installed, onPlay: c => played.push(c), onInstall: c => installs.push(c), open: u => opened.push(u) });
  const button = text => find(b.node, n => n.tag === 'button' && n.textContent === text);
  const cards = () => findAll(b.node, n => n.classList.contains('pc-card'));
  const link = i => find(cards()[i], n => n.tag === 'a');
  const key = (k, extra = {}) => b.key({ key: k, ...extra });
  const rowsOf = () => cards().forEach((c, i) => { c.offsetTop = Math.floor(i / 5) * 200; });
  return { doc, b, calls, played, installs, opened, dialogs, button, cards, link, key, rowsOf, setFail: v => { failing = v; } };
}
const tick = () => new Promise(r => setImmediate(r));
const loaded = async t0 => { const s = setup(t0); await s.b.home(); return s; };

test('opens on Featured page 1 and says so', async t => {
  const s = setup(t); assert.deepEqual(s.calls, []);
  const p = s.b.home(); assert.equal(s.b.status(), 'Opening page…');
  assert.ok(find(s.b.node, n => n.classList.contains('pc-throbber')).classList.contains('loading'));
  await p; assert.deepEqual(s.calls, ['office/bbs/list?tab=featured&page=1']);
  assert.equal(s.b.status(), 'Done'); assert.equal(s.b.title(), 'Featured - Info Highway');
  assert.equal(find(s.b.node, n => n.classList.contains('pc-throbber')).classList.contains('loading'), false);
  assert.equal(s.cards().length, 30);
});
test('the hourglass shows on the page while loading only', async t => {
  const s = setup(t), page = find(s.b.node, n => n.classList.contains('pc-page'));
  const p = s.b.home(); assert.match(page.style.cursor, /^url\(.*\)/); await p; assert.equal(page.style.cursor, '');
});
test('lazy thumbnails, tooltips and the cards', async t => {
  const s = await loaded(t), imgs = findAll(s.b.node, n => n.tag === 'img');
  assert.equal(imgs.length, 30);
  for (const img of imgs) { assert.equal(img.loading, 'lazy'); assert.ok(img.src.startsWith('/api/office/bbs/thumb/')); assert.ok(img.classList.contains('pc-thumb')); }
  const c = s.cards()[3]; assert.equal(c.attributes['data-tip'], '2026-01-04'); assert.equal(c.attributes.title, undefined);
  assert.ok(find(c, n => n.textContent === '♥ 3')); assert.ok(find(c, n => n.textContent === 'by3'));
});
test('XSS: fetched text only reaches textContent', async t => {
  const doc = useDom(t);
  const api = async () => ({ carts: [{ ...rows(1)[0], title: '<img src=x onerror=1>', author: '<b>x</b>' }], more: false });
  const b = createBrowser({ doc, api, ui: {}, installed: () => false, onPlay() {}, onInstall() {}, open() {} }); await b.home();
  assert.ok(find(b.node, n => n.textContent === '<img src=x onerror=1>')); assert.equal(findAll(b.node, n => n.tag === 'img').length, 1);
});
test('✓ on installed carts, refreshed in place', async t => {
  let have = new Set(['c1-1']); const s = setup(t, { installed: pid => have.has(pid) }); await s.b.home();
  const marks = () => findAll(s.b.node, n => n.textContent === '✓').length;
  assert.equal(marks(), 1); have = new Set(['c1-1', 'c2-1']); s.b.refreshInstalled(); assert.equal(marks(), 2);
  have = new Set(); s.b.refreshInstalled(); assert.equal(marks(), 0);
});
test('history: back, forward, cut off, close', async t => {
  const s = await loaded(t); assert.equal(s.button('◄ Back').disabled, true);
  s.link(0).dispatch('click'); await tick(); assert.equal(s.b.selection().kind, 'game');
  assert.equal(s.button('◄ Back').disabled, false);
  s.b.back(); assert.equal(s.b.title(), 'Featured - Info Highway'); assert.equal(s.cards().length, 30);
  assert.equal(s.button('► Forward').disabled, false); s.b.forward(); assert.equal(s.b.selection().kind, 'game');
  s.b.back(); await s.b.go('porklike-2'); assert.equal(s.button('► Forward').disabled, true);
  s.b.close(); await s.b.home(); assert.equal(s.button('◄ Back').disabled, true); assert.equal(s.button('► Forward').disabled, true);
});
test('going back does not fetch again; Refresh does', async t => {
  const s = await loaded(t); await s.b.go('porklike-2'); const n = s.calls.length;
  s.b.back(); assert.equal(s.calls.length, n); await s.b.refresh(); assert.equal(s.calls.length, n + 1);
});
test('embed and blocked game pages, with no frame on either', async t => {
  const s = setup(t); await s.b.go('good-1');
  assert.equal(s.doc.activeElement.textContent, '▶ Play'); assert.ok(s.button('Install'));
  assert.ok(find(s.b.node, n => n.textContent === 'Open at lexaloffle ↗'));
  assert.deepEqual(findAll(s.b.node, n => n.tag === 'iframe'), []);
  assert.equal(s.b.title(), 'Info good-1 - Info Highway'); assert.equal(s.calls.at(-1), 'office/bbs/cart?pid=good-1');
  s.doc.activeElement.dispatch('click'); assert.deepEqual(s.played, [{ pid: 'good-1', title: 'Info good-1' }]);
  await s.b.go('blocked-1'); assert.equal(s.doc.activeElement.textContent, 'Play at lexaloffle ↗'); assert.ok(s.button('Install'));
  assert.equal(find(s.b.node, n => n.textContent === '▶ Play'), undefined); assert.deepEqual(findAll(s.b.node, n => n.tag === 'iframe'), []);
  s.doc.activeElement.dispatch('click'); assert.deepEqual(s.opened, ['https://www.lexaloffle.com/bbs/?pid=blocked-1']);
});
test('a game page from a card shows the row at once and the 256 px thumbnail', async t => {
  const s = await loaded(t); s.link(2).dispatch('click');
  assert.equal(s.b.title(), 'Cart 2 - Info Highway'); assert.ok(find(s.b.node, n => n.textContent === 'by2'));
  await tick(); const img = find(s.b.node, n => n.tag === 'img');
  assert.deepEqual([img.width, img.height, img.style.imageRendering], ['256', '256', 'pixelated']);
  assert.ok(find(s.b.node, n => n.textContent === '♥ 2'));
});
test('a thread link resolves through cart info', async t => {
  const s = setup(t); await s.b.go('https://www.lexaloffle.com/bbs/?tid=148484');
  assert.equal(s.calls.at(-1), 'office/bbs/cart?tid=148484'); assert.equal(s.b.selection().kind, 'game');
});
test('Enter on a card plays, or opens the page for a blocked cart', async t => {
  const s = await loaded(t); s.key('ArrowRight'); assert.equal(s.doc.activeElement, s.link(0));
  assert.equal(s.key('Enter'), true); await tick();
  assert.deepEqual(s.played, [{ pid: 'c0-1', title: 'Cart 0' }]); assert.equal(s.calls.at(-1), 'office/bbs/cart?pid=c0-1'); assert.equal(s.b.selection().kind, undefined);
  const blocked = setup(t); blocked.b.go({ kind: 'list', tab: 'new', page: 1, q: '', carts: [{ ...rows(1)[0], pid: 'blocked-1' }], more: false });
  blocked.key('ArrowRight'); blocked.key('z'); await tick();
  assert.deepEqual(blocked.played, []); assert.equal(blocked.b.selection().kind, 'game'); assert.equal(blocked.b.selection().pid, 'blocked-1');
});
test('install', async t => {
  const s = await loaded(t); await s.b.go('good-1');
  s.button('Install').dispatch('click'); assert.deepEqual(s.installs, [{ pid: 'good-1', title: 'Info good-1' }]);
  const have = setup(t, { installed: () => true }); await have.b.go('good-1'); assert.equal(have.button('Install').disabled, true);
  assert.equal(have.b.menus()[0].items[0].disabled, true);
});
test('Prev and Next', async t => {
  const s = await loaded(t); assert.equal(s.button('« Prev').disabled, true); assert.equal(s.button('Next »').disabled, false);
  s.button('Next »').dispatch('click'); await tick(); assert.equal(s.calls.at(-1), 'office/bbs/list?tab=featured&page=2');
  assert.equal(s.button('« Prev').disabled, false); assert.ok(find(s.b.node, n => n.textContent === 'Page 2'));
  const end = setup(t, { more: false }); await end.b.home(); assert.equal(end.button('Next »').disabled, true);
});
test('tabs: the current one is pressed', async t => {
  const s = await loaded(t); assert.equal(s.button('Featured').classList.contains('pressed'), true); assert.equal(s.button('New').classList.contains('pressed'), false);
  s.button('New').dispatch('click'); await tick(); assert.equal(s.calls.at(-1), 'office/bbs/list?tab=new&page=1'); assert.equal(s.button('New').classList.contains('pressed'), true);
});
test('search', async t => {
  const s = await loaded(t), box = find(s.b.node, n => n.tag === 'input' && n.classList.contains('search'));
  assert.equal(s.key('s'), true); assert.equal(s.doc.activeElement, box);
  s.doc.activeElement = null; assert.equal(s.key('f', { ctrlKey: true }), true); assert.equal(s.doc.activeElement, box);
  assert.equal(s.key('s'), false, 'typing in the field');
  box.value = 'snake'; assert.equal(s.key('Enter'), true); await tick();
  assert.equal(s.calls.at(-1), 'office/bbs/list?q=snake&page=1'); assert.equal(s.b.title(), 'Search: snake - Info Highway');
  assert.equal(s.button('Featured').classList.contains('pressed'), false); assert.equal(s.button('New').classList.contains('pressed'), false);
  assert.equal(find(s.b.node, n => n.tag === 'input' && n.classList.contains('search')).value, 'snake');
});
test('the address bar goes on Enter and [Go]; elsewhere S selects it', async t => {
  const s = await loaded(t), field = find(s.b.node, n => n.tag === 'input' && n.classList.contains('address'));
  assert.equal(field.value, 'https://www.lexaloffle.com/bbs/?cat=7#sub=2&mode=carts&orderby=featured&page=1'); assert.ok(field.classList.contains('pc-field'));
  field.value = 'porklike-2'; s.doc.activeElement = field; s.key('Enter'); await tick(); assert.equal(s.b.selection().kind, 'game');
  assert.equal(field.value, 'https://www.lexaloffle.com/bbs/?pid=porklike-2');
  let selected = 0; field.select = () => { selected++; }; s.doc.activeElement = null; assert.equal(s.key('s'), true); assert.equal(s.doc.activeElement, field); assert.equal(selected, 1);
  field.value = 'zelda'; s.button('Go').dispatch('click'); await tick(); assert.equal(s.calls.at(-1), 'office/bbs/list?q=zelda&page=1');
});
test('stale', async t => {
  const s = setup(t, { stale: true }); await s.b.home(); assert.equal(s.b.status(), 'Done (offline copy)');
});
test('error and Retry', async t => {
  const s = setup(t, { fail: true }); await s.b.home();
  const msg = 'Info Highway cannot open this page. The information superhighway may be closed for repairs.';
  assert.ok(find(s.b.node, n => n.textContent === msg)); assert.equal(s.b.title(), 'Error - Info Highway'); assert.equal(s.doc.activeElement.textContent, 'Retry');
  s.setFail(false); s.button('Retry').dispatch('click'); await tick();
  assert.deepEqual(s.calls, ['office/bbs/list?tab=featured&page=1', 'office/bbs/list?tab=featured&page=1']); assert.equal(s.cards().length, 30);
  assert.equal(s.button('◄ Back').disabled, true, 'Retry replaces the error entry');
});
test('away and tab', async t => {
  const s = setup(t); await s.b.go('https://example.com/x');
  assert.equal(s.b.title(), 'Leaving - Info Highway'); assert.ok(find(s.b.node, n => n.textContent === 'You are now leaving the Info Highway')); assert.ok(find(s.b.node, n => n.textContent === 'https://example.com/x'));
  assert.equal(s.doc.activeElement.textContent, 'Open in new tab ↗'); s.doc.activeElement.dispatch('click'); assert.deepEqual(s.opened, ['https://example.com/x']);
  const before = s.b.title(); await s.b.go('http://example.com/'); assert.deepEqual(s.opened, ['https://example.com/x', 'http://example.com/']); assert.equal(s.b.title(), before);
  assert.deepEqual(s.calls, []);
});
test('visited links', async t => {
  const s = await loaded(t); assert.equal(link(s, 0).classList.contains('visited'), false);
  s.link(0).dispatch('click'); await tick(); s.b.back(); assert.equal(link(s, 0).classList.contains('visited'), true); assert.equal(link(s, 1).classList.contains('visited'), false);
});
const link = (s, i) => s.link(i);
test('legend', async t => {
  const s = await loaded(t);
  assert.equal(s.b.legend(), '←→↑↓ Move   Enter/Z Play   X/Backspace Back   M Menu   S Search   Tab Next');
  await s.b.go('good-1'); assert.equal(s.b.legend(), 'Enter/Z Play   X/Backspace Back   M Menu   S Search   Tab Next');
  await s.b.go('https://example.com/'); assert.equal(s.b.legend(), 'X/Backspace Back   S Search   Tab Next');
});
test('a key shows the legend in the status bar, a click brings the status back', async t => {
  const s = await loaded(t); assert.equal(s.b.status(), 'Done'); s.key('q'); assert.equal(s.b.status(), s.b.legend());
  s.b.node.dispatch('click'); assert.equal(s.b.status(), 'Done');
});
test('grid arrows follow the columns counted from offsetTop', async t => {
  const s = await loaded(t); s.rowsOf();
  s.key('ArrowRight'); assert.equal(s.doc.activeElement, s.link(0)); s.key('ArrowRight'); assert.equal(s.doc.activeElement, s.link(1));
  s.key('ArrowDown'); assert.equal(s.doc.activeElement, s.link(6)); s.key('ArrowUp'); assert.equal(s.doc.activeElement, s.link(1));
  s.key('ArrowLeft'); s.key('ArrowLeft'); assert.equal(s.doc.activeElement, s.link(0)); s.key('ArrowUp'); assert.equal(s.doc.activeElement, s.link(0));
  assert.equal(s.b.selection().pid, 'c0-1');
});
test('X and Backspace go back; not inside a field', async t => {
  const s = await loaded(t); await s.b.go('good-1'); assert.equal(s.key('x'), true); assert.equal(s.b.selection(), null);
  await s.b.go('good-1'); assert.equal(s.key('Backspace'), true); assert.equal(s.b.title(), 'Featured - Info Highway');
  s.doc.activeElement = find(s.b.node, n => n.classList.contains('address')); assert.equal(s.key('x'), false); assert.equal(s.key('Backspace'), false);
});
test('menus', async t => {
  const s = await loaded(t), labels = () => s.b.menus().map(m => [m.label, m.items.map(i => i.label)]);
  assert.deepEqual(labels(), [['&File', ['&Install', 'Open in new &tab ↗', '&Close']], ['&Go', ['&Back', '&Forward', '&Home', '&Refresh']], ['&Help', ['&Help Topics…', '&About Info Highway…']]]);
  const [file, go, help] = s.b.menus();
  assert.deepEqual([file.items[0].disabled, file.items[1].disabled], [true, true]); assert.equal(go.items[0].disabled, true);
  await help.items[0].run(); await help.items[1].run(); assert.deepEqual(s.dialogs, [HELP, ABOUT]);
  s.key('ArrowRight'); assert.deepEqual(s.b.menus()[0].items.map(i => i.disabled), [false, false, false]);
  s.b.menus()[0].items[1].run(); assert.deepEqual(s.opened, ['https://www.lexaloffle.com/bbs/?pid=c0-1']);
  s.b.menus()[0].items[0].run(); assert.deepEqual(s.installs, [{ pid: 'c0-1', title: 'Cart 0' }]);
  let closed = 0; s.b.onClose(() => closed++); s.b.menus()[0].items[2].run(); assert.equal(closed, 1);
  await s.b.go('good-1'); assert.equal(s.b.menus()[1].items[0].disabled, false); s.b.menus()[1].items[2].run(); await tick(); assert.equal(s.b.title(), 'Featured - Info Highway');
});
test('context items for the selected game', async t => {
  const s = await loaded(t); assert.deepEqual(s.b.contextItems(), []);
  s.key('ArrowRight'); const items = s.b.contextItems(); assert.deepEqual(items.map(i => i.label), ['&Play', '&Install', 'Open in new &tab ↗']);
  items[2].run(); assert.deepEqual(s.opened, ['https://www.lexaloffle.com/bbs/?pid=c0-1']);
  items[1].run(); assert.deepEqual(s.installs, [{ pid: 'c0-1', title: 'Cart 0' }]);
  items[0].run(); await tick(); assert.deepEqual(s.played, [{ pid: 'c0-1', title: 'Cart 0' }]);
});
test('chrome: toolbar, address, throbber, status', async t => {
  const s = await loaded(t);
  for (const label of ['◄ Back', '► Forward', '⟳ Refresh', '⌂ Home']) assert.ok(s.button(label).classList.contains('pc-button'), label);
  assert.ok(find(s.b.node, n => n.classList.contains('pc-status'))); assert.ok(find(s.b.node, n => n.classList.contains('pc-page')));
  assert.match(find(s.b.node, n => n.classList.contains('pc-throbber')).style.backgroundImage, /^url\(data:image\/png/);
  assert.equal(findAll(s.b.node, n => n.classList.contains('pc-progress-block')).length, 0);
  const p = s.b.refresh(); assert.ok(findAll(s.b.node, n => n.classList.contains('pc-progress-block')).length > 0); await p;
  assert.equal(findAll(s.b.node, n => n.classList.contains('pc-progress-block')).length, 0);
});
test('a stale reply after navigating away is dropped', async t => {
  const s = setup(t); const slow = s.b.home(); await s.b.go('https://example.com/'); await slow;
  assert.equal(s.b.title(), 'Leaving - Info Highway'); assert.equal(s.b.status(), 'Done');
});
test('draw: thumbnails of the list, a missing one grey', async t => {
  const s = await loaded(t); const g = []; const ctx = new Proxy({}, { get: (_, k) => (...a) => g.push([k, a]), set() { return true; } });
  draw(ctx, { x: 0, y: 0, w: 300, h: 200 }, { page: s.b.selection() ?? { kind: 'list', carts: rows(3) }, image: name => name === 'pico8_c0-1.png' ? 'IMG' : null });
  assert.ok(g.some(([k, a]) => k === 'drawImage' && a[0] === 'IMG')); assert.ok(g.some(([k]) => k === 'fillRect'));
});
