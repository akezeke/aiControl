import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { connect as tcp } from 'node:net';
import { WebSocket } from 'ws';
import { AWAY, hubState, startHub } from '../server/hub.mjs';
import { COLOURS, PROTOCOL } from '../client/office/meeting.js';

const fresh = () => join(mkdtempSync(join(tmpdir(), 'hub-live-')), 'hub.json');
const token = c => c.repeat(22);
const FLOOR = { room: { width: 10, depth: 8 }, door: { x: 5, z: 8 }, pods: [[0, 0]], desks: [{ id: 'd0', pod: 0, slot: 0, parent: null,
  look: { fruit: 'apple', color: '#aa0000', accessories: ['cap'], trim: '#00aa00', habits: { typing: 'fast', thinking: 'slow', sleeping: 'deep', finish: 'nod' } },
  status: { pose: 'sitting', expression: 'calm', screen: 'green', since: null, wear: 0.5, cups: 1 } }] };

async function setup(t, options = {}) {
  const { players, ...rest } = options, file = fresh();
  if (players) { const st = hubState(file); for (const [c, entry] of Object.entries(players)) st.players[createHash('sha256').update(token(c)).digest('hex')] = entry; writeFileSync(file, JSON.stringify(st)); }
  const h = await startHub({ port: 0, file, ...rest }), port = h.server.address().port, state = hubState(file), sockets = [];
  t.after(() => { for (const s of sockets) s.terminate(); return h.close(); });
  // A client that keeps every message; `next(type)` waits for one more of a type (or the next already unread), with a timeout.
  const post = body => fetch(`http://127.0.0.1:${port}/scores`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${state.key}` }, body: JSON.stringify(body) });
  const register = (tok, name, body) => post({ token: tok, name, scores: {}, ...body });
  const connect = async (c, { key = state.key, host = false, auth = true, tok = token(c), name = c, signed = true, body } = {}) => {
    if (signed) assert.equal((await register(tok, name, body)).status, 200);
    return new Promise((resolve, reject) => {
    const headers = { 'x-player': tok, ...(auth ? { authorization: `Bearer ${key}` } : {}), ...(host ? { 'x-host': state.hostKey } : {}) };
    const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, { headers }); sockets.push(ws);
    const c_ = { ws, inbox: [], waiting: [], closed: null };
    ws.on('message', data => { const m = JSON.parse(data); c_.inbox.push(m); c_.waiting = c_.waiting.filter(w => !w(m)); });
    ws.on('close', code => { c_.closed = code; });
    c_.send = m => ws.send(JSON.stringify(m));
    c_.next = (type, ms = 1000) => new Promise((res, rej) => {
      const i = c_.inbox.findIndex(m => m.type === type);
      if (i >= 0) return res(c_.inbox.splice(i, 1)[0]);
      const w = m => { if (m.type !== type) return false; c_.inbox.splice(c_.inbox.indexOf(m), 1); clearTimeout(timer); res(m); return true; };
      const timer = setTimeout(() => { c_.waiting = c_.waiting.filter(x => x !== w); rej(new Error(`no ${type}`)); }, ms); c_.waiting.push(w);
    });
    c_.quiet = async (type, ms = 150) => { await new Promise(r => setTimeout(r, ms)); return c_.inbox.filter(m => m.type === type); };
    c_.closes = (ms = 1000) => new Promise((res, rej) => { if (c_.closed !== null) return res(c_.closed); ws.once('close', code => res(code)); setTimeout(() => rej(new Error('still open')), ms); });
    ws.once('open', () => resolve(c_)); ws.once('error', reject); ws.once('unexpected-response', (_q, r) => reject(Object.assign(new Error('refused'), { status: r.statusCode })));
    });
  };
  const join = async (c, o = {}, hello = {}) => {
    const p = await connect(c, o); p.send({ type: 'hello', v: PROTOCOL, name: 'whatever', fruit: 'apple', colour: COLOURS[0], ...hello });
    p.welcome = await p.next('welcome'); return p;
  };
  return { ...h, state, file, port, connect, join, post };
}
const lastRoster = async p => { await new Promise(r => setTimeout(r, 100)); return p.inbox.filter(m => m.type === 'roster').at(-1)?.players; };

test('hubState gains a hostKey once, keeping the key and players', () => {
  const file = fresh(); writeFileSync(file, JSON.stringify({ key: 'k', players: { a: { name: 'A', scores: {}, seen: 1 } } }));
  const s = hubState(file); assert.match(s.hostKey, /^[A-Za-z0-9_-]{22}$/); assert.equal(s.key, 'k');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), s); assert.equal(hubState(file).hostKey, s.hostKey);
});

test('only the right key and token get in', async t => {
  const h = await setup(t);
  await assert.rejects(h.connect('a', { auth: false, signed: false }), { status: 401 });
  await assert.rejects(h.connect('a', { key: 'nope', signed: false }), { status: 401 });
  await assert.rejects(h.connect('a', { tok: 'short', signed: false }), { status: 401 });
  await assert.rejects(h.connect('a', { signed: false }), { status: 401 });
  const ok = await h.connect('a'); assert.equal(ok.ws.readyState, WebSocket.OPEN);
  const other = new WebSocket(`ws://127.0.0.1:${h.port}/other`, { headers: { authorization: `Bearer ${h.state.key}`, 'x-player': token('b') } });
  await new Promise(r => { other.on('error', r); other.on('close', r); });
  assert.notEqual(other.readyState, WebSocket.OPEN);
});

