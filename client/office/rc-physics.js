// The RC car's rules, pure (no document, no window), so Node can drive it: how it drives (`step`), and what it can hit,
// from the room's own triangles (`floorMap`). rc.js draws it and takes the controls; rc-course.js lays circuits and drives NPCs.
import * as THREE from 'three';

// Speeds here are as the driver feels them, in m/s of a car its own size; `pace` is how much of the office that covers: lower
// and the office is bigger and the drive longer, with the handling the same.
export const TUNE = {
  pace: 0.4,
  engine: 7, top: 5.2, reverse: 2.2, brake: 10, coast: 1.6, // m/s², m/s
  turn: 2.8, turnPeak: 2.2, turnFade: 0.15, // rad/s at full lock; quickest from this speed; less by this much per m/s past it
  steerIn: 7, steerOut: 12, // how fast the wheels go to lock and come back (full lock per second)
  grip: 16, letGo: 1.4, driftGrip: 3, driftTurn: 1.2, driftDrag: 0.25, driftKeep: 0.8, // sideways slide dies at grip/s; tyres give past letGo m/s of slide; of the slide a drift's tyres take off, back as speed on
  boost: 3.5, boostTop: 2.5, boostFull: 0.9, boostTime: 1.2, // m/s² and extra top speed; seconds of slide for a full charge; its length
  bounce: 0.3, scrape: 0.9, kick: 3, loose: 0.35, // of the speed into a wall kept; of the speed along it kept; how much a glancing knock turns it; seconds the tyres slide after one
  spinGrip: 12, // how fast its turning settles to what the wheels want
  offTop: 0.6, offDrag: 1.2, // off the road: of top speed; how much faster it slows to that, running off at speed (per second)
  kerbTurn: 0.5, // of the way a kerb turns a car pressed against it to run along it, each step it touches
  // In the air (office m/s², m/s, as y is): gravity, tuned by eye (real gravity looks too quick at this scale); of the steering
  // it has in a hop; of gravity on the paper wing, and the fastest it sinks on it; seconds of boost for a trick landed straight;
  // the kick up off a small ramp's lip and off a glider ramp's (a ramp's slope alone throws a car this size hardly a hand high).
  gravity: 6, airSteer: 0.35, glide: 0.1, sink: 0.8, trickBoost: 0.6, hopLift: 1.4, glideLift: 2.9,
  // Slipstream: within draft (m, office) behind another car, near its line and pointing its way: top speed and engine times these.
  draft: 0.5, draftTop: 1.08, draftEngine: 1.25,
};
globalThis.rcTune = TUNE;
// The car's built 36 cm long and drawn at SIZE of that: about 1:25, a kart. R: its collision radius; TOP_Y: what's lower than
// that it hits; STEP: the physics step (s).
export const SIZE = 0.5, R = 0.15 * SIZE, TOP_Y = 0.16 * SIZE, STEP = 1 / 120;

// A car at rest, facing yaw (forward is (sin yaw, cos yaw)). Velocities are felt (TUNE), but for vy (office m/s); `pull`: its top
// speed's share (an NPC's rubber band moves it); `air` is null
// on the ground, else { since (s), trick, glider (off a glider ramp), glide (its wing out) }; `on`: the ramp it's on.
export const newCar = ({ x, z, yaw }) => ({ x, y: 0, z, yaw, vx: 0, vy: 0, vz: 0, spin: 0, steer: 0, charge: 0, boost: 0, loose: 0, fwd: 0, side: 0, air: null, driftSide: 0, held: false, on: null, draft: false, pull: 1 });
// Off the ground when it's this far (m) over it; a ramp's edge this much higher than the car is a wall, not a slope (so only a
// tall side, near the lip: onto the rest from the side, it climbs). A car is on a ramp to EDGE (m) past its sides: half on
// (its middle just off, its inner wheels on) counts.
const LEAVE = 0.015, CLIMB = 0.06, EDGE = 0.06;
// The ground under (x, z) for a car at height y: the highest of world.ramps there (each a wedge `w` wide and `l` long round
// (x, z), rising the way yaw faces to `h` at its lip), a top it's above (a desk's, from the floor map), or the floor.
// → { y, ramp }.
export function groundAt(world, x, z, y) {
  let best = 0, on = null;
  for (const r of world.ramps || []) {
    const dx = x - r.x, dz = z - r.z, fx = Math.sin(r.yaw), fz = Math.cos(r.yaw), u = dx * fx + dz * fz, v = dz * fx - dx * fz;
    if (Math.abs(v) <= r.w / 2 + EDGE && Math.abs(u) <= r.l / 2) { const h = r.h * (u / r.l + 0.5); if (h > best) { best = h; on = r; } }
  }
  const top = world.solids.top?.(x, z) ?? 0;
  if (top > best && top <= y + 0.03) { best = top; on = null; }
  return { y: best, ramp: on };
}

