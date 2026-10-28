import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { withOutline } from '../client/office/toon.js';

test('outline hulls stay closed over hard edges', () => {
  const { geometry } = withOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 8)));
  const { position, outlineNormal } = geometry.attributes, byPoint = new Map();
  for (let i = 0; i < position.count; i++) {
    const key = [position.getX(i), position.getY(i), position.getZ(i)].map(v => v.toFixed(4)).join();
    const n = new THREE.Vector3().fromBufferAttribute(outlineNormal, i);
    assert.ok(Math.abs(n.length() - 1) < 1e-5);
    if (byPoint.has(key)) assert.ok(byPoint.get(key).distanceTo(n) < 1e-5, `split hull at ${key}`);
    else byPoint.set(key, n);
  }
  // A rim point pushes out and up, between the side and the cap.
  const rim = [...byPoint].find(([key]) => key.startsWith('0.0000,0.1000,0.1000'))[1];
  assert.ok(rim.y > 0.5 && rim.z > 0.5);
});
