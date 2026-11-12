import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseList, parseCart, createOfficePc } from '../server/office-pc.mjs';
import { Readable } from 'node:stream';
import { thumbName, STARTERS } from '../client/office/carts.js';
import { createHandler } from '../server/http.mjs';

const ROWS = [
  "['165759', 148484, `Mole Mole`,\"/bbs/thumbs/pico8_molemole-1.png\",256,170.66666666667,\"2025-04-18 00:41:13\",13953,\"Adam Atomic\",\"2026-11-01 04:30:19\",0,\"\",100,25,0,7,2,'0',[],2,276,7,`Mole Mole`,``],",
  "['22254', 3547, `Worm Nom Nom`,\"/bbs/thumbs/pico23208.png\",256,170.66666666667,\"2016-06-04 09:44:34\",12489,\"kometbomb\",\"2020-11-03 18:09:26\",0,\"\",113,40,0,7,2,'0',[\"arcade\",\"snake\",],2,273,7,`Worm Nom Nom 1.2`,``],",
  "['1', 2, `Tom &amp; \\` \",\" Jerry`,\"/bbs/thumbs/pico8_tj-0.png\",256,170.6,\"2025-01-01 00:00:00\",5,\"A&lt;b\",\"2025-01-02 00:00:00\",0,\"\",7,1,0,7,2,'0',[],2,276,7,`x`,``],",
  "['3', 4, `${globalThis.pwned=1}`,\"/bbs/thumbs/evil.png\",256,1,\"x\",1,\"x\",\"x\",0,\"\",1,1,0,7,2,'0',[],2,1,7,`x`,``],",
];
const lister = rows => `<script>var pdat=[\n${rows.join('\n')}\n];</script>`;
const HOST = 'https://www.lexaloffle.com';
const PNGBYTES = (extra = 0) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(extra)]);
const rowFor = i => `['${i}', ${i}, \`T${i}\`,"/bbs/thumbs/pico8_t${i}-1.png",1,1,"x",1,"a","u",0,"",1,`;

// A fake fetch serving a map of URL to body (or { status }), recording [url, init].
function setup(pages = {}) {
  const calls = [], serve = { ...pages };
  const fetch = async (url, init) => {
    calls.push([url, init]);
    const page = serve[url];
    if (page === undefined || page instanceof Error) throw page ?? new Error('offline');
    const { status = 200, body = '', headers } = typeof page === 'object' && !Buffer.isBuffer(page) ? page : { body: page };
    return new Response(body, { status, headers });
  };
  const clock = { t: 1_000_000 }, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-pc-'));
  const pc = createOfficePc({ dir, fetch, now: () => clock.t });
  return { pc, calls, serve, clock };
}
const q = s => new URLSearchParams(s);
const status = code => err => err.status === code;

test('parseList reads real rows, decodes entities, drops bad rows and runs nothing', () => {
  const carts = parseList(lister(ROWS));
  assert.deepEqual(carts[0], { pid: 'molemole-1', tid: 148484, title: 'Mole Mole', author: 'Adam Atomic', thumb: 'pico8_molemole-1.png', likes: 100, updated: '2026-11-01 04:30:19' });
  assert.deepEqual([carts[1].pid, carts[1].thumb], ['23208', 'pico23208.png']);
  assert.deepEqual([carts[2].title, carts[2].author, carts[2].likes], ['Tom & ` "," Jerry', 'A<b', 7]);
  assert.equal(carts.length, 3); assert.equal(globalThis.pwned, undefined);
});
test('parseCart: title, author past image links and @mentions, cart id, and the no-embed note', () => {
  const page = '<title>Mole Mole</title> <a href="/bbs/?uid=2185"> @phil</a> <a href="/bbs/?uid=13953"><img src=x></a> <a href="/bbs/?uid=13953">Adam Atomic</a> cart_id=molemole-1&x';
  assert.deepEqual(parseCart(page), { pid: 'molemole-1', title: 'Mole Mole', author: 'Adam Atomic', thumb: 'pico8_molemole-1.png', embed: true });
  assert.equal(parseCart('<title>Celeste</title> pico15133.png do not allow embedded playback').embed, false);
  assert.equal(parseCart('<title>Celeste</title> pico15133.png').pid, '15133');
});