// One physics step of `c` (newCar's shape); input: { throttle -1..1, steer -1..1 (right +), drift }.
// Forward is (sin yaw, cos yaw), as the player's; right is (-fz, fx). Turning right lowers yaw. Velocities are felt (TUNE);
// x and z move by them times `pace`.
// world: { solids, columns: [{ id, x, z, r }], ramps?, cars? (every car racing, this one too, each with an id), rails?(c) →
// { nx, nz, depth } | null }, where `solids.each(x, z, r, fn, y)` calls fn(x0, z0, x1, z1) for each solid
// square at height y within r of (x, z) (and `solids.top(x, z)`, if it has one, is the height of a top there). events gets
// { type: 'bump', speed, id? (a person), car? (a car's id) }, { type: 'boost' }, { type: 'takeoff', glide }, { type: 'unfold' } and
// { type: 'land', trick: 'clean' | 'crooked' | null, fall (m/s) }.
export function step(c, input, world, h, events) {
  const T = TUNE;
  const want = input.steer, rate = Math.abs(want) > Math.abs(c.steer) && Math.sign(want) === Math.sign(c.steer || want) ? T.steerIn : T.steerOut;
  c.steer += Math.max(-rate * h, Math.min(rate * h, want - c.steer));
  const pressed = input.drift && !c.held; c.held = input.drift;
  if (c.air) fly(c, pressed, h, events); else roll(c, input, world, h, events);
  const knock = knocks(c, events);
  collide(c, world, knock, events);
  settle(c, world, h, events, knock);
}

// On the ground: the engine, brakes, grip, drift and steering, and it moves.
function roll(c, input, world, h, events) {
  const T = TUNE, fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), rx = -fz, rz = fx;
  let fwd = c.vx * fx + c.vz * fz, side = c.vx * rx + c.vz * rz;

  // Off the road (world.surface says, where there's a circuit) it's slower; in another car's slipstream, quicker.
  const road = !world.surface || world.surface(c.x, c.z).road;
  c.draft = (world.cars || []).some(o => {
    if (o === c || o.air) return false;
    const ox = Math.sin(o.yaw), oz = Math.cos(o.yaw), dx = o.x - c.x, dz = o.z - c.z, ahead = dx * ox + dz * oz;
    return ahead > 0 && ahead < T.draft && Math.abs(dz * ox - dx * oz) < 0.12 && ox * fx + oz * fz > Math.cos(15 * Math.PI / 180);
  });
  const boosting = c.boost > 0, top = (T.top * (c.pull ?? 1) * (c.draft ? T.draftTop : 1) + (boosting ? T.boostTop : 0)) * (road ? 1 : T.offTop), thr = input.throttle;
  if (thr > 0) fwd += (fwd < -0.1 ? T.brake : T.engine * (c.draft ? T.draftEngine : 1) * Math.max(0, 1 - fwd / top)) * thr * h;
  else if (thr < 0) fwd += fwd > 0.3 ? -T.brake * -thr * h : -T.engine * 0.7 * Math.max(0, 1 + fwd / T.reverse) * -thr * h;
  else fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), T.coast * h);
  if (boosting) { fwd += T.boost * h; c.boost -= h; }
  if (fwd > top) fwd -= (fwd - top) * (road ? 3 : 3 + T.offDrag) * h;

  const drifting = input.drift && Math.abs(fwd) > 1;
  // A drift keeps the side it started on, as in Mario Kart: steering into it tightens it, away from it widens it (to a fifth),
  // never past straight. Let go and press again to drift the other way.
  if (!input.drift) c.driftSide = 0; else if (!c.driftSide && input.steer) c.driftSide = Math.sign(input.steer);
  const wheel = drifting && c.driftSide ? c.driftSide * (0.6 + 0.4 * c.driftSide * c.steer) : c.steer;
  if (drifting) fwd *= Math.exp(-T.driftDrag * h);
  // Grip: the sideways slide dies out quickly, less so the more it slides (the tyres let go), and hardly at all in a drift.
  // After a knock they slide a moment too, so it carries on along what it hit while it turns to follow it.
  const grip = drifting || c.loose > 0 ? T.driftGrip : T.grip / (1 + 1.5 * (side / T.letGo) ** 2);
  c.loose -= h;
  const slid = side; side *= Math.exp(-grip * h);
  // In a drift most of the slide the tyres take off comes back as speed on (driftKeep): it swings round a corner at speed.
  if (drifting && fwd > 0) fwd = Math.min(Math.max(fwd, top), fwd + Math.abs(slid - side) * T.driftKeep);

  // A slide held with the drift button charges a boost; let go of it to fire.
  if (drifting && Math.abs(side) > 0.3 && fwd > 1.5) c.charge = Math.min(T.boostFull, c.charge + h);
  else if (!input.drift && c.charge > 0) { if (c.charge > 0.3) { c.boost = T.boostTime * c.charge / T.boostFull; events.push({ type: 'boost' }); } c.charge = 0; }

  // Steering: none standing still, quickest about turnPeak, a little less flat out (but in a drift); backwards it's the other way round.
  const speed = Math.abs(fwd), feel = Math.min(1, speed / T.turnPeak) / (drifting ? 1 : 1 + Math.max(0, speed - T.turnPeak) * T.turnFade);
  const aim = -wheel * T.turn * feel * Math.sign(fwd || 1) * (drifting ? T.driftTurn : 1);
  c.spin += (aim - c.spin) * (1 - Math.exp(-T.spinGrip * h));

  c.vx = fx * fwd + rx * side; c.vz = fz * fwd + rz * side;
  c.yaw += c.spin * h; c.x += c.vx * h * T.pace; c.z += c.vz * h * T.pace;
  c.fwd = fwd; c.side = side;
}

