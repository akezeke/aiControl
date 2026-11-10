import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { walkGrid } from '../client/office/path.js';
import { COLOURS, checkUp } from '../client/office/meeting.js';
import { createGoose } from '../client/office/goose.js';
import { standSpots } from '../client/office/goose-plan.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z), grid = walkGrid([], { width: 10, depth: 10 });
const blank = () => new Proxy({}, { get: (t, k) => k in t ? t[k] : () => ({ addColorStop() {} }), set: (t, k, v) => { t[k] = v; return true; } });
const P = (id, extra = {}) => ({ id, name: id, fruit: 'apple', colour: COLOURS[0], at: 'meeting', ...extra });
// A goose in an empty 10 × 10 m office. You stand at (1, 1), busy unless said. A thing: { kind: { key }, pos, rest: true }.
function goose({ foods = () => [], others = () => [], things = [], sleepers = [], still = false, busy = true } = {}) {
  const sent = [], said = [], woken = [], ghosts = [], player = { position: V(1, 1.6, 1), step: v => player.position.add(v) };
  const props = { loose: () => things.filter(b => !b.held && !b.carried), carry: (b, at) => { if (b.held) return false; b.carried = at; return true; }, drop: b => { b.carried = null; },
    holdGhost: (kind, at) => { const h = { kind, at, gone: false, release() { h.gone = true; } }; ghosts.push(h); return h; } };
  const was = globalThis.document; globalThis.document = { createElement: () => ({ getContext: blank }) };
  let g; try { g = createGoose(new THREE.Scene(), { props, player, walkable: () => grid, bounds: () => ({ width: 10, depth: 10 }), busy: () => busy, reducedMotion: () => still,
    say: icon => said.push(icon), sleepers: () => sleepers, wake: id => woken.push(id), foods, others, me: () => 'a', net: m => sent.push(m) }); }
  finally { if (was) globalThis.document = was; else delete globalThis.document; }
  const run = (seconds, each) => { for (let i = 0; i < Math.round(seconds * 60); i++) { g.update(1 / 60); if (each?.()) return true; } return false; };
  return { g, sent, said, woken, ghosts, player, run, at: () => [g.root.position.x, g.root.position.z] };
}

test('a fruit visit: it stands 0.75–1.0 m from the food, then leaves within 6–12 s, or once the food is gone', () => {
  const food = { food: [5.125, 2.125], head: [2.125, 2.125] };
  let out = [food]; const a = goose({ foods: () => out });
  assert.ok(a.run(110, () => a.g.mode === 'mill'), 'went to the food');
  const d = Math.hypot(a.at()[0] - 5.125, a.at()[1] - 2.125); assert.ok(d > 0.7 && d < 1.05);
  let stayed = 0; a.run(13, () => { stayed += 1 / 60; return !['visit', 'mill'].includes(a.g.mode); });
  assert.ok(stayed > 5.5 && stayed < 12.1, `stayed ${stayed} s`);
  const b = goose({ foods: () => out }); assert.ok(b.run(110, () => b.g.mode === 'mill'));
  out = []; b.run(1 / 60); assert.equal(b.g.mode, 'loiter');
});

test('no fruit visits with reduced motion at home: it stands still', () => {
  const a = goose({ foods: () => [{ food: [5.125, 2.125], head: [2.125, 2.125] }], still: true });
  a.run(1 / 60); const from = a.at(); a.run(110);
  assert.deepEqual(a.at(), from); assert.equal(a.g.mode, 'loiter');
});

// The room's grid with some cells shut for one test: [i, j] cell offsets from the one at (5.125, 5.125).
function shutting(cells, fn) {
  const shut = cells.map(([i, j]) => (20 + j) * grid.cols + 20 + i); for (const k of shut) grid.open[k] = 0;
  try { fn(); } finally { for (const k of shut) grid.open[k] = 1; }
}