test('list parameters', async () => {
  const { pc, calls } = setup({});
  for (const bad of ['tab=hot', 'page=0', 'page=51', 'page=1.5', `q=${'x'.repeat(61)}`, `q=${' '.repeat(5)}${'x'.repeat(61)}`])
    await assert.rejects(pc.list(q(bad)), status(400), bad);
  assert.equal(calls.length, 0);
  const url = `${HOST}/bbs/lister.php?use_hurl=1&cat=7&sub=2&mode=carts&page=1&search=a%20b`;
  const s = setup({ [url]: lister([]) });
  await s.pc.list(q('tab=hot&q=%20a%20b%20'));
  assert.equal(s.calls[0][0], url); assert.ok(!s.calls[0][0].includes('orderby'));
});

test('list fetch rules', async () => {
  const url = `${HOST}/bbs/lister.php?use_hurl=1&cat=7&sub=2&mode=carts&page=2&orderby=featured`;
  const rows = n => lister(Array.from({ length: n }, (_, i) => rowFor(i)));
  const s = setup({ [url]: rows(30) });
  assert.equal((await s.pc.list(q('tab=featured&page=2'))).more, true);
  assert.equal(s.calls[0][0], url); assert.equal(s.calls[0][1].redirect, 'error'); assert.ok(s.calls[0][1].signal instanceof AbortSignal);
  await s.pc.list(q('tab=featured&page=2')); assert.equal(s.calls.length, 1);
  s.serve[url] = rows(29);
  s.clock.t += 600_001;
  const second = await s.pc.list(q('tab=featured&page=2'));
  assert.equal(s.calls.length, 2); assert.equal(second.more, false); assert.equal(second.carts.length, 29);
  // a failure with a copy returns it, stale
  s.serve[url] = new Error('down'); s.clock.t += 600_001;
  const stale = await s.pc.list(q('tab=featured&page=2'));
  assert.equal(stale.stale, true); assert.equal(stale.carts.length, 29);
  // no copy: 502
  await assert.rejects(s.pc.list(q('tab=new')), status(502));
  // a body of 1 MB + 1 is a failure
  const big = `${HOST}/bbs/lister.php?use_hurl=1&cat=7&sub=2&mode=carts&page=1`;
  s.serve[big] = 'x'.repeat((1 << 20) + 1);
  await assert.rejects(s.pc.list(q('tab=new')), status(502));
  // 201 distinct lists evict the first
  const e = setup(), search = i => `${HOST}/bbs/lister.php?use_hurl=1&cat=7&sub=2&mode=carts&page=1&search=s${i}`;
  for (let i = 0; i <= 200; i++) { e.serve[search(i)] = lister([]); await e.pc.list(q(`q=s${i}`)); }
  assert.equal(e.calls.length, 201);
  await e.pc.list(q('q=s1')); assert.equal(e.calls.length, 201);
  await e.pc.list(q('q=s0')); assert.equal(e.calls.length, 202);
});

test('cart info', async () => {
  const mole = '<title>Mole Mole</title> <a href="/bbs/?uid=13953">Adam Atomic</a> cart_id=molemole-1&x';
  const s = setup({ [`${HOST}/bbs/?pid=molemole-1`]: mole, [`${HOST}/bbs/?tid=148484`]: mole, [`${HOST}/bbs/?tid=5`]: '<title>Talk</title>', [`${HOST}/bbs/?pid=165759`]: mole, [`${HOST}/bbs/?pid=77`]: '<title>Plain</title>', [`${HOST}/bbs/?pid=oops-1`]: new Error('down') });
  const info = await s.pc.cart(q('pid=molemole-1'));
  assert.deepEqual(info, { pid: 'molemole-1', title: 'Mole Mole', author: 'Adam Atomic', thumb: 'pico8_molemole-1.png', embed: true });
  assert.equal(s.calls[0][0], `${HOST}/bbs/?pid=molemole-1`);
  assert.equal((await s.pc.cart(q('tid=148484'))).pid, 'molemole-1');
  assert.equal(s.calls[1][0], `${HOST}/bbs/?tid=148484`);
  await assert.rejects(s.pc.cart(q('tid=5')), status(502));
  assert.equal((await s.pc.cart(q('pid=165759'))).pid, 'molemole-1');
  assert.equal((await s.pc.cart(q('pid=77'))).thumb, thumbName('77'));
  for (const bad of ['pid=../x', `pid=${encodeURIComponent(`${HOST}/bbs/?pid=1`)}`, 'tid=12a', '']) await assert.rejects(s.pc.cart(q(bad)), status(400), bad);
  await assert.rejects(s.pc.cart(q('pid=oops-1')), status(502));
  const n = s.calls.length;
  s.clock.t += 86_400_000 - 1; await s.pc.cart(q('pid=molemole-1')); assert.equal(s.calls.length, n);
  s.clock.t += 2; await s.pc.cart(q('pid=molemole-1')); assert.equal(s.calls.length, n + 1);
});

