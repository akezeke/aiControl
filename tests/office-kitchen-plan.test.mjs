import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeBody, simulate, TiltedBox } from '../client/office/flight.js';
import { walkGrid, findPath, nearestOpen } from '../client/office/path.js';
import { KITCHEN, PAN, TIERS, ZONES, SPOTS, flightBoxes, walkBoxes, behind, surfaceTier, levelWorld } from '../client/office/kitchen-plan.js';
import { kitchenDoor, kitchenShift } from '../client/office/layout.js';
import { WALL_T } from '../client/office/furniture.js';
import { STARTS } from '../client/office/levels.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ball = { radius: 0.05, low: 0.05, bounce: 0.5, roll: 1, drag: 0.1, upright: false };
const plate = { radius: 0.06, low: 0.012, bounce: 0.3, roll: 1, drag: 0.1, upright: false };
const teabag = { radius: 0.03, low: 0.015, bounce: 0.1, roll: 2, drag: 0.3, upright: false };
const tilted = b => b instanceof TiltedBox && Math.abs(b.quaternion.w) < 0.9999;
const named = (boxes, re) => boxes.filter(b => re.test(b.surface));
const overlap = (a, b, e = 0.02) => a.min.x < b.max.x - e && a.max.x > b.min.x + e && a.min.y < b.max.y - e && a.max.y > b.min.y + e && a.min.z < b.max.z - e && a.max.z > b.min.z + e;
const hingeOf = d => V(-d.half.x, 0, -d.half.z).applyQuaternion(d.quaternion).add(d.centre);
const inZone = (pos, zone) => { const d = V(...pos).sub(zone.centre); return Math.abs(d.x) <= zone.half.x && Math.abs(d.y) <= zone.half.y && Math.abs(d.z) <= zone.half.z; };
const SPEC = { fridge: 'normal', counter: 'normal', island: 'normal', shelf: 'normal', table: 'normal', chair: 'normal', vending: 'normal', banner: 'normal', sign: 'normal', cupboard: 'hard', pan: 'hard', tray: 'hard', cutout: 'hard', wall: 'large', bin: 'floor', bucket: 'floor', basket: 'floor', sink: 'floor', tableMug: 'floor' };

test('every surface has a tier, as the spec says', () => {
  for (const b of flightBoxes()) { assert.ok(TIERS[surfaceTier(b.surface)], b.surface); assert.equal(surfaceTier(b.surface), SPEC[b.surface.replace(/-.*$/, '')], b.surface); }
  assert.equal(surfaceTier('floor'), 'floor'); assert.equal(surfaceTier('ceiling'), 'large');
  assert.throws(() => surfaceTier('nonsense'));
  for (const name of Object.keys(SPEC)) assert.ok(flightBoxes().some(b => b.surface.startsWith(name)), `${name} is in the plan`);
});

test('walls and ceiling are the only large surfaces, and cupboard doors, pans and the tray are hard', () => {
  const boxes = flightBoxes();
  for (const b of boxes) assert.equal(surfaceTier(b.surface) === 'large', b.surface.startsWith('wall-'), b.surface);
  for (const w of ['wall-n', 'wall-s', 'wall-w', 'wall-e']) assert.ok(boxes.some(b => b.surface === w), w);
  for (const re of [/^cupboard-/, /^pan-/, /^tray$/]) for (const b of named(boxes, re)) assert.equal(surfaceTier(b.surface), 'hard');
  assert.equal(new Set(named(boxes, /^cupboard-/).map(b => b.surface)).size, 6); assert.equal(named(boxes, /^pan-/).length, 3);
});

test('the angled things really are angled', () => {
  const boxes = flightBoxes();
  assert.ok(new Set(named(boxes, /^cupboard-/).filter(tilted).map(b => b.surface)).size >= 3);
  for (const re of [/^chair-/, /^tray$/, /^pan-/, /^fridge$/]) assert.ok(named(boxes, re).some(tilted), String(re));
});

