import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as kit from '../kit.js';

// A steam plant standing on a dark floor. You are the boiler in the middle, every account's usage on the gauge board in front of it.
// Projects are junctions, sessions are machines branching off them, subagents valves beside their machine; each kind its own size
// and outline from afar: a junction is a round crowned manifold, the biggest body in its cluster, with a black and gold name; a
// machine is square-shouldered with a brass plate; a valve is a little handwheel with no plate. Each junction and machine is built
// from its id (body, cylinders, stack, gauges, trim), so it looks the same on every device and differs from its neighbours; on every
// machine the gas lamp is its state, the big gauge its pressure, the sight glass its context and the brass pips its plan, and its
// nameplate carries its name and what it's doing. Pipes are plumbing on the floor (straight runs, 45°/90° elbows, flanges): tool
// calls are steam pulses machine → junction → boiler, needs-you runs gold along the same route.

const TAU = Math.PI * 2, PI = Math.PI, HP = Math.PI / 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S3 = new THREE.Vector3();
function place(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) { return g.applyMatrix4(M4.compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S3.set(sx, sy, sz))); }
const KEEP = ['position', 'normal', 'uv'];
function tidy(g) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (!KEEP.includes(k)) n.deleteAttribute(k);
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  n.clearGroups(); return n;
}
function merge(list) { const out = mergeGeometries(list.map(tidy)); list.forEach(g => g.dispose()); return out; }
const many = list => { const g = mergeGeometries(list); list.forEach(x => x.dispose()); return g; };
const cyl = (rt, rb = rt, h = 1, seg = 20, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const ball = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
const hemi = (r, w = 24, h = 8) => new THREE.SphereGeometry(r, w, h, 0, TAU, 0, HP);
const torus = (R, r, rs = 8, ts = 36, arc = TAU) => new THREE.TorusGeometry(R, r, rs, ts, arc);
const flat = g => g.rotateX(HP);                      // torus from the XY plane onto the floor
const oct = (r0, r1, h, y) => place(cyl(r0, r1, h, 8), 0, y, 0, 0, PI / 8);   // octagon, flat sides facing every 45° from +x
// A flat bar in XZ from (x0, z0) to (x1, z1).
function bar(x0, z0, x1, z1, w, h = .05, y = 0) { const L = Math.hypot(x1 - x0, z1 - z0); return place(box(L, h, w), (x0 + x1) / 2, y, (z0 + z1) / 2, 0, -Math.atan2(z1 - z0, x1 - x0), 0); }
function octPts(r, perEdge) { const pts = []; for (let k = 0; k < 8; k++) { const a = PI / 8 + k * PI / 4, b = a + PI / 4; for (let j = 0; j < perEdge; j++) { const f = (j + .5) / perEdge; pts.push([Math.cos(a) * r * (1 - f) + Math.cos(b) * r * f, Math.sin(a) * r * (1 - f) + Math.sin(b) * r * f]); } } return pts; }
function segDist(px, pz, ax, az, bx, bz) { const vx = bx - ax, vz = bz - az, l = vx * vx + vz * vz, t = l ? clamp(((px - ax) * vx + (pz - az) * vz) / l, 0, 1) : 0; return Math.hypot(px - ax - vx * t, pz - az - vz * t); }
function solve2(px, pz, qx, qz, wx, wz) { const d = px * qz - pz * qx; return Math.abs(d) < 1e-6 ? null : [(wx * qz - wz * qx) / d, (px * wz - pz * wx) / d]; }
// Does the segment a→b cross the rectangle [x0, x1] × [z0, z1]? (slab test; scalars only, the layout calls it a great deal)
function segRect(ax, az, bx, bz, x0, x1, z0, z1) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  if (Math.abs(dx) < 1e-9) { if (ax < x0 || ax > x1) return false; }
  else { const u = (x0 - ax) / dx, v = (x1 - ax) / dx; t0 = Math.max(t0, Math.min(u, v)); t1 = Math.min(t1, Math.max(u, v)); if (t0 > t1) return false; }
  if (Math.abs(dz) < 1e-9) { if (az < z0 || az > z1) return false; }
  else { const u = (z0 - az) / dz, v = (z1 - az) / dz; t0 = Math.max(t0, Math.min(u, v)); t1 = Math.min(t1, Math.max(u, v)); if (t0 > t1) return false; }
  return true;
}

// ── Painted parts. A machine body is one geometry: every vertex carries its metal (colour, metalness, roughness, how much it glows with
// the fire), so all bodies on the floor are one batched draw, each machine an instance placed and tinted by state. ──
const METAL = {
  shell: ['#ffffff', 1, .3], iron: ['#47413a', .7, .55], plate: ['#2f2b27', .65, .6], green: ['#2f4a3b', .55, .5], gun: ['#5a544e', .9, .42],
  brass: ['#c99a4a', 1, .38], copper: ['#c8754a', 1, .38], nickel: ['#b9bec4', 1, .36], black: ['#17130f', .5, .45],
  verdigris: ['#5c9a84', .2, .8], red: ['#9a2a1c', .55, .38], glass: ['#0e1311', .3, .08], fire: ['#2a1206', 0, .9, 1], warm: ['#c8754a', 1, .32, .05],
  tread: ['#35302b', .55, .55, -1],   // diamond plate: the shader draws the lozenges
};
const PAINT = new THREE.Color();
function paint(g, metal, tint) {
  const [hex, m, r, f = 0] = METAL[metal], c = PAINT.set(tint || hex), n = g.attributes.position.count;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.index) { const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
  const col = new Float32Array(n * 3), mr = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; mr[i] = m; mr[i + 1] = r; mr[i + 2] = f; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aMR', new THREE.BufferAttribute(mr, 3)); g.clearGroups();
  return g;
}
function parts() {
  const list = [];
  return { add(g, metal, tint) { list.push(paint(g, metal, tint)); }, done() { const g = mergeGeometries(list); list.forEach(x => x.dispose()); g.computeBoundingSphere(); return g; } };
}
const rivet = r => hemi(r, 6, 2).scale(1, .6, 1);
// Rivet heads round a vertical cylinder (heads out), round one lying along x, or standing up on a circle.
const ringY = (n, R, y, r, cx = 0, cz = 0) => Array.from({ length: n }, (_, i) => { const a = i / n * TAU; return place(rivet(r), cx + Math.cos(a) * R, y, cz + Math.sin(a) * R, 0, -a, -HP); });
const ringX = (n, R, x, r, cy, cz) => Array.from({ length: n }, (_, i) => { const a = i / n * TAU; return place(rivet(r), x, cy + Math.sin(a) * R, cz + Math.cos(a) * R, HP - a); });
const ringUp = (n, R, y, r, cx = 0, cz = 0) => Array.from({ length: n }, (_, i) => { const a = (i + .5) / n * TAU; return place(rivet(r), cx + Math.cos(a) * R, y, cz + Math.sin(a) * R); });
// A gauge's case with its face at (x, y, z), tilted back by t towards the camera (the dial and needle are instanced on top), on a post down to `floor`.
function gaugeCase(b, x, y, z, r, t, metal, floor = null) {
  const ny = Math.cos(t), nz = Math.sin(t), by = y - ny * .07, bz = z - nz * .07;
  b.add(place(cyl(r + .025, r + .01, .07, 24), x, y - ny * .035, z - nz * .035, t), 'black');
  b.add(place(flat(torus(r + .012, .012 + r * .06, 6, 28)), x, y + ny * .004, z + nz * .004, t), metal);
  if (floor !== null && by > floor + .01) b.add(place(cyl(.022, .03, by - floor, 8), x, (by + floor) / 2, bz), metal);
  return { x, y, z, r, t };
}
// A brass stand for a filament tube or an indicator bulb: post and socket cup. Returns where the tube stands.
function lampPost(b, x, y, z, h, metal) {
  if (h > .01) b.add(place(cyl(.018, .026, h, 6), x, y + h / 2, z), metal);
  b.add(place(cyl(.06, .07, .03, 12), x, y + h + .015, z), metal);
  return [x, y + h + .03, z];
}
// A curve round a rectangle with rounded corners, in XZ at height y: the televisor's bent brass frame.
class RoundRect extends THREE.Curve {
  constructor(a, b, r, y) { super(); Object.assign(this, { a, b, r, y }); this.L = 4 * (a + b - 2 * r) + TAU * r; }
  getPoint(t, o = new THREE.Vector3()) {
    const { a, b, r, y, L } = this, q = HP * r, arc = (cx, cz, an) => o.set(cx + Math.cos(an) * r, y, cz + Math.sin(an) * r);
    const segs = [[2 * (a - r), u => o.set(-a + r + u, y, -b)], [q, u => arc(a - r, -b + r, -HP + u / r)], [2 * (b - r), u => o.set(a, y, -b + r + u)], [q, u => arc(a - r, b - r, u / r)],
      [2 * (a - r), u => o.set(a - r - u, y, b)], [q, u => arc(-a + r, b - r, HP + u / r)], [2 * (b - r), u => o.set(-a, y, b - r - u)], [q, u => arc(-a + r, -b + r, PI + u / r)]];
    let d = (t % 1) * L;
    for (const [len, f] of segs) { if (d <= len) return f(d); d -= len; }
    return o.set(-a + r, y, -b);
  }
}
function handwheel(b, x, y, z, r, metal, stem = 0, stemMetal = 'brass') {
  if (stem) b.add(place(cyl(.018, .024, stem, 6), x, y + stem / 2, z), stemMetal);
  const yy = y + stem;
  b.add(place(flat(torus(r, r * .15, 5, 16)), x, yy, z), metal);
  b.add(bar(x - r, z, x + r, z, r * .18, r * .14, yy), metal); b.add(bar(x, z - r, x, z + r, r * .18, r * .14, yy), metal);
}
class Helix extends THREE.Curve {
  constructor(cx, cz, R, y0, y1, turns) { super(); Object.assign(this, { cx, cz, R, y0, y1, turns }); }
  getPoint(t, o = new THREE.Vector3()) { const a = t * this.turns * TAU; return o.set(this.cx + Math.cos(a) * this.R, this.y0 + (this.y1 - this.y0) * t, this.cz + Math.sin(a) * this.R); }
}

// ── Sizes. Pipes leave octagonal bodies by their faces: tier 1 junction → boiler, 2 machine → junction, 3 subagent → machine.
// A session is a station: its machine (modelled at radius UR, drawn US times larger) MZ behind the node, its nameplate in front.
// A project is a manifold hub (radius JR, drawn JS times larger): wider and taller than any machine, so each cluster has a plain centre.
// A subagent's valve is modelled small and drawn KS times larger: big enough to see, plainly a fitting off its machine. ──
const UR = .95, US = 1.5, AU = UR * Math.cos(PI / 8), JR = 2.05, JS = 1, JA = JR * JS * Math.cos(PI / 8), BR = 4.5, AB = BR * Math.cos(PI / 8), KS = 2, AK = .2 * KS * Math.cos(PI / 8);
const Y0 = .14, MZ = -1;
const TIER_R = [0, .16, .075, .04], PY = 1.25;
const FD = Array.from({ length: 8 }, (_, k) => [Math.cos(k * PI / 4), Math.sin(k * PI / 4)]);
const PROV = { claude: '#c4703f', codex: '#56668c', opencode: '#d2d2c8' };
const RIVET = '#fff1c8 0 .8px, #c8963f 1.6px, #4a3214 2.7px, transparent 3.2px', STUD = '#fff1c8 0 .4px, #b8883a .9px, #4a3214 1.5px, transparent 1.9px';
// Every machine keeps these in the same place, so they read alike: sight glass along the front, plan pips on the front-right face,
// mode bulb at the back right, bellows at the back left, a second filament tube at the front left. Bodies stand in the middle; pipes
// leave by the left and back, the nameplate is in front, subagent valves stand on the left and the televisor (with screenshots) on the right.
const TUBE2 = [-.7, Y0, .3], SIGHT = { x: -.42, y: .22, z: .66, len: .56 }, PLAN = { x0: .76, z0: .4, x1: .42, z1: .74, y: .175, max: 10 }, MODE = [.6, -.55], BELLOWS = [-.6, -.5];
const UNIT_FREE = [4, 5, 6, 7];
const TYPES = ['upright', 'tank', 'pistons', 'condenser', 'still', 'pumphouse'];
// Nameplates stand on two posts, leaning back to face the camera: width, height, where the bottom edge is (from the node), canvas size.
// They're big for their machines so a name on two lines still reads from across the hall; each stands far enough out that its top
// edge clears the machine's front, its bottom edge LIFT up so a pipe passes under it rather than through its face. A project's is
// longer and low, black enamel with one line of gilt caps: the hub's plate reads as one at any distance.
// The televisor of a session with screenshots lies on the floor right of its machine: a bulging CRT in a bent brass frame on a walnut
// slab, its console along the back edge with filament tubes, knobs, two meters and indicator bulbs. (x, z): its screen's centre from the node,
// in floor units; it's modelled in its own units (sw, sh, half: the screen's size and the set's half width) and stood on the floor k times that.
const TV = { x: 3.7, z: -.95, sw: 2.5, sh: 1.6, cw: 512, ch: 328, half: 1.5, k: 1.35 };
const LEAN = -1.07, LIFT = .42, PLATE = {
  session: { w: 7, h: 1.9, z: 2.32, cw: 768, ch: 208 },
  project: { w: 7.8, h: 1.2, z: JR * JS + 1.38, cw: 768, ch: 118 },
  you: { w: 5.2, h: 1.7, z: AB + 1.93, cw: 512, ch: 167 },
};

// A session's machine, from its id: body type, proportions, trim metal, stack, gauges, rivets. Provider is the body's metal.
function unitParts(seed, provider) {
  const r = kit.rng(seed), pick = l => l[r() * l.length | 0], rr = (a, b) => a + (b - a) * r();
  const tint = PROV[provider] || PROV.claude, trim = pick(['brass', 'brass', 'brass', 'copper', 'nickel', 'gun']), band = r() < .3 ? 'verdigris' : trim;
  const b = parts(), rig = { type: pick(TYPES), gauges: [], rods: [], wheels: [], lamp: null, mode: null, whistle: null, smoke: null, exhaust: null };
  const S = (g, ...at) => b.add(place(g, ...at), 'shell', tint), T = (g, ...at) => b.add(place(g, ...at), trim);
  b.add(oct(UR, UR + .03, .14, .07), pick(['iron', 'tread', 'tread', 'plate', 'green']));
  b.add(place(flat(torus(UR - .04, .018, 4, 8)), 0, .14, 0, 0, PI / 8), trim);
  b.add(many(octPts(UR - .12, r() < .5 ? 1 : 2).map(([x, z]) => place(rivet(.03), x, .14, z))), trim);
  const { x: sx, y: sy, z: sz, len: sl } = SIGHT;
  b.add(place(cyl(.045, .045, sl, 10), sx + sl / 2, sy, sz, 0, 0, HP), 'glass');
  for (const x of [sx, sx + sl]) { T(cyl(.066, .066, .05, 12), x, sy, sz, 0, 0, HP); T(box(.04, sy - .14, .04), x, (sy + .14) / 2, sz); }
  b.add(bar(PLAN.x0, PLAN.z0, PLAN.x1, PLAN.z1, .08, .03, .155), 'black');
  rig.mode = lampPost(b, MODE[0], Y0, MODE[1], .16, trim);
  b.add(place(cyl(.14, .16, .03, 12), BELLOWS[0], Y0 + .015, BELLOWS[1]), 'iron');
  // The firedoor stays shut: a machine's filament tubes carry its status, so nothing else on it glows or blinks.
  const door = (x, y, z, w, h) => { b.add(place(box(w + .06, h + .06, .04), x, y, z), 'black'); b.add(place(box(w, h, .03), x, y, z + .015), 'iron'); };
  const second = r() < .4;
  switch (rig.type) {
    case 'upright': {
      const R0 = rr(.3, .4), H = rr(.55, .9), cx = rr(-.1, .06), cz = -.14, y1 = Y0 + .07, top = y1 + H, dome = r() < .6, capH = dome ? R0 * rr(.45, .75) : R0 * .5;
      b.add(place(cyl(R0 + .06, R0 + .08, .07, 24), cx, Y0 + .035, cz), 'iron');
      S(cyl(R0, R0, H, 28), cx, y1 + H / 2, cz);
      const nb = 1 + (r() * 3 | 0), rv = 10 + (r() * 3 | 0) * 3;
      for (let k = 1; k <= nb; k++) { const y = y1 + H * k / (nb + 1); b.add(place(flat(torus(R0 + .01, .016, 5, 28)), cx, y, cz), band); b.add(many(ringY(rv, R0 + .012, y + .032, .018, cx, cz)), band); }
      if (dome) S(hemi(R0, 24, 8), cx, top, cz, 0, 0, 0, 1, capH / R0, 1); else S(cyl(R0 * .3, R0, capH, 24), cx, top + capH / 2, cz);
      T(flat(torus(R0 + .012, .02, 5, 28)), cx, top, cz);
      door(cx, Y0 + .2, cz + R0 + .01, .17, .1);
      const gy = y1 + H * rr(.68, .8) + .05;
      T(cyl(.035, .035, .1, 8), cx, gy, cz + R0 + .03, HP);
      rig.gauges.push(gaugeCase(b, cx, gy + .02, cz + R0 + .1, rr(.12, .16), 1.05, trim));
      if (second) { const x = cx + R0 * .62; T(cyl(.025, .025, .08, 8), x, y1 + H * .4, cz + R0 * .78 + .03, HP); rig.gauges.push(gaugeCase(b, x, y1 + H * .4 + .015, cz + R0 * .78 + .09, .085, 1.05, trim)); }
      const capTop = top + capH;
      if (r() < .7) { const h = rr(.25, .6), x = cx + R0 * .35, z = cz - R0 * .35, y = top + capH * .5; b.add(place(cyl(.055, .065, h, 10), x, y + h / 2, z), pick(['black', 'iron', 'copper'])); T(cyl(.085, .065, .05, 10), x, y + h, z); rig.smoke = [x, y + h + .05, z]; }
      const wx = cx - R0 * .3, wz = cz + R0 * .1;
      T(cyl(.018, .018, .12, 6), wx, capTop + .02, wz); b.add(place(cyl(.04, .03, .09, 10), wx, capTop + .1, wz), 'brass');
      rig.whistle = [wx, capTop + .16, wz];
      rig.lamp = lampPost(b, cx + R0 * .12, capTop - capH * .12, cz + R0 * .38, .05, trim);
      if (r() < .6 && cx + R0 < .5) {
        const y = Y0 + .2, x0 = cx + R0 + .02;
        T(cyl(.075, .075, .16, 16), x0 + .09, y, cz, 0, 0, HP); T(cyl(.09, .09, .025, 16), x0 + .01, y, cz, 0, 0, HP); T(cyl(.09, .09, .025, 16), x0 + .17, y, cz, 0, 0, HP);
        b.add(place(box(.18, y - Y0 - .05, .1), x0 + .09, (y + Y0 - .05) / 2, cz), 'iron');
        rig.rods.push({ x: x0 + .18, y, z: cz, axis: 1, len: .12, r: .02, stroke: .04, ph: 0 }); rig.exhaust = [x0 + .3, y, cz];
      } else { const y = y1 + H * .35; T(cyl(.03, .03, .16, 8), cx - R0 - .06, y, cz, 0, 0, HP); handwheel(b, cx - R0 - .14, y - .05, cz, .07, pick(['red', 'black', 'brass']), .06, trim); }
      break;
    }
    case 'tank': {
      const Rt = rr(.2, .28), L = rr(.75, 1), cx = 0, cz = -.16, cy = Y0 + .08 + Rt;
      for (const s of [-1, 1]) b.add(place(box(.1, cy - Y0, Rt * 1.5), cx + s * L * .3, (cy + Y0) / 2, cz), 'iron');
      S(cyl(Rt, Rt, L, 28), cx, cy, cz, 0, 0, HP);
      S(hemi(Rt, 24, 6), cx + L / 2, cy, cz, 0, 0, -HP, 1, .4, 1); S(hemi(Rt, 24, 6), cx - L / 2, cy, cz, 0, 0, HP, 1, .4, 1);
      const nb = 2 + (r() * 2 | 0);
      for (let k = 0; k < nb; k++) { const x = cx + (k / (nb - 1) - .5) * L * .9; b.add(place(torus(Rt + .01, .015, 5, 28), x, cy, cz, 0, HP), band); b.add(many(ringX(12, Rt + .012, x + .028, .016, cy, cz)), band); }
      const dx = rr(-.22, .22) * L, topGauge = r() < .5;
      T(cyl(.09, .11, .12, 16), cx + dx, cy + Rt + .03, cz); T(hemi(.09, 16, 5), cx + dx, cy + Rt + .09, cz);
      door(cx, Y0 + .05, cz + Rt + .05, L * .3, .04); b.add(place(box(L * .35, .09, Rt * 2), cx, Y0 + .045, cz + .02), 'black');
      const front = { x: cx - L * .26, y: Y0 + .36, z: cz + Rt + .2 };
      if (topGauge) rig.gauges.push(gaugeCase(b, cx + dx, cy + Rt + .27, cz + .04, rr(.12, .15), .55, trim, cy + Rt + .15));
      else rig.gauges.push(gaugeCase(b, front.x, front.y, front.z, rr(.12, .15), .6, trim, Y0));
      if (second) rig.gauges.push(topGauge ? gaugeCase(b, front.x, front.y - .06, front.z, .09, .6, trim, Y0) : gaugeCase(b, cx + dx, cy + Rt + .23, cz + .04, .09, .55, trim, cy + Rt + .15));
      const ex = dx > 0 ? cx - L * .36 : cx + L * .36;
      if (r() < .6) { const h = rr(.25, .55); b.add(place(cyl(.05, .055, h, 10), ex, cy + Rt * .8 + h / 2, cz), pick(['black', 'iron'])); T(cyl(.075, .055, .045, 10), ex, cy + Rt * .8 + h, cz); rig.smoke = [ex, cy + Rt * .8 + h + .05, cz]; }
      else handwheel(b, ex, cy + Rt * .9, cz, .07, pick(['red', 'black', 'brass']), .06, trim);
      rig.whistle = [cx + dx, cy + Rt + .2, cz - .06];
      if (topGauge) b.add(place(cyl(.03, .02, .08, 8), cx + dx - .06, cy + Rt + .18, cz - .08), 'brass');
      rig.lamp = lampPost(b, (ex + cx + dx) / 2, cy + Rt - .02, cz - .1, .04, trim);
      // Feed pump at the front right: a little cylinder with its rod nodding while it works.
      const px = cx + L * .3, pz = cz + Rt + .15;
      T(cyl(.06, .07, .16, 14), px, Y0 + .08, pz); T(cyl(.075, .075, .02, 14), px, Y0 + .17, pz);
      rig.rods.push({ x: px, y: Y0 + .18, z: pz, axis: 0, len: .12, r: .018, stroke: .035, ph: 1 }); rig.exhaust = [px, Y0 + .35, pz];
      break;
    }
    case 'pistons': {
      const n = 1 + (r() * 3 | 0), pr = n === 3 ? rr(.1, .12) : rr(.11, .15), gap = pr * 2 + .07, w = n * gap + .12, ph = rr(.28, .42), cz = -.14, bh = .2, y0 = Y0 + bh;
      b.add(place(box(w, bh, .5), 0, Y0 + bh / 2, cz), pick(['gun', 'iron', 'green'])); T(box(w + .02, .025, .52), 0, y0, cz);
      T(box(w * .92, .12, .1), 0, y0 + .06, cz - .19);
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * gap, z = cz + .04;
        S(cyl(pr, pr, ph, 24), x, y0 + ph / 2, z);
        T(cyl(pr + .025, pr + .025, .035, 24), x, y0 + .018, z); T(cyl(pr + .02, pr + .02, .04, 24), x, y0 + ph, z);
        if (r() < .6) b.add(place(flat(torus(pr + .006, .012, 5, 24)), x, y0 + ph * .5, z), band);
        b.add(many(ringUp(6, pr + .005, y0 + ph + .02, .013, x, z)), trim);
        rig.rods.push({ x, y: y0 + ph + .02, z, axis: 0, len: .16, r: .026, stroke: .06, ph: i * TAU / n });
      }
      door(w * .12, Y0 + .08, cz + .25, w * .45, .05);
      rig.gauges.push(gaugeCase(b, -w / 2 + .1, Y0 + .38, .3, rr(.12, .14), .55, trim, Y0));
      if (second) rig.gauges.push(gaugeCase(b, w / 2 - .14, Y0 + .32, .3, .085, .55, trim, Y0));
      if (r() < .65) { const h = rr(.4, .8), x = Math.min(w / 2 - .06, .42); b.add(place(cyl(.05, .05, h, 10), x, Y0 + h / 2, -.47), pick(['black', 'iron', 'copper'])); T(cyl(.07, .05, .04, 10), x, Y0 + h, -.47); rig.smoke = [x, Y0 + h + .05, -.47]; }
      else handwheel(b, w * .25, y0 + .12, cz - .19, .06, pick(['red', 'black', 'brass']), .04, trim);
      b.add(place(cyl(.03, .02, .1, 8), -w * .3, y0 + .17, cz - .19), 'brass'); rig.whistle = [-w * .3, y0 + .24, cz - .19];
      rig.lamp = lampPost(b, .66, Y0, .08, rr(.3, .5), trim);
      rig.exhaust = [0, y0 + ph + .2, cz];
      break;
    }
    case 'condenser': {
      const R1 = rr(.17, .23), H = rr(.55, .8), cx = -.22, cz = -.16, y1 = Y0 + .05;
      b.add(place(cyl(R1 + .07, R1 + .09, .05, 20), cx, Y0 + .025, cz), 'iron');
      S(cyl(R1, R1, H, 24), cx, y1 + H / 2, cz);
      T(cyl(R1 * .5, R1 + .02, .1, 24), cx, y1 + H + .05, cz);
      b.add(new THREE.TubeGeometry(new Helix(cx, cz, R1 + .045, y1 + .08, y1 + H - .06, 4 + (r() * 3 | 0)), 90, .022, 6), pick(['copper', 'brass', 'copper']));
      const rx = cx + .54, rh = rr(.3, .45), rz = cz + .04;
      S(cyl(.15, .15, rh, 20), rx, Y0 + rh / 2, rz); T(hemi(.15, 20, 6), rx, Y0 + rh, rz, 0, 0, 0, 1, .5, 1);
      b.add(place(flat(torus(.155, .014, 5, 24)), rx, Y0 + rh * .5, rz), band);
      T(cyl(.03, .03, .54 - R1 - .15, 8), (cx + R1 + rx - .15) / 2, Y0 + .25, rz, 0, 0, HP);
      handwheel(b, (cx + R1 + rx - .15) / 2, Y0 + .28, rz, .055, pick(['red', 'black', 'brass']), .04, trim);
      rig.gauges.push(gaugeCase(b, rx, Y0 + rh + .2, rz + .04, rr(.11, .14), .55, trim, Y0 + rh + .05));
      if (second) { T(cyl(.025, .025, .1, 8), cx, y1 + H * .55, cz + R1 + .05, HP); rig.gauges.push(gaugeCase(b, cx, y1 + H * .55 + .015, cz + R1 + .12, .085, 1.05, trim)); }
      door(cx, Y0 + .1, cz + R1 + .12, .12, .06);
      rig.lamp = lampPost(b, cx, y1 + H + .1, cz, .03, trim);
      b.add(place(cyl(.03, .02, .1, 8), cx + R1 * .6, y1 + H + .1, cz - .06), 'brass'); rig.whistle = [cx + R1 * .6, y1 + H + .2, cz - .06];
      rig.exhaust = [rx, Y0 + rh + .1, rz];
      if (r() < .5) { const h = rr(.3, .5); b.add(place(cyl(.045, .05, h, 10), cx + .3, Y0 + h / 2, -.5), 'black'); T(cyl(.065, .05, .04, 10), cx + .3, Y0 + h, -.5); rig.smoke = [cx + .3, Y0 + h + .05, -.5]; }
      break;
    }
    case 'still': {
      const s = rr(.85, 1.1), cx = -.16, cz = -.14, yb = Y0 + .12, tub = cx + .6;
      b.add(place(box(.62, .12, .56), cx, Y0 + .06, cz), 'iron'); door(cx, Y0 + .06, cz + .29, .3, .05);
      const prof = [[0, 0], [.27, 0], [.36, .1], [.39, .22], [.33, .35], [.2, .45], [.1, .52], [.075, .6]].map(([x, y]) => new THREE.Vector2(x * s, y * s));
      S(new THREE.LatheGeometry(prof, 24), cx, yb, cz);
      b.add(place(flat(torus(.39 * s + .006, .015, 5, 28)), cx, yb + .22 * s, cz), band);
      b.add(many(ringY(14, .39 * s + .01, yb + .25 * s, .016, cx, cz)), band);
      const neck = new THREE.QuadraticBezierCurve3(new THREE.Vector3(cx, yb + .58 * s, cz), new THREE.Vector3(cx + .12, yb + .78 * s, cz), new THREE.Vector3(tub - .06, Y0 + .4, cz));
      b.add(new THREE.TubeGeometry(neck, 16, .03, 8), pick(['copper', 'brass']));
      b.add(place(cyl(.15, .15, .36, 20), tub, Y0 + .18, cz), pick(['gun', 'iron', 'copper']));
      for (const y of [.08, .28]) b.add(place(flat(torus(.152, .014, 5, 24)), tub, Y0 + y, cz), trim);
      T(cyl(.16, .16, .03, 20), tub, Y0 + .37, cz);
      T(cyl(.025, .025, .1, 8), cx, yb + .28 * s, cz + .37 * s + .03, HP);
      rig.gauges.push(gaugeCase(b, cx, yb + .28 * s + .02, cz + .37 * s + .1, rr(.11, .14), 1.0, trim));
      if (second) rig.gauges.push(gaugeCase(b, tub, Y0 + .24, cz + .25, .08, .8, trim, Y0));
      rig.lamp = lampPost(b, tub + .06, Y0 + .38, cz - .05, .03, trim);
      b.add(place(cyl(.025, .02, .09, 8), cx - .05, yb + .6 * s, cz - .04), 'brass'); rig.whistle = [cx - .05, yb + .66 * s, cz - .04];
      rig.exhaust = [tub, Y0 + .45, cz];
      if (r() < .5) { const h = rr(.25, .45); b.add(place(cyl(.04, .045, h, 10), cx - .22, Y0 + .12 + h / 2, cz - .2), 'black'); rig.smoke = [cx - .22, Y0 + .12 + h + .04, cz - .2]; }
      break;
    }
    default: {   // pumphouse
      const w = rr(.7, .9), h = rr(.32, .44), d = .46, cx = -.06, cz = -.2, fz = cz + d / 2;
      b.add(place(box(w, h, d), cx, Y0 + h / 2, cz), pick(['iron', 'green', 'gun', 'plate']));
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) T(box(.04, h, .04), cx + x * w / 2, Y0 + h / 2, cz + z * d / 2);
      b.add(place(new THREE.CylinderGeometry(1, 1, w + .08, 3, 1, false, HP), cx, Y0 + h + .074, cz, 0, 0, HP, .147, 1, .32), pick(['copper', 'verdigris', 'black', 'gun']));
      const nw = 2 + (r() * 2 | 0), wx0 = cx - w / 2 + .1, wx1 = cx + w / 2 - .38;
      for (let i = 0; i < nw; i++) { const x = wx0 + (wx1 - wx0) * (nw === 1 ? .5 : i / (nw - 1)); T(box(.11, .13, .015), x, Y0 + h * .55, fz + .005); b.add(place(box(.08, .1, .02), x, Y0 + h * .55, fz + .01), 'glass'); }
      const fx = cx + w / 2 - .16, fy = Y0 + .26, fzz = fz + .1;
      b.add(place(box(.06, fy - Y0, .06), fx, (fy + Y0) / 2, fzz - .06), 'iron'); T(cyl(.025, .025, .14, 8), fx, fy, fzz - .03, HP);
      rig.wheels.push({ x: fx, y: fy, z: fzz, r: .2 });
      rig.gauges.push(gaugeCase(b, cx - w / 2 + .15, Y0 + .3, fz + .22, rr(.11, .13), .6, trim, Y0));
      if (second) { T(cyl(.02, .02, .06, 8), cx + .02, Y0 + h * .8, fz + .02, HP); rig.gauges.push(gaugeCase(b, cx + .02, Y0 + h * .8 + .01, fz + .07, .07, 1.1, trim)); }
      const ch = rr(.25, .5), chx = cx - w * .25;
      b.add(place(cyl(.06, .07, ch, 10), chx, Y0 + h + .12 + ch / 2, cz - .08), pick(['black', 'iron'])); T(cyl(.085, .065, .05, 10), chx, Y0 + h + .12 + ch, cz - .08);
      rig.smoke = [chx, Y0 + h + .17 + ch, cz - .08];
      rig.lamp = lampPost(b, cx + w * .22, Y0 + h + .2, cz, .01, trim);
      b.add(place(cyl(.025, .02, .1, 8), cx + w * .02, Y0 + h + .2, cz + .02), 'brass'); rig.whistle = [cx + w * .02, Y0 + h + .28, cz + .02];
      rig.exhaust = [fx + .25, fy, fzz];
    }
  }
  return { geo: b.done(), rig };
}