test('thumbnails', async () => {
  const s = setup({ [`${HOST}/bbs/thumbs/pico8_a-1.png`]: PNGBYTES(10), [`${HOST}/bbs/thumbs/pico8_bad-1.png`]: 'not a png', [`${HOST}/bbs/thumbs/pico8_big-1.png`]: PNGBYTES(100 * 1024 - 7) });
  for (const bad of ['../x.png', 'pico8_A-1.png']) await assert.rejects(s.pc.thumb(bad), status(400), bad);
  await assert.rejects(s.pc.thumb('pico8_bad-1.png'), status(502));
  await assert.rejects(s.pc.thumb('pico8_big-1.png'), status(502));
  assert.equal(s.calls.at(-1)[0], `${HOST}/bbs/thumbs/pico8_big-1.png`);
  const png = await s.pc.thumb('pico8_a-1.png'); assert.ok(Buffer.isBuffer(png));
  const n = s.calls.length;
  await s.pc.thumb('pico8_a-1.png'); assert.equal(s.calls.length, n);
  s.clock.t += 86_400_001; await s.pc.thumb('pico8_a-1.png'); assert.equal(s.calls.length, n + 1);
  const e = setup(), name = i => `pico${i}.png`;
  for (let i = 0; i <= 300; i++) { e.serve[`${HOST}/bbs/thumbs/${name(i)}`] = PNGBYTES(); await e.pc.thumb(name(i)); }
  assert.equal(e.calls.length, 301);
  await e.pc.thumb(name(1)); assert.equal(e.calls.length, 301);
  await e.pc.thumb(name(0)); assert.equal(e.calls.length, 302);

  // an LRU: a hit keeps its entry, the least recently used one goes
  const l = setup();
  for (let i = 0; i < 300; i++) l.serve[`${HOST}/bbs/thumbs/${name(i)}`] = PNGBYTES();
  l.serve[`${HOST}/bbs/thumbs/${name(300)}`] = PNGBYTES();
  for (let i = 0; i < 300; i++) await l.pc.thumb(name(i));
  await l.pc.thumb(name(0)); await l.pc.thumb(name(300));
  assert.equal(l.calls.length, 301);
  await l.pc.thumb(name(0)); assert.equal(l.calls.length, 301);
  await l.pc.thumb(name(1)); assert.equal(l.calls.length, 302);
});

const LIST1 = `${HOST}/bbs/lister.php?use_hurl=1&cat=7&sub=2&mode=carts&page=1&orderby=featured`;
const MOLE = '<title>Mole Mole</title> cart_id=molemole-1';

test('a non-ok status is a failure even with a valid body', async () => {
  const s = setup({ [LIST1]: { status: 404, body: lister([ROWS[0]]) }, [`${HOST}/bbs/?pid=molemole-1`]: { status: 404, body: MOLE }, [`${HOST}/bbs/thumbs/pico8_a-1.png`]: { status: 404, body: PNGBYTES() } });
  await assert.rejects(s.pc.list(q('')), status(502));
  await assert.rejects(s.pc.cart(q('pid=molemole-1')), status(502));
  await assert.rejects(s.pc.thumb('pico8_a-1.png'), status(502));
});

test('a declared oversize body fails; exactly 1 MB passes', async () => {
  const body = 'pdat=[' + ' '.repeat((1 << 20) - 6);
  const s = setup({ [LIST1]: { body: lister([]), headers: { 'content-length': String((1 << 20) + 1) } } });
  await assert.rejects(s.pc.list(q('')), status(502));
  s.serve[LIST1] = body; assert.equal(body.length, 1 << 20);
  assert.deepEqual((await s.pc.list(q(''))).carts, []);
});

