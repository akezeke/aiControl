import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TUNE, R, STEP, newCar, step, floorMap } from '../client/office/rc-physics.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// What a test car can hit: plain boxes, every one of them, or nothing.
const boxes = list => ({ each(x, z, r, fn) { for (const b of list) fn(b.min.x, b.min.z, b.max.x, b.max.z); }, open: () => true });
const world = (solids = boxes([])) => ({ solids, columns: [] });
// Drives `c` for `secs` with `input` (or input(t)), in steps; the events it gave.
function drive(c, input, secs, w = world()) {
  const events = [];
  for (let t = 0; t < secs; t += STEP) step(c, typeof input === 'function' ? input(t) : input, w, STEP, events);
  return events;
}
const gas = { throttle: 1, steer: 0, drift: false };
// A room of meshes: a desk (top at 0.72-0.75 on four 5 cm legs, 1.6 x 0.8 m round (0, 2)), a wall along z 4 and a rug.
function office() {
  const room = new THREE.Group(), mat = new THREE.MeshBasicMaterial();
  const box = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); room.add(m); };
  box(1.6, 0.03, 0.8, 0, 0.735, 2);
  for (const [x, z] of [[-0.775, 1.625], [0.775, 1.625], [-0.775, 2.375], [0.775, 2.375]]) box(0.05, 0.72, 0.05, x, 0.36, z);
  box(6, 3, 0.2, 0, 1.5, 4.1);
  box(4, 0.01, 4, 0, 0.005, 2);
  return room;
}

test('full throttle reaches top speed and no more', () => {
  const c = newCar({ x: 0, z: 0, yaw: 0 });
  drive(c, gas, 3);
  assert.ok(c.fwd > TUNE.top * 0.95 && c.fwd <= TUNE.top + 0.01, `fwd ${c.fwd}`);
});

test('steering right turns toward -x when heading +z', () => {
  const c = newCar({ x: 0, z: 0, yaw: 0 });
  drive(c, gas, 2);
  const x0 = c.x;
  drive(c, { throttle: 1, steer: 1, drift: false }, 0.4);
  assert.ok(c.x < x0 - 0.05, `x ${c.x} from ${x0}`);
});

test('a held drift boosts on release', () => {
  const c = newCar({ x: 0, z: 0, yaw: 0 });
  drive(c, gas, 1.5);
  const events = drive(c, t => ({ throttle: 1, steer: 1, drift: t < 0.8 }), 1.2);
  assert.ok(events.some(e => e.type === 'boost'));
});

test('a wall stops it outside, a shallow glance keeps speed', () => {
  const wall = boxes([new THREE.Box3(V(-50, 0, 2), V(50, 3, 2.2))]);
  const c = newCar({ x: 0, z: 0, yaw: 0 });
  const events = drive(c, gas, 5, world(wall));
  assert.ok(c.z <= 2 - R + 1e-6, `z ${c.z}`);
  assert.ok(events.some(e => e.type === 'bump'));
  const glancing = newCar({ x: 0, z: 1.4, yaw: 1.27 });
  drive(glancing, gas, 2, world(wall));
  assert.ok(Math.hypot(glancing.vx, glancing.vz) > 3.5, `speed ${Math.hypot(glancing.vx, glancing.vz)}`);
});

test('under a desk between its legs, over a rug; stopped by a leg', () => {
  const map = floorMap(office());
  const under = newCar({ x: 0, z: 0, yaw: 0 });
  const quiet = drive(under, gas, 2, world(map));
  assert.ok(under.z > 2.4, `z ${under.z}`);
  assert.equal(quiet.filter(e => e.type === 'bump').length, 0);
  const leg = newCar({ x: 0.775, z: 0, yaw: 0 });
  assert.ok(drive(leg, gas, 1.5, world(map)).some(e => e.type === 'bump'));
});

test('the view: open under a desk, not inside a leg', () => {
  const map = floorMap(office());
  assert.equal(map.open(V(0, 0.3, 2)), true);
  assert.equal(map.open(V(0.775, 0.3, 1.625)), false);
});

test("long frames don't tunnel", () => {
  const room = new THREE.Group(), wall = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 0.025), new THREE.MeshBasicMaterial());
  wall.position.set(0, 0.5, 2); room.add(wall);
  const map = floorMap(room), c = newCar({ x: 0, z: 0, yaw: 0 });
  for (let frame = 0; frame < 40; frame++) for (let k = 0; k < 12; k++) step(c, gas, world(map), STEP, []);
  assert.ok(c.z < 2 - 0.0125, `z ${c.z}`);
});