test('it stands right on a stand spot, not a few cm short of it, where it could shut the snake out', () => {
  const food = [5.125, 2.125], head = [2.125, 2.125], a = goose({ foods: () => [{ food, head }] });
  assert.ok(a.run(110, () => a.g.mode === 'mill'));
  assert.ok(standSpots(grid, food, head).some(([x, z]) => Math.abs(x - a.at()[0]) < 1e-9 && Math.abs(z - a.at()[1]) < 1e-9), `at ${a.at()}`);
});

test('from spot to spot it keeps 0.5 m off the food, never across it', () => {
  // Six spots, three each side of the food and 1.5 m apart across it: the ring's other cells shut.
  const ring = []; for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) { const r = Math.hypot(i, j) / 4; if (r >= 0.75 && r <= 1 && !(Math.abs(i) === 3 && Math.abs(j) <= 1)) ring.push([i, j]); }
  shutting(ring, () => {
    const food = [5.125, 5.125], a = goose({ foods: () => [{ food, head: [2.125, 5.125] }] });
    let closest = Infinity, moves = 0, was = null;
    a.run(400, () => {
      if (['visit', 'mill'].includes(a.g.mode)) closest = Math.min(closest, Math.hypot(a.at()[0] - food[0], a.at()[1] - food[1]));
      if (was === 'mill' && a.g.mode === 'visit') moves++; was = a.g.mode;
    });
    assert.ok(moves > 0, 'went on to other spots'); assert.ok(closest >= 0.5, `came ${closest} m from the food`);
  });
});

test('the nearest spot walled off on its own: it goes to the next nearest it can get to', () => {
  // The spot 1 m south of the food is a pocket of one cell; whenever the goose loiters, it's put 2 m south of the food, so that
  // spot is the nearest when a visit starts.
  shutting([[-1, 3], [0, 3], [1, 3], [-1, 4], [1, 4], [-1, 5], [0, 5], [1, 5]], () => {
    const a = goose({ foods: () => [{ food: [5.125, 5.125], head: [2.125, 5.125] }] });
    assert.ok(a.run(110, () => { if (a.g.mode === 'loiter') a.g.root.position.set(5.125, 0, 7.125); return a.g.mode === 'mill'; }), 'went to the food');
  });
});

const plan = (extra = {}) => ({ type: 'goose', id: 'b', at: [2, 2], yaw: 0, mode: 'walk', idle: 'look', speed: 1, route: [[4, 2]], carry: null, target: null, ...extra });
const watching = (o = {}) => { const a = goose(o); a.g.roster([P('a'), P('b', { goose: true })], 'a'); return a; };

test("a watcher's goose: hidden and out of the way till the keeper's plan, then walks it", () => {
  const a = watching(); a.run(1);
  assert.equal(a.g.root.visible, false); assert.deepEqual(a.g.columns(), []);
  a.g.heard(plan({ id: 'c', at: [8, 8] })); a.run(0.1); assert.equal(a.g.root.visible, false, "not the keeper's");
  a.g.heard(plan()); a.run(1); assert.ok(Math.hypot(a.at()[0] - 3, a.at()[1] - 2) < 0.05); assert.equal(a.g.columns().length, 1);
  a.run(2); assert.ok(Math.hypot(a.at()[0] - 4, a.at()[1] - 2) < 0.01, 'stands at the end');
  a.g.heard(plan({ at: [4.5, 2], route: [], speed: 0, mode: 'loiter' })); a.run(1 / 60); assert.ok(a.at()[0] < 4.1, 'eases, no jump');
  a.run(1.5); assert.ok(Math.abs(a.at()[0] - 4.5) < 0.01);
  a.g.heard(plan({ at: [8, 8], route: [], speed: 0, mode: 'loiter' })); a.run(1 / 60); assert.ok(Math.hypot(a.at()[0] - 8, a.at()[1] - 8) < 0.01, 'jumps over 1 m');
  a.g.heard(plan({ at: [2, 2], route: [[6, 2]], age: 1500 })); a.run(1 / 60);
  assert.ok(Math.abs(a.at()[0] - 3.5) < 0.05 && Math.abs(a.at()[1] - 2) < 0.01, 'an aged plan counts from when it was sent');
});

