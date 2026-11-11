import test from 'node:test';
import assert from 'node:assert/strict';
import { createLive, pickerState } from '../client/office/live.js';

// A fake clock with timers, and sockets that open when told.
function rig(over = {}) {
  const r = { t: 0, timers: [], sockets: [], vis: true, joined: true, hidden: null };
  r.advance = ms => { const end = r.t + ms; for (;;) { const due = r.timers.filter(x => x.at <= end).sort((a, b) => a.at - b.at)[0]; if (!due) break; r.t = due.at; r.timers.splice(r.timers.indexOf(due), 1); due.fn(); } r.t = end; };
  const socket = url => { const s = { url, sent: [], closed: false, send(m) { s.sent.push(JSON.parse(m)); }, close() { s.closed = true; s.onclose?.(); }, open() { s.readyState = 1; s.onopen?.(); }, say(m) { s.onmessage?.({ data: JSON.stringify(m) }); } }; r.sockets.push(s); return s; };
  r.live = createLive({ socket, visible: () => r.vis, joined: () => r.joined, now: () => r.t, setTimer: (fn, ms) => { const x = { fn, at: r.t + ms }; r.timers.push(x); return x; }, clearTimer: x => { r.timers = r.timers.filter(y => y !== x); }, onHidden: fn => { r.hidden = fn; }, ...over });
  return r;
}
const sample = (x = 0, pose = 'standing') => ({ x, y: 0, z: 0, yaw: 0, pose });

test('presence is throttled and thresholded', () => {
  const r = rig(); r.live.refresh(); const s = r.sockets[0]; s.open();
  s.sent.length = 0;
  for (let i = 0; i < 60; i++) { r.t += 1000 / 60; r.live.presence(sample(i * 0.05)); }
  const pos = s.sent.filter(m => m.type === 'pos');
  assert.ok(pos.length >= 10 && pos.length <= 15, String(pos.length));
  assert.ok(pos.every((m, i) => Number.isInteger(m.t) && (!i || m.t - pos[i - 1].t >= 66)), 'each says when, at most 15 a second');
  // Stopped, the last place goes when the window opens; then still, or moving less than 2 cm: nothing.
  r.t += 100; r.live.presence(sample(59 * 0.05)); assert.equal(s.sent.at(-1).x, 59 * 0.05);
  const n = s.sent.length; r.t += 500; r.live.presence(sample(59 * 0.05 + 0.01)); r.live.presence(sample(59 * 0.05)); assert.equal(s.sent.length, n);
  // A pose change at once.
  r.live.presence(sample(59 * 0.05, 'running')); assert.equal(s.sent.length, n + 1); assert.equal(s.sent.at(-1).pose, 'running');
});

test('the link closes when hidden and comes back', () => {
  const r = rig(); r.live.refresh(); r.sockets[0].open();
  r.live.where('meeting'); assert.deepEqual(r.sockets[0].sent.at(-1), { type: 'where', at: 'meeting' });
  r.vis = false; r.hidden(); assert.ok(r.sockets[0].closed); r.advance(60000); assert.equal(r.sockets.length, 1);
  r.vis = true; r.hidden(); assert.equal(r.sockets.length, 2); r.sockets[1].open();
  assert.deepEqual(r.sockets[1].sent[0], { type: 'where', at: 'meeting' });
});

test('it does not connect unless joined, and relays the server', () => {
  const r = rig(); r.joined = false; r.live.refresh(); assert.equal(r.sockets.length, 0);
  r.joined = true; r.live.refresh(); const s = r.sockets[0]; s.open();
  const got = []; r.live.on('roster', () => got.push(1));
  const me = { id: 'a', name: 'Anna', fruit: 'kiwi', colour: '#3a86ff', at: 'home' };
  s.say({ type: 'welcome', id: 'a', colour: '#3a86ff', at: 'home' }); s.say({ type: 'roster', players: [me] });
  assert.deepEqual(r.live.roster(), [me]); assert.equal(r.live.id(), 'a'); assert.equal(got.length, 1);
  const order = []; for (const type of ['lost', 'roster', 'floor']) r.live.on(type, () => order.push(type));
  r.joined = false; r.live.refresh(); assert.ok(s.closed); assert.deepEqual(r.live.roster(), []); assert.equal(r.live.floor(), null);
  assert.deepEqual(order, ['lost', 'roster', 'floor'], 'lost first, so a visit waits rather than walking home');
});

test('reconnects back off to 30 s', () => {
  const r = rig(); r.live.refresh();
  const waits = [];
  for (let i = 0; i < 8; i++) { const s = r.sockets.at(-1), before = r.t; s.close(); const next = r.timers[0]; waits.push(next.at - before); r.advance(next.at - before); }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  r.sockets.at(-1).open(); r.sockets.at(-1).close(); assert.equal(r.timers[0].at - r.t, 1000);
});

