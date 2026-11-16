import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { R, STEP, TUNE, floorMap, newCar, step } from '../client/office/rc-physics.js';
import { WIDTH, KERB, SKILL, AUTOPILOT, makeCircuit, project, createDriver, racePar, rail, scatterRamps, placePickups, reaches, PERSONALITIES, personalityOf } from '../client/office/rc-course.js';
import { layoutOffice } from '../client/office/layout.js';
import { createRoom } from '../client/office/room.js';

const blank = () => new Proxy({}, { get: (t, k) => k in t ? t[k] : () => ({ addColorStop() {} }), set: (t, k, v) => { t[k] = v; return true; } });
const noDocument = t => { const was = globalThis.document; globalThis.document = { createElement: () => ({ getContext: blank }), fonts: undefined }; t.after(() => { if (was) globalThis.document = was; else delete globalThis.document; }); };
// A real office, as the game builds it: `count` sessions in 3 projects laid out by layout.js, furnished by room.js, the
// floor map from the room's root, the start in front of the dock.
function furnished(count, projects = 3) {
  const sessions = Array.from({ length: count }, (_, i) => ({ id: `s${i}`, cwd: `/p${i % projects}`, project: `p${i % projects}`, status: 'working' }));
  const layout = layoutOffice(sessions, null), room = createRoom(new THREE.Scene(), { initTexture() {} });
  room.sync(layout, new Map());
  const d = room.rcDock.position;
  return { map: floorMap(room.kitchen.group.parent), root: room.kitchen.group.parent, room: { ...layout.room, pods: layout.pods, cellW: layout.grid.cellW }, start: { x: d.x, z: d.z + 0.6, yaw: 0 }, pods: layout.pods };
}

// An office in meshes: four walls round width x depth, and `rows` pods of two desks side by side (a top at 0.72-0.75 on four
// 5 cm legs, 1.6 x 0.8 m, and a PC tower under one end), each row 2.6 m on from the last.
function office(width, depth, rows) {
  const root = new THREE.Group(), mat = new THREE.MeshBasicMaterial();
  const box = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); root.add(m); };
  box(width + 0.4, 3, 0.2, width / 2, 1.5, -0.1); box(width + 0.4, 3, 0.2, width / 2, 1.5, depth + 0.1);
  box(0.2, 3, depth, -0.1, 1.5, depth / 2); box(0.2, 3, depth, width + 0.1, 1.5, depth / 2);
  for (let r = 0; r < rows; r++) for (const dx of [-0.8, 0.8]) {
    const x = width / 2 + dx, z = 2.4 + r * 2.6;
    box(1.6, 0.03, 0.8, x, 0.735, z);
    for (const [lx, lz] of [[-0.775, -0.375], [0.775, -0.375], [-0.775, 0.375], [0.775, 0.375]]) box(0.05, 0.72, 0.05, x + lx, 0.36, z + lz);
    box(0.2, 0.45, 0.45, x + 0.6 * Math.sign(dx), 0.225, z);
  }
  return { map: floorMap(root), room: { left: 0, back: 0, width, depth }, start: { x: width / 2, z: 0.8, yaw: 0 } };
}
const OFFICES = [office(9, 6, 1), office(10, 8.5, 2), office(11, 11, 3)];
const SEEDS = Array.from({ length: 31 }, (_, i) => `2026-11-11:${i}`);
const point = (c, i) => [c.points[i * 2], c.points[i * 2 + 1]];
const count = c => c.points.length / 2;

test('a circuit closes and stays clear', () => {
  for (const o of OFFICES) for (const seed of SEEDS) {
    const c = makeCircuit({ ...o, seed });
    assert.ok(c, `a circuit for ${seed} in ${o.room.width}x${o.room.depth}`);
    const [x0, z0] = point(c, 0), [x1, z1] = point(c, count(c) - 1);
    assert.ok(Math.hypot(x1 - x0, z1 - z0) <= 0.05 + 1e-4, `closes: ${Math.hypot(x1 - x0, z1 - z0)}`); // float32 points
    for (let i = 0; i < count(c); i++) {
      const [x, z] = point(c, i);
      assert.ok(o.map.clearance(x, z) >= WIDTH / 2 + R - 1e-6, `${seed}: clear at ${i} (${x.toFixed(2)}, ${z.toFixed(2)}): ${o.map.clearance(x, z)}`);
    }
  }
});


test('the same seed and office give the same circuit', () => {
  const [o] = OFFICES;
  assert.equal(makeCircuit({ ...o, seed: 'a' }).key, makeCircuit({ ...o, seed: 'a' }).key);
  assert.notEqual(makeCircuit({ ...o, seed: 'a' }).key, makeCircuit({ ...o, seed: 'b' }).key);
});

