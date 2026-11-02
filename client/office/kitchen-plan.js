import * as THREE from 'three';
import { TiltedBox } from './flight.js';
import { WALL_H, WALL_T } from './furniture.js';

// The kitchen and lunch room as data: no meshes, so Node can sweep it. Local metres: the origin is the door's centre on the east wall's
// kitchen face, x runs -10..0 (west to the door wall), z -8..1 (north to south). kitchen.js draws at these positions, shot.js scores by
// surfaceTier, levels.js picks starts and targets. No randomness: daily challenges must match between installs.
export const KITCHEN = { width: 10, back: -8, front: 1 };
export const TIERS = { large: { points: 50, multiplier: 0 }, normal: { points: 100, multiplier: 1 }, hard: { points: 200, multiplier: 1 }, floor: { points: 0, multiplier: 0 } };
export const DOOR_W = 1.5, DOOR_H = 2.2; // the doorway in the east wall, z -0.75..0.75

// Container surfaces are 'floor': being in the target is not a trick. 'floor' and 'ceiling' are flight.js's own names for them.
const BY_NAME = { wall: 'large', ceiling: 'large', fridge: 'normal', counter: 'normal', island: 'normal', shelf: 'normal', table: 'normal', chair: 'normal', vending: 'normal', banner: 'normal', sign: 'normal',
  cupboard: 'hard', pan: 'hard', tray: 'hard', cutout: 'hard', floor: 'floor', bin: 'floor', bucket: 'floor', basket: 'floor', sink: 'floor', tableMug: 'floor' };
export function surfaceTier(surface) {
  const tier = BY_NAME[String(surface).replace(/-.*$/, '')];
  if (!tier) throw new Error(`no tier for surface ${surface}`);
  return tier;
}

const rad = d => d * Math.PI / 180;
const box = (surface, x0, y0, z0, x1, y1, z1) => ({ surface, min: [x0, y0, z0], max: [x1, y1, z1] });
const tilt = (surface, centre, half, rotation) => ({ surface, centre, half, rotation });
// A door hinged on its back face's edge at (hx, hz), swung `deg` out towards +z: the hinge stays put, the far edge sweeps round.
const hinged = (surface, hx, y0, hz, w, h, t, deg) => {
  const a = rad(deg), c = Math.cos(a), s = Math.sin(a);
  return tilt(surface, [hx + w / 2 * c - t / 2 * s, y0 + h / 2, hz + w / 2 * s + t / 2 * c], [w / 2, h / 2, t / 2], [0, -a, 0]);
};
// An open box: four walls down to what it stands on, `r` out from the centre and `t` thick, and between them a bottom `d` deep, so what falls in lands on it.
const vessel = (surface, cx, y0, cz, r, h, t, d = t) => [
  box(surface, cx - r + t, y0, cz - r + t, cx + r - t, y0 + d, cz + r - t),
  box(surface, cx - r, y0, cz - r, cx + r, y0 + h, cz - r + t), box(surface, cx - r, y0, cz + r - t, cx + r, y0 + h, cz + r),
  box(surface, cx - r, y0, cz - r, cx - r + t, y0 + h, cz + r), box(surface, cx + r - t, y0, cz - r, cx + r, y0 + h, cz + r),
];
// A chair: seat and back (one name), turned `yaw` degrees (0 faces +z); `tip` lays it on its side. Both boxes turn with the chair, so
// the pair is rotated together and handed to TiltedBox as Euler angles. A tipped chair is centred on (x, z) as a whole and rests on the floor.
const chair = (n, x, z, yaw, tip = 0) => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rad(yaw), 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rad(tip))));
  const euler = new THREE.Euler().setFromQuaternion(q).toArray().slice(0, 3);
  const parts = [[[0, 0.45, 0], [0.22, 0.02, 0.22]], [[0, 0.75, -0.2], [0.22, 0.22, 0.02]]].map(([at, half]) => ({ c: new THREE.Vector3(...at).applyQuaternion(q), half }));
  const mid = parts.reduce((m, p) => m.add(p.c), new THREE.Vector3()).multiplyScalar(1 / parts.length), low = Math.min(...parts.map(({ c, half }) => new TiltedBox({ centre: c.toArray(), half, rotation: euler }).min.y));
  const at = tip ? new THREE.Vector3(x - mid.x, -low, z - mid.z) : new THREE.Vector3(x, 0, z);
  return parts.map(({ c, half }) => tilt(`chair-${n}`, c.clone().add(at).toArray(), half, euler));
};