// A project's hub, from its id: the manifold its machines' pipes come into. A wide two-step plinth, a copper ring main on saddles round a
// tall riveted receiver (dome, safety valve, the governor on top, filament tubes on brackets either side), a big pressure gauge on
// its front, a handwheel on the main and a bulb per machine along the front step. It is the widest and tallest thing in its cluster, a round crown among square-shouldered
// machines, so every cluster reads from its middle out; the button for a new session.
function hubParts(seed) {
  const r = kit.rng(seed), pick = l => l[r() * l.length | 0], rr = (a, b) => a + (b - a) * r();
  const trim = pick(['brass', 'brass', 'copper', 'nickel']), body = pick(['copper', 'green', 'gun', 'copper', 'brass']);
  const b = parts(), T = (g, ...at) => b.add(place(g, ...at), trim), C = (g, ...at) => b.add(place(g, ...at), body);
  const D = .32, RM = 1.2, YM = .68, DR = rr(.6, .7), H = rr(1.7, 2.1), side = r() < .5 ? 1 : -1;
  b.add(oct(JR, JR + .04, .22, .11), 'iron'); T(flat(torus(JR - .03, .03, 4, 8)), 0, .22, 0, 0, PI / 8);
  b.add(many(octPts(JR - .13, 2).map(([x, z]) => place(rivet(.045), x, .22, z))), trim);
  b.add(oct(JR - .32, JR - .28, .1, .27), pick(['tread', 'tread', 'iron']));
  // The ring main on eight iron saddles, a brass collar at each, spokes into the receiver.
  b.add(place(flat(torus(RM, .13, 8, 48)), 0, YM, 0), 'copper');
  for (let k = 0; k < 8; k++) {
    const a = (k + .5) * PI / 4, c = Math.cos(a), s = Math.sin(a);
    b.add(place(box(.3, YM - D, .1), c * RM, (YM + D) / 2, s * RM, 0, -a), 'iron');
    T(cyl(.175, .175, .09, 14), c * RM, YM, s * RM, 0, -a - HP, HP);
    if (k % 2) b.add(place(cyl(.075, .075, RM - DR, 10), c * (RM + DR) / 2, YM, s * (RM + DR) / 2, 0, -a, HP), 'copper');
  }
  C(cyl(DR, DR + .05, H, 32), 0, D + H / 2, 0); C(hemi(DR, 28, 8), 0, D + H, 0, 0, 0, 0, 1, .55, 1);
  for (const f of [.1, .52, .94]) { T(flat(torus(DR + .02, .035, 5, 32)), 0, D + H * f, 0); b.add(many(ringY(16, DR + .03, D + H * f + .05, .022)), trim); }
  T(cyl(.11, .13, .2, 14), side * DR * .45, D + H + DR * .38, -.1); T(ball(.09, 10, 6), side * DR * .45, D + H + DR * .38 + .14, -.1);
  const top = D + H + DR * .55;
  const rig = { governor: { x: 0, y: top - .02, z: 0 }, gauges: [gaugeCase(b, 0, D + H * .72, DR + .03, .36, .5, trim)] };
  const ty = D + H * .52;
  rig.tubes = [-1, 1].map(sx => { b.add(place(box(.36, .06, .3), sx * (DR + .14), ty - .03, .12), 'black'); return lampPost(b, sx * (DR + .22), ty, .12, 0, trim); });
  handwheel(b, side * RM * .71, YM + .1, -RM * .71, .26, pick(['red', 'red', 'black', 'brass']), .26, trim);
  b.add(bar(-1.2, JA - .45, 1.2, JA - .45, .14, .04, D + .02), 'black');
  rig.bulbs = { y: D + .1, z: JA - .45, dx: .3, r: .075 };
  return { geo: b.done(), rig };
}

// You: the boiler at the back of its plinth (firebox, copper drum, steam dome, whistle, stack, gauge), the usage board in front of it.
function boilerParts() {
  const b = parts(), B = (g, ...at) => b.add(place(g, ...at), 'brass'), cz = -3.3;
  b.add(oct(BR, BR + .04, .3, .15), 'iron'); b.add(oct(BR + .15, BR + .18, .08, .04), 'iron'); b.add(oct(BR - .4, BR - .38, .04, .31), 'tread');
  B(flat(torus(BR - .03, .04, 4, 8)), 0, .3, 0, 0, PI / 8);
  b.add(many(octPts(BR - .22, 5).map(([x, z]) => place(rivet(.06), x, .3, z))), 'brass');
  b.add(place(box(3.4, .55, 1.6), 0, .575, cz), 'iron');
  b.add(place(box(1.7, .32, .02), 0, .58, cz + .8), 'fire');
  for (const x of [-.68, -.34, 0, .34, .68]) b.add(place(box(.08, .34, .03), x, .58, cz + .815), 'black');
  B(box(2, .07, .05), 0, .78, cz + .82); B(box(2, .07, .05), 0, .38, cz + .82); B(box(.07, .46, .05), -.97, .58, cz + .82); B(box(.07, .46, .05), .97, .58, cz + .82);
  b.add(place(cyl(.75, .75, 3, 40), 0, 1.6, cz, 0, 0, HP), 'warm');
  b.add(place(cyl(.3, .34, .35, 24), -.7, 2.42, cz), 'warm');
  for (const x of [-1.2, -.45, .45, 1.2]) B(torus(.775, .045, 8, 40), x, 1.6, cz, 0, HP);
  for (const x of [-1.2, 1.2]) b.add(many(ringX(18, .78, x + .07, .035, 1.6, cz)), 'brass');
  B(hemi(.75), 1.5, 1.6, cz, 0, 0, -HP, 1, .35, 1); B(hemi(.75), -1.5, 1.6, cz, 0, 0, HP, 1, .35, 1); B(hemi(.3), -.7, 2.6, cz, 0, 0, 0, 1, .45, 1);
  B(cyl(.045, .045, .34, 10), .65, 2.48, cz); B(cyl(.1, .07, .22, 14), .65, 2.74, cz);
  for (let i = 0; i < 11; i++) { const x = -1.5 + i * .3; b.add(place(rivet(.05), x, .85, cz + .72), 'brass'); b.add(place(rivet(.05), x, .85, cz - .72), 'brass'); }
  b.add(place(cyl(.22, .27, 1.9, 16), 1.25, .85 + .95, cz - .6), 'black'); B(cyl(.33, .24, .15, 16), 1.25, 2.8, cz - .6); B(flat(torus(.24, .025, 5, 20)), 1.25, 1.9, cz - .6);
  B(cyl(.06, .06, .3, 8), 0, 2.38, cz + .7, HP * .6);
  const gauge = gaugeCase(b, 0, 2.55, cz + .85, .5, .65, 'brass');
  const tubes = [[-3.6, 1.2], [-3.6, 2.05], [3.6, 1.2], [3.6, 2.05]].map(([x, z]) => lampPost(b, x, .3, z, .06, 'brass'));
  return { geo: b.done(), rig: { gauge, tubes, whistle: [.65, 2.9, cz], smoke: [1.25, 2.95, cz - .6] } };
}

const CACHE = new Map(), ENVS = new WeakMap();
// The room's reflections, made once per renderer: PMREM is slow on a busy GPU, and the look is built again whenever sessions come or go.
function envFor(renderer) { let t = ENVS.get(renderer); if (!t) { const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment(); t = pmrem.fromScene(room, .04).texture; room.dispose?.(); pmrem.dispose(); ENVS.set(renderer, t); } return t; }
function cached(key, make) { let v = CACHE.get(key); if (!v) { v = make(); CACHE.set(key, v); if (CACHE.size > 240) CACHE.delete(CACHE.keys().next().value); } return v; }

// ── Canvas faces: nameplates and the gauge board. Painted only when their text or reading changes. ──
const SERIF = 'Spectral, Georgia, serif', CAPS = 'Cinzel, Georgia, serif', TYPE = '"Courier Prime", ui-monospace, monospace';
function stud(g, x, y, s) { const q = g.createRadialGradient(x - s * .3, y - s * .3, 0, x, y, s); q.addColorStop(0, '#fff1c8'); q.addColorStop(.5, '#b8873a'); q.addColorStop(1, '#3a2610'); g.fillStyle = q; g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill(); }
function brass(g, w, h, seed = 5) {
  const r = kit.rng(seed), gr = g.createLinearGradient(0, 0, w * .25, h);
  gr.addColorStop(0, '#b48a45'); gr.addColorStop(.5, '#d6ad62'); gr.addColorStop(1, '#94703a');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < h / 2; i++) { g.fillStyle = r() < .5 ? `rgba(255,236,190,${.03 + r() * .05})` : `rgba(60,40,15,${.04 + r() * .05})`; g.fillRect(0, r() * h, w, 1 + r() * 2); }
  const e = Math.max(3, h * .045);
  g.strokeStyle = '#3a2610'; g.lineWidth = e * 2; g.strokeRect(e, e, w - 2 * e, h - 2 * e);
  g.strokeStyle = 'rgba(255,240,200,.55)'; g.lineWidth = Math.max(1.5, e * .5); g.strokeRect(e * 2.4, e * 2.4, w - 4.8 * e, h - 4.8 * e);
}
// Text engraved into brass (dark, lit lip below), shrunk to fit and cut with an ellipsis past that.
function fitText(g, text, font, size, max, min = .72) {
  let s = size; g.font = `${font.replace('$', s)}`;
  const w = g.measureText(text).width;
  if (w > max) { s = Math.max(size * min, size * max / w); g.font = font.replace('$', s); }
  if (g.measureText(text).width <= max) return text;
  let t = text; while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}
function engrave(g, t, x, y, font, size, color = '#160c03', lip = 'rgba(255,242,205,.4)') {
  g.font = font.replace('$', size); g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = lip; g.fillText(t, x, y + Math.max(1, size * .05));
  g.fillStyle = g.strokeStyle = color; g.lineWidth = size * .045; g.lineJoin = 'round'; g.strokeText(t, x, y); g.fillText(t, x, y);
}
// How a plate's name fits, worked out when the name changes: one line at full size, shrunk a little if need be; failing that (a
// session's) two lines split at the space that lets both be biggest, line 1 clear of the top studs, line 2 nearly edge to edge; only
// past that is line 2 cut with an ellipsis. fs is the size it came out at against full size. oneLine gives the plain fit (one line,
// shrunk at most to .84, then cut): what a plate shows instead while the full fit would engrave too small to read (see showPlate).
const NAME = {
  session: { font: `500 $px ${SERIF}`, full: .41, floor: .74, y: .28, side: 6.6 },
  project: { font: `700 $px ${CAPS}`, full: .5, floor: .6, y: .53, side: 6.6, caps: true },
  you: { font: `700 $px ${CAPS}`, full: .34, floor: .84, y: .29, side: 8, caps: true },
};
const widthAt = (g, font, size, t) => { g.font = font.replace('$', size); return g.measureText(t).width; };
// The longest prefix of t (cut at one of `at`, else anywhere) that fits max in the current font.
function prefix(g, t, at, max) { let k = 0; for (const i of at) { if (g.measureText(t.slice(0, i)).width > max) break; k = i; } if (!k) while (k < t.length - 1 && g.measureText(t.slice(0, k + 1)).width <= max) k++; return Math.max(1, k); }
function nameFit(g, kind, w, h, text, oneLine) {
  const N = NAME[kind], s = h * .085, t = N.caps ? text.toUpperCase() : text, full = h * N.full, max = w - s * N.side, R = 100;
  const one = Math.min(full, R * max / Math.max(1, widthAt(g, N.font, R, t)));
  const single = size => { g.font = N.font.replace('$', size); return { lines: [cut(g, t, max)], ys: [h * N.y], size, font: N.font, fs: size / full }; };
  if (oneLine) return single(Math.max(one, full * .84));
  if (one >= full * N.floor || kind !== 'session') return single(Math.max(one, full * N.floor));
  const L1 = w - s * 6.8, L2 = w - s * 3.5, top = h * .185, low = h * .165, sp = [];
  for (let i = t.indexOf(' '); i > 0; i = t.indexOf(' ', i + 1)) sp.push(i);
  const at = sp.length ? sp : Array.from({ length: t.length - 1 }, (_, i) => i + 1), skip = sp.length ? 1 : 0;
  let best = 0, bi = 0;
  for (const i of at) { const z = R * Math.min(L1 / Math.max(1, widthAt(g, N.font, R, t.slice(0, i))), L2 / Math.max(1, widthAt(g, N.font, R, t.slice(i + skip)))); if (z > best) { best = z; bi = i; } }
  let size = Math.min(top, best);
  if (one >= size) return single(one);
  if (size < low) { size = low; g.font = N.font.replace('$', size); bi = prefix(g, t, at, L1); }
  g.font = N.font.replace('$', size);
  const rest = t.slice(bi + (t[bi] === ' ' ? 1 : 0));
  // The pair is centred between the inner border (.125) and the ticker's rim (.505); Spectral reaches .56em above its middle, .44 below.
  const d = size * 1.04, y1 = h * .315 + size * .064 - d / 2;
  return { lines: [t.slice(0, bi), cut(g, rest, L2)], ys: [y1, y1 + d], size, font: N.font, fs: size / full };
}
function cut(g, t, max) { if (g.measureText(t).width <= max) return t; while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1); return t.trimEnd() + '…'; }
// A ticker window: slate, or amber / red enamel when it needs you or failed.
const TICKER = { need: ['#e0a03a', '#2a1606'], error: ['#9a2416', '#ffe2d0'], off: ['#3a3836', '#a8a294'], work: ['#1e2420', '#bfe6b8'], idle: ['#22201d', '#d8ccb0'] };
function ticker(g, text, x, y, w, h, tone) {
  const [bg, fg] = TICKER[tone] || TICKER.idle;
  g.fillStyle = '#2a1a0a'; g.beginPath(); g.roundRect(x - 3, y - 3, w + 6, h + 6, h * .22); g.fill();
  g.fillStyle = bg; g.beginPath(); g.roundRect(x, y, w, h, h * .18); g.fill();
  g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(x + 4, y + 3, w - 8, h * .3);
  const t = fitText(g, text, `700 $px ${TYPE}`, h * .78, w - h * .5, .85);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = fg; g.fillText(t, x + w / 2, y + h * .54);
}
// A nameplate: its name as fitted by nameFit (none while the brass tag stands in), then the ticker. A project's is black enamel in a
// brass rim, its name gilt.
function paintPlate(g, kind, w, h, fit, line, tone, seed) {
  g.clearRect(0, 0, w, h); brass(g, w, h, seed);
  const s = h * .085, hub = kind === 'project';
  if (hub) {
    const e = Math.max(3, h * .045) * 1.6, gr = g.createLinearGradient(0, e, 0, h - e);
    gr.addColorStop(0, '#3a2814'); gr.addColorStop(1, '#140c05'); g.fillStyle = gr; g.fillRect(e, e, w - 2 * e, h - 2 * e);
    g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineWidth = 2; g.strokeRect(e + 1, e + 1, w - 2 * e - 2, h - 2 * e - 2);
  }
  for (const [x, y] of [[s * 1.9, s * 1.9], [w - s * 1.9, s * 1.9], [s * 1.9, h - s * 1.9], [w - s * 1.9, h - s * 1.9]]) stud(g, x, y, s);
  if (fit) for (let i = 0; i < fit.lines.length; i++) engrave(g, fit.lines[i], w / 2, fit.ys[i], fit.font, fit.size, ...(hub ? ['#f0c870', 'rgba(0,0,0,.85)'] : []));
  if (hub) return;
  if (kind === 'you') return ticker(g, line, w * .12, h * .52, w * .76, h * .38, tone);
  ticker(g, line, w * .045, h * .53, w * .91, h * .4, tone);
}

