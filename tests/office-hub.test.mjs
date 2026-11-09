import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hubState, newKey, startHub } from '../server/hub.mjs';
import { dayKey } from '../client/office/daily.js';

const fresh = () => join(mkdtempSync(join(tmpdir(), 'hub-')), 'hub.json');
const token = c => c.repeat(22);
// A hub on a free port; `post` sends a body (or raw text) with a key.
async function hub(options = {}) {
  const file = options.file ?? fresh(), h = await startHub({ port: 0, ...options, file }), port = h.server.address().port;
  const post = (body, key = hubState(file).key, { raw, type = 'application/json' } = {}) => fetch(`http://127.0.0.1:${port}/scores`, {
    method: 'POST', headers: { 'content-type': type, ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: raw ?? JSON.stringify(body),
  });
  return { ...h, file, port, post };
}
const join_ = (name, c = 'a', scores = {}) => ({ token: token(c), name, scores });

test('refuses a missing or wrong key, and anything but POST /scores', async t => {
  const h = await hub(); t.after(() => h.close());
  assert.equal((await h.post(join_('Anna'), null)).status, 401);
  assert.equal((await h.post(join_('Anna'), 'x'.repeat(22))).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${h.port}/`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${h.port}/scores`)).status, 404);
});

test('registers and answers the board', async t => {
  const h = await hub(); t.after(() => h.close());
  const res = await h.post(join_('Anna')), board = await res.json();
  assert.equal(res.status, 200);
  assert.equal(board.day, dayKey(new Date()));
  assert.equal(board.players.length, 1);
  assert.deepEqual({ ...board.players[0], seen: 0 }, { name: 'Anna', scores: {}, seen: 0 });
  assert.equal(typeof board.players[0].seen, 'number');
});

test('merges bests over requests', async t => {
  const h = await hub(); t.after(() => h.close());
  for (const scores of [{ darts: 11, pinball: 500 }, { darts: 9, pinball: 300, chess: 1 }, { darts: 12, snake: -4 }]) assert.equal((await h.post(join_('Anna', 'a', scores))).status, 200);
  const board = await (await h.post(join_('Anna'))).json();
  assert.deepEqual(board.players[0].scores, { darts: 9, pinball: 500 });
});

test("a name is one token's", async t => {
  const h = await hub(); t.after(() => h.close());
  await h.post(join_('Anna', 'a'));
  const taken = await h.post(join_('anna', 'b'));
  assert.equal(taken.status, 409);
  assert.match((await taken.json()).error, /taken/);
  assert.equal((await h.post(join_('Annie', 'a'))).status, 200);
  const board = await (await h.post(join_('anna', 'b'))).json();
  assert.deepEqual(board.players.map(p => p.name).sort(), ['Annie', 'anna']);
});

test('rejects malformed requests', async t => {
  const h = await hub(); t.after(() => h.close());
  assert.equal((await h.post(null, undefined, { raw: '{nope' })).status, 400);
  assert.equal((await h.post({ token: 'short', name: 'Anna', scores: {} })).status, 400);
  assert.equal((await h.post(join_('<b>'))).status, 400);
  assert.equal((await h.post(join_('Anna'), undefined, { type: 'text/plain' })).status, 415);
  assert.equal((await h.post({ ...join_('Anna'), pad: 'x'.repeat(5000) })).status, 413);
});

test('caps players and the request rate', async t => {
  let clock = 0;
  const h = await hub({ now: () => (clock += 1000) }); t.after(() => h.close()); // a second apart: no rate limit here
  for (let i = 0; i < 32; i++) assert.equal((await h.post({ token: `p${String(i).padStart(21, '0')}`, name: `P${i}`, scores: {} })).status, 200);
  assert.equal((await h.post({ token: token('z'), name: 'Late', scores: {} })).status, 429);
  const r = await hub({ now: () => 5000 }); t.after(() => r.close()); // all in one second
  for (let i = 0; i < 20; i++) assert.equal((await r.post(join_('Anna'))).status, 200);
  assert.equal((await r.post(join_('Anna'))).status, 429);
});

test('keeps state across restarts, without raw tokens', async () => {
  const first = await hub();
  await first.post(join_('Anna', 'q', { pinball: 700 }));
  const { key } = hubState(first.file);
  await first.close();
  assert.equal(statSync(first.file).mode & 0o777, 0o600);
  assert.ok(!readFileSync(first.file, 'utf8').includes(token('q')));
  const again = await hub({ file: first.file });
  try {
    assert.equal(hubState(again.file).key, key);
    const board = await (await again.post(join_('Anna', 'q'))).json();
    assert.deepEqual(board.players[0].scores, { pinball: 700 });
  } finally { await again.close(); }
});

test('newKey replaces the key and keeps the players', async () => {
  const first = await hub();
  await first.post(join_('Anna'));
  const old = hubState(first.file).key;
  await first.close();
  const key = newKey(first.file);
  assert.match(key, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(key, old);
  const again = await hub({ file: first.file });
  try {
    assert.equal((await again.post(join_('Anna'), old)).status, 401);
    const board = await (await again.post(join_('Anna'), key)).json();
    assert.deepEqual(board.players.map(p => p.name), ['Anna']);
  } finally { await again.close(); }
});