// The company's promo material: boards at real angles. Turned `yaw` degrees (0 faces +z), then leaning `lean` degrees back (negative: forward).
const turned = (yaw, lean) => new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rad(yaw), 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(-lean), 0, 0)));
const angles = q => new THREE.Euler().setFromQuaternion(q).toArray().slice(0, 3);
// A board standing on its bottom edge, `out` in front of (x, z), its lowest corner on the floor.
const leaning = (surface, x, z, yaw, lean, half, out = 0) => {
  const q = turned(yaw, lean), c = new THREE.Vector3(0, half[1], 0).applyQuaternion(q);
  return tilt(surface, [x + Math.sin(rad(yaw)) * out + c.x, c.y + half[2] * Math.abs(Math.sin(rad(lean))), z + Math.cos(rad(yaw)) * out + c.z], half, angles(q));
};
// A cardboard cutout: the card, and behind it a strut from a foot on the floor to two thirds of the way up the card's back.
export const CARD = [0.42, 0.72, 0.006];
export const cutout = (surface, x, z, yaw, lean) => {
  const up = CARD[1] * 4 / 3, across = up * Math.sin(rad(lean)), height = up * Math.cos(rad(lean)), reach = 0.3;
  return [leaning(surface, x, z, yaw, lean, CARD), leaning(surface, x, z, yaw + 180, Math.atan2(reach, height) * 180 / Math.PI, [0.035, Math.hypot(reach, height) / 2, 0.006], across + reach + 0.012)];
};
// An A-frame sign: two faces leaning on each other, meeting at the top.
const aFrame = (surface, x, z, yaw, half, lean) => [0, 180].map(side => leaning(surface, x, z, yaw + side, lean, half, 2 * half[1] * Math.sin(rad(lean))));
// Where each cutout stands and how: x, z, yaw, lean. No two alike. kitchen.js says which fruit is which.
const CUTOUTS = [[-8.6, -4.6, 50, 12], [-1.25, -3.3, 40, 10], [-8.9, -2.2, 60, 7], [-4.4, -5.5, -25, 14]];

// A pan hung by the end of its handle from a hook on the rail, the handle rising to it `deg` from level, swung `yaw` degrees out of the rail's line.
// The box's +x is along the handle; its top is the pan's inside.
export const PAN = { r: 0.15, reach: 0.44, drop: 0.07 }; // from the pan's middle to the handle's end; the hook's length under the rail
const pan = (n, hook, deg, yaw) => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rad(180 + yaw), 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rad(deg)))), end = new THREE.Vector3(PAN.reach, 0, 0).applyQuaternion(q);
  return tilt(`pan-${n}`, [hook - end.x, SPOTS.panRack.y - PAN.drop - end.y, SPOTS.panRack.z - end.z], [PAN.r, 0.012, PAN.r], angles(q));
};
const PANS = [[-6.38, 30, 30], [-5.74, 24, -35], [-5.18, 38, 25]]; // hook x, tilt, swing: no two alike

// Each container's cx, floor y, cz, half width, height, wall, bottom: drawn by vessel() and the "in" zone is its whole inside.
// ponytail: 12 cm bottoms, from when a step could land past a thin one; flight.js doesn't let it now, and they're what a throw rests on.
export const VESSELS = { bin: [-0.5, 0, -2.5, 0.25, 0.6, 0.03, 0.12], bucket: [-1, 0, -5.25, 0.22, 0.42, 0.03, 0.12], basket: [-5.5, 0.92, -3.55, 0.2, 0.3, 0.03, 0.12], tableMug: [-4.63, 0.74, 0.6, 0.125, 0.12, 0.02] };
const SHELF = { z0: -6.6, z1: -5.2 }; // on the west wall, past the fridge door's swing: a throw off the door can reach it
const T = WALL_T, TABLES = [[-7.2, -1.4], [-5.2, -1.4], [-7.6, 0.5], [-5.2, 0.5]], COUPLE = 1.18, COUNTER_X = -8.6;
// Door-wall pieces beside the doorway. Shut, the doorway is filled with more of the same wall.
const edges = shut => [
  box('wall-n', -10 - T, 0, -8 - T, T, WALL_H, -8), box('wall-s', -10 - T, 0, 1, T, WALL_H, 1 + T), box('wall-w', -10 - T, 0, -8, -10, WALL_H, 1),
  box('wall-e', 0, 0, -8 - T, T, WALL_H, -DOOR_W / 2), box('wall-e', 0, 0, DOOR_W / 2, T, WALL_H, 1 + T), box('wall-e', 0, DOOR_H, -DOOR_W / 2, T, WALL_H, DOOR_W / 2),
  ...(shut ? [box('wall-e', 0, 0, -DOOR_W / 2, T, DOOR_H, DOOR_W / 2)] : []),
];