// The spec's 20-35 s at par, at ~1.4 m/s across the office, is 28-49 m; small offices give shorter.
test('laps are 6 to 50 m long', () => {
  for (const o of OFFICES) for (const seed of SEEDS) {
    const c = makeCircuit({ ...o, seed });
    assert.ok(c.length >= 6 && c.length <= 50, `${seed}: ${c.length}`);
  }
});

test('the grid is 8 slots behind the start, on the track, facing on', () => {
  const c = makeCircuit({ ...OFFICES[1], seed: 'grid' });
  assert.equal(c.grid.length, 8);
  for (const slot of c.grid) {
    const at = project(c, slot.x, slot.z);
    assert.ok(Math.abs(at.side) <= WIDTH / 2, `on the track: ${at.side}`);
    assert.ok(at.s > c.length - 1.5, `behind the start: ${at.s} of ${c.length}`);
  }
  assert.deepEqual(c.checkpoints, [0.25, 0.5, 0.75]);
});

test('project finds the nearest sample and its side', () => {
  const c = makeCircuit({ ...OFFICES[1], seed: 'project' });
  const [x, z] = point(c, 100), [nx, nz] = point(c, 101), d = Math.hypot(nx - x, nz - z), rx = -(nz - z) / d, rz = (nx - x) / d;
  for (const near of [-1, 98]) {
    const at = project(c, x + rx * 0.1, z + rz * 0.1, near);
    assert.ok(Math.abs(at.i - 100) <= 1, `i ${at.i}`);
    assert.ok(Math.abs(at.side - 0.1) < 0.01, `side ${at.side}`);
    assert.ok(Math.abs(at.s - 100 * c.length / count(c)) < 0.1, `s ${at.s}`);
  }
});

test('a tiny office falls back or gives null, never throws', () => {
  const o = office(4, 4, 1);
  for (const seed of SEEDS.slice(0, 5)) {
    const c = makeCircuit({ ...o, seed });
    if (c) assert.ok(c.length > 0 && c.grid.length === 8);
  }
});

// Any office laps within a minute. One the size of a real one (16 x 14 m) is aimed at the spec's 20-35 s par: on average
// there, and none far off it. Small ones lap quicker.
test('the autopilot laps every swept circuit', () => {
  for (const [o, real] of [...OFFICES.map(o => [o, false]), [office(16, 14, 3), true]]) {
    const pars = SEEDS.slice(0, 12).map(seed => {
      const c = makeCircuit({ ...o, seed }), par = racePar(c, { solids: o.map, columns: [] });
      assert.ok(par !== null && par < 60, `${seed} in ${o.room.width}x${o.room.depth}: par ${par}`);
      if (real) assert.ok(par >= 15 && par <= 40, `${seed} in ${o.room.width}x${o.room.depth}: par ${par} (length ${c.length.toFixed(1)})`);
      return par;
    });
    const mean = pars.reduce((a, b) => a + b, 0) / pars.length;
    if (real) assert.ok(mean >= 20 && mean <= 35, `mean par ${mean}`);
  }
});

test('a driver never stalls on the line', () => {
  for (const o of OFFICES) for (const seed of SEEDS.slice(0, 4)) {
    const c = makeCircuit({ ...o, seed }), world = { solids: o.map, columns: [] }, drive = createDriver({ skill: SKILL.normal, seed });
    const car = newCar(c.grid[0]);
    let best = -Infinity, since = 0, done = 0, near = -1, last = null;
    for (let t = 0; t < 3 * 60 && done < 3 * c.length; t += STEP) {
      step(car, drive(car, c, world, t), world, STEP, []);
      const at = project(c, car.x, car.z, near); near = at.i;
      if (last !== null) { let d = at.s - last; if (d < -c.length / 2) d += c.length; if (d > c.length / 2) d -= c.length; done += d; }
      last = at.s;
      if (done > best + 0.05) { best = done; since = 0; } else since += STEP;
      assert.ok(since < 4, `${seed} in ${o.room.width}x${o.room.depth}: stuck at ${car.x.toFixed(2)}, ${car.z.toFixed(2)} after ${t.toFixed(1)} s`);
    }
    assert.ok(done >= 3 * c.length, `${seed}: 3 laps (${done.toFixed(1)} of ${(3 * c.length).toFixed(1)} m)`);
  }
});

// The demo's office is 22 x 15.5 m: control points spread over all of it would make laps of 70 m.
test('a big office still gets a lap no longer than 50 m', () => {
  const o = office(22, 15.5, 4);
  for (const seed of SEEDS.slice(0, 8)) {
    const c = makeCircuit({ ...o, seed });
    assert.ok(c && c.length <= 50, `${seed}: ${c?.length}`);
  }
});