test('a plan heard before the roster: the goose shows there once the roster names its sender (the host coming back)', () => {
  const a = goose(); a.run(0.5); // at home, by the lounge
  a.g.heard(plan({ route: [], speed: 0, mode: 'loiter' })); a.run(0.1);
  assert.ok(Math.hypot(a.at()[0] - 2, a.at()[1] - 2) > 1, 'at home it plays nothing');
  a.g.roster([P('a'), P('b', { goose: true })], 'a'); a.run(1 / 60);
  assert.equal(a.g.root.visible, true); assert.ok(Math.hypot(a.at()[0] - 2, a.at()[1] - 2) < 0.01);
});

test('through the door: reset hides the goose, and it comes back at home a second later', () => {
  const a = goose(); a.run(0.5); a.g.reset();
  assert.equal(a.g.root.visible, false); assert.deepEqual(a.g.columns(), []);
  a.run(0.9); assert.equal(a.g.root.visible, false); a.run(0.2); assert.equal(a.g.root.visible, true);
});

test('a take finds your own thing within 0.5 m, else a ghost; a drop lets either go', () => {
  const mug = { kind: { key: 'mug' }, pos: V(3, 0.05, 3), rest: true };
  const a = watching({ things: [mug] }); a.g.heard(plan()); a.run(0.1);
  a.g.heard({ type: 'goosed', id: 'b', what: 'take', kind: 'mug', spot: [3.2, 0.05, 3] }); a.run(0.1);
  assert.equal(typeof mug.carried, 'function'); assert.equal(a.ghosts.length, 0);
  a.g.heard(plan({ carry: 'mug' })); a.run(0.1); assert.equal(a.ghosts.length, 0, 'the plan agrees: no copy');
  a.g.heard({ type: 'goosed', id: 'b', what: 'drop' }); a.run(0.1); assert.equal(mug.carried, null); assert.ok(a.said.length);
  a.g.heard({ type: 'goosed', id: 'b', what: 'take', kind: 'mug', spot: [3.6, 0.05, 3] }); a.run(0.1);
  assert.equal(mug.carried, null); assert.equal(a.ghosts.at(-1).kind, 'mug');
  a.g.heard({ type: 'goosed', id: 'b', what: 'drop' }); a.run(0.1); assert.ok(a.ghosts.at(-1).gone);
});

test("a keeper change drops what's carried; a plan's carry puts a lost take or drop right", () => {
  const mug = { kind: { key: 'mug' }, pos: V(3, 0.05, 3), rest: true };
  const a = watching({ things: [mug] }); a.g.heard(plan()); a.run(0.1);
  a.g.heard({ type: 'goosed', id: 'b', what: 'take', kind: 'mug', spot: [3, 0.05, 3] }); a.run(0.1);
  a.g.roster([P('a'), P('b'), P('c', { goose: true })], 'a'); assert.equal(mug.carried, null);
  const b = watching(); b.g.heard(plan({ carry: 'paper' })); b.run(0.1); assert.equal(b.ghosts.at(-1).kind, 'paper'); // its take was lost
  b.g.heard(plan()); b.run(0.1); assert.ok(b.ghosts.at(-1).gone); // and its drop
});

test('taking it back from the beak: a poke, and no copy while the keeper catches up', () => {
  const mug = { kind: { key: 'mug' }, pos: V(3, 0.05, 3), rest: true };
  const a = watching({ things: [mug] }); a.g.heard(plan()); a.run(0.1);
  a.g.heard({ type: 'goosed', id: 'b', what: 'take', kind: 'mug', spot: [3, 0.05, 3] }); a.run(0.1);
  mug.held = true; a.run(1 / 60);
  assert.deepEqual(a.sent.filter(m => m.type === 'poke'), [{ type: 'poke', why: 'took' }]);
  a.g.heard(plan({ carry: 'mug' })); a.run(0.1); assert.equal(a.ghosts.length, 0);
  a.g.heard(plan()); a.g.heard(plan({ carry: 'mug' })); a.run(0.1); assert.equal(a.ghosts.length, 1, 'a later theft whose take was lost');
});

