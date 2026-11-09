import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCode, createOfficeOnline } from '../server/office-online.mjs';
import { hubState, newKey, startHub } from '../server/hub.mjs';

const K = 'k'.repeat(22), dir = () => mkdtempSync(join(tmpdir(), 'online-'));
// A real hub on a free port (or `port`), its code, and an AI Control's side of it counting what it sends.
async function setup({ port = 0, hubFile = join(dir(), 'hub.json'), now, hostToken } = {}) {
  const hub = await startHub({ file: hubFile, port, hostToken }), at = hub.server.address().port;
  const code = () => `http://127.0.0.1:${at}/${hubState(hubFile).key}`;
  const counter = { calls: 0 }, counting = (...args) => { counter.calls++; return fetch(...args); };
  const online = createOfficeOnline({ file: join(dir(), 'office-online.json'), fetch: counting, ...now ? { now } : {} });
  return { hub, hubFile, port: at, code, counter, online };
}
const status = async promise => { try { await promise; return 0; } catch (error) { return error.status; } };

test('parseCode', () => {
  assert.deepEqual(parseCode(`pc.tail1.ts.net/${K}`), { url: 'https://pc.tail1.ts.net', key: K });
  assert.deepEqual(parseCode(` http://127.0.0.1:9/${K}/ `), { url: 'http://127.0.0.1:9', key: K });
  assert.deepEqual(parseCode(`https://host.example/hub/${K}`), { url: 'https://host.example/hub', key: K });
  for (const bad of [`pc.ts.net/${K.slice(1)}`, `ftp://x/${K}`, '', 'pc.ts.net', null]) assert.throws(() => parseCode(bad), e => e.status === 400, String(bad));
});

test('join, sync and status', async t => {
  const s = await setup(); t.after(() => s.hub.close());
  assert.deepEqual(s.online.status(), { joined: false });
  assert.deepEqual(await s.online.sync({ darts: 9 }), { joined: false });
  const joined = await s.online.join({ code: s.code(), name: ' Anna ' });
  assert.equal(joined.joined, true); assert.equal(joined.name, 'Anna'); assert.equal(joined.host, '127.0.0.1');
  assert.deepEqual(joined.board.players.map(p => p.name), ['Anna']);
  const synced = await s.online.sync({ darts: 9 });
  assert.deepEqual(synced.board.players[0].scores, { darts: 9 });
  assert.deepEqual(s.online.status(), { joined: true, name: 'Anna', host: '127.0.0.1' });
});

test("unchanged scores within 10 s don't call the hub", async t => {
  let clock = 1000;
  const s = await setup({ now: () => clock }); t.after(() => s.hub.close());
  await s.online.join({ code: s.code(), name: 'Anna' });
  s.counter.calls = 0;
  await s.online.sync({ darts: 9 }); await s.online.sync({ darts: 9 });
  assert.equal(s.counter.calls, 1);
  clock += 10_001;
  await s.online.sync({ darts: 9 });
  assert.equal(s.counter.calls, 2);
  await s.online.sync({ darts: 8 });
  assert.equal(s.counter.calls, 3);
});

test('concurrent syncs share one request', async t => {
  const s = await setup(); t.after(() => s.hub.close());
  await s.online.join({ code: s.code(), name: 'Anna' });
  s.counter.calls = 0;
  const [a, b] = await Promise.all([s.online.sync({ pinball: 5 }), s.online.sync({ pinball: 5 })]);
  assert.equal(s.counter.calls, 1);
  assert.deepEqual(a.board, b.board);
});

test('offline returns the last board', async () => {
  const s = await setup();
  await s.online.join({ code: s.code(), name: 'Anna' });
  const before = await s.online.sync({ darts: 9 });
  await s.hub.close();
  const started = Date.now(), after = await s.online.sync({ darts: 7 });
  assert.ok(Date.now() - started < 5000);
  assert.equal(after.offline, true);
  assert.deepEqual(after.board, before.board);
});

test('a replaced code is reported, and rejoining keeps the name', async () => {
  const s = await setup();
  await s.online.join({ code: s.code(), name: 'Anna' });
  await s.hub.close();
  newKey(s.hubFile);
  const again = await startHub({ file: s.hubFile, port: s.port });
  try {
    const result = await s.online.sync({ snake: 3 });
    assert.equal(result.error, 'code');
    const rejoined = await s.online.join({ code: s.code(), name: 'Anna' });
    assert.deepEqual(rejoined.board.players.map(p => p.name), ['Anna']);
  } finally { await again.close(); }
});

test('leave keeps the token', async t => {
  const s = await setup(); t.after(() => s.hub.close());
  await s.online.join({ code: s.code(), name: 'Anna' });
  await s.online.leave();
  assert.deepEqual(s.online.status(), { joined: false });
  const back = await s.online.join({ code: s.code(), name: 'Anna' });
  assert.equal(back.joined, true);
});