// The televisor's screen: the newest screenshot under curved glass (warm phosphor, scanlines, vignette, a highlight), very rounded
// corners (the rest is cut away), and a brass counter of how many there are in its corner.
function paintTV(g, w, h, bitmap, count) {
  g.clearRect(0, 0, w, h);
  const rr = h * .2;
  g.save(); g.beginPath(); g.roundRect(2, 2, w - 4, h - 4, rr); g.clip();
  g.fillStyle = '#0c0a06'; g.fillRect(0, 0, w, h);
  if (bitmap) { const k = Math.max(w / bitmap.width, h / bitmap.height), bw = bitmap.width * k, bh = bitmap.height * k; g.drawImage(bitmap, (w - bw) / 2, (h - bh) / 2, bw, bh); }
  g.globalCompositeOperation = 'multiply'; g.fillStyle = '#ffe4c0'; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over';
  g.fillStyle = 'rgba(0,0,0,.2)'; for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  let gr = g.createRadialGradient(w / 2, h / 2, h * .35, w / 2, h / 2, w * .62); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.55)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  gr = g.createLinearGradient(0, 0, w * .5, h * .6); gr.addColorStop(0, 'rgba(255,250,235,.08)'); gr.addColorStop(1, 'rgba(255,250,235,0)');
  g.fillStyle = gr; g.beginPath(); g.ellipse(w * .3, h * .22, w * .32, h * .15, -.25, 0, TAU); g.fill();
  g.restore();
  g.strokeStyle = '#1a1008'; g.lineWidth = 6; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, rr); g.stroke();
  const digits = String(Math.min(999, count)).padStart(3, '0'), dw = 26, x0 = w - 22 - dw * 3, y0 = h - 58;
  g.fillStyle = '#c99a4a'; g.beginPath(); g.roundRect(x0 - 8, y0 - 6, dw * 3 + 16, 44, 6); g.fill(); g.strokeStyle = '#3a2610'; g.lineWidth = 2; g.stroke();
  g.font = `700 28px ${TYPE}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 3; i++) { gr = g.createLinearGradient(0, y0, 0, y0 + 32); gr.addColorStop(0, '#666'); gr.addColorStop(.5, '#f4efe2'); gr.addColorStop(1, '#666'); g.fillStyle = gr; g.fillRect(x0 + dw * i + 2, y0, dw - 4, 32); g.fillStyle = '#16100a'; g.fillText(digits[i], x0 + dw * (i + .5), y0 + 17); }
}

// The gauge board's face: brass plate, one dial per usage window (used part shaded, red past 80%, a readout), a nameplate per account.
const gaugeAng = f => 5 * PI / 4 - clamp(f, 0, 1.02) * 3 * PI / 2;
const money = v => `$${v >= 100 ? Math.round(v) : v.toFixed(2)}`;
function paintBoard(g, lay, k, H) {
  const P = (x, y) => [(x + lay.W / 2) * k, (lay.H / 2 - y) * k], Wp = lay.W * k;
  brass(g, Wp, H, 9);
  for (const [x, y] of [[24, 24], [Wp - 24, 24], [24, H - 24], [Wp - 24, H - 24]]) stud(g, x, y, 10);
  const cw = lay.cw * k;
  for (const gp of lay.groups) {
    const [x0, y0] = P(gp.x0, gp.y0), x1 = P(gp.x1, 0)[0], h = cw * 1.3;
    g.fillStyle = 'rgba(40,24,8,.3)'; g.beginPath(); g.roundRect(x0 + 4, y0 + 2, x1 - x0 - 8, h - 4, 14); g.fill();
    const ny = y0 + cw * .98, nh = cw * .27;
    let gr = g.createLinearGradient(0, ny, 0, ny + nh); gr.addColorStop(0, '#5a3d18'); gr.addColorStop(1, '#2e1d0a');
    g.fillStyle = gr; g.beginPath(); g.roundRect(x0 + 10, ny, x1 - x0 - 20, nh, 6); g.fill();
    g.strokeStyle = '#e2bd72'; g.lineWidth = 2; g.stroke();
    stud(g, x0 + 22, ny + nh / 2, 4); stud(g, x1 - 22, ny + nh / 2, 4);
    const t = fitText(g, gp.label.toUpperCase(), `700 $px ${CAPS}`, nh * .62, x1 - x0 - 56, .48);
    g.fillStyle = '#f3dba0'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, (x0 + x1) / 2, ny + nh / 2 + 1);
  }
  for (const c of lay.cells) {
    const [x, y] = P(c.x, c.y), R = c.r * k, at = (f, rr) => [x + Math.cos(gaugeAng(f)) * rr, y - Math.sin(gaugeAng(f)) * rr];
    let gr = g.createRadialGradient(x, y - R * .3, R * .1, x, y, R); gr.addColorStop(0, '#fbf3dc'); gr.addColorStop(1, '#d4c296');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, TAU); g.fill();
    g.strokeStyle = '#2a1d10'; g.lineWidth = R * .04; g.beginPath(); g.arc(x, y, R * .97, 0, TAU); g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (c.kind === 'spend' && !c.limit) {
      const digits = money(c.spent), n = digits.length, dw = Math.min(R * .3, R * 1.6 / n), w = dw * n;
      g.fillStyle = '#1a120a'; g.fillRect(x - w / 2 - 6, y - R * .24, w + 12, R * .48);
      g.font = `700 ${dw * 1.1}px ${TYPE}`;
      for (let i = 0; i < n; i++) { const cx = x - w / 2 + dw * (i + .5); gr = g.createLinearGradient(0, y - R * .2, 0, y + R * .2); gr.addColorStop(0, '#555'); gr.addColorStop(.5, '#f4efe2'); gr.addColorStop(1, '#555'); g.fillStyle = gr; g.fillRect(cx - dw * .44, y - R * .2, dw * .88, R * .4); g.fillStyle = '#16100a'; g.fillText(digits[i], cx, y + 1); }
      g.fillStyle = '#2a1d10'; g.font = `700 ${R * .2}px ${CAPS}`; g.fillText('SPENT', x, y + R * .55);
      continue;
    }
    const u = clamp(c.used, 0, 1);
    g.fillStyle = u >= .9 ? 'rgba(200,40,20,.42)' : u >= .75 ? 'rgba(220,140,30,.4)' : 'rgba(70,130,70,.3)';
    if (u > .005) { g.beginPath(); g.moveTo(x, y); g.arc(x, y, R * .88, -gaugeAng(0), -gaugeAng(u)); g.closePath(); g.fill(); }
    g.strokeStyle = '#b8272a'; g.lineWidth = R * .1; g.beginPath(); g.arc(x, y, R * .79, -gaugeAng(.8), -gaugeAng(1)); g.stroke();
    for (let i = 0; i <= 20; i++) { const f = i / 20, big = i % 5 === 0; g.strokeStyle = f > .8 ? '#6e0d08' : '#2a1d10'; g.lineWidth = R * (big ? .04 : .018); g.beginPath(); g.moveTo(...at(f, R * (big ? .62 : .72))); g.lineTo(...at(f, R * .88)); g.stroke(); }
    g.fillStyle = '#2a1d10'; g.font = `700 ${R * .22}px ${CAPS}`;
    g.fillText(c.kind === 'spend' ? 'BUDGET' : String(c.label).toUpperCase(), x, y - R * .36);
    const read = c.kind === 'spend' ? money(c.spent) : `${Math.round(c.used * 100)}%`;
    g.font = `700 ${R * .34}px ${TYPE}`;
    const rw = Math.max(R * .7, g.measureText(read).width + R * .16);
    g.fillStyle = '#1a120a'; g.beginPath(); g.roundRect(x - rw / 2, y + R * .4, rw, R * .42, R * .06); g.fill();
    g.fillStyle = u >= .9 ? '#ff7a5a' : u >= .75 ? '#ffc56a' : '#f4efe2'; g.fillText(read, x, y + R * .62);
  }
}
function boardLayout(usage) {
  const groups = [];
  for (const a of usage) {
    const cells = a.windows.map(w => ({ kind: 'win', label: w.label, used: w.used }));
    if (a.spend) cells.push({ kind: 'spend', spent: a.spend.spent || 0, limit: a.spend.limit || 0, used: a.spend.limit ? (a.spend.spent || 0) / a.spend.limit : 0 });
    if (cells.length) groups.push({ label: a.label, cells });
  }
  const total = groups.reduce((s, gp) => s + gp.cells.length, 0);
  if (!total) return null;
  const rows = total <= 4 ? 1 : total <= 8 ? 2 : 3, per = Math.ceil(total / rows), lines = [[]];
  let n = 0;
  for (const gp of groups) { if (n && n + gp.cells.length > per) { lines.push([]); n = 0; } lines.at(-1).push(gp); n += gp.cells.length; }
  const span = l => l.reduce((s, gp) => s + gp.cells.length, 0) + (l.length - 1) * .15, widest = Math.max(...lines.map(span));
  const cw = Math.min(1.45, 5.8 / widest, 4 / (lines.length * 1.3)), W = widest * cw + .3, H = lines.length * cw * 1.3 + .22;
  lines.forEach((l, li) => {
    let x = -span(l) * cw / 2; const y = H / 2 - .11 - li * cw * 1.3;
    for (const gp of l) { gp.x0 = x; gp.y0 = y; gp.cells.forEach((c, i) => { c.x = x + (i + .5) * cw; c.y = y - cw * .5; c.r = cw * .42; }); gp.x1 = x + gp.cells.length * cw; x = gp.x1 + .15 * cw; }
  });
  return { groups, cells: groups.flatMap(gp => gp.cells), W, H, cw, key: groups.map(gp => `${gp.label}:${gp.cells.map(c => c.kind + (c.limit ? 'l' : '')).join()}`).join('|') };
}

const WORKING = new Set(['working', 'thinking', 'compacting']), BLACK = new THREE.Color(0, 0, 0), WHEEL_C = new THREE.Color('#4a3a2c');

export default {
  id: 'steampunk',
  name: 'Steampunk',
  // HTML names show where the engraving on the nameplates is too small to read: on the plates while they can hold one, else as brass
  // tags; a project's is a black and gold tag on its hub.
  css: `
