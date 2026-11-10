import test from 'node:test';
import assert from 'node:assert/strict';
import { walkGrid, index, CELL } from '../client/office/path.js';
import { reach, DIRS, CLEAR } from '../client/office/snake.js';
import { checkUp, COLOURS } from '../client/office/meeting.js';
import { gooseRole, routeAt, gapOf, eased, standSpots, nearestSpot, nextSpot, planDue, planOf, planKey } from '../client/office/goose-plan.js';

const P = (id, extra = {}) => ({ id, name: id, fruit: 'apple', colour: COLOURS[0], at: 'meeting', ...extra });
test('the role from the roster', () => {
  assert.deepEqual(gooseRole([], 'a'), { role: 'home', keeper: null });
  assert.deepEqual(gooseRole([P('a'), P('b')], 'a'), { role: 'home', keeper: null }); // an older hub marks no keeper
  assert.deepEqual(gooseRole([P('a', { goose: true }), P('b')], 'a'), { role: 'keeper', keeper: 'a' });
  assert.deepEqual(gooseRole([P('a'), P('b', { goose: true })], 'a'), { role: 'watcher', keeper: 'b' });
  assert.deepEqual(gooseRole([P('a', { at: 'home' }), P('b', { goose: true })], 'a'), { role: 'home', keeper: null });
  assert.deepEqual(gooseRole([P('a', { goose: true })], null), { role: 'home', keeper: null });
});
test('where a plan puts the goose after a while, standing at the end', () => {
  const route = [[1, 0], [1, 2]], near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  assert.ok(near(routeAt([0, 0], route, 1, 0.5).at, [0.5, 0]));
  const on = routeAt([0, 0], route, 1, 1.5); assert.ok(near(on.at, [1, 0.5])); assert.deepEqual(on.route, [[1, 2]]); assert.ok(on.moving); assert.ok(near(on.dir, [0, 1]));
  const end = routeAt([0, 0], route, 1, 5); assert.ok(near(end.at, [1, 2])); assert.deepEqual(end.route, []); assert.equal(end.moving, false); assert.equal(end.dir, null);
  assert.ok(near(routeAt([0, 0], route, 1, -3).at, [0, 0]));
  assert.ok(near(routeAt([0, 0], route, 0, 5).at, [0, 0])); assert.ok(near(routeAt([2, 2], [], 1, 5).at, [2, 2]));
});
test('catching up: a gap over 1 m jumps, a smaller one eases out', () => {
  assert.deepEqual(gapOf([0.6, 0.8], [0, 0]), [0.6, 0.8]); // exactly 1 m eases
  assert.deepEqual(gapOf([0.9, 0.9], [0, 0]), [0, 0]);
  const [x, z] = eased([1, 0], 0.25); assert.ok(Math.abs(x - Math.exp(-1)) < 1e-12); assert.equal(z, 0);
});
test("stand spots: 0.75–1.0 m from the food, off it and its neighbours, the food still reachable", () => {
  const grid = walkGrid([], { width: 10, depth: 10 }), food = [5.125, 5.125], head = [2.125, 2.125];
  const spots = standSpots(grid, food, head); assert.ok(spots.length > 0);
  for (const [x, z] of spots) {
    const d = Math.hypot(x - food[0], z - food[1]); assert.ok(d >= 0.75 - 1e-9 && d <= 1 + 1e-9);
    for (const [dx, dz] of [[0, 0], ...DIRS]) assert.ok(Math.hypot(x - (food[0] + dx * CELL), z - (food[1] + dz * CELL)) >= 0.2 + CLEAR);
    assert.ok(reach(grid, head, [{ x, z, r: 0.2 }])[index(grid, { x: food[0], z: food[1] })] >= 0);
  }
  // One cell wide, the food at the end: every spot would shut the way.
  const lane = { left: 0, back: 0, cols: 1, rows: 12, open: new Uint8Array(12).fill(1) };
  assert.deepEqual(standSpots(lane, [0.125, 2.875], [0.125, 0.125]), []);
});
test('the first spot is the nearest; the next is near the last and never the same', () => {
  const spots = [[0, 0], [1, 0], [3, 0]];
  assert.deepEqual(nearestSpot(spots, [2.9, 0]), [3, 0]); assert.equal(nearestSpot([], [0, 0]), null);
  assert.deepEqual(nextSpot(spots, [0, 0], () => 0.99), [1, 0]); assert.equal(nextSpot([[0, 0], [3, 0]], [0, 0]), null);
});
test('plans: on a change at most twice a second, and every 2 s', () => {
  assert.equal(planDue(10, 9.6, true), false); assert.equal(planDue(10, 9.5, true), true);
  assert.equal(planDue(10, 8.1, false), false); assert.equal(planDue(10, 8, false), true);
  assert.equal(planDue(0, -Infinity, false), true);
});
test('a plan is the message, rounded and capped; its key ignores progress along the route', () => {
  const path = Array.from({ length: 40 }, (_, i) => ({ x: 1 + i * 0.1, z: 2.34567 }));
  const m = planOf({ at: { x: 1.23456, z: 2 }, yaw: 0.123, mode: 'walk', idle: 'look', speed: 0.75, path, carry: null, target: null });
  assert.deepEqual(checkUp(m), m); assert.equal(m.route.length, 32); assert.deepEqual(m.at, [1.23, 2]); assert.equal(m.route[0][1], 2.35);
  const moved = planOf({ at: { x: 1.5, z: 2 }, yaw: 1, mode: 'walk', idle: 'look', speed: 0.75, path: path.slice(5, 32), carry: null, target: null });
  assert.equal(planKey(moved), planKey({ ...m, route: m.route.slice(5) }));
  for (const change of [{ mode: 'haul' }, { idle: 'peck' }, { carry: 'mug' }, { target: [1, 0, 1] }, { route: [[9, 9]] }]) assert.notEqual(planKey({ ...m, ...change }), planKey(m));
});