test('colours stay unique', async t => {
  const h = await setup(t);
  const [a, b, c] = [await h.join('a'), await h.join('b'), await h.join('c')];
  const got = [a, b, c].map(p => p.welcome.colour);
  assert.equal(new Set(got).size, 3); assert.equal(got[0], COLOURS[0]); assert.ok(got.every(x => COLOURS.includes(x)));
  assert.ok([a, b, c].every(p => p.welcome.at === 'home' && /^[a-z0-9]{8}$/.test(p.welcome.id)));
  assert.equal((await lastRoster(a)).length, 3);
});

test('presence goes to the others at the meeting, not the sender or those at home', async t => {
  const h = await setup(t);
  const [a, b, c, d] = [await h.join('a'), await h.join('b'), await h.join('c'), await h.join('d', { host: true })];
  for (const p of [a, b]) p.send({ type: 'where', at: 'meeting' });
  await lastRoster(a);
  const pos = { type: 'pos', x: 1, y: 0, z: 2, yaw: 0.5, pose: 'walking' };
  a.send(pos); a.send({ type: 'throw', kind: 'duck', pos: [1, 1, 1], vel: [1, 0, 0], spin: [0, 0, 0] });
  assert.deepEqual(await b.next('pos'), { ...pos, id: a.welcome.id });
  assert.equal((await b.next('throw')).id, a.welcome.id);
  assert.equal((await d.next('pos')).id, a.welcome.id);
  assert.equal((await a.quiet('pos')).length, 0); assert.equal((await c.quiet('pos')).length, 0);
  a.send({ type: 'pos', x: 1e9, y: 0, z: 0, yaw: 0, pose: 'walking' });
  assert.equal((await b.quiet('pos')).length, 0);
});

test("snakes go to the others at the meeting, with the sender's id", async t => {
  const h = await setup(t);
  const [a, b, c, d] = [await h.join('a'), await h.join('b'), await h.join('c'), await h.join('d', { host: true })];
  for (const p of [a, b]) p.send({ type: 'where', at: 'meeting' });
  await lastRoster(a);
  const snake = { type: 'snake', mode: 'play', head: [2.125, 3.375], path: '0011-', dir: 2, rate: 8.4, food: [4.125, 1.875], plant: 3 };
  a.send(snake);
  assert.deepEqual(await b.next('snake'), { ...snake, id: a.welcome.id });
  assert.deepEqual(await d.next('snake'), { ...snake, id: a.welcome.id });
  assert.equal((await c.quiet('snake')).length, 0); assert.equal((await a.quiet('snake')).length, 0);
  c.send(snake); assert.equal((await b.quiet('snake')).length, 0);
});