// ponytail: table legs and the cupboards' insides have no colliders (a table is just its top, a cupboard its door and a solid body behind
// it from the wall to the shut door), and the sink hole lies behind the door line, under the bodies: a throw reaches it under the
// doors' bottom edge (y 1.5), over the counter's front.
const PARTS = shut => [
  ...edges(shut),
  box('fridge', -9.8, 0, -7.95, -9, 1.9, -7.25), hinged('fridge', -9.8, 0, -7.25, 0.8, 1.9, 0.05, 25),
  box('counter', COUNTER_X, 0, -8, -7.1, 0.91, -7.4), box('counter', -6.5, 0, -8, -1.5, 0.91, -7.4),
  box('sink', -7.1, 0, -8, -6.5, 0.91, -7.92), box('sink', -7.1, 0, -7.62, -6.5, 0.91, -7.4), box('sink', -7.1, 0, -7.92, -6.5, 0.6, -7.62),
  ...[0, 0, 35, 70, 110, 20].flatMap((deg, i) => [box(`cupboard-${i + 1}`, COUNTER_X + i * COUPLE, 1.5, -8, COUNTER_X + (i + 1) * COUPLE, 2.2, -7.57), hinged(`cupboard-${i + 1}`, COUNTER_X + i * COUPLE, 1.5, -7.55, COUPLE, 0.7, 0.03, deg)]),
  box('island', -6.5, 0, -4.15, -3.5, 0.92, -3.05),
  ...PANS.map(([hook, deg, yaw], i) => pan(i + 1, hook, deg, yaw)),
  ...vessel('basket', ...VESSELS.basket),
  box('shelf', -10, 1.46, SHELF.z0, -9.7, 1.5, SHELF.z1), box('shelf', -9.73, 1.5, SHELF.z0, -9.7, 1.6, SHELF.z1), box('shelf', -10, 1.5, SHELF.z0, -9.7, 1.6, SHELF.z0 + 0.03), box('shelf', -10, 1.5, SHELF.z1 - 0.03, -9.7, 1.6, SHELF.z1),
  tilt('tray', [-9.642, 0.2376, -0.5], [0.4, 0.01, 0.25], [0, 0, rad(-35)]),
  ...TABLES.map(([x, z], i) => box(`table-${i + 1}`, x - 0.7, 0.7, z - 0.4, x + 0.7, 0.74, z + 0.4)),
  ...vessel('tableMug', ...VESSELS.tableMug),
  ...[[-7.6, -1.95, 15], [-6.9, -1.95, -30], [-5.8, -1.95, 40], [-4.9, -1.95, -20], [-8.3, -1.4, 140], [-3.05, -1.4, 255], [-4.24, 0.6, 100], [-8.8, 0.5, 200]].flatMap(([x, z, yaw], i) => chair(i + 1, x, z, yaw)),
  ...chair(9, -2.9, -0.2, 50, 90),
  box('vending', -10, 0, 0, -9.2, 1.9, 0.8),
  ...CUTOUTS.flatMap(([x, z, yaw, lean], i) => cutout(`cutout-${i + 1}`, x, z, yaw, lean)),
  // ponytail: hung by its top edge on two cords, it tips forward all the same.
  tilt('banner', [-2, 2.45, -6.6], [1.3, 0.3, 0.012], angles(turned(8, -24))),
  ...aFrame('sign-1', -1.9, -5.9, 20, [0.19, 0.32, 0.008], 12), ...aFrame('sign-2', -3.4, 0.45, 60, [0.3, 0.45, 0.012], 11),
  // ponytail: the bucket's bottom is its mop water, which keeps what lands in it: a rubber ball would bounce out of any bucket this size.
  ...vessel('bin', ...VESSELS.bin), ...vessel('bucket', ...VESSELS.bucket).map((b, i) => i ? b : { ...b, bounce: 0 }),
];

