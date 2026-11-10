import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AWAY, hubState, newKey, startHub } from '../server/hub.mjs';
import { dayKey } from '../client/office/daily.js';
import { COLOURS } from '../client/office/meeting.js';
const DAY = 86_400_000;

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
  assert.deepEqual({ ...board.players[0], seen: 0 }, { name: 'Anna', scores: {}, seen: 0, in: true });
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
  const why = await taken.json(); assert.match(why.error, /taken/); assert.equal(why.why, 'name');
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

test('a sign-in lasts 2 days from when you were last on; a Join signs you back in', async t => {
  let skew = 0; const h = await hub({ now: () => Date.now() + skew }); t.after(() => h.close());
  assert.equal(AWAY, 2 * DAY);
  assert.equal((await h.post({ ...join_('Anna'), join: true })).status, 200);
  skew = AWAY - 60_000; assert.equal((await h.post({ ...join_('Anna'), join: false })).status, 200);
  skew += AWAY + 60_000; const away = await h.post({ ...join_('Anna'), join: false });
  assert.equal(away.status, 403); assert.equal((await away.json()).why, 'away');
  assert.equal((await h.post(join_('Anna'))).status, 200, 'no join flag: an older page, always a Join');
  skew += AWAY + 60_000; assert.equal((await h.post({ ...join_('Anna'), join: true })).status, 200);
});
test('the host never lapses', async t => {
  let skew = 0; const h = await hub({ now: () => Date.now() + skew, hostToken: () => token('h') }); t.after(() => h.close());
  await h.post({ ...join_('Host', 'h'), join: true }); skew = 10 * AWAY;
  assert.equal((await h.post({ ...join_('Host', 'h'), join: false })).status, 200);
});
test('a colour is held while its owner is signed in, and comes free when they change it or lapse', async t => {
  let skew = 0; const h = await hub({ now: () => Date.now() + skew }); t.after(() => h.close());
  assert.equal((await h.post({ ...join_('Anna', 'a'), join: true, colour: COLOURS[0] })).status, 200);
  const taken = await h.post({ ...join_('Bo', 'b'), join: true, colour: COLOURS[0] });
  assert.equal(taken.status, 409); assert.deepEqual(await taken.json(), { error: 'That colour is taken.', why: 'colour', taken: [COLOURS[0]] });
  const board = await (await h.post({ ...join_('Bo', 'b'), join: true, colour: COLOURS[1] })).json();
  assert.deepEqual(board.players.map(p => p.name), ['Anna', 'Bo'], 'the refusal changed nothing');
  await h.post({ ...join_('Anna', 'a'), join: false, colour: COLOURS[2] });
  assert.equal((await h.post({ ...join_('Cy', 'c'), join: true, colour: COLOURS[0] })).status, 200, 'changing frees the old one');
  skew = AWAY + 60_000;
  assert.equal((await h.post({ ...join_('Di', 'd'), join: true, colour: COLOURS[1] })).status, 200, 'Bo lapsed');
});
test('all eight held: "All colours are taken."', async t => {
  const h = await hub(); t.after(() => h.close());
  for (let i = 0; i < 8; i++) assert.equal((await h.post({ ...join_(`P${i}`, 'abcdefgh'[i]), join: true, colour: COLOURS[i] })).status, 200);
  const r = await h.post({ ...join_('Late', 'z'), join: true, colour: COLOURS[3] });
  assert.equal(r.status, 409); assert.equal((await r.json()).error, 'All colours are taken.');
  // At most 8 signed in: coming in with no colour, there's none left to have.
  for (const body of [{ ...join_('Late', 'z'), join: true }, join_('Late', 'z')]) {
    const none = await h.post(body);
    assert.equal(none.status, 409); assert.deepEqual(await none.json(), { error: 'All colours are taken.', why: 'colour', taken: COLOURS });
  }
  for (let i = 0; i < 8; i++) assert.equal((await h.post({ ...join_(`P${i}`, 'abcdefgh'[i]), join: i % 2 === 0, colour: COLOURS[i] })).status, 200, 'owners still sync and rejoin');
  const board = await (await h.post({ ...join_('P0', 'a'), join: false, colour: COLOURS[0] })).json();
  assert.equal(board.players.length, 8, 'the refusals added no one');
});
test('the board says who is signed in and their colour; a POST with no colour holds none', async t => {
  let skew = 0; const h = await hub({ now: () => Date.now() + skew }); t.after(() => h.close());
  await h.post({ ...join_('Anna', 'a'), join: true, colour: COLOURS[1] });
  await h.post({ ...join_('Cy', 'c'), join: true, colour: COLOURS[2] }); await h.post(join_('Cy', 'c'));
  assert.equal((await h.post({ ...join_('Dee', 'd'), join: true, colour: COLOURS[2] })).status, 200); // Cy is still in, holding none
  skew = AWAY + 60_000;
  const board = await (await h.post({ ...join_('Bo', 'b'), join: true, colour: COLOURS[2] })).json();
  assert.deepEqual(board.players.map(p => [p.name, p.in, p.colour]), [['Anna', undefined, undefined], ['Cy', undefined, undefined], ['Dee', undefined, undefined], ['Bo', true, COLOURS[2]]]);
});
