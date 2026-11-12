import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BOSS, CHAIR, DESK, DOOR_X, STAND, bossBoxes, bossInside, seatedAtBoss, seatedFriend } from '../client/office/boss-plan.js';
import { AISLE, BOSS_FRONT, layoutOffice } from '../client/office/layout.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

test("the boss's office is the floor inside the glass, in the back-left corner", () => {
  assert.ok(bossInside({ x: 1.6, z: 1.5 })); assert.ok(bossInside(STAND)); assert.ok(bossInside(CHAIR));
  for (const p of [{ x: 1.6, z: BOSS.d + 0.5 }, { x: BOSS.w + 0.3, z: 1 }, { x: -0.1, z: 1 }, { x: 1.6, z: -0.1 }]) assert.ok(!bossInside(p), JSON.stringify(p));
  assert.equal(BOSS.d + BOSS.glass, BOSS_FRONT, 'its front glass is where layout.js starts the pods from');
});

test('the boss faces the floor, back to the windows, and stands up beside the chair (behind it is the wall)', () => {
  assert.equal(DESK.rotation, 0); assert.ok(CHAIR.z < DESK.z);
  assert.ok(Math.abs(STAND.z - CHAIR.z) < 0.01 && STAND.x > CHAIR.x + 0.6); assert.equal(STAND.yaw, 0);
});

test('seated at the boss desk: within 0.4 m of the stand spot', () => {
  assert.ok(seatedAtBoss({ x: STAND.x + 0.3, z: STAND.z })); assert.ok(!seatedAtBoss({ x: STAND.x, z: STAND.z + 0.5 }));
});

test('the glass leaves the doorway; the door and the lintel fill it', () => {
  const { walls, lintel, door } = bossBoxes(), z = BOSS.d + BOSS.glass / 2, way = V(DOOR_X, 1, z);
  assert.ok(!walls.some(b => b.containsPoint(way)) && door.containsPoint(way));
  assert.ok(lintel.containsPoint(V(DOOR_X, 2.5, z)));
  assert.ok(walls.some(b => b.containsPoint(V(1, 1, z))), 'the front glass'); assert.ok(walls.some(b => b.containsPoint(V(BOSS.w - 0.05, 1, z))), 'the post');
  assert.ok(walls.some(b => b.containsPoint(V(BOSS.w + BOSS.glass / 2, 1, 1.5))), 'the side glass');
});

const projects = count => Array.from({ length: count * 6 }, (_, i) => ({ id: `s${String(i).padStart(3, '0')}`, cwd: `/p${i % count}`, project: `p${String(i % count).padStart(2, '0')}`, status: 'working' }));
// The boss's office takes the first column's first cell; every row starts where it does in every column.
test("nobody sits in the boss's corner, and every row of pods lines up across the floor", () => {
  for (const count of [0, 1, 2, 3, 4, 5, 6, 9, 10, 13, 25]) for (const pod of layoutOffice(projects(count), null).pods) {
    const start = pod.z - pod.depth / 2, at = `${count} projects: ${pod.name} (${pod.col}, ${pod.row}) starts at ${start}`;
    assert.ok(pod.col > 0 || pod.row > 0, at);
    assert.ok(Math.abs(start - (AISLE + pod.row * (pod.depth + AISLE))) < 1e-9, at);
    if (pod.col === 0) assert.ok(start >= BOSS_FRONT + AISLE - 1e-9, `${at}: an aisle in front of the glass`);
  }
});
// As many rows as the projects would take without it: a column more when that's what it takes, and the left wall's shelf,
// whiteboard and kitchen doorway set how shallow a room can be.
test("the boss's corner makes the room a column wider when it has to, never a row deeper", () => {
  const rooms = { 0: [8.6, 11.3], 1: [15.3, 11.3], 2: [22, 11.3], 3: [15.3, 15.5], 4: [22, 15.5], 5: [22, 15.5], 6: [28.7, 15.5], 7: [22, 21], 9: [28.7, 21], 12: [35.4, 21], 13: [28.7, 26.5] };
  for (const [count, [w, d]] of Object.entries(rooms)) {
    const { width, depth } = layoutOffice(projects(+count), null).room;
    assert.ok(Math.abs(width - w) < 1e-9 && Math.abs(depth - d) < 1e-9, `${count} projects: ${width} x ${depth}, not ${w} x ${d}`);
  }
});
// Arriving one at a time: each takes the first free cell, row by row, and when there's none a column opens.
test('a project arriving when every cell is taken opens a column, and nobody moves', () => {
  const arrived = count => Array.from({ length: count * 6 }, (_, i) => ({ id: `p${Math.floor(i / 6)}s${i % 6}`, cwd: `/p${Math.floor(i / 6)}`, project: `p${String(Math.floor(i / 6)).padStart(2, '0')}`, status: 'working' }));
  let page = null;
  for (let count = 1; count <= 13; count++) {
    const before = page, cells = new Map(before?.pods.map(pod => [pod.key, [pod.col, pod.row]]));
    page = layoutOffice(arrived(count), before, count);
    for (const pod of page.pods) if (cells.has(pod.key)) assert.deepEqual([pod.col, pod.row], cells.get(pod.key), `${count} projects: ${pod.name} moved`);
    assert.ok(Math.max(...page.pods.map(pod => pod.row)) < Math.ceil(count / Math.ceil(Math.sqrt(count))), `${count} projects: a row too many`);
    const newcomer = page.pods.find(pod => !cells.has(pod.key));
    if ([2, 6, 12].includes(count)) assert.deepEqual([newcomer.col, newcomer.row, page.grid.cols], [before.grid.cols, 0, before.grid.cols + 1], `${count} projects`);
  }
});

test('seatedFriend: the first by id of those playing at the boss stand spot, else null', () => {
  const at = (id, pose, x = STAND.x, z = STAND.z) => ({ id, x, z, busy: pose === 'playing', pose });
  assert.equal(seatedFriend([]), null);
  assert.equal(seatedFriend([at('a', 'standing'), at('b', 'playing', 5, 5)]), null, 'standing there, or playing elsewhere');
  assert.equal(seatedFriend([at('c', 'playing'), at('b', 'playing', STAND.x + 0.2), at('a', 'playing', 5, 5)]), 'b');
});