test('a hinged door swings out into the room from its hinge edge, which stays put', () => {
  const boxes = flightBoxes(), doors = boxes.filter(b => /^cupboard-/.test(b.surface) && b instanceof TiltedBox);
  assert.equal(doors.length, 6);
  doors.forEach((d, i) => {
    const hinge = hingeOf(d), tip = V(d.half.x, 0, -d.half.z).applyQuaternion(d.quaternion).add(d.centre);
    assert.ok(Math.abs(hinge.x - (-8.6 + i * 1.18)) < 1e-9 && Math.abs(hinge.z + 7.55) < 1e-9, d.surface);
    assert.ok(d.min.z >= -7.57, `${d.surface} stays out of the wall`);
    assert.ok(tip.z >= hinge.z - 1e-9, `${d.surface} swings into the room`);
  });
  const door = boxes.find(b => b instanceof TiltedBox && b.surface === 'fridge'), body = boxes.find(b => !(b instanceof TiltedBox) && b.surface === 'fridge'), h = hingeOf(door);
  assert.ok(Math.abs(h.x + 9.8) < 1e-9 && Math.abs(h.z + 7.25) < 1e-9);
  assert.ok(door.min.z >= body.max.z - 1e-9 && !overlap(door, body), 'the fridge door opens away from the fridge');
});

test('each cupboard door has a solid body behind it, at height', () => {
  const boxes = flightBoxes();
  for (let n = 1; n <= 6; n++) {
    const body = boxes.find(b => b.surface === `cupboard-${n}` && !(b instanceof TiltedBox));
    assert.ok(body && body.min.y === 1.5 && body.max.y === 2.2 && body.min.z === -8 && body.max.z === -7.57, `cupboard-${n}`);
  }
  const shot = makeBody(ball, V(-4, 2.1, -5), V(0, 0, -12)), out = simulate(shot, levelWorld(), { maxTime: 2 });
  assert.match(out.contacts[0].surface, /^cupboard-/, 'a ball at a cupboard meets the cupboard');
});

// Drops over a grid inside each container, with items of different `low`: all stay and end in the zone. From under what hangs over the sink (cupboards) and basket (pans).
test('an item dropped anywhere into a container stays in it, in the zone', () => {
  for (const [name, zone] of Object.entries(ZONES)) {
    if (zone.surface) continue; // only to hit: nothing's meant to stay
    for (const item of [ball, plate, teabag]) for (const fx of [-0.8, 0, 0.8]) for (const fz of [-0.8, 0, 0.8]) {
      const room = V(zone.half.x - 0.01 - item.radius, 0, zone.half.z - 0.01 - item.radius); // the centre may be this far out and still clear the rim
      const top = { sink: 1.4, basket: 1.5 }[name] ?? zone.centre.y + zone.half.y + 0.8, b = makeBody(item, V(zone.centre.x + fx * room.x, top, zone.centre.z + fz * room.z), V(0, 0, 0));
      const out = simulate(b, levelWorld(), { maxTime: 10 });
      assert.ok(out.rest && inZone(out.pos, zone), `${name} (${item.low}) from ${fx},${fz} ended at ${out.pos}`);
      assert.ok(out.contacts.some(c => c.box?.surface === name), `${name} was landed on`);
    }
  }
});

test('a throw over the counter lands in the sink, under the cupboards', () => {
  let landed = 0;
  for (const vz of [-1.5, -2, -2.5, -3, -3.5]) for (const vy of [0, 0.5, 1, 1.5, 2]) for (const dx of [-0.1, 0, 0.1]) {
    const b = makeBody(ball, V(-6.8 + dx, 1.25, -6.2), V(0, vy, vz)), out = simulate(b, levelWorld(), { maxTime: 6 });
    if (out.rest && inZone(out.pos, ZONES.sink)) { landed++; }
  }
  assert.ok(landed >= 3, `${landed} throws landed`);
});

test('the doorway is open or shut by option', () => {
  const gap = list => list.filter(b => b.surface === 'wall-e' && b.min.z < 0.75 && b.max.z > -0.75 && b.min.y < 1);
  assert.equal(gap(flightBoxes(undefined, { doorShut: false })).length, 0);
  assert.equal(gap(flightBoxes()).length, 1);
  for (const b of flightBoxes().filter(b => b.surface.startsWith('wall-'))) assert.ok(Math.min(b.max.x - b.min.x, b.max.z - b.min.z) >= 0.2 - 1e-9);
});

// Fast throws from a few spots over a lattice of directions: nothing ends outside the room or inside a box.
test('nothing thrown ends outside the room or inside something', () => {
  const world = levelWorld(), boxes = world.colliders;
  let n = 0;
  for (const [sx, sz] of [[-1.2, 0], [-9, -6.7], [-6, -0.45], [-2.5, -3.5], [-3, -6.5]]) for (let a = 0; a < 24; a++) for (const speed of [4, 8, 14]) for (const pitch of [-0.2, 0.2, 0.6]) {
    const yaw = a * Math.PI / 12, b = makeBody(ball, V(sx, 1.3, sz), V(Math.cos(yaw) * speed * Math.cos(pitch), Math.sin(pitch) * speed, Math.sin(yaw) * speed * Math.cos(pitch)));
    const out = simulate(b, world, { maxTime: 8 }), at = V(...out.pos);
    assert.ok(at.x > -10 && at.x < 0 && at.z > -8 && at.z < 1 && at.y >= 0 && at.y <= 3, `start ${sx},${sz} yaw ${a} speed ${speed} pitch ${pitch} ended at ${out.pos}`);
    assert.ok(!boxes.some(box => box.containsPoint(at)), `ended inside something at ${out.pos}`); n++;
  }
  assert.ok(n >= 800);
});