// The demo's office: 11 sessions. Cluttered as a real one is (chairs, bins, plants, a sofa), and big.
test('a real office gets a circuit, in good time, that the autopilot laps', t => {
  noDocument(t);
  const o = furnished(11);
  for (const seed of SEEDS.slice(0, 5)) {
    const began = performance.now(), c = makeCircuit({ ...o, seed }), took = performance.now() - began;
    assert.ok(c, `${seed}: a circuit in ${o.room.width}x${o.room.depth}`);
    assert.ok(took < 2500, `${seed}: laid in ${took.toFixed(0)} ms`);
    const par = racePar(c, { solids: o.map, columns: [] });
    assert.ok(par !== null && par >= 15 && par <= 40, `${seed}: par ${par} (length ${c.length.toFixed(1)})`);
  }
});

// Drifting is how to take the tight corners: the autopilot, which sets par (and so the medals), drifts them, and laps quicker
// for it than braking for them would.
test('drifting the tight corners is quicker, and par does it', t => {
  noDocument(t);
  const o = furnished(11), world = { solids: o.map, columns: [] };
  const pars = SEEDS.slice(0, 6).map(seed => { const c = makeCircuit({ ...o, seed }); return [racePar(c, world), racePar(c, world, { ...AUTOPILOT, drift: false })]; });
  const mean = k => pars.reduce((sum, p) => sum + p[k], 0) / pars.length;
  assert.ok(mean(0) < mean(1) * 0.98, `drifting ${mean(0).toFixed(2)} s vs braking ${mean(1).toFixed(2)} s: ${pars.map(p => p.map(v => v.toFixed(1)).join('/')).join(' ')}`);
  assert.ok(pars.filter(([d, g]) => d < g).length >= 4, `quicker on ${pars.filter(([d, g]) => d < g).length} of 6`);
});

// Not just round: over a lap a loop turns 360° one way more than the other, and a circuit worth driving also turns the other
// way, at least 90° in all, in most of them.
const turnings = c => {
  const n = count(c), k = 5; let left = 0, right = 0;
  for (let i = 0; i < n; i += k) {
    const [ax, az] = point(c, i), [bx, bz] = point(c, (i + k) % n), [cx, cz] = point(c, (i + 2 * k) % n);
    let d = Math.atan2(cx - bx, cz - bz) - Math.atan2(bx - ax, bz - az); d = Math.atan2(Math.sin(d), Math.cos(d));
    if (d > 0) left += d; else right -= d;
  }
  return Math.min(left, right);
};
test('circuits turn both ways', t => {
  noDocument(t);
  for (const o of [furnished(11), office(16, 14, 3)]) {
    const both = SEEDS.slice(0, 10).filter(seed => turnings(makeCircuit({ ...o, seed })) >= Math.PI / 2);
    assert.ok(both.length >= 7, `${both.length} of 10 turn the other way 90°+ in ${o.room.width.toFixed(1)}x${o.room.depth}`);
  }
});

// What the user asked for: varied laps in a real office, not round the edge. Between the pods (inside the block they stand in)
// for a good part of the lap, through a tunnel under a row of desks, and turning a lot both ways.
test('in a real office laps go between the pods, under desks, and both ways', t => {
  noDocument(t);
  const o = furnished(11), pods = o.pods, x0 = Math.min(...pods.map(p => p.x - p.width / 2)), x1 = Math.max(...pods.map(p => p.x + p.width / 2));
  const z0 = Math.min(...pods.map(p => p.z - p.depth / 2)), z1 = Math.max(...pods.map(p => p.z + p.depth / 2));
  let between = 0, under = 0, turning = 0;
  for (const seed of SEEDS.slice(0, 10)) {
    const c = makeCircuit({ ...o, seed }), at = Array.from({ length: count(c) }, (_, i) => point(c, i));
    if (at.filter(([x, z]) => x > x0 && x < x1 && z > z0 && z < z1).length >= at.length * 0.25) between++;
    if (at.some(([x, z]) => o.map.roofed(x, z))) under++;
    if (turnings(c) >= Math.PI) turning++;
  }
  assert.ok(between >= 7, `${between} of 10 spend a quarter of the lap between the pods`);
  assert.ok(under >= 6, `${under} of 10 go under desks`);
  assert.ok(turning >= 7, `${turning} of 10 turn 180°+ the other way`);
});