test('a nip shoves only the one nipped, and not while busy; a wake startles your sleeper by that seat', () => {
  const a = watching({ busy: false, sleepers: [{ id: 's1', at: V(4, 0, 4) }] }); a.g.heard(plan({ at: [1, 2], route: [] })); a.run(0.1);
  const from = a.player.position.clone();
  a.g.heard({ type: 'goosed', id: 'b', what: 'nip', who: 'c' }); a.run(1 / 60); assert.ok(a.player.position.equals(from)); assert.equal(a.said.at(-1), '💢');
  a.g.heard({ type: 'goosed', id: 'b', what: 'nip', who: 'a' }); a.run(1 / 60); assert.ok(Math.abs(a.player.position.distanceTo(from) - 0.35) < 1e-6);
  a.g.heard({ type: 'goosed', id: 'b', what: 'wake', spot: [5, 4] }); assert.deepEqual(a.woken, []);
  a.g.heard({ type: 'goosed', id: 'b', what: 'wake', spot: [4.2, 4] }); assert.deepEqual(a.woken, ['s1']);
  const b = watching({ busy: true }); b.g.heard(plan()); b.run(0.1); const was = b.player.position.clone();
  b.g.heard({ type: 'goosed', id: 'b', what: 'nip', who: 'a' }); b.run(1 / 60); assert.ok(b.player.position.equals(was));
});

test('a watcher pokes the keeper; with reduced motion it only honks', () => {
  const a = watching(); a.g.heard(plan()); a.run(0.1); a.g.poke(); a.g.hit();
  assert.deepEqual(a.sent.filter(m => m.type === 'poke'), [{ type: 'poke', why: 'click' }, { type: 'poke', why: 'hit' }]); assert.deepEqual(a.said, []);
  const b = watching({ still: true }); b.g.heard(plan()); b.run(0.1); b.g.poke(); b.g.hit();
  assert.deepEqual(b.sent.filter(m => m.type === 'poke'), []); assert.deepEqual(b.said, ['🪿', '💢']);
  b.run(0.9); assert.ok(Math.abs(b.at()[0] - 3) < 0.05, 'with reduced motion it still moves at a meeting');
});

// routeAt calls a route with no speed moving, with a heading: the watcher's goose mustn't walk on the spot or face along it.
test("a plan with no speed and a route: it stands, turned to the plan's yaw, feet still", () => {
  const a = watching(); a.g.heard(plan({ route: [[3, 2]] })); a.run(1.5); // walked a metre, so its legs have swung
  a.g.heard(plan({ at: [3, 2], route: [[3, 4]], speed: 0, yaw: 1.5, mode: 'loiter' })); a.run(1);
  const [, leg] = a.g.root.children;
  assert.ok(Math.hypot(a.at()[0] - 3, a.at()[1] - 2) < 1e-9); assert.ok(Math.abs(a.g.root.rotation.y - 1.5) < 0.01, `yaw ${a.g.root.rotation.y}`);
  assert.ok(Math.abs(leg.rotation.x) < 0.01, `leg at ${leg.rotation.x}`);
});

// roster() lets go of what it carries; a theft on its way must end there, not reach for nothing (face(loot.pos) would throw).
test('a keeper change mid-theft: it lets go and loiters, home to keeper while fetching and keeper to home while reaching', () => {
  const mug = () => ({ kind: { key: 'mug' }, pos: V(5, 0.05, 5), rest: true });
  const a = goose({ things: [mug()] }); assert.ok(a.run(150, () => a.g.mode === 'fetch'), 'off to steal');
  a.g.roster([P('a', { goose: true })], 'a'); a.run(20); // long enough for the fetch walk to have ended
  assert.ok(['loiter', 'walk'].includes(a.g.mode), a.g.mode);
  const thing = mug(), b = goose({ things: [thing] }); b.g.roster([P('a', { goose: true })], 'a');
  assert.ok(b.run(150, () => b.g.mode === 'reach'), 'reaching for it');
  b.g.roster([], 'a'); b.run(5);
  assert.ok(['loiter', 'walk'].includes(b.g.mode), b.g.mode); assert.ok(!thing.carried);
});

