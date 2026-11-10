import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTrack, gait, atMeeting, createFriends } from '../client/office/friends.js';
import { createSnakes } from '../client/office/snakes.js';

// Plays `moves` ([sent s, arrives s, x, extra]) through a track a frame at a time, from 0 to `until` s; the drawn place each frame.
function play(moves, until, track = createTrack()) {
  const out = {}, drawn = []; let i = 0;
  for (let f = 0; f / 60 < until; f++) {
    const now = f / 60;
    while (i < moves.length && moves[i][1] <= now) { const [t, , x, extra] = moves[i++]; track.heard({ t: t * 1000, x, y: 0, z: 0, yaw: 0, pose: 'walking', ...extra }, now); }
    const at = track.at(now, out); if (at) drawn.push({ now, ...at });
  }
  return drawn;
}

test('a track plays bunched-up moves back at an even pace and stops where they stopped', () => {
  // 4 m/s for 3 s, a move every 1/15 s, every third one 80 ms late (the ones after it wait behind it, as on a socket).
  let arrive = 0; const moves = [];
  for (let k = 0; k <= 45; k++) { const t = k / 15; arrive = Math.max(arrive, t + 0.01 + (k % 3 ? 0 : 0.08)); moves.push([t, arrive, 4 * t]); }
  const drawn = play(moves, 5);
  const speeds = drawn.slice(61, 180).map((d, i) => (d.x - drawn[60 + i].x) * 60);
  assert.ok(speeds.every(v => v > 3.4 && v < 4.6), speeds.map(v => v.toFixed(1)).join(' '));
  assert.equal(drawn.at(-1).x, 12); assert.ok(drawn.every(d => d.x <= 12), 'no overshoot');
});

test('a track shows the first move at once, stands still through a pause and snaps a teleport', () => {
  assert.equal(createTrack().at(0, {}), null);
  // Still at 0 (and said again at 2 s), walking from 3 s: nobody drifts off before then.
  const pause = play([[0, 0.01, 0], [2, 2.01, 0], [3, 3.01, 0.1], [3 + 1 / 15, 3.08, 0.2]], 4);
  assert.equal(pause[0].x, 0); assert.ok(pause.filter(d => d.now < 3).every(d => d.x === 0)); assert.equal(pause.at(-1).x, 0.2);
  // The door: from 0 to 10 in one move is 0 then 10, nothing between.
  assert.ok(play([[0, 0.01, 0], [1 / 15, 0.08, 10]], 1).every(d => d.x === 0 || d.x === 10));
  // Yaw takes the short way round, up through pi.
  const turn = play([[0, 0.01, 0, { yaw: 3 }], [1 / 15, 0.08, 0, { yaw: -3 }]], 1);
  assert.ok(turn.some(d => d.yaw > 3.1) && turn.every(d => d.yaw >= 3 || d.yaw === -3), turn.map(d => d.yaw.toFixed(2)).join(' '));
});

test('a track starts again when their clock goes back, and plays moves without one by when they came', () => {
  const track = createTrack(), out = {};
  track.heard({ t: 10_000, x: 1, y: 0, z: 0, yaw: 0, pose: 'standing' }, 0); track.at(0, out);
  track.heard({ t: 500, x: 5, y: 0, z: 0, yaw: 0, pose: 'running' }, 0.1); // a reload
  assert.equal(track.at(0.1, out).x, 5); assert.equal(out.pose, 'running');
  const bare = createTrack(); bare.heard({ x: 2, y: 0, z: 0, yaw: 0, pose: 'standing' }, 7);
  assert.equal(bare.at(7, out).x, 2);
});

test('gait by speed', () => {
  assert.equal(gait(0), 'standing'); assert.equal(gait(0.29), 'standing');
  assert.equal(gait(0.3), 'walking'); assert.equal(gait(2.99), 'walking');
  assert.equal(gait(3.1), 'running');
});

test('a friend at home isn\'t built, nor are you', t => {
  const blank = () => new Proxy({}, { get: (_, k) => k === 'measureText' ? () => ({ width: 50 }) : () => ({ addColorStop() {} }), set: () => true }), was = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: blank }) };
  t.after(() => { if (was) globalThis.document = was; else delete globalThis.document; });
  const roster = [{ id: 'a', at: 'meeting' }, { id: 'b', at: 'home' }, { id: 'me', at: 'meeting' }];
  assert.deepEqual(atMeeting(roster, 'me').map(p => p.id), ['a']);
  const scene = new THREE.Scene(), friends = createFriends(scene, { room: { kitchen: { inside: () => false, shown: false }, secret: { inside: () => false, shown: false } } });
  const p = (id, at) => ({ id, name: 'Pip', fruit: 'apple', colour: '#3a86ff', at });
  friends.sync([p('b', 'home')], 'me'); assert.equal(scene.children.length, 0);
  friends.sync([p('a', 'meeting')], 'me'); assert.equal(scene.children.length, 1);
  friends.sync([p('a', 'home')], 'me'); assert.equal(scene.children.length, 0, 'gone when they leave the meeting');
  friends.move('a', { x: 3, y: 0, z: 4, yaw: 0, pose: 'standing' }); // a move heard before the roster says they're here
  friends.sync([p('a', 'meeting')], 'me', false); assert.equal(scene.children.length, 0, 'not at the meeting yourself: nobody shown');
  friends.sync([p('a', 'meeting')], 'me'); assert.equal(scene.children[0].visible, true); friends.update(0.016); assert.equal(scene.children[0].position.x, 3);
  friends.dispose(); assert.equal(scene.children.length, 0);
});