test('a list page without pdat is a failure, an empty pdat is an empty list', async () => {
  const s = setup({ [LIST1]: lister([ROWS[0]]) });
  assert.equal((await s.pc.list(q(''))).carts.length, 1);
  s.serve[LIST1] = '<html>captcha</html>'; s.clock.t += 600_001;
  const stale = await s.pc.list(q(''));
  assert.equal(stale.stale, true); assert.equal(stale.carts.length, 1);
  const n = setup({ [LIST1]: '<html>maintenance</html>' });
  await assert.rejects(n.pc.list(q('')), status(502));
  n.serve[LIST1] = lister([]);
  assert.deepEqual(await n.pc.list(q('')), { carts: [], page: 1, more: false });
});

test('entities decode once', () => {
  const t = html => parseCart(`<title>${html}</title>`).title;
  assert.equal(t('a &gt; b &quot;c&quot; &#39;d&#39; &#65;&#x41;'), 'a > b "c" \'d\' AA');
  assert.equal(t('&amp;lt;'), '&lt;');
  const row = "['1', 2, `&amp;lt; &#x41;`,\"/bbs/thumbs/pico8_x-1.png\",1,1,\"x\",5,\"&#65;&amp;gt;\",\"u\",0,\"\",7,1,";
  assert.deepEqual([parseList(lister([row]))[0].title, parseList(lister([row]))[0].author], ['&lt; A', 'A&gt;']);
});

test('a pid or thumb read from a page is checked', async () => {
  const s = setup({
    [`${HOST}/bbs/?pid=real-1`]: '<title>T</title> cart_id=Evil_X',
    [`${HOST}/bbs/?tid=9`]: '<title>T</title> cart_id=Evil_X',
    [`${HOST}/bbs/?pid=ok-2`]: '<title>T</title> cart_id=ok-2 pico8_ok-2.png',
    [`${HOST}/bbs/?tid=8`]: '<title>T</title> cart_id=tid-1 pico8_nodash.png',
  });
  assert.equal((await s.pc.cart(q('pid=real-1'))).pid, 'real-1');
  assert.equal((await s.pc.cart(q('pid=real-1'))).thumb, 'pico8_real-1.png');
  await assert.rejects(s.pc.cart(q('tid=9')), status(502));
  const odd = await s.pc.cart(q('tid=8'));
  assert.deepEqual([odd.pid, odd.thumb], ['tid-1', 'pico8_tid-1.png']);
});

