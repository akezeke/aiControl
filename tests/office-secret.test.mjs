import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSecret, DOOR } from '../client/office/secret.js';
import { WALL_T } from '../client/office/furniture.js';

// No document in Node: a blank canvas for its textures.
const blank = () => new Proxy({}, { get: (t, k) => k in t ? t[k] : () => ({ addColorStop() {} }), set: (t, k, v) => { t[k] = v; return true; } });
const V = (x, z) => new THREE.Vector3(x, 0, z), WIDTH = 12, DEPTH = 10, Z = DEPTH - DOOR.back;
const run = (secret, at, seconds = 1, others = []) => { for (let i = 0; i < seconds * 60; i++) secret.update(1 / 60, at, false, 0, others); };

test('from inside, walking up to the shelf opens it; it shuts by itself only once nobody is in the room or near it', t => {
  const was = globalThis.document; globalThis.document = { createElement: () => ({ getContext: blank }) };
  t.after(() => { if (was) globalThis.document = was; else delete globalThis.document; });
  const slid = [], secret = createSecret({ onPress() {}, onMove() {}, onSlide: open => slid.push(open) });
  secret.build({ width: WIDTH, depth: DEPTH, shell: new THREE.Group() });
  const deep = V(WIDTH + 6, Z), byShelf = V(WIDTH + WALL_T + 0.6, Z), office = V(WIDTH - 6, Z);
  assert.ok(secret.inside(deep) && secret.inside(byShelf) && !secret.inside(office));
  run(secret, deep); assert.equal(secret.open, false, 'shut on you, deep in the room');
  run(secret, byShelf); assert.equal(secret.open, true); assert.deepEqual(slid, [true], 'the meeting hears it');
  run(secret, office, 6, [deep]); assert.equal(secret.open, true, 'someone else is still in there');
  run(secret, office, 6); assert.equal(secret.open, false);
  assert.deepEqual(slid, [true], 'shutting by itself is left to each page');
  secret.set(true); assert.equal(secret.open, true); assert.deepEqual(slid, [true], "someone else's slide isn't said again");
});
