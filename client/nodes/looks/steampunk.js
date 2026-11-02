import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as kit from '../kit.js';

// A steam plant standing on a dark floor. You are the boiler in the middle, every account's usage on the gauge board in front of it.
// Projects are pipe junctions, sessions are machines branching off them, subagents valves beside their machine. Each junction and
// machine is built from its id (body, cylinders, stack, gauges, trim), so it looks the same on every device and differs from its
// neighbours; on every machine the gas lamp is its state, the big gauge its pressure, the sight glass its context and the brass pips its
// plan, and a brass nameplate in front carries its name and what it's doing. Pipes are plumbing on the floor (straight runs, 45°/90°
// elbows, flanges): tool calls are steam pulses machine → junction → boiler, needs-you runs gold along the same route.

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
// Does the segment a→b cross the rectangle [x0, x1] × [z0, z1]? (slab test)
function segRect(ax, az, bx, bz, x0, x1, z0, z1) {
  let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dz, az - z0], [dz, z1 - az]]) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const t = q / p; if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
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
// A session is a station: its machine (modelled at radius UR, drawn US times larger) MZ behind the node, its nameplate in front. ──
const UR = .95, US = 1.5, AU = UR * Math.cos(PI / 8), JR = .95, JA = JR * Math.cos(PI / 8), BR = 4.5, AB = BR * Math.cos(PI / 8), KS = 1.4, AK = .2 * KS * Math.cos(PI / 8);
const Y0 = .14, MZ = -1;
const TIER_R = [0, .16, .075, .04], PY = 1.25;
const FD = Array.from({ length: 8 }, (_, k) => [Math.cos(k * PI / 4), Math.sin(k * PI / 4)]);
const PROV = { claude: '#c4703f', codex: '#56668c', opencode: '#d2d2c8' };
const RIVET = '#fff1c8 0 .8px, #c8963f 1.6px, #4a3214 2.7px, transparent 3.2px';
// Every machine keeps these in the same place, so they read alike: sight glass along the front, plan pips on the front-right face,
// mode bulb at the back right, bellows at the back left, a second filament tube at the front left. Bodies stand in the middle; pipes
// leave by the left and back, the nameplate is in front, subagent valves stand on the left and the televisor (with screenshots) on the right.
const TUBE2 = [-.7, Y0, .3], SIGHT = { x: -.42, y: .22, z: .66, len: .56 }, PLAN = { x0: .76, z0: .4, x1: .42, z1: .74, y: .175, max: 10 }, MODE = [.6, -.55], BELLOWS = [-.6, -.5];
const UNIT_FREE = [4, 5, 6, 7];
const TYPES = ['upright', 'tank', 'pistons', 'condenser', 'still', 'pumphouse'];
// Nameplates stand on the floor, leaning back to face the camera: width, height, where the bottom edge is (from the node), canvas size.
// The televisor of a session with screenshots lies on the floor right of its machine: a bulging CRT in a bent brass frame on a walnut
// slab, its console along the back edge with filament tubes, knobs, two meters and indicator bulbs. (x, z): its screen's centre from the node.
const TV = { x: 3.15, z: -.82, sw: 2.5, sh: 1.6, cw: 512, ch: 328, half: 1.5 };
const LEAN = -1.07, PLATE = {
  session: { w: 5.2, h: 1.35, z: 1.52, cw: 768, ch: 200 },
  project: { w: 3.3, h: .7, z: JR + .95, cw: 512, ch: 108 },
  you: { w: 4, h: 1.3, z: AB + 1.3, cw: 512, ch: 166 },
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
  const fire = (x, y, z, w, h) => { b.add(place(box(w + .06, h + .06, .04), x, y, z), 'black'); b.add(place(box(w, h, .03), x, y, z + .015), 'fire'); };
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
      fire(cx, Y0 + .2, cz + R0 + .01, .17, .1);
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
      fire(cx, Y0 + .05, cz + Rt + .05, L * .3, .04); b.add(place(box(L * .35, .09, Rt * 2), cx, Y0 + .045, cz + .02), 'black');
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
      fire(w * .12, Y0 + .08, cz + .25, w * .45, .05);
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
      fire(cx, Y0 + .1, cz + R1 + .12, .12, .06);
      rig.lamp = lampPost(b, cx, y1 + H + .1, cz, .03, trim);
      b.add(place(cyl(.03, .02, .1, 8), cx + R1 * .6, y1 + H + .1, cz - .06), 'brass'); rig.whistle = [cx + R1 * .6, y1 + H + .2, cz - .06];
      rig.exhaust = [rx, Y0 + rh + .1, rz];
      if (r() < .5) { const h = rr(.3, .5); b.add(place(cyl(.045, .05, h, 10), cx + .3, Y0 + h / 2, -.5), 'black'); T(cyl(.065, .05, .04, 10), cx + .3, Y0 + h, -.5); rig.smoke = [cx + .3, Y0 + h + .05, -.5]; }
      break;
    }
    case 'still': {
      const s = rr(.85, 1.1), cx = -.16, cz = -.14, yb = Y0 + .12, tub = cx + .6;
      b.add(place(box(.62, .12, .56), cx, Y0 + .06, cz), 'iron'); fire(cx, Y0 + .06, cz + .29, .3, .05);
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
      for (let i = 0; i < nw; i++) { const x = wx0 + (wx1 - wx0) * (nw === 1 ? .5 : i / (nw - 1)); T(box(.11, .13, .015), x, Y0 + h * .55, fz + .005); b.add(place(box(.08, .1, .02), x, Y0 + h * .55, fz + .01), 'fire'); }
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


// A project's junction, from its id: a small header (upright drum, lying header or ball valve) on a plate, its pressure gauge, a
// governor spinning on top while its machines work, a lamp and a handwheel. It is where the pipes branch, not a machine of its own.
function junctionParts(seed) {
  const r = kit.rng(seed), pick = l => l[r() * l.length | 0], rr = (a, b) => a + (b - a) * r();
  const trim = pick(['brass', 'brass', 'copper', 'nickel']), body = pick(['copper', 'brass', 'gun', 'green', 'copper']);
  const b = parts(), T = (g, ...at) => b.add(place(g, ...at), trim), C = (g, ...at) => b.add(place(g, ...at), body);
  b.add(oct(JR, JR + .03, .18, .09), pick(['tread', 'iron', 'tread'])); T(flat(torus(JR - .04, .02, 4, 8)), 0, .18, 0, 0, PI / 8);
  b.add(many(octPts(JR - .1, 1).map(([x, z]) => place(rivet(.035), x, .18, z))), trim);
  const type = pick(['drum', 'header', 'ball']), rig = { gauges: [], governor: null, tubes: null };
  let top;
  if (type === 'drum') {
    const R = rr(.34, .42), h = rr(.32, .48);
    C(cyl(R, R, h, 24), 0, .18 + h / 2, -.1); C(hemi(R, 24, 6), 0, .18 + h, -.1, 0, 0, 0, 1, .45, 1);
    T(flat(torus(R + .01, .018, 5, 24)), 0, .18 + h * .5, -.1); b.add(many(ringY(12, R + .012, .18 + h * .5 + .035, .016, 0, -.1)), trim);
    top = .18 + h + R * .45;
  } else if (type === 'header') {
    const R = rr(.2, .26), L = rr(.9, 1.2), y = .26 + R;
    for (const s of [-1, 1]) b.add(place(box(.1, y - .18, R * 1.4), s * L * .3, (y + .18) / 2, -.12), 'iron');
    C(cyl(R, R, L, 24), 0, y, -.12, 0, 0, HP); C(hemi(R, 20, 5), L / 2, y, -.12, 0, 0, -HP, 1, .4, 1); C(hemi(R, 20, 5), -L / 2, y, -.12, 0, 0, HP, 1, .4, 1);
    for (const x of [-.3, .3]) T(torus(R + .01, .015, 5, 24), x * L, y, -.12, 0, HP);
    T(cyl(.12, .14, .12, 16), 0, y + R + .03, -.12); top = y + R + .09;
  } else {
    const R = rr(.32, .4), y = .3 + R * .9;
    b.add(place(cyl(.2, .26, .14, 16), 0, .25, -.1), 'iron'); C(ball(R, 24, 14), 0, y, -.1);
    T(torus(R + .005, .02, 6, 28), 0, y, -.1, HP); T(cyl(.09, .09, R * 2.3, 12), 0, y, -.1, 0, 0, HP); T(cyl(.09, .09, R * 2.3, 12), 0, y, -.1, HP);
    top = y + R;
  }
  rig.governor = { x: 0, y: top - .02, z: -.1 };
  const side = r() < .5 ? 1 : -1;
  rig.gauges.push(gaugeCase(b, side * .42, .5, .46, rr(.22, .26), .55, trim, .18));
  rig.tubes = [lampPost(b, -side * .6, .18, .26, .02, trim), lampPost(b, -side * .6, .18, .58, .02, trim)];
  b.add(bar(-.45, .8, .45, .8, .08, .03, .195), 'black');
  if (r() < .6) handwheel(b, -side * .52, .18, -.55, .12, pick(['red', 'black', 'brass']), .2, trim);
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
function engrave(g, text, x, y, font, size, max, color = '#160c03') {
  const t = fitText(g, text, font, size, max, .84);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,242,205,.4)'; g.fillText(t, x, y + Math.max(1, size * .05));
  g.fillStyle = g.strokeStyle = color; g.lineWidth = size * .045; g.lineJoin = 'round'; g.strokeText(t, x, y); g.fillText(t, x, y);
}
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
function paintPlate(g, kind, w, h, name, line, tone, seed) {
  g.clearRect(0, 0, w, h); brass(g, w, h, seed);
  const s = h * .085; for (const [x, y] of [[s * 1.9, s * 1.9], [w - s * 1.9, s * 1.9], [s * 1.9, h - s * 1.9], [w - s * 1.9, h - s * 1.9]]) stud(g, x, y, s);
  if (kind === 'project') return engrave(g, name.toUpperCase(), w / 2, h * .54, `700 $px ${CAPS}`, h * .5, w - s * 8);
  if (kind === 'you') { engrave(g, 'YOU', w / 2, h * .29, `700 $px ${CAPS}`, h * .34, w - s * 8); return ticker(g, line, w * .12, h * .52, w * .76, h * .38, tone); }
  engrave(g, name, w / 2, h * .28, `500 $px ${SERIF}`, h * .41, w - s * 4.5);
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
  gr = g.createLinearGradient(0, 0, w * .5, h * .6); gr.addColorStop(0, 'rgba(255,250,235,.16)'); gr.addColorStop(1, 'rgba(255,250,235,0)');
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
    const t = fitText(g, gp.label.toUpperCase(), `700 $px ${CAPS}`, nh * .62, x1 - x0 - 64, .6);
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

export default {
  id: 'steampunk',
  name: 'Steampunk',
  // HTML labels only show when the nameplates are too small to read (zoomed out, phones): then they are brass tags themselves.
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
body[data-look="steampunk"] .lbl.project b { font-family: var(--display); font-weight: 700; font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; }
body[data-look="steampunk"] .lbl.you b { font-family: var(--display); font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }`,

  create(ctx) {
    const { root, renderer, camera, world } = ctx, scene = ctx.scene;
    const rnd = Math.random, own = [];
    ctx.setView({ tilt: .5, fov: 30 });
    ctx.setMotion(kit.RIGID);
    ctx.setSizes({ you: BR - .6, project: JR + .3, session: 1.5, sub: .3 * KS });
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

    const O = new THREE.Object3D(), dyn = [], still = [];
    function setT(m, i, x, y, z, ry = 0, sx = 1, sy = sx, sz = sx) { O.position.set(x, y, z); O.rotation.set(0, ry, 0); O.scale.set(Math.max(1e-4, sx), Math.max(1e-4, sy), Math.max(1e-4, sz)); O.updateMatrix(); m.setMatrixAt(i, O.matrix); }
    function setR(m, i, x, y, z, rx, ry, rz, sx, sy = sx, sz = sx, order = 'XYZ') { O.position.set(x, y, z); O.rotation.set(rx, ry, rz, order); O.scale.set(Math.max(1e-4, sx), Math.max(1e-4, sy), Math.max(1e-4, sz)); O.updateMatrix(); m.setMatrixAt(i, O.matrix); }
    const hide = (m, i) => setT(m, i, 0, -50, 0, 0, 0);
    function inst(geo, material, count, { cast = true, color, fixed = false } = {}) {
      const m = new THREE.InstancedMesh(geo, material, Math.max(1, count)); m.frustumCulled = false; m.castShadow = cast; m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (color !== undefined) { const c = new THREE.Color(color); for (let i = 0; i < m.count; i++) m.setColorAt(i, c); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
      for (let i = 0; i < m.count; i++) hide(m, i);
      root.add(m); (fixed ? still : dyn).push(m); return m;
    }
    const NS = world.sessions.length, NP = world.projects.length, NK = world.subs.length, NPIPE = NP + NS + NK;

    // ── The machines: one batched draw for every body ──
    const YOU = cached('you', boilerParts);
    const PM = world.projects.map(p => cached(`j${p.seed}`, () => junctionParts(p.seed)));
    const UM = world.sessions.map(s => cached(`s${s.seed}${s.provider}`, () => unitParts(s.seed, s.provider)));
    let nv = 0, ni = 0;
    for (const { geo } of [YOU, ...PM, ...UM]) { nv += geo.attributes.position.count; ni += geo.index.count; }
    const batch = new THREE.BatchedMesh(1 + NP + NS, nv, ni, bodyMat);
    batch.castShadow = batch.receiveShadow = true; batch.frustumCulled = false; root.add(batch);
    const addBody = p => batch.addInstance(batch.addGeometry(p.geo));
    const youId = addBody(YOU), V4 = new THREE.Vector4();

    // ── Moving and lit parts, instanced across all machines ──
    const rigsU = UM.map(u => u.rig);
    const nGauge = 1 + NP + rigsU.reduce((s, r) => s + r.gauges.length, 0) + 2 * NS, nWheel = rigsU.reduce((s, r) => s + r.wheels.length, 0), nRod = rigsU.reduce((s, r) => s + r.rods.length, 0);
    const nPip = world.sessions.reduce((s, n) => s + Math.min(PLAN.max, n.plan?.total || 0), 0);
    const dialGeo = new THREE.CircleGeometry(1, 40).rotateX(-HP), needleGeo = merge([place(box(.8, .03, .07), .3, .03, 0), place(cyl(.08, .08, .05, 12), 0, .03, 0), place(box(.22, .03, .1), -.12, .03, 0)]);
    const dials = inst(dialGeo, dialMat, nGauge, { cast: false, color: '#ffffff' });
    const needles = inst(needleGeo, blackMat, nGauge, { cast: false });
    const wheels = inst(merge([torus(1, .08, 6, 36), ...Array.from({ length: 6 }, (_, i) => place(box(.92, .07, .05), Math.cos(i * PI / 3) * .48, Math.sin(i * PI / 3) * .48, 0, 0, 0, i * PI / 3)),
      place(cyl(.16, .16, .2, 14), 0, 0, 0, HP), place(cyl(.06, .06, .14, 8), .45, 0, .12, HP)]), mat({ color: '#ffffff', metalness: .8, roughness: .4 }), nWheel, { color: '#4a3a2c' });
    const rods = inst(merge([place(cyl(1, 1, 1, 8), 0, .5, 0), place(box(2.6, .22, 2.6), 0, 1, 0)]), steelMat, nRod);
    const govs = inst(merge([place(cyl(.03, .03, .5, 8), 0, .25, 0), place(ball(.045, 10, 6), 0, .52, 0), place(cyl(.06, .06, .05, 10), 0, .3, 0),
      ...[-1, 1].flatMap(s => [place(box(.02, .26, .02), s * .09, .4, 0, 0, 0, s * .6), place(ball(.065, 12, 8), s * .17, .3, 0)])]), brassMat, NP);
    const bellows = inst(new THREE.LatheGeometry([[.11, 0], [.13, .04], [.09, .08], [.13, .12], [.09, .16], [.13, .2], [.11, .24], [0, .25]].map(([r, y]) => new THREE.Vector2(r, y)), 16), leatherMat, NS);
    const fills = inst(place(cyl(.052, .052, 1, 10), .5, 0, 0, 0, 0, HP), lampMat, NS, { cast: false, color: '#000000' });
    // Indicator bulbs (HDR colour, blooms): machines' mode bulbs, plan pips, a bulb per session on its junction, subagent bulbs, the
    // boiler's inlet bulbs and the televisors' rows.
    const nJB = world.projects.reduce((s, p) => s + Math.min(6, p.sessions.length), 0);
    const L_PIP = NS, L_JB = L_PIP + nPip, L_SUB = L_JB + nJB, L_JUN = L_SUB + NK, L_TVB = L_JUN + NP;
    const lamps = inst(ball(1, 12, 8), lampMat, L_TVB + 5 * NS, { cast: false, color: '#000000' });
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
    const tubeGlass = inst(new THREE.LatheGeometry([[.95, .2], [1, .27], [1, .82], [.9, .95], [.62, 1.03], [.25, 1.07], [0, 1.075]].map(([x, y]) => new THREE.Vector2(x, y)), 16), glassMat, NT, { cast: false, color: '#000000' });
    tubeGlass.renderOrder = 1;
    const tubeFil = inst(merge([place(cyl(.07, .07, .4, 5), -.4, .42, 0), place(cyl(.07, .07, .4, 5), .4, .42, 0),
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[-.4, .6], [-.25, .88], [-.08, .62], [.08, .88], [.25, .62], [.4, .6]].map(([x, y]) => new THREE.Vector3(x, y, 0))), 30, .1, 5)]), lampMat, NT, { cast: false, color: '#000000' });
    const tGl = new THREE.Color();
    function tube(k, x, y, z, r, h, glow) {
      setT(tubeCap, k, x, y, z, 0, r, h, r); setT(tubeGlass, k, x, y, z, 0, r, h, r); setT(tubeFil, k, x, y, z, 0, r, h, r);
      tubeFil.setColorAt(k, glow); tubeGlass.setColorAt(k, tGl.copy(glow).multiplyScalar(.32));
    }
    const hideTube = k => { hide(tubeCap, k); hide(tubeGlass, k); hide(tubeFil, k); };
    // Soft light the tubes and fires cast on the floor.
    const POOL_P = 1, POOL_S = 1 + NP;
    const pools = inst(new THREE.PlaneGeometry(1, 1).rotateX(-HP), new THREE.MeshBasicMaterial({ map: kit.glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), POOL_S + NS, { cast: false, color: '#000000' });
    // Subagents: a little valve beside their machine; the handwheel turns while it works.
    const kBody = inst(merge([oct(.2, .22, .08, .04), place(cyl(.03, .03, .26, 8), 0, .2, 0), place(cyl(.06, .075, .07, 10), 0, .11, 0)]), brassMat, NK);
    const kWheel = inst(merge([place(torus(.13, .022, 6, 24), 0, .33, 0, HP), bar(-.13, 0, .13, 0, .025, .025, .33), bar(0, -.13, 0, .13, .025, .025, .33), place(cyl(.035, .035, .05, 8), 0, .33, 0)]),
      mat({ color: '#ffffff', metalness: 1, roughness: .25 }), NK, { color: '#3a5bd0' });
    // Nameplates: a canvas face each, on a shared dark frame and two posts.
    const NPL = NS + NP + 1, frames = inst(box(1, 1, 1), blackMat, NPL), posts = inst(cyl(.035, .045, 1, 8), brassMat, NPL * 2);
    // Televisors, all in floor units round the screen's centre: a walnut slab with the bulging screen on it in a bent brass frame with a
    // finial, the walnut console along its back edge with grille plates, knobs, two meter cases, a red cloth wire to a tube, and a brass
    // conduit to the machine. The screen is a canvas each, made when a session first has a screenshot.
    const CZ = -TV.sh / 2 - .38, CY = .32, conduitZ = MZ - TV.z;
    const TV_TUBES = [[-1.22, .11, .72], [-.97, .08, .46], [.97, .08, .46], [1.22, .11, .72]], TV_METERS = [[.22, .44, CZ + .17], [.54, .44, CZ + .17]];
    const tvWood = inst(merge([place(box(TV.sw + .34, .12, TV.sh + .3), 0, .06, .05), place(box(TV.sw + .44, CY, .56), 0, CY / 2, CZ)]), mat({ color: '#4a2a16', metalness: .05, roughness: .5 }), NS);
    const tvBrass = inst(merge([
      new THREE.TubeGeometry(new RoundRect(TV.sw / 2 + .07, TV.sh / 2 + .07, .36, .16), 120, .035, 6, true),
      place(cyl(.02, .03, .1, 8), 0, .2, -TV.sh / 2 - .07), place(ball(.05, 10, 6), 0, .27, -TV.sh / 2 - .07),
      place(box(TV.sw + .46, .03, .04), 0, CY + .01, CZ + .27), ...[-1, 1].map(sd => place(box(.5, .2, .02), sd * 1.15, CY * .5, CZ + .285)),
      ...[-.62, -.4, -.18].flatMap(x => [place(cyl(.075, .085, .06, 14), x, CY + .03, CZ + .08), place(box(.02, .02, .07), x, CY + .07, CZ + .06)]),
      ...TV_METERS.flatMap(([x, y, z]) => [place(cyl(.125, .115, .06, 18), x, y - .03, z - .02, .55), place(flat(torus(.122, .014, 5, 20)), x, y + .003, z, .55), place(cyl(.02, .02, y - CY, 6), x, (y + CY) / 2, z - .04)]),
      place(cyl(.045, .045, TV.x - TV.sw / 2 - .17 - AU * US, 10), (AU * US - TV.x - TV.sw / 2 - .17) / 2, .07, conduitZ, 0, 0, HP), place(cyl(.075, .075, .05, 10), -TV.sw / 2 - .17, .07, conduitZ, 0, 0, HP)]), brassMat, NS);
    const tvWire = inst(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-1.22, CY + .8, CZ), new THREE.Vector3(-1.5, CY + .9, CZ + .7), new THREE.Vector3(-TV.sw / 2 - .07, .17, -TV.sh / 2 + .2)), 16, .018, 5), mat({ color: '#9a1c12', roughness: .8 }), NS);
    const tvU = { uTvT: { value: 0 }, uRoll: { value: 1 } }, tvGeo = (() => {
      const g = new THREE.PlaneGeometry(TV.sw, TV.sh, 24, 16), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const u = 2 * p.getX(i) / TV.sw, v = 2 * p.getY(i) / TV.sh; p.setZ(i, .1 * Math.max(0, 1 - u * u) * Math.max(0, 1 - v * v)); }
      g.rotateX(-HP); g.computeVertexNormals(); return g;
    })();
    // The screen glows; a bright band rolls down it and it flickers a touch (not with reduced motion). Its square corners are cut away.
    function makeTV() {
      const cv = document.createElement('canvas'); cv.width = TV.cw; cv.height = TV.ch;
      const t = tex(new THREE.CanvasTexture(cv)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
      const m = mat({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: .85, metalness: 0, roughness: .1, envMapIntensity: .9, alphaTest: .5 });
      m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, tvU);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTvT; uniform float uRoll;').replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float rd = (fract(vMapUv.y - uTvT * .11) - .5) * 7.;
totalEmissiveRadiance *= 1. + uRoll * (.6 * exp(-rd * rd) + .08 * sin(uTvT * 47.));`);
      };
      m.customProgramCacheKey = () => 'sp-tv';
      const mesh = new THREE.Mesh(tvGeo, m); mesh.receiveShadow = true; root.add(mesh);
      return { g: cv.getContext('2d'), tex: t, mesh, shot: null };
    }

    // ── Per-node state ──
    const body = (ap, cr, free, slots) => ({ x: 0, z: 0, ap, cr, free, slots, used: new Int8Array(8), on: true });
    const ALL8 = [0, 1, 2, 3, 4, 5, 6, 7];
    const B_YOU = body(AB, BR + .2, [0, 1, 3, 4, 5, 6, 7], [0, .9, -.9]);
    const PG = new Map(), SG = new Map(), KG = new Map();
    let gi = 1, wi = 0, ri = 0, pi0 = 0, jb0 = 0;
    world.projects.forEach((p, i) => PG.set(p, { i, rig: PM[i].rig, bid: addBody(PM[i]), x: 0, z: 0, gv: 0, w: 0, pr: 0, col: new THREE.Color(), glow: new THREE.Color(), q: {}, jb: (jb0 += Math.min(6, p.sessions.length)) - Math.min(6, p.sessions.length), init: false, body: body(JA, JR + .15, ALL8, [0, .3, -.3]), gauge: gi++ }));
    world.sessions.forEach((s, i) => {
      const rig = rigsU[i], pips = Math.min(PLAN.max, s.plan?.total || 0);
      SG.set(s, { i, rig, bid: addBody(UM[i]), glow: new THREE.Color(), x: 0, z: 0, sx: 0, sz: 0, px: 0, pz: 0, ox: 0, oz: 0, a: 0, ph: rnd() * TAU, bp: 0, nd: 0, h2: 0, wh: rnd(), sp: rnd(), sc: 0, body: body(AU * US, UR * US + .05, UNIT_FREE, [0]),
        gauge: rig.gauges.map(() => gi++), meters: [gi++, gi++], wheel: rig.wheels.map(() => wi++), rod: rig.rods.map(() => ri++), pip: pi0, pips });
      pi0 += pips;
    });
    // Every machine's televisor is a click target for its screenshots; the engine only takes the click while there are some.
    for (const s of world.sessions) SG.get(s).target = ctx.addTarget?.({ node: s, pos: new THREE.Vector3(0, -50, 0), radius: 1.35, action: 'shots' });
    world.subs.forEach((k, i) => KG.set(k, { i, x: 0, z: 0, ox: 0, oz: 0, th: rnd() * TAU, body: body(AK, .24 * KS, ALL8, [0]) }));
    const BODIES = [B_YOU, ...[...PG.values(), ...SG.values(), ...KG.values()].map(g => g.body)];
    // Nameplates are obstacles for the pipes too: [x0, x1, z0, z1] on the floor, refreshed with the layout.
    const PLATES_AT = [];

    // ── Plumbing. Each pipe is routed on the floor between two octagonal bodies: out of a face, straight runs joined by short-radius
    // 45° or 90° elbows, into a face of the other. All pipes share one mesh; aPipe/aT let the shader light pulses per pipe. ──
    const facesToward = (B, ang) => {
      const free = B.free.filter(k => B.used[k] < B.slots.length), list = free.length ? free : B.free;
      return list.map(k => [k, Math.abs(Math.atan2(Math.sin(k * PI / 4 - ang), Math.cos(k * PI / 4 - ang)))]).sort((a, b) => a[1] - b[1]).slice(0, 3).map(a => a[0]);
    };
    const portOf = (B, k) => { const [dx, dz] = FD[k], o = B.slots[Math.min(B.used[k], B.slots.length - 1)]; return { x: B.x + dx * B.ap - dz * o, z: B.z + dz * B.ap + dx * o, dx, dz }; };
    function blocked(pts, A, B, r) {
      for (const b of BODIES) {
        if (!b.on) continue;
        const lim = b === A || b === B ? b.ap - .02 : b.cr + r + .05;
        if (Math.abs(b.x - (pts[0][0] + pts.at(-1)[0]) / 2) > 30) continue;
        for (let i = 1; i < pts.length; i++) if (segDist(b.x, b.z, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) < lim) return true;
      }
      for (const [x0, x1, z0, z1] of PLATES_AT) for (let i = 1; i < pts.length; i++) if (segRect(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], x0 - r, x1 + r, z0 - r, z1 + r)) return true;
      return false;
    }
    // Candidates: straight, one elbow, or two elbows through a middle direction u (three ways to split the slack). Best clear one wins.
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
      let best = cands.find(c => !blocked(c.pts, A, B, r)) || cands[0];
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
    pipeMat.customProgramCacheKey = () => 'sp-pipes';
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
      place(cyl(1.35, 1, .6, 20), 1.62, PY, 0, 0, 0, HP)]), brassMat, NPIPE * 2, { fixed: true });
    const flangeM = inst(merge([place(cyl(1.75, 1.75, .45, 24), 0, PY, 0, 0, 0, HP), ...boltRing(6, 1.45, .14, .8, 0)]), brassMat, 4 * (NP + NS), { fixed: true });
    const bracketM = inst(merge([place(box(.7, .2, 3.2), 0, .1, 0), place(box(.45, 1.15, .26), 0, .67, 1.12), place(box(.45, 1.15, .26), 0, .67, -1.12),
      place(torus(1.12, .13, 6, 16, PI), 0, PY, 0, 0, HP, 0), place(cyl(.17, .17, .16, 6), 0, .26, 1.45), place(cyl(.17, .17, .16, 6), 0, .26, -1.45)]), blackMat, 8 * NP + 3 * NS, { fixed: true });
    const valveM = inst(merge([place(ball(1.45, 16, 10), 0, PY, 0, 0, 0, 0, 1.1, 1, 1), place(cyl(1.25, 1.25, .4, 16), 1.7, PY, 0, 0, 0, HP), place(cyl(1.25, 1.25, .4, 16), -1.7, PY, 0, 0, 0, HP),
      place(cyl(.95, 1.05, 1.1, 14), 0, PY + 1.5, 0), place(cyl(.22, .22, 1.8, 8), 0, PY + 2.6, 0)]), brassMat, NP, { fixed: true });
    const handM = inst(merge([place(torus(1.1, .16, 6, 28), 0, 0, 0, HP), bar(-1.1, 0, 1.1, 0, .18, .18), bar(0, -1.1, 0, 1.1, .18, .18), cyl(.3, .3, .3, 10)]), mat({ color: '#9a2a1c', metalness: .6, roughness: .35 }), NP);
    const reliefM = inst(merge([place(cyl(1.3, 1.3, 2.6, 16), 0, PY, 0, 0, 0, HP), place(cyl(1, 1, 1.4, 14), 0, PY + 1.2, 0), place(cyl(1.5, 1.5, .3, 16), 0, PY + 1.95, 0),
      place(cyl(.75, 1, 1.2, 14), 0, PY + 2.7, 0), place(hemi(.75, 14, 6), 0, PY + 3.3, 0), place(box(2.6, .22, .3), .9, PY + 3, 0), place(ball(.42, 10, 8), 2.1, PY + 2.85, 0)]), brassMat, NP, { fixed: true });
    const RELIEF_TOP = PY + 3.7, WHEEL_Y = PY + 3.4;

    const mkPipe = (idx, tier, A, B, o) => ({ idx, tier, r: TIER_R[tier], A, B, on: tier === 1, pulses: new kit.Pulses(), gold: new kit.Pulses(), path: null, speed: 1, needT: 0, flash: 0, hw: 0, vent: 0, ...o });
    const pipes = [];
    world.projects.forEach((p, i) => pipes.push(mkPipe(i, 1, PG.get(p).body, B_YOU, { p, g: PG.get(p) })));
    world.sessions.forEach((s, i) => pipes.push(mkPipe(NP + i, 2, SG.get(s).body, PG.get(s.parent).body, { s, next: pipes[world.projects.indexOf(s.parent)] })));
    world.subs.forEach((k, i) => pipes.push(mkPipe(NP + NS + i, 3, KG.get(k).body, SG.get(k.parent).body, { k, next: pipes[NP + world.sessions.indexOf(k.parent)] })));
    function placeFittings(list) {
      let np = 0, nf = 0, nb = 0;
      for (const pp of list) {
        const P = pp.path, r = pp.r;
        setT(portM, np++, P.S.x, 0, P.S.z, -Math.atan2(P.S.dz, P.S.dx), r);
        setT(portM, np++, P.E.x, 0, P.E.z, -Math.atan2(P.E.dz, P.E.dx), r);
        if (pp.tier < 3) for (const e of P.elbows) if (nf < flangeM.count) setT(flangeM, nf++, e.x, 0, e.z, -Math.atan2(e.tz, e.tx), r);
        let avoid = [];
        if (pp.tier === 1) {
          const rn = P.runs.reduce((a, b) => (b.s1 - b.s0 > a.s1 - a.s0 ? b : a)), L = rn.s1 - rn.s0, ry = -Math.atan2(rn.dz, rn.dx);
          const at = f => ({ x: rn.x0 + (rn.x1 - rn.x0) * f, z: rn.z0 + (rn.z1 - rn.z0) * f, s: rn.s0 + L * f, ry });
          pp.valve = at(.7); pp.relief = at(.32);
          setT(valveM, pp.idx, pp.valve.x, 0, pp.valve.z, ry, r); setT(reliefM, pp.idx, pp.relief.x, 0, pp.relief.z, ry, r);
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
      for (const m of still) m.instanceMatrix.needsUpdate = true;
    }
    function rebuildPipes() {
      for (const b of BODIES) b.used.fill(0);
      const list = [];
      for (const pp of pipes) {
        if (!pp.on) { pp.path = null; continue; }
        pp.path = makePath(route(pp.A, pp.B, pp.r), pp.r); pp.speed = (pp.tier === 1 ? 5 : 3.5) / pp.path.len; list.push(pp);
      }
      buildPipeMesh(list); placeFittings(list);
    }
    const sigNow = new Float32Array(2 * NP + 3 * NS + 3 * NK), sigBuilt = new Float32Array(sigNow.length).fill(NaN);

    // ── The floor: plain and dark, fading out past the plant, taking the shadows ──
    const floor = (() => {
      const g = new THREE.CircleGeometry(1, 64).rotateX(-HP), p = g.attributes.position, col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { const d = Math.hypot(p.getX(i), p.getZ(i)), f = clamp(1 - d, 0, 1) ** 1.6; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = f; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#1a140f', vertexColors: true }));
      m.receiveShadow = true; root.add(m); return m;
    })();

    // ── Layout. A junction per project off You, its machines fanned on the outer side, valves beside their machine. Every piece is a
    // rectangle on the floor (machine, its stack's reach and its nameplate; junction and plate; You with board and boiler), and the
    // fans and the ring are pushed out until no two overlap. Angles and distances carry a little of each id, so no two plants match. ──
    const hash = (seed, k) => kit.rng((seed + Math.imul(k, 0x9e3779b1)) >>> 0)();
    const RS = [-PLATE.session.w / 2 - .15, PLATE.session.w / 2 + .15, -3, PLATE.session.z + .2], RTV = [RS[0], TV.x + TV.half + .15, RS[2], RS[3]], RJ = [-PLATE.project.w / 2 - .1, PLATE.project.w / 2 + .1, -1.55, PLATE.project.z + .2], RY = [-BR - .25, BR + .25, -BR - .9, PLATE.you.z + .25];
    const SUBROW = [-1.75, -.95, -2.55, -3.35];
    // Sessions laid out with room for a televisor: those with screenshots. When that changes the plant is laid out again.
    const hasTV = new Set(world.sessions.filter(s => ctx.shot?.(s)));
    function layout() {
      // Stretch the ring to the screen's shape (the floor's depth shows foreshortened); the fans keep their own shape.
      const k = Math.sqrt(ctx.size.w / Math.max(1, ctx.size.h) / .88 / 1.3), sx = clamp(k, .6, 1.25), sz = clamp(1 / k, .85, 1.7);
      const cl = world.projects.map(p => {
        const n = p.sessions.length, step = n < 2 ? 0 : Math.min(.85, 3.6 / (n - 1));
        return { p, n, step, R: BR + JR + 1.2, fr: Math.max(JR + 3.4, step ? 5.1 / step : 0), spin: (hash(p.seed, 2) - .5) * .35, rects: [] };
      });
      const rect = (c, x, z, r, own, s) => c.rects.push({ c, own, s, x, z, x0: x + r[0], x1: x + r[1], z0: z + r[2], z1: z + r[3] });
      const hit = (a, b) => a.x0 < b.x1 + .15 && b.x0 < a.x1 + .15 && a.z0 < b.z1 + .15 && b.z0 < a.z1 + .15;
      const you = { x0: RY[0], x1: RY[1], z0: RY[2], z1: RY[3] };
      for (let it = 0; it < 160; it++) {
        for (const c of cl) {
          const jx = Math.cos(c.p.angle) * c.R * sx, jz = Math.sin(c.p.angle) * c.R * sz, base = Math.atan2(jz, jx) + c.spin;
          c.x = jx; c.z = jz; c.rects.length = 0; rect(c, jx, jz, RJ, true);
          c.p.sessions.forEach((s, i) => {
            const a = base + (i - (c.n - 1) / 2 + (hash(s.seed, 1) - .5) * .2) * (c.step || .6), d = c.fr + (hash(s.seed, 2) - .5) * .8, g = SG.get(s);
            g.a = a; g.ox = Math.cos(a) * d; g.oz = Math.sin(a) * d; rect(c, jx + g.ox, jz + g.oz, hasTV.has(s) ? RTV : RS, false, s);
          });
        }
        const grow = new Set(), fan = new Set();
        for (const c of cl) for (const a of c.rects) if (hit(a, you)) grow.add(c);
        const all = cl.flatMap(c => c.rects);
        for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
          const a = all[i], b = all[j];
          if (!hit(a, b)) continue;
          if (a.c === b.c) fan.add(a.c); else { grow.add(a.c); grow.add(b.c); }
        }
        if (!grow.size && !fan.size) break;
        for (const c of grow) c.R *= 1.035;
        for (const c of fan) c.fr *= 1.05;
      }
      const pos = new Map(cl.map(c => [c.p, [c.x, c.z]]));
      for (const k of world.subs) {
        const i = k.parent.subs.indexOf(k), g = KG.get(k);
        g.ox = -2.1 + (i >> 2) * .9; g.oz = SUBROW[i % 4];
      }
      ctx.setLayout(n => {
        if (n.kind === 'you') n.rest.set(0, 0, 0);
        else if (n.kind === 'project') { const [x, z] = pos.get(n); n.rest.set(x, 0, z); }
        else { const g = n.kind === 'session' ? SG.get(n) : KG.get(n); n.offset.set(g.ox, 0, g.oz); }
      });
      PLATES_AT.length = 0;
      let x0 = -BR, x1 = BR, z0 = -BR, z1 = BR;
      for (const c of cl) for (const r of c.rects) { x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1); z0 = Math.min(z0, r.z0); z1 = Math.max(z1, r.z1); const P = r.own ? PLATE.project : PLATE.session; PLATES_AT.push([r.x - P.w / 2, r.x + P.w / 2, r.z + P.z - P.h * .88, r.z + P.z]); if (hasTV.has(r.s)) PLATES_AT.push([r.x + TV.x - TV.half, r.x + TV.x + TV.half, r.z + TV.z - TV.sh / 2 - .7, r.z + TV.z + TV.sh / 2 + .2]); }
      PLATES_AT.push([-PLATE.you.w / 2, PLATE.you.w / 2, PLATE.you.z - PLATE.you.h * .88, PLATE.you.z]);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ext = Math.max(x1 - x0, z1 - z0) / 2;
      floor.position.set(cx, 0, cz); floor.scale.setScalar(ext * 1.9 + 12);
      const L = ext * 1.25 + 5, cam = key.shadow.camera;
      cam.left = cam.bottom = -L; cam.right = cam.top = L; cam.near = 1; cam.far = 160; cam.updateProjectionMatrix();
      key.target.position.set(cx, -1, cz); key.position.set(-14, 30, 18).normalize().multiplyScalar(70).add(key.target.position);
      sigBuilt.fill(NaN);
    }
    layout();
    ctx.onResize(layout);

    // ── Labels: the nameplates carry them. HTML labels (brass tags, see css) come back when the plates get too small to read. ──
    let platePx = 99;
    ctx.setLabelRule(n => n.kind === 'sub' || platePx < 10.5 ? undefined : false);
    ctx.setLabelAnchor((n, out) => {
      if (n.kind === 'you') return out.set(0, .3, PLATE.you.z - .5);
      if (n.kind === 'project') { const g = PG.get(n); return out.set(g.x, .3, g.z + PLATE.project.z - .35); }
      if (n.kind === 'session') { const g = SG.get(n); return out.set(g.sx, .3, g.sz + PLATE.session.z - .6); }
      const g = KG.get(n); return out.set(g.x, .4, g.z + .4);
    });

    // ── Nameplates ──
    const plateGeo = Object.fromEntries(Object.entries(PLATE).map(([k, P]) => [k, new THREE.PlaneGeometry(P.w, P.h)]));
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const plates = [];
    function makePlate(kind, node, seed) {
      const P = PLATE[kind], cv = document.createElement('canvas'); cv.width = P.cw; cv.height = P.ch;
      const t = tex(new THREE.CanvasTexture(cv)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
      const m = new THREE.Mesh(plateGeo[kind], mat({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: .12, metalness: .4, roughness: .5, envMapIntensity: .4 }));
      m.rotation.x = LEAN; m.castShadow = true; m.visible = false; root.add(m);
      const pl = { kind, node, seed, P, g: cv.getContext('2d'), tex: t, mesh: m, key: null, i: plates.length };
      plates.push(pl); return pl;
    }
    const youPlate = makePlate('you', world.you, 1);
    for (const p of world.projects) PG.get(p).plate = makePlate('project', p, p.seed);
    for (const s of world.sessions) SG.get(s).plate = makePlate('session', s, s.seed);
    const tone = n => n.status === 'permission' || n.status === 'question' ? 'need' : n.status === 'error' ? 'error' : n.status === 'offline' ? 'off' : ['working', 'thinking', 'compacting'].includes(n.status) ? 'work' : 'idle';
    const lineOf = n => tone(n) === 'need' ? `${n.text} · ${kit.fmtWait(n.waitSec)}` : n.text;
    let fontsReady = false, disposed = false;
    if (document.fonts) Promise.all([`500 20px Spectral`, `700 20px Cinzel`, `400 20px "Courier Prime"`].map(f => document.fonts.load(f))).then(() => { if (!disposed) { fontsReady = true; for (const pl of plates) pl.key = null; board.sig = ''; usageRef = null; } }, () => {});
    // Place a plate with its bottom edge at (x, z) on the floor, grown by s; paint it if its text changed (a few a frame).
    let painted = 0;
    function showPlate(pl, x, z, s, text, line, tn, hl) {
      const { P, mesh } = pl, h = P.h * s, k = `${text}|${line}|${tn}`;
      if (pl.key !== k && painted < 6) { painted++; pl.key = k; paintPlate(pl.g, pl.kind, P.cw, P.ch, text, line, tn, pl.seed % 97); pl.tex.needsUpdate = true; mesh.visible = true; }
      const cy = .1 * s + h * .5 * Math.cos(LEAN), cz = z - h * .5 * Math.sin(-LEAN);
      mesh.position.set(x, cy, cz); mesh.scale.setScalar(Math.max(1e-4, s)); mesh.material.emissiveIntensity = .12 + .3 * hl;
      setR(frames, pl.i, x, cy + .035 * s * Math.sin(LEAN), cz - .035 * s * Math.cos(LEAN), LEAN, 0, 0, (P.w + .1) * s, (P.h + .1) * s, .05 * s);
      for (const j of [0, 1]) setT(posts, pl.i * 2 + j, x + (j ? 1 : -1) * P.w * .36 * s, cy * .5, cz - .06, 0, s, cy, s);
    }
    function hidePlate(pl) { pl.mesh.visible = false; hide(frames, pl.i); hide(posts, pl.i * 2); hide(posts, pl.i * 2 + 1); }

    // ── The gauge board in front of the boiler: one dial per usage window, rebuilt when the accounts change, repainted when a reading does ──
    const ZB = 2.75, board = { group: new THREE.Group(), key: null, sig: '', lay: null, tex: null, face: null, needles: null, lamps: null, cv: null, val: [] };
    board.group.rotation.x = LEAN; root.add(board.group);
    const boardNeedleGeo = needleGeo.clone().rotateX(HP), boardFrame = mat({ color: '#2c2723', metalness: .7, roughness: .5 });
    function clearBoard() { for (const o of [...board.group.children]) { board.group.remove(o); if (o.isInstancedMesh) o.dispose(); if (o.geometry !== boardNeedleGeo && o.geometry !== lamps.geometry) o.geometry.dispose(); if (o.material !== blackMat && o.material !== lampMat && o.material !== boardFrame && o.material !== brassMat) o.material.dispose(); } board.tex?.dispose(); board.tex = null; }
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
      frame.castShadow = frame.receiveShadow = true;
      const bezel = new THREE.Mesh(merge(lay.cells.filter(c => c.kind === 'win' || c.limit).map(c => place(torus(c.r + .015, .03, 6, 36), c.x, c.y, .015))), brassMat);
      bezel.castShadow = true;
      board.needles = new THREE.InstancedMesh(boardNeedleGeo, blackMat, lay.cells.length); board.needles.castShadow = true;
      board.lamps = new THREE.InstancedMesh(lamps.geometry, lampMat, lay.cells.length);
      lay.cells.forEach((c, i) => { board.lamps.setColorAt(i, new THREE.Color(0, 0, 0)); O.position.set(c.x + c.r * .84, c.y + c.r * .84, .04); O.rotation.set(0, 0, 0); O.scale.setScalar(.055); O.updateMatrix(); board.lamps.setMatrixAt(i, O.matrix); });
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
    let pHead = 0;
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
      dials.setColorAt(k, tint);
    }
    const tint4 = (q, hl, fire) => { tc.setRGB(1, 1, 1).lerp(OFF_TINT, q.off ?? 0).lerp(ERR_TINT, q.error ?? 0).multiplyScalar(1 + .22 * hl); return V4.set(tc.r, tc.g, tc.b, fire); };

    let warm = 0, yp = 0, yWhistle = 0, first = true;

    return {
      update(dt, time) {
        const reduced = ctx.reduced; dt = Math.min(dt, .1); painted = 0;
        const snap = first || reduced, pulse = reduced ? 1 : .72 + .28 * Math.sin(time * 5.5);
        tvU.uTvT.value = time; tvU.uRoll.value = reduced ? 0 : 1;
        if (world.usage !== usageRef) { usageRef = world.usage; syncBoard(); }
        platePx = PLATE.session.h * .41 * ctx.size.h / (2 * Math.tan(camera.fov * PI / 360) * camera.position.y / Math.cos(.5));
        // Junctions: the governor spins with their machines' work; the gauge reads pressure, pinned in the red when a session needs you.
        let activity = 0;
        for (const p of world.projects) {
          const g = PG.get(p), rig = g.rig, tx = p.drag ? p.pos.x : p.rest.x, tz = p.drag ? p.pos.z : p.rest.z;
          g.x = snap || !g.init ? tx : kit.damp(g.x, tx, 8, dt); g.z = snap || !g.init ? tz : kit.damp(g.z, tz, 8, dt); g.init = true;
          g.body.x = g.x; g.body.z = g.z;
          let work = 0, heat = 0, need = 0, err = 0, think = 0, urg = 0;
          for (const s of p.sessions) { if (s.s.alive < .05) continue; work += s.s.work; heat = Math.max(heat, s.s.heat); need = Math.max(need, s.s.need); err = Math.max(err, s.s.error); think = Math.max(think, s.s.think + s.s.compact); if (s.s.need > .3) urg = Math.max(urg, s.s.urgency || 0); }
          Object.assign(g, { work, heat, need, err, urg }); activity += work;
          const goal = work > .05 ? .25 + .2 * Math.min(3, work) + .25 * heat : 0;
          g.w = reduced ? 0 : kit.damp(g.w, goal, 2, dt); g.gv += reduced ? 0 : (g.w * 1.6 + .02) * TAU * dt;
          const hl = Math.max(p.s.hover, p.s.select), X = g.x, Z = g.z;
          M4.makeTranslation(X, 0, Z); batch.setMatrixAt(g.bid, M4); batch.setColorAt(g.bid, V4.set(1 + .2 * hl, 1 + .2 * hl, 1 + .2 * hl, 0));
          const G = rig.governor, sp = clamp(g.w * 1.4, 0, 1);
          setT(govs, g.i, X + G.x, G.y, Z + G.z, g.gv, .85 + .2 * sp, .85 - .1 * sp, .85 + .2 * sp);
          if (!reduced && work > .05 && rnd() < dt * (.4 + .6 * work)) steam(X + G.x, G.y + .5, Z + G.z, .3, .3);
          const pr = need > .3 ? .86 + .12 * urg : err > .3 ? .99 : .08 + .17 * Math.min(3, work) + .08 * heat + .12 * think;
          g.pr = snap ? pr : kit.damp(g.pr, pr, 3, dt);
          gauge(g.gauge, rig.gauges[0], X, Z, 1, g.pr, tc.copy(DIAL).lerp(DIAL_NEED, need * (.55 + .45 * pulse)).lerp(DIAL_ERR, err * (need > .3 ? 0 : 1)));
          tc2.copy(need > .3 ? LC.need : err > .3 ? LC.error : work > .3 ? LC.work : think > .3 ? LC.think : LC.idle);
          if (need > .3 || err > .3) tc2.multiplyScalar(pulse);
          g.col.lerp(tc2, snap ? 1 : 1 - Math.exp(-dt * 6));
          const jq = Object.assign(g.q, { work: Math.min(1, work), think: Math.min(1, think), compact: 0, need, wait: 0, error: err, off: 0, heat });
          jq.idle = Math.max(0, 1 - jq.work - jq.think - need - err);
          glow(g.glow, jq, time, g.i * 1.7, reduced, urg);
          rig.tubes.forEach(([x, y, z], j) => tube(T_J + 2 * g.i + j, X + x, y, Z + z, .12, j ? .5 : .68, g.glow));
          const live = p.sessions.slice(0, 6);
          live.forEach((s2, j) => { const k = L_JB + g.jb + j; setT(lamps, k, X + (j - (live.length - 1) / 2) * .14, .23, Z + .8, 0, .038 * s2.s.alive); lamps.setColorAt(k, bulb(s2.s, tc, pulse)); });
          setT(pools, POOL_P + g.i, X, .02, Z, 0, 4); pools.setColorAt(POOL_P + g.i, tc.copy(g.glow).multiplyScalar(.012).add(tc2.copy(YOU_GOLD).multiplyScalar(.02)));
          showPlate(g.plate, X, Z + PLATE.project.z, 1, p.name, '', '', hl);
        }
        // Machines: the node is the station; the machine stands MZ behind it, the nameplate in front.
        let relay = false;
        for (const s of world.sessions) {
          const g = SG.get(s), q = s.s, pg = PG.get(s.parent), rig = g.rig;
          const mx = pg.x + g.ox, mz = pg.z + g.oz;
          g.px = kit.damp(g.px, s.drag ? s.pos.x - mx : 0, 8, dt); g.pz = kit.damp(g.pz, s.drag ? s.pos.z - mz : 0, 8, dt);
          if (Math.abs(g.px) + Math.abs(g.pz) < .003) g.px = g.pz = 0;
          const grow = q.alive < .005 ? 0 : kit.easeOutCubic(q.alive), sc = grow * US, urg = q.need > .3 ? (q.urgency || 0) : 0, hl = Math.max(q.hover, q.select);
          const SX = mx + g.px, SZ = mz + g.pz, X = SX, Z = SZ + MZ * grow;
          g.sx = SX; g.sz = SZ; g.x = X; g.z = Z; g.sc = grow; g.body.x = X; g.body.z = Z; g.body.on = q.alive > .1;
          const W = (lx, ly, lz) => tA.set(X + lx * sc, ly * sc, Z + lz * sc);
          if (!reduced) { g.ph += dt * TAU * ((1.3 + 1.5 * Math.min(1, q.heat)) * q.work + .25 * q.think); g.bp += dt * TAU * 1.1 * q.compact; }
          M4.compose(V.set(X, 0, Z), Q.identity(), S3.setScalar(Math.max(1e-4, sc))); batch.setMatrixAt(g.bid, M4); batch.setVisibleAt(g.bid, sc > .001);
          const flick = reduced ? 1 : 1 + .1 * Math.sin(time * 14 + g.i * 1.7) + .06 * Math.sin(time * 31 + g.i);
          const fire = (.06 + .9 * q.work + .45 * q.think + .4 * q.compact + .55 * q.need * pulse + .2 * q.wait + 1.3 * q.error) * (1 - q.off) * flick;
          batch.setColorAt(g.bid, tint4(q, hl, fire));
          // Gauge: working pressure, swinging while thinking, low when idle, deep in the red when it needs you, pinned on error. The second one is heat.
          const swing = reduced ? .5 : .5 + .5 * Math.sin(time * 2.4 + g.i * 1.3);
          let nd = q.work * (.5 + .12 * Math.min(1, q.heat)) + q.think * (.22 + .4 * swing) + q.compact * .38 + q.wait * .2 + q.idle * .06 + q.need * (.86 + .12 * urg) + q.error * .99;
          if (!reduced && q.error > .5) nd += ((Math.floor(time * 12) * 7 + g.i * 3) % 5 - 2) * .01;
          g.nd = snap ? nd : kit.damp(g.nd, nd, 5, dt);
          g.h2 = snap ? q.heat : kit.damp(g.h2, .15 + .55 * q.heat + .25 * q.work, 3, dt);
          const dialTint = tc2.copy(DIAL).lerp(DIAL_IDLE, clamp(q.idle * .8 + q.wait * .3, 0, 1)).lerp(DIAL_OFF, q.off).lerp(DIAL_NEED, q.need * (.55 + .45 * pulse)).lerp(DIAL_ERR, q.error);
          rig.gauges.forEach((c, j) => gauge(g.gauge[j], c, X, Z, sc, j ? g.h2 : g.nd, dialTint));
          rig.rods.forEach((rd, j) => { const o = rd.stroke * Math.sin(g.ph + rd.ph); if (rd.axis) setR(rods, g.rod[j], X + (rd.x + o) * sc, rd.y * sc, Z + rd.z * sc, 0, 0, -HP, rd.r * sc, rd.len * sc, rd.r * sc); else setT(rods, g.rod[j], X + rd.x * sc, (rd.y + o) * sc, Z + rd.z * sc, 0, rd.r * sc, rd.len * sc, rd.r * sc); });
          rig.wheels.forEach((w, j) => { setR(wheels, g.wheel[j], X + w.x * sc, w.y * sc, Z + w.z * sc, 0, 0, -g.ph * .8, w.r * sc); wheels.setColorAt(g.wheel[j], tc.set('#4a3a2c').multiplyScalar(1 + .3 * hl)); });
          glow(g.glow, q, time, g.i * 2.3, reduced, urg);
          W(...rig.lamp); tube(2 * g.i, tA.x, tA.y, tA.z, .11 * sc, .56 * sc, g.glow);
          W(...TUBE2); tube(2 * g.i + 1, tA.x, tA.y, tA.z, .085 * sc, .4 * sc, tc.copy(g.glow).multiplyScalar(.4 + 1.2 * q.heat));
          W(...rig.mode); setT(lamps, g.i, tA.x, tA.y + .045 * sc, tA.z, 0, .045 * sc);
          lamps.setColorAt(g.i, s.mode === 'plan' ? LC.wait : s.mode === 'bypass' ? LC.error : MODE_OFF);
          if (g.pips) {
            const lit = Math.round((s.plan?.done || 0) / Math.max(1, s.plan?.total || 1) * g.pips);
            for (let j = 0; j < g.pips; j++) {
              const f = (j + .5) / g.pips; W(PLAN.x0 + (PLAN.x1 - PLAN.x0) * f, PLAN.y, PLAN.z0 + (PLAN.z1 - PLAN.z0) * f);
              setT(lamps, L_PIP + g.pip + j, tA.x, tA.y, tA.z, 0, .03 * sc);
              lamps.setColorAt(L_PIP + g.pip + j, j < lit ? PIP_ON : j === lit && q.work > .5 ? tc.copy(PIP_ON).multiplyScalar(reduced ? .3 : .15 + .25 * (.5 + .5 * Math.sin(time * 4))) : PIP_OFF);
            }
          }
          const cx = clamp(q.ctx ?? s.ctx ?? 0, 0, 1);
          setT(fills, g.i, X + SIGHT.x * sc, SIGHT.y * sc, Z + SIGHT.z * sc, 0, SIGHT.len * Math.max(.02, cx) * sc, sc, sc);
          fills.setColorAt(g.i, cx > .8 ? FILL_HI : tc.copy(FILL_LO).lerp(FILL_MID, clamp((cx - .5) / .3, 0, 1)).multiplyScalar(1 - .6 * q.off));
          setT(bellows, g.i, X + BELLOWS[0] * sc, (Y0 + .03) * sc, Z + BELLOWS[1] * sc, 0, .8 * sc, .8 * sc * (1 - .5 * q.compact * (.5 - .5 * Math.cos(g.bp))), .8 * sc);
          tc.copy(g.glow).multiplyScalar(.012).add(tc2.copy(POOL_NEED).multiplyScalar(q.need * (.6 + .3 * urg) * pulse)).add(tc2.copy(POOL_ERR).multiplyScalar(q.error * .8)).add(tc2.copy(POOL_WORK).multiplyScalar(q.work * .1)).add(tc2.copy(YOU_GOLD).multiplyScalar(.03 * (1 - q.off)));
          setT(pools, POOL_S + g.i, X, .025, Z + .6 * grow, 0, 4.4 * grow); pools.setColorAt(POOL_S + g.i, tc);
          if (grow > .01) showPlate(g.plate, SX, SZ + PLATE.session.z * grow, grow, s.name, lineOf(s), tone(s), hl); else hidePlate(g.plate);
          const shot = ctx.shot?.(s);
          if (!!shot !== hasTV.has(s)) { if (shot) hasTV.add(s); else hasTV.delete(s); relay = true; }
          if (shot && grow > .01) {
            g.tv ||= makeTV();
            if (g.tv.shot !== shot) { g.tv.shot = shot; paintTV(g.tv.g, TV.cw, TV.ch, shot.bitmap, shot.count || 1); g.tv.tex.needsUpdate = true; }
            const bx = SX + TV.x * grow, bz = SZ + TV.z * grow;
            setT(tvWood, g.i, bx, 0, bz, 0, grow); setT(tvBrass, g.i, bx, 0, bz, 0, grow); setT(tvWire, g.i, bx, 0, bz, 0, grow);
            g.tv.mesh.visible = true; g.tv.mesh.position.set(bx, .125 * grow, bz); g.tv.mesh.scale.setScalar(grow);
            g.tv.mesh.material.emissiveIntensity = .85 + .25 * hl; g.target?.pos.set(bx, .2, bz);
            TV_TUBES.forEach(([x, r, h], j) => tube(T_TV + 4 * g.i + j, bx + x * grow, CY * grow, bz + CZ * grow, r * grow, h * grow, j % 3 ? tc.copy(g.glow).multiplyScalar(.6) : g.glow));
            TV_METERS.forEach(([x, y, z], j) => gauge(g.meters[j], { x, y, z, r: .1, t: .55 }, bx, bz, grow, j ? g.h2 : cx, METER));
            for (let j = 0; j < 5; j++) {
              const k = L_TVB + 5 * g.i + j, on = reduced ? q.work : q.work * (Math.sin(time * (3 + j) + g.i + j * 2) > -.2 ? 1 : .2);
              setT(lamps, k, bx + (j - 2) * .2 * grow, (CY + .035) * grow, bz + (CZ - .17) * grow, 0, .035 * grow); lamps.setColorAt(k, tc.copy(AMB).multiplyScalar(.08 + .7 * on + .5 * q.need * pulse));
            }
          } else {
            hide(tvWood, g.i); hide(tvBrass, g.i); hide(tvWire, g.i); if (g.tv) g.tv.mesh.visible = false; g.target?.pos.set(0, -50, 0);
            for (let j = 0; j < 4; j++) hideTube(T_TV + 4 * g.i + j);
            for (const k of g.meters) { hide(dials, k); hide(needles, k); }
            for (let j = 0; j < 5; j++) hide(lamps, L_TVB + 5 * g.i + j);
          }
          if (!reduced && q.alive > .5) {
            if (q.need > .5 && (g.wh -= dt) < 0) { g.wh = 1.5 - urg + rnd() * .3; const [wx, wy, wz] = rig.whistle; for (let k = 0; k < 4 + 4 * urg; k++) jet(X + wx * US, wy * US, Z + wz * US, .55 + .25 * urg); }
            if (q.error > .5 && (g.sp -= dt) < 0) { g.sp = 1.1 + rnd() * .7; burst(X, .7, Z, 5, .7, STEAM, .75); for (let k = 0; k < 4; k++) spark(X, .6, Z); if (rnd() < .5) steam(X, .7, Z, .7, .5, SOOT); }
            if (q.compact > .5 && rnd() < dt * 2.5) steam(X + BELLOWS[0] * US, .42, Z + BELLOWS[1] * US, .4, .4);
            if (q.work > .5 && rnd() < dt * 1.4) { const [ex, ey, ez] = rig.exhaust || rig.lamp; steam(X + ex * US, ey * US, Z + ez * US, .32, .35); }
            if (rig.smoke && rnd() < dt * (.15 + .9 * q.work + .3 * q.think)) steam(X + rig.smoke[0] * US, rig.smoke[1] * US, Z + rig.smoke[2] * US, .32, .3, SOOT);
          }
        }
        if (relay) layout();
        // Subagent valves, beside their machine.
        for (const k of world.subs) {
          const g = KG.get(k), sg = SG.get(k.parent), q = k.s;
          g.x = sg.sx + g.ox * sg.sc; g.z = sg.sz + g.oz * sg.sc; g.body.x = g.x; g.body.z = g.z; g.body.on = q.alive > .1 && sg.body.on;
          if (!reduced) g.th += dt * (2.5 * q.work + .6 * q.think);
          const sc = (q.alive < .005 ? 0 : kit.easeOutCubic(q.alive) * Math.min(1, sg.sc)) * KS;
          setT(kBody, g.i, g.x, 0, g.z, 0, sc); setT(kWheel, g.i, g.x, 0, g.z, g.th, sc);
          kWheel.setColorAt(g.i, tc.copy(KW[k.provider] || KW.claude).lerp(OFF_TINT, q.off).lerp(LC.need, q.need * .25).lerp(LC.error, q.error * .25).multiplyScalar(1 + .4 * Math.max(q.hover, q.select)));
          setT(lamps, L_SUB + g.i, g.x, .37 * sc, g.z, 0, .045 * sc); lamps.setColorAt(L_SUB + g.i, lampColor(q, tc2, pulse));
        }
        // You: the boiler. Pressure, firebox and whistle rise with the queue.
        const queue = world.queue().length; let urg = 0; for (const s of world.sessions) if (s.s.need > .3) urg = Math.max(urg, s.s.urgency || 0);
        warm = snap ? (queue ? 1 : 0) : kit.damp(warm, queue ? 1 : 0, 3, dt);
        const yr = YOU.rig;
        const ypr = queue ? .84 + .04 * Math.min(3, queue) + .1 * urg : .3 + .08 * Math.min(4, activity);
        yp = snap ? ypr : kit.damp(yp, ypr, 3, dt);
        gauge(0, yr.gauge, 0, 0, 1, yp, tc.copy(DIAL).lerp(DIAL_NEED, warm * (.55 + .45 * pulse)));
        const flick = reduced ? 1 : 1 + .06 * Math.sin(time * 13) + .04 * Math.sin(time * 31.7);
        batch.setMatrixAt(youId, M4.identity()); batch.setColorAt(youId, V4.set(1, 1, 1, (.35 + .12 * Math.min(4, activity) + .8 * warm * pulse) * flick));
        if (!reduced) {
          if (queue && (yWhistle -= dt) < 0) { yWhistle = 2.2 - 1.3 * urg; for (let k = 0; k < 5 + 5 * urg; k++) jet(...yr.whistle, .8 + .3 * urg); }
          if (rnd() < dt * (.8 + .5 * Math.min(4, activity))) steam(...yr.smoke, .7, .45, SOOT);
        }
        setT(pools, 0, 0, .02, .4, 0, 13 + 2 * warm); pools.setColorAt(0, tc.copy(YOU_GOLD).multiplyScalar(.035 + .1 * warm * pulse + .02 * Math.min(4, activity)));
        yr.tubes.forEach(([x, y, z], j) => tube(T_Y + j, x, y, z, .14, j % 2 ? .62 : .82,
          tc.copy(FIL).multiplyScalar((.3 + .15 * Math.min(4, activity)) * (reduced ? 1 : 1 + .08 * Math.sin(time * 13 + j * 2))).add(tc2.copy(AMB).multiplyScalar(warm * (reduced ? 1 : .55 + .45 * pulse)))));
        showPlate(youPlate, 0, PLATE.you.z, 1, 'You', queue ? `${queue} waiting` : 'all clear', queue ? 'need' : 'idle', world.you.s.hover);
        // The gauge board's needles and warning lamps.
        if (board.lay) {
          board.lay.cells.forEach((c, i) => {
            board.val[i] = snap ? c.used : kit.damp(board.val[i], c.used, 3, dt);
            const dial = c.kind === 'win' || c.limit;
            O.position.set(c.x, c.y, .025); O.rotation.set(0, 0, gaugeAng(board.val[i])); O.scale.setScalar(dial ? c.r * 1.08 : 1e-4); O.updateMatrix(); board.needles.setMatrixAt(i, O.matrix);
            board.lamps.setColorAt(i, !dial ? MODE_OFF : c.used >= .9 ? tc.copy(WARN_RED).multiplyScalar(pulse) : c.used >= .75 ? WARN_AMBER : MODE_OFF);
          });
          board.needles.instanceMatrix.needsUpdate = true; board.lamps.instanceColor.needsUpdate = true;
        }
        // Pipes: re-route when anything moved or a machine came or went.
        let si = 0;
        for (const p of world.projects) { const g = PG.get(p); sigNow[si++] = g.x; sigNow[si++] = g.z; }
        for (const pp of pipes) if (pp.tier > 1) { pp.on = pp.A.on; sigNow[si++] = pp.on ? 1 : 0; sigNow[si++] = pp.A.x; sigNow[si++] = pp.A.z; }
        let moved = false; for (let k = 0; k < si; k++) if (!(Math.abs(sigNow[k] - sigBuilt[k]) < .004)) { moved = true; break; }
        if (moved) { rebuildPipes(); sigBuilt.set(sigNow); }
        // Pulses: subagent → machine → junction → boiler. Walk the tiers backwards so a pulse handed on starts next frame's leg at 0.
        for (let pi = pipes.length - 1; pi >= 0; pi--) {
          const pp = pipes[pi], uP = pipeU.uP.value[pp.idx], uG = pipeU.uG.value[pp.idx], uM = pipeU.uM.value[pp.idx];
          if (!pp.path) { pp.pulses.list.length = 0; pp.gold.list.length = 0; uP.set(-1, -1, -1, -1); uG.set(-1, -1, -1, -1); uM.set(0, 0, 1, 0); continue; }
          const q = pp.tier === 1 ? pp.g : (pp.s || pp.k).s, L = pp.path.len;
          if (pp.tier === 2 && !reduced && q.need > .5 && (pp.needT -= dt) <= 0) { pp.gold.add(pp.speed * .8, 1, { prev: 0 }); pp.needT = 2 - (q.urgency || 0); } else if (pp.tier === 2 && q.need <= .5) pp.needT = 0;
          if (reduced) { pp.pulses.list.length = 0; pp.gold.list.length = 0; }
          for (const x of pp.pulses.list) x.data.prev = x.t;
          for (const x of pp.gold.list) x.data.prev = x.t;
          const done = pp.pulses.update(dt); let nd = done.length;
          for (const x of done) crossJoints(pp, x, false);
          for (const x of pp.pulses.list) crossJoints(pp, x, false);
          const gdone = pp.gold.update(dt); const ng = gdone.length;
          for (const x of gdone) crossJoints(pp, x, true);
          for (const x of pp.gold.list) crossJoints(pp, x, true);
          if (pp.next) { for (; nd > 0; nd--) pp.next.pulses.add(pp.next.speed, 1, { prev: 0 }); if (ng) pp.next.gold.add(pp.next.speed * .8, 1, { prev: 0 }); }
          else if (nd || ng) { pp.flash = Math.max(pp.flash, ng ? 1 : .5); const E = pp.path.E; ringPuff(E.x + E.dx * .3, .35, E.z + E.dz * .3, .25, .5, 10, ng ? GOLDSTEAM : STEAM); }
          pp.pulses.vec4(uP); pp.gold.vec4(uG);
          uM.set(q.need * (reduced ? .4 : .06), q.heat * (reduced ? .3 : .05), (pp.tier === 1 ? .35 : pp.tier === 2 ? .22 : .14) / L, 0);
          pp.flash = Math.max(0, pp.flash - dt * 2.5);
          if (pp.tier === 1) {
            const g = pp.g, r = pp.r;
            pp.hw += reduced ? 0 : dt * (g.heat * 3 + g.work * .4);
            if (pp.valve) setT(handM, pp.idx, pp.valve.x, WHEEL_Y * r, pp.valve.z, pp.valve.ry + pp.hw, r);
            // The line's relief valve lifts while a session on it needs you.
            if (pp.relief && !reduced && g.need > .5 && (pp.vent -= dt) < 0) { pp.vent = 1.6 - .8 * g.urg; for (let k = 0; k < 3 + 3 * g.urg; k++) jet(pp.relief.x, RELIEF_TOP * r, pp.relief.z, .5 + .2 * g.urg, GOLDSTEAM); }
            const E = pp.path.E;
            setT(lamps, L_JUN + pp.idx, E.x + E.dx * .08, .5, E.z + E.dz * .08, 0, .09 + .04 * pp.flash);
            tc2.copy(g.col).multiplyScalar(.8 + pp.flash * 1.5); if (g.need > .3) tc2.lerp(LC.need, pp.flash); lamps.setColorAt(L_JUN + pp.idx, tc2);
          }
        }
        for (const m of dyn) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
        // Particles
        smoke.visible = !reduced;
        if (!reduced) {
          const wx = .3 * dt, wz = -.1 * dt;
          for (let i = 0; i < PN; i++) {
            if (pLife[i] <= 0) continue;
            pLife[i] -= dt; if (pLife[i] <= 0) { pSize[i] = 0; pAlpha[i] = 0; continue; }
            const k = 1 - pLife[i] / pMax[i], i3 = i * 3, f = Math.exp(-pDrag[i] * dt);
            pVel[i3] = pVel[i3] * f + wx; pVel[i3 + 1] = pVel[i3 + 1] * f + pRise[i] * dt; pVel[i3 + 2] = pVel[i3 + 2] * f + wz;
            pPos[i3] += pVel[i3] * dt; pPos[i3 + 1] += pVel[i3 + 1] * dt; pPos[i3 + 2] += pVel[i3 + 2] * dt;
            if (pPos[i3 + 1] < .05) { pPos[i3 + 1] = .05; pVel[i3 + 1] = Math.abs(pVel[i3 + 1]) * .3; }
            pSize[i] = pS0[i] + (pS1[i] - pS0[i]) * (1 - (1 - k) * (1 - k));
            pAlpha[i] = pA0[i] * Math.min(1, k * 8) * Math.pow(1 - k, 1.4); pRot[i] += pSpin[i] * dt;
          }
          for (const a of ['position', 'aSize', 'aAlpha', 'aColor', 'aRot']) pGeo.attributes[a].needsUpdate = true;
          pMat.uniforms.uScale.value = ctx.size.h * renderer.getPixelRatio() / (2 * Math.tan(camera.fov * PI / 360));
        }
        first = false;
      },

      event(type, n, data) {
        if (n.kind !== 'session' && n.kind !== 'sub') return;
        const sub = n.kind === 'sub', g = sub ? KG.get(n) : SG.get(n);
        if (!g) return;
        const pp = pipes[sub ? NP + NS + g.i : NP + g.i], x = g.x, z = g.z, w = sub ? [0, .4, 0] : g.rig.whistle.map(v => v * US);
        // Only real work sends steam up the line; idle, waiting and offline machines' pipes stay calm.
        if (type === 'tool') { if (!ctx.reduced && pp.path && ['working', 'thinking', 'compacting'].includes(n.status)) pp.pulses.add(pp.speed, 1, { prev: 0 }); }
        else if (type === 'need') { if (!sub) for (let k = 0; k < 8; k++) jet(x + w[0], w[1], z + w[2], .7); if (!ctx.reduced && pp.path && !sub) { pp.gold.add(pp.speed * .8, 1, { prev: 0 }); pp.needT = 2; } }
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