// In the air: no grip and no throttle; it falls, and steers a little (airSteer). Off a glider ramp the wing unfolds at the top of
// the arc: it falls at `glide` of gravity and steers fully, its way turning with it, as a plane's. Drift pressed (`pressed`)
// within 0.3 s of leaving a small ramp is a trick.
function fly(c, pressed, h, events) {
  const T = TUNE, a = c.air;
  a.since += h;
  if (pressed && !a.glider && a.since <= 0.3) a.trick = true;
  c.vy -= T.gravity * (a.glide ? T.glide : 1) * h;
  if (a.glide) c.vy = Math.max(c.vy, -T.sink);
  if (a.glider && !a.glide && c.vy <= 0) { a.glide = true; events.push({ type: 'unfold' }); }
  const aim = -c.steer * T.turn * 0.7 * (a.glide ? 1 : T.airSteer);
  c.spin += (aim - c.spin) * (1 - Math.exp(-T.spinGrip * h));
  c.yaw += c.spin * h;
  if (a.glide) { const sp = Math.hypot(c.vx, c.vz); c.vx = Math.sin(c.yaw) * sp; c.vz = Math.cos(c.yaw) * sp; }
  if (c.boost > 0) c.boost -= h;
  c.x += c.vx * h * T.pace; c.z += c.vz * h * T.pace; c.y += c.vy * h;
  const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
  c.fwd = c.vx * fx + c.vz * fz; c.side = c.vz * fx - c.vx * fz;
}

// Knocks: off what's solid at its height, keeping most of the speed along it, and turned to run along it when it comes in at an
// angle. → knock(nx, nz, depth, id): pushed out along (nx, nz) by depth.
function knocks(c, events) {
  const T = TUNE;
  return (nx, nz, depth, id) => {
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    c.x += nx * depth; c.z += nz * depth;
    const into = c.vx * nx + c.vz * nz; if (into >= 0) return;
    const tx = c.vx - into * nx, tz = c.vz - into * nz;
    // A knock costs some of the speed along it; resting against it (each step it's still touching) costs none.
    const keep = -into > 0.5 ? T.scrape : 1;
    c.vx = tx * keep - into * T.bounce * nx; c.vz = tz * keep - into * T.bounce * nz;
    c.spin += T.kick * (fz * nx - fx * nz) * -into; c.loose = T.loose;
    events.push({ type: 'bump', speed: -into, id });
  };
}