test('a leaning tray is a ramp: a ball rolled at it from the room climbs it', () => {
  const b = makeBody(ball, V(-8.5, 0.05, -0.5), V(-5, 0, 0)), out = simulate(b, levelWorld(), { maxTime: 2 });
  assert.ok(out.contacts.some(c => c.box?.surface === 'tray'));
  assert.ok(Math.max(...out.path.filter((_, i) => i % 3 === 1)) > 0.3);
});

test('every part is inside the room, and no two things share space', () => {
  const boxes = flightBoxes(), solid = boxes.filter(b => !b.surface.startsWith('wall-'));
  for (const b of solid) assert.ok(b.min.x >= -10 - 1e-9 && b.max.x <= 1e-9 && b.min.z >= -8 - 1e-9 && b.max.z <= 1 + 1e-9 && b.min.y >= -1e-3 && b.max.y <= 3 + 1e-9, `${b.surface} ${b.min.toArray()} ${b.max.toArray()}`);
  const related = (a, b) => { const k = s => s.replace(/-.*$/, ''); return a.surface === b.surface || [['sink', 'counter'], ['tableMug', 'table'], ['basket', 'island']].some(([x, y]) => (k(a.surface) === x && k(b.surface) === y) || (k(a.surface) === y && k(b.surface) === x)); };
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) if (!related(solid[i], solid[j])) assert.ok(!overlap(solid[i], solid[j]), `${solid[i].surface} overlaps ${solid[j].surface}`);
  const chairs = solid.filter(b => b.surface.startsWith('chair-')), tables = solid.filter(b => b.surface.startsWith('table-'));
  for (const c of chairs) for (const t of tables) assert.ok(!overlap(c, t), `${c.surface} in ${t.surface}`);
  assert.ok(new Set(chairs.map(c => c.surface)).size >= 8);
  const gap = (a, b) => Math.hypot(Math.max(a.min.x - b.max.x, b.min.x - a.max.x, 0), Math.max(a.min.z - b.max.z, b.min.z - a.max.z, 0));
  for (const t of tables) assert.ok(chairs.some(c => gap(c, t) < 0.35), `a chair stands by ${t.surface}`);
});

test('the tipped chair lies on the floor where it was put', () => {
  const parts = flightBoxes().filter(b => b.surface === 'chair-9'), mid = parts.reduce((m, b) => m.add(b.centre), V(0, 0, 0)).multiplyScalar(0.5);
  assert.ok(Math.abs(mid.x + 2.9) < 1e-9 && Math.abs(mid.z + 0.2) < 1e-9);
  assert.ok(Math.abs(Math.min(...parts.map(b => b.min.y))) < 1e-9);
});

const facing = b => V(0, 0, 1).applyQuaternion(b.quaternion), upOf = b => V(0, 1, 0).applyQuaternion(b.quaternion), deg = r => r * 180 / Math.PI;

test('four cutouts on struts, leaning back 5-15 degrees and turned 20-60, no two alike', () => {
  const seen = [];
  for (let n = 1; n <= 4; n++) {
    const [card, strut, ...rest] = named(flightBoxes(), new RegExp(`^cutout-${n}$`));
    assert.ok(card && strut && !rest.length && tilted(card) && tilted(strut), `cutout-${n}`);
    const lean = deg(Math.acos(upOf(card).y)), yaw = deg(Math.atan2(upOf(card).x === 0 ? 0 : facing(card).x, facing(card).z));
    assert.ok(lean >= 5 && lean <= 15, `cutout-${n} leans ${lean}`); assert.ok(Math.abs(yaw) >= 20 && Math.abs(yaw) <= 60, `cutout-${n} is turned ${yaw}`);
    assert.ok(facing(card).y > 0, `cutout-${n} leans back`);
    assert.ok(Math.abs(card.min.y) < 1e-3 && Math.abs(strut.min.y) < 1e-3, `cutout-${n} stands on the floor`);
    const top = V(0, card.half.y * 4 / 3 - card.half.y, -card.half.z).applyQuaternion(card.quaternion).add(card.centre), tip = V(0, strut.half.y, 0).applyQuaternion(strut.quaternion).add(strut.centre);
    assert.ok(top.distanceTo(tip) < 0.05, `cutout-${n}'s strut reaches its card: ${top.distanceTo(tip)}`);
    seen.push(`${Math.round(lean)},${Math.round(yaw)}`);
  }
  assert.equal(new Set(seen).size, 4);
});

