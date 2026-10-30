import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { walkGrid, findPath, gridKey } from '../client/office/path.js';
import { free } from '../client/office/player.js';

const box = (x1, z1, x2, z2) => new THREE.Box3(new THREE.Vector3(x1, 0, z1), new THREE.Vector3(x2, 1, z2));
const room = { width: 10, depth: 10 }, V = (x, z) => new THREE.Vector3(x, 0, z);
// Every 5 cm along the way (but the ends, which may be in a chair) is somewhere a body can stand.
const walkable = (from, path, colliders, skipEnd = false, within = room) => {
  const points = [from, ...path];
  for (let i = 1; i < points.length; i++) for (let t = 0; t <= 1; t += 0.05 / points[i - 1].distanceTo(points[i])) {
    const at = new THREE.Vector3().lerpVectors(points[i - 1], points[i], t);
    if (skipEnd && i === points.length - 1 && at.distanceTo(points.at(-1)) < 0.9) continue;
    if (!free(at, colliders, within)) return false;
  }
  return true;
};

test('walks round a pod rather than through it, in a few straight lines', () => {
  const pod = [box(2, 4, 8, 6)], path = findPath(walkGrid(pod, room), V(5, 2), V(5, 8));
  assert.ok(path && walkable(V(5, 2), path, pod), 'never inside the pod');
  assert.deepEqual(path.at(-1).toArray(), [5, 0, 8], 'ends where it was going');
  assert.ok(path.length <= 5, `straightened (${path.length} points)`);
});

test('reaches a seat inside its chair through the nearest open spot', () => {
  const chair = [box(4.7, 4.7, 5.3, 5.3)], path = findPath(walkGrid(chair, room), V(1, 1), V(5, 5));
  assert.deepEqual(path.at(-1).toArray(), [5, 0, 5]);
  assert.ok(walkable(V(1, 1), path, chair, true), 'only the last step goes into the chair');
});

test('no way through: null', () => {
  const wall = [box(0, 4, 10, 6)];
  assert.equal(findPath(walkGrid(wall, room), V(5, 2), V(5, 8)), null);
});

test('the grid is kept until a box really changes, and is quick to build and search in a big office', () => {
  const a = [box(2, 4, 8, 6)], b = [box(2, 4, 8, 6)], big = { width: 30, depth: 30 };
  assert.equal(gridKey(a, room), gridKey(b, room), 'a new list of the same boxes');
  assert.notEqual(gridKey(a, room), gridKey([box(2, 4, 8, 6.5)], room));
  const desks = []; for (let x = 2; x < 28; x += 4) for (let z = 2; z < 28; z += 4) desks.push(box(x, z, x + 3, z + 1.8));
  let t = performance.now(); const grid = walkGrid(desks, big), built = performance.now() - t;
  t = performance.now(); const path = findPath(grid, V(1, 1), V(29, 29)), found = performance.now() - t;
  assert.ok(path && walkable(V(1, 1), path, desks, false, big), 'crosses the office between the desks');
  assert.ok(built < 100 && found < 30, `grid ${built.toFixed(1)} ms, path ${found.toFixed(1)} ms`);
});