test("pickerState marks others' colours taken, not yours", () => {
  const roster = [{ id: 'a', fruit: 'kiwi', colour: '#ff5d8f' }, { id: 'b', fruit: 'pear', colour: '#3a86ff' }];
  const p = pickerState(roster, 'a');
  assert.equal(p.fruit, 'kiwi'); assert.equal(p.colour, '#ff5d8f'); assert.deepEqual([...p.taken], ['#3a86ff']);
  assert.deepEqual(pickerState([], 'a').fruit, null);
});

test('setLook posts the look and shows what came back', async () => {
  const { createOnline } = await import('../client/office/online.js');
  const calls = [], online = createOnline({ api: async (path, body) => { calls.push([path, body]); return { joined: true, name: 'A', host: 'h', board: null, look: body }; }, scores: () => ({}) });
  await online.setLook('kiwi', '#3a86ff');
  assert.deepEqual(calls, [['office/look', { fruit: 'kiwi', colour: '#3a86ff' }]]); assert.deepEqual(online.state().look, { fruit: 'kiwi', colour: '#3a86ff' });
});

test('server messages are checked: malformed ones change nothing and emit nothing', () => {
  const r = rig(); r.live.refresh(); const s = r.sockets[0]; s.open();
  const me = { id: 'a', name: 'Anna', fruit: 'kiwi', colour: '#3a86ff', at: 'home' }, seen = [];
  for (const type of ['welcome', 'roster', 'floor', 'pos', 'throw']) r.live.on(type, m => seen.push(m.type));
  s.say({ type: 'welcome', id: 'a', colour: '#3a86ff', at: 'home' }); s.say({ type: 'roster', players: [me] });
  s.say({ type: 'pos', id: 'b', x: 1, y: 0, z: 1, yaw: 0, pose: 'walking' });
  s.say({ type: 'throw', id: 'b', kind: 'mug', pos: [1, 1, 1], vel: [1, 1, 1], spin: [0, 0, 0] });
  s.say({ type: 'floor', floor: null });
  assert.deepEqual(seen, ['welcome', 'roster', 'pos', 'throw', 'floor']);
  seen.length = 0;
  s.say({ type: 'roster', players: [{ ...me, name: 'x'.repeat(200) }] }); s.say({ type: 'roster', players: [{ ...me, colour: '#123456' }] });
  s.say({ type: 'floor', floor: { pods: 'no' } }); s.say({ type: 'welcome', id: '!!', colour: '#3a86ff', at: 'home' }); s.say({ type: 'nope' });
  assert.deepEqual(seen, []); assert.deepEqual(r.live.roster(), [me]); assert.equal(r.live.floor(), null); assert.equal(r.live.id(), 'a');
});

test('a pose flapping every frame still sends at most 15 a second, and the last pose lands', () => {
  const r = rig(); r.live.refresh(); const s = r.sockets[0]; s.open(); s.sent.length = 0;
  for (let i = 0; i < 62; i++) { r.live.presence(sample(0, i % 2 ? 'walking' : 'standing')); r.advance(16); }
  r.live.presence(sample(0, 'running')); r.advance(200);
  const pos = s.sent.filter(m => m.type === 'pos');
  assert.ok(pos.length <= 16, String(pos.length)); // 15 in the second of flapping, one more after
  assert.equal(pos.at(-1).pose, 'running');
});

test('flapping back to the last-sent pose inside the window sends nothing stale', () => {
  const r = rig(); r.live.refresh(); const s = r.sockets[0]; s.open();
  r.live.presence(sample(0, 'standing')); r.advance(20); s.sent.length = 0;
  r.live.presence(sample(0, 'walking')); r.advance(20); r.live.presence(sample(0, 'standing')); r.advance(300);
  assert.deepEqual(s.sent.filter(m => m.type === 'pos'), []);
});

test('presence keeps a copy of a waiting sample, so a caller can reuse its object', () => {
  const r = rig(); r.live.refresh(); const s = r.sockets[0]; s.open(); s.sent.length = 0;
  const mine = { x: 0, y: 0, z: 0, yaw: 0, pose: 'standing' };
  r.live.presence(mine); r.t += 10; Object.assign(mine, { x: 1, pose: 'running' }); r.live.presence(mine); // pose change inside the window waits
  Object.assign(mine, { x: 9, pose: 'standing' }); r.advance(200);
  const last = s.sent.filter(m => m.type === 'pos').at(-1); assert.equal(last.pose, 'running'); assert.equal(last.x, 1);
});

test('standing still, presence says so again every 2 s; forced, at once', () => {
  const r = rig(); r.live.refresh(); const s = r.sockets[0]; s.open(); s.sent.length = 0;
  for (let i = 0; i < 300; i++) { r.live.presence(sample(1)); r.advance(1000 / 60); } // 5 s
  const gaps = s.sent.slice(1).map((m, i) => m.t - s.sent[i].t);
  assert.equal(s.sent.length, 3); assert.ok(gaps.every(g => g >= 2000 && g <= 2017), String(gaps));
  r.live.presence(sample(1), true); assert.equal(s.sent.length, 4); assert.equal(s.sent.at(-1).x, 1);
});