// Never 401: the page takes a 401 from its own server to mean it's locked, and shows the PIN screen (main.js api()).
test('a taken name and a wrong key throw 409 and 403; a bad name 400', async t => {
  const s = await setup(); t.after(() => s.hub.close());
  await s.online.join({ code: s.code(), name: 'Anna' });
  const other = createOfficeOnline({ file: join(dir(), 'office-online.json') });
  assert.equal(await status(other.join({ code: s.code(), name: 'anna' })), 409);
  assert.equal(await status(other.join({ code: `http://127.0.0.1:${s.port}/${K}`, name: 'Bo' })), 403);
  assert.equal(await status(other.join({ code: s.code(), name: '<b>' })), 400);
  assert.equal(await status(other.join({ code: `http://127.0.0.1:1/${K}`, name: 'Bo' })), 502);
  assert.deepEqual(other.status(), { joined: false });
});

test('the file is private and survives a restart', async t => {
  const s = await setup(); t.after(() => s.hub.close());
  const file = join(dir(), 'office-online.json'), online = createOfficeOnline({ file });
  await online.join({ code: s.code(), name: 'Anna' });
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(createOfficeOnline({ file }).status(), { joined: true, name: 'Anna', host: '127.0.0.1' });
});

test("a sign-in written by another process (npm run hub) is the running server's, token and all", async t => {
  const s = await setup(); t.after(() => s.hub.close());
  const file = join(dir(), 'office-online.json'), server = createOfficeOnline({ file });
  assert.deepEqual(server.status(), { joined: false });
  await createOfficeOnline({ file }).join({ code: s.code(), name: 'Anna' });
  assert.deepEqual(server.status(), { joined: true, name: 'Anna', host: '127.0.0.1' });
  assert.deepEqual((await server.sync({ darts: 9 })).board.players.map(p => [p.name, p.scores]), [['Anna', { darts: 9 }]]);
});

test("the hub marks its host, and that's all the mark says", async t => {
  const file = join(dir(), 'office-online.json'), s = await setup({ hostToken: () => JSON.parse(readFileSync(file, 'utf8')).token }); t.after(() => s.hub.close());
  await createOfficeOnline({ file }).join({ code: s.code(), name: 'Host' });
  const board = (await s.online.join({ code: s.code(), name: 'Anna' })).board;
  assert.deepEqual(board.players.map(p => [p.name, p.host]), [['Host', true], ['Anna', undefined]]);
});

test('a bad hub response is offline', async () => {
  let reply = null;
  const board = players => JSON.stringify({ day: '2026-11-09', players });
  const fake = async () => new Response(reply, { status: 200, headers: { 'content-type': 'application/json' } });
  const online = createOfficeOnline({ file: join(dir(), 'office-online.json'), fetch: fake });
  reply = board([{ name: 'Anna', scores: {}, seen: 1 }]);
  const joined = await online.join({ code: `x.ts.net/${K}`, name: 'Anna' });
  for (const bad of ['x'.repeat(70_000), JSON.stringify({ day: '2026-11-09', players: 'x' }), '{nope']) {
    reply = bad;
    const result = await online.sync({ darts: Math.random() * 100 + 1 | 0 });
    assert.equal(result.offline, true);
    assert.deepEqual(result.board, joined.board);
  }
  reply = board([{ name: '<script>', scores: { darts: 3 }, seen: 1 }, { name: 'Bo', scores: { darts: 0, pinball: 5 }, seen: 'x' }]);
  const result = await online.sync({ darts: 4 });
  assert.equal(result.offline, undefined);
  assert.deepEqual(result.board.players, [{ name: 'Bo', scores: { pinball: 5 }, seen: 0 }]);
});

test('only clean scores leave: the server enforces the allowlist, not the page', async () => {
  const sent = [];
  const fake = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ day: '2026-11-09', players: [] }), { status: 200 }); };
  const online = createOfficeOnline({ file: join(dir(), 'office-online.json'), fetch: fake });
  await online.join({ code: `x.ts.net/${K}`, name: 'Anna' });
  await online.sync({ darts: 9, pinball: -5, history: 'secret session text', trickshotToday: { day: '1999-01-01', score: 5 } });
  assert.deepEqual(Object.keys(sent.at(-1)).sort(), ['name', 'scores', 'token']);
  assert.deepEqual(sent.at(-1).scores, { darts: 9 });
});

test("a hub's redirect is not followed", async t => {
  const { createServer } = await import('node:http');
  let reached = 0;
  const target = createServer((req, res) => { reached++; res.end(JSON.stringify({ day: '2026-11-09', players: [] })); });
  await new Promise(r => target.listen(0, '127.0.0.1', r));
  const hub = createServer((req, res) => { res.statusCode = 307; res.setHeader('location', `http://127.0.0.1:${target.address().port}/scores`); res.end(); });
  await new Promise(r => hub.listen(0, '127.0.0.1', r));
  t.after(() => { target.close(); hub.close(); });
  const online = createOfficeOnline({ file: join(dir(), 'office-online.json') });
  assert.equal(await status(online.join({ code: `http://127.0.0.1:${hub.address().port}/${K}`, name: 'Anna' })), 502);
  assert.equal(reached, 0);
});