body[data-look="steampunk"] { --bg: #090605; --fg: #f2e4c6; --muted: #b29b78; --panel: linear-gradient(180deg, rgba(54, 46, 38, .97), rgba(26, 21, 17, .98)); --line: rgba(214, 166, 82, .45); --accent: #e0a94e;
  --need: #ffb547; --work: #7fd68a; --err: #ff5636; --wait: #7fa9e6; --font: Spectral, Georgia, serif; --display: Cinzel, Georgia, serif; --mono: "Courier Prime", ui-monospace, monospace;
  --radius: 3px; --shadow: 0 10px 30px rgba(0, 0, 0, .6), inset 0 1px 0 rgba(255, 226, 168, .12); --blur: 6px; --label: #24160a; --label-sub: #d8ccb0; --label-halo: transparent; }
body[data-look="steampunk"] .nodes-tip { border-color: rgba(200, 150, 70, .6); padding: 10px 14px; background:
  radial-gradient(circle at 6px 6px, ${RIVET}), radial-gradient(circle at calc(100% - 6px) 6px, ${RIVET}),
  radial-gradient(circle at 6px calc(100% - 6px), ${RIVET}), radial-gradient(circle at calc(100% - 6px) calc(100% - 6px), ${RIVET}), var(--panel); }
body[data-look="steampunk"] .nodes-tip b { letter-spacing: .03em; }
body[data-look="steampunk"] .nodes-overlay button { border-color: #8a6128; background: linear-gradient(#3d2e1d, #1c140d); color: #f0d9a8; box-shadow: inset 0 1px 0 rgba(255, 226, 168, .18), 0 2px 6px rgba(0, 0, 0, .6); }
body[data-look="steampunk"] .nodes-overlay button:hover, body[data-look="steampunk"] .nodes-overlay button:focus-visible { border-color: #e0a94e; background: linear-gradient(#57402a, #2a1d12); }
body[data-look="steampunk"] .nodes-overlay button:active { transform: translateY(1px); box-shadow: inset 0 2px 4px rgba(0, 0, 0, .6); }
body[data-look="steampunk"] .nodes-overlay .nodes-next { border-color: #6d4410; background: linear-gradient(#ffc766, #c47d18); color: #2a1606; font-weight: 700; }
body[data-look="steampunk"] .lbl { padding: 2px 7px 3px; border-radius: 2px; background: linear-gradient(#e6c47c, #a87b36); text-shadow: 0 1px 0 rgba(255, 240, 200, .5);
  box-shadow: 0 0 0 1px #4a3214, inset 0 1px 0 rgba(255, 246, 214, .6), 0 2px 5px rgba(0, 0, 0, .7); }
body[data-look="steampunk"] .lbl b { font-family: var(--font); font-weight: 500; font-size: 12.5px; }
body[data-look="steampunk"] .lbl span { margin-top: 2px; padding: 0 5px; border-radius: 2px; background: #22201d; text-shadow: none; }
body[data-look="steampunk"] .lbl.need span { background: #e0a03a; color: #2a1606; }
body[data-look="steampunk"] .lbl.error span { background: #9a2416; color: #ffe2d0; }
/* A project's tag is its plate's black enamel and gold caps, a size up on a session's: the hub reads first however far out. */
body[data-look="steampunk"] .lbl.project { background: linear-gradient(#3a2814, #140c05); text-shadow: 0 1px 0 #000; box-shadow: 0 0 0 1px #c99a4a, inset 0 0 0 1px #000, 0 2px 5px rgba(0, 0, 0, .75); }
body[data-look="steampunk"] .lbl.project b { font-family: var(--display); font-weight: 700; font-size: 13.5px; letter-spacing: .06em; text-transform: uppercase; color: #f0c870; }
body[data-look="steampunk"] .lbl.you b { font-family: var(--display); font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
/* A name on its plate is the plate's face: the plate's size and shape (tw wide), studded brass, its type scaled with it (cqi) like the
   engraving it stands in for. A session's runs to two lines after its state's dot; amber enamel when it needs you, red when it failed.
   You's has its ticker. */
body[data-look="steampunk"] .lbl.on { width: 100%; min-width: 0; min-height: 0; overflow: hidden; box-sizing: border-box; container-type: inline-size; justify-content: center; padding: 0; border-radius: 1px;
  background: radial-gradient(circle at 3.2% 22%, ${STUD}), radial-gradient(circle at 96.8% 22%, ${STUD}), radial-gradient(circle at 3.2% 78%, ${STUD}), radial-gradient(circle at 96.8% 78%, ${STUD}), var(--face, linear-gradient(170deg, #c99b52, #e6c47c 45%, #a87b36));
  box-shadow: 0 0 0 1px #3a2610, inset 0 0 0 1px rgba(255, 240, 200, .4), 0 2px 4px rgba(0, 0, 0, .65); }
body[data-look="steampunk"] .lbl.on b { max-width: 88%; white-space: normal; text-align: center; text-wrap: balance; line-height: 1.02; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
body[data-look="steampunk"] .lbl.session.on { aspect-ratio: ${PLATE.session.w} / ${PLATE.session.h}; }
body[data-look="steampunk"] .lbl.session.on b { font-size: clamp(10px, 12.5cqi, 15px); font-weight: 600; }
body[data-look="steampunk"] .lbl.session.on .k { display: inline-block; box-shadow: 0 0 0 1px rgba(40, 24, 8, .55); }
body[data-look="steampunk"] .lbl.on.need { --face: linear-gradient(170deg, #c9862a, #f0b44c 45%, #b57018); }
body[data-look="steampunk"] .lbl.on.error { --face: linear-gradient(170deg, #7e1c10, #b02c1a 45%, #6a160c); text-shadow: 0 1px 0 #3a0802; }
body[data-look="steampunk"] .lbl.on.need b { color: #2a1606; }
body[data-look="steampunk"] .lbl.on.error b { color: #ffe2d0; }
/* A project's name is 'on' its hub (placed first) but no plate face: its tag, at the size it was measured at, over a plate's end. */
body[data-look="steampunk"] .lbl.project.on { z-index: 1; width: auto; container-type: normal; padding: 2px 7px 3px; border-radius: 2px; background: linear-gradient(#3a2814, #140c05); box-shadow: 0 0 0 1px #c99a4a, inset 0 0 0 1px #000, 0 2px 5px rgba(0, 0, 0, .75); }
body[data-look="steampunk"] .lbl.project.on b { display: block; max-width: none; white-space: nowrap; line-height: inherit; }
body[data-look="steampunk"] .lbl.project.on .k { display: inline-block; }
body[data-look="steampunk"] .lbl.you.on { aspect-ratio: ${PLATE.you.w} / ${PLATE.you.h}; }
body[data-look="steampunk"] .lbl.you.on b { font-size: clamp(9.5px, 12.5cqi, 16px); }
body[data-look="steampunk"] .lbl.you.on span { display: block; font-size: clamp(8px, 9.5cqi, 12px); }
/* A subagent's name is no tag of its own, just chalked on the floor beside its little machine. */
body[data-look="steampunk"] .lbl.sub { padding: 0 3px; background: none; box-shadow: none; text-shadow: 0 1px 2px #000, 0 0 6px rgba(0, 0, 0, .9); }
body[data-look="steampunk"] .lbl.sub b { font-size: 11px; font-style: italic; }
body[data-look="steampunk"] .lbl.sub:not(.need, .error) b { color: #c9b48e; }`,

  create(ctx) {
    const { root, renderer, camera, world } = ctx, scene = ctx.scene;
    const rnd = Math.random, own = [];
    ctx.setView({ tilt: .5, fov: 30 });
    ctx.setMotion(kit.RIGID);
    ctx.setSizes({ you: BR - .6, project: JR * JS + .3, session: 1.5, sub: .3 * KS });
    ctx.setPost({ bloom: { strength: .45, radius: .5, threshold: 1.25 }, exposure: 1.1, toneMapping: THREE.ACESFilmicToneMapping });
    ctx.addPass(kit.vignettePass({ darkness: .75, grain: .03, tint: '#fff0da' }));
    scene.background = new THREE.Color('#090605');
    scene.environment = envFor(renderer); scene.environmentIntensity = .26;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;

    // Warm gaslight key, a cool rim and a dim fill.
    const key = new THREE.DirectionalLight('#ffd9a8', 2.4); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -.0004; key.shadow.normalBias = .03;
    const rimL = new THREE.DirectionalLight('#a9c1ff', .4); rimL.position.set(18, 12, -22);
    root.add(key, key.target, rimL, new THREE.HemisphereLight('#ffe2bc', '#140c05', .4));

    const tex = t => (own.push(t), t);
    const dialTex = tex(kit.canvasTexture(256, (g, s) => {
      const c = s / 2, r = s * .48, ang = f => 5 * PI / 4 - f * 3 * PI / 2, at = (f, rr) => [c + Math.cos(ang(f)) * rr, c - Math.sin(ang(f)) * rr];
      const gr = g.createRadialGradient(c, c * .8, s * .05, c, c, r); gr.addColorStop(0, '#fbf3dc'); gr.addColorStop(1, '#d6c59c');
      g.fillStyle = gr; g.beginPath(); g.arc(c, c, r, 0, TAU); g.fill();
      g.strokeStyle = '#b8272a'; g.lineWidth = s * .08; g.beginPath(); g.arc(c, c, r * .74, -ang(.8), -ang(1)); g.stroke();
      for (let i = 0; i <= 20; i++) { const f = i / 20, big = i % 5 === 0; g.strokeStyle = f > .8 ? '#6e0d08' : '#2a1d10'; g.lineWidth = s * (big ? .03 : .014); g.beginPath(); g.moveTo(...at(f, r * (big ? .56 : .66))); g.lineTo(...at(f, r * .84)); g.stroke(); }
      g.strokeStyle = '#2a1d10'; g.lineWidth = s * .025; g.beginPath(); g.arc(c, c, r * .96, 0, TAU); g.stroke();
      g.lineWidth = s * .01; g.beginPath(); g.arc(c, c, r * .3, -ang(0), -ang(1)); g.stroke();
    }));

    // ── Materials ──
    const mat = o => new THREE.MeshStandardMaterial(o);
    const brassMat = mat({ color: '#c99a4a', metalness: 1, roughness: .38 });
    const steelMat = mat({ color: '#b9bec4', metalness: 1, roughness: .28 });
    const blackMat = mat({ color: '#16120e', metalness: .5, roughness: .45 });
    const leatherMat = mat({ color: '#4a2c18', metalness: 0, roughness: .7 });
    const lampMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const dialMat = new THREE.MeshBasicMaterial({ map: dialTex, color: '#ffffff' });
    // The bodies: per-vertex metal, a little grime, darker where they meet the floor, diamond plate where marked; the fire glows by the instance's alpha.
    const bodyMat = mat({ vertexColors: true, metalness: 1, roughness: 1 });
    bodyMat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aMR; varying vec3 vMR; varying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvMR = aMR; vObj = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vMR; varying vec3 vObj;
float spH(vec3 p) { p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float spN(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(spH(i), spH(i + vec3(1., 0., 0.)), f.x), mix(spH(i + vec3(0., 1., 0.)), spH(i + vec3(1., 1., 0.)), f.x), f.y),
    mix(mix(spH(i + vec3(0., 0., 1.)), spH(i + vec3(1., 0., 1.)), f.x), mix(spH(i + vec3(0., 1., 1.)), spH(i + vec3(1., 1., 1.)), f.x), f.y), f.z); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
float grime = spN(vObj * 6.) * .6 + spN(vObj * 19.) * .4;
vec2 tp = vObj.xz * 6.5, tf = fract(tp) - .5, tr = mod(floor(tp.x) + floor(tp.y), 2.) > .5 ? vec2(tf.x + tf.y, tf.x - tf.y) : vec2(tf.x - tf.y, tf.x + tf.y);
float lozenge = step(vMR.z, -.5) * (1. - smoothstep(.09, .14, length(vec2(tr.x * .32, tr.y))));
diffuseColor.rgb *= (.74 + .38 * grime) * (.55 + .45 * smoothstep(0., .22, vObj.y)) * (1. + 1.6 * lozenge);`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(vMR.y + (.5 - grime) * .3 - .35 * lozenge, .05, 1.);')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMR.x;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(2.6, .9, .22) * max(vMR.z, 0.) * vColor.a;');
    };
    bodyMat.customProgramCacheKey = () => 'sp-body';

    // Instances are written through put/putC, which only touch what changed and widen a dirty range; flush uploads just that range, so a
    // still board uploads nothing. The shadow map is drawn only when something that casts moved (shadowDirty), not every frame.
    const O = new THREE.Object3D(), insts = [];
    let shadowDirty = true;
    renderer.shadowMap.autoUpdate = false;
    function put(m, i) {
      O.updateMatrix(); const e = O.matrix.elements, a = m.instanceMatrix.array, o = i * 16; let d = false;
      for (let k = 0; k < 16; k++) { const v = Math.fround(e[k]); if (a[o + k] !== v) { a[o + k] = v; d = true; } }
      if (d) { if (i < m.lo) m.lo = i; if (i > m.hi) m.hi = i; }
    }
    function putC(m, i, c) {
      const a = m.instanceColor.array, o = i * 3, r = Math.fround(c.r), gg = Math.fround(c.g), b = Math.fround(c.b);
      if (a[o] === r && a[o + 1] === gg && a[o + 2] === b) return;
      a[o] = r; a[o + 1] = gg; a[o + 2] = b; if (i < m.clo) m.clo = i; if (i > m.chi) m.chi = i;
    }
    const track = m => { m.lo = m.clo = Infinity; m.hi = m.chi = -1; insts.push(m); return m; };
    function flush(m) {
      if (m.hi >= m.lo) { m.instanceMatrix.addUpdateRange(m.lo * 16, (m.hi - m.lo + 1) * 16); m.instanceMatrix.needsUpdate = true; if (m.castShadow) shadowDirty = true; m.lo = Infinity; m.hi = -1; }
      if (m.chi >= m.clo) { m.instanceColor.addUpdateRange(m.clo * 3, (m.chi - m.clo + 1) * 3); m.instanceColor.needsUpdate = true; m.clo = Infinity; m.chi = -1; }
    }
    function setT(m, i, x, y, z, ry = 0, sx = 1, sy = sx, sz = sx) { O.position.set(x, y, z); O.rotation.set(0, ry, 0); O.scale.set(Math.max(1e-4, sx), Math.max(1e-4, sy), Math.max(1e-4, sz)); put(m, i); }
    function setR(m, i, x, y, z, rx, ry, rz, sx, sy = sx, sz = sx, order = 'XYZ') { O.position.set(x, y, z); O.rotation.set(rx, ry, rz, order); O.scale.set(Math.max(1e-4, sx), Math.max(1e-4, sy), Math.max(1e-4, sz)); put(m, i); }
    const hide = (m, i) => setT(m, i, 0, -50, 0, 0, 0);
    // Only the big shapes cast (bodies, pipes, plate frames, televisor slabs, fittings): small moving parts would redraw the shadow
    // map whenever they turn, for shadows nobody sees at this distance.
    function inst(geo, material, count, { cast = false, color } = {}) {
      const m = track(new THREE.InstancedMesh(geo, material, Math.max(1, count))); m.frustumCulled = false; m.castShadow = cast; m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (color !== undefined) { const c = new THREE.Color(color); for (let i = 0; i < m.count; i++) m.setColorAt(i, c); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
      for (let i = 0; i < m.count; i++) hide(m, i);
      root.add(m); return m;
    }
    const NS = world.sessions.length, NP = world.projects.length, NK = world.subs.length, NPIPE = NP + NS + NK;

    // ── The machines: one batched draw for every body ──
    const YOU = cached('you', boilerParts);
    const PM = world.projects.map(p => cached(`h${p.seed}`, () => hubParts(p.seed)));
    const UM = world.sessions.map(s => cached(`s${s.seed}${s.provider}`, () => unitParts(s.seed, s.provider)));
    let nv = 0, ni = 0;
    for (const { geo } of [YOU, ...PM, ...UM]) { nv += geo.attributes.position.count; ni += geo.index.count; }
    const batch = new THREE.BatchedMesh(1 + NP + NS, nv, ni, bodyMat);
    batch.castShadow = batch.receiveShadow = true; batch.frustumCulled = false; root.add(batch);
    const addBody = p => batch.addInstance(batch.addGeometry(p.geo));
    const youId = addBody(YOU), V4 = new THREE.Vector4();
    // three re-sorts and re-culls a BatchedMesh every frame unless both are off; there's one opaque body each, always on screen.
    batch.sortObjects = false; batch.perObjectFrustumCulled = false;
    // Its matrices and colours live in textures three re-uploads whole on any set: write only what changed.
    const NB = 1 + NP + NS, bM = new Float32Array(16 * NB).fill(NaN), bC = new Float32Array(4 * NB).fill(NaN);
    function bMat(id, m) { const e = m.elements, o = id * 16; let d = false; for (let k = 0; k < 16; k++) { const v = Math.fround(e[k]); if (bM[o + k] !== v) { bM[o + k] = v; d = true; } } if (d) { batch.setMatrixAt(id, m); shadowDirty = true; } }
    function bCol(id, v) { const o = id * 4, x = Math.fround(v.x), y = Math.fround(v.y), z = Math.fround(v.z), w = Math.fround(v.w); if (bC[o] === x && bC[o + 1] === y && bC[o + 2] === z && bC[o + 3] === w) return; bC[o] = x; bC[o + 1] = y; bC[o + 2] = z; bC[o + 3] = w; batch.setColorAt(id, v); }
    function bVis(id, on) { if (batch.getVisibleAt(id) !== on) { batch.setVisibleAt(id, on); shadowDirty = true; } }

    // ── Moving and lit parts, instanced across all machines ──
    const rigsU = UM.map(u => u.rig);
    const nGauge = 1 + NP + rigsU.reduce((s, r) => s + r.gauges.length, 0) + 2 * NS, nWheel = rigsU.reduce((s, r) => s + r.wheels.length, 0), nRod = rigsU.reduce((s, r) => s + r.rods.length, 0);
    const nPip = world.sessions.reduce((s, n) => s + Math.min(PLAN.max, n.plan?.total || 0), 0);
    const dialGeo = new THREE.CircleGeometry(1, 40).rotateX(-HP), needleGeo = merge([place(box(.8, .03, .07), .3, .03, 0), place(cyl(.08, .08, .05, 12), 0, .03, 0), place(box(.22, .03, .1), -.12, .03, 0)]);
    const dials = inst(dialGeo, dialMat, nGauge, { color: '#ffffff' });
    const needles = inst(needleGeo, blackMat, nGauge);
    const wheels = inst(merge([torus(1, .08, 6, 36), ...Array.from({ length: 6 }, (_, i) => place(box(.92, .07, .05), Math.cos(i * PI / 3) * .48, Math.sin(i * PI / 3) * .48, 0, 0, 0, i * PI / 3)),
      place(cyl(.16, .16, .2, 14), 0, 0, 0, HP), place(cyl(.06, .06, .14, 8), .45, 0, .12, HP)]), mat({ color: '#ffffff', metalness: .8, roughness: .4 }), nWheel, { color: '#4a3a2c' });
    const rods = inst(merge([place(cyl(1, 1, 1, 8), 0, .5, 0), place(box(2.6, .22, 2.6), 0, 1, 0)]), steelMat, nRod);
    const govs = inst(merge([place(cyl(.03, .03, .5, 8), 0, .25, 0), place(ball(.045, 10, 6), 0, .52, 0), place(cyl(.06, .06, .05, 10), 0, .3, 0),
      ...[-1, 1].flatMap(s => [place(box(.02, .26, .02), s * .09, .4, 0, 0, 0, s * .6), place(ball(.065, 12, 8), s * .17, .3, 0)])]), brassMat, NP);
    const bellows = inst(new THREE.LatheGeometry([[.11, 0], [.13, .04], [.09, .08], [.13, .12], [.09, .16], [.13, .2], [.11, .24], [0, .25]].map(([r, y]) => new THREE.Vector2(r, y)), 16), leatherMat, NS);
    const fills = inst(place(cyl(.052, .052, 1, 10), .5, 0, 0, 0, 0, HP), lampMat, NS, { color: '#000000' });
    // Indicator bulbs (HDR colour, blooms): machines' mode bulbs, plan pips, a bulb per session on its junction, subagent bulbs, the
    // boiler's inlet bulbs and the televisors' rows.
    const nJB = world.projects.reduce((s, p) => s + Math.min(6, p.sessions.length), 0);
    const L_PIP = NS, L_JB = L_PIP + nPip, L_SUB = L_JB + nJB, L_JUN = L_SUB + NK, L_TVB = L_JUN + NP;
    const lamps = inst(ball(1, 12, 8), lampMat, L_TVB + 5 * NS, { color: '#000000' });
    // Filament tubes: a brass socket and tip, fresnel glass lit from inside, and the filament itself (the only part that blooms).
    // Two on every machine, two on every junction, four by the gauge board, four on every televisor.
    const T_J = 2 * NS, T_Y = T_J + 2 * NP, T_TV = T_Y + 4, NT = T_TV + 4 * NS;
    const glassMat = mat({ color: '#e6d6b4', metalness: 0, roughness: .06, transparent: true, depthWrite: false, envMapIntensity: 1.4 });
    glassMat.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '').replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float rim = 1. - abs(dot(normalize(vNormal), normalize(vViewPosition)));
diffuseColor.a = .14 + .6 * rim * rim;
totalEmissiveRadiance += vColor.rgb * (.22 + .8 * rim * rim);`);
    };
    glassMat.customProgramCacheKey = () => 'sp-glass';
    const tubeCap = inst(merge([place(cyl(1.15, .95, .22, 14), 0, .11, 0), place(torus(1.02, .09, 6, 18), 0, .22, 0, HP), place(cyl(.22, .32, .1, 8), 0, 1.07, 0)]), brassMat, NT);
    const tubeGlass = inst(new THREE.LatheGeometry([[.95, .2], [1, .27], [1, .82], [.9, .95], [.62, 1.03], [.25, 1.07], [0, 1.075]].map(([x, y]) => new THREE.Vector2(x, y)), 16), glassMat, NT, { color: '#000000' });
    tubeGlass.renderOrder = 1;
    const tubeFil = inst(merge([place(cyl(.07, .07, .4, 5), -.4, .42, 0), place(cyl(.07, .07, .4, 5), .4, .42, 0),
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[-.4, .6], [-.25, .88], [-.08, .62], [.08, .88], [.25, .62], [.4, .6]].map(([x, y]) => new THREE.Vector3(x, y, 0))), 30, .1, 5)]), lampMat, NT, { color: '#000000' });
    const tGl = new THREE.Color();
    function tube(k, x, y, z, r, h, glow) {
      setT(tubeCap, k, x, y, z, 0, r, h, r); setT(tubeGlass, k, x, y, z, 0, r, h, r); setT(tubeFil, k, x, y, z, 0, r, h, r);
      putC(tubeFil, k, glow); putC(tubeGlass, k, tGl.copy(glow).multiplyScalar(.32));
    }
    const hideTube = k => { hide(tubeCap, k); hide(tubeGlass, k); hide(tubeFil, k); };
    // Soft light the tubes and fires cast on the floor.
    const POOL_P = 1, POOL_S = 1 + NP;
    const pools = inst(new THREE.PlaneGeometry(1, 1).rotateX(-HP), new THREE.MeshBasicMaterial({ map: kit.glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), POOL_S + NS, { color: '#000000' });
    // Subagents: a little valve beside their machine; the handwheel turns while it works.
    const kBody = inst(merge([oct(.2, .22, .08, .04), place(cyl(.03, .03, .26, 8), 0, .2, 0), place(cyl(.06, .075, .07, 10), 0, .11, 0)]), brassMat, NK);
    const kWheel = inst(merge([place(torus(.13, .022, 6, 24), 0, .33, 0, HP), bar(-.13, 0, .13, 0, .025, .025, .33), bar(0, -.13, 0, .13, .025, .025, .33), place(cyl(.035, .035, .05, 8), 0, .33, 0)]),
      mat({ color: '#ffffff', metalness: 1, roughness: .25 }), NK, { color: '#3a5bd0' });
    // Nameplates: a canvas face each, on a shared dark frame and two posts.
    const NPL = NS + NP + 1, frames = inst(box(1, 1, 1), blackMat, NPL, { cast: true }), posts = inst(cyl(.035, .045, 1, 8), brassMat, NPL * 2);
    // Televisors, all in floor units round the screen's centre: a walnut slab with the bulging screen on it in a bent brass frame with a
    // finial, the walnut console along its back edge with grille plates, knobs, two meter cases, a red cloth wire to a tube, and a brass
    // conduit to the machine. The screen is a canvas each, made when a session first has a screenshot.
    const CZ = -TV.sh / 2 - .38, CY = .32, conduitZ = (MZ - TV.z) / TV.k, conduitX = (AU * US - TV.x) / TV.k;
    const TV_TUBES = [[-1.22, .11, .72], [-.97, .08, .46], [.97, .08, .46], [1.22, .11, .72]], TV_METERS = [[.22, .44, CZ + .17], [.54, .44, CZ + .17]];
    const TV_MC = TV_METERS.map(([x, y, z]) => ({ x, y, z, r: .1, t: .55 }));
    const tvWood = inst(merge([place(box(TV.sw + .34, .12, TV.sh + .3), 0, .06, .05), place(box(TV.sw + .44, CY, .56), 0, CY / 2, CZ)]), mat({ color: '#4a2a16', metalness: .05, roughness: .5 }), NS, { cast: true });
    const tvBrass = inst(merge([
      new THREE.TubeGeometry(new RoundRect(TV.sw / 2 + .07, TV.sh / 2 + .07, .36, .16), 120, .035, 6, true),
      place(cyl(.02, .03, .1, 8), 0, .2, -TV.sh / 2 - .07), place(ball(.05, 10, 6), 0, .27, -TV.sh / 2 - .07),
      place(box(TV.sw + .46, .03, .04), 0, CY + .01, CZ + .27), ...[-1, 1].map(sd => place(box(.5, .2, .02), sd * 1.15, CY * .5, CZ + .285)),
      ...[-.62, -.4, -.18].flatMap(x => [place(cyl(.075, .085, .06, 14), x, CY + .03, CZ + .08), place(box(.02, .02, .07), x, CY + .07, CZ + .06)]),
      ...TV_METERS.flatMap(([x, y, z]) => [place(cyl(.125, .115, .06, 18), x, y - .03, z - .02, .55), place(flat(torus(.122, .014, 5, 20)), x, y + .003, z, .55), place(cyl(.02, .02, y - CY, 6), x, (y + CY) / 2, z - .04)]),
      place(cyl(.045, .045, -conduitX - TV.sw / 2 - .17, 10), (conduitX - TV.sw / 2 - .17) / 2, .07, conduitZ, 0, 0, HP), place(cyl(.075, .075, .05, 10), -TV.sw / 2 - .17, .07, conduitZ, 0, 0, HP)]), brassMat, NS);
    const tvWire = inst(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-1.22, CY + .8, CZ), new THREE.Vector3(-1.5, CY + .9, CZ + .7), new THREE.Vector3(-TV.sw / 2 - .07, .17, -TV.sh / 2 + .2)), 16, .018, 5), mat({ color: '#9a1c12', roughness: .8 }), NS);
    const tvT = { value: 0 }, tvGeo = (() => {
      const g = new THREE.PlaneGeometry(TV.sw, TV.sh, 24, 16), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const u = 2 * p.getX(i) / TV.sw, v = 2 * p.getY(i) / TV.sh; p.setZ(i, .1 * Math.max(0, 1 - u * u) * Math.max(0, 1 - v * v)); }
      g.rotateX(-HP); g.computeVertexNormals(); return g;
    })();
    // The screen glows; while its machine is busy a faint band rolls down it and it flickers a touch (each screen's own uRoll, eased, so
    // an idle televisor is a still picture and costs no frames; none with reduced motion). Its square corners are cut away.
    // The picture is all emission (black diffuse, so the key light can't wash it out) and stays below the bloom threshold even for a
    // white page, so screenshots read; a rough glass sheen keeps it a tube.
    const TV_GLOW = .6;
    function makeTV() {
      const cv = document.createElement('canvas'); cv.width = TV.cw; cv.height = TV.ch;
      const t = tex(new THREE.CanvasTexture(cv)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
      const m = mat({ color: '#000000', map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: TV_GLOW, metalness: 0, roughness: .22, envMapIntensity: .3, alphaTest: .5 });
      const roll = { value: 0 };
      m.onBeforeCompile = sh => {
        sh.uniforms.uTvT = tvT; sh.uniforms.uRoll = roll;
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTvT; uniform float uRoll;').replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float rd = (fract(vMapUv.y - uTvT * .11) - .5) * 7.;
totalEmissiveRadiance *= 1. + uRoll * (.12 * exp(-rd * rd) + .03 * sin(uTvT * 47.));`);
      };
      m.customProgramCacheKey = () => 'sp-tv';
      const mesh = new THREE.Mesh(tvGeo, m); mesh.receiveShadow = true; root.add(mesh);
      return { g: cv.getContext('2d'), tex: t, mesh, shot: null, roll };
    }

    // ── Per-node state ──
    const body = (ap, cr, free, slots) => ({ x: 0, z: 0, ap, cr, free, slots, used: new Int8Array(8), on: true });
    const ALL8 = [0, 1, 2, 3, 4, 5, 6, 7];
    const B_YOU = body(AB, BR + .2, [0, 1, 3, 4, 5, 6, 7], [0, .9, -.9]);
    const PG = new Map(), SG = new Map(), KG = new Map();
    let gi = 1, wi = 0, ri = 0, pi0 = 0, jb0 = 0;
    world.projects.forEach((p, i) => PG.set(p, { i, rig: PM[i].rig, bid: addBody(PM[i]), x: 0, z: 0, gv: 0, w: 0, pr: 0, col: new THREE.Color(), glow: new THREE.Color(), q: {}, jb: (jb0 += Math.min(6, p.sessions.length)) - Math.min(6, p.sessions.length), init: false, body: body(JA, JR * JS + .15, ALL8, [0, .5 * JS, -.5 * JS]), gauge: gi++ }));
    world.sessions.forEach((s, i) => {
      const rig = rigsU[i], pips = Math.min(PLAN.max, s.plan?.total || 0);
      SG.set(s, { i, rig, bid: addBody(UM[i]), glow: new THREE.Color(), x: 0, z: 0, sx: 0, sz: 0, px: 0, pz: 0, ox: 0, oz: 0, a: 0, ph: rnd() * TAU, bp: 0, nd: 0, h2: 0, wh: rnd(), sp: rnd(), sc: 0, body: body(AU * US, UR * US + .05, UNIT_FREE, [0]),
        gauge: rig.gauges.map(() => gi++), meters: [gi++, gi++], wheel: rig.wheels.map(() => wi++), rod: rig.rods.map(() => ri++), pip: pi0, pips });
      pi0 += pips;
    });
    // Every machine's televisor is a click target for its screenshots; the engine only takes the click while there are some.
    for (const s of world.sessions) SG.get(s).target = ctx.addTarget?.({ node: s, pos: new THREE.Vector3(0, -50, 0), radius: 1.35 * TV.k, hx: (TV.sw / 2 + .1) * TV.k, hz: (TV.sh / 2 + .1) * TV.k, action: 'shots' });
    world.subs.forEach((k, i) => KG.set(k, { i, x: 0, z: 0, ox: 0, oz: 0, th: rnd() * TAU, body: body(AK, .24 * KS, ALL8, [0]) }));
    const BODIES = [B_YOU, ...[...PG.values(), ...SG.values(), ...KG.values()].map(g => g.body)];
    // Nameplates and televisors are obstacles for the pipes too: [x0, x1, z0, z1, solid] on the floor, refreshed with the layout. A
    // televisor is solid; a pipe may pass under a nameplate when it must.
    const PLATES_AT = [];

    // ── Plumbing. Each pipe is routed on the floor between two octagonal bodies: out of a face, straight runs joined by short-radius
    // 45° or 90° elbows, into a face of the other. All pipes share one mesh; aPipe/aT let the shader light pulses per pipe. ──
    const facesToward = (B, ang) => {
      const free = B.free.filter(k => B.used[k] < B.slots.length), list = free.length ? free : B.free;
      return list.map(k => [k, Math.abs(Math.atan2(Math.sin(k * PI / 4 - ang), Math.cos(k * PI / 4 - ang)))]).sort((a, b) => a[1] - b[1]).slice(0, 3).map(a => a[0]);
    };
    const portOf = (B, k) => { const [dx, dz] = FD[k], o = B.slots[Math.min(B.used[k], B.slots.length - 1)]; return { x: B.x + dx * B.ap - dz * o, z: B.z + dz * B.ap + dx * o, dx, dz }; };
    function blocked(pts, A, B, r, plates) {
      for (const b of BODIES) {
        if (!b.on) continue;
        const lim = b === A || b === B ? b.ap - .02 : b.cr + r + .05;
        if (Math.abs(b.x - (pts[0][0] + pts.at(-1)[0]) / 2) > 30) continue;
        for (let i = 1; i < pts.length; i++) if (segDist(b.x, b.z, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) < lim) return true;
      }
      for (const [x0, x1, z0, z1, solid] of PLATES_AT) if (plates || solid) for (let i = 1; i < pts.length; i++) if (segRect(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], x0 - r, x1 + r, z0 - r, z1 + r)) return true;
      return false;
    }
    // Candidates: straight, one elbow, or two elbows through a middle direction u (three ways to split the slack). Best clear one wins;
    // failing that the best that only passes under a nameplate (they stand clear of the floor), then the best of all.
    function route(A, B, r) {
      const rb = 2.2 * r, m = 2.4 * r + rb + .04, mid = 2 * rb + .06, ang = Math.atan2(B.z - A.z, B.x - A.x), cands = [];
      const fa = facesToward(A, ang), fb = facesToward(B, ang + PI);
      fa.forEach((ka, ia) => fb.forEach((kb, ib) => {
        const S = portOf(A, ka), E = portOf(B, kb), ds = FD[ka], de = FD[kb], wx = E.x - S.x, wz = E.z - S.z, dd = ds[0] * de[0] + ds[1] * de[1], pen = (ia + ib) * .3;
        const add = (pts, bends) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cands.push({ S, E, ka, kb, pts, score: L + bends * .5 + pen }); };
        if (dd < -.99) { const along = wx * ds[0] + wz * ds[1], perp = -wx * ds[1] + wz * ds[0]; if (along > 2 * m && Math.abs(perp) < .05) add([[S.x, S.z], [E.x, E.z]], 0); }
        if (dd < .1 && dd > -.9) { const v = solve2(ds[0], ds[1], -de[0], -de[1], wx, wz); if (v && v[0] >= m && v[1] >= m) add([[S.x, S.z], [S.x + ds[0] * v[0], S.z + ds[1] * v[0]], [E.x, E.z]], 1); }
        for (const u of FD) {
          const su = ds[0] * u[0] + ds[1] * u[1], ue = -(u[0] * de[0] + u[1] * de[1]);
          if (su < -.01 || su > .9 || ue < -.01 || ue > .9) continue;
          const jog = (a, c, b) => { if (a >= m && b >= m && c >= mid) { const x1 = S.x + ds[0] * a, z1 = S.z + ds[1] * a; add([[S.x, S.z], [x1, z1], [x1 + u[0] * c, z1 + u[1] * c], [E.x, E.z]], 2); } };
          let v = solve2(u[0], u[1], -de[0], -de[1], wx - m * ds[0], wz - m * ds[1]); if (v) jog(m, v[0], v[1]);
          v = solve2(ds[0], ds[1], u[0], u[1], wx + m * de[0], wz + m * de[1]); if (v) jog(v[0], v[1], m);
          v = solve2(ds[0] - de[0], ds[1] - de[1], u[0], u[1], wx, wz); if (v) jog(v[0], v[1], v[0]);
        }
      }));
      cands.sort((a, b) => a.score - b.score);
      let best = cands.find(c => !blocked(c.pts, A, B, r, true)) || cands.find(c => !blocked(c.pts, A, B, r, false)) || cands[0];
      if (!best) { const S = portOf(A, fa[0]), E = portOf(B, fb[0]); best = { S, E, ka: fa[0], kb: fb[0], pts: [[S.x, S.z], [E.x, E.z]] }; }
      A.used[best.ka]++; B.used[best.kb]++;
      return best;
    }
    // Centre line with the elbows rounded at radius 2.2r: samples (point, tangent, arc length), straight runs and elbow ends.
    function makePath(rt, r) {
      const rb = 2.2 * r, pts = rt.pts, samples = [], runs = [], elbows = [];
      let s = 0;
      const push = (x, z, tx, tz) => { const l = samples.at(-1); if (l) s += Math.hypot(x - l.x, z - l.z); samples.push({ x, z, tx, tz, s }); };
      const dir = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
      const run = (a, b, d) => runs.push({ x0: a.x, z0: a.z, x1: b.x, z1: b.z, dx: d[0], dz: d[1], s0: a.s, s1: b.s });
      let d1 = dir(pts[0], pts[1]);
      push(pts[0][0], pts[0][1], d1[0], d1[1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const P = pts[i], d2 = dir(P, pts[i + 1]), th = Math.acos(clamp(d1[0] * d2[0] + d1[1] * d2[1], -1, 1));
        if (th < 1e-3) { d1 = d2; continue; }
        const tl = rb * Math.tan(th / 2), ax = P[0] - d1[0] * tl, az = P[1] - d1[1] * tl, a0s = samples.at(-1);
        push(ax, az, d1[0], d1[1]); run(a0s, samples.at(-1), d1);
        elbows.push({ x: ax, z: az, tx: d1[0], tz: d1[1], s });
        const sg = Math.sign(d1[0] * d2[1] - d1[1] * d2[0]), cx = ax - sg * d1[1] * rb, cz = az + sg * d1[0] * rb, a0 = Math.atan2(az - cz, ax - cx), N = Math.max(3, Math.ceil(th / (PI / 16)));
        for (let k = 1; k <= N; k++) { const a = a0 + sg * th * k / N; push(cx + Math.cos(a) * rb, cz + Math.sin(a) * rb, -Math.sin(a) * sg, Math.cos(a) * sg); }
        const e = samples.at(-1); elbows.push({ x: e.x, z: e.z, tx: d2[0], tz: d2[1], s: e.s });
        d1 = d2;
      }
      const a0s = samples.at(-1), last = pts.at(-1);
      push(last[0], last[1], d1[0], d1[1]); run(a0s, samples.at(-1), d1);
      const len = Math.max(.01, s);
      return { samples, runs, elbows, len, S: rt.S, E: rt.E, joints: elbows.map(e => e.s / len) };
    }
    function pointAt(path, t, out) {
      const d = clamp(t, 0, 1) * path.len, sm = path.samples; let lo = 0, hi = sm.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (sm[mid].s <= d) lo = mid; else hi = mid; }
      const a = sm[lo], b = sm[hi], f = (d - a.s) / Math.max(1e-6, b.s - a.s);
      return out.set(a.x + (b.x - a.x) * f, 0, a.z + (b.z - a.z) * f);
    }

    const pipeU = { uP: { value: [] }, uG: { value: [] }, uM: { value: [] } };
    for (let i = 0; i < NPIPE; i++) { pipeU.uP.value.push(new THREE.Vector4(-1, -1, -1, -1)); pipeU.uG.value.push(new THREE.Vector4(-1, -1, -1, -1)); pipeU.uM.value.push(new THREE.Vector4()); }
    const pipeMat = mat({ vertexColors: true, metalness: 1, roughness: .3 });
    pipeMat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, pipeU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aT; attribute float aPipe; varying float vSpT; varying float vPipe;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSpT = aT; vPipe = aPipe;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec4 uP[${Math.max(1, NPIPE)}]; uniform vec4 uG[${Math.max(1, NPIPE)}]; uniform vec4 uM[${Math.max(1, NPIPE)}]; varying float vSpT; varying float vPipe;
float spP(float c, float w) { float d = (vSpT - c) / w; return c < 0. ? 0. : exp(-d * d); }
float spSum(vec4 c, float w) { return spP(c.x, w) + spP(c.y, w) + spP(c.z, w) + spP(c.w, w); }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
int pk = int(vPipe + .5); vec4 pm = uM[pk];
totalEmissiveRadiance += vec3(1., .42, .15) * (spSum(uP[pk], pm.z) * 1.1 + pm.y) + vec3(.85, .45, .08) * (spSum(uG[pk], pm.z * 1.3) + pm.x);`);
    };
    pipeMat.customProgramCacheKey = () => 'sp-pipes' + NPIPE;
    const pipeMesh = new THREE.Mesh(new THREE.BufferGeometry(), pipeMat); pipeMesh.castShadow = pipeMesh.receiveShadow = true; pipeMesh.frustumCulled = false; root.add(pipeMesh);
    const TIER_COL = [null, new THREE.Color('#c8754a'), new THREE.Color('#c99a4a'), new THREE.Color('#c07a52')], RAD = 12;
    function buildPipeMesh(list) {
      let nvp = 0, nip = 0; for (const p of list) { nvp += p.path.samples.length * (RAD + 1); nip += (p.path.samples.length - 1) * RAD * 6; }
      const pos = new Float32Array(nvp * 3), nor = new Float32Array(nvp * 3), col = new Float32Array(nvp * 3), at = new Float32Array(nvp), ap = new Float32Array(nvp), idx = new Uint32Array(nip);
      let v = 0, q = 0;
      for (const p of list) {
        const { samples, len } = p.path, r = p.r, y = PY * r, c = TIER_COL[p.tier], base = v;
        for (const sm of samples) for (let k = 0; k <= RAD; k++) {
          const f = k / RAD * TAU, cc = Math.cos(f), ss = Math.sin(f), nx = -cc * sm.tz, nz = cc * sm.tx;
          pos[v * 3] = sm.x + r * nx; pos[v * 3 + 1] = y + r * ss; pos[v * 3 + 2] = sm.z + r * nz;
          nor[v * 3] = nx; nor[v * 3 + 1] = ss; nor[v * 3 + 2] = nz;
          col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b; at[v] = sm.s / len; ap[v] = p.idx; v++;
        }
        for (let j = 0; j < samples.length - 1; j++) for (let k = 0; k < RAD; k++) { const a = base + j * (RAD + 1) + k, b = a + RAD + 1; idx[q++] = a; idx[q++] = b; idx[q++] = a + 1; idx[q++] = a + 1; idx[q++] = b; idx[q++] = b + 1; }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aT', new THREE.BufferAttribute(at, 1)); g.setAttribute('aPipe', new THREE.BufferAttribute(ap, 1)); g.setIndex(new THREE.BufferAttribute(idx, 1));
      pipeMesh.geometry.dispose(); pipeMesh.geometry = g;
    }
    // Fittings, modelled for a radius-1 pipe along +x: flanged inlet with a reducer, joint flanges, clamp brackets, gate valve, relief tee.
    const boltRing = (n, Rr, rr, len, x) => Array.from({ length: n }, (_, i) => { const a = (i + .5) / n * TAU; return place(cyl(rr, rr, len, 6), x, PY + Math.cos(a) * Rr, Math.sin(a) * Rr, 0, 0, HP); });
    const portM = inst(merge([place(cyl(1.35, 1.35, 1, 20), .5, PY, 0, 0, 0, HP), place(cyl(1.85, 1.85, .35, 24), 1.15, PY, 0, 0, 0, HP), ...boltRing(6, 1.55, .14, .6, 1.15),
      place(cyl(1.35, 1, .6, 20), 1.62, PY, 0, 0, 0, HP)]), brassMat, NPIPE * 2, { cast: true });
    const flangeM = inst(merge([place(cyl(1.75, 1.75, .45, 24), 0, PY, 0, 0, 0, HP), ...boltRing(6, 1.45, .14, .8, 0)]), brassMat, 4 * (NP + NS), { cast: true });
    const bracketM = inst(merge([place(box(.7, .2, 3.2), 0, .1, 0), place(box(.45, 1.15, .26), 0, .67, 1.12), place(box(.45, 1.15, .26), 0, .67, -1.12),
      place(torus(1.12, .13, 6, 16, PI), 0, PY, 0, 0, HP, 0), place(cyl(.17, .17, .16, 6), 0, .26, 1.45), place(cyl(.17, .17, .16, 6), 0, .26, -1.45)]), blackMat, 8 * NP + 3 * NS, { cast: true });
    const valveM = inst(merge([place(ball(1.45, 16, 10), 0, PY, 0, 0, 0, 0, 1.1, 1, 1), place(cyl(1.25, 1.25, .4, 16), 1.7, PY, 0, 0, 0, HP), place(cyl(1.25, 1.25, .4, 16), -1.7, PY, 0, 0, 0, HP),
      place(cyl(.95, 1.05, 1.1, 14), 0, PY + 1.5, 0), place(cyl(.22, .22, 1.8, 8), 0, PY + 2.6, 0)]), brassMat, NP, { cast: true });
    const handM = inst(merge([place(torus(1.1, .16, 6, 28), 0, 0, 0, HP), bar(-1.1, 0, 1.1, 0, .18, .18), bar(0, -1.1, 0, 1.1, .18, .18), cyl(.3, .3, .3, 10)]), mat({ color: '#9a2a1c', metalness: .6, roughness: .35 }), NP);
    const reliefM = inst(merge([place(cyl(1.3, 1.3, 2.6, 16), 0, PY, 0, 0, 0, HP), place(cyl(1, 1, 1.4, 14), 0, PY + 1.2, 0), place(cyl(1.5, 1.5, .3, 16), 0, PY + 1.95, 0),
      place(cyl(.75, 1, 1.2, 14), 0, PY + 2.7, 0), place(hemi(.75, 14, 6), 0, PY + 3.3, 0), place(box(2.6, .22, .3), .9, PY + 3, 0), place(ball(.42, 10, 8), 2.1, PY + 2.85, 0)]), brassMat, NP, { cast: true });
    const RELIEF_TOP = PY + 3.7, WHEEL_Y = PY + 3.4;

    const mkPipe = (idx, tier, A, B, o) => ({ idx, tier, r: TIER_R[tier], A, B, on: tier === 1, pulses: new kit.Pulses(), gold: new kit.Pulses(), path: null, speed: 1, needT: 0, flash: 0, hw: 0, vent: 0, ...o });
    const pipes = [];
    world.projects.forEach((p, i) => pipes.push(mkPipe(i, 1, PG.get(p).body, B_YOU, { p, g: PG.get(p) })));
    world.sessions.forEach((s, i) => pipes.push(mkPipe(NP + i, 2, SG.get(s).body, PG.get(s.parent).body, { s, next: pipes[world.projects.indexOf(s.parent)] })));
    world.subs.forEach((k, i) => pipes.push(mkPipe(NP + NS + i, 3, KG.get(k).body, SG.get(k.parent).body, { k, next: pipes[NP + world.sessions.indexOf(k.parent)] })));
    const VALVE_AT = [.7, .78, .62, .86, .54, .92], RELIEF_AT = [.32, .24, .4, .16, .46, .1];
    function placeFittings(list) {
      let np = 0, nf = 0, nb = 0;
      for (const pp of list) {
        const P = pp.path, r = pp.r;
        setT(portM, np++, P.S.x, 0, P.S.z, -Math.atan2(P.S.dz, P.S.dx), r);
        setT(portM, np++, P.E.x, 0, P.E.z, -Math.atan2(P.E.dz, P.E.dx), r);
        if (pp.tier < 3) for (const e of P.elbows) if (nf < flangeM.count) setT(flangeM, nf++, e.x, 0, e.z, -Math.atan2(e.tz, e.tx), r);
        let avoid = [];
        if (pp.tier === 1) {
          const runs = P.runs.filter(rn => rn.s1 - rn.s0 > 2).sort((u, v) => (v.s1 - v.s0) - (u.s1 - u.s0)), long = runs[0] || P.runs[0];
          const at = (rn, f) => ({ x: rn.x0 + (rn.x1 - rn.x0) * f, z: rn.z0 + (rn.z1 - rn.z0) * f, s: rn.s0 + (rn.s1 - rn.s0) * f, ry: -Math.atan2(rn.dz, rn.dx) });
          // The valve and the relief stack stand taller than a nameplate's lift: each takes the first of its spots clear of them all,
          // on the longest run that has one, else any clear point on the line a fitting's length from a bend (and from the other one).
          const under = q => PLATES_AT.some(b => !b[4] && q.x > b[0] - .5 && q.x < b[1] + .5 && q.z > b[2] - .5 && q.z < b[3] + .7);
          const spotOn = (fs, not) => {
            const ok = q => !under(q) && !(not && Math.abs(q.s - not.s) < .9);
            for (const rn of runs) for (const f of fs) { const q = at(rn, f); if (ok(q)) return q; }
            for (const rn of P.runs) for (let d = .6, L = rn.s1 - rn.s0; d < L - .6; d += .2) { const q = at(rn, d / L); if (ok(q)) return q; }
            return at(long, fs[0]);
          };
          pp.valve = spotOn(VALVE_AT); pp.relief = spotOn(RELIEF_AT, pp.valve);
          setT(valveM, pp.idx, pp.valve.x, 0, pp.valve.z, pp.valve.ry, r); setT(reliefM, pp.idx, pp.relief.x, 0, pp.relief.z, pp.relief.ry, r);
          P.joints.push(pp.relief.s / P.len); avoid = [pp.valve.s, pp.relief.s];
        }
        if (pp.tier < 3) for (const rn of P.runs) {
          const L = rn.s1 - rn.s0, inset = 2.6 * r + .2, sp = pp.tier === 1 ? 1.5 : 1, use = L - 2 * inset;
          if (use < 0) continue;
          const n = Math.floor(use / sp) + 1;
          for (let j = 0; j < n && nb < bracketM.count; j++) {
            const s = rn.s0 + inset + (n === 1 ? use / 2 : use * j / (n - 1));
            if (avoid.some(a => Math.abs(a - s) < .55)) continue;
            const f = (s - rn.s0) / L; setT(bracketM, nb++, rn.x0 + (rn.x1 - rn.x0) * f, 0, rn.z0 + (rn.z1 - rn.z0) * f, -Math.atan2(rn.dz, rn.dx), r);
          }
        }
      }
      for (; np < portM.count; np++) hide(portM, np);
      for (; nf < flangeM.count; nf++) hide(flangeM, nf);
      for (; nb < bracketM.count; nb++) hide(bracketM, nb);
    }
    function rebuildPipes() {
      for (const b of BODIES) b.used.fill(0);
      const list = [];
      for (const pp of pipes) {
        if (!pp.on) { pp.path = null; continue; }
        pp.path = makePath(route(pp.A, pp.B, pp.r), pp.r); pp.speed = (pp.tier === 1 ? 5 : 3.5) / pp.path.len; list.push(pp);
      }
      buildPipeMesh(list); placeFittings(list); shadowDirty = true;
    }
    const sigNow = new Float32Array(2 * NP + 3 * NS + 3 * NK), sigBuilt = new Float32Array(sigNow.length).fill(NaN);

    // ── The floor: a dark deck of riveted iron plates, fading out past the plant, taking the shadows. The deck is one tiling texture
    // (DECK world units a side: two rows of 4×2 plates, staggered) pinned to the world, so the plates stay put as the layout grows. ──
    const DECK = 4;
    const deckTex = tex(kit.canvasTexture(512, (g, s) => {
      const r = kit.rng(0x5eed), u = s / DECK, wrap = (x, y, f) => { for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) f(x + dx, y + dy); };
      // Plates, each a slightly different iron, mottled with grime, oil and a little rust (drawn wrapped, so the tile has no edge).
      for (let row = 0; row < 2; row++) for (let i = -1; i < 2; i++) {
        const v = 172 + r() * 26; g.fillStyle = `rgb(${v},${v * .96},${v * .9})`; g.fillRect(i * 4 * u + row * 2 * u, row * 2 * u, 4 * u, 2 * u);
      }
      for (let i = 0; i < 90; i++) {
        const x = r() * s, y = r() * s, rad = u * (.15 + r() * .9), k = r(), c = k < .55 ? '30,24,18' : k < .85 ? '230,220,200' : '120,58,26', a = k < .55 ? .18 : k < .85 ? .06 : .1;
        wrap(x, y, (x, y) => { const q = g.createRadialGradient(x, y, 0, x, y, rad); q.addColorStop(0, `rgba(${c},${a})`); q.addColorStop(1, `rgba(${c},0)`); g.fillStyle = q; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); });
      }
      // Seams: a dark gap with a lit lip, rivets in a row either side.
      const seam = (x0, y0, x1, y1) => wrap(0, 0, (dx, dy) => {
        g.fillStyle = '#3a342e'; g.fillRect(x0 + dx - 1.5, y0 + dy - 1.5, x1 - x0 + 3, y1 - y0 + 3);
        g.fillStyle = 'rgba(235,225,205,.35)'; if (y0 === y1) g.fillRect(x0 + dx, y0 + dy + 1.5, x1 - x0, 1); else g.fillRect(x0 + dx + 1.5, y0 + dy, 1, y1 - y0);
      });
      const rivets = (x0, y0, x1, y1) => {
        const n = Math.round(Math.hypot(x1 - x0, y1 - y0) / (u * .25));
        for (let i = 0; i < n; i++) for (const side of [-1, 1]) {
          const f = (i + .5) / n, x = x0 + (x1 - x0) * f + (y0 === y1 ? 0 : side * 7), y = y0 + (y1 - y0) * f + (y0 === y1 ? side * 7 : 0);
          wrap(x, y, (x, y) => { g.fillStyle = 'rgba(40,34,28,.8)'; g.beginPath(); g.arc(x + .6, y + .8, 3.2, 0, TAU); g.fill(); g.fillStyle = '#d8cfbf'; g.beginPath(); g.arc(x - .5, y - .6, 1.4, 0, TAU); g.fill(); });
        }
      };
      for (const y of [0, 2 * u]) { seam(0, y, s, y); rivets(0, y, s, y); }
      for (const [x, y] of [[0, 0], [2 * u, 2 * u]]) { seam(x, y, x, y + 2 * u); rivets(x, y, x, y + 2 * u); }
    }));
    deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping;
    const floor = (() => {
      const g = new THREE.CircleGeometry(1, 64).rotateX(-HP), p = g.attributes.position, col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { const d = Math.hypot(p.getX(i), p.getZ(i)), f = clamp(1 - d, 0, 1) ** 1.6; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = f; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#4a3d30', map: deckTex, vertexColors: true }));
      m.receiveShadow = true; root.add(m); return m;
    })();
    // The disc's uv spans its diameter; this maps it back onto world x and -z in DECK units.
    const pinDeck = (cx, cz, r) => { deckTex.repeat.set(2 * r / DECK, 2 * r / DECK); deckTex.offset.set((cx - r) / DECK, -(cz + r) / DECK); };

    // ── Layout. A hub per project round You, its machines round the hub, valves beside their machine. Every piece is a rectangle on
    // the floor (machine with its stack's reach, valves, plate and televisor; hub and plate; You with board and boiler) and every pipe a
    // straight line. The hubs go in first, each as near You as it fits on its ring angle, so their trunks to You are kept clear. Then
    // the machines, one per cluster a round, each where it's nearest its hub, faces away from You and keeps the board's screen-shaped
    // extent small. A tight board is a near camera: from the home view the machines are big enough to tell apart and their names fit
    // on their plates. ──
    const hash = (seed, k) => kit.rng((seed + Math.imul(k, 0x9e3779b1)) >>> 0)();
    const RS = [-PLATE.session.w / 2 - .15, PLATE.session.w / 2 + .15, -3, PLATE.session.z + .2], RTV = [RS[0], TV.x + TV.half * TV.k + .15, RS[2], RS[3]], RJ = [-PLATE.project.w / 2 - .1, PLATE.project.w / 2 + .1, -JR * JS - 1, PLATE.project.z + .15], RY = [-BR - .25, BR + .25, -BR - .9, PLATE.you.z + .25];
    // Valves stand in a column left of their machine, front to back, a second column further left past four.
    const SUB_X = -2.2, SUB_DX = -1, SUBROW = [-.6, -1.55, -2.5, -3.45];
    // Sessions laid out with room for a televisor: those with screenshots. When that changes the plant is laid out again.
    const hasTV = new Set(world.sessions.filter(s => ctx.shot?.(s)));
    // A televisor's floor round its screen's centre, [x0, x1, z0, z1] from the node.
    const TV_BOX = [TV.x - TV.half * TV.k, TV.x + TV.half * TV.k, TV.z - (TV.sh / 2 + .7) * TV.k, TV.z + (TV.sh / 2 + .2) * TV.k];
    // A piece's room [x0, x1, z0, z1] round its node, and the solid parts in it a pipe must miss (body, televisor, valves): a pipe may
    // pass behind a machine or under its plate, just not through it.
    const KJ = [[-JR * JS - .1, JR * JS + .1, -JR * JS - .1, JR * JS + .1]], HUB = { R: RJ, K: KJ };
    const pieceOf = s => {
      const R = (hasTV.has(s) ? RTV : RS).slice(), m = s.subs.length, K = [[-1.6, 1.6, MZ - 1.6, MZ + 1.6]];
      if (hasTV.has(s)) K.push(TV_BOX);
      if (m) {
        const xl = SUB_X + SUB_DX * ((m - 1) >> 2) - AK - .3, zb = SUBROW[Math.min(3, m - 1)] - AK - .3;
        R[0] = Math.min(R[0], xl); R[2] = Math.min(R[2], zb); K.push([xl, SUB_X + AK + .1, zb, SUBROW[0] + AK + .1]);
      }
      return { R, K };
    };
    // Does the spoke a→b properly cross spoke q [ax, az, bx, bz]? Spokes meeting at an end (a hub's, You's) don't count.
    function segX(ax, az, bx, bz, q) {
      const dx = bx - ax, dz = bz - az, ex = q[2] - q[0], ez = q[3] - q[1], d = dx * ez - dz * ex;
      if (Math.abs(d) < 1e-9) return false;
      const fx = q[0] - ax, fz = q[1] - az, t = (fx * ez - fz * ex) / d, u = (fx * dz - fz * dx) / d;
      return t > .03 && t < .97 && u > .03 && u < .97;
    }
    function layout() {
      // The screen's shape on the floor (fit spans x by the aspect, z foreshortened): N is a point's reach in screen terms.
      const A = clamp(ctx.size.w / Math.max(1, ctx.size.h), .3, 4), KZ = Math.cos(.5) * 1.1, GAP = .25;
      const N = (x, z) => Math.max(Math.abs(x) / A, Math.abs(z) * KZ);
      const at = (x, z, R, s, K) => ({ s, x, z, x0: x + R[0], x1: x + R[1], z0: z + R[2], z1: z + R[3], k: K.map(b => [x + b[0], x + b[1], z + b[2], z + b[3]]) });
      // trunks: You to each hub; branches: hub to each machine; lanes: on from each hub away from You, as long as its cluster needs to
      // reach its far machines (while machines are placed; the close-up after drops them). A machine's solid parts keep off every
      // trunk, branch and lane; a branch keeps off every solid part and crosses no trunk. Branches may cross each other, at a price.
      // So no cluster is walled in, by its neighbours or by its own first machines.
      const rects = [at(0, 0, RY, null, [RY])], trunks = [], branches = [], lanes = [];
      const free = (x, z, { R, K }, own) => {
        const x0 = x + R[0], x1 = x + R[1], z0 = z + R[2], z1 = z + R[3];
        for (const r of rects) if (x0 < r.x1 + GAP && r.x0 < x1 + GAP && z0 < r.z1 + GAP && r.z0 < z1 + GAP) return false;
        return !(onPipe(trunks, x, z, x0, x1, z0, z1, K, own, .15) || onPipe(branches, x, z, x0, x1, z0, z1, K, own, .15) || onPipe(lanes, x, z, x0, x1, z0, z1, K, own, .55));
      };
      function onPipe(L, x, z, x0, x1, z0, z1, K, own, m) {
        for (const p of L) {
          if (p === own || Math.min(p[0], p[2]) > x1 || Math.max(p[0], p[2]) < x0 || Math.min(p[1], p[3]) > z1 || Math.max(p[1], p[3]) < z0) continue;
          for (const b of K) if (segRect(p[0], p[1], p[2], p[3], x + b[0] - m, x + b[1] + m, z + b[2] - m, z + b[3] + m)) return true;
        }
        return false;
      }
      // How many pipes the pipe a→b crosses, or -1 if it can't be laid at all.
      const crossings = (ax, az, bx, bz, skip) => {
        const lx = Math.min(ax, bx), hx = Math.max(ax, bx), lz = Math.min(az, bz), hz = Math.max(az, bz);
        for (const r of rects) {
          if (r === skip || r.x0 > hx || r.x1 < lx || r.z0 > hz || r.z1 < lz) continue;
          for (const b of r.k) if (segRect(ax, az, bx, bz, b[0] - .15, b[1] + .15, b[2] - .15, b[3] + .15)) return -1;
        }
        for (const q of trunks) if (segX(ax, az, bx, bz, q)) return -1;
        let n = 0; for (const q of branches) if (segX(ax, az, bx, bz, q)) n++;
        return n;
      };
      const cl = world.projects.map(p => ({ p, x: 0, z: 0, dir: 0, hub: null, rects: [], pp: [], list: null, sp: null, order: null }));
      const bySize = cl.slice().sort((a, b) => b.p.sessions.length - a.p.sessions.length || a.p.index - b.p.index);
      // Ring angles in the projects' own order round You, each as wide as its cluster is big, turned to sit on their ring angles on
      // average, then stretched to the screen's shape.
      const W = cl.map(c => 1 + .6 * c.p.sessions.length), SW = W.reduce((u, v) => u + v, 0);
      let acc = 0, rx = 0, rz = 0;
      const th = W.map(w => (acc += w) - w / 2).map(v => v / SW * TAU);
      cl.forEach((c, i) => { rx += Math.cos(c.p.angle - th[i]); rz += Math.sin(c.p.angle - th[i]); });
      const rot = Math.atan2(rz, rx);
      // Hubs. Each owns a ray from You, kept clear until its hub is placed and then cut back to the hub: so every hub keeps a straight
      // way to You, and neighbours on close rays stagger in and out. Biggest first.
      cl.forEach((c, i) => {
        const a0 = th[i] + rot + (hash(c.p.seed, 2) - .5) * .1;
        c.dir = Math.atan2(Math.sin(a0) / KZ, Math.cos(a0) * A); c.sp = [0, 0, Math.cos(c.dir) * 400, Math.sin(c.dir) * 400]; trunks.push(c.sp);
      });
      for (const c of bySize) {
        const cs = Math.cos(c.dir), sn = Math.sin(c.dir);
        let D = 6 + 8 * Math.sqrt(c.p.sessions.length); while (D < 400 && !free(cs * D, sn * D, HUB, c.sp)) D += .25;
        c.x = cs * D; c.z = sn * D; c.hub = at(c.x, c.z, RJ, null, KJ);
        c.sp[0] = c.x; c.sp[1] = c.z; c.sp[2] = 0; c.sp[3] = 0;
        c.hub.c = c; rects.push(c.hub); c.rects.push(c.hub);
        const n = c.p.sessions.length, ln = n > 1 ? 2 + 3 * (n - 1) : 0;
        if (ln) lanes.push([c.x + cs * (JR * JS + .3), c.z + sn * (JR * JS + .3), c.x + cs * (JR * JS + ln), c.z + sn * (JR * JS + ln)]);
        c.list = c.p.sessions.map(s => ({ s, ...pieceOf(s) })).sort((u, v) => (v.R[1] - v.R[0] + v.R[3] - v.R[2]) - (u.R[1] - u.R[0] + u.R[3] - u.R[2]));
      }
      // Machines, a round at a time so no cluster takes all the room near it. A spot is scored by its distance from the hub, how far it
      // turns back toward You, its reach in screen terms and the pipes its own pipe would cross. Each cluster sorts the same rings of
      // spots once; a machine walks them best first until no later spot could win.
      const OFF = [];
      for (let r = 3; r < 26; r += .45) { const m = Math.ceil(TAU * r / .85); for (let j = 0; j < m; j++) OFF.push(r, Math.cos(TAU * j / m), Math.sin(TAU * j / m)); }
      const K = OFF.length / 3, score = new Float64Array(K);
      const base = (c, r, ca, sa) => r + .5 * N(c.x + ca * r, c.z + sa * r);
      for (const c of cl) {
        for (let k = 0; k < K; k++) score[k] = base(c, OFF[3 * k], OFF[3 * k + 1], OFF[3 * k + 2]);
        c.order = new Uint32Array(K).map((_, k) => k).sort((u, v) => score[u] - score[v]);
      }
      const try1 = (c, it, r, ca, sa, best) => {
        const x = c.x + ca * r, z = c.z + sa * r, f = base(c, r, ca, sa);
        if (f >= best.cost || !free(x, z, it, null)) return;
        const n = crossings(c.x, c.z, x, z + MZ, c.hub);
        if (n >= 0 && f + 4 * n < best.cost) { best.cost = f + 4 * n; best.x = x; best.z = z; }
      };
      const seek = (c, it, best) => {
        for (let i = 0; i < K; i++) {
          const k = c.order[i];
          if (base(c, OFF[3 * k], OFF[3 * k + 1], OFF[3 * k + 2]) >= best.cost) break;
          try1(c, it, OFF[3 * k], OFF[3 * k + 1], OFF[3 * k + 2], best);
        }
      };
      const put = (c, it, x, z) => {
        const q = at(x, z, it.R, it.s, it.K), pp = [c.x, c.z, x, z + MZ];
        q.c = pp.c = c; q.it = it; q.pp = pp;
        rects.push(q); branches.push(pp); c.rects.push(q); c.pp.push(pp);
        const g = SG.get(it.s); g.ox = x - c.x; g.oz = z - c.z;
      };
      // A cluster's screen reach moved by (dx, dz): the sum of its pieces' (so it counts every machine, not just the furthest).
      const reach = (c, dx, dz) => { let v = 0; for (const r of c.rects) v += N(r.x + dx, r.z + dz); return v; };
      const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [.7071, .7071], [.7071, -.7071], [-.7071, .7071], [-.7071, -.7071]], STEPS = [2, 1, .5, .25];
      // Can cluster c move by (dx, dz)? Its pieces keep clear of the rest, and off every other pipe and trunk; its trunk, moved, misses
      // every solid part on the way to You and crosses no pipe; its pipes cross no other trunk, pass no other piece, and cross no more
      // pipes than they did.
      const fits = (c, dx, dz) => {
        const hx = c.x + dx, hz = c.z + dz, M = .15;
        for (const r of c.rects) {
          const x0 = r.x0 + dx, x1 = r.x1 + dx, z0 = r.z0 + dz, z1 = r.z1 + dz;
          for (const o of rects) if (o.c !== c && x0 < o.x1 + GAP && o.x0 < x1 + GAP && z0 < o.z1 + GAP && o.z0 < z1 + GAP) return false;
          for (const b of r.k) {
            const bx0 = b[0] + dx - M, bx1 = b[1] + dx + M, bz0 = b[2] + dz - M, bz1 = b[3] + dz + M;
            for (const q of trunks) if (q !== c.sp && segRect(q[0], q[1], q[2], q[3], bx0, bx1, bz0, bz1)) return false;
            for (const q of branches) if (q.c !== c && segRect(q[0], q[1], q[2], q[3], bx0, bx1, bz0, bz1)) return false;
            if (r !== c.hub && segRect(hx, hz, 0, 0, bx0, bx1, bz0, bz1)) return false;
          }
        }
        const lx = Math.min(hx, 0), ux = Math.max(hx, 0), lz = Math.min(hz, 0), uz = Math.max(hz, 0);
        for (const o of rects) {
          if (o.c === c || o === rects[0] || o.x0 > ux || o.x1 < lx || o.z0 > uz || o.z1 < lz) continue;
          for (const b of o.k) if (segRect(hx, hz, 0, 0, b[0] - M, b[1] + M, b[2] - M, b[3] + M)) return false;
        }
        let was = 0, now = 0;
        for (const q of branches) if (q.c !== c && segX(hx, hz, 0, 0, q)) return false;
        for (const p of c.pp) {
          const ax = p[0] + dx, az = p[1] + dz, bx = p[2] + dx, bz = p[3] + dz;
          for (const q of trunks) if (q !== c.sp && segX(ax, az, bx, bz, q)) return false;
          for (const o of rects) {
            if (o.c === c || o.x0 > Math.max(ax, bx) || o.x1 < Math.min(ax, bx) || o.z0 > Math.max(az, bz) || o.z1 < Math.min(az, bz)) continue;
            for (const b of o.k) if (segRect(ax, az, bx, bz, b[0] - M, b[1] + M, b[2] - M, b[3] + M)) return false;
          }
          for (const q of branches) if (q.c !== c) { if (segX(p[0], p[1], p[2], p[3], q)) was++; if (segX(ax, az, bx, bz, q)) now++; }
        }
        return now <= was;
      };
      const shift = (c, dx, dz) => {
        c.x += dx; c.z += dz; c.sp[0] = c.x; c.sp[1] = c.z;
        for (const r of c.rects) { r.x += dx; r.z += dz; r.x0 += dx; r.x1 += dx; r.z0 += dz; r.z1 += dz; for (const b of r.k) { b[0] += dx; b[1] += dx; b[2] += dz; b[3] += dz; } }
        for (const p of c.pp) { p[0] += dx; p[1] += dz; p[2] += dx; p[3] += dz; }
      };
      for (let round = 0, more = true; more; round++) {
        more = false;
        for (const c of bySize) {
          const it = c.list[round]; if (!it) continue;
          more = true;
          const best = { cost: Infinity, x: NaN, z: 0 };
          seek(c, it, best);
          // Past the rings (never on a sane board): the nearest free spot further out.
          for (let r = 26; Number.isNaN(best.x) && r < 160; r += 1) for (let j = 0, m = Math.ceil(TAU * r / 1.2); j < m; j++) try1(c, it, r, Math.cos(TAU * j / m), Math.sin(TAU * j / m), best);
          if (Number.isNaN(best.x)) { best.x = c.x + Math.cos(c.dir) * 160; best.z = c.z + Math.sin(c.dir) * 160; }
          put(c, it, best.x, best.z);
        }
      }
      // Then the board closes up. Lanes have done their work (every machine has its spot); now each cluster in turn slides whole toward
      // the middle of the screen while it fits, its trunk still straight to You, and each machine moves nearer its hub wherever room has
      // opened. Till nothing moves.
      lanes.length = 0;
      for (let sweep = 0, moved = true; moved && sweep < 24; sweep++) {
        moved = false;
        for (const c of cl) {
          let bx = 0, bz = 0, bs = reach(c, 0, 0) - .05;
          for (const [ux, uz] of DIRS) for (const st of STEPS) { const v = reach(c, ux * st, uz * st); if (v < bs && fits(c, ux * st, uz * st)) { bs = v; bx = ux * st; bz = uz * st; break; } }
          if (bx || bz) { shift(c, bx, bz); moved = true; }
        }
        if (moved && sweep % 3 === 2 || !moved) for (const c of cl) for (const q of c.rects.slice(1).sort((u, v) => Math.hypot(v.x - c.x, v.z - c.z) - Math.hypot(u.x - c.x, u.z - c.z))) {
          const dx = q.x - c.x, dz = q.z - c.z, r = Math.hypot(dx, dz), it = q.it;
          rects.splice(rects.indexOf(q), 1); branches.splice(branches.indexOf(q.pp), 1); c.rects.splice(c.rects.indexOf(q), 1); c.pp.splice(c.pp.indexOf(q.pp), 1);
          const n = crossings(c.x, c.z, q.x, q.z + MZ, c.hub), best = { cost: base(c, r, dx / r, dz / r) + 4 * Math.max(0, n) - .3, x: NaN, z: 0 };
          seek(c, it, best);
          if (Number.isNaN(best.x)) put(c, it, q.x, q.z); else { put(c, it, best.x, best.z); moved = true; }
        }
      }
      const pos = new Map(cl.map(c => [c.p, [c.x, c.z]]));
      for (const k of world.subs) {
        const i = k.parent.subs.indexOf(k), g = KG.get(k);
        g.ox = SUB_X + SUB_DX * (i >> 2); g.oz = SUBROW[i % 4];
      }
      ctx.setLayout(n => {
        if (n.kind === 'you') n.rest.set(0, 0, 0);
        else if (n.kind === 'project') { const [x, z] = pos.get(n); n.rest.set(x, 0, z); }
        else { const g = n.kind === 'session' ? SG.get(n) : KG.get(n); n.offset.set(g.ox, 0, g.oz); }
      });
      PLATES_AT.length = 0;
      let x0 = -BR, x1 = BR, z0 = -BR, z1 = BR;
      for (const c of cl) for (const r of c.rects) { x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1); z0 = Math.min(z0, r.z0); z1 = Math.max(z1, r.z1); const P = r.s ? PLATE.session : PLATE.project; PLATES_AT.push([r.x - P.w / 2, r.x + P.w / 2, r.z + P.z - P.h * .88, r.z + P.z]); if (hasTV.has(r.s)) PLATES_AT.push([r.x + TV_BOX[0], r.x + TV_BOX[1], r.z + TV_BOX[2], r.z + TV_BOX[3], true]); }
      PLATES_AT.push([-PLATE.you.w / 2, PLATE.you.w / 2, PLATE.you.z - PLATE.you.h * .88, PLATE.you.z]);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ext = Math.max(x1 - x0, z1 - z0) / 2;
      floor.position.set(cx, 0, cz); floor.scale.setScalar(ext * 1.9 + 12); pinDeck(cx, cz, ext * 1.9 + 12);
      const L = ext * 1.25 + 5, cam = key.shadow.camera;
      cam.left = cam.bottom = -L; cam.right = cam.top = L; cam.near = 1; cam.far = 160; cam.updateProjectionMatrix();
      key.target.position.set(cx, -1, cz); key.position.set(-14, 30, 18).normalize().multiplyScalar(70).add(key.target.position);
      sigBuilt.fill(NaN); shadowDirty = true;
    }
    layout();
    ctx.onResize(layout);

    // ── Labels: the nameplates carry them. ──
    // ppu is screen pixels to a board unit at the focus, platePx a full-size engraved session name's height. Close up the names are
    // engraved on the plates, tickers and all. Further out the plates go blank and an HTML name lies on each one instead ('on', its
    // brass face in the css), crisp at any size; past where a plate can hold one it's a brass tag beside its machine as in every look.
    // All plates hand over together (a mix reads as broken); an engraved name whose full fit came out small (two lines, or shrunk)
    // shows its one-line cut until it would be at least LEGIBLE. A project's name is its own: a black and gold tag on its hub, placed
    // before any other label (the hubs are what a far board is found by), till the plate's engraving is as big as the tag (HUB_PX).
    let ppu = 99, platePx = 99;
    const ENGRAVE = 12.5, LEGIBLE = ENGRAVE * .84, ON = 80 / PLATE.session.w, HUB_PX = 12;
    const engraved = () => platePx >= ENGRAVE, onPlate = () => !engraved() && ppu >= ON, hubTag = () => ppu * NAME.project.full * PLATE.project.h < HUB_PX;
    ctx.setLabelRule(n => n.kind === 'sub' ? undefined : n.kind === 'project' ? hubTag() && 'on' : engraved() ? false : onPlate() ? 'on' : undefined);
    // A name on its plate takes the whole plate (tw × th); the body round it, for picking and keeping subagents' names off, is the
    // machine and the plate's middle, short of the valves at its side. Beside, the default circle keeps a tag close to its plate. A
    // project's tag takes its own size (no th), up to a width no name reaches.
    const SHAPE = { session: { hx: 1.6, hz: 2.4, y: 1.2, tw: PLATE.session.w, th: PLATE.session.h }, project: { hx: JR * JS + .2, hz: JR * JS + .2, y: 1.2, tw: PLATE.project.w, th: PLATE.project.h }, you: { hx: BR, hz: BR, y: 2, tw: PLATE.you.w, th: PLATE.you.h } };
    SHAPE.project.tw = 60; SHAPE.project.th = 0;
    ctx.setShape(n => n.kind === 'project' ? hubTag() ? SHAPE.project : null : onPlate() && SHAPE[n.kind] || null);
    // A plate's face centre (y, z from its node) for a name on it; else a point on the plate's lower half, where a tag hangs from.
    const MID = {}; for (const k in PLATE) { const P = PLATE[k]; MID[k] = [LIFT + P.h * .5 * Math.cos(LEAN), P.z - P.h * .5 * Math.sin(-LEAN)]; }
    ctx.setLabelAnchor((n, out, on) => {
      const m = MID[n.kind];
      if (n.kind === 'you') return on ? out.set(0, m[0], m[1]) : out.set(0, LIFT + .2, PLATE.you.z - .5);
      if (n.kind === 'project') { const g = PG.get(n); return out.set(g.x + g.tag.dx, m[0], g.z + m[1] + g.tag.dz); }
      if (n.kind === 'session') { const g = SG.get(n); return on ? out.set(g.sx, m[0], g.sz + m[1]) : out.set(g.sx, LIFT + .2, g.sz + PLATE.session.z - .6); }
      const g = KG.get(n); return out.set(g.x, .4, g.z + .4);
    });
    // Hub tags go up before every other label, and the board checks them against nothing, so they're kept apart here. The biggest
    // hub's tag goes first; each takes its plate's middle when that's clear, else the step it had, else the nearest clear one. Clear
    // of the names on plates too (engraved or 'on') only within a small step (STEP up to NEAR), then of the hub tags placed so far
    // alone, as two tags on each other read as neither. Sizes come from the tag's css: 13.5px Cinzel caps, .06em apart, after a
    // 1.38em folder, 7px padding. Steps: tag widths, tag heights.
    const TAG_FS = 13.5, TAG_H = TAG_FS * 1.35 + 7;
    const STEP = [0, 0, 0, -.6, 0, .6, .2, 0, -.2, 0, .2, -.6, -.2, -.6, .2, .6, -.2, .6, 0, -1.1, 0, 1.1, .4, 0, -.4, 0, 0, -1.7, 0, 1.7, .6, 0, -.6, 0], NEAR = 18;
    const tagPen = document.createElement('canvas').getContext('2d'), hv = new THREE.Vector3(), SGS = world.sessions.map(s => SG.get(s));
    const obst = new Float64Array((world.projects.length + world.sessions.length + 1) * 4);
    const hubOrder = world.projects.map(p => PG.get(p)).sort((a, b) => world.projects[b.i].sessions.length - world.projects[a.i].sessions.length);
    for (const g of hubOrder) g.tag = { dx: 0, dz: 0, w: 0, step: 0, name: null, fr: false };
    let sx = 0, sy = 0, perX = 1, perZ = 1, nObst = 0, nPlates = 0;
    // (x, y, z) on screen (sx, sy), and pixels to a unit of x and of z there.
    function toPx(x, y, z) {
      const W = ctx.size.w, H = ctx.size.h;
      hv.set(x, y, z + 1).project(camera); const y1 = (1 - hv.y) * .5 * H;
      hv.set(x, y, z).project(camera); sx = (hv.x + 1) * .5 * W; sy = (1 - hv.y) * .5 * H; perZ = Math.max(1, y1 - sy); perX = perZ / Math.cos(.5);
    }
    function addObst(x0, y0, x1, y1) { const b = nObst++ * 4; obst[b] = x0; obst[b + 1] = y0; obst[b + 2] = x1; obst[b + 3] = y1; }
    function clearOf(x0, y0, x1, y1, from) { for (let j = from; j < nObst; j++) { const b = j * 4; if (x0 < obst[b + 2] && x1 > obst[b] && y0 < obst[b + 3] && y1 > obst[b + 1]) return false; } return true; }
    // A step's left edge, slid in off the screen's sides while the tag still spans its hub (a phone's edge hubs).
    const leftOf = (t, i) => Math.min(Math.max(Math.min(Math.max(sx + STEP[i] * t.w - t.w / 2, 4), ctx.size.w - 4 - t.w), sx - t.w + 12), sx - 12);
    // The first step under `end` whose box at (sx, sy) clears obstacles from `from` on: the middle, the last one, then in order.
    function stepFor(t, end, from) {
      for (let a = -4; a < end; a += 2) {
        const i = a === -4 ? 0 : a === -2 ? t.step : a;
        if (a === -2 ? i === 0 || i >= end : a >= 0 && (i === 0 || i === t.step)) continue;
        const x0 = leftOf(t, i), y0 = sy + STEP[i + 1] * TAG_H - TAG_H / 2;
        if (clearOf(x0, y0, x0 + t.w, y0 + TAG_H, from)) return i;
      }
      return -1;
    }
    function placeHubTags() {
      nObst = 0;
      if (ppu >= ON) {
        // A plate's lettered middle, short of its studded ends.
        for (const g of SGS) { if (world.sessions[g.i].s.alive < .5) continue; toPx(g.sx, MID.session[0], g.sz + MID.session[1]); const hw = PLATE.session.w * perX * .35, hh = PLATE.session.h * perX * .3; addObst(sx - hw, sy - hh, sx + hw, sy + hh); }
        toPx(0, MID.you[0], MID.you[1]); const hw = PLATE.you.w * perX * .35, hh = PLATE.you.h * perX * .3; addObst(sx - hw, sy - hh, sx + hw, sy + hh);
      }
      nPlates = nObst;
      for (const g of hubOrder) {
        const t = g.tag, name = world.projects[g.i].name;
        if (t.name !== name || t.fr !== fontsReady) { t.name = name; t.fr = fontsReady; tagPen.font = `700 ${TAG_FS}px Cinzel, Georgia, serif`; const u = name.toUpperCase(); t.w = tagPen.measureText(u).width + u.length * TAG_FS * .06 + TAG_FS * 1.38 + 16; }
        toPx(g.x, MID.project[0], g.z + MID.project[1]);
        let best = stepFor(t, NEAR, 0); if (best < 0) best = stepFor(t, STEP.length, nPlates); if (best < 0) best = 0;
        const x0 = leftOf(t, best), y0 = sy + STEP[best + 1] * TAG_H - TAG_H / 2; addObst(x0, y0, x0 + t.w, y0 + TAG_H);
        t.step = best; t.dx = (x0 + t.w / 2 - sx) / perX; t.dz = STEP[best + 1] * TAG_H / perZ;
      }
    }

    // ── Nameplates ──
    const plateGeo = Object.fromEntries(Object.entries(PLATE).map(([k, P]) => [k, new THREE.PlaneGeometry(P.w, P.h)]));
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const plates = [];
    function makePlate(kind, node, seed) {
      const P = PLATE[kind], cv = document.createElement('canvas'); cv.width = P.cw; cv.height = P.ch;
      const t = tex(new THREE.CanvasTexture(cv)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
      const m = new THREE.Mesh(plateGeo[kind], mat({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: .12, metalness: .4, roughness: .5, envMapIntensity: .4 }));
      m.rotation.x = LEAN; m.visible = false; root.add(m);
      // What's painted (name text, its fit, ticker line and tone), so a frame compares fields, not a built key.
      const pl = { kind, node, seed, P, g: cv.getContext('2d'), tex: t, mesh: m, i: plates.length, painted: false, shown: null, text: null, fit: null, fit1: null, line: null, tn: null, at: 0 };
      plates.push(pl); return pl;
    }
    const youPlate = makePlate('you', world.you, 1);
    for (const p of world.projects) PG.get(p).plate = makePlate('project', p, p.seed);
    for (const s of world.sessions) SG.get(s).plate = makePlate('session', s, s.seed);
    const tone = n => n.status === 'permission' || n.status === 'question' ? 'need' : n.status === 'error' ? 'error' : n.status === 'offline' ? 'off' : WORKING.has(n.status) ? 'work' : 'idle';
    // A waiting session's ticker reads "text · 3m"; the string is rebuilt only when the shown wait (or the text) changes.
    const WAITS = new Map();
    function lineOf(n, tn) {
      if (tn !== 'need') return n.text;
      const t = n.waitSec || 0, k = t < 60 ? Math.max(1, Math.round(t)) : t < 3600 ? 1000 + Math.floor(t / 60) : 100000 + Math.floor(t / 3600);
      let w = WAITS.get(n); if (!w) WAITS.set(n, w = { k: -1, text: null, line: '' });
      if (w.k !== k || w.text !== n.text) { w.k = k; w.text = n.text; w.line = `${n.text} · ${kit.fmtWait(t)}`; }
      return w.line;
    }
    let fontsReady = false, disposed = false;
    // Webfonts land after the first paint: refit and repaint every face, then wake the loop (nothing else would draw the frame).
    if (document.fonts) Promise.all([`500 20px Spectral`, `700 20px Cinzel`, `400 20px "Courier Prime"`].map(f => document.fonts.load(f))).then(() => {
      if (disposed) return; fontsReady = true; for (const pl of plates) { pl.painted = false; pl.text = null; } board.sig = ''; usageRef = null; ctx.wake?.();
    }, () => {});
    // Place a plate with its bottom edge at (x, z) on the floor, grown by s; paint it if what it shows changed (a few a frame, the rest
    // next frame: pendingPaint keeps the pace up). A ticker whose only change is its wait clock repaints at most about once a second.
    // While its HTML name is up the plate's name goes blank (its ticker keeps its colour), so no name shows twice.
    let painted = 0, pendingPaint = false, tickWait = false;
    function showPlate(pl, x, z, s, text, line, tn, hl) {
      const { P, mesh } = pl, h = P.h * s;
      if (pl.text !== text) {
        pl.text = text; pl.fit = nameFit(pl.g, pl.kind, P.cw, P.ch, text); pl.painted = false;
        pl.fit1 = pl.fit.fs < .84 ? nameFit(pl.g, pl.kind, P.cw, P.ch, text, true) : pl.fit;
      }
      const blank = pl.kind === 'project' ? hubTag() : !engraved(), fit = blank ? null : platePx * pl.fit.fs >= LEGIBLE ? pl.fit : pl.fit1;
      if (blank) line = '';
      if (!pl.painted || pl.shown !== fit || pl.tn !== tn || pl.line !== line) {
        const tick = pl.painted && pl.shown === fit && pl.tn === tn, now = performance.now();
        if (painted >= 6) pendingPaint = true;
        else if (tick && now - pl.at < 950) tickWait = true;
        else {
          painted++; pl.painted = true; pl.shown = fit; pl.tn = tn; pl.line = line; pl.at = now;
          paintPlate(pl.g, pl.kind, P.cw, P.ch, fit, line, tn, pl.seed % 97); pl.tex.needsUpdate = true;
        }
      }
      mesh.visible = pl.painted;
      const cy = LIFT * s + h * .5 * Math.cos(LEAN), cz = z - h * .5 * Math.sin(-LEAN);
      mesh.position.set(x, cy, cz); mesh.scale.setScalar(Math.max(1e-4, s)); mesh.material.emissiveIntensity = .12 + .3 * hl;
      setR(frames, pl.i, x, cy + .035 * s * Math.sin(LEAN), cz - .035 * s * Math.cos(LEAN), LEAN, 0, 0, (P.w + .1) * s, (P.h + .1) * s, .05 * s);
      const px = P.w * .36 * s; setT(posts, pl.i * 2, x - px, cy * .5, cz - .06, 0, s, cy, s); setT(posts, pl.i * 2 + 1, x + px, cy * .5, cz - .06, 0, s, cy, s);
    }
    function hidePlate(pl) { pl.mesh.visible = false; hide(frames, pl.i); hide(posts, pl.i * 2); hide(posts, pl.i * 2 + 1); }

    // ── The gauge board in front of the boiler: one dial per usage window, rebuilt when the accounts change, repainted when a reading does ──
    const ZB = 2.75, board = { group: new THREE.Group(), key: null, sig: '', lay: null, tex: null, face: null, needles: null, lamps: null, cv: null, val: [] };
    board.group.rotation.x = LEAN; root.add(board.group);
    const boardNeedleGeo = needleGeo.clone().rotateX(HP), boardFrame = mat({ color: '#2c2723', metalness: .7, roughness: .5 });
    function clearBoard() { for (const o of [...board.group.children]) { board.group.remove(o); if (o.isInstancedMesh) { o.dispose(); const k = insts.indexOf(o); if (k >= 0) insts.splice(k, 1); } if (o.geometry !== boardNeedleGeo && o.geometry !== lamps.geometry) o.geometry.dispose(); if (o.material !== blackMat && o.material !== lampMat && o.material !== boardFrame && o.material !== brassMat) o.material.dispose(); } board.tex?.dispose(); board.tex = null; }
    function buildBoard(lay) {
      clearBoard(); board.lay = lay; board.sig = ''; board.val = lay ? lay.cells.map(c => c.used) : [];
      if (!lay) return;
      const { W, H } = lay;
      board.group.position.set(0, .55 + H * .5 * Math.cos(LEAN), ZB - H * .5 * Math.sin(-LEAN));
      board.cv = document.createElement('canvas'); board.cv.width = 1536; board.cv.height = Math.round(1536 * H / W);
      board.tex = new THREE.CanvasTexture(board.cv); board.tex.colorSpace = THREE.SRGBColorSpace; board.tex.anisotropy = aniso;
      board.face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat({ map: board.tex, emissiveMap: board.tex, emissive: '#ffffff', emissiveIntensity: .08, metalness: .45, roughness: .55, envMapIntensity: .45 }));
      board.face.receiveShadow = true;
      const frame = new THREE.Mesh(merge([place(box(W + .2, H + .2, .1), 0, 0, -.06), place(box(.1, H + .2, .4), -W / 2 - .1, 0, -.2), place(box(.1, H + .2, .4), W / 2 + .1, 0, -.2),
        place(box(W * .9, .6, H * .55), 0, -H * .25, -H * .32, -.5, 0, 0)]), boardFrame);
      frame.castShadow = frame.receiveShadow = true; shadowDirty = true;
      // Its own brass: brassMat on a plain mesh beside all the instanced brass made three re-pick the program twice a frame.
      const bezel = new THREE.Mesh(merge(lay.cells.filter(c => c.kind === 'win' || c.limit).map(c => place(torus(c.r + .015, .03, 6, 36), c.x, c.y, .015))), brassMat.clone());
      board.needles = track(new THREE.InstancedMesh(boardNeedleGeo, blackMat, lay.cells.length));
      board.lamps = track(new THREE.InstancedMesh(lamps.geometry, lampMat, lay.cells.length));
      for (let i = 0; i < lay.cells.length; i++) { const c = lay.cells[i]; board.lamps.setColorAt(i, BLACK); O.position.set(c.x + c.r * .84, c.y + c.r * .84, .04); O.rotation.set(0, 0, 0); O.scale.setScalar(.055); O.updateMatrix(); board.lamps.setMatrixAt(i, O.matrix); }
      board.group.add(board.face, frame, bezel, board.needles, board.lamps);
    }
    function syncBoard() {
      const lay = boardLayout(world.usage), k = lay?.key ?? '';
      if (k !== board.key) { board.key = k; buildBoard(lay); }
      else if (lay) lay.cells.forEach((c, i) => Object.assign(board.lay.cells[i], { used: c.used, spent: c.spent, limit: c.limit }));
      if (!board.lay) return;
      const sig = board.lay.cells.map(c => c.kind === 'spend' ? money(c.spent) : Math.round(c.used * 100)).join() + fontsReady;
      if (sig !== board.sig) { board.sig = sig; const g = board.cv.getContext('2d'); g.clearRect(0, 0, board.cv.width, board.cv.height); paintBoard(g, board.lay, board.cv.width / board.lay.W, board.cv.height); board.tex.needsUpdate = true; }
    }
    let usageRef = null;

    // ── Steam, smoke and sparks ──
    const puffTex = tex(kit.canvasTexture(128, (g, s) => {
      const r = kit.rng(7);
      for (let i = 0; i < 10; i++) {
        const a = r() * TAU, d = r() * s * .14, x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d, rad = s * (.15 + r() * .13), v = 190 + r() * 65 | 0;
        const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(${v},${v},${v},.5)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
        g.fillStyle = gr; g.fillRect(0, 0, s, s);
      }
    }));
    const PN = 1400;
    const pPos = new Float32Array(PN * 3), pSize = new Float32Array(PN), pAlpha = new Float32Array(PN), pCol = new Float32Array(PN * 3), pRot = new Float32Array(PN);
    const pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN), pMax = new Float32Array(PN).fill(1), pS0 = new Float32Array(PN), pS1 = new Float32Array(PN);
    const pA0 = new Float32Array(PN), pSpin = new Float32Array(PN), pRise = new Float32Array(PN), pDrag = new Float32Array(PN);
    let pHead = 0, pLive = 0, cFrom = 0, cCount = 0;
    const pGeo = new THREE.BufferGeometry(), dynA = (a, n) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    pGeo.setAttribute('position', dynA(pPos, 3)); pGeo.setAttribute('aSize', dynA(pSize, 1)); pGeo.setAttribute('aAlpha', dynA(pAlpha, 1)); pGeo.setAttribute('aColor', dynA(pCol, 3)); pGeo.setAttribute('aRot', dynA(pRot, 1));
    const pMat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: puffTex }, uScale: { value: 800 } }, transparent: true, depthWrite: false,
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute float aRot; attribute vec3 aColor; uniform float uScale;
        varying float vA; varying float vR; varying vec3 vC;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / max(.1, -mv.z); vA = aAlpha; vR = aRot; vC = aColor; }`,
      fragmentShader: `uniform sampler2D uTex; varying float vA; varying float vR; varying vec3 vC;
        void main() { vec2 p = gl_PointCoord - .5; float c = cos(vR), s = sin(vR);
          vec4 t = texture2D(uTex, vec2(c * p.x - s * p.y, s * p.x + c * p.y) + .5);
          float a = t.a * vA; if (a < .004) discard;
          float lit = mix(.58, 1.1, 1. - gl_PointCoord.y) * (.75 + .3 * t.r);
          gl_FragColor = vec4(vC * lit, a); }`,
    });
    const smoke = new THREE.Points(pGeo, pMat); smoke.frustumCulled = false; smoke.renderOrder = 2; root.add(smoke);
    const STEAM = new THREE.Color('#ece5d8'), GOLDSTEAM = new THREE.Color(1.6, 1.15, .55), SPARK = new THREE.Color(6, 2.4, .5), SOOT = new THREE.Color('#3a332e');
    function puff(x, y, z, vx, vy, vz, life, s0, s1, a0, col, rise = .5, drag = 1.2) {
      if (ctx.reduced) return;
      const i = pHead, i3 = i * 3; pHead = (pHead + 1) % PN;
      if (!cCount) cFrom = i; if (cCount < PN) cCount++; // the run of fresh colours, uploaded this frame
      pPos[i3] = x; pPos[i3 + 1] = y; pPos[i3 + 2] = z; pVel[i3] = vx; pVel[i3 + 1] = vy; pVel[i3 + 2] = vz;
      pCol[i3] = col.r; pCol[i3 + 1] = col.g; pCol[i3 + 2] = col.b;
      pLife[i] = pMax[i] = life; pS0[i] = s0; pS1[i] = s1; pA0[i] = a0; pRot[i] = rnd() * TAU; pSpin[i] = (rnd() - .5) * 1.2; pRise[i] = rise; pDrag[i] = drag; pSize[i] = s0; pAlpha[i] = 0;
    }
    const steam = (x, y, z, k, a = .6, col = STEAM) => puff(x, y, z, (rnd() - .5) * .4, .9 + rnd() * .7, (rnd() - .5) * .4, 1.2 + rnd() * .6, .12 * k, .8 * k, a, col, .5, 1.6);
    const jet = (x, y, z, k, col = STEAM) => puff(x, y, z, (rnd() - .5) * .25, 3.2 + rnd() * 1.4, (rnd() - .5) * .25, .7 + rnd() * .3, .07 * k, .55 * k, .85, col, .2, 2.4);
    const spark = (x, y, z) => { const a = rnd() * TAU, v = 1.5 + rnd() * 2.5; puff(x, y, z, Math.cos(a) * v, 1 + rnd() * 2.5, Math.sin(a) * v, .3 + rnd() * .3, .06, .02, 1, SPARK, -9, .6); };
    function ringPuff(x, y, z, r, k, n = 14, col = STEAM) { for (let i = 0; i < n; i++) { const a = i / n * TAU + rnd() * .3; puff(x + Math.cos(a) * r, y, z + Math.sin(a) * r, Math.cos(a) * 1.7 * k, .25 + rnd() * .3, Math.sin(a) * 1.7 * k, 1 + rnd() * .4, .18 * k, .7 * k, .65, col, .3, 2.2); } }
    function burst(x, y, z, n, k, col, a = .7) { for (let i = 0; i < n; i++) puff(x, y, z, (rnd() - .5) * 2 * k, (.8 + rnd() * 1.4) * k, (rnd() - .5) * 2 * k, 1.3 + rnd() * .7, .18 * k, 1 * k, a, col, .4, 1.8); }

    // ── Status colours (linear, HDR where they should bloom) ──
    const LC = { work: new THREE.Color('#7fd68a').multiplyScalar(2.2), think: new THREE.Color('#5ad1e8').multiplyScalar(1.7), compact: new THREE.Color('#b48cff').multiplyScalar(1.9),
      need: new THREE.Color('#ffb547').multiplyScalar(3.2), wait: new THREE.Color('#7fa9e6').multiplyScalar(1.3), idle: new THREE.Color('#8b7a62').multiplyScalar(.3),
      error: new THREE.Color('#ff5636').multiplyScalar(3.2), off: new THREE.Color('#000000') };
    const KEYS = Object.keys(LC), tc = new THREE.Color(), tc2 = new THREE.Color(), tA = new THREE.Vector3();
    function lampColor(q, out, pulse = 1) { out.setRGB(0, 0, 0); for (const k of KEYS) out.add(tc.copy(LC[k]).multiplyScalar(q[k] * (k === 'need' || k === 'error' ? pulse : 1))); return out; }
    const DIAL = new THREE.Color(.92, .88, .8), DIAL_ERR = new THREE.Color(1.8, .3, .2), DIAL_NEED = new THREE.Color(1.35, .82, .4), DIAL_OFF = new THREE.Color(.3, .36, .32), DIAL_IDLE = new THREE.Color(.6, .58, .54);
    const POOL_NEED = new THREE.Color(1, .55, .12), POOL_ERR = new THREE.Color(1, .18, .04), POOL_WORK = new THREE.Color(.3, .8, .35), YOU_GOLD = new THREE.Color(1, .55, .15);
    const FILL_LO = new THREE.Color(.35, .75, .45), FILL_MID = new THREE.Color(.95, .62, .18), FILL_HI = new THREE.Color(1.25, .2, .1);
    const PIP_ON = new THREE.Color(2.2, 1.35, .5), PIP_OFF = new THREE.Color(.04, .03, .02), MODE_OFF = new THREE.Color(.05, .04, .03), WARN_AMBER = new THREE.Color(2.4, 1.2, .2), WARN_RED = new THREE.Color(3, .3, .1);
    const OFF_TINT = new THREE.Color(.5, .66, .58), ERR_TINT = new THREE.Color(1.25, .78, .7);
    // Filament glow from a node's signals: working bright with a flicker on tool calls, thinking a slow warm swell, compacting dimming and
    // recovering, needs-you a brighter amber beat that quickens with the wait, idle a dim filament, error red, offline cold. Still when reduced.
    const FIL = new THREE.Color(3, 1.25, .32), AMB = new THREE.Color(3.4, 1.9, .45), REDF = new THREE.Color(3.2, .35, .14), METER = new THREE.Color(1.15, .8, .42), tGl2 = new THREE.Color();
    function glow(out, q, time, ph, reduced, urg = 0) {
      const t = reduced ? 0 : time, flick = reduced ? 1 : 1 + (q.heat || 0) * .45 * Math.sin(t * 41 + ph) * Math.sin(t * 17 + ph * 3);
      const swell = reduced ? .75 : .5 + .5 * (.5 + .5 * Math.sin(t * 1.4 + ph)), dip = reduced ? .55 : .2 + .8 * Math.sqrt((t * .5 + ph) % 1);
      const beat = reduced ? 1 : .55 + .45 * (.5 + .5 * Math.sin(t * (3 + 5 * urg) + ph));
      out.copy(FIL).multiplyScalar(q.work * flick + q.think * swell * .8 + q.compact * dip * .8 + q.idle * .16 + q.wait * .28)
        .add(tGl2.copy(AMB).multiplyScalar(q.need * beat * (1 + .6 * urg))).add(tGl2.copy(REDF).multiplyScalar(q.error * (reduced ? 1 : .8 + .2 * Math.sin(t * 9 + ph))));
      return out.multiplyScalar(1 - .97 * (q.off || 0));
    }
    // A machine's two filament tubes are its status lamps, and nothing else on it signals: a steady warm glow while it works (brighter
    // with the pace), a slow swell while it thinks, dimming and recovering while it compacts, a deep amber beat when it needs you that
    // quickens with the wait, steady red on error, a dim filament when idle, dark offline. Still when reduced.
    function signal(out, q, time, ph, reduced, urg = 0) {
      const t = reduced ? 0 : time, swell = reduced ? .75 : .5 + .5 * (.5 + .5 * Math.sin(t * 1.4 + ph)), dip = reduced ? .55 : .2 + .8 * Math.sqrt((t * .5 + ph) % 1);
      const beat = reduced ? 1 : .12 + .88 * (.5 + .5 * Math.sin(t * (3 + 4 * urg) + ph));
      out.copy(FIL).multiplyScalar(q.work * (.75 + .25 * Math.min(1, q.heat || 0)) + q.think * swell * .8 + q.compact * dip * .8 + q.idle * .16 + q.wait * .28)
        .add(tGl2.copy(AMB).multiplyScalar(q.need * beat * (1.1 + .5 * urg))).add(tGl2.copy(REDF).multiplyScalar(q.error));
      return out.multiplyScalar(1 - .97 * (q.off || 0));
    }
    // An indicator bulb for one session: amber while it works, beating when it needs you, red on error, a glint when idle, dark offline.
    const bulb = (q, out, pulse) => out.copy(FIL).multiplyScalar(.05 + .6 * (q.work + q.think + q.compact)).add(tGl2.copy(AMB).multiplyScalar(q.need * pulse)).add(tGl2.copy(REDF).multiplyScalar(q.error * .8)).multiplyScalar(1 - q.off);
    const KW = { claude: new THREE.Color('#c4703f'), codex: new THREE.Color('#3a5bd0'), opencode: new THREE.Color('#d2d2c8') };
    // Steam where a pulse passes a flanged joint or the relief tee.
    function crossJoints(pp, q, gold) {
      if (pp.tier === 3) return;
      for (const t of pp.path.joints) if (q.data.prev < t && q.t >= t) { pointAt(pp.path, t, tA); steam(tA.x, PY * pp.r * 2 + .1, tA.z, pp.tier === 1 ? .45 : .3, .45, gold ? GOLDSTEAM : STEAM); }
    }
    // A dial and its needle, on a gauge case of a machine at (X, Z) drawn sc times its model size.
    function gauge(k, c, X, Z, sc, f, tint) {
      const ny = Math.cos(c.t), nz = Math.sin(c.t);
      setR(dials, k, X + c.x * sc, (c.y + ny * .006) * sc, Z + (c.z + nz * .006) * sc, c.t, 0, 0, c.r * sc);
      setR(needles, k, X + c.x * sc, (c.y + ny * .008) * sc, Z + (c.z + nz * .008) * sc, c.t, gaugeAng(f), 0, c.r * sc);
      putC(dials, k, tint);
    }
    const tint4 = (q, hl, fire) => { tc.setRGB(1, 1, 1).lerp(OFF_TINT, q.off ?? 0).lerp(ERR_TINT, q.error ?? 0).multiplyScalar(1 + .22 * hl); return V4.set(tc.r, tc.g, tc.b, fire); };

    let warm = 0, yp = 0, yWhistle = 0, first = true, fps = 0, yq = -1, yLine = '';
    // update() returns the frame rate the plant needs right now (the engine draws no faster): the highest any part asks for through
    // want(), 0 when everything is still. Busy machines, beats and smoke ask 30; thinking alone (slow swells) 20; steam pulses running
    // down a pipe 60; anything moving across the floor every frame.
    const want = x => { if (x > fps) fps = x; };
    // Ease v toward goal; close enough, it lands, so the loop can rest. Settling asks for 30 fps, the last small creep for 20.
    const ease = (v, goal, rate, dt, eps) => { const d = Math.abs(goal - v); if (d < eps) return goal; want(d > .05 ? 30 : 20); return kit.damp(v, goal, rate, dt); };
    // A machine's local point in the world, for the machine at WX, WZ drawn WS times its model size (set per machine, no closure each).
    let WX = 0, WZ = 0, WS = 0;
    const W = (lx, ly, lz) => tA.set(WX + lx * WS, ly * WS, WZ + lz * WS), W3 = a => W(a[0], a[1], a[2]);
    const PATTRS = ['position', 'aSize', 'aAlpha', 'aRot'].map(n => pGeo.attributes[n]), PWIDTH = [3, 1, 1, 1];

    // Indexed loops: a for-of here would make an iterator per list per pipe, every frame, until the engine optimises update.
    const markPrev = l => { for (let i = 0; i < l.length; i++) l[i].data.prev = l[i].t; };
    const cross = (pp, l, gold) => { if (pp.tier !== 3) for (let i = 0; i < l.length; i++) crossJoints(pp, l[i], gold); };
    // Smoke and steam. Only the slots that were alive go up: live ones sit just behind the ring's head, so at most two runs either side of it.
    function stepSmoke(dt) {
      const wx = .3 * dt, wz = -.1 * dt; let lo1 = PN, hi1 = -1, lo2 = PN, hi2 = -1; pLive = 0;
      for (let i = 0; i < PN; i++) {
        if (pLife[i] <= 0) continue;
        if (i < pHead) { if (i < lo1) lo1 = i; hi1 = i; } else { if (i < lo2) lo2 = i; hi2 = i; }
        pLife[i] -= dt; if (pLife[i] <= 0) { pSize[i] = 0; pAlpha[i] = 0; continue; }
        pLive++;
        const k = 1 - pLife[i] / pMax[i], i3 = i * 3, f = Math.exp(-pDrag[i] * dt);
        pVel[i3] = pVel[i3] * f + wx; pVel[i3 + 1] = pVel[i3 + 1] * f + pRise[i] * dt; pVel[i3 + 2] = pVel[i3 + 2] * f + wz;
        pPos[i3] += pVel[i3] * dt; pPos[i3 + 1] += pVel[i3 + 1] * dt; pPos[i3 + 2] += pVel[i3 + 2] * dt;
        if (pPos[i3 + 1] < .05) { pPos[i3 + 1] = .05; pVel[i3 + 1] = Math.abs(pVel[i3 + 1]) * .3; }
        pSize[i] = pS0[i] + (pS1[i] - pS0[i]) * (1 - (1 - k) * (1 - k));
        pAlpha[i] = pA0[i] * Math.min(1, k * 8) * Math.pow(1 - k, 1.4); pRot[i] += pSpin[i] * dt;
      }
      const any = hi1 >= 0 || hi2 >= 0;
      if (any) for (let a = 0; a < 4; a++) { const at = PATTRS[a], n = PWIDTH[a]; if (hi1 >= 0) at.addUpdateRange(lo1 * n, (hi1 - lo1 + 1) * n); if (hi2 >= 0) at.addUpdateRange(lo2 * n, (hi2 - lo2 + 1) * n); at.needsUpdate = true; }
      if (cCount) { const ac = pGeo.attributes.aColor, end = cFrom + cCount; if (end <= PN) ac.addUpdateRange(cFrom * 3, cCount * 3); else { ac.addUpdateRange(cFrom * 3, (PN - cFrom) * 3); ac.addUpdateRange(0, (end - PN) * 3); } ac.needsUpdate = true; cCount = 0; }
      smoke.visible = any;
      if (pLive) want(30);
      pMat.uniforms.uScale.value = ctx.size.h * renderer.getPixelRatio() / (2 * Math.tan(camera.fov * PI / 360));
    }

    return {
      update(dt, time) {
        const reduced = ctx.reduced; dt = Math.min(dt, .1); painted = 0; fps = 0; pendingPaint = tickWait = false;
        const snap = first || reduced, pulse = reduced ? 1 : .72 + .28 * Math.sin(time * 5.5);
        tvT.value = time;
        if (world.usage !== usageRef) { usageRef = world.usage; syncBoard(); }
        ppu = ctx.size.h / (2 * Math.tan(camera.fov * PI / 360) * camera.position.y / Math.cos(.5)); platePx = PLATE.session.h * .41 * ppu;
        if (hubTag()) placeHubTags();
        // Junctions: the governor spins with their machines' work; the gauge reads pressure, pinned in the red when a session needs you.
        let activity = 0;
        for (let pi = 0; pi < world.projects.length; pi++) {
          const p = world.projects[pi], g = PG.get(p), rig = g.rig, tx = p.drag ? p.pos.x : p.rest.x, tz = p.drag ? p.pos.z : p.rest.z;
          if (snap || !g.init || (Math.abs(g.x - tx) < .002 && Math.abs(g.z - tz) < .002)) { g.x = tx; g.z = tz; }
          else { g.x = kit.damp(g.x, tx, 8, dt); g.z = kit.damp(g.z, tz, 8, dt); want(Infinity); }
          g.init = true; g.body.x = g.x; g.body.z = g.z;
          let work = 0, heat = 0, need = 0, err = 0, think = 0, urg = 0;
          for (let j = 0; j < p.sessions.length; j++) { const s = p.sessions[j]; if (s.s.alive < .05) continue; work += s.s.work; heat = Math.max(heat, s.s.heat); need = Math.max(need, s.s.need); err = Math.max(err, s.s.error); think = Math.max(think, s.s.think + s.s.compact); if (s.s.need > .3) urg = Math.max(urg, s.s.urgency || 0); }
          g.work = work; g.heat = heat; g.need = need; g.err = err; g.urg = urg; activity += work;
          if (!reduced) { if (work > .01 || need > .01 || err > .01) want(30); else if (think > .01) want(20); }
          // The governor turns only while its machines work: no idle creep, so a quiet plant draws no frames.
          const goal = work > .05 ? .25 + .2 * Math.min(3, work) + .25 * heat : 0;
          g.w = reduced ? 0 : ease(g.w, goal, 2, dt, .003); g.gv += g.w * 1.6 * TAU * dt;
          const hl = Math.max(p.s.hover, p.s.select), X = g.x, Z = g.z;
          M4.makeScale(JS, JS, JS).setPosition(X, 0, Z); bMat(g.bid, M4); bCol(g.bid, V4.set(1 + .2 * hl, 1 + .2 * hl, 1 + .2 * hl, 0));
          const G = rig.governor, sp = clamp(g.w * 1.4, 0, 1);
          setT(govs, g.i, X + G.x * JS, G.y * JS, Z + G.z * JS, g.gv, (1.3 + .3 * sp) * JS, (1.3 - .15 * sp) * JS, (1.3 + .3 * sp) * JS);
          if (!reduced && work > .05 && rnd() < dt * (.4 + .6 * work)) steam(X + G.x * JS, G.y * JS + .7, Z + G.z * JS, .4, .35);
          const pr = need > .3 ? .86 + .12 * urg : err > .3 ? .99 : .08 + .17 * Math.min(3, work) + .08 * heat + .12 * think;
          g.pr = snap ? pr : ease(g.pr, pr, 3, dt, .002);
          gauge(g.gauge, rig.gauges[0], X, Z, JS, g.pr, tc.copy(DIAL).lerp(DIAL_NEED, need * (.55 + .45 * pulse)).lerp(DIAL_ERR, err * (need > .3 ? 0 : 1)));
          tc2.copy(need > .3 ? LC.need : err > .3 ? LC.error : work > .3 ? LC.work : think > .3 ? LC.think : LC.idle);
          if (need > .3 || err > .3) tc2.multiplyScalar(pulse);
          if (snap || Math.abs(g.col.r - tc2.r) + Math.abs(g.col.g - tc2.g) + Math.abs(g.col.b - tc2.b) < .006) g.col.copy(tc2);
          else { g.col.lerp(tc2, 1 - Math.exp(-dt * 6)); want(30); }
          const jq = g.q; jq.work = Math.min(1, work); jq.think = Math.min(1, think); jq.compact = 0; jq.need = need; jq.wait = 0; jq.error = err; jq.off = 0; jq.heat = heat;
          jq.idle = Math.max(0, 1 - jq.work - jq.think - need - err);
          glow(g.glow, jq, time, g.i * 1.7, reduced, urg);
          for (let j = 0; j < rig.tubes.length; j++) { const t = rig.tubes[j]; tube(T_J + 2 * g.i + j, X + t[0] * JS, t[1] * JS, Z + t[2] * JS, .15 * JS, .72 * JS, g.glow); }
          const nl = Math.min(6, p.sessions.length);
          const B = rig.bulbs;
          for (let j = 0; j < nl; j++) { const s2 = p.sessions[j], k = L_JB + g.jb + j; setT(lamps, k, X + (j - (nl - 1) / 2) * B.dx * JS, B.y * JS, Z + B.z * JS, 0, B.r * JS * s2.s.alive); putC(lamps, k, bulb(s2.s, tc, pulse)); }
          setT(pools, POOL_P + g.i, X, .02, Z, 0, 6.5 * JS); putC(pools, POOL_P + g.i, tc.copy(g.glow).multiplyScalar(.012).add(tc2.copy(YOU_GOLD).multiplyScalar(.02)));
          showPlate(g.plate, X, Z + PLATE.project.z, 1, p.name, '', '', hl);
        }
        // Machines: the node is the station; the machine stands MZ behind it, the nameplate in front.
        let relay = false;
        for (let sj = 0; sj < world.sessions.length; sj++) {
          const s = world.sessions[sj], g = SG.get(s), q = s.s, pg = PG.get(s.parent), rig = g.rig;
          const mx = pg.x + g.ox, mz = pg.z + g.oz;
          g.px = kit.damp(g.px, s.drag ? s.pos.x - mx : 0, 8, dt); g.pz = kit.damp(g.pz, s.drag ? s.pos.z - mz : 0, 8, dt);
          if (Math.abs(g.px) + Math.abs(g.pz) < .003) g.px = g.pz = 0; else want(Infinity);
          const grow = q.alive < .005 ? 0 : kit.easeOutCubic(q.alive), sc = grow * US, urg = q.need > .3 ? (q.urgency || 0) : 0, hl = Math.max(q.hover, q.select);
          const SX = mx + g.px, SZ = mz + g.pz, X = SX, Z = SZ + MZ * grow;
          g.sx = SX; g.sz = SZ; g.x = X; g.z = Z; g.sc = grow; g.body.x = X; g.body.z = Z; g.body.on = q.alive > .1;
          WX = X; WZ = Z; WS = sc;
          if (!reduced) {
            g.ph += dt * TAU * ((1.3 + 1.5 * Math.min(1, q.heat)) * q.work + .25 * q.think); g.bp += dt * TAU * 1.1 * q.compact;
            if (q.work > .01 || q.compact > .01 || q.need > .01 || q.error > .01) want(30); else if (q.think > .01) want(20);
          }
          M4.compose(V.set(X, 0, Z), Q.identity(), S3.setScalar(Math.max(1e-4, sc))); bMat(g.bid, M4); bVis(g.bid, sc > .001);
          bCol(g.bid, tint4(q, hl, 0));
          // Gauge: working pressure, swinging while thinking, low when idle, deep in the red when it needs you, pinned on error. The second one is heat.
          const swing = reduced ? .5 : .5 + .5 * Math.sin(time * 2.4 + g.i * 1.3);
          let nd = q.work * (.5 + .12 * Math.min(1, q.heat)) + q.think * (.22 + .4 * swing) + q.compact * .38 + q.wait * .2 + q.idle * .06 + q.need * (.86 + .12 * urg) + q.error * .99;
          if (!reduced && q.error > .5) nd += ((Math.floor(time * 12) * 7 + g.i * 3) % 5 - 2) * .01;
          g.nd = snap ? nd : ease(g.nd, nd, 5, dt, .002);
          const h2 = .15 + .55 * q.heat + .25 * q.work;
          g.h2 = snap ? h2 : ease(g.h2, h2, 3, dt, .002);
          const dialTint = tc2.copy(DIAL).lerp(DIAL_IDLE, clamp(q.idle * .8 + q.wait * .3, 0, 1)).lerp(DIAL_OFF, q.off).lerp(DIAL_NEED, q.need * (.55 + .45 * pulse)).lerp(DIAL_ERR, q.error);
          for (let j = 0; j < rig.gauges.length; j++) gauge(g.gauge[j], rig.gauges[j], X, Z, sc, j ? g.h2 : g.nd, dialTint);
          for (let j = 0; j < rig.rods.length; j++) {
            const rd = rig.rods[j], o = rd.stroke * Math.sin(g.ph + rd.ph);
            if (rd.axis) setR(rods, g.rod[j], X + (rd.x + o) * sc, rd.y * sc, Z + rd.z * sc, 0, 0, -HP, rd.r * sc, rd.len * sc, rd.r * sc); else setT(rods, g.rod[j], X + rd.x * sc, (rd.y + o) * sc, Z + rd.z * sc, 0, rd.r * sc, rd.len * sc, rd.r * sc);
          }
          tc.copy(WHEEL_C).multiplyScalar(1 + .3 * hl);
          for (let j = 0; j < rig.wheels.length; j++) { const w = rig.wheels[j]; setR(wheels, g.wheel[j], X + w.x * sc, w.y * sc, Z + w.z * sc, 0, 0, -g.ph * .8, w.r * sc); putC(wheels, g.wheel[j], tc); }
          signal(g.glow, q, time, g.i * 2.3, reduced, urg);
          W3(rig.lamp); tube(2 * g.i, tA.x, tA.y, tA.z, .11 * sc, .56 * sc, g.glow);
          W3(TUBE2); tube(2 * g.i + 1, tA.x, tA.y, tA.z, .085 * sc, .4 * sc, tc.copy(g.glow).multiplyScalar(Math.max(.4 + 1.2 * q.heat, q.need + q.error)));
          W3(rig.mode); setT(lamps, g.i, tA.x, tA.y + .045 * sc, tA.z, 0, .045 * sc);
          putC(lamps, g.i, s.mode === 'plan' ? LC.wait : s.mode === 'bypass' ? LC.error : MODE_OFF);
          if (g.pips) {
            const lit = Math.round((s.plan?.done || 0) / Math.max(1, s.plan?.total || 1) * g.pips);
            for (let j = 0; j < g.pips; j++) {
              const f = (j + .5) / g.pips; W(PLAN.x0 + (PLAN.x1 - PLAN.x0) * f, PLAN.y, PLAN.z0 + (PLAN.z1 - PLAN.z0) * f);
              setT(lamps, L_PIP + g.pip + j, tA.x, tA.y, tA.z, 0, .03 * sc);
              putC(lamps, L_PIP + g.pip + j, j < lit ? PIP_ON : j === lit && q.work > .5 ? tc.copy(PIP_ON).multiplyScalar(.3) : PIP_OFF);
            }
          }
          const cx = clamp(q.ctx ?? s.ctx ?? 0, 0, 1);
          setT(fills, g.i, X + SIGHT.x * sc, SIGHT.y * sc, Z + SIGHT.z * sc, 0, SIGHT.len * Math.max(.02, cx) * sc, sc, sc);
          putC(fills, g.i, cx > .8 ? FILL_HI : tc.copy(FILL_LO).lerp(FILL_MID, clamp((cx - .5) / .3, 0, 1)).multiplyScalar(1 - .6 * q.off));
          setT(bellows, g.i, X + BELLOWS[0] * sc, (Y0 + .03) * sc, Z + BELLOWS[1] * sc, 0, .8 * sc, .8 * sc * (1 - .5 * q.compact * (.5 - .5 * Math.cos(g.bp))), .8 * sc);
          tc.copy(g.glow).multiplyScalar(.012).add(tc2.copy(POOL_NEED).multiplyScalar(q.need * (.6 + .3 * urg) * pulse)).add(tc2.copy(POOL_ERR).multiplyScalar(q.error * .8)).add(tc2.copy(POOL_WORK).multiplyScalar(q.work * .1)).add(tc2.copy(YOU_GOLD).multiplyScalar(.03 * (1 - q.off)));
          setT(pools, POOL_S + g.i, X, .025, Z + .6 * grow, 0, 4.4 * grow); putC(pools, POOL_S + g.i, tc);
          const tn = tone(s);
          if (grow > .01) showPlate(g.plate, SX, SZ + PLATE.session.z * grow, grow, s.name, lineOf(s, tn), tn, hl); else hidePlate(g.plate);
          const shot = ctx.shot?.(s);
          if (!!shot !== hasTV.has(s)) { if (shot) hasTV.add(s); else hasTV.delete(s); relay = true; }
          if (shot && grow > .01) {
            g.tv ||= makeTV();
            if (g.tv.shot !== shot) { g.tv.shot = shot; paintTV(g.tv.g, TV.cw, TV.ch, shot.bitmap, shot.count || 1); g.tv.tex.needsUpdate = true; }
            const bx = SX + TV.x * grow, bz = SZ + TV.z * grow, tg = grow * TV.k;
            setT(tvWood, g.i, bx, 0, bz, 0, tg); setT(tvBrass, g.i, bx, 0, bz, 0, tg); setT(tvWire, g.i, bx, 0, bz, 0, tg);
            g.tv.mesh.visible = true; g.tv.mesh.position.set(bx, .125 * tg, bz); g.tv.mesh.scale.setScalar(tg);
            g.tv.mesh.material.emissiveIntensity = TV_GLOW * (1 + .15 * hl); g.target?.pos.set(bx, .2, bz);
            const roll = reduced ? 0 : Math.max(q.work, q.think, q.compact, q.need, q.error);
            g.tv.roll.value = snap ? roll : ease(g.tv.roll.value, roll, 2, dt, .005);
            if (g.tv.roll.value > .005) want(30);
            for (let j = 0; j < TV_TUBES.length; j++) { const t = TV_TUBES[j]; tube(T_TV + 4 * g.i + j, bx + t[0] * tg, CY * tg, bz + CZ * tg, t[1] * tg, t[2] * tg, j % 3 ? tc.copy(g.glow).multiplyScalar(.6) : g.glow); }
            gauge(g.meters[0], TV_MC[0], bx, bz, tg, cx, METER); gauge(g.meters[1], TV_MC[1], bx, bz, tg, g.h2, METER);
            tc.copy(AMB).multiplyScalar((.1 + .25 * q.work) * (1 - q.off));
            for (let j = 0; j < 5; j++) { const k = L_TVB + 5 * g.i + j; setT(lamps, k, bx + (j - 2) * .2 * tg, (CY + .035) * tg, bz + (CZ - .17) * tg, 0, .035 * tg); putC(lamps, k, tc); }
          } else {
            hide(tvWood, g.i); hide(tvBrass, g.i); hide(tvWire, g.i); if (g.tv) g.tv.mesh.visible = false; g.target?.pos.set(0, -50, 0);
            for (let j = 0; j < 4; j++) hideTube(T_TV + 4 * g.i + j);
            for (let j = 0; j < 2; j++) { hide(dials, g.meters[j]); hide(needles, g.meters[j]); }
            for (let j = 0; j < 5; j++) hide(lamps, L_TVB + 5 * g.i + j);
          }
          if (!reduced && q.alive > .5) {
            const wh = rig.whistle;
            if (q.need > .5 && (g.wh -= dt) < 0) { g.wh = 1.5 - urg + rnd() * .3; for (let k = 0; k < 4 + 4 * urg; k++) jet(X + wh[0] * US, wh[1] * US, Z + wh[2] * US, .55 + .25 * urg); }
            if (q.error > .5 && (g.sp -= dt) < 0) { g.sp = 1.1 + rnd() * .7; burst(X, .7, Z, 5, .7, STEAM, .75); for (let k = 0; k < 4; k++) spark(X, .6, Z); if (rnd() < .5) steam(X, .7, Z, .7, .5, SOOT); }
            if (q.compact > .5 && rnd() < dt * 2.5) steam(X + BELLOWS[0] * US, .42, Z + BELLOWS[1] * US, .4, .4);
            if (q.work > .5 && rnd() < dt * 1.4) { const ex = rig.exhaust || rig.lamp; steam(X + ex[0] * US, ex[1] * US, Z + ex[2] * US, .32, .35); }
            // The stack smokes with work and thought; an idle machine stands still (smoke would keep the plant drawing all day).
            if (rig.smoke && rnd() < dt * (.9 * q.work + .3 * q.think)) steam(X + rig.smoke[0] * US, rig.smoke[1] * US, Z + rig.smoke[2] * US, .32, .3, SOOT);
          }
        }
        if (relay) layout();
        // Subagent valves, beside their machine.
        for (let ki = 0; ki < world.subs.length; ki++) {
          const k = world.subs[ki], g = KG.get(k), sg = SG.get(k.parent), q = k.s;
          g.x = sg.sx + g.ox * sg.sc; g.z = sg.sz + g.oz * sg.sc; g.body.x = g.x; g.body.z = g.z; g.body.on = q.alive > .1 && sg.body.on;
          if (!reduced) { g.th += dt * (2.5 * q.work + .6 * q.think); if (q.work > .01 || q.need > .01 || q.error > .01) want(30); else if (q.think > .01) want(20); }
          const sc = (q.alive < .005 ? 0 : kit.easeOutCubic(q.alive) * Math.min(1, sg.sc)) * KS;
          setT(kBody, g.i, g.x, 0, g.z, 0, sc); setT(kWheel, g.i, g.x, 0, g.z, g.th, sc);
          putC(kWheel, g.i, tc.copy(KW[k.provider] || KW.claude).lerp(OFF_TINT, q.off).lerp(LC.need, q.need * .25).lerp(LC.error, q.error * .25).multiplyScalar(1 + .4 * Math.max(q.hover, q.select)));
          setT(lamps, L_SUB + g.i, g.x, .37 * sc, g.z, 0, .045 * sc); putC(lamps, L_SUB + g.i, lampColor(q, tc2, pulse));
        }
        // You: the boiler. Pressure, firebox and whistle rise with the queue.
        const queue = world.queue().length; let urg = 0; for (let j = 0; j < world.sessions.length; j++) { const q = world.sessions[j].s; if (q.need > .3) urg = Math.max(urg, q.urgency || 0); }
        warm = snap ? (queue ? 1 : 0) : ease(warm, queue ? 1 : 0, 3, dt, .002);
        const yr = YOU.rig;
        const ypr = queue ? .84 + .04 * Math.min(3, queue) + .1 * urg : .3 + .08 * Math.min(4, activity);
        yp = snap ? ypr : ease(yp, ypr, 3, dt, .002);
        gauge(0, yr.gauge, 0, 0, 1, yp, tc.copy(DIAL).lerp(DIAL_NEED, warm * (.55 + .45 * pulse)));
        // The firebox flickers, its tubes waver and its stack smokes only while there's fire: work on the plant or someone waiting.
        const fire = clamp(activity + warm, 0, 1);
        if (!reduced && (fire > .01 || queue)) want(30);
        const flick = reduced ? 1 : 1 + fire * (.06 * Math.sin(time * 13) + .04 * Math.sin(time * 31.7));
        bMat(youId, M4.identity()); bCol(youId, V4.set(1, 1, 1, (.35 + .12 * Math.min(4, activity) + .8 * warm * pulse) * flick));
        if (!reduced) {
          if (queue && (yWhistle -= dt) < 0) { yWhistle = 2.2 - 1.3 * urg; const w = yr.whistle; for (let k = 0; k < 5 + 5 * urg; k++) jet(w[0], w[1], w[2], .8 + .3 * urg); }
          if ((activity > .05 || queue) && rnd() < dt * (.8 + .5 * Math.min(4, activity))) steam(yr.smoke[0], yr.smoke[1], yr.smoke[2], .7, .45, SOOT);
        }
        setT(pools, 0, 0, .02, .4, 0, 13 + 2 * warm); putC(pools, 0, tc.copy(YOU_GOLD).multiplyScalar(.035 + .1 * warm * pulse + .02 * Math.min(4, activity)));
        for (let j = 0; j < yr.tubes.length; j++) {
          const t = yr.tubes[j];
          tube(T_Y + j, t[0], t[1], t[2], .14, j % 2 ? .62 : .82, tc.copy(FIL).multiplyScalar((.3 + .15 * Math.min(4, activity)) * (reduced ? 1 : 1 + .08 * fire * Math.sin(time * 13 + j * 2))).add(tc2.copy(AMB).multiplyScalar(warm * (reduced ? 1 : .55 + .45 * pulse))));
        }
        if (queue !== yq) { yq = queue; yLine = queue ? `${queue} waiting` : 'all clear'; }
        showPlate(youPlate, 0, PLATE.you.z, 1, 'You', yLine, queue ? 'need' : 'idle', world.you.s.hover);
        // The gauge board's needles and warning lamps. Past 90% the lamp burns a steady red: a beat would keep the plant drawing for hours.
        if (board.lay) {
          const cells = board.lay.cells;
          for (let i = 0; i < cells.length; i++) {
            const c = cells[i], dial = c.kind === 'win' || c.limit;
            board.val[i] = snap ? c.used : ease(board.val[i], c.used, 3, dt, .001);
            O.position.set(c.x, c.y, .025); O.rotation.set(0, 0, gaugeAng(board.val[i])); O.scale.setScalar(dial ? c.r * 1.08 : 1e-4); put(board.needles, i);
            putC(board.lamps, i, !dial ? MODE_OFF : c.used >= .9 ? WARN_RED : c.used >= .75 ? WARN_AMBER : MODE_OFF);
          }
        }
        // Pipes: re-route when anything moved or a machine came or went.
        let si = 0;
        for (let j = 0; j < world.projects.length; j++) { const g = PG.get(world.projects[j]); sigNow[si++] = g.x; sigNow[si++] = g.z; }
        for (let j = 0; j < pipes.length; j++) { const pp = pipes[j]; if (pp.tier < 2) continue; pp.on = pp.A.on; sigNow[si++] = pp.on ? 1 : 0; sigNow[si++] = pp.A.x; sigNow[si++] = pp.A.z; }
        let moved = false; for (let k = 0; k < si; k++) if (!(Math.abs(sigNow[k] - sigBuilt[k]) < .004)) { moved = true; break; }
        if (moved) { rebuildPipes(); sigBuilt.set(sigNow); }
        // Pulses: subagent → machine → junction → boiler. Walk the tiers backwards so a pulse handed on starts next frame's leg at 0.
        for (let pi = pipes.length - 1; pi >= 0; pi--) {
          const pp = pipes[pi], uP = pipeU.uP.value[pp.idx], uG = pipeU.uG.value[pp.idx], uM = pipeU.uM.value[pp.idx];
          if (!pp.path) { pp.pulses.list.length = 0; pp.gold.list.length = 0; uP.set(-1, -1, -1, -1); uG.set(-1, -1, -1, -1); uM.set(0, 0, 1, 0); continue; }
          const q = pp.tier === 1 ? pp.g : (pp.s || pp.k).s, L = pp.path.len;
          if (pp.tier === 2 && !reduced && q.need > .5 && (pp.needT -= dt) <= 0) { pp.gold.add(pp.speed * .8, 1, { prev: 0 }); pp.needT = 2 - (q.urgency || 0); } else if (pp.tier === 2 && q.need <= .5) pp.needT = 0;
          if (reduced) { pp.pulses.list.length = 0; pp.gold.list.length = 0; }
          markPrev(pp.pulses.list); markPrev(pp.gold.list);
          const done = pp.pulses.update(dt); let nd = done.length; cross(pp, done, false); cross(pp, pp.pulses.list, false);
          const gdone = pp.gold.update(dt), ng = gdone.length; cross(pp, gdone, true); cross(pp, pp.gold.list, true);
          if (pp.next) { for (; nd > 0; nd--) pp.next.pulses.add(pp.next.speed, 1, { prev: 0 }); if (ng) pp.next.gold.add(pp.next.speed * .8, 1, { prev: 0 }); }
          else if (nd || ng) { pp.flash = Math.max(pp.flash, ng ? 1 : .5); const E = pp.path.E; ringPuff(E.x + E.dx * .3, .35, E.z + E.dz * .3, .25, .5, 10, ng ? GOLDSTEAM : STEAM); }
          pp.pulses.vec4(uP); pp.gold.vec4(uG);
          uM.set(q.need * (reduced ? .4 : .06), q.heat * (reduced ? .3 : .05), (pp.tier === 1 ? .35 : pp.tier === 2 ? .22 : .14) / L, 0);
          pp.flash = Math.max(0, pp.flash - dt * 2.5);
          // A steam pulse is a short bright blob running down the pipe: it needs every frame to read as motion; gold is slower and wider.
          if (pp.pulses.list.length) want(60);
          if (pp.gold.list.length || pp.flash > 0) want(30);
          if (pp.tier === 1) {
            const g = pp.g, r = pp.r;
            pp.hw += reduced ? 0 : dt * (g.heat * 3 + g.work * .4);
            if (pp.valve) setT(handM, pp.idx, pp.valve.x, WHEEL_Y * r, pp.valve.z, pp.valve.ry + pp.hw, r);
            // The line's relief valve lifts while a session on it needs you.
            if (pp.relief && !reduced && g.need > .5 && (pp.vent -= dt) < 0) { pp.vent = 1.6 - .8 * g.urg; for (let k = 0; k < 3 + 3 * g.urg; k++) jet(pp.relief.x, RELIEF_TOP * r, pp.relief.z, .5 + .2 * g.urg, GOLDSTEAM); }
            const E = pp.path.E;
            setT(lamps, L_JUN + pp.idx, E.x + E.dx * .08, .5, E.z + E.dz * .08, 0, .09 + .04 * pp.flash);
            tc2.copy(g.col).multiplyScalar(.8 + pp.flash * 1.5); if (g.need > .3) tc2.lerp(LC.need, pp.flash); putC(lamps, L_JUN + pp.idx, tc2);
          }
        }
        for (let j = 0; j < insts.length; j++) flush(insts[j]);
        if (reduced) smoke.visible = false; else stepSmoke(dt);
        // The shadow map is redrawn only on a frame where something that casts moved (see put/bMat/layout).
        if (shadowDirty) { renderer.shadowMap.needsUpdate = true; shadowDirty = false; }
        if (pendingPaint) want(Infinity); else if (tickWait) want(2);
        first = false;
        return fps;
      },

      event(type, n, data) {
        if (n.kind !== 'session' && n.kind !== 'sub') return;
        const sub = n.kind === 'sub', g = sub ? KG.get(n) : SG.get(n);
        if (!g) return;
        const pp = pipes[sub ? NP + NS + g.i : NP + g.i], x = g.x, z = g.z, wh = sub ? null : g.rig.whistle;
        // Only real work sends steam up the line; idle, waiting and offline machines' pipes stay calm.
        if (type === 'tool') { if (!ctx.reduced && pp.path && WORKING.has(n.status)) pp.pulses.add(pp.speed, 1, { prev: 0 }); }
        else if (type === 'need') { if (!sub) for (let k = 0; k < 8; k++) jet(x + wh[0] * US, wh[1] * US, z + wh[2] * US, .7); if (!ctx.reduced && pp.path && !sub) { pp.gold.add(pp.speed * .8, 1, { prev: 0 }); pp.needT = 2; } }
        else if (type === 'answer') ringPuff(x, .65, z, .45, .6);
        else if (type === 'state' && data?.to === 'error') { burst(x, .7, z, 10, .9, STEAM, .8); for (let k = 0; k < 10; k++) spark(x, .6, z); }
        else if (type === 'compacted') burst(x + BELLOWS[0] * US, .45, z + BELLOWS[1] * US, 6, .6, STEAM);
        else if (type === 'spawn' || type === 'despawn') burst(x, .3, z, sub ? 3 : 6, sub ? .4 : .6, STEAM);
        else if (type === 'finish') steam(x, .9, z, .7, .55);
      },

      dispose() { disposed = true; clearBoard(); boardNeedleGeo.dispose(); boardFrame.dispose(); batch.dispose(); own.forEach(t => t.dispose()); },
    };
  },
};
