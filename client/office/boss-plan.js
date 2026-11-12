// The boss's office: the office floor's back-left corner, walled off in glass. The windows wall and the left wall are its own,
// glass on the other two sides, a glass door at the right end of the front glass. Its plan in world metres (the floor is
// x 0..width, z 0..depth; the windows wall's inner face is z = 0, the left wall's x = 0), kept apart from its build (boss.js)
// so tests and the seated game can use it without the room. The pods keep clear of it (layout.js).
import * as THREE from 'three';
import { WALL_H } from './furniture.js';
import { BOSS_FRONT } from './layout.js';
import { CELL } from './path.js';

// Inside; glass partitions this thick. As wide as the smallest room's windows wall allows beside the scoreboard (cutouts.js).
export const BOSS = { w: 4.0, d: BOSS_FRONT - 0.1, glass: 0.1, door: 0.9, post: 0.15, doorH: 2.2 };
export const DOOR_X = BOSS.w - BOSS.post - BOSS.door / 2; // the doorway's middle
// The boss sits with their back to the window, looking out over the floor, in the middle of the office: a metre or more all
// round the desk and its chair (walking takes that on the grid, path.js); the window's behind it (room.js).
export const DESK = { x: 2.0, z: 2.4, rotation: 0, width: 1.8, monitor: 1.25 };
export const CHAIR = { x: DESK.x, z: DESK.z - 0.87 }; // DESK.z + CHAIR_Z (room.js)
export const STAND = { x: DESK.x + 0.75, z: CHAIR.z, yaw: 0 }; // beside the chair (behind it is the wall): where you're walked to and stand up
// Where the Office theme puts you first: beside the desk, in line with the doorway and facing it, so straight ahead walks you out.
export const START = { x: DOOR_X, z: CHAIR.z, yaw: 0 };

export const bossInside = p => p.x >= 0 && p.x <= BOSS.w && p.z >= 0 && p.z <= BOSS.d;
// Inside or in the glass, the doorway too: where the snake and the goose don't go, nor the goose after anyone or anything.
export const behindGlass = p => p.x >= 0 && p.x <= BOSS.w + BOSS.glass && p.z >= 0 && p.z <= BOSS.d + BOSS.glass;
// A copy of a walk grid (path.js) with every cell behind the glass shut, for them to roam (office.js).
export function shutOffice(grid) {
  const open = grid.open.slice(), at = { x: 0, z: 0 };
  for (let k = 0; k < open.length; k++) {
    at.x = grid.left + (k % grid.cols + 0.5) * CELL; at.z = grid.back + (Math.floor(k / grid.cols) + 0.5) * CELL;
    if (behindGlass(at)) open[k] = 0;
  }
  return { ...grid, open, key: `${grid.key}|boss` };
}
// A friend at a meeting is sitting here when their seated game's spot is this one.
export const seatedAtBoss = at => Math.hypot(at.x - STAND.x, at.z - STAND.z) < 0.4;
// Who of the others at a meeting (friends.js's positions) is at the boss's computer: playing at its spot, the first by id
// if two are. Their id, or null.
export function seatedFriend(others) {
  let id = null;
  for (const p of others) if (p.pose === 'playing' && seatedAtBoss(p) && (id === null || p.id < id)) id = p.id;
  return id;
}

const box = (xa, ya, za, xb, yb, zb) => new THREE.Box3(new THREE.Vector3(xa, ya, za), new THREE.Vector3(xb, yb, zb));

// All of it, glass and all, floor to ceiling: what behindGlass is, as a box (paper planes' rings keep out of it, planes-course.js).
export const bossRoom = () => box(0, 0, 0, BOSS.w + BOSS.glass, WALL_H, BOSS.d + BOSS.glass);
// The side glass from the windows wall to the front; the front glass from the left wall to the doorway, then the post.
export function bossBoxes() {
  const { w, d, glass } = BOSS, hinge = w - BOSS.post, open = hinge - BOSS.door;
  return {
    walls: [box(w, 0, 0, w + glass, WALL_H, d + glass), box(0, 0, d, open, WALL_H, d + glass), box(hinge, 0, d, w + glass, WALL_H, d + glass)],
    lintel: box(open, BOSS.doorH, d, hinge, WALL_H, d + glass),
    door: box(open, 0, d, hinge, BOSS.doorH, d + glass),
  };
}