test('a drift keeps its side: steering the other way widens it, a new press can go the other way', () => {
  const c = newCar({ x: 0, z: 0, yaw: 0 });
  drive(c, gas, 2);
  drive(c, { throttle: 1, steer: 1, drift: true }, 0.4); // a drift to the right: yaw falls
  const turning = [];
  for (let t = 0; t < 0.6; t += STEP) { step(c, { throttle: 1, steer: -1, drift: true }, world(), STEP, []); turning.push(c.spin); }
  assert.ok(turning.every(spin => spin < 0), `still turning right while held: ${Math.max(...turning)}`);
  drive(c, { throttle: 1, steer: 0, drift: false }, 0.3);
  drive(c, { throttle: 1, steer: -1, drift: true }, 0.4);
  assert.ok(c.spin > 0, `pressed again, it drifts left: ${c.spin}`);
});

test('off the road it tops out at offTop', () => {
  const c = newCar({ x: 0, z: 0, yaw: 0 }), grass = { ...world(), surface: () => ({ ground: 0, road: false }) };
  drive(c, gas, 4, grass);
  assert.ok(Math.abs(c.fwd - TUNE.top * TUNE.offTop) <= TUNE.top * TUNE.offTop * 0.02, `fwd ${c.fwd} vs ${TUNE.top * TUNE.offTop}`);
  const fast = newCar({ x: 0, z: 0, yaw: 0 });
  drive(fast, gas, 3);
  drive(fast, gas, 1.5, grass);
  assert.ok(fast.fwd < TUNE.top * TUNE.offTop * 1.05, `running off the road it slows to it: ${fast.fwd}`);
});

test('kerbs keep it on the track, glancing off them', () => {
  // A straight track along z, 0.5 m wide: a kerb either side at |x| = 0.25.
  const rails = c => { const over = Math.abs(c.x) + R - 0.25; return over > 0 ? { nx: -Math.sign(c.x), nz: 0, depth: over } : null; };
  const c = newCar({ x: 0, z: 0, yaw: 0.5 }), events = drive(c, gas, 3, { ...world(), rails });
  assert.ok(Math.abs(c.x) <= 0.25 - R + 1e-6, `x ${c.x}`);
  assert.ok(events.some(e => e.type === 'bump'));
  assert.ok(Math.hypot(c.vx, c.vz) > TUNE.top * 0.8, `carried on along it at speed: ${Math.hypot(c.vx, c.vz)}`);
});

// In the air (build step 3). A ramp: `w` wide, `l` long, rising to `h` at its lip (the far end, the way yaw faces).
const ramp = (z, more = {}) => ({ x: 0, z, yaw: 0, w: 0.5, l: 0.3, h: 0.05, glider: false, ...more });
const GLIDER = { l: 0.4, h: 0.15, glider: true };
// Flat out along +z over `ramps` till it's been in the air and come down again (or `secs` pass): its events, the highest it
// got, and how long it was up. `during(c)` runs each step it's in the air.
function jump(ramps, { secs = 6, input = () => gas, during = () => {}, solids = boxes([]) } = {}) {
  const c = newCar({ x: 0, z: 0, yaw: 0 }), events = [], w = { solids, columns: [], ramps };
  let top = 0, up = 0, t = 0;
  for (; t < secs; t += STEP) {
    const was = events.length;
    step(c, input(c, t), w, STEP, events);
    if (c.air) { up += STEP; top = Math.max(top, c.y); during(c, events); }
    if (events.slice(was).some(e => e.type === 'land')) break;
  }
  return { c, events, top, up };
}

test('a ramp throws it into the air and it comes down', () => {
  const { events, top, up } = jump([ramp(4)]);
  assert.ok(events.some(e => e.type === 'takeoff'), 'took off');
  assert.ok(top > 0.03, `top ${top}`);
  assert.ok(events.some(e => e.type === 'land') && up < 1.5, `up ${up}`);
});

test('a trick landed straight boosts; landed crooked, nothing', () => {
  const trick = (c, t) => ({ ...gas, drift: !!c.air && c.air.since > 0.05 && c.air.since < 0.12 });
  const clean = jump([ramp(4)], { input: trick });
  assert.equal(clean.events.find(e => e.type === 'land')?.trick, 'clean');
  assert.ok(clean.c.boost > 0, 'boosting');
  const crooked = jump([ramp(4)], { input: trick, during: c => { if (c.air.since > 0.15 && !c.turned) { c.yaw += 0.5; c.turned = true; } } });
  assert.equal(crooked.events.find(e => e.type === 'land')?.trick, 'crooked');
  assert.ok(!(crooked.c.boost > 0), 'no boost');
  assert.equal(jump([ramp(4)]).events.find(e => e.type === 'land')?.trick, null, 'no trick, nothing to say');
});

