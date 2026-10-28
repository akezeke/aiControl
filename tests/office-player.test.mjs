import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolveStep } from '../client/office/player.js';

const box = (x1, z1, x2, z2) => new THREE.Box3(new THREE.Vector3(x1, 0, z1), new THREE.Vector3(x2, 1, z2));
const room = { width: 10, depth: 10 };

test('walls and desks still block you', () => {
  const p = resolveStep(new THREE.Vector3(2, 1.5, 2), new THREE.Vector3(1, 0, 0), [box(2.5, 0, 3, 4)], room);
  assert.equal(p.x, 2);
});
test('a desk that appears on top of you does not trap you', () => {
  const p = resolveStep(new THREE.Vector3(2, 1.5, 2), new THREE.Vector3(-0.1, 0, 0), [box(1.5, 1.5, 2.5, 2.5)], room);
  assert.equal(p.x, 1.9);
});
test('you stay inside the room', () => {
  const p = resolveStep(new THREE.Vector3(5, 1.5, 14), new THREE.Vector3(0, 0, 0.1), [], room);
  assert.ok(p.z <= 10);
});
