import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEYS, localBests, createOnline } from '../client/office/online.js';
import { MONDAY } from '../client/office/levels.js';

const store = map => ({ getItem: key => map[key] ?? null });
const date = new Date('2026-11-09T12:00:00Z');
const golf = JSON.stringify({ best: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i + 1, 2])), reached: 50, n: 1, endlessBest: 3 });
const trickshot = JSON.stringify({ lines: {}, best: { [MONDAY[0].id]: 1200 }, daily: { '2026-11-09': [100, null, 20] } });

test('localBests reads every game', () => {
  const scores = localBests(store({ [KEYS.darts]: '11', [KEYS.pinball]: '48210', [KEYS.snake]: '7', [KEYS.golf]: golf, 'aiControl.trickshot': trickshot }), date);
  assert.deepEqual(scores, { trickshotToday: { day: '2026-11-09', score: 120 }, trickshot: 1200, darts: 11, pinball: 48210, golf: 100, golfEndless: 3, snake: 7 });
});

test('blocked storage gives no scores', () => {
  assert.deepEqual(localBests({ getItem() { throw new Error('denied'); } }, date), {});
  assert.deepEqual(localBests(null, date), {});
  assert.deepEqual(localBests(store({ [KEYS.golf]: '{nope', [KEYS.darts]: '9' }), date), { darts: 9 });
});

test("the storage keys are the games' own", () => {
  for (const [game, key] of Object.entries(KEYS)) assert.ok(readFileSync(new URL(`../client/office/${game}.js`, import.meta.url), 'utf8').includes(`'${key}'`), game);
});

const board = { day: '2026-11-09', players: [{ name: 'anna', scores: { darts: 9 }, seen: 1 }, { name: 'Bo', scores: { darts: 12 }, seen: 1 }] };
const fakeApi = (reply = { joined: true, name: 'Anna', host: 'h', board }) => {
  const api = async (path, body) => { api.calls.push([path, body]); if (reply instanceof Error) throw reply; return reply; };
  api.calls = []; return api;
};

test('sync skips unchanged scores unless forced', async () => {
  const api = fakeApi(), online = createOnline({ api, scores: () => ({ darts: 9 }) });
  await online.sync(); await online.sync();
  assert.equal(api.calls.length, 1);
  assert.deepEqual(api.calls[0], ['office/scores', { scores: { darts: 9 } }]);
  await online.sync(true);
  assert.equal(api.calls.length, 2);
});

test('top is cached per board and marks you', async () => {
  const online = createOnline({ api: fakeApi(), scores: () => ({}) });
  let told = 0; online.watch(() => told++);
  assert.deepEqual(online.top('darts'), []);
  await online.sync();
  const top = online.top('darts');
  assert.equal(online.top('darts'), top);
  assert.deepEqual(top, [{ name: 'anna', value: 9, text: '9 darts', you: true }, { name: 'Bo', value: 12, text: '12 darts', you: false }]);
  assert.deepEqual(online.top('pinball'), []);
  await online.sync(true); // the same board again: nothing to redraw
  assert.equal(told, 1);
});

test('a failing api leaves the last state', async () => {
  let reply = { joined: true, name: 'Anna', host: 'h', board };
  const online = createOnline({ api: async () => { if (reply instanceof Error) throw reply; return reply; }, scores: () => ({}) });
  await online.sync();
  const before = online.state();
  reply = new Error('down');
  await online.sync(true);
  assert.equal(online.state(), before);
});

test('signing in and out', async () => {
  const api = fakeApi(), online = createOnline({ api, scores: () => ({}) });
  await online.signIn('code', 'Anna');
  assert.deepEqual(api.calls[0], ['office/online', { code: 'code', name: 'Anna' }]);
  assert.equal(online.state().joined, true);
  await assert.rejects(createOnline({ api: fakeApi(new Error('That name is taken on this hub.')), scores: () => ({}) }).signIn('c', 'x'), /taken/);
  const out = fakeApi({ joined: false }), leaving = createOnline({ api: out, scores: () => ({}) });
  await leaving.signOut();
  assert.deepEqual(out.calls.at(-1), ['office/online', { leave: true }]);
  assert.deepEqual(leaving.state(), { joined: false });
});

test('a sync that failed is sent again next time', async () => {
  let reply = { joined: true, name: 'Anna', host: 'h', board, offline: true };
  const api = async (path, body) => { api.calls++; return reply; }; api.calls = 0;
  const online = createOnline({ api, scores: () => ({ darts: 9 }) });
  await online.sync(); await online.sync();
  assert.equal(api.calls, 2);
  reply = { joined: true, name: 'Anna', host: 'h', board, error: 'code' };
  await online.sync();
  assert.equal(api.calls, 3);
  reply = { joined: true, name: 'Anna', host: 'h', board };
  await online.sync(); await online.sync();
  assert.equal(api.calls, 4);
});

test("a board that only differs in who was seen when doesn't redraw", async () => {
  let seen = 1;
  const api = async () => ({ joined: true, name: 'Anna', host: 'h', board: { ...board, players: board.players.map(p => ({ ...p, seen: seen++ })) } });
  const online = createOnline({ api, scores: () => ({}) });
  let told = 0; online.watch(() => told++);
  await online.sync(); await online.sync(true); await online.sync(true);
  assert.equal(told, 1);
});

test('signing in sends your bests straight away', async () => {
  const api = fakeApi(), online = createOnline({ api, scores: () => ({ darts: 9 }) });
  await online.signIn('code', 'Anna');
  assert.deepEqual(api.calls.map(([path]) => path), ['office/online', 'office/scores']);
});