// A circle against the floor map's squares at its height, people, and (low enough) the kerbs. On a top (a desk) it meets the
// layer over the top's own edge, so the top's outline doesn't fence it in.
function collide(c, world, knock, events) {
  const T = TUNE, { solids, columns } = world;
  solids.each(c.x, c.z, R, (x0, z0, x1, z1) => {
    const px = Math.max(x0, Math.min(c.x, x1)), pz = Math.max(z0, Math.min(c.z, z1)), dx = c.x - px, dz = c.z - pz, d2 = dx * dx + dz * dz;
    if (d2 >= R * R) return;
    if (d2 > 1e-10) { const d = Math.sqrt(d2); knock(dx / d, dz / d, R - d); return; }
    const out = [[c.x - x0, -1, 0], [x1 - c.x, 1, 0], [c.z - z0, 0, -1], [z1 - c.z, 0, 1]].sort((p, q) => p[0] - q[0])[0];
    knock(out[1], out[2], out[0] + R);
  }, c.y + (c.y > 0.2 ? 0.04 : 0));
  for (const p of columns) {
    const dx = c.x - p.x, dz = c.z - p.z, d = Math.hypot(dx, dz), r = R + p.r;
    if (d < r && d > 1e-6) knock(dx / d, dz / d, r - d, p.id);
  }
  // Other cars, at its height: out of the overlap, and half the closing speed's bounce each (equal mass; the other takes its
  // half on its own step).
  for (const o of world.cars || []) {
    if (o === c || Math.abs(o.y - c.y) > 0.06) continue;
    const dx = c.x - o.x, dz = c.z - o.z, d = Math.hypot(dx, dz);
    if (d >= 2 * R || d < 1e-6) continue;
    const nx = dx / d, nz = dz / d, into = (c.vx - o.vx) * nx + (c.vz - o.vz) * nz;
    c.x += nx * (2 * R - d); c.z += nz * (2 * R - d);
    if (into < 0) { const j = -into * (1 + T.bounce) / 2; c.vx += nx * j; c.vz += nz * j; c.loose = T.loose; events.push({ type: 'bump', speed: -into, car: o.id }); }
  }
  // Kerbs (world.rails, where there's a circuit): pressed past one, back onto the track, glancing off it as off a wall, and
  // turned KERB_TURN of the way to run along it (a kerb steers you on round; it doesn't hold you against it). Over them, none.
  const kerb = c.y < 0.03 ? world.rails?.(c) : null;
  if (kerb?.depth > 0) {
    knock(kerb.nx, kerb.nz, kerb.depth);
    const tx = -kerb.nz, tz = kerb.nx, along = Math.sin(c.yaw) * tx + Math.cos(c.yaw) * tz >= 0 ? 1 : -1;
    let d = Math.atan2(tx * along, tz * along) - c.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    c.yaw += d * T.kerbTurn; c.spin *= 1 - T.kerbTurn;
  }
}

// After it's moved: on the ground it follows it (up a ramp, onto a top), or is knocked off a ramp's side or lip as off a wall;
// over it by LEAVE, it's off into the air (off a ramp's lip, kicked up: hopLift, or glideLift off a glider ramp); in the air,
// down on it, it lands, and a trick landed straight (within 15° of the way it's going) boosts.
function settle(c, world, h, events, knock) {
  const T = TUNE;
  let g = groundAt(world, c.x, c.z, c.y);
  if (!c.air && g.ramp && g.y > c.y + CLIMB) {
    const r = g.ramp, fx = Math.sin(r.yaw), fz = Math.cos(r.yaw), dx = c.x - r.x, dz = c.z - r.z, u = dx * fx + dz * fz, v = dz * fx - dx * fz;
    const su = r.l / 2 - Math.abs(u), sv = r.w / 2 + EDGE - Math.abs(v), s = sv < su ? Math.sign(v) : Math.sign(u);
    if (sv < su) knock(-fz * s, fx * s, sv + 0.002); else knock(fx * s, fz * s, su + 0.002);
    g = groundAt(world, c.x, c.z, c.y);
  }
  if (c.air) {
    if (c.y > g.y) return;
    const a = c.air, sp = Math.hypot(c.vx, c.vz), straight = sp < 0.5 || (c.vx * Math.sin(c.yaw) + c.vz * Math.cos(c.yaw)) / sp >= Math.cos(15 * Math.PI / 180);
    const trick = a.trick ? straight ? 'clean' : 'crooked' : null;
    if (trick === 'clean') c.boost = Math.max(c.boost, T.trickBoost);
    events.push({ type: 'land', trick, fall: -c.vy });
    c.y = g.y; c.vy = 0; c.air = null; c.on = g.ramp;
    return;
  }
  if (c.y - g.y > LEAVE) {
    const r = c.on, lip = r && (c.x - r.x) * Math.sin(r.yaw) + (c.z - r.z) * Math.cos(r.yaw) >= r.l / 2 - 0.01;
    if (lip) c.vy += r.glider ? T.glideLift : T.hopLift;
    c.air = { since: 0, trick: false, glider: !!(lip && r.glider), glide: false }; c.on = null;
    events.push({ type: 'takeoff', glide: c.air.glider });
    return;
  }
  c.vy = (g.y - c.y) / h; c.y = g.y; c.on = g.ramp;
}

