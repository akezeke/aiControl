import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { walkGrid, findPath, gridKey, nearestOpen, CELL } from '../client/office/path.js';
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
  // The best of a few, so a busy machine doesn't fail it; what's measured is the code.
  const timed = fn => { let best = Infinity, result; for (let i = 0; i < 5; i++) { const t = performance.now(); result = fn(); best = Math.min(best, performance.now() - t); } return [result, best]; };
  const [grid, built] = timed(() => walkGrid(desks, big)), [path, found] = timed(() => findPath(grid, V(1, 1), V(29, 29)));
  assert.ok(path && walkable(V(1, 1), path, desks, false, big), 'crosses the office between the desks');
  assert.ok(built < 100 && found < 30, `grid ${built.toFixed(1)} ms, path ${found.toFixed(1)} ms`);
});

const circle = { width: 16, depth: 16, inside: ({ x, z }) => Math.hypot(x - 8, z - 8) <= 6.6 };
test('paths stay inside a round room and around colliders', () => {
  const grid = walkGrid([box(7, 7, 9, 9)], circle);
  const path = findPath(grid, V(3, 8), V(13, 8));
  assert.ok(path?.length);
  for (const point of path) assert.ok(circle.inside(point));
});
test("a round room's corners are not walkable", () => {
  const grid = walkGrid([], circle), corner = findPath(grid, V(1, 1), V(8, 8));
  assert.ok(circle.inside(corner[0]));
  assert.ok(!grid.open[0]);
});

test('a route crosses into the kitchen only through the doorway', () => {
  const walls = [box(-0.2, 0, 0, 5.75), box(-0.2, 7.25, 0, 10)], wide = { left: -5, width: 5, depth: 10 }, from = V(1, 6.5), to = V(-3, 2);
  for (const [a, b] of [[from, to], [to, from]]) {
    const path = findPath(walkGrid(walls, wide), a, b), points = [a, ...path];
    assert.ok(path && walkable(a, path, walls, false, wide), 'never through the wall');
    assert.deepEqual(path.at(-1).toArray(), [b.x, 0, b.z]);
    let crossings = 0;
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1], q = points[i]; if ((p.x < -0.1) === (q.x < -0.1)) continue;
      crossings++; const z = p.z + (q.z - p.z) * (-0.1 - p.x) / (q.x - p.x);
      assert.ok(z > 5.75 && z < 7.25, `crossed the wall at z ${z}`);
    }
    assert.equal(crossings, 1);
  }
  assert.equal(findPath(walkGrid([box(-0.2, 0, 0, 10)], wide), from, to), null, 'no gap, no way');
});

test('a left edge: cells are found and centred in world x, on the same lattice as the office', () => {
  const grid = walkGrid([], { left: -5, width: 0, depth: 5 });
  assert.equal(grid.cols, 20);
  assert.deepEqual(nearestOpen(grid, V(-2.6, 1.1)).toArray(), [-2.625, 0, 1.125]);
  assert.deepEqual(nearestOpen(grid, V(2.6, 1.1)).toArray(), [-0.625, 0, 1.125], 'past the right edge: the nearest open cell');
  assert.deepEqual(nearestOpen(grid, V(-99, 1.1)).toArray(), [-4.375, 0, 1.125], 'past the left edge: the nearest open cell');
  const path = findPath(grid, V(-4, 1), V(-1, 4)); assert.ok(path && path.every(p => p.x <= -1 + 1e-9 && p.x >= -4 - 1e-9));
  // A left edge between cells: the office's cells stay where they were, so a route in the office doesn't change with what's beside it.
  const uneven = walkGrid([], { left: -10.2, width: 5, depth: 5 }), plain = walkGrid([], { width: 5, depth: 5 });
  assert.deepEqual(nearestOpen(uneven, V(2.1, 2.1)).toArray(), nearestOpen(plain, V(2.1, 2.1)).toArray());
  assert.equal(Math.abs(nearestOpen(uneven, V(-5.03, 2.1)).x + 5.125) < 1e-9, true);
  assert.ok(Math.abs(CELL - 0.25) < 1e-9);
  assert.equal(uneven.open[0], 0, 'the cell cut by the edge is closed');
});

test('the left edge is part of the grid key', () => {
  const walls = [box(2, 4, 8, 6)];
  assert.notEqual(gridKey(walls, { width: 10, depth: 10 }), gridKey(walls, { left: -10, width: 10, depth: 10 }));
  assert.equal(gridKey(walls, { width: 10, depth: 10 }), gridKey(walls, { left: 0, width: 10, depth: 10 }));
});

test('a room with a back edge: cells behind z = 0, on the same lattice', () => {
  const walls = [box(-0.2, -3, 0, 2)], far = { back: -3.1, width: 5, depth: 5 }, near = { width: 5, depth: 5 }, a = walkGrid(walls, far), b = walkGrid(walls, near), to = new THREE.Vector3(2, 0, -2.5);
  assert.equal(a.back, -3.25); assert.equal(a.rows, 33);
  assert.equal(nearestOpen(a, new THREE.Vector3(2, 0, 3)).z, nearestOpen(b, new THREE.Vector3(2, 0, 3)).z, 'what was there stays on its cells');
  assert.ok(gridKey(walls, far) !== gridKey(walls, near));
  assert.ok(nearestOpen(a, to).distanceTo(to) < 0.2);
  const path = findPath(a, new THREE.Vector3(2, 0, 4), to); assert.ok(path); assert.ok(path.at(-1).distanceTo(to) < 1e-9);
  assert.ok(nearestOpen(b, to).z > 0, 'without one, nothing is back there');
  assert.ok(nearestOpen(a, new THREE.Vector3(2, 0, -9)).z >= -3.1 + 0.3 - 0.13, 'nothing past the edge');
});