test('friends are not clickable', t => {
  const blank = () => new Proxy({}, { get: (_, k) => k === 'measureText' ? () => ({ width: 50 }) : () => ({ addColorStop() {} }), set: () => true }), was = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: blank }) };
  t.after(() => { if (was) globalThis.document = was; else delete globalThis.document; });
  const scene = new THREE.Scene(), friends = createFriends(scene, { room: { kitchen: { inside: () => false, shown: false }, secret: { inside: () => false, shown: false } } });
  friends.sync([{ id: 'a', name: 'Pip', fruit: 'apple', colour: '#3a86ff', at: 'meeting' }], 'me');
  friends.move('a', { x: 0, y: 0, z: 0, yaw: 0, pose: 'standing' }); friends.update(0.016);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0.8, 5), new THREE.Vector3(0, 0, -1));
  assert.deepEqual(ray.intersectObject(scene.children[0], true), []);
});

// Watching snakes: Pip (a) at the meeting, as fruit and, once heard, as a snake, on a clock the test moves (`frame` moves it
// on and updates both); the fruit's hidden while the snake's there. Canvases take any drawing, put back after the test.
const msg = { type: 'snake', mode: 'ready', head: [2.125, 3.125], path: '-'.repeat(15), dir: 1, rate: 8, food: [4.125, 3.125], plant: 2 };
const off = { type: 'snake', mode: 'off' }, pip = at => ({ id: 'a', name: 'Pip', fruit: 'apple', colour: '#3a86ff', at });
const shut = (kitchen = false) => ({ kitchen: { inside: () => kitchen, shown: false }, secret: { inside: () => false, shown: false } });
function watch(t, room = shut()) {
  const ctx = () => new Proxy({}, { get: (o, k) => k in o ? o[k] : k === 'measureText' ? () => ({ width: 50 }) : () => ({ addColorStop() {} }), set: (o, k, v) => { o[k] = v; return true; } }), was = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: ctx }) };
  t.after(() => { if (was) globalThis.document = was; else delete globalThis.document; });
  const w = { now: 0, scene: new THREE.Scene() }, clock = () => w.now;
  w.snakes = createSnakes(w.scene, { room, clock });
  w.friends = createFriends(w.scene, { room, clock, hidden: id => w.snakes.has(id) });
  w.friends.sync([pip('meeting')], 'me'); w.snakes.sync([pip('meeting')], 'me'); w.fruit = w.scene.children[0];
  w.friends.move('a', { x: 5, y: 0, z: 5, yaw: 0, pose: 'standing' });
  w.frame = (dt = 1 / 60) => { w.now += dt; w.snakes.update(dt); w.friends.update(dt); };
  w.snake = () => w.scene.children.find(c => c !== w.fruit) ?? null;
  w.tag = () => w.snake().children.find(c => c.isSprite).getWorldPosition(new THREE.Vector3());
  return w;
}

test('a player with a snake is hidden, and the snake carries their name', t => {
  const w = watch(t);
  w.frame(); assert.equal(w.fruit.visible, true);
  w.snakes.heard('a', msg); w.frame();
  assert.equal(w.fruit.visible, false); assert.equal(w.snakes.taken(2), 'Pip'); assert.equal(w.snakes.taken(0), null);
  const tag = w.tag(); assert.ok(Math.abs(tag.x - 2.125) < 0.05 && Math.abs(tag.z - 3.125) < 0.05, `${tag.x} ${tag.z}`);
  w.scene.updateMatrixWorld(); const ray = new THREE.Raycaster(new THREE.Vector3(2.125, 2, 3.125), new THREE.Vector3(0, -1, 0)); // down onto its head
  assert.deepEqual(ray.intersectObject(w.snake(), true), [], 'not clickable');
});

test('the tag follows the head', t => {
  const w = watch(t);
  w.snakes.heard('a', msg); w.frame();
  w.snakes.heard('a', { ...msg, mode: 'play', head: [2.375, 3.125], path: '3' + '-'.repeat(14) });
  for (let k = 0; k < 8; k++) w.frame(1 / 64);
  assert.ok(Math.abs(w.tag().x - 2.375) < 0.05, `${w.tag().x}`);
});