test("a walk's route run out: it keeps its heading, not the yaw sent before it set off", () => {
  const a = watching(); a.g.heard(plan({ yaw: -1.5 })); a.run(3); // east, done after 2 s
  assert.ok(Math.abs(a.g.root.rotation.y - Math.PI / 2) < 0.01, `yaw ${a.g.root.rotation.y}`);
});

test('a take after you took it back: the keeper has moved on, so a later lost take shows its copy again', () => {
  const mug = { kind: { key: 'mug' }, pos: V(3, 0.05, 3), rest: true };
  const a = watching({ things: [mug] }); a.g.heard(plan()); a.run(0.1);
  a.g.heard({ type: 'goosed', id: 'b', what: 'take', kind: 'mug', spot: [3, 0.05, 3] }); a.run(0.1);
  mug.held = true; a.run(1 / 60); // took it back
  a.g.heard({ type: 'goosed', id: 'b', what: 'take', kind: 'paper', spot: [6, 0.05, 6] }); a.g.heard({ type: 'goosed', id: 'b', what: 'drop' }); a.run(0.1);
  assert.equal(a.ghosts.length, 1); assert.ok(a.ghosts[0].gone);
  a.g.heard(plan({ carry: 'paper' })); a.run(0.1); assert.equal(a.ghosts.length, 2, 'its take was lost: a copy');
});

test("a hidden watcher's goose ignores events; its first plan's carry puts the beak right", () => {
  const mug = { kind: { key: 'mug' }, pos: V(3, 0.05, 3), rest: true };
  const a = watching({ busy: false, things: [mug], sleepers: [{ id: 's1', at: V(4, 0, 4) }] }); a.run(0.1); const from = a.player.position.clone();
  for (const m of [{ what: 'nip', who: 'a' }, { what: 'take', kind: 'mug', spot: [3, 0.05, 3] }, { what: 'wake', spot: [4, 4] }, { what: 'honk', icon: '💢' }, { what: 'drop' }]) a.g.heard({ type: 'goosed', id: 'b', ...m });
  a.run(0.1);
  assert.deepEqual(a.said, []); assert.deepEqual(a.woken, []); assert.deepEqual(a.ghosts, []); assert.ok(!mug.carried); assert.ok(a.player.position.equals(from));
  a.g.heard(plan({ carry: 'mug' })); a.run(0.1); assert.equal(a.ghosts.at(-1).kind, 'mug');
});

const keeping = (o = {}) => { const a = goose(o); a.g.roster([P('a', { goose: true })], 'a'); return a; };
const plans = a => a.sent.filter(m => m.type === 'goose'), events = a => a.sent.filter(m => m.type === 'goosed');

test('a keeper sends plans, on a change at most twice a second and every 2 s, and no random honks', () => {
  const a = keeping(); a.run(120);
  const sent = plans(a); assert.ok(sent.length >= 60 && sent.length <= 240, `${sent.length} plans`);
  for (const m of sent) assert.deepEqual(checkUp(m), m);
  assert.deepEqual(a.said, []); assert.deepEqual(events(a), []);
  const home = goose(); home.run(120); assert.ok(home.said.length >= 2, 'honks at home, as before');
  const still = keeping({ still: true }); still.run(120);
  assert.ok(plans(still).some(m => m.route.length > 0), "a keeper with reduced motion runs it for everyone");
});