// Where a drop is meant to end: "came to rest inside" means anywhere in the container's whole inside, its floor to its rim, give or take
// a centimetre so a rest touching the rim counts. Derived from the containers, so the two cannot drift apart.
const EPS = 0.01;
const inside = (x0, y0, z0, x1, y1, z1) => ({ centre: new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), half: new THREE.Vector3((x1 - x0) / 2 + EPS, (y1 - y0) / 2 + EPS, (z1 - z0) / 2 + EPS) });
const within = ([cx, y0, cz, r, h, t, d = t]) => inside(cx - r + t, y0 + d, cz - r + t, cx + r - t, y0 + h, cz + r - t);
export const ZONES = {
  ...Object.fromEntries(Object.entries(VESSELS).map(([name, v]) => [name, within(v)])),
  shelf: inside(-10, 1.5, SHELF.z0 + 0.03, -9.73, 1.6, SHELF.z1 - 0.03),
  sink: inside(-7.1, 0.6, -7.92, -6.5, 0.91, -7.62),
};

// Things drawn without a collider, or needing more than a box. Sizes are w (along the wall) by h.
export const SPOTS = {
  clipboard: { x: -0.02, y: 1.35, z: -1.6, facing: 'west', w: 0.3, h: 0.4 },
  scores: { x: -1.6, y: 1.9, z: 0.98, facing: 'north', w: 1.4, h: 0.8 }, // south wall, by the doors
  lunchTables: TABLES.map(([x, z]) => ({ x, z, w: 1.4, d: 0.8, h: 0.74 })),
  panRack: { x: -5.4, y: 2, z: -3.6, w: 2.2 },
  motto: { y: 2.45, z: -2.9, w: 4.6, h: 0.54 }, // on the west wall, past the shelf
  shelf: SHELF,
  tap: { x: -6.8, y: 0.91, z: -7.9 },
};

const shifted = (o, p) => Object.assign(new THREE.Box3(new THREE.Vector3(p.min[0] + o.x, p.min[1], p.min[2] + o.z), new THREE.Vector3(p.max[0] + o.x, p.max[1], p.max[2] + o.z)), p.bounce === undefined ? { surface: p.surface } : { surface: p.surface, bounce: p.bounce }); // only a box with its own bounce has the field
export function flightBoxes(origin = { x: 0, z: 0 }, { doorShut = true } = {}) {
  return PARTS(doorShut).map(p => p.centre ? new TiltedBox({ centre: [p.centre[0] + origin.x, p.centre[1], p.centre[2] + origin.z], half: p.half, rotation: p.rotation, surface: p.surface }) : shifted(origin, p));
}

// Things to hit rather than get in: touching one is the shot (shot.js). Its box, the card without its strut, is what the arrow stands over.
const struck = surface => {
  const whole = new THREE.Box3(); for (const b of flightBoxes()) if (b.surface === surface && b.half?.x > 0.1) whole.expandByPoint(b.min).expandByPoint(b.max);
  return { surface, centre: whole.getCenter(new THREE.Vector3()), half: whole.getSize(new THREE.Vector3()).multiplyScalar(0.5) };
};
Object.assign(ZONES, { pear: struck('cutout-1'), orange: struck('cutout-2'), banana: struck('cutout-3'), lemon: struck('cutout-4'), banner: struck('banner'), moist: struck('sign-1'), special: struck('sign-2') });

// Floor-standing things the player walks round, each name as one axis-aligned box (a turned chair, the fridge with its door, a leaning tray).
// ponytail: walls, anything above head height, and what stands on a table or the island are left out; they can overlap, the doorway stays clear.
const NOT_WALKED = /^(wall|cupboard|pan|shelf|basket|tableMug|banner)/;
export function walkBoxes(origin = { x: 0, z: 0 }) {
  const groups = new Map();
  for (const b of flightBoxes(origin, { doorShut: false })) {
    if (NOT_WALKED.test(b.surface) || b.min.y > 1.2) continue;
    const key = b.surface === 'sink' ? 'counter' : b.surface, g = groups.get(key) ?? new THREE.Box3().makeEmpty(); groups.set(key, g.union(b)); // the sink is part of the counter to a walker
  }
  return [...groups].map(([surface, b]) => Object.assign(b, { surface, walkOnly: true }));
}

// The floor between the kitchen's north wall and the building's edge: nobody gets there, so no route may end there.
export const behind = origin => { const edge = origin.z + KITCHEN.back - WALL_T; return Object.assign(new THREE.Box3(new THREE.Vector3(origin.x - KITCHEN.width - WALL_T, 0, Math.min(edge, 0)), new THREE.Vector3(origin.x, WALL_H, edge)), { surface: 'behind', walkOnly: true }); }; // none in a small room: the north wall is the building's edge

export const levelWorld = onContact => ({ colliders: flightBoxes(), columns: [], ceiling: WALL_H, onContact });
