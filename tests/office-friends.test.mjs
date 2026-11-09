import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTrack, gait, atMeeting, createFriends } from '../client/office/friends.js';

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