test('off, silence or going home takes the snake away', t => {
  const w = watch(t), gone = why => { assert.equal(w.snakes.has('a'), false, why); assert.equal(w.snake(), null, why); };
  w.snakes.heard('a', msg); w.frame(); const group = w.snake();
  w.snakes.heard('a', off); w.frame();
  gone('off'); assert.equal(group.parent, null); assert.equal(w.fruit.visible, true, 'the fruit is back');
  w.snakes.heard('a', msg); w.frame(); assert.equal(w.snakes.has('a'), true);
  w.now += 5.1; w.frame(); gone('silence'); assert.equal(w.fruit.visible, true, 'the fruit is back');
  w.snakes.heard('a', msg); w.snakes.sync([pip('home')], 'me'); gone('home');
  w.snakes.heard('a', msg); gone('not at the meeting: not heard');
  w.snakes.sync([pip('meeting')], 'me'); w.snakes.heard('a', msg); w.snakes.sync([pip('meeting')], 'me', false); gone('you left');
  w.snakes.heard('a', msg); gone('you are not there: not heard');
});

test('a snake in a shut kitchen is hidden', t => {
  const w = watch(t, shut(true));
  w.snakes.heard('a', msg); w.frame();
  assert.equal(w.snake().visible, false);
});

test('a snake rebuilt or dropped frees what it made, not what it shares', t => {
  const w = watch(t);
  w.snakes.heard('a', msg); w.frame();
  const group = w.snake(), sprite = group.children.find(c => c.isSprite), model = () => group.children.find(c => !c.isSprite);
  const freed = new Set(), mark = (...things) => { for (const x of things) x.addEventListener('dispose', () => freed.add(x)); return things; };
  // A model's own: its tube and the tube's material. Shared: the head piece and the fruit food.
  const food = m => m.children[2].children[0].children[0], own = m => mark(m.children[0].geometry, m.children[0].material);
  const shares = m => mark(m.children[1].children[0].geometry, food(m).geometry, food(m).material);
  const first = model(), made = own(first), shared = shares(first), [oldTag] = mark(sprite.material.map);
  assert.equal(food(first).material.userData.shared, true);
  // A new colour: a new model, and the name redrawn in it.
  w.snakes.sync([{ ...pip('meeting'), colour: '#ff5d8f' }], 'me'); w.frame();
  const second = model();
  assert.notEqual(second, first); assert.equal(first.parent, null, 'the old look leaves');
  assert.ok(made.every(x => freed.has(x)), 'its tube is freed'); assert.ok(freed.has(oldTag) && sprite.material.map !== oldTag, 'the name redrawn');
  assert.ok(shared.every(x => !freed.has(x)), 'what it shared is kept');
  const tag = mark(sprite.material, sprite.material.map), again = own(second), kept = shares(second);
  w.snakes.heard('a', off);
  assert.equal(group.parent, null); assert.equal(second.parent, null);
  assert.ok([...tag, ...again].every(x => freed.has(x)), 'model and tag freed'); assert.ok(kept.every(x => !freed.has(x)), 'what it shared is kept');
  w.snakes.heard('a', msg); w.frame(); const [last] = mark(w.snake().children.find(c => c.isSprite).material);
  w.snakes.dispose(); assert.equal(w.snake(), null); assert.equal(w.snakes.has('a'), false); assert.ok(freed.has(last), 'dispose frees them too');
});

test('foods() lists the food and head of snakes in play, copied; positions() who stands where and whether busy', t => {
  const w = watch(t);
  w.snakes.heard('a', { ...msg, mode: 'play', food: [4.125, 1.875] }); w.frame();
  const [f] = w.snakes.foods();
  assert.deepEqual(w.snakes.foods(), [{ food: [4.125, 1.875], head: [2.125, 3.125] }]);
  f.food[0] = 0; f.head[0] = 0; assert.deepEqual(w.snakes.foods(), [{ food: [4.125, 1.875], head: [2.125, 3.125] }], 'copies');
  w.snakes.heard('a', { ...msg, mode: 'over' }); assert.deepEqual(w.snakes.foods(), []);
  assert.deepEqual(w.friends.positions(), [{ id: 'a', x: 5, z: 5, busy: false }]);
  w.friends.positions()[0].x = 0; assert.equal(w.friends.positions()[0].x, 5);
});

test('positions(): busy while playing, or in the kitchen; none before a position is heard', t => {
  const w = watch(t);
  w.friends.move('a', { x: 5, y: 0, z: 5, yaw: 0, pose: 'playing', t: 1000 }); w.frame(1);
  assert.equal(w.friends.positions()[0].busy, true);
  const k = watch(t, shut(true)); k.frame();
  assert.equal(k.friends.positions()[0].busy, true);
  assert.deepEqual(createFriends(new THREE.Scene(), { room: shut() }).positions(), []);
});
