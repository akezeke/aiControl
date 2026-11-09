import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect as tcp } from 'node:net';
import { WebSocket } from 'ws';
import { hubState, startHub } from '../server/hub.mjs';
import { COLOURS } from '../client/office/meeting.js';

const fresh = () => join(mkdtempSync(join(tmpdir(), 'hub-live-')), 'hub.json');
const token = c => c.repeat(22);
const FLOOR = { room: { width: 10, depth: 8 }, door: { x: 5, z: 8 }, pods: [[0, 0]], desks: [{ id: 'd0', pod: 0, slot: 0, parent: null,
  look: { fruit: 'apple', color: '#aa0000', accessories: ['cap'], trim: '#00aa00', habits: { typing: 'fast', thinking: 'slow', sleeping: 'deep', finish: 'nod' } },
  status: { pose: 'sitting', expression: 'calm', screen: 'green', since: null, wear: 0.5, cups: 1 } }] };

async function setup(t, options = {}) {
  const file = fresh(), h = await startHub({ port: 0, file, ...options }), port = h.server.address().port, state = hubState(file), sockets = [];
  t.after(() => { for (const s of sockets) s.terminate(); return h.close(); });
  // A client that keeps every message; `next(type)` waits for one more of a type (or the next already unread), with a timeout.
  const register = (tok, name) => fetch(`http://127.0.0.1:${port}/scores`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${state.key}` }, body: JSON.stringify({ token: tok, name, scores: {} }) });
  const connect = async (c, { key = state.key, host = false, auth = true, tok = token(c), name = c, signed = true } = {}) => {
    if (signed) assert.equal((await register(tok, name)).status, 200);
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
    const p = await connect(c, o); p.send({ type: 'hello', name: 'whatever', fruit: 'apple', colour: COLOURS[0], ...hello });
    p.welcome = await p.next('welcome'); return p;
  };
  return { ...h, state, file, port, connect, join };
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
  assert.equal(await a.closes(), 1008);
  await new Promise(r => setTimeout(r, 100)); assert.equal((await lastRoster(b)).length, 1);
});

test('a ninth visitor is refused', async t => {
  const h = await setup(t), ps = [];
  for (let i = 0; i < 9; i++) ps.push(await h.join(String.fromCharCode(97 + i), {}, { colour: COLOURS[i % 8] }));
  for (const p of ps.slice(0, 8)) p.send({ type: 'where', at: 'meeting' });
  await lastRoster(ps[0]);
  ps[8].send({ type: 'where', at: 'meeting' });
  assert.equal((await ps[8].next('refused')).why, 'full');
  assert.equal((await lastRoster(ps[0])).find(p => p.id === ps[8].welcome.id).at, 'home');
  ps[0].ws.close(); await new Promise(r => setTimeout(r, 100));
  ps[8].send({ type: 'where', at: 'meeting' }); await new Promise(r => setTimeout(r, 100));
  assert.equal((await lastRoster(ps[1])).find(p => p.id === ps[8].welcome.id).at, 'meeting');
});

test('the same token twice keeps one player', async t => {
  const h = await setup(t);
  const a = await h.join('a'), watcher = await h.join('w');
  const again = await h.join('a2', { tok: token('a') });
  assert.equal(await a.closes(), 4000);
  const roster = await lastRoster(watcher); assert.equal(roster.length, 2);
  assert.ok(roster.some(p => p.id === again.welcome.id) && !roster.some(p => p.id === a.welcome.id));
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
