import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEYS, FOUND, localBests, createOnline } from '../client/office/online.js';
import { GAMES } from '../client/office/leaderboard.js';
import { MONDAY } from '../client/office/levels.js';

const store = map => ({ getItem: key => map[key] ?? null });
const date = new Date('2026-11-09T12:00:00Z');
const golf = JSON.stringify({ best: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i + 1, 2])), reached: 50, n: 1, endlessBest: 3 });
const trickshot = JSON.stringify({ lines: {}, best: { [MONDAY[0].id]: 1200 }, daily: { '2026-11-09': [100, null, 20] } });

test('localBests reads every game', () => {
  const planes = JSON.stringify({ endless: { rings: 23, time: 40.2 } });
  const scores = localBests(store({ [KEYS.darts]: '11', [KEYS.pinball]: '48210', [KEYS.snake]: '7', [KEYS.golf]: golf, [KEYS.planes]: planes, 'aiControl.trickshot': trickshot }), date);
  assert.deepEqual(scores, { trickshotToday: { day: '2026-11-09', score: 120 }, trickshot: 1200, darts: 11, pinball: 48210, golf: 100, golfEndless: 3, snake: 7, planesEndless: 23 });
});

test('blocked storage gives no scores', () => {
  assert.deepEqual(localBests({ getItem() { throw new Error('denied'); } }, date), {});
  assert.deepEqual(localBests(null, date), {});
  assert.deepEqual(localBests(store({ [KEYS.golf]: '{nope', [KEYS.planes]: '{nope', [KEYS.darts]: '9' }), date), { darts: 9 });
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
  await assert.rejects(createOnline({ api: fakeApi(new Error('That name is taken in this meeting.')), scores: () => ({}) }).signIn('c', 'x'), /taken/);
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

test('a page learns it is hosting when the live link says welcome, with no reload', async () => {
  let reply = { joined: true, name: 'Anna', host: 'h', hosting: false, board };
  const api = async () => reply, online = createOnline({ api, scores: () => ({}) });
  const handlers = {}, live = { on: (type, fn) => { handlers[type] = fn; return () => {}; } };
  online.follow(live);
  await online.sync(); assert.equal(online.state().hosting, false);
  reply = { ...reply, hosting: true, code: 'h/key' }; // the hub started, or AI Control restarted, under the open page
  handlers.welcome({ type: 'welcome' }); await new Promise(r => setTimeout(r, 0));
  assert.equal(online.state().hosting, true); assert.equal(online.state().code, 'h/key');
});

test("a hub that won't take this version's link: the page asks again, and is told to update", async () => {
  let reply = { joined: true, name: 'Anna', host: 'h', board };
  const api = async () => reply, online = createOnline({ api, scores: () => ({}) });
  const handlers = {}, live = { on: (type, fn) => { (handlers[type] ??= []).push(fn); return () => {}; } };
  online.follow(live);
  await online.sync();
  reply = { ...reply, outdated: true };
  for (const fn of handlers.refused) fn({ type: 'refused', why: 'full' });
  await new Promise(r => setTimeout(r, 0)); assert.equal(online.state().outdated, undefined, 'a full meeting is no news for the clipboard');
  for (const fn of handlers.refused) fn({ type: 'refused', why: 'version' });
  await new Promise(r => setTimeout(r, 0)); assert.equal(online.state().outdated, true);
});

test('the room going while you are in a meeting asks again, so the clipboard can say Off for now', async () => {
  let reply = { joined: true, name: 'Anna', host: 'h', board }, calls = 0;
  const api = async () => { calls++; return reply; }, online = createOnline({ api, scores: () => ({}) });
  const handlers = {}, live = { on: (type, fn) => { (handlers[type] ??= []).push(fn); return () => {}; } };
  const say = m => { for (const fn of handlers[m.type] ?? []) fn(m); }, settled = () => new Promise(r => setTimeout(r, 0));
  online.follow(live);
  await online.sync(); calls = 0;
  say({ type: 'roster', players: [{ id: 'a1', name: 'Anna', fruit: 'apple', colour: '#ff5d8f', at: 'home' }] }); await settled();
  assert.equal(calls, 0, 'a roster with people in it is no news');
  reply = { ...reply, offline: true };
  say({ type: 'roster', players: [] }); await settled();
  assert.equal(calls, 1); assert.equal(online.state().offline, true);
  // Not in a meeting: an empty room is nothing to ask about.
  reply = { joined: false }; await online.sync(true); calls = 0;
  say({ type: 'roster', players: [] }); await settled();
  assert.equal(calls, 0);
});

test('a colour refusal is sent again, and the live link hearing one, or a removal or sign-in lapse, asks again', async () => {
  const calls = [], reply = { joined: true, name: 'Anna', host: 'h', board, refused: 'colour', taken: ['#3a86ff'] };
  const online = createOnline({ api: async path => { calls.push(path); return reply; }, scores: () => ({ darts: 1 }) });
  await online.sync(); await online.sync(); assert.equal(calls.length, 2, 'not marked sent');
  const on = {}; online.follow({ on: (type, fn) => { on[type] = fn; } });
  on.refused({ type: 'refused', why: 'full' }); on.refused({ type: 'refused', why: 'colour' }); on.refused({ type: 'refused', why: 'removed' }); on.refused({ type: 'refused', why: 'away' });
  await new Promise(r => setTimeout(r)); assert.equal(calls.length, 5);
});

test("the scoreboard's rows: every game you've found, the board's best three, else your own bests alone", async () => {
  const online = createOnline({ api: fakeApi(), scores: () => ({}), store: store({ [FOUND]: JSON.stringify(GAMES.map(g => g.id)) }) });
  await online.sync();
  const rows = online.rows();
  assert.equal(rows.length, 8); assert.equal(rows.at(-1).label, 'Planes endless');
  assert.deepEqual(rows.find(r => r.id === 'darts').top, [{ name: 'anna', text: '9 darts', you: true }, { name: 'Bo', text: '12 darts', you: false }]);
  assert.deepEqual(rows.find(r => r.id === 'snake').top, []);
  let mine = { snake: 4 }, told = 0;
  const alone = createOnline({ api: fakeApi({ joined: false }), scores: () => mine });
  alone.watch(() => told++);
  await alone.sync();
  assert.deepEqual(alone.rows().find(r => r.id === 'snake').top, [{ name: 'Me', text: '4', you: true }]);
  mine = { snake: 9 }; await alone.sync();
  assert.equal(told, 3, 'the first sync, and each new best'); // first: your bests, then joined:false came back; then the new best
  assert.equal(alone.rows().find(r => r.id === 'snake').top[0].text, '9');
});

test("the scoreboard leaves out a game you haven't found: one you've played here, have a best in or are on the board for shows", async () => {
  const saved = { [FOUND]: JSON.stringify(['pinball']) }, kept = { getItem: key => saved[key] ?? null, setItem: (key, value) => { saved[key] = value; } };
  const reply = { joined: true, name: 'Anna', host: 'h', board: { day: '2026-11-09', players: [{ name: 'anna', scores: { darts: 9 }, seen: 1 }, { name: 'Bo', scores: { darts: 12, golf: 60, golfEndless: 4 }, seen: 1 }] } };
  const online = createOnline({ api: fakeApi(reply), scores: () => ({ snake: 4 }), store: kept });
  const ids = () => online.rows().map(r => r.id);
  assert.deepEqual(ids(), ['pinball', 'snake'], 'played here, and a best kept from before');
  await online.sync();
  assert.deepEqual(ids(), ['darts', 'pinball', 'snake'], "you're on the board for darts; Bo's golf stays hidden");
  assert.equal(online.discover(['golf', 'golfEndless']), true);
  assert.deepEqual(ids(), ['darts', 'pinball', 'golf', 'golfEndless', 'snake']);
  assert.deepEqual(online.rows().find(r => r.id === 'golf').top, [{ name: 'Bo', text: '60 strokes', you: false }]);
  assert.ok(['pinball', 'golf', 'golfEndless'].every(id => JSON.parse(saved[FOUND]).includes(id)), 'kept for next time');
  assert.equal(online.discover(['golf']), false, 'nothing new'); assert.equal(online.discover(undefined), false, 'a game with no rows');
  // Broken or blocked storage: nothing found before, but what you play now still shows.
  const broken = createOnline({ api: fakeApi(), scores: () => ({}), store: { getItem: () => '{nope', setItem: () => { throw new Error('full'); } } });
  assert.deepEqual(broken.rows().map(r => r.id), []);
  assert.equal(broken.discover(['darts']), true); assert.deepEqual(broken.rows().map(r => r.id), ['darts']);
});

test("starting a game finds its rows on the scoreboard, every board game has its own, and the board is drawn again", () => {
  const source = readFileSync(new URL('../client/office/office.js', import.meta.url), 'utf8');
  assert.match(source, /game\.enter\(\);[^\n]*if \(online\.discover\(onBoard\.get\(game\)\)\) boards\.scores\(\);/);
  const map = source.match(/const onBoard = new Map\((.*)\);/)?.[1] ?? '';
  for (const { id } of GAMES) assert.ok(map.includes(`'${id}'`), id);
});