// Not a round blob: a loop's area against its convex hull's (a round or oval loop fills nearly all of it; an L or a U
// leaves a bay out), and corners you have to brake or drift for (sharper than the car can take at 80% of its top speed:
// 1.3/m, about a 0.77 m radius).
const hull = pts => {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length >= 2 && cross(hi.at(-2), hi.at(-1), q) <= 0) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
};
const area = pts => Math.abs(pts.reduce((sum, [x, z], i) => { const [nx, nz] = pts[(i + 1) % pts.length]; return sum + x * nz - nx * z; }, 0)) / 2;
const corners = c => { let n = 0, inside = false; for (const k of c.curvature) { if (k > 1.3 && !inside) n++; inside = k > 1.3; } return n; };
test('in a real office laps have bays and corners to brake for', t => {
  noDocument(t);
  const o = furnished(11);
  let bays = 0, braking = 0;
  for (const seed of SEEDS.slice(0, 10)) {
    const c = makeCircuit({ ...o, seed }), at = Array.from({ length: count(c) }, (_, i) => point(c, i));
    if (area(at) / area(hull(at)) <= 0.8) bays++;
    if (corners(c) >= 3) braking++;
  }
  // An office of 2 x 2 pods allows about this: a figure of eight or a deep bay on some days, a shallower notch on the rest.
  assert.ok(bays >= 4, `${bays} of 10 fill no more than 80% of their hull`);
  assert.ok(braking >= 6, `${braking} of 10 have 3+ corners to brake for`);
});

// Kerbs both sides, KERB out (a strip of slow floor past the road's edge), open only where the lap passes close to itself
// (a figure of eight's crossing, two parts whose kerbs would meet): elsewhere a car pressed past one is pushed back in, a car
// on the road's edge doesn't touch one, and nor does one on the centreline.
test('kerbs: closed but where the lap passes itself, and a car on the line never touches them', t => {
  noDocument(t);
  const o = furnished(11), laps = SEEDS.slice(0, 10).map(seed => makeCircuit({ ...o, seed }));
  for (const c of laps) {
    for (let i = 0; i < count(c); i += 7) { const [x, z] = point(c, i); assert.equal(rail(c, x, z, i).depth, undefined, `on the line at ${i}`); }
    const opened = c.open.right.reduce((n, v) => n + v, 0) + c.open.left.reduce((n, v) => n + v, 0), crosses = Array.from({ length: count(c) }, (_, i) => i).some(i => {
      const [x, z] = point(c, i); return Array.from({ length: count(c) }, (_, j) => j).some(j => Math.min(Math.abs(i - j), count(c) - Math.abs(i - j)) * c.length / count(c) > 1.5 && Math.hypot(point(c, j)[0] - x, point(c, j)[1] - z) < 2 * KERB);
    });
    assert.equal(opened > 0, crosses, `open ${opened} where it ${crosses ? 'does' : "doesn't"} pass itself`);
    // A sample in the middle of a closed stretch of the right kerb (by a gap's end the car may be let through), on a straight
    // (in a tight bend the nearest part of the road is a way along, so the push back in comes at an angle).
    const k = c.open.right.findIndex((v, i) => Math.abs(c.curvature[i]) < 0.5 && Array.from({ length: 21 }, (_, d) => c.open.right[(i + d - 10 + count(c)) % count(c)]).every(g => !g)), [x, z] = point(c, k), [nx, nz] = point(c, k + 1), d = Math.hypot(nx - x, nz - z), rx = -(nz - z) / d, rz = (nx - x) / d, out = rail(c, x + rx * (KERB + 0.05), z + rz * (KERB + 0.05), k);
    // Back in (in a bend, square to the nearest part of the track, which can be a little way along).
    assert.ok(out.depth > 0 && out.nx * rx + out.nz * rz < -0.7, `pushed back in from past the right kerb at ${k}`);
    assert.equal(rail(c, x + rx * WIDTH / 2, z + rz * WIDTH / 2, k).depth, undefined, `free on the road's edge at ${k}`);
  }
  assert.ok(laps.some(c => c.open.right.some(v => v)), 'some lap crosses itself');
  // A gap in a kerb leads onto the other road, never onto the floor: just past it is within that road's kerbs.
  for (const c of laps) for (const [name, sign] of [['right', 1], ['left', -1]]) c.open[name].forEach((gap, i) => {
    if (!gap) return;
    // Square to the road there, from the samples either side (in a tight bend the next one alone points a little off).
    const [x, z] = point(c, i), [bx, bz] = point(c, (i - 1 + count(c)) % count(c)), [nx, nz] = point(c, (i + 1) % count(c)), d = Math.hypot(nx - bx, nz - bz), rx = -(nz - bz) / d * sign, rz = (nx - bx) / d * sign;
    const px = x + rx * (KERB + 0.1), pz = z + rz * (KERB + 0.1), on = project(c, px, pz);
    assert.ok(Math.abs(on.side) <= KERB, `the ${name} gap at ${i} leads onto the floor (${on.side.toFixed(2)} off the road at ${on.i})`);
  });
});

