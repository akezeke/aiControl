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
// Only the boss's column is pushed forward; the rest start an aisle from the windows, beside the glass.
test("the boss's column of pods starts an aisle in front of its glass, the others an aisle from the windows", () => {
  for (const count of [1, 2, 3, 4, 5, 9, 10]) for (const pod of layoutOffice(projects(count), null).pods) {
    const start = pod.z - pod.depth / 2, at = `${count} projects: ${pod.name} (${pod.col}, ${pod.row}) starts at ${start}`;
    if (pod.col === 0) assert.ok(start >= BOSS_FRONT + AISLE - 1e-9, at);
    else if (pod.row === 0) assert.ok(Math.abs(start - AISLE) < 1e-9, at);
  }
});
// It holds a pod fewer than the others until every column's full: only then is the room deeper for the boss, and by less than a row.
test("the room's only deeper for the boss's office when every column's full", () => {
  const deep = { 0: 14, 1: 14, 2: 14, 3: 15.5, 4: 19.5, 5: 15.5, 6: 19.5, 7: 21, 8: 21, 9: 25, 10: 21, 11: 21, 12: 25, 24: 32, 25: 36 };
  for (const [count, want] of Object.entries(deep)) { const { depth } = layoutOffice(projects(+count), null).room; assert.ok(Math.abs(depth - want) < 1e-9, `${count} projects: ${depth} deep, not ${want}`); }
});

test('seatedFriend: the first by id of those playing at the boss stand spot, else null', () => {
  const at = (id, pose, x = STAND.x, z = STAND.z) => ({ id, x, z, busy: pose === 'playing', pose });
  assert.equal(seatedFriend([]), null);
  assert.equal(seatedFriend([at('a', 'standing'), at('b', 'playing', 5, 5)]), null, 'standing there, or playing elsewhere');
  assert.equal(seatedFriend([at('c', 'playing'), at('b', 'playing', STAND.x + 0.2), at('a', 'playing', 5, 5)]), 'b');
});