test('the banner hangs tilted 15-30 degrees, its face turned down; the signs are A-frames on the floor', () => {
  const [banner, ...more] = named(flightBoxes(), /^banner$/), tip = deg(Math.acos(upOf(banner).y));
  assert.ok(!more.length && tip >= 15 && tip <= 30, `${tip}`); assert.ok(facing(banner).y < 0, 'a throw comes down off it');
  assert.ok(banner.min.y > 1.9 && banner.max.y < 3, 'overhead, under the ceiling');
  for (const name of ['sign-1', 'sign-2']) {
    const [a, b, ...rest] = named(flightBoxes(), new RegExp(`^${name}$`)), top = f => V(0, f.half.y, 0).applyQuaternion(f.quaternion).add(f.centre);
    assert.ok(a && b && !rest.length && tilted(a) && tilted(b), name);
    assert.ok(top(a).distanceTo(top(b)) < 0.03, `${name} meets at the top`); assert.ok(Math.abs(a.min.y) < 1e-3 && Math.abs(b.min.y) < 1e-3, `${name} stands on the floor`);
  }
});

test('a pan is about as wide as it is long, tilted 20-40 degrees from level, no two alike, its handle on a hook on the rail', () => {
  const pans = named(flightBoxes(), /^pan-/), tilts = pans.map(p => Math.round(deg(Math.acos(upOf(p).y))));
  assert.equal(pans.length, 3); assert.equal(new Set(tilts).size, 3);
  for (const p of pans) {
    const t = deg(Math.acos(upOf(p).y)), end = V(PAN.reach, 0, 0).applyQuaternion(p.quaternion).add(p.centre), { x, y, z, w } = SPOTS.panRack;
    assert.ok(t >= 20 && t <= 40, `${p.surface} ${t}`); assert.ok(p.half.x === p.half.z && p.half.x > 0.13 && p.half.x < 0.17, p.surface);
    assert.ok(Math.abs(end.y - (y - PAN.drop)) < 1e-9 && Math.abs(end.z - z) < 1e-9 && Math.abs(end.x - x) < w / 2, `${p.surface}'s handle ends under the rail`);
  }
});

test('a moved plan is the same plan shifted', () => {
  const at = { x: 7, z: -3 }, a = flightBoxes(), b = flightBoxes(at);
  assert.equal(a.length, b.length);
  a.forEach((p, i) => {
    assert.equal(p.surface, b[i].surface);
    for (const k of ['min', 'max']) assert.ok(Math.abs(b[i][k].x - p[k].x - 7) < 1e-9 && Math.abs(b[i][k].z - p[k].z + 3) < 1e-9 && Math.abs(b[i][k].y - p[k].y) < 1e-9);
    if (p.quaternion) assert.ok(p.quaternion.angleTo(b[i].quaternion) < 1e-6);
  });
  assert.equal(walkBoxes(at).length, walkBoxes().length);
});

test('walk boxes are marked, cover every chair and leave the doorway clear', () => {
  const walk = walkBoxes();
  for (const w of walk) assert.ok(w.walkOnly && w.isBox3);
  for (let n = 1; n <= 9; n++) assert.ok(walk.some(w => w.surface === `chair-${n}`), `chair-${n}`);
  assert.ok(!walk.some(w => w.max.x > -2.3 && w.min.z < 0.75 && w.max.z > -0.75), 'the doorway lane is clear');
  assert.ok(SPOTS.clipboard && SPOTS.lunchTables.length === 4 && SPOTS.scores.facing === 'north' && SPOTS.scores.z > 0.9);
});