// Ramps (build step 3). A glide off `ramp`: from 1.5 m before it, flat out straight on, till it lands. → { events, car }.
function glideOff(ramp, map) {
  const fx = Math.sin(ramp.yaw), fz = Math.cos(ramp.yaw), car = newCar({ x: ramp.x - fx * 1.5, z: ramp.z - fz * 1.5, yaw: ramp.yaw });
  Object.assign(car, { vx: fx * TUNE.top, vz: fz * TUNE.top, fwd: TUNE.top });
  const events = [], world = { solids: map, columns: [], ramps: [ramp] };
  for (let t = 0; t < 6; t += STEP) {
    const was = events.length; step(car, { throttle: 1, steer: 0, drift: false }, world, STEP, events);
    for (const e of events.slice(was)) e.air = !!car.air || e.type === 'land';
    if (events.slice(was).some(e => e.type === 'land')) break;
  }
  return { events, car };
}
// How far (m) the track strays across from the line a ramp faces along, from `before` m before it to `after` m after.
const stray = (c, r, before, after) => { const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw), i = project(c, r.x, r.z).i, n = count(c), per = c.length / n; let most = 0; for (let k = -Math.round(before / per); k <= Math.round(after / per); k++) { const [x, z] = point(c, ((i + k) % n + n) % n); most = Math.max(most, Math.abs((x - r.x) * -fz + (z - r.z) * fx)); } return most; };

// Small ramps, 2 to 4 a lap (no glider ramp: Just driving has those), on straights (the track within 12 cm of the line it flies
// along, from 1.2 m before to 1.6 m after: a hop flies ~1.4 m), square across the track,
// not under a desk and not where the lap passes itself (it'd be driven into from the side).
test('ramps sit on straights, square on, out from under desks and off crossings', t => {
  noDocument(t);
  const o = furnished(11), laps = SEEDS.slice(0, 10).map(seed => makeCircuit({ ...o, seed }));
  let enough = 0;
  for (const c of laps) {
    const small = c.ramps;
    assert.ok(small.length <= 4 && small.every(r => !r.glider), `${small.length} ramps`);
    if (small.length >= 2) enough++;
    for (const r of small) {
      const at = project(c, r.x, r.z), [fx, fz] = [Math.sin(r.yaw), Math.cos(r.yaw)], [x1, z1] = point(c, (at.i + 1) % count(c)), [x0, z0] = point(c, at.i);
      assert.ok(Math.abs(at.side) < 0.02 && (fx * (x1 - x0) + fz * (z1 - z0)) / Math.hypot(x1 - x0, z1 - z0) > 0.99, `on the line, facing on: ${JSON.stringify(r)}`);
      assert.ok(stray(c, r, 1.2, 1.6) <= 0.12, `on a straight at ${at.i}: ${stray(c, r, 1.2, 1.6).toFixed(2)} m off`);
      assert.ok(!o.map.roofed(r.x, r.z), `not under a desk at ${at.i}`);
      for (let j = 0; j < count(c); j++) {
        const along = Math.min(Math.abs(j - at.i), count(c) - Math.abs(j - at.i)) * c.length / count(c);
        assert.ok(along < 1.5 || Math.hypot(point(c, j)[0] - r.x, point(c, j)[1] - r.z) > 1, `the lap passes the ramp at ${at.i} at ${j}`);
      }
    }
  }
  assert.ok(enough >= 8, `${enough} of 10 laps have 2 or more`);
});

// Just driving (no track): ramps on open floor, each with room to run up and land, away from the dock, and glider ramps (before
// rows of desks, or anywhere with room to fly; coming down on a desk is fine), each flight clear.
test('just driving, ramps are scattered with room round them, and a glider flies a row of desks', t => {
  noDocument(t);
  const o = furnished(11), ramps = scatterRamps({ ...o, seed: '2026-11-12' }), small = ramps.filter(r => !r.glider), gliders = ramps.filter(r => r.glider);
  assert.ok(small.length >= 4, `${small.length} ramps`);
  for (const r of small) {
    const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw);
    for (let u = -1.2; u <= 1.5; u += 0.05) assert.ok(o.map.clearance(r.x + fx * u, r.z + fz * u) >= 0.35 && !o.map.roofed(r.x + fx * u, r.z + fz * u), `room round ${JSON.stringify(r)} at ${u.toFixed(2)}`);
    assert.ok(Math.hypot(r.x - o.start.x, r.z - o.start.z) > 1.2, 'away from the dock');
  }
  assert.ok(gliders.length >= 2, `glider ramps, anywhere they've room to fly: ${gliders.length}`);
  for (const r of gliders) {
    const { events, car } = glideOff(r, o.map);
    assert.ok(events.some(e => e.type === 'unfold') && !events.some(e => e.air && e.type === 'bump'), `glide clear off ${JSON.stringify(r)}`);
  }
  assert.deepEqual(scatterRamps({ ...o, seed: '2026-11-12' }), ramps, 'the same each time');
});