// ---- the saved desktop ----
const refuse = async () => { throw new Error('no network'); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'));
const page = (pid, title = 'T', author = 'Au', extra = '') => `<title>${title}</title> <a href="/bbs/?uid=1">${author}</a> cart_id=${pid} pico8_${pid}.png ${extra}`;
const fresh = () => createOfficePc({ dir: tmp(), fetch: refuse });
const mine = pc => pc.desktop().icons.filter(i => i.id !== 'browser' && i.id !== 'salaries');

test('a new desktop has the built-ins and the four starters', () => {
  const d = fresh().desktop();
  assert.deepEqual(d.icons.map(i => i.pid), STARTERS.map(s => s.pid));
  assert.deepEqual([d.spots.browser, d.spots.salaries, d.spots.i4], [[0, 0], [0, 1], [1, 0]]);
  assert.equal(d.imported, false); assert.deepEqual(d.order, ['notepad', 'browser', 'pico8']);
  assert.deepEqual(d.icons[0], { id: 'i1', kind: 'cart', pid: STARTERS[0].pid, name: STARTERS[0].title, author: STARTERS[0].author, embed: true });
});
test('a damaged desktop file is repaired on load', () => {
  const at = tmp(); fs.writeFileSync(path.join(at, 'office-pc.json'), JSON.stringify({ version: 1, icons: [
    { id: 'i1', kind: 'cart', pid: 'a-1', name: 'A', author: '', embed: true }, { id: 'i2', kind: 'cart', pid: 'b-1', name: 'B', author: '', embed: true },
    { id: 'i3', kind: 'virus', name: 'X' }, { id: 'i4', kind: 'link', url: 'http://x.test', name: 'Y' }, { id: 'i1', kind: 'link', url: 'https://x.test', name: 'dup' }],
    spots: { browser: [0, 0], salaries: [0, 1], i1: [3, 3], i2: [3, 3] }, windows: { notepad: { open: true, x: -9999, y: 0 } }, order: [] }));
  const d = createOfficePc({ dir: at, fetch: refuse }).desktop();
  assert.deepEqual(d.icons.map(i => i.id), ['i1', 'i2']);
  assert.deepEqual([d.spots.i1, d.spots.i2], [[3, 3], [0, 2]]);
  assert.equal(d.windows.notepad.x, -440);
});
test('a file that is not a version 1 object gives a new desktop', () => {
  for (const text of ['[]', 'null', '{ "version": 2 }', 'not json']) {
    const at = tmp(); fs.writeFileSync(path.join(at, 'office-pc.json'), text);
    assert.equal(createOfficePc({ dir: at, fetch: refuse }).desktop().icons.length, 4, text);
  }
});

test('add a cart: author and embed from the page, first free spot, no refetch of an installed pid', async () => {
  const s = setup({ [`${HOST}/bbs/?pid=new-1`]: page('new-1', 'New One', 'Zed', 'do not allow embedded playback') });
  const d = await s.pc.apply({ op: 'add', kind: 'cart', pid: 'new-1' });
  assert.deepEqual(d.icons.at(-1), { id: 'i5', kind: 'cart', pid: 'new-1', name: 'New One', author: 'Zed', embed: false });
  assert.deepEqual(d.spots.i5, [1, 1]);
  const n = s.calls.length;
  await assert.rejects(s.pc.apply({ op: 'add', kind: 'cart', pid: 'new-1' }), status(409));
  assert.equal(s.calls.length, n);
});
test('add by a pid whose page names an installed cart is a 409; a 502 passes through', async () => {
  const s = setup({ [`${HOST}/bbs/?pid=molemole-1`]: page('molemole-1'), [`${HOST}/bbs/?pid=165759`]: page('molemole-1') });
  await s.pc.apply({ op: 'add', kind: 'cart', pid: 'molemole-1' });
  await assert.rejects(s.pc.apply({ op: 'add', kind: 'cart', pid: '165759' }), status(409));
  await assert.rejects(s.pc.apply({ op: 'add', kind: 'cart', pid: 'gone-1' }), status(502));
});
test('add a link, remove, rename, move, arrange and windows', async () => {
  const s = setup(); const { pc } = s;
  let d = await pc.apply({ op: 'add', kind: 'link', url: 'https://example.test/a', name: '  Ex  ' });
  assert.deepEqual(d.icons.at(-1), { id: 'i5', kind: 'link', url: 'https://example.test/a', name: 'Ex' });
  d = await pc.apply({ op: 'rename', id: 'i5', name: 'a\u0007b' }); assert.equal(d.icons.at(-1).name, 'ab');
  for (const name of ['', 'x'.repeat(41), '   ']) await assert.rejects(pc.apply({ op: 'rename', id: 'i5', name }), status(400));
  await assert.rejects(pc.apply({ op: 'move', id: 'i5', spot: [0, 0] }), status(409));
  await assert.rejects(pc.apply({ op: 'move', id: 'i5', spot: [10, 0] }), status(400));
  await assert.rejects(pc.apply({ op: 'move', id: 'i5', spot: [0, -1] }), status(400));
  d = await pc.apply({ op: 'move', id: 'i5', spot: [9, 4] }); assert.deepEqual(d.spots.i5, [9, 4]);
  d = await pc.apply({ op: 'remove', id: 'i2' }); assert.equal(d.spots.i2, undefined); assert.equal(d.icons.some(i => i.id === 'i2'), false);
  d = await pc.apply({ op: 'arrange' });
  assert.deepEqual(['browser', 'salaries', 'i1', 'i3', 'i4', 'i5'].map(id => d.spots[id]), [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 0]]);
  d = await pc.apply({ op: 'windows', windows: { notepad: { open: true, x: -9999, y: 3 } }, order: ['browser', 'pico8', 'notepad'] });
  assert.deepEqual([d.windows.notepad.open, d.windows.notepad.x, d.order], [true, -440, ['browser', 'pico8', 'notepad']]);
  for (const id of ['browser', 'salaries']) { await assert.rejects(pc.apply({ op: 'remove', id }), status(400)); await assert.rejects(pc.apply({ op: 'rename', id, name: 'x' }), status(400)); }
  for (const op of [{ op: 'remove', id: 'i99' }, { op: 'rename', id: 'i99', name: 'x' }, { op: 'move', id: 'i99', spot: [1, 1] }, { op: 'nope' }, null])
    await assert.rejects(pc.apply(op), status(400), JSON.stringify(op));
});
test('limits: 48 own icons, https links of 500 characters, real pids', async () => {
  const { pc } = setup();
  for (let i = 0; i < 44; i++) await pc.apply({ op: 'add', kind: 'link', url: `https://e.test/${i}`, name: `L${i}` });
  assert.equal(mine(pc).length, 48);
  await assert.rejects(pc.apply({ op: 'add', kind: 'link', url: 'https://e.test/x', name: 'x' }), e => e.status === 400 && /Not enough desktop space/.test(e.message));
  await pc.apply({ op: 'remove', id: 'i5' });
  await assert.rejects(pc.apply({ op: 'add', kind: 'link', url: 'ftp://e.test/x', name: 'x' }), status(400));
  await assert.rejects(pc.apply({ op: 'add', kind: 'link', url: 'https://e.test/' + 'x'.repeat(490), name: 'x' }), status(400));
  await assert.rejects(pc.apply({ op: 'add', kind: 'link', url: 'nonsense', name: 'x' }), status(400));
  for (const pid of ['../x', 'https://www.lexaloffle.com/bbs/?pid=1', 7, undefined]) await assert.rejects(pc.apply({ op: 'add', kind: 'cart', pid }), status(400), String(pid));
});
test('import: oldest first, installed skipped, once, info failures fall back, stops at 48', async () => {
  const s = setup({ [`${HOST}/bbs/?pid=p-1`]: page('p-1', 'P One', 'Q'), [`${HOST}/bbs/?pid=r-1`]: page('r-1', 'R One') });
  let d = await s.pc.apply({ op: 'import', pids: ['p-1', STARTERS[1].pid, 'r-1'] });
  assert.deepEqual(d.icons.slice(4).map(i => [i.pid, i.name]), [['p-1', 'P One'], ['r-1', 'R One']]);
  assert.equal(d.imported, true);
  const n = s.calls.length; d = await s.pc.apply({ op: 'import', pids: ['zz-1'] });
  assert.equal(d.icons.length, 6); assert.equal(s.calls.length, n);
  const f = setup(); d = await f.pc.apply({ op: 'import', pids: ['off-1'] });
  assert.deepEqual(d.icons.at(-1), { id: 'i5', kind: 'cart', pid: 'off-1', name: 'off-1', author: '', embed: true });
  const full = setup(); for (let i = 0; i < 44; i++) await full.pc.apply({ op: 'add', kind: 'link', url: `https://e.test/${i}`, name: `L${i}` });
  d = await full.pc.apply({ op: 'import', pids: ['x-1', 'x-2'] }); assert.equal(mine(full.pc).length, 48); assert.equal(d.imported, true);
  for (const pids of ['x', ['../x'], Array.from({ length: 9 }, (_, i) => `a-${i}`), [3]]) await assert.rejects(setup().pc.apply({ op: 'import', pids }), status(400));
});
test('writes are 0600, atomic and read back by a new instance', async () => {
  const s = setup(); await s.pc.apply({ op: 'add', kind: 'link', url: 'https://e.test/', name: 'E' });
  const file = path.join(s.pc.dir, 'office-pc.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(s.pc.dir).filter(f => f.endsWith('.tmp')), []);
  assert.deepEqual(createOfficePc({ dir: s.pc.dir, fetch: refuse }).desktop(), s.pc.desktop());
});
test('thumbnails of installed carts are kept on disk and go with the last icon', async () => {
  const name = thumbName(STARTERS[0].pid), url = `${HOST}/bbs/thumbs/${name}`, other = `${HOST}/bbs/thumbs/pico8_stranger-1.png`;
  const s = setup({ [url]: PNGBYTES(4), [other]: PNGBYTES(4) });
  const file = path.join(s.pc.dir, 'office-pc-thumbs', name);
  await s.pc.thumb('pico8_stranger-1.png'); assert.equal(fs.existsSync(path.join(s.pc.dir, 'office-pc-thumbs', 'pico8_stranger-1.png')), false);
  await s.pc.thumb(name); assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter(f => f.endsWith('.tmp')), []);
  const again = createOfficePc({ dir: s.pc.dir, fetch: refuse });
  assert.ok((await again.thumb(name)).equals(PNGBYTES(4)));
  await s.pc.apply({ op: 'remove', id: 'i1' }); assert.equal(fs.existsSync(file), false);
});
test('a thumbnail file stays while another icon has the pid', async () => {
  const pid = STARTERS[0].pid, name = thumbName(pid);
  // A second icon with the same pid can only come from a hand-edited file.
  const at = tmp(); fs.mkdirSync(path.join(at, 'office-pc-thumbs')); fs.writeFileSync(path.join(at, 'office-pc-thumbs', name), PNGBYTES(2));
  fs.writeFileSync(path.join(at, 'office-pc.json'), JSON.stringify({ version: 1, icons: [{ id: 'i1', kind: 'cart', pid, name: 'A', author: '', embed: true }, { id: 'i2', kind: 'cart', pid, name: 'B', author: '', embed: true }], spots: {} }));
  const pc = createOfficePc({ dir: at, fetch: refuse });
  await pc.apply({ op: 'remove', id: 'i1' }); assert.equal(fs.existsSync(path.join(at, 'office-pc-thumbs', name)), true);
  await pc.apply({ op: 'remove', id: 'i2' }); assert.equal(fs.existsSync(path.join(at, 'office-pc-thumbs', name)), false);
});