// The real path grid (path.js: 0.25 cells, a body 0.3 wide) at the kitchen's real place: the origin the room gives it, the left edge of the
// building, and the walls and walk boxes. In rooms of several depths, because the z the cells fall on changes with the depth.
const DEPTHS = [8, 8.6, 9.7, 10, 12.3, 14, 15.5], LEFT = -(WALL_T + KITCHEN.width);
const kitchenGrid = (depth, dx = 0) => {
  const origin = { x: -WALL_T + dx, z: kitchenDoor(depth) }, room = { left: LEFT, back: Math.min(0, kitchenDoor(depth) + KITCHEN.back - WALL_T), width: WALL_T, depth };
  return { origin, at: (x, z) => V(x + origin.x, 0, z + origin.z), grid: walkGrid([...flightBoxes(origin, { doorShut: false }).filter(b => b.surface.startsWith('wall-')), ...walkBoxes(origin), behind(origin)], room) };
};
const MARKS = {
  doorway: [-0.7, 0], bin: [-1.4, -2.5], eastOfIsland: [-3, -3.6], westOfIsland: [-7.5, -3.6], sink: [-6.8, -6.8], stove: [-3, -6.8], fridge: [-8.4, -6.8], bucket: [-1.8, -4.9],
  shelf: [-9.2, -6.3], backWall: [-0.7, -7.5], farTable: [-6.25, -0.5], tray: [-8.6, -0.5], vending: [STARTS.vending.x, STARTS.vending.z], mug: [-5.2, -0.5],
};

test('every area a start mark can go is routable from the doorway', () => {
  for (const depth of DEPTHS) {
    const { at, grid } = kitchenGrid(depth);
    for (const [name, [x, z]] of Object.entries(MARKS)) {
      const p = at(x, z), open = nearestOpen(grid, p);
      assert.ok(open && open.distanceTo(p) < 0.2, `${name} (room ${depth}) is not on an open cell`);
      assert.ok(findPath(grid, at(...MARKS.doorway), p), `${name} (room ${depth}) is not reachable`);
    }
  }
});

// The way out from between the table rows is 0.5 m wide or more, so it holds a cell wherever the cells fall, not just where they happen to today.
test('the way out from between the table rows does not depend on where the cells fall', () => {
  for (const depth of DEPTHS) for (const dx of [0, 0.05, 0.1, 0.15, 0.2]) {
    const { at, grid } = kitchenGrid(depth, dx);
    for (const name of ['farTable', 'mug']) {
      const p = at(...MARKS[name]), way = findPath(grid, at(...MARKS.doorway), p);
      assert.ok(way, `${name} (room ${depth}, cells off by ${dx}) is not reachable`);
      assert.ok(nearestOpen(grid, p).distanceTo(p) < 0.25, `${name} (room ${depth}, cells off by ${dx}) is not on an open cell`);
    }
  }
});

test('walking boxes leave a way from the door to every zone and spot', () => {
  const spots = { ...Object.fromEntries(Object.entries(ZONES).filter(([, z]) => !z.surface).map(([name, z]) => [name, [z.centre.x, z.centre.z]])), clipboard: [SPOTS.clipboard.x, SPOTS.clipboard.z], scores: [SPOTS.scores.x, SPOTS.scores.z], panRack: [SPOTS.panRack.x, SPOTS.panRack.z], tap: [SPOTS.tap.x, SPOTS.tap.z], ...Object.fromEntries(SPOTS.lunchTables.map((t, i) => [`table${i}`, [t.x, t.z]])) };
  for (const depth of DEPTHS) {
    const { at, grid } = kitchenGrid(depth);
    for (const [name, [x, z]] of Object.entries(spots)) {
      const p = at(x, z), beside = nearestOpen(grid, p);
      assert.ok(beside && beside.distanceTo(p) < 1.3, `${name} (room ${depth}): nowhere to stand within reach`);
      assert.ok(findPath(grid, at(-1, 0), beside), `${name} (room ${depth}) can't be reached from the door`);
    }
  }
});

test("growing the room moves the kitchen's colliders and whoever's inside by the same amount", () => {
  assert.equal(kitchenShift(8, 10), 2);
  assert.equal(kitchenShift(10, 10), 0);
  const before = flightBoxes({ x: 0, z: kitchenDoor(8) }), after = flightBoxes({ x: 0, z: kitchenDoor(10) });
  assert.equal(before.length, after.length);
  before.forEach((b, i) => {
    assert.equal(after[i].surface, b.surface);
    for (const k of ['min', 'max']) assert.ok(Math.abs(after[i][k].x - b[k].x) < 1e-9 && Math.abs(after[i][k].y - b[k].y) < 1e-9 && Math.abs(after[i][k].z - b[k].z - 2) < 1e-9, `${b.surface} ${k}`);
    if (b.quaternion) assert.ok(b.quaternion.angleTo(after[i].quaternion) < 1e-6);
  });
});

test('the chair by the way out stands 25 cm further east', () => {
  assert.ok(flightBoxes().filter(b => b.surface === 'chair-6').every(b => b.min.x > -3.4), 'it has moved off the lane');
});