// Collect: ten paperclips a day, spread out: some at the top of a hop off a ramp, one along each glide where it's over a desk,
// some under desks, the rest on open floor, each where the car can get it.
test('collect: ten paperclips, spread out, each one reachable', t => {
  noDocument(t);
  const o = furnished(11), ramps = scatterRamps({ ...o, seed: '2026-11-12' }), clips = placePickups({ ...o, seed: '2026-11-12', ramps });
  assert.equal(clips.length, 10);
  assert.deepEqual(placePickups({ ...o, seed: '2026-11-12', ramps }), clips, 'the same all day');
  for (const [i, p] of clips.entries()) {
    assert.ok(Math.hypot(p.x - o.start.x, p.z - o.start.z) > 1, `${i} away from the dock`);
    for (const q of clips.slice(i + 1)) assert.ok(Math.hypot(p.x - q.x, p.z - q.z) >= 1, `${i} apart from the others`);
  }
  const kinds = k => clips.filter(p => p.kind === k);
  assert.ok(kinds('hop').length >= 2 && kinds('under').length >= 1 && kinds('glide').length >= 1, JSON.stringify(clips.map(p => p.kind)));
  for (const p of [...kinds('floor'), ...kinds('under')]) assert.ok(p.y < 0.1 && o.map.clearance(p.x, p.z) >= R + 0.05, `on the floor with room: ${JSON.stringify(p)}`);
  for (const p of kinds('under')) assert.ok(o.map.roofed(p.x, p.z), 'under a desk');
  // On the floor, each where a car can drive to from the dock (not boxed in under a sofa), over offices and days.
  for (const office of [o, furnished(11, 5), furnished(7, 2), furnished(14, 4)]) {
    const reached = drivable(office);
    for (let day = 0; day < 8; day++) {
      const seed = `2026-11-${10 + day}`, rs = scatterRamps({ ...office, seed });
      for (const p of placePickups({ ...office, seed, ramps: rs })) if (p.y < 0.1) assert.ok(reached(p.x, p.z), `${seed} in ${office.room.width}x${office.room.depth}: ${p.kind} at ${p.x.toFixed(2)}, ${p.z.toFixed(2)} can't be driven to`);
      for (const r of rs) assert.ok(reached(r.x - Math.sin(r.yaw) * 1.2, r.z - Math.cos(r.yaw) * 1.2), `${seed} in ${office.room.width}x${office.room.depth}: can't get to the ramp at ${r.x.toFixed(2)}, ${r.z.toFixed(2)}`);
    }
  }
  // A jump off its ramp, flat out straight on, passes within reach of each one up in the air.
  for (const p of [...kinds('hop'), ...kinds('glide')]) {
    const r = ramps.find(r => r.glider === (p.kind === 'glide') && Math.hypot(r.x - p.x, r.z - p.z) < 6 && passes(r, p, o.map));
    assert.ok(r, `a jump reaches ${JSON.stringify(p)}`);
  }
});
// Where a car fits (its radius clear) and can drive to from the start, on a 5 cm grid. → reached(x, z).
function drivable({ map, room, start }) {
  const S = 0.05, cols = Math.ceil(room.width / S), rows = Math.ceil(room.depth / S), seen = new Uint8Array(cols * rows), left = room.left ?? 0, back = room.back ?? 0;
  const cell = (x, z) => Math.floor((z - back) / S) * cols + Math.floor((x - left) / S), fits = k => map.clearance(left + (k % cols + 0.5) * S, back + (Math.floor(k / cols) + 0.5) * S) >= R;
  const queue = [cell(start.x, start.z)]; seen[queue[0]] = 1;
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q], i = k % cols, j = Math.floor(k / cols);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj, n = b * cols + a; if (a >= 0 && b >= 0 && a < cols && b < rows && !seen[n] && fits(n)) { seen[n] = 1; queue.push(n); } }
  }
  return (x, z) => seen[cell(x, z)] === 1;
}
// Off `ramp` from 1.5 m before it, flat out straight on: whether the car reaches p on the way.
function passes(ramp, p, map) {
  const fx = Math.sin(ramp.yaw), fz = Math.cos(ramp.yaw), car = newCar({ x: ramp.x - fx * 1.5, z: ramp.z - fz * 1.5, yaw: ramp.yaw });
  Object.assign(car, { vx: fx * TUNE.top, vz: fz * TUNE.top, fwd: TUNE.top });
  const world = { solids: map, columns: [], ramps: [ramp] }, events = [];
  for (let t = 0; t < 6; t += STEP) {
    step(car, { throttle: 1, steer: 0, drift: false }, world, STEP, events);
    if (reaches(car, p)) return true;
    if (events.some(e => e.type === 'land')) return false;
  }
  return false;
}