// What's solid round the floor, for the car and its view only: from the room's own triangles, not the walking boxes (where a
// desk is one block from the floor to its top; here it's its legs, tower and bin, so the car goes under it). Heights are cut
// into LAYERS (the first is the car's, above the rugs); each triangle's slice of a layer is drawn into CELL squares as lines,
// so a solid comes out as its outline, which is all a car moving a fraction of a cell a step can meet. Flat triangles are left
// out (floors, rugs, shadows, tops), as are outlines' hulls and instanced things (the games room's bulbs, the kitchen's pans).
// ponytail: rebuilt whole when the room changes (tens of ms), a moving door is caught where it was; per-region rebuilds if that shows.
// Also, for laying circuits: `clearance(x, z)`, metres from there to the nearest solid square at the car's height (a chamfer
// distance over that layer), and `roofed(x, z)`, whether something's flat underside hangs over it between ROOF's heights (a
// desk, a chair's seat): the flat triangles facing down there, filled in. And for a car coming down on one, `top(x, z)`: the
// highest flat top there between those heights (the flat triangles facing up), or 0. A layer starts at 0.77, just over a
// desk's top (0.75), so a car on a desk meets what's on it, not the desk's own edge.
const CELL = 0.025, LAYERS = [0.018, 0.08, 0.2, 0.45, 0.77, 0.9, 1.5, 3], ROOF = [0.3, 1.2];
export function floorMap(root) {
  const lo = LAYERS[0], hi = LAYERS.at(-1), box = new THREE.Box3(), meshes = [];
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  root.updateMatrixWorld(true);
  root.traverseVisible(node => {
    if (!node.isMesh || node.isInstancedMesh || node.userData.outline) return;
    const g = node.geometry; if (!g.boundingBox) g.computeBoundingBox();
    box.copy(g.boundingBox).applyMatrix4(node.matrixWorld); if (box.min.y > hi || box.max.y < lo) return;
    meshes.push(node); x0 = Math.min(x0, box.min.x); z0 = Math.min(z0, box.min.z); x1 = Math.max(x1, box.max.x); z1 = Math.max(z1, box.max.z);
  });
  if (!meshes.length) return null;
  const nx = Math.ceil((x1 - x0) / CELL) + 1, nz = Math.ceil((z1 - z0) / CELL) + 1, plane = nx * nz, cells = new Uint8Array(plane * (LAYERS.length - 1));
  const roof = new Uint8Array(plane), tops = new Float32Array(plane);
  const mark = (l, x, z) => { const ix = Math.floor((x - x0) / CELL), iz = Math.floor((z - z0) / CELL); if (ix >= 0 && iz >= 0 && ix < nx && iz < nz) cells[l * plane + iz * nx + ix] = 1; };
  const line = (l, ax, az, bx, bz) => { const n = Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL / 2)) + 1; for (let s = 0; s <= n; s++) mark(l, ax + (bx - ax) * s / n, az + (bz - az) * s / n); };
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], pts = [];
  const cover = ([a, b, c]) => {
    const facing = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z), y = a.y; // < 0: faces down, an underside; > 0: a top
    if (facing === 0) return;
    const side = (px, pz, p, q) => (q.x - p.x) * (pz - p.z) - (q.z - p.z) * (px - p.x);
    const ax = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - x0) / CELL)), bx = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x, c.x) - x0) / CELL));
    const az = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - z0) / CELL)), bz = Math.min(nz - 1, Math.floor((Math.max(a.z, b.z, c.z) - z0) / CELL));
    for (let iz = az; iz <= bz; iz++) for (let ix = ax; ix <= bx; ix++) {
      const px = x0 + (ix + 0.5) * CELL, pz = z0 + (iz + 0.5) * CELL, d1 = side(px, pz, a, b), d2 = side(px, pz, b, c), d3 = side(px, pz, c, a);
      if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue;
      const k = iz * nx + ix; if (facing < 0) roof[k] = 1; else tops[k] = Math.max(tops[k], y);
    }
  };
  for (const node of meshes) {
    const pos = node.geometry.attributes.position, index = node.geometry.index, n = index ? index.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, index ? index.getX(i + k) : i + k).applyMatrix4(node.matrixWorld);
      const bottom = Math.min(v[0].y, v[1].y, v[2].y), top = Math.max(v[0].y, v[1].y, v[2].y);
      if (top - bottom < 0.002) { if (top >= ROOF[0] && top <= ROOF[1]) cover(v); continue; }
      if (top < lo || bottom > hi) continue;
      for (let l = 0; l < LAYERS.length - 1; l++) {
        const y0 = LAYERS[l], y1 = LAYERS[l + 1]; if (top < y0 || bottom > y1) continue;
        // The triangle cut to the layer: its corners inside, and where its edges cross the layer's floor and ceiling.
        pts.length = 0;
        for (let k = 0; k < 3; k++) {
          const a = v[k], b = v[(k + 1) % 3];
          if (a.y >= y0 && a.y <= y1) pts.push(a.x, a.z);
          for (const y of [y0, y1]) if ((a.y - y) * (b.y - y) < 0) { const t = (y - a.y) / (b.y - a.y); pts.push(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t); }
        }
        for (let p = 0; p < pts.length; p += 2) for (let q = p + 2; q < pts.length; q += 2) line(l, pts[p], pts[p + 1], pts[q], pts[q + 1]);
        if (pts.length === 2) mark(l, pts[0], pts[1]);
      }
    }
  }
  // Distance, in cells, from each cell to the nearest solid one at the car's height: two passes, each looking at the four
  // neighbours already done (1 straight, √2 diagonal).
  const far = new Float32Array(plane), D = Math.SQRT2;
  for (let k = 0; k < plane; k++) far[k] = cells[k] ? 0 : 1e9;
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const k = iz * nx + ix; let d = far[k];
    if (ix > 0) d = Math.min(d, far[k - 1] + 1);
    if (iz > 0) { d = Math.min(d, far[k - nx] + 1); if (ix > 0) d = Math.min(d, far[k - nx - 1] + D); if (ix < nx - 1) d = Math.min(d, far[k - nx + 1] + D); }
    far[k] = d;
  }
  for (let iz = nz - 1; iz >= 0; iz--) for (let ix = nx - 1; ix >= 0; ix--) {
    const k = iz * nx + ix; let d = far[k];
    if (ix < nx - 1) d = Math.min(d, far[k + 1] + 1);
    if (iz < nz - 1) { d = Math.min(d, far[k + nx] + 1); if (ix < nx - 1) d = Math.min(d, far[k + nx + 1] + D); if (ix > 0) d = Math.min(d, far[k + nx - 1] + D); }
    far[k] = d;
  }
  const cell = (x, z) => { const ix = Math.floor((x - x0) / CELL), iz = Math.floor((z - z0) / CELL); return ix >= 0 && iz >= 0 && ix < nx && iz < nz ? iz * nx + ix : -1; };
  const layer = y => LAYERS.findIndex((v, i) => y >= v && y < LAYERS[i + 1]);
  const at = (l, ix, iz) => ix >= 0 && iz >= 0 && ix < nx && iz < nz && cells[l * plane + iz * nx + ix] === 1;
  return {
    each(x, z, r, fn, y = 0) {
      const l = layer(y + 0.02), ax = Math.floor((x - r - x0) / CELL), bx = Math.floor((x + r - x0) / CELL), az = Math.floor((z - r - z0) / CELL), bz = Math.floor((z + r - z0) / CELL);
      for (let iz = az; iz <= bz; iz++) for (let ix = ax; ix <= bx; ix++) if (l >= 0 && at(l, ix, iz)) fn(x0 + ix * CELL, z0 + iz * CELL, x0 + (ix + 1) * CELL, z0 + (iz + 1) * CELL);
    },
    // From the middle of its square to the nearest edge of a solid one, so a little under; none outside the map.
    clearance(x, z) { const k = cell(x, z); return k < 0 ? 0 : Math.max(0, (far[k] - 0.5) * CELL); },
    roofed(x, z) { const k = cell(x, z); return k >= 0 && roof[k] === 1; },
    top(x, z) { const k = cell(x, z); return k < 0 ? 0 : tops[k]; },
    // Clear for the view: nothing solid in its layer within a cell of it.
    open(p) {
      if (p.y >= hi - 0.08) return false; if (p.y < lo) return true;
      const l = layer(p.y), ix = Math.floor((p.x - x0) / CELL), iz = Math.floor((p.z - z0) / CELL);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (at(l, ix + dx, iz + dz)) return false;
      return true;
    },
  };
}
