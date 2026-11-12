import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseList, parseCart, createOfficePc } from '../server/office-pc.mjs';
import { thumbName } from '../client/office/carts.js';

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