test("a friend's poke sets off a chase aimed at them, which ends in a nip; a busy friend just gets a honk", () => {
  let friends = [{ id: 'b', x: 6, z: 3, busy: false }];
  const a = keeping({ others: () => friends }); a.run(0.1);
  a.g.heard({ type: 'poke', id: 'b', why: 'click' }); a.run(0.6);
  assert.deepEqual(events(a)[0], { type: 'goosed', what: 'honk', icon: '🪿' });
  const chase = plans(a).at(-1); assert.equal(chase.mode, 'chase'); assert.ok(Math.hypot(chase.route.at(-1)[0] - 6, chase.route.at(-1)[1] - 3) < 0.3);
  assert.ok(a.run(10, () => events(a).some(m => m.what === 'nip')));
  assert.deepEqual(events(a).find(m => m.what === 'nip'), { type: 'goosed', what: 'nip', who: 'b' });
  const b = keeping({ others: () => [{ id: 'b', x: 6, z: 3, busy: true }] }); b.run(0.1);
  b.g.heard({ type: 'poke', id: 'b', why: 'hit' }); b.run(0.6);
  assert.deepEqual(events(b), [{ type: 'goosed', what: 'honk', icon: '💢' }]); assert.notEqual(b.g.mode, 'chase');
});

test('a poke while it carries something: the drop goes out before the honk', () => {
  let friends = [];
  const mug = { kind: { key: 'mug' }, pos: V(5, 0.05, 5), rest: true };
  const a = keeping({ things: [mug], others: () => friends });
  assert.ok(a.run(150, () => events(a).some(m => m.what === 'take')), 'stole the mug');
  assert.deepEqual(events(a).at(-1), { type: 'goosed', what: 'take', kind: 'mug', spot: [5, 0.05, 5] });
  friends = [{ id: 'b', x: 2, z: 8, busy: false }]; a.g.heard({ type: 'poke', id: 'b', why: 'took' });
  assert.deepEqual(events(a).slice(-2), [{ type: 'goosed', what: 'drop' }, { type: 'goosed', what: 'honk', icon: '💢' }]);
  assert.equal(mug.carried, null);
});

test('a new arrival gets a plan within half a second', () => {
  const a = keeping(); a.run(3); const before = plans(a).length;
  a.g.roster([P('a', { goose: true }), P('b')], 'a'); a.run(0.5); assert.ok(plans(a).length > before);
});

test('taking over carries on from where the goose is: a walk finishes its route, and the plan goes at once', () => {
  const a = goose(); a.g.roster([P('a'), P('b', { goose: true })], 'a');
  a.g.heard({ type: 'goose', id: 'b', at: [2, 2], yaw: 0, mode: 'visit', idle: 'look', speed: 0.75, route: [[4, 2], [4, 4]], carry: null, target: null }); a.run(1);
  const drawn = a.at(); a.g.roster([P('a', { goose: true }), P('b')], 'a'); a.run(1 / 60);
  const m = plans(a).at(-1); assert.equal(m.mode, 'walk'); assert.deepEqual(m.route.at(-1), [4, 4]);
  assert.ok(Math.hypot(m.at[0] - drawn[0], m.at[1] - drawn[1]) < 0.05);
  const b = goose(); b.g.roster([P('a'), P('b', { goose: true })], 'a');
  b.g.heard({ type: 'goose', id: 'b', at: [2, 2], yaw: 0, mode: 'chase', idle: 'look', speed: 2.6, route: [[6, 2]], carry: null, target: null }); b.run(0.5);
  b.g.roster([P('a', { goose: true }), P('b')], 'a'); b.run(1 / 60); assert.equal(plans(b).at(-1).mode, 'loiter');
  const c = goose(); c.g.roster([P('a'), P('b', { goose: true })], 'a'); // the link drops: an empty roster
  c.g.heard({ type: 'goose', id: 'b', at: [2, 2], yaw: 0, mode: 'visit', idle: 'look', speed: 0.75, route: [[4, 2], [4, 4]], carry: null, target: null }); c.run(1);
  const there = c.at(); c.g.roster([], 'a'); c.run(1 / 60);
  assert.equal(c.g.root.visible, true); assert.equal(c.g.mode, 'walk'); assert.ok(Math.hypot(c.at()[0] - there[0], c.at()[1] - there[1]) < 0.05);
});

