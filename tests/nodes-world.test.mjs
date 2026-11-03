import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, statusOf, textOf, usageOf } from '../client/nodes/world.js';

const session = (id, extra = {}) => ({ id, title: id, provider: 'claude', cwd: `/code/${extra.project || 'app'}`, project: extra.project || 'app', status: 'idle', detail: '', requests: [], ...extra });
const types = events => events.map(e => `${e.type}:${e.node.id}`);

test('status reads activity, waiting and requests', () => {
  assert.equal(statusOf({ status: 'working', activity: 'compacting' }), 'compacting');
  assert.equal(statusOf({ status: 'working', activity: 'thinking' }), 'thinking');
  assert.equal(statusOf({ status: 'idle', waitingOn: 'shell' }), 'waiting');
  assert.equal(statusOf({ status: 'unknown' }), 'idle');
  assert.equal(textOf({ requests: [{ title: 'A question for you', questions: [{ question: 'Winter style?' }] }] }, 'question'), 'Winter style?');
});

test('the board is the same whatever order sessions arrive in', () => {
  const list = [session('a', { project: 'zeta' }), session('b', { project: 'alpha' }), session('c', { project: 'alpha' }), session('c:k', { parentId: 'c', project: 'alpha' })];
  const one = createWorld(), two = createWorld();
  one.sync({ sessions: list }); two.sync({ sessions: [...list].reverse() });
  assert.deepEqual(one.nodes.map(n => n.id), two.nodes.map(n => n.id));
  for (const n of one.nodes) assert.ok(n.rest.distanceTo(two.byId(n.id).rest) < 1e-9, n.id);
  assert.equal(one.byId('c:k').parent, one.byId('c'));
  assert.equal(one.byId('c:k').project.name, 'alpha');
  assert.equal(one.byId('a').s.alive, 1); // the first snapshot doesn't fade in
});

test('snapshots turn into events, and leavers go once faded', () => {
  const world = createWorld();
  world.sync({ sessions: [session('a', { status: 'working', detail: 'Read · a.js' })] }); world.update(0);
  world.sync({ sessions: [session('a', { status: 'working', detail: 'Edit · a.js' }), session('b')] });
  assert.deepEqual(types(world.update(0)), ['tool:a', 'spawn:b']);
  world.sync({ sessions: [session('a', { status: 'permission', requests: [{ title: 'Allow Bash?', createdAt: Date.now() - 30_000 }] }), session('b')] });
  assert.deepEqual(types(world.update(0)), ['state:a', 'need:a']);
  assert.deepEqual(world.queue().map(n => n.id), ['a']);
  assert.ok(world.byId('a').waitSec >= 29);
  world.sync({ sessions: [session('a', { status: 'working' }), session('b')] }); world.sync({ sessions: [session('a'), session('b')] });
  assert.deepEqual(types(world.update(0)), ['state:a', 'answer:a', 'state:a', 'finish:a']);
  const before = world.structure;
  world.sync({ sessions: [session('a')] });
  assert.deepEqual(types(world.update(0)), ['despawn:b']);
  for (let i = 0; i < 60; i++) world.update(1 / 30);
  assert.equal(world.byId('b'), undefined);
  assert.notEqual(world.structure, before);
});

test('usage windows become 0..1 gauges', () => {
  const [account] = usageOf([{ provider: 'claude', name: 'Claude Code', windows: [{ label: '5-hour', usedPercent: 64, resetsAt: 1 }, { label: 'Weekly', usedPercent: 120 }] }]);
  assert.deepEqual(account.windows.map(w => [w.label, w.used]), [['5h', .64], ['week', 1]]);
});

test('a poll that says nothing new leaves the board still', () => {
  const world = createWorld(), list = () => [session('a'), session('b', { project: 'web' })];
  world.sync({ sessions: list() }); const version = world.version;
  world.sync({ sessions: list() });
  assert.equal(world.version, version);
  world.sync({ sessions: list(), usage: [{ provider: 'claude', windows: [] }] });
  assert.equal(world.version, version + 1);
  world.remove('a'); world.sync({ sessions: list(), usage: [{ provider: 'claude', windows: [] }] }); // the same again: still back
  assert.equal(world.byId('a').present, true);
});

test('without the wander, a spring keeps the board moving until it lands', () => {
  const world = createWorld(); world.motion = { zeta: 1, k: 110, drift: 0, kick: 0 };
  world.sync({ sessions: [session('a')] });
  const a = world.byId('a'); a.pos.x += 2;
  let frames = 0;
  do { world.update(1 / 60); frames++; } while (world.stir && frames < 600);
  assert.equal(world.stir, '');
  assert.ok(a.pos.distanceTo(a.rest) < 1e-9, 'landed on its rest');
  const at = a.pos.clone(); world.update(.05); assert.ok(a.pos.equals(at), 'and stays there');
});
