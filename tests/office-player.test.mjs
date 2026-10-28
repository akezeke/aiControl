import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolveStep, standNear } from '../client/office/player.js';

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

test('you stand in front of someone, on the side you come from', () => {
  const p = standNear(new THREE.Vector3(5, 1.2, 5), new THREE.Vector3(5, 1.5, 9), [], room);
  assert.ok(Math.abs(p.x - 5) < 1e-9 && Math.abs(p.z - 6.1) < 1e-9);
});
test('a desk in the way puts you beside them instead', () => {
  const target = new THREE.Vector3(5, 1.2, 5), p = standNear(target, new THREE.Vector3(5, 1.5, 9), [box(3.5, 5.4, 6.5, 6.5)], room);
  assert.ok(p.z < 5.4 - 0.3 || p.x < 3.5 - 0.3 || p.x > 6.5 + 0.3);
  assert.ok(Math.abs(Math.hypot(p.x - 5, p.z - 5) - 1.1) < 1e-9);
});
test('nowhere to stand: null', () => {
  assert.equal(standNear(new THREE.Vector3(5, 1.2, 5), new THREE.Vector3(5, 1.5, 9), [box(3, 3, 7, 7)], room), null);
});