// By the food a few cm off its spot could shut the snake out: a visit walked on ends right on the route's end, and a mill stands
// on the plan's spot, not where the easing still has it.
test('taking over by the food: a visit walked on ends right on its spot, and a mill stands on the plan\'s spot', () => {
  const visit = { type: 'goose', id: 'b', at: [2, 2], yaw: 0, mode: 'visit', idle: 'look', speed: 0.75, route: [[4, 2], [4, 4]], carry: null, target: null };
  for (const after of [[P('a', { goose: true }), P('b')], []]) {
    const a = watching(); a.g.heard(visit); a.run(1); a.g.roster(after, 'a');
    assert.ok(a.run(10, () => a.g.mode !== 'walk')); assert.ok(Math.hypot(a.at()[0] - 4, a.at()[1] - 4) < 1e-9, `at ${a.at()}`);
    const b = watching(); b.g.heard(plan({ at: [4, 2], route: [], speed: 0, mode: 'loiter' })); b.run(0.1);
    b.g.heard(plan({ at: [4.5, 2], route: [], speed: 0, mode: 'mill' })); b.run(1 / 60); b.g.roster(after, 'a'); b.run(1);
    assert.ok(Math.hypot(b.at()[0] - 4.5, b.at()[1] - 2) < 1e-9, `at ${b.at()}`);
  }
});

// Rulings beyond the brief: a plan heard at home is carried on from only under 10 s old (the server's limit), and your own
// charge, nip and shove as keeper; with reduced motion your click or hit just honks there, and a nip doesn't shove you.
test('keeping it from home: on from a plan heard under 10 s ago, else from where it was', () => {
  const heard = { type: 'goose', id: 'b', at: [2, 2], yaw: 0, mode: 'walk', idle: 'look', speed: 1, route: [[4, 2]], carry: null, target: null, age: 500 };
  const a = goose(); a.run(0.5); a.g.heard(heard); a.run(1); a.g.roster([P('a', { goose: true })], 'a'); a.run(1 / 60);
  assert.ok(Math.hypot(a.at()[0] - 3.5, a.at()[1] - 2) < 0.05, `at ${a.at()}`); assert.equal(a.g.mode, 'walk'); assert.equal(plans(a).length, 1);
  const b = goose(); b.run(0.5); b.g.heard({ ...heard, age: 0 }); b.run(10.5); const was = b.at();
  b.g.roster([P('a', { goose: true })], 'a'); b.run(1 / 60); assert.ok(Math.hypot(b.at()[0] - was[0], b.at()[1] - was[1]) < 0.05, 'a stale plan is let be');
});

test('a keeper charges you and shoves you on a nip; with reduced motion your click or hit only honks, and a nip leaves you be', () => {
  const near = a => { const [x, z] = a.at(); a.player.position.set(x + 1, 1.6, z); return a.player.position.clone(); };
  const a = keeping({ busy: false }); a.run(0.1); const from = near(a);
  assert.ok(a.run(2, () => events(a).some(m => m.what === 'nip')));
  assert.deepEqual(events(a), [{ type: 'goosed', what: 'honk', icon: '🪿' }, { type: 'goosed', what: 'nip', who: 'a' }]);
  assert.ok(Math.abs(a.player.position.distanceTo(from) - 0.35) < 1e-6);
  const b = keeping({ busy: false, still: true }); b.run(0.1); b.g.poke(); b.g.hit();
  assert.deepEqual(b.said, ['🪿', '💢']); assert.deepEqual(events(b), []); assert.notEqual(b.g.mode, 'chase');
  const still = near(b); assert.ok(b.run(2, () => events(b).some(m => m.what === 'nip'))); assert.ok(b.player.position.equals(still), 'no shove');
});