// The sofa stands on legs long enough for the car to drive under it, between them.
test('the car fits under the sofa', t => {
  noDocument(t);
  const o = furnished(11);
  let couch = null; o.root.traverse(node => { if (node.userData.toggle && node.userData.once && !couch) couch = node; });
  assert.ok(couch, 'a sofa');
  const p = couch.getWorldPosition(new THREE.Vector3());
  assert.ok(o.map.clearance(p.x, p.z) >= R, `clear under its middle: ${o.map.clearance(p.x, p.z).toFixed(3)}`);
  assert.ok(drivable(o)(p.x, p.z), 'and the car can get there');
});

// Picking one up is generous: brushing past it with the car's side does, as does going over or under it by a hand.
test('a paperclip is picked up by brushing past it, over or under it', () => {
  const clip = { x: 0, y: 0.04, z: 0 }, at = (x, y, z) => ({ ...newCar({ x, z, yaw: 0 }), y });
  assert.ok(reaches(at(0, 0, 0), clip), 'through it');
  assert.ok(reaches(at(0.17, 0, 0), clip), 'its side brushing past');
  assert.ok(reaches(at(0, 0.15, 0.05), { ...clip, y: 0.04 }), 'a little over it');
  assert.ok(!reaches(at(0.32, 0, 0), clip), 'not from a car-width away');
  assert.ok(!reaches(at(0, 0.4, 0), clip), 'not from well over it');
});

// NPCs (build step 4). A field round circuit c: one car a racer ({ id, skill, personality }), from the grid's slots in order,
// all stepped together (they meet each other, and drive on once they've finished) until all have done `laps` laps or `limit` s pass. `gap(r)`: the rubber band's
// gap for racer r (default 0). → per racer { time (s) or null, stalls: [s with no progress for 4 s without a respawn] }.
function field(c, map, racers, { laps = 3, limit = 240, gap = () => 0 } = {}) {
  const world = { solids: map, columns: [], ramps: c.ramps }, L = c.length;
  const cars = racers.map((r, k) => Object.assign(newCar(c.grid[k % c.grid.length]), { id: r.id }));
  const run = racers.map((r, k) => ({ drive: createDriver({ skill: SKILL[r.skill], personality: r.personality, seed: r.id }), near: -1, last: null, done: -(L - project(c, cars[k].x, cars[k].z).s), best: -Infinity, since: 0, time: null, stalls: [] }));
  world.cars = cars;
  for (let t = 0; t < limit && run.some(r => r.time === null); t += STEP) {
    racers.forEach((r, k) => {
      const car = cars[k], me = run[k]; // finished, it drives on (stopped on the line, it'd be in everyone's way)
      const input = me.drive(car, c, world, t, { gap: gap(r), final: me.done > (laps - 1) * L });
      step(car, input, world, STEP, []);
      if (input.respawned) me.since = 0;
      const at = project(c, car.x, car.z, me.near); me.near = at.i;
      if (me.last !== null) { let d = at.s - me.last; if (d < -L / 2) d += L; if (d > L / 2) d -= L; me.done += d; }
      me.last = at.s;
      if (me.time !== null) return;
      if (me.done > me.best + 0.05) { me.best = me.done; me.since = 0; } else if ((me.since += STEP) >= 4) { me.stalls.push(t); me.since = 0; }
      if (me.done >= laps * L) me.time = t;
    });
  }
  return run.map(r => ({ time: r.time, stalls: r.stalls }));
}

test('personalities come from the session id', () => {
  assert.deepEqual(PERSONALITIES, ['steady', 'drifter', 'charger']);
  const seen = new Set(Array.from({ length: 30 }, (_, i) => personalityOf(`s${i}`)));
  assert.equal(seen.size, 3);
  assert.equal(personalityOf('abc'), personalityOf('abc'));
});

// Difficulty is how well they drive: on each circuit, the mean three-lap time of five drivers (five seeds, so five mixes of
// personality and wandering) is quickest on Hard, then Normal, then Easy.
test('harder drivers are faster', t => {
  noDocument(t);
  const o = furnished(11);
  for (const seed of SEEDS.slice(0, 2)) {
    const c = makeCircuit({ ...o, seed });
    const mean = skill => { const times = Array.from({ length: 5 }, (_, k) => field(c, o.map, [{ id: `${skill}${k}`, skill, personality: PERSONALITIES[k % 3] }])[0].time); assert.ok(times.every(v => v !== null), `${skill} finished: ${times}`); return times.reduce((a, b) => a + b, 0) / times.length; };
    const [hard, normal, easy] = ['hard', 'normal', 'easy'].map(mean);
    assert.ok(hard < normal && normal < easy, `${seed}: hard ${hard.toFixed(1)} normal ${normal.toFixed(1)} easy ${easy.toFixed(1)}`);
  }
});