const meeting = { type: 'where', at: 'meeting' }, home = { type: 'where', at: 'home' };
test('the goose keeper: the host at the meeting, else whoever has been there longest', async t => {
  const h = await setup(t);
  const [a, b, c, host] = [await h.join('a'), await h.join('b'), await h.join('c'), await h.join('h', { host: true })];
  const keeper = async () => { const r = await lastRoster(c); assert.ok(r.filter(p => p.goose).length <= 1); assert.ok(r.every(p => p.goose === undefined || p.goose === true)); return r.find(p => p.goose)?.name ?? null; };
  assert.equal(await keeper(), null);
  a.send(meeting); await keeper(); b.send(meeting); assert.equal(await keeper(), 'a');
  a.send(meeting); assert.equal(await keeper(), 'a', 'saying it again keeps your place');
  host.send(meeting); assert.equal(await keeper(), 'h');
  host.send(home); assert.equal(await keeper(), 'a');
  a.send(home); assert.equal(await keeper(), 'b');
  a.send(meeting); assert.equal(await keeper(), 'b');
  b.ws.close(); assert.equal(await keeper(), 'a');
  a.send(home); assert.equal(await keeper(), null);
});

test('goose plans and events go out from the keeper only; pokes go to the keeper only', async t => {
  const h = await setup(t);
  const [a, b, c, host] = [await h.join('a'), await h.join('b'), await h.join('c'), await h.join('h', { host: true })];
  a.send(meeting); await lastRoster(a); b.send(meeting); await lastRoster(a); // a is keeper; c and the host are at home
  const plan = { type: 'goose', at: [2.5, 3.25], yaw: 0, mode: 'walk', idle: 'look', speed: 0.75, route: [[3, 3]], carry: null, target: null };
  a.send(plan);
  assert.deepEqual(await b.next('goose'), { ...plan, id: a.welcome.id });
  assert.deepEqual(await host.next('goose'), { ...plan, id: a.welcome.id });
  assert.equal((await c.quiet('goose')).length, 0); assert.equal((await a.quiet('goose')).length, 0);
  b.send(plan); assert.equal((await host.quiet('goose')).length, 0);
  a.send({ type: 'goosed', what: 'drop' }); assert.deepEqual(await b.next('goosed'), { type: 'goosed', what: 'drop', id: a.welcome.id });
  b.send({ type: 'poke', why: 'click' }); assert.deepEqual(await a.next('poke'), { type: 'poke', why: 'click', id: b.welcome.id });
  assert.equal((await host.quiet('poke')).length, 0);
  a.send({ type: 'poke', why: 'hit' }); c.send({ type: 'poke', why: 'hit' });
  assert.equal((await a.quiet('poke')).length, 0); assert.equal((await b.quiet('poke')).length, 0);
});

test('only the host sets the floor; visitors get it when they arrive; it goes null when the host leaves', async t => {
  const h = await setup(t);
  const host = await h.join('h', { host: true }), a = await h.join('a'), b = await h.join('b');
  a.send({ type: 'where', at: 'meeting' }); a.send({ type: 'floor', floor: FLOOR });
  assert.equal((await a.quiet('floor')).length, 0);
  host.send({ type: 'floor', floor: FLOOR });
  await new Promise(r => setTimeout(r, 100)); assert.equal((await a.next('floor')).floor.room.width, 10);
  assert.equal((await b.quiet('floor')).length, 0);
  b.send({ type: 'where', at: 'meeting' }); assert.equal((await b.next('floor')).floor.desks[0].id, 'd0');
  host.ws.close(); assert.equal((await a.next('floor')).floor, null); assert.equal((await b.next('floor')).floor, null);
  const c = await h.join('c'); c.send({ type: 'where', at: 'meeting' }); assert.equal((await c.quiet('floor')).length, 0);
});