test('the glider stays up longer, unfolding at the top', () => {
  const hop = jump([ramp(4)]), glide = jump([ramp(4, GLIDER)]);
  assert.ok(glide.up >= hop.up * 3, `glide ${glide.up} vs hop ${hop.up}`);
  assert.ok(glide.events.some(e => e.type === 'takeoff' && e.glide));
  assert.ok(glide.events.some(e => e.type === 'unfold'));
});

test('in the air a monitor still stops it', () => {
  const room = new THREE.Group(), m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.05), new THREE.MeshBasicMaterial());
  m.position.set(0, 1.1, 5.2); room.add(m);
  const bumped = [];
  jump([ramp(4, GLIDER)], { solids: floorMap(room), during: (c, events) => { if (events.at(-1)?.type === 'bump') bumped.push(c.y); } });
  assert.ok(bumped.length && bumped[0] > 0.85, `bumped at ${bumped}`);
});

test('long frames through a jump: never under the floor, nothing NaN', () => {
  const c = newCar({ x: 0, z: 0, yaw: 0 }), w = { ...world(), ramps: [ramp(2, GLIDER)] };
  for (let t = 0; t < 5; t += 0.1) {
    step(c, gas, w, 0.1, []);
    assert.ok(c.y >= 0 && [c.x, c.y, c.z, c.vx, c.vy, c.vz, c.yaw].every(Number.isFinite), `at ${t}: ${JSON.stringify(c)}`);
  }
});

test("a ramp's side is a wall", () => {
  const c = newCar({ x: -1.5, z: 4, yaw: Math.PI / 2 }), events = drive(c, gas, 2, { ...world(), ramps: [ramp(4, GLIDER)] });
  assert.ok(events.some(e => e.type === 'bump'), 'bumped');
  assert.ok(c.x < -0.25 + 0.01 && c.y === 0, `x ${c.x} y ${c.y}`);
});

test('coming down on a desk it lands on top, and drops off its edge', () => {
  const map = floorMap(office());
  const c = Object.assign(newCar({ x: 0, z: 1.75, yaw: 0 }), { y: 0.9, air: { since: 0, trick: false, glide: false, glider: false } });
  const events = [], w = { ...world(map) };
  for (let t = 0; t < 0.6; t += STEP) step(c, { throttle: 0, steer: 0, drift: false }, w, STEP, events);
  assert.ok(!c.air && Math.abs(c.y - 0.75) < 0.01, `on the desk: y ${c.y}`);
  for (let t = 0; t < 2 && c.y > 0; t += STEP) step(c, { throttle: 0.4, steer: 0, drift: false }, w, STEP, events);
  assert.equal(c.y, 0, 'down off its far edge');
  assert.ok(c.z > 2.4, `z ${c.z}`);
});

// Drifting is how to take a corner at speed: flat out at full lock, a drift holds more speed round a tighter turn than grip
// does (its pull toward the corner, speed² / radius, is half as much again).
test('a drift corners harder than grip', () => {
  const pull = drift => {
    const c = newCar({ x: 0, z: 0, yaw: 0 }); drive(c, gas, 3);
    const pts = []; drive(c, t => { if (t > 0.8) pts.push([c.x, c.z]); return { throttle: 1, steer: 1, drift }; }, 1.6);
    const [a, b, d] = [pts[0], pts[pts.length >> 1], pts.at(-1)], area2 = Math.abs((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]));
    const radius = Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(d[0] - b[0], d[1] - b[1]) * Math.hypot(d[0] - a[0], d[1] - a[1]) / 2 / area2;
    return { radius, pull: Math.hypot(c.vx, c.vz) ** 2 / radius };
  };
  const grip = pull(false), slide = pull(true);
  assert.ok(slide.radius < grip.radius, `drift radius ${slide.radius.toFixed(2)} vs grip ${grip.radius.toFixed(2)}`);
  assert.ok(slide.pull > grip.pull * 1.5, `drift ${slide.pull.toFixed(1)} vs grip ${grip.pull.toFixed(1)}`);
});