// Eight cars at once, every personality and skill, bumping each other: all of them finish three laps, and none goes 4 s
// without getting anywhere (stuck, it backs out, then is put back on the line behind where it got to).
test('everyone finishes, nobody stalls', t => {
  noDocument(t);
  const o = furnished(11);
  for (const seed of SEEDS.slice(0, 3)) {
    const c = makeCircuit({ ...o, seed }), racers = Array.from({ length: 8 }, (_, k) => ({ id: `npc${k}`, skill: ['easy', 'normal', 'hard'][k % 3], personality: PERSONALITIES[(k + Math.floor(k / 3)) % 3] }));
    const results = field(c, o.map, racers);
    results.forEach((r, k) => {
      assert.ok(r.time !== null, `${seed}: ${racers[k].id} (${racers[k].skill}, ${racers[k].personality}) finished`);
      assert.deepEqual(r.stalls, [], `${seed}: ${racers[k].id} stalled at ${r.stalls.map(v => v.toFixed(1))}`);
    });
  }
});

// The rubber band: far behind you, a car's top speed (its pull) goes up to 8% over anyone's, never more; far ahead of you,
// 8% under (on Easy); level, as everyone's. Its target speeds stay within that too. On Hard a car ahead doesn't ease off at
// all, and its engine is 5% hotter throughout.
test('the rubber band pulls a car along behind you, holds it back ahead', t => {
  noDocument(t);
  const o = furnished(11), c = makeCircuit({ ...o, seed: SEEDS[0] }), world = { solids: o.map, columns: [], ramps: c.ramps, cars: [] };
  for (const [skill, gap, pull] of [['easy', 100, 1.08], ['easy', 2, 1.04], ['easy', 0, 1], ['easy', -100, 0.92], ['hard', 100, 1.08 * 1.05], ['hard', 0, 1.05], ['hard', -100, 1.05]]) {
    const drive = createDriver({ skill: SKILL[skill], personality: 'charger', seed: 'x' }), car = newCar(c.grid[0]);
    for (let t = 0; t < 10; t += STEP) {
      const input = drive(car, c, world, t, { gap });
      assert.ok(input.target <= TUNE.top * pull + 1e-9 && Math.abs(car.pull - pull) < 1e-9, `${skill}, gap ${gap}: target ${input.target}, pull ${car.pull}`);
      step(car, input, world, STEP, []);
    }
  }
});

// How hard each level is, against the autopilot (par) in a real office, alone on the track (no rubber band): Hard well ahead
// of it (the user found Hard easy), Normal about level, Easy well behind.
test('Hard laps well under par, Normal about at it, Easy well over', t => {
  noDocument(t);
  const o = furnished(11);
  for (const seed of SEEDS.slice(0, 2)) {
    const c = makeCircuit({ ...o, seed }), world = { solids: o.map, columns: [] }, par = racePar(c, world), lap = skill => racePar(c, world, SKILL[skill]) / par;
    assert.ok(lap('hard') <= 0.9, `hard ${lap('hard').toFixed(3)} of par`);
    assert.ok(Math.abs(lap('normal') - 1) <= 0.07, `normal ${lap('normal').toFixed(3)} of par`);
    assert.ok(lap('easy') >= 1.1, `easy ${lap('easy').toFixed(3)} of par`);
  }
});

// Paperclips and ramps keep clear of people (a fruit at its desk is in the car's way, as walls are): with someone standing
// on each of today's paperclips, none is within reach of anyone, and no ramp's run-up or landing crosses them.
test('paperclips and ramps keep clear of people', t => {
  noDocument(t);
  const o = furnished(11), seed = '2026-11-12', first = placePickups({ ...o, seed, ramps: scatterRamps({ ...o, seed }) });
  const columns = first.filter(p => p.y < 0.1).map(p => ({ x: p.x, z: p.z, r: 0.2 }));
  const ramps = scatterRamps({ ...o, seed, columns }), clips = placePickups({ ...o, seed, ramps, columns });
  for (const p of clips) for (const c of columns) assert.ok(Math.hypot(p.x - c.x, p.z - c.z) >= c.r + 0.2, `a paperclip ${Math.hypot(p.x - c.x, p.z - c.z).toFixed(2)} m from someone`);
  for (const r of ramps.filter(r => !r.glider)) for (const c of columns) for (let u = -1.2; u <= 2.3; u += 0.1) {
    const x = r.x + Math.sin(r.yaw) * u, z = r.z + Math.cos(r.yaw) * u;
    assert.ok(Math.hypot(x - c.x, z - c.z) >= c.r + R, `a ramp's way crosses someone at ${u.toFixed(1)}`);
  }
});

// Glider ramps go anywhere with room to fly, not only before desks: an empty room gets them too.
test('glider ramps anywhere there is room to fly', () => {
  const o = office(14, 10, 0), gliders = scatterRamps({ ...o, seed: '2026-11-12' }).filter(r => r.glider);
  assert.ok(gliders.length >= 2, `${gliders.length} in an empty room`);
});
