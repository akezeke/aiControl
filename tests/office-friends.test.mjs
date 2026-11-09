import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ease, gait, atMeeting, createFriends } from '../client/office/friends.js';

test('ease reaches the target and snaps a teleport', () => {
  let p = { x: 0, y: 0, z: 0, yaw: 0 };
  const to = { x: 1, y: 0, z: -1, yaw: 1 };
  for (let i = 0; i < 18; i++) p = ease(p, to, 1 / 60); // 0.3 s
  assert.ok(Math.abs(p.x - 1) < 0.02 && Math.abs(p.z + 1) < 0.02 && Math.abs(p.yaw - 1) < 0.02, JSON.stringify(p));
  const one = ease({ x: 0, y: 0, z: 0, yaw: 0 }, to, 1 / 60);
  assert.ok(one.x > 0 && one.x < 1, 'a step moves part of the way');
  assert.deepEqual(ease({ x: 0, y: 0, z: 0, yaw: 0 }, { x: 10, y: 0, z: 0, yaw: 2 }, 1 / 60), { x: 10, y: 0, z: 0, yaw: 2 });
  // yaw takes the short way round
  const turn = ease({ x: 0, y: 0, z: 0, yaw: 3 }, { x: 0, y: 0, z: 0, yaw: -3 }, 1 / 60);
  assert.ok(turn.yaw > 3, 'turns up through pi, not back through zero');
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
  friends.sync([p('a', 'meeting')], 'me'); friends.dispose(); assert.equal(scene.children.length, 0);
});