test('the hub drops a flood and keeps the rest', async t => {
  const h = await setup(t, { now: () => 5000 });
  const a = await h.join('a'), b = await h.join('b');
  a.send({ type: 'where', at: 'meeting' }); b.send({ type: 'where', at: 'meeting' }); await lastRoster(a);
  for (let i = 0; i < 30; i++) a.send({ type: 'pos', x: i, y: 0, z: 0, yaw: 0, pose: 'walking' });
  await new Promise(r => setTimeout(r, 200));
  const got = b.inbox.filter(m => m.type === 'pos').length; assert.ok(got >= 15 && got <= 20, `got ${got}`);
  assert.equal(a.closed, null); assert.equal((await lastRoster(b)).length, 2);
  for (let i = 0; i < 30; i++) a.send({ type: 'pos', x: i, y: 0, z: 0, yaw: 0, pose: 'walking' });
  assert.equal(await a.closes(), 1006);
  await new Promise(r => setTimeout(r, 100)); assert.equal((await lastRoster(b)).length, 1);
});

test("a flooder cut off relays nothing more, even one that never reads the hub's close", async t => {
  let clock = 5000;
  const h = await setup(t, { now: () => clock });
  const a = await h.join('a'), b = await h.join('b');
  a.send({ type: 'where', at: 'meeting' }); b.send({ type: 'where', at: 'meeting' }); await lastRoster(a);
  a.ws._socket.pause(); // it keeps writing, and never reads (or answers) a close
  for (let i = 0; i < 45; i++) a.send({ type: 'pos', x: i, y: 0, z: 0, yaw: 0, pose: 'walking' });
  await new Promise(r => setTimeout(r, 200));
  assert.equal((await lastRoster(b)).length, 1, 'dropped from the room at once');
  clock += 1000; b.inbox.length = 0;
  for (let i = 0; i < 5; i++) a.send({ type: 'pos', x: i, y: 0, z: 0, yaw: 0, pose: 'walking' });
  assert.equal((await b.quiet('pos', 200)).length, 0);
});

// One colour each, so a ninth never gets as far as a seat: their Join is refused, and so is the hello of an entry with no colour.
test('a ninth player is refused: no colour left to sign in with or say hello in', async t => {
  const h = await setup(t, { players: { z: { name: 'z', scores: {}, seen: Date.now() } } }), ps = [];
  for (let i = 0; i < 8; i++) ps.push(await h.join(String.fromCharCode(97 + i), {}, { colour: COLOURS[i] }));
  for (const p of ps) p.send({ type: 'where', at: 'meeting' });
  const late = await h.post({ token: token('i'), name: 'i', scores: {} });
  assert.equal(late.status, 409); assert.deepEqual(await late.json(), { error: 'All colours are taken.', why: 'colour', taken: COLOURS });
  const z = await h.connect('z', { signed: false });
  z.send({ type: 'hello', v: PROTOCOL, name: 'z', fruit: 'apple', colour: COLOURS[0] });
  assert.deepEqual(await z.next('refused'), { type: 'refused', why: 'colour' });
  const roster = await lastRoster(ps[0]);
  assert.equal(roster.length, 8); assert.ok(roster.every(p => p.at === 'meeting')); assert.equal(new Set(roster.map(p => p.colour)).size, 8);
});

test('the same token twice keeps one player', async t => {
  const h = await setup(t);
  const a = await h.join('a'), watcher = await h.join('w');
  const again = await h.join('a2', { tok: token('a') });
  assert.equal(await a.closes(), 4000);
  const roster = await lastRoster(watcher); assert.equal(roster.length, 2);
  assert.ok(roster.some(p => p.id === again.welcome.id) && !roster.some(p => p.id === a.welcome.id));
});