test('routes: login, size, activity, thumbnail headers and 503 without pc', async () => {
  const touched = [], pc = setup({ [`${HOST}/bbs/thumbs/pico8_x-1.png`]: PNGBYTES(3) }).pc;
  let session = { key: 'k', csrf: 'c' };
  const make = pcArg => createHandler({ auth: { get: async () => session, touch: s => touched.push(s) }, origin: 'https://control.test', pc: pcArg, snapshot: () => ({}), vite: () => {} });
  const call = async (handler, method, url, body) => {
    const req = Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), { url, method, socket: {},
      headers: { host: 'control.test', origin: 'https://control.test', 'content-type': 'application/json', 'x-csrf-token': 'c' } });
    const res = { statusCode: 200, headers: {}, headersSent: false, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(raw) { this.raw = raw; this.headersSent = true; } };
    await handler(req, res); return res;
  };
  const h = make(pc);
  session = null; assert.equal((await call(h, 'GET', '/api/office/pc')).statusCode, 401); session = { key: 'k', csrf: 'c' };
  const got = await call(h, 'GET', '/api/office/pc'); assert.equal(got.statusCode, 200); assert.equal(JSON.parse(got.raw).icons.length, 4); assert.equal(touched.length, 0);
  assert.equal((await call(h, 'POST', '/api/office/pc', { op: 'arrange', pad: 'x'.repeat(5000) })).statusCode, 413);
  const ok = await call(h, 'POST', '/api/office/pc', { op: 'add', kind: 'link', url: 'https://e.test/', name: 'E' });
  assert.equal(ok.statusCode, 200); assert.equal(JSON.parse(ok.raw).icons.length, 5); assert.equal(touched.length, 1);
  assert.equal((await call(h, 'POST', '/api/office/pc', { op: 'nope' })).statusCode, 400);
  const png = await call(h, 'GET', '/api/office/bbs/thumb/pico8_x-1.png');
  assert.deepEqual([png.statusCode, png.headers['content-type'], png.headers['cache-control'], png.headers['content-length']], [200, 'image/png', 'private, max-age=86400', 11]);
  assert.equal((await call(h, 'GET', '/api/office/bbs/thumb/%E0%A4%A')).statusCode, 400);
  assert.equal((await call(h, 'GET', '/api/office/bbs/thumb/bad.png')).statusCode, 400);
  assert.equal((await call(h, 'GET', '/api/office/bbs/list?page=99')).statusCode, 400);
  assert.equal((await call(h, 'GET', '/api/office/bbs/cart?pid=..')).statusCode, 400);
  const none = make(undefined);
  for (const [m, u] of [['GET', '/api/office/pc'], ['POST', '/api/office/pc'], ['GET', '/api/office/bbs/list'], ['GET', '/api/office/bbs/cart?pid=a-1'], ['GET', '/api/office/bbs/thumb/pico8_x-1.png']])
    assert.equal((await call(none, m, u, m === 'POST' ? {} : undefined)).statusCode, 503, u);
});