// How much a drift turns is yours: steering into it tightens it, away from it widens it, and it never turns the other way.
test('a drift turns as much as you steer it', () => {
  const radius = steer => {
    const c = newCar({ x: 0, z: 0, yaw: 0 }); drive(c, gas, 3); drive(c, { throttle: 1, steer: 1, drift: true }, 0.1);
    const pts = []; drive(c, t => { if (t > 0.6) pts.push([c.x, c.z, c.spin]); return { throttle: 1, steer, drift: true }; }, 1.4);
    const [a, b, d] = [pts[0], pts[pts.length >> 1], pts.at(-1)], area2 = Math.abs((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]));
    assert.ok(pts.every(p => p[2] < 0), `still turning right, steering ${steer}`);
    return Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(d[0] - b[0], d[1] - b[1]) * Math.hypot(d[0] - a[0], d[1] - a[1]) / 2 / area2;
  };
  const [into, none, away] = [1, 0, -1].map(radius);
  assert.ok(into < none * 0.75 && none < away * 0.6, `radius into ${into.toFixed(2)}, none ${none.toFixed(2)}, away ${away.toFixed(2)}`);
});

// Cars meet cars (build step 4): circles against circles, equal mass, glancing off as off a wall.
test('cars bump each other', () => {
  const a = Object.assign(newCar({ x: 0, z: 0, yaw: 0 }), { id: 'a' }), b = Object.assign(newCar({ x: 0.02, z: 1.2, yaw: Math.PI }), { id: 'b' }), cars = [a, b];
  const ea = [], eb = [];
  for (let t = 0; t < 2; t += STEP) {
    step(a, gas, { ...world(), cars }, STEP, ea); step(b, gas, { ...world(), cars }, STEP, eb);
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 2 * R - 0.01, `apart: ${Math.hypot(a.x - b.x, a.z - b.z).toFixed(3)}`);
  }
  assert.ok(ea.some(e => e.type === 'bump' && e.car === 'b') && eb.some(e => e.type === 'bump' && e.car === 'a'));
});

// Close behind another car, pointing its way, you're pulled along (draft): close, you gain on it; a metre back, you don't.
test('slipstream pulls you along', () => {
  const gap = behind => {
    const lead = Object.assign(newCar({ x: 0, z: behind, yaw: 0 }), { id: 'lead', vz: TUNE.top, fwd: TUNE.top }), car = Object.assign(newCar({ x: 0, z: 0, yaw: 0 }), { id: 'me', vz: TUNE.top, fwd: TUNE.top }), cars = [lead, car];
    let drafted = false;
    for (let t = 0; t < 1; t += STEP) { step(lead, gas, { ...world(), cars }, STEP, []); step(car, gas, { ...world(), cars }, STEP, []); drafted ||= car.draft; }
    return { gap: lead.z - car.z, drafted };
  };
  const close = gap(0.3), far = gap(1);
  assert.ok(close.drafted && close.gap < 0.28, `0.3 m behind it closes in: ${close.gap.toFixed(3)}`);
  assert.ok(!far.drafted && far.gap > 0.99, `1 m behind it doesn't: ${far.gap.toFixed(3)}`);
});

// A car's pull is its share of the top speed (an NPC's rubber band sets it).
test("a car's pull sets its top speed", () => {
  const c = Object.assign(newCar({ x: 0, z: 0, yaw: 0 }), { pull: 1.08 });
  drive(c, gas, 4);
  assert.ok(Math.abs(c.fwd - TUNE.top * 1.08) < TUNE.top * 0.02, `fwd ${c.fwd} vs ${TUNE.top * 1.08}`);
});

// Ramps are generous: half on one (its middle just off the edge, its inner wheels on) it still jumps, and one driven onto
// from the side near its low end climbs it; only the tall part of a side, near the lip, is a wall.
test('half on a ramp, or onto it at an angle, it still jumps', () => {
  const hop = ramp(4, { l: 0.4, h: 0.1 });
  const half = Object.assign(newCar({ x: 0.29, z: 0, yaw: 0 }), { vz: TUNE.top, fwd: TUNE.top });
  assert.ok(drive(half, gas, 3, { ...world(), ramps: [hop] }).some(e => e.type === 'takeoff'), 'half on');
  const angled = Object.assign(newCar({ x: -0.9, z: 3.25, yaw: 0.9 }), { vx: Math.sin(0.9) * TUNE.top, vz: Math.cos(0.9) * TUNE.top, fwd: TUNE.top });
  const events = drive(angled, gas, 2, { ...world(), ramps: [hop] });
  assert.ok(events.some(e => e.type === 'takeoff') && !events.some(e => e.type === 'bump'), `at an angle: ${events.map(e => e.type).join(' ')}`);
});