test("a connection replaced by the same player's newer one says nothing more, even one that never reads its close", async t => {
  const h = await setup(t);
  const a = await h.join('a'), b = await h.join('b');
  a.send({ type: 'where', at: 'meeting' }); b.send({ type: 'where', at: 'meeting' }); await lastRoster(b);
  a.ws._socket.pause();
  await h.join('a2', { tok: token('a') }); await lastRoster(b);
  a.send({ type: 'pos', x: 1, y: 0, z: 0, yaw: 0, pose: 'walking' });
  assert.equal((await b.quiet('pos', 200)).length, 0);
});

test('a hostile request target cannot crash the hub', async t => {
  const h = await setup(t);
  for (const target of ['//', '/live/../x', 'http://']) {
    const raw = await new Promise(res => { const c = tcp(h.port, '127.0.0.1', () => c.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`)); c.on('close', res); c.on('error', res); });
    assert.equal(h.server.listening, true);
  }
  const r = await fetch(`http://127.0.0.1:${h.port}/scores`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${h.state.key}` }, body: JSON.stringify({ token: token('z'), name: 'Z', scores: {} }) });
  assert.equal(r.status, 200);
});

test("a hello in a protocol the hub doesn't speak is refused for the version and closed; one from before the number is welcome", async t => {
  const h = await setup(t), watcher = await h.join('w');
  const newer = await h.connect('n'); newer.send({ type: 'hello', v: PROTOCOL + 1, name: 'n', fruit: 'apple', colour: COLOURS[1] });
  assert.deepEqual(await newer.next('refused'), { type: 'refused', why: 'version' });
  assert.equal(await newer.closes(), 4002);
  assert.deepEqual((await lastRoster(watcher)).map(p => p.id), [watcher.welcome.id]);
  const older = await h.connect('o'); older.send({ type: 'hello', name: 'o', fruit: 'apple', colour: COLOURS[2] });
  assert.equal((await older.next('welcome')).colour, COLOURS[2]);
});

test('the roster shows the registered name, not the one in hello', async t => {
  const h = await setup(t), a = await h.join('a', { name: 'Anna' }, { name: 'Mallory' });
  assert.equal((await lastRoster(a))[0].name, 'Anna');
});

test('a socket that never says hello is closed', async t => {
  const h = await setup(t, { helloMs: 100 }), a = await h.connect('a');
  assert.equal(await a.closes(), 1006);
});

test('a peer that stops answering pings is dropped, and a vanished host takes the floor with it', async t => {
  const h = await setup(t, { heartbeatMs: 100 });
  const host = await h.join('h', { host: true }), a = await h.join('a'), b = await h.join('b');
  a.send({ type: 'where', at: 'meeting' }); host.send({ type: 'floor', floor: FLOOR }); await a.next('floor');
  host.ws._socket.pause(); b.ws._socket.pause();
  assert.equal((await a.next('floor', 1500)).floor, null);
  const roster = await lastRoster(a); assert.deepEqual(roster.map(p => p.id), [a.welcome.id]);
});

const seen = async (s, c) => { await s.flush(); return hubState(s.file).players[createHash('sha256').update(token(c)).digest('hex')].seen; };
const near = (a, b) => Math.abs(a - b) < 1000;
test('only a signed-in player gets in; connected, you stay in past 2 days; hello, leaving and the heartbeat count as last on', async t => {
  let skew = 0; const s = await setup(t, { now: () => Date.now() + skew, heartbeatMs: 50 });
  skew = 5000; const a = await s.join('a'); assert.ok(near(await seen(s, 'a'), Date.now() + 5000), 'hello');
  skew = 9000; await new Promise(r => setTimeout(r, 120)); assert.ok(near(await seen(s, 'a'), Date.now() + 9000), 'heartbeat');
  skew = AWAY + 60_000; assert.equal((await s.post({ token: token('a'), name: 'a', scores: {}, join: false })).status, 200, 'connected');
  skew = 2 * AWAY; a.ws.close(); await a.closes(); await new Promise(r => setTimeout(r, 50));
  assert.ok(near(await seen(s, 'a'), Date.now() + 2 * AWAY), 'drop');
  skew = 3 * AWAY + 60_000; await assert.rejects(s.connect('a', { signed: false }), { status: 401 });
});
test('hello: the colour asked if free, else yours, else the first free for an entry with none, else refused', async t => {
  const now = Date.now(), s = await setup(t, { players: { x: { name: 'x', scores: {}, seen: now, colour: COLOURS[5] }, y: { name: 'y', scores: {}, seen: now, colour: COLOURS[5] } } });
  const a = await s.join('a', { body: { colour: COLOURS[1] } }, { colour: COLOURS[2] });
  assert.equal(a.welcome.colour, COLOURS[2], 'asked, and free');
  const b = await s.join('b', { body: { colour: COLOURS[3] } }, { colour: COLOURS[2] });
  assert.equal(b.welcome.colour, COLOURS[3], 'asked is held: your own');
  const c = await s.join('c', {}, { colour: COLOURS[2] });
  assert.equal(c.welcome.colour, COLOURS[0], 'no colour of your own: the first free one');
  const x = await s.connect('x', { signed: false });
  x.send({ type: 'hello', name: 'x', fruit: 'apple', colour: COLOURS[5] });
  assert.deepEqual(await x.next('refused'), { type: 'refused', why: 'colour' });
  x.send({ type: 'hello', name: 'x', fruit: 'apple', colour: COLOURS[6] });
  assert.equal((await x.next('welcome')).colour, COLOURS[6], 'a second hello, in a free colour');
});
test('look: a colour someone holds is refused and you keep yours; a free one is yours and frees the old', async t => {
  const s = await setup(t), wait = () => new Promise(r => setTimeout(r, 100));
  const a = await s.join('a', {}, { colour: COLOURS[0] }), b = await s.join('b', {}, { colour: COLOURS[1] });
  const colours = async () => Object.fromEntries((await lastRoster(a)).map(p => [p.name, [p.fruit, p.colour]]));
  b.send({ type: 'look', fruit: 'pear', colour: COLOURS[0] });
  assert.deepEqual(await b.next('refused'), { type: 'refused', why: 'colour' });
  assert.deepEqual(await colours(), { a: ['apple', COLOURS[0]], b: ['pear', COLOURS[1]] });
  b.send({ type: 'look', fruit: 'pear', colour: COLOURS[2] }); await wait();
  a.send({ type: 'look', fruit: 'apple', colour: COLOURS[1] }); await wait();
  assert.deepEqual(await colours(), { a: ['apple', COLOURS[1]], b: ['pear', COLOURS[2]] });
});
test('the host removes a player: signed out, closed with 4003, gone from the roster; a Join brings them back', async t => {
  const s = await setup(t, { hostToken: () => token('h') }), wait = () => new Promise(r => setTimeout(r, 100));
  const h = await s.join('h', { host: true }), a = await s.join('a'), b = await s.join('b');
  b.send({ type: 'remove', name: 'a' }); await wait(); assert.equal(a.closed, null, 'only from the host');
  h.send({ type: 'remove', name: 'h' }); await wait(); assert.equal(h.closed, null, 'not the host themselves');
  h.send({ type: 'remove', name: 'A' }); assert.equal(await a.closes(), 4003, 'by name, any case');
  assert.deepEqual((await lastRoster(h)).map(p => p.name).sort(), ['b', 'h']);
  const sync = await s.post({ token: token('a'), name: 'a', scores: {}, join: false });
  assert.equal(sync.status, 403); assert.equal((await sync.json()).why, 'removed');
  await assert.rejects(s.connect('a', { signed: false }), { status: 401 });
  assert.equal((await s.post({ token: token('a'), name: 'a', scores: {}, join: true })).status, 200);
  await s.join('a', { signed: false });
});