// The paths most likely to break later.
const taken = { type: 'goosed', what: 'take', kind: 'mug', spot: [5, 0.05, 5] };
test('your own take-back as keeper: one drop out, then one 💢 honk', () => {
  const mug = { kind: { key: 'mug' }, pos: V(5, 0.05, 5), rest: true }, a = keeping({ things: [mug] });
  assert.ok(a.run(150, () => events(a).length > 0), 'stole the mug');
  mug.held = true; mug.carried = null; a.run(0.5); // as props.js has a pickup
  assert.deepEqual(events(a), [taken, { type: 'goosed', what: 'drop' }, { type: 'goosed', what: 'honk', icon: '💢' }]);
  for (const m of events(a)) assert.deepEqual(checkUp(m), m);
  assert.deepEqual(a.said, ['💢']);
});

test('a chase ends, with no nip, once its prey is busy or gone from the meeting', () => {
  for (const end of [friends => { friends[0].busy = true; }, friends => { friends.length = 0; }]) {
    const friends = [{ id: 'b', x: 2, z: 8, busy: false }], a = keeping({ others: () => friends }); a.run(0.1);
    a.g.heard({ type: 'poke', id: 'b', why: 'click' }); a.run(0.3); assert.equal(a.g.mode, 'chase');
    end(friends); a.run(1 / 60); assert.notEqual(a.g.mode, 'chase');
    a.run(5); assert.notEqual(a.g.mode, 'chase'); assert.ok(!events(a).some(m => m.what === 'nip'));
  }
});

test('a keeper change mid-carry or mid-chase, to watching or home: it lets go, runs on and sends nothing', () => {
  for (const after of [[P('a'), P('b', { goose: true })], []]) {
    const mug = { kind: { key: 'mug' }, pos: V(5, 0.05, 5), rest: true }, a = keeping({ things: [mug] });
    assert.ok(a.run(150, () => events(a).length > 0), 'stole the mug'); a.run(0.5); assert.equal(typeof mug.carried, 'function');
    a.g.roster(after, 'a'); let sent = a.sent.length; a.run(5);
    assert.equal(mug.carried, null); assert.deepEqual(a.ghosts, []); assert.ok(['loiter', 'walk'].includes(a.g.mode), a.g.mode); assert.equal(a.sent.length, sent);
    const friends = [{ id: 'b', x: 2, z: 8, busy: false }], b = keeping({ others: () => friends }); b.run(0.1);
    b.g.heard({ type: 'poke', id: 'b', why: 'click' }); b.run(0.3); assert.equal(b.g.mode, 'chase');
    b.g.roster(after, 'a'); sent = b.sent.length; b.run(5);
    assert.ok(['loiter', 'walk'].includes(b.g.mode), b.g.mode); assert.equal(b.sent.length, sent);
  }
});

test('as keeper, a sleeper honked awake goes out as a wake by their seat', () => {
  const a = keeping({ sleepers: [{ id: 's1', at: V(4, 0, 4) }] });
  assert.ok(a.run(200, () => events(a).length > 0), 'pranked');
  assert.deepEqual(events(a), [{ type: 'goosed', what: 'wake', spot: [4, 4] }]); assert.deepEqual(checkUp(events(a)[0]), events(a)[0]);
  assert.deepEqual(a.woken, ['s1']);
});

test("into a meeting, reset keeps the keeper's plan heard before the floor and shows it; going home, it waits for the next", () => {
  for (const into of [true, false]) {
    const a = watching(); a.run(0.5); a.g.heard(plan({ at: [6, 6], route: [], speed: 0, mode: 'loiter' })); a.run(0.1);
    a.g.reset(into); a.run(1 / 60);
    assert.equal(a.g.root.visible, into);
    if (into) assert.ok(Math.hypot(a.at()[0] - 6, a.at()[1] - 6) < 0.01, "at the plan's spot");
    else { a.run(2); assert.equal(a.g.root.visible, false, 'hidden till the next plan'); a.g.heard(plan({ at: [6, 6], route: [], speed: 0, mode: 'loiter' })); a.run(1 / 60); assert.equal(a.g.root.visible, true); }
  }
});
