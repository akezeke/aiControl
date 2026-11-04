// Renders the Nodes · Steampunk list backdrop, an engine house at night, ray-marched on the CPU like fantasy-bake.mjs.
// Moonlight falls through the leaded side windows in shafts, gas lamps burn on the iron columns, the boiler's furnace glows, the
// engine and its flywheel stand idle under the roof trusses and the travelling crane.
// node scripts/steampunk-art.mjs [scale] [outDir] [webp|png]   (python3 with Pillow encodes the files)
//   → client/public/nodes-steampunk-hall.webp (1920×1080) and nodes-steampunk-hall-portrait.webp (1080×1920)
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const { abs, min, max, sqrt, sin, cos, atan2, floor, round, exp, PI, pow, tan, atan } = Math;
const mix = (a, b, t) => a + (b - a) * t, clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v, sstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = v => v - floor(v), rep = (v, s) => v - s * round(v / s);
// ---- Noise
const PERM = new Uint8Array(512); { let s = 7654321; const p = Array.from({ length: 256 }, (_, i) => i); for (let i = 255; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; }
const h3 = (x, y, z) => PERM[(PERM[(PERM[x & 255] + y) & 255] + z) & 255] / 255;
function noise(x, y, z) { const X = floor(x), Y = floor(y), Z = floor(z), a = x - X, b = y - Y, c = z - Z, u = a * a * (3 - 2 * a), v = b * b * (3 - 2 * b), w = c * c * (3 - 2 * c); return mix(mix(mix(h3(X, Y, Z), h3(X + 1, Y, Z), u), mix(h3(X, Y + 1, Z), h3(X + 1, Y + 1, Z), u), v), mix(mix(h3(X, Y, Z + 1), h3(X + 1, Y, Z + 1), u), mix(h3(X, Y + 1, Z + 1), h3(X + 1, Y + 1, Z + 1), u), v), w); }
function fbm(x, y, z, o = 4) { let s = 0, a = .5, n = 0; for (let i = 0; i < o; i++) { s += a * noise(x, y, z); n += a; a *= .5; x = x * 2.03 + 11.3; y = y * 2.03 + 3.7; z = z * 2.03 + 7.1; } return s / n; }
// ---- Shapes
const box2 = (x, y, a, b) => { const p = abs(x) - a, q = abs(y) - b, P = max(p, 0), Q = max(q, 0); return sqrt(P * P + Q * Q) + min(max(p, q), 0); };
const box = (x, y, z, a, b, c) => { const p = abs(x) - a, q = abs(y) - b, r = abs(z) - c, P = max(p, 0), Q = max(q, 0), R = max(r, 0); return sqrt(P * P + Q * Q + R * R) + min(max(p, q, r), 0); };
const seg2 = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, h = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)), qx = px - ax - dx * h, qy = py - ay - dy * h; return sqrt(qx * qx + qy * qy); };
let SH = 0; // where along the last seg3 the point fell, in units
const seg3 = (px, py, pz, ax, ay, az, bx, by, bz) => { const dx = bx - ax, dy = by - ay, dz = bz - az, l2 = dx * dx + dy * dy + dz * dz, h = clamp(((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2), qx = px - ax - dx * h, qy = py - ay - dy * h, qz = pz - az - dz * h; SH = h * sqrt(l2); return sqrt(qx * qx + qy * qy + qz * qz); };
// A pipe of radius r from a to b with a flange every 2 units.
const pipe = (px, py, pz, ax, ay, az, bx, by, bz, r) => { const d = seg3(px, py, pz, ax, ay, az, bx, by, bz); return min(d - r, max(d - r - .07, abs(rep(SH - 1, 2)) - .045)); };

// ---- The house: x across (walls at ±HW), y up, z down the hall towards the back wall at ZB. Bays every 8 along z.
const HW = 11, EAVES = 12, RIDGE = 17, ZB = -66, ZF = 14, CX = 8.6, SLOPE = (RIDGE - EAVES) / HW, SN = sqrt(1 + SLOPE * SLOPE);
const BRICK = 1, FLOOR = 2, IRON = 3, COPPER = 4, BRASS = 5, RED = 6, GREEN = 7, STONE = 8, WOOD = 9, COAL = 10, LAMP = 11, FURNACE = 12, GAUGE = 13, GLASS = 14, GLASSB = 15, BOILER = 16, SHADE = 17, STEEL = 18, EMBER = 19, LEATHER = 20, BULB = 21;
const winSide = (u, y) => min(box2(u, y - 6.2, 1.35, 2.7), sqrt(u * u + (y - 8.9) ** 2) - 1.35);
const winBack = (x, y) => min(box2(x, y - 6.5, 3.6, 4), sqrt(x * x + (y - 10.5) ** 2) - 3.6);
const PENDANTS = [[3.6, 7.7, -8], [-3.6, 7.85, -8]];
const CRANK = [3.4, 3.2 + .62, -15 + .33];
const GAUGES = [[-5.3, 3.55, -7.9, .3], [5.6, 4.75, 1.47, .3]];

let D = 1e9, M = 0, LIT = false; // LIT: marching a shadow ray, so the lamps' own glass doesn't count
const U = (d, m) => { if (d < D) { D = d; M = m; } };
function map(x, y, z) {
  D = 1e9; M = 0;
  const ax = abs(x), zc = rep(z, 8), zw = rep(z - 4, 8), bays = z > -60 && z < 12;
  // Floor, with the flywheel's pit.
  U(max(y, -box(x - 4.6, y + .35, z + 15, .55, .85, 3.7)), FLOOR);
  // Side walls: brick, arched windows between pilasters, a stone plinth and string course; the gable wall at the back with one great window.
  let wall = HW - ax;
  if (bays) wall = max(wall, -max(winSide(zw, y), ax - HW - 2));
  U(wall, BRICK);
  U(max(HW - .45 - ax, abs(zc) - .65, y - EAVES), BRICK);
  U(max(HW - .3 - ax, abs(y - 11.4) - .22), STONE);
  U(max(HW - .18 - ax, y - .9), STONE);
  if (bays) { U(max(box2(zw, y - 3.42, 1.6, .09), abs(ax - HW - .05) - .32), STONE); U(max(winSide(zw, y), abs(ax - HW - .35) - .03), GLASS); }
  U(max(z - ZB, -max(winBack(x, y), ZB - 2 - z)), BRICK);
  U(max(winBack(x, y), abs(z - ZB + .45) - .03), GLASSB);
  if (z - ZB - .6 < D) U(max(min(box2(abs(x) - 1.25, y - 8.5, .1, 6), box2(x, y - 7.6, 3.6, .1), abs(sqrt(x * x + (y - 10.5) ** 2) - 1.25) - .1), winBack(x, y), abs(z - ZB + .3) - .2), STONE);
  U(ZF - z, BRICK);
  // Roof boards on iron purlins and trusses, one truss per bay.
  const roof = (RIDGE - SLOPE * ax - y) / SN;
  U(roof, WOOD);
  if (roof - .6 < D) for (const P of [1.8, 4.6, 7.4, 10.2]) U(box2(ax - P, y - (RIDGE - SLOPE * P - .3), .1, .2), IRON);
  if (bays && max(abs(zc) - .14, 11.62 - y) < D) {
    let d2 = box2(ax - 5.6, y - 11.82, 5.6, .16);
    d2 = min(d2, seg2(ax, y, HW, EAVES - .1, 0, RIDGE - .45) - .15, box2(ax, y - 14.3, .09, 2.5));
    d2 = min(d2, box2(ax - 3.7, y - 13.65, .06, 1.65), box2(ax - 7.4, y - 12.8, .06, .8), seg2(ax, y, 3.7, 12, .1, 15) - .06);
    d2 = min(d2, abs(sqrt((ax - 5.55) ** 2 + (y - 13.1) ** 2) - .55) - .05);
    U(max(d2, abs(zc) - .12), IRON);
  }
  // Iron columns carrying the crane girders, a gas lamp on each facing the aisle.
  if (z > -60 && z < 12) U(max(box2(ax - CX, y - 9.75, .26, .42), abs(z + 24) - 36), IRON);
  if (bays) {
    const cx = ax - CX, r = sqrt(cx * cx + zc * zc);
    if (r - .6 < D) U(min(max(r - .22 - .06 * sstep(1.4, .7, y), y - 9.3), box(cx, y - .35, zc, .4, .35, .4), box(cx, y - 9.22, zc, .36, .1, .36), box(cx, y - 1.0, zc, .3, .06, .3)), IRON);
    const lx = ax - (CX - .82), ly = y - 5.32;
    if (sqrt(lx * lx + ly * ly + zc * zc) - .8 < D) {
      if (!LIT) U(sqrt(lx * lx + ly * ly + zc * zc) - .16, LAMP);
      U(min(seg3(ax, y, zc, CX - .2, 5.85, 0, CX - .82, 5.85, 0) - .035, max(sqrt(lx * lx + zc * zc) - .14, abs(y - 5.55) - .05), max(sqrt(lx * lx + zc * zc) - .05, abs(y - 5.7) - .15)), BRASS);
    }
  }
  // The travelling crane, parked over the boiler's back half, its hook let down.
  if (box(x, y - 10.7, z + 22, CX + .5, .8, 1.1) < D) U(min(box(x, y - 10.55, z + 21.55, CX + .2, .34, .13), box(x, y - 10.55, z + 22.45, CX + .2, .34, .13), box(ax - CX, y - 10.35, z + 22, .3, .25, 1.0), box(x - 1.3, y - 11.05, z + 22, .65, .22, .75)), IRON);
  if (box(x - 1.3, y - 8.2, z + 22, .4, 2.9, .3) < D) {
    const hx = x - 1.3, hy = y - 5.45, tq = sqrt(hx * hx + hy * hy) - .2;
    U(min(max(min(sqrt((x - 1.18) ** 2 + (z + 22) ** 2), sqrt((x - 1.42) ** 2 + (z + 22) ** 2)) - .025, abs(y - 8.5) - 2.4), box(hx, y - 6.0, z + 22, .2, .22, .09), max(sqrt(tq * tq + (z + 22) ** 2) - .05, min(hx, hy - .05))), IRON);
  }
  // Pipes along the walls.
  if (9.9 - ax < D) {
    const zf = abs(rep(z - 2, 4)) - .045;
    if (x < 0) { const a = sqrt((x + 10.35) ** 2 + (y - 7.1) ** 2), b = sqrt((x + 10.4) ** 2 + (y - 7.62) ** 2); U(min(a - .16, max(a - .23, zf), b - .11, max(b - .17, zf)), COPPER); }
    else { const a = sqrt((x - 10.3) ** 2 + (y - 6.6) ** 2), b = sqrt((x - 10.38) ** 2 + (y - 4.1) ** 2); U(min(a - .2, max(a - .28, zf), b - .1, max(b - .16, zf)), COPPER); }
  }
  // The Lancashire boiler on its brick setting: riveted shell, steam dome, safety valve, two furnace doors and a gauge on the front.
  if (box(x + 5.3, y - 2.6, z + 17, 2.3, 3.1, 9.4) < D) {
    const bx = x + 5.3, by = y - 2.6, bz = z + 17, rr = sqrt(bx * bx + by * by);
    U(min(max(rr - 1.8, abs(bz) - 9), max(rr - 1.85, abs(rep(bz, 1.8)) - .045, abs(bz) - 9.02)), BOILER);
    U(max(box(bx, y - .8, bz - .1, 2.05, .8, 9.1), -box(abs(bx) - .8, y - .5, z + 8, .32, .42, .3)), BRICK);
    U(box(abs(bx) - .8, y - .12, z + 8.25, .32, .1, .05), EMBER);
    U(max(sqrt((abs(bx) - .8) ** 2 + (y - 2.25) ** 2) - .5, abs(z + 7.96) - .06), FURNACE);
    U(max(sqrt(bx * bx + (y - 3.55) ** 2) - .3, abs(z + 7.95) - .05), GAUGE);
    U(max(abs(sqrt(bx * bx + (y - 3.55) ** 2) - .3) - .035, abs(z + 7.92) - .07), BRASS);
    const dz = z + 12;
    U(min(max(sqrt(bx * bx + dz * dz) - .5, abs(y - 4.6) - .5), sqrt(bx * bx + (y - 5.05) ** 2 + dz * dz) - .5), BOILER);
    U(min(max(sqrt(bx * bx + (z + 17) ** 2) - .14, abs(y - 4.7) - .4), max(abs(bx) - .04, abs(y - 5.0) - .04, abs(z + 17.6) - .7)), BRASS);
    U(box(bx, y - 4.95, z + 18.25, .1, .12, .1), IRON);
  }
  // Coal heaped in front of it.
  if (sqrt((x + 6.8) ** 2 + (y + .9) ** 2 + (z + 5.2) ** 2) - 1.8 < D) U((sqrt((x + 6.8) ** 2 + (y + .9) ** 2 * 1.6 + (z + 5.2) ** 2) - 1.55 + .05 * sin(x * 9.1) * sin(z * 8.3 + y * 5) * sin(y * 11.7 + x * 3)) * .75, COAL);
  // The steam main: up from the dome, over the aisle, down into the engine's steam chest; a valve wheel on the riser.
  if (box(x + 1, y - 7, z + 9.8, 4.7, 2.1, 2.7) < D) {
    U(min(pipe(x, y, z, -5.3, 5.35, -12, -5.3, 8.6, -12, .2), pipe(x, y, z, -5.3, 8.6, -12, 3.4, 8.6, -12, .2), pipe(x, y, z, 3.4, 8.6, -12, 3.4, 8.6, -7.6, .2), pipe(x, y, z, 3.4, 8.6, -7.6, 3.4, 4.47, -7.6, .2)), COPPER);
    const wx = x + 5.3, wy = y - 6.6, wz = z + 11.5, wr = sqrt(wx * wx + wy * wy), t = wr - .4;
    U(min(sqrt(t * t + wz * wz) - .045, max(min(abs(wx), abs(wy)) - .03, wr - .4, abs(wz) - .03)), RED);
    U(max(sqrt(wx * wx + wy * wy) - .05, abs(z + 11.75) - .25), BRASS);
  }
  // The engine on its stone bed: lagged cylinder and steam chest, governor, guides, crosshead, rods, crank, flywheel in its pit, the
  // gear up to a line shaft, a belt down to the dynamo.
  if (box(x - 6.9, y - 2.65, z + 12.05, 4.3, 3.95, 6.35) < D) {
    const ex = x - 3.4, ey = y - 3.2, er = sqrt(ex * ex + ey * ey), cz = z + 7.2;
    U(box(ex, y - .5, z + 10.6, .75, .5, 4.4), STONE);
    U(min(max(er - .85, abs(cz) - 1.2), box(ex, y - 4.25, cz, .32, .22, .75)), GREEN);
    U(min(max(er - .95, abs(abs(cz) - 1.2) - .08), box(ex, y - 1.8, cz, .55, .8, .9), box(abs(ex), abs(ey) - .34, z + 10, .1, .05, 1.6), box(ex, y - 1.85, z + 10, .3, .85, 1.5)), IRON);
    const gx = ex, gz = z + 7.2, gy = y - 5.15;
    U(min(max(sqrt(gx * gx + gz * gz) - .03, abs(y - 5.1) - .62), sqrt((abs(gx) - .36) ** 2 + gy * gy + gz * gz) - .1, seg3(abs(gx), y, gz, 0, 5.6, 0, .36, 5.15, 0) - .02, sqrt(gx * gx + (y - 5.74) ** 2 + gz * gz) - .06), BRASS);
    U(min(box(ex, ey, z + 10.3, .22, .28, .2), max(er - .07, abs(z + 9.35) - .95), seg3(x, y, z, 3.4, 3.2, -10.3, CRANK[0], CRANK[1], CRANK[2]) - .1 + .03 * clamp(SH / 4.8), max(sqrt((y - CRANK[1]) ** 2 + (z - CRANK[2]) ** 2) - .1, abs(x - 3.48) - .14)), STEEL);
    const fy = y - 3.2, fz = z + 15, fr = sqrt(fy * fy + fz * fz);
    U(max(fr - .8, abs(x - 3.62) - .1), IRON);
    U(max(fr - .2, abs(x - 5.4) - 1.9), STEEL);
    U(min(box(x - 4.0, y - 1.65, fz, .22, 1.65, .4), box(x - 5.25, y - 1.65, fz, .22, 1.65, .4)), IRON);
    U(min(box(x - 4.0, y - 3.2, fz, .25, .3, .45), box(x - 5.25, y - 3.2, fz, .25, .3, .45)), BRASS);
    const fx = x - 4.6;
    if (max(fr - 3.3, abs(fx) - .35) < D) {
      const a = rep(atan2(fy, fz), PI / 3), th = atan2(fy, fz), sx = fr * cos(a), sy = fr * sin(a);
      U(min(max(abs(fr - 3.05) - .2, abs(fx) - .24), max(fr - .48, abs(fx) - .32), max(box2(sx - 1.75, sy, 1.2, .1 + .05 * clamp((2.9 - sx) / 2.4)), abs(fx) - .1)), GREEN);
      void th;
    }
    const gxx = x - 6.6;
    if (max(fr - 1.7, abs(gxx) - .2) < D) { const th = atan2(fy, fz); U(max(fr - 1.55 - .07 * clamp(cos(32 * th) * 2.5, -1, 1), abs(gxx) - .17) * .8, IRON); }
    const py = y - 5.37, pr = sqrt(py * py + fz * fz);
    if (max(pr - .8, abs(gxx) - .2) < D) { const th = atan2(py, fz); U(max(pr - .62 - .07 * clamp(cos(13 * th + PI) * 2.5, -1, 1), abs(gxx) - .17) * .8, IRON); }
    U(min(max(pr - .12, abs(x - 8.65) - 2.35), max(pr - .7, abs(x - 7.25) - .12)), STEEL);
    U(box(x - 10.6, py, fz, .3, .3, .3), IRON);
    const dy = y - .95, dr = sqrt(dy * dy + fz * fz);
    U(min(max(dr - .5, abs(x - 7.9) - .42), box(x - 7.9, abs(fz) - .45, dy + .05, .38, .12, .42)), GREEN);
    U(min(max(dr - .3, abs(x - 7.42) - .06), max(dr - .28, abs(x - 7.25) - .1)), BRASS);
    U(box(x - 7.8, y - .2, fz, .7, .2, .7), IRON);
    U(max(min(seg2(abs(fz), y, .7, 5.37, .28, .95), seg2(fz, y, -.7, 5.37, .28, .95) + 9) - .02, abs(x - 7.25) - .1), LEATHER);
  }
  // Two pendant lamps under the truss, over the boiler front and over the engine.
  for (const [px, py, pz] of PENDANTS) {
    const qx = x - px, qz = z - pz, qr = sqrt(qx * qx + qz * qz);
    if (max(qr - .6, py - .2 - y) < D) {
      U(max(qr - .015, abs(y - (py + 11.7) / 2) - (11.7 - py) / 2), IRON);
      U(seg2(qr, y, .12, py + .32, .55, py) - .015, SHADE);
      if (!LIT) U(sqrt(qx * qx + (y - py - .1) ** 2 + qz * qz) - .09, BULB);
    }
  }
  // In the foreground on the right, a feed pipe rises past a valve wheel and a pressure gauge, then runs off to the wall main.
  if (box(x - 8, y - 4.6, z - 1.3, 2.7, 4.8, .9) < D) {
    U(min(pipe(x, y, z, 5.6, 0, 1.2, 5.6, 6.6, 1.2, .17), pipe(x, y, z, 5.6, 6.6, 1.2, 10.3, 6.6, 1.2, .17)), COPPER);
    U(box(x - 5.6, y - .08, z - 1.2, .3, .08, .3), IRON);
    const wx = x - 5.6, wy = y - 3.4, wz = z - 1.68, wr = sqrt(wx * wx + wy * wy), t = wr - .42;
    U(min(sqrt(t * t + wz * wz) - .045, max(min(abs(wx), abs(wy)) - .03, wr - .42, abs(wz) - .03)), RED);
    U(min(max(wr - .05, abs(z - 1.47) - .24), sqrt(wx * wx + wy * wy + (wz - .02) ** 2) - .08, max(sqrt(wx * wx + (z - 1.3) ** 2) - .03, abs(y - 4.2) - .35)), BRASS);
    const gy = y - 4.75, gr = sqrt(wx * wx + gy * gy);
    U(max(gr - .3, abs(z - 1.47) - .05), GAUGE);
    U(max(abs(gr - .3) - .035, abs(z - 1.44) - .07), BRASS);
  }
  return D;
}

// ---- Lights
const LMOON = (() => { const v = [-.62, -.45, .64], l = Math.hypot(...v); return v.map(c => c / l); })();
const MOON = [.5, .66, 1.0], MOON_I = 1.5;
// Point lights: position, colour × intensity, spot (cos where it starts, where it's full), casts shadows.
const LIGHTS = [];
for (let k = 1; k >= -7; k--) for (const s of [-1, 1]) LIGHTS.push({ p: [s * (CX - .82), 5.32, 8 * k], c: [1 * 3.2, .58 * 3.2, .26 * 3.2], shadow: true, halo: .05, r: .16 });
for (const [px, py, pz] of PENDANTS) LIGHTS.push({ p: [px, py + .03, pz], c: [1 * 16, .76 * 16, .48 * 16], spot: [.2, .55], shadow: true, halo: .025, r: .1 });
LIGHTS.push({ p: [-5.3, 2.25, -7.45], c: [1 * 4, .38 * 4, .1 * 4], shadow: false, halo: .03, r: .3 });
LIGHTS.push({ p: [-5.3, .4, -7.55], c: [1 * 2.6, .3 * 2.6, .06 * 2.6], shadow: false, halo: .02, r: .3 });

// Through which side window, if any, the moon reaches (x, y, z): the window's leading and frame cast their shadow. WS is the distance to it.
// Soft, for the air: just the window's shape with a blurred edge, since 64 samples along a ray can't resolve the leading without moiré.
let WS = 0;
function windowLit(x, y, z, soft) {
  if (x > HW) return 0;
  const s = (HW + .35 - x) / -LMOON[0], hy = y - LMOON[1] * s, hz = z - LMOON[2] * s; WS = s;
  if (hz < -60 || hz > 12 || hy < 3.2 || hy > 10.6) return 0;
  const u = rep(hz - 4, 8), w = winSide(u, hy);
  if (soft) return sstep(.25, -.25, w) * .8;
  if (w > .02) return 0;
  const lu = min(fract(u / .3), 1 - fract(u / .3)) * .3, lv = min(fract(hy / .42), 1 - fract(hy / .42)) * .42, bar = abs(u) < .06 || abs(hy - 6.4) < .06 ? 0 : 1;
  return sstep(.02, -.04, w) * sstep(.006, .022, min(lu, lv)) * bar;
}

let NX = 0, NY = 1, NZ = 0;
function normalAt(x, y, z, e) {
  const a = map(x + e, y - e, z - e), b = map(x - e, y - e, z + e), c = map(x - e, y + e, z - e), d = map(x + e, y + e, z + e);
  NX = a - b - c + d; NY = -a - b + c + d; NZ = -a + b - c + d; const l = sqrt(NX * NX + NY * NY + NZ * NZ) || 1; NX /= l; NY /= l; NZ /= l;
}
function ao(x, y, z, nx, ny, nz) { let o = 0, w = 1; for (let i = 1; i <= 5; i++) { const h = .1 + .14 * i; o += (h - map(x + nx * h, y + ny * h, z + nz * h)) * w; w *= .62; } return clamp(1 - 1.3 * o); }
function shadow(ox, oy, oz, dx, dy, dz, tmax, k) {
  let res = 1, t = .05; LIT = true;
  for (let i = 0; i < 56 && t < tmax; i++) { const h = map(ox + dx * t, oy + dy * t, oz + dz * t); if (h < .0015) { res = 0; break; } res = min(res, k * h / t); t += clamp(h, .03, 1.6); }
  LIT = false; return clamp(res);
}

// ---- Materials: albedo A, emission E, specular strength and shininess, metal or not, wetness (floor reflections).
let AR = 0, AG = 0, AB = 0, ER = 0, EG = 0, EB = 0, SPC = 0, SHN = 16, MET = 0, WET = 0;
const alb = (r, g, b) => { AR = r; AG = g; AB = b; }, emit = (r, g, b) => { ER = r; EG = g; EB = b; };
const darken = k => { AR *= k; AG *= k; AB *= k; };
function bricks(u, v, t) {
  const row = floor(v / .16), uu = u + (row & 1) * .17, col = floor(uu / .34), fu = fract(uu / .34) * .34, fv = fract(v / .16) * .16, far = sstep(18, 45, t);
  const mortar = min(fu, .34 - fu) < .016 || min(fv, .16 - fv) < .014, k = .62 + .5 * h3(col, row, 5), burnt = h3(col, row, 9) > .9 ? .55 : 1;
  if (mortar) alb(mix(.13, .2, far), mix(.115, .1, far), mix(.1, .065, far)); else alb(mix(.3 * k * burnt, .2, far), mix(.115 * k * burnt, .1, far), mix(.07 * k * burnt, .065, far));
}
function windowGlass(u, v, x, side, rdx, rdy, rdz) {
  const lu = min(fract(u / .3), 1 - fract(u / .3)) * .3, lv = min(fract(v / .42), 1 - fract(v / .42)) * .42, pu = floor(u / .3), pv = floor(v / .42), hsh = h3(pu + (side > 0 ? 40 : 90), pv, round(x) & 7);
  const lead = sstep(.008, .02, min(lu, lv)) * (abs(u) < .06 || abs(v - 6.4) < .06 ? 0 : 1);
  let b = (.5 + .5 * sstep(3.5, 10, v)) * (.78 + .36 * hsh) * (hsh > .95 ? 1.7 : hsh < .05 ? .25 : 1) * (side > 0 ? 1.5 : .55);
  b *= 1 + 2.5 * pow(max(0, -(rdx * LMOON[0] + rdy * LMOON[1] + rdz * LMOON[2])), 6);
  emit(.11 * b * lead, .16 * b * lead, .25 * b * lead); alb(.02, .02, .02);
}
// The town through the back window: chimneys and roofs against a moonlit fog, a few lit windows.
function backGlass(x, y) {
  const lu = min(fract(x / .36), 1 - fract(x / .36)) * .36, lv = min(fract(y / .46), 1 - fract(y / .46)) * .46, lead = sstep(.008, .022, min(lu, lv));
  const sky = sstep(2.5, 14, y), glow = 1 + .9 * exp(-((x - 2.5) ** 2 + (y - 11) ** 2) / 10);
  let r = mix(.2, .09, sky) * glow, g = mix(.26, .12, sky) * glow, b = mix(.36, .2, sky) * glow;
  const cell = floor((x + 20) / .9), roofH = 3.4 + 1.6 * h3(cell, 3, 1) + (h3(cell, 4, 2) > .7 ? .8 : 0);
  let solid = y < roofH;
  for (const [cx, w, top] of [[-2.6, .16, 9.2], [-.4, .12, 7.4], [1.7, .22, 11.2], [2.9, .14, 8.5]]) if (abs(x - cx) < w && y < top) solid = true;
  const gas = sqrt((x + 1.9) ** 2 + (y - 3.6) ** 2) < 2.1 && y > 3.6, ring = gas && (abs(fract(y / .5) - .5) < .08 || abs(fract((x + 1.9) / .7) - .5) < .06);
  if (ring) { r = mix(r, .03, .7); g = mix(g, .035, .7); b = mix(b, .05, .7); }
  if (solid) { r = .025; g = .03; b = .045; const wc = floor(x / .22), wr = floor(y / .3); if (y < roofH - .3 && h3(wc & 255, wr & 255, 7) > .9) { r = 1.1; g = .6; b = .22; } }
  const smoke = [[1.7, 11.2], [-2.6, 9.2]].reduce((s, [cx, top]) => s + (y > top ? exp(-((x - cx - (y - top) * .5) ** 2) / (.15 + (y - top) * .25)) * .5 * exp(-(y - top) * .2) : 0), 0);
  r = mix(r, .2, smoke); g = mix(g, .22, smoke); b = mix(b, .27, smoke);
  emit(r * lead * .9, g * lead * .9, b * lead * .9); alb(.02, .02, .02);
}
function material(m, x, y, z, t, rdx, rdy, rdz, cheap) {
  ER = EG = EB = 0; SPC = .04; SHN = 16; MET = 0; WET = 0;
  const ax = abs(x);
  switch (m) {
    case BRICK: {
      if (abs(NX) > .7) bricks(z, y, t); else if (abs(NZ) > .7) bricks(x, y, t); else alb(.22, .09, .055);
      const g = fbm(x * .7 + z * .7, y * .25, z * .1, 3), soot = sstep(.45, .8, g) * .55 + sstep(1.6, 0, y) * .35 + sstep(9, 12, y) * .35;
      darken(1 - clamp(soot, 0, .75));
      if (abs(z + 8) < .4 && abs(x + 5.3) < 2.1 && y < 1.6) darken(.6);
      break;
    }
    case FLOOR: {
      const row = floor(z / 1.0), u = x + (row & 1) * .7, col = floor(u / 1.4), fu = fract(u / 1.4) * 1.4, fv = fract(z / 1.0), far = sstep(15, 40, t);
      const grout = min(fu, 1.4 - fu) < .02 || min(fv, 1 - fv) * 1.0 < .02, k = .75 + .4 * h3(col, row, 2);
      const base = grout ? mix(.03, .08, far) : mix(.11 * k, .09, far);
      alb(base, base * .94, base * .86);
      const wet = fbm(x * .22, 1.7, z * .22, 4), oil = sstep(.62, .75, fbm(x * .5 + 9, 2, z * .5, 3));
      darken(1 - .45 * oil - .25 * sstep(.4, .7, wet));
      if (y < -.05) { alb(.05, .045, .04); }
      WET = (.25 + .75 * sstep(.42, .66, wet)) * (grout ? .5 : 1); SPC = .3; SHN = 60;
      break;
    }
    case IRON: { const g = .75 + .5 * fbm(x * 2, y * 2, z * 2, 2); alb(.05 * g, .047 * g, .043 * g); SPC = .35; SHN = 30; MET = 1; break; }
    case BOILER: { const g = .7 + .5 * fbm(x * 1.4, y * 1.4, z * .4, 3); alb(.065 * g, .058 * g, .05 * g); darken(1 - .5 * sstep(3, 4.4, y)); SPC = .3; SHN = 22; MET = 1; break; }
    case COPPER: {
      const tar = fbm(x * 1.6, y * 1.6, z * 1.6, 3), ver = sstep(.62, .74, fbm(x * 3 + 4, y * 3, z * 3, 3));
      alb(.62 * (.55 + .5 * tar), .3 * (.55 + .5 * tar), .16 * (.55 + .5 * tar)); SPC = .9; SHN = 55; MET = 1;
      if (ver > 0) { AR = mix(AR, .12, ver); AG = mix(AG, .3, ver); AB = mix(AB, .24, ver); MET = 1 - ver; SPC = mix(.9, .1, ver); }
      break;
    }
    case BRASS: alb(.68, .5, .22); SPC = 1; SHN = 70; MET = 1; break;
    case STEEL: alb(.5, .5, .52); SPC = 1; SHN = 80; MET = 1; break;
    case RED: alb(.5, .05, .035); SPC = .35; SHN = 40; break;
    case GREEN: { alb(.045, .13, .085); SPC = .45; SHN = 50; if (abs(x - 3.4) < 1 && abs(z + 7.2) < 1.3 && y < 4.1 && abs(NZ) > .8) { const r = sqrt((x - 3.4) ** 2 + (y - 3.2) ** 2), a = atan2(y - 3.2, x - 3.4), bolt = abs(r - .74) < .045 && abs(rep(a, PI / 6)) < .06; alb(.06, .058, .055); MET = 1; SPC = .6; SHN = 40; if (bolt || r < .14) { alb(.68, .5, .22); SPC = 1; SHN = 70; } else if (abs(r - .55) < .02) darken(.4); } else if (abs(x - 3.4) < 1 && abs(z + 7.2) < 1.3 && y < 4.1) { const band = abs(rep(z + 7.2, .6)) < .03; if (band) { alb(.68, .5, .22); MET = 1; SPC = 1; SHN = 70; } else { const s = abs(rep(atan2(y - 3.2, x - 3.4) * .85 / .12, 1)) < .06; alb(.2, .12, .06); if (s) darken(.5); SPC = .15; } } break; }
    case STONE: { const g = .7 + .4 * fbm(x * 1.5, y * 1.5, z * 1.5, 3); alb(.25 * g, .22 * g, .18 * g); darken(1 - sstep(.5, .8, fbm(x * .5, y * .3, z * .5, 3)) * .5); break; }
    case WOOD: {
      const along = ax * SN, plank = floor(along / .22), k = .7 + .5 * h3(plank, 1, 3), seam = min(fract(along / .22), 1 - fract(along / .22)) < .05;
      alb(.07 * k, .045 * k, .03 * k); if (seam) darken(.4);
      if (ax < 1.3 && abs(rep(z, 8)) > .6 && z > -60 && z < 12) { const u = rep(z - 4, 8), lu = min(fract(u / .4), 1 - fract(u / .4)) * .4, lead = sstep(.01, .03, lu) * sstep(.01, .03, 1.3 - ax); emit(.04 * lead, .06 * lead, .1 * lead); alb(.01, .01, .01); }
      break;
    }
    case COAL: alb(.03, .03, .03); SPC = .6; SHN = 60; break;
    case LAMP: emit(5.5, 3.3, 1.4); alb(.3, .25, .2); break;
    case BULB: emit(9, 6.4, 3.4); alb(.3, .25, .2); break;
    case EMBER: { const f = fbm(x * 6, y * 6, z * 6, 3); emit(2.6 * f + .3, .55 * f * f + .05, .06); alb(.05, .03, .02); break; }
    case FURNACE: {
      alb(.06, .05, .045); SPC = .4; SHN = 30; MET = 1;
      const fx = abs(x + 5.3) - .8, fy = y - 2.25, r = sqrt(fx * fx + fy * fy);
      if (cheap) { if (r < .47) emit(1.1, .3, .05); } // in the wet floor the doors are a glow, not their grates
      else if (r > .43 && r < .47) emit(2.4, .7, .12);
      else if (r < .32 && abs(fract(fy * 6 + .5) - .5) < .14 && abs(fx) < .26) { const f = .6 + .5 * fbm(x * 9, y * 9, 1, 2); emit(2.2 * f, .6 * f, .1 * f); }
      else if (r > .47) darken(.6);
      break;
    }
    case GAUGE: {
      const g = GAUGES.reduce((a, b) => (abs(x - b[0]) + abs(y - b[1]) < abs(x - a[0]) + abs(y - a[1]) ? b : a));
      const gx = x - g[0], gy = y - g[1], r = sqrt(gx * gx + gy * gy) / g[3], a = atan2(gy, gx);
      alb(.78, .72, .56); emit(.05, .045, .03);
      const tick = r > .72 && r < .88 && abs(rep(a, PI / 12)) < .035 && (a < -PI / 4 || a > -3 * PI / 4 || true) && !(a < -PI / 4 && a > -3 * PI / 4);
      const red = r > .7 && r < .9 && a > -PI / 4 && a < .1, needle = seg2(gx / g[3], gy / g[3], 0, 0, cos(2.1) * .7, sin(2.1) * .7) < .03 || r < .07;
      if (tick || needle) { alb(.04, .03, .02); emit(0, 0, 0); } else if (red) { alb(.55, .05, .03); emit(.02, 0, 0); }
      SPC = .6; SHN = 90;
      break;
    }
    case GLASS: windowGlass(rep(z - 4, 8), y, x, x > 0 ? 1 : -1, rdx, rdy, rdz); break;
    case GLASSB: backGlass(x, y); break;
    case SHADE: if (NY < -.1 || (NY < .3 && ((x - PENDANTS[0][0]) * NX + (z - PENDANTS[0][2]) * NZ < 0) && false)) { alb(.7, .68, .6); emit(.9, .7, .45); } else { alb(.05, .16, .09); SPC = .7; SHN = 60; } break;
    case LEATHER: alb(.11, .06, .03); SPC = .1; break;
    default: alb(.1, .1, .1);
  }
}

// ---- Shading
const out = [0, 0, 0];
function shade(x, y, z, rdx, rdy, rdz, t, cheap) {
  const m = M, e = max(.0015, t * .0007);
  normalAt(x, y, z, e); const nx = NX, ny = NY, nz = NZ;
  const oc = cheap ? 1 : ao(x, y, z, nx, ny, nz);
  NX = nx; NY = ny; NZ = nz; material(m, x, y, z, t, rdx, rdy, rdz, cheap);
  const ar = AR, ag = AG, ab = AB, spc = SPC, shn = SHN, met = MET, wet = WET, kd = 1 - met * .85;
  let r = ER, g = EG, b = EB;
  // Ambient: a cool glow from the windows above, a warm bounce from the floor; metals pick up a hint of the window light.
  const up = ny * .5 + .5, ambR = mix(.016, .02, up), ambG = mix(.012, .024, up), ambB = mix(.009, .034, up);
  r += ar * ambR * oc * kd * 1.6; g += ag * ambG * oc * kd * 1.6; b += ab * ambB * oc * kd * 1.6;
  const vdn = rdx * nx + rdy * ny + rdz * nz, rx = rdx - 2 * vdn * nx, ry = rdy - 2 * vdn * ny, rz = rdz - 2 * vdn * nz;
  const env = met * spc * oc * (.02 + .09 * max(0, rx) * sstep(-.3, .4, ry) + .05 * max(0, -rz) * sstep(-.2, .3, ry));
  r += ar * env; g += ag * env * 1.05; b += ab * env * 1.15;
  const sr = met ? ar * spc : spc, sg = met ? ag * spc : spc, sb = met ? ab * spc : spc, norm = (shn + 8) / 25;
  // Moonlight through the windows.
  const wl = windowLit(x, y, z);
  if (wl > 0) {
    const lx = -LMOON[0], ly = -LMOON[1], lz = -LMOON[2], ndl = nx * lx + ny * ly + nz * lz;
    if (ndl > 0) {
      const sh = cheap ? 1 : shadow(x + nx * .02, y + ny * .02, z + nz * .02, lx, ly, lz, WS - .4, 14);
      if (sh > 0) {
        const hx = lx - rdx, hy = ly - rdy, hz = lz - rdz, hl = sqrt(hx * hx + hy * hy + hz * hz), sp = pow(max(0, (nx * hx + ny * hy + nz * hz) / hl), shn) * norm;
        const k = wl * sh * MOON_I * ndl;
        r += k * MOON[0] * (ar * kd + sr * sp); g += k * MOON[1] * (ag * kd + sg * sp); b += k * MOON[2] * (ab * kd + sb * sp);
      }
    }
  }
  // Lamps.
  let shadows = 0;
  for (const L of LIGHTS) {
    let lx = L.p[0] - x, ly = L.p[1] - y, lz = L.p[2] - z; const d2 = lx * lx + ly * ly + lz * lz;
    if (d2 > 400) continue;
    const d = sqrt(d2); lx /= d; ly /= d; lz /= d;
    const ndl = nx * lx + ny * ly + nz * lz; if (ndl <= 0) continue;
    let att = 1 / (d2 + .25) * (1 - sstep(12, 20, d));
    if (L.spot) att *= sstep(L.spot[0], L.spot[1], ly);
    if (att * ndl * L.c[0] < .002) continue;
    let sh = 1;
    if (L.shadow && !cheap && att * L.c[0] > .025 && shadows < 4) { shadows++; sh = shadow(x + nx * .02, y + ny * .02, z + nz * .02, lx, ly, lz, d - L.r - .05, 10); if (sh <= 0) continue; }
    const hx = lx - rdx, hy = ly - rdy, hz = lz - rdz, hl = sqrt(hx * hx + hy * hy + hz * hz), sp = pow(max(0, (nx * hx + ny * hy + nz * hz) / hl), shn) * norm;
    const k = att * sh * ndl;
    r += k * L.c[0] * (ar * kd + sr * sp); g += k * L.c[1] * (ag * kd + sg * sp); b += k * L.c[2] * (ab * kd + sb * sp);
  }
  out[0] = r; out[1] = g; out[2] = b;
  return wet;
}

function march(ox, oy, oz, dx, dy, dz, tmax, steps) {
  let t = .02;
  for (let i = 0; i < steps && t < tmax; i++) { const d = map(ox + dx * t, oy + dy * t, oz + dz * t); if (d < .0008 * t + .0006) return t; t += d * .95; }
  return -1;
}

// Air: thin haze, mist on the floor, steam from the safety valve and a gland; lit by the moon through the windows (shafts) and by the lamps (halos).
const PLUMES = [{ p: [-5.3, 5.05, -17], h: 6, r0: .12, k: .32, dx: .22, dz: .12, d: 1.4 }, { p: [3.4, 3.4, -6.0], h: 2.5, r0: .1, k: .45, dx: -.35, dz: .5, d: .9 }, { p: [5.6, 6.6, 1.0], h: 3, r0: .06, k: .3, dx: -.15, dz: -.2, d: .6 }];
function steam(x, y, z) {
  let s = 0;
  for (const P of PLUMES) {
    const ry = y - P.p[1]; if (ry < 0 || ry > P.h) continue;
    const cx = P.p[0] + P.dx * ry, cz = P.p[2] + P.dz * ry, rad = P.r0 + P.k * ry, hx = x - cx, hz = z - cz, hd = sqrt(hx * hx + hz * hz);
    if (hd > rad) continue;
    const n = fbm(x * 1.4, y * 1.1 - ry * .3, z * 1.4, 3);
    s += (1 - hd / rad) ** 1.5 * sstep(.38, .7, n) * sstep(P.h, P.h * .3, ry) * sstep(0, .25, ry) * P.d;
  }
  return s;
}
const ign = (x, y) => fract(52.9829189 * fract(.06711056 * x + .00583715 * y));
const res = [0, 0, 0];
function air(ox, oy, oz, dx, dy, dz, T, jit) {
  const n = 64, tEnd = min(T, 85), dt = tEnd / n, cosT = -(dx * LMOON[0] + dy * LMOON[1] + dz * LMOON[2]), g = .45, phase = (1 - g * g) / pow(1 + g * g - 2 * g * cosT, 1.5) * .25 + .3;
  let tr = 1, r = 0, gg = 0, b = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + jit) * dt, x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
    const st = (y < 6.5 && abs(z + 10) < 11) || (abs(x - 5.6) < 2 && z > -1 && y > 6) ? steam(x, y, z) : 0;
    const haze = .011 + .05 * exp(-y / .7) * (.4 + fbm(x * .18, 1, z * .18, 2)) + .006 * sstep(8, 15, y), sig = haze + st;
    let lr = .05 * haze, lg = .055 * haze, lb = .075 * haze;
    const wl = windowLit(x, y, z, true); if (wl > 0) { const k = wl * MOON_I * phase * (haze * 1.15 + st * .5); lr += k * MOON[0]; lg += k * MOON[1]; lb += k * MOON[2]; }
    if (st > 0) for (const L of LIGHTS) { const qx = L.p[0] - x, qy = L.p[1] - y, qz = L.p[2] - z, d2 = qx * qx + qy * qy + qz * qz; if (d2 < 64) { const a = st * .3 / (d2 + .5); lr += a * L.c[0]; lg += a * L.c[1]; lb += a * L.c[2]; } }
    r += tr * lr * dt; gg += tr * lg * dt; b += tr * lb * dt;
    tr *= exp(-sig * dt);
  }
  // Halos round the lamps in the haze, in closed form for a point light in a uniform medium.
  for (const L of LIGHTS) {
    const qx = L.p[0] - ox, qy = L.p[1] - oy, qz = L.p[2] - oz, t0 = qx * dx + qy * dy + qz * dz, hx = qx - dx * t0, hy = qy - dy * t0, hz = qz - dz * t0, h = max(.06, sqrt(hx * hx + hy * hy + hz * hz));
    if (t0 > T + 1) continue;
    let k = L.halo * (atan((T - t0) / h) + atan(t0 / h)) / h * exp(-h * .7);
    if (L.spot) k *= .35 + .65 * sstep(0, .5, qy / max(.1, sqrt(qx * qx + qy * qy + qz * qz)));
    const fade = exp(-.015 * max(0, t0));
    r += k * L.c[0] * fade; gg += k * L.c[1] * fade; b += k * L.c[2] * fade;
  }
  res[0] = r; res[1] = gg; res[2] = b; return tr;
}

function radiance(ox, oy, oz, dx, dy, dz, jit) {
  const t = march(ox, oy, oz, dx, dy, dz, 120, 360);
  let r = 0, g = 0, b = 0, T = 120;
  if (t > 0) {
    T = t; const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
    const wet = shade(x, y, z, dx, dy, dz, t, false); r = out[0]; g = out[1]; b = out[2];
    if (wet > 0) {
      // A wet, oily floor: one glossy bounce, a little rough.
      const jx = (fbm(x * 2.5, 0, z * 2.5, 2) - .5) * .06, jz = (fbm(x * 2.5 + 5, 0, z * 7, 2) - .5) * .12, rx = dx + jx, ry = -dy, rz = dz + jz, rl = sqrt(rx * rx + ry * ry + rz * rz);
      const fres = .04 + .96 * pow(1 - clamp(-dy), 5), k = fres * wet;
      if (k > .01) {
        const t2 = march(x, y + .002, z, rx / rl, ry / rl, rz / rl, 70, 180);
        if (t2 > 0) { shade(x + rx / rl * t2, y + ry / rl * t2, z + rz / rl * t2, rx / rl, ry / rl, rz / rl, t + t2, true); const f = exp(-.02 * t2); r += out[0] * k * f; g += out[1] * k * f; b += out[2] * k * f; }
      }
    }
  }
  const tr = air(ox, oy, oz, dx, dy, dz, T, jit);
  res[0] += r * tr; res[1] += g * tr; res[2] += b * tr;
}

// ---- Views
const VIEWS = {
  'nodes-steampunk-hall': { w: 1920, h: 1080, eye: [.4, 3.1, 9.6], at: [0, 5.4, -30], fov: 52 },
  'nodes-steampunk-hall-portrait': { w: 1080, h: 1920, eye: [.3, 2.8, 9.4], at: [0, 6.2, -30], fov: 76 },
};
function camera(v) {
  const [ex, ey, ez] = v.eye, [tx, ty, tz] = v.at; let fx = tx - ex, fy = ty - ey, fz = tz - ez; const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl; // right = forward × up
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy; // up = right × forward
  return { ex, ey, ez, fx, fy, fz, rx, rz, ux, uy, uz, k: tan(v.fov * PI / 360) };
}
function renderRow(name, j, w, h, spp) {
  const C = camera(VIEWS[name]), row = new Float32Array(w * 3), asp = w / h;
  const offs = spp === 1 ? [[.5, .5]] : [[.25, .75], [.75, .25], [.25, .25], [.75, .75]].slice(0, spp);
  for (let i = 0; i < w; i++) {
    let r = 0, g = 0, b = 0;
    for (const [ox, oy] of offs) {
      const u = ((i + ox) / w * 2 - 1) * C.k * asp, v = (1 - (j + oy) / h * 2) * C.k;
      let dx = C.fx + C.rx * u + C.ux * v, dy = C.fy + C.uy * v, dz = C.fz + C.rz * u + C.uz * v; const l = sqrt(dx * dx + dy * dy + dz * dz); dx /= l; dy /= l; dz /= l;
      radiance(C.ex, C.ey, C.ez, dx, dy, dz, ign(i * 2 + ox * 7, j * 2 + oy * 5)); r += res[0]; g += res[1]; b += res[2];
    }
    row[i * 3] = r / offs.length; row[i * 3 + 1] = g / offs.length; row[i * 3 + 2] = b / offs.length;
  }
  return row;
}

// ---- Finishing: bloom round the lamps and windows, filmic tone, a vignette, dither; then Pillow writes the file.
function blur(src, w, h, rad) {
  const a = new Float32Array(src), tmp = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) { let s = 0; const o = y * w * 3 + c; for (let x = -rad; x <= rad; x++) s += a[o + clamp(x, 0, w - 1) * 3]; for (let x = 0; x < w; x++) { tmp[o + x * 3] = s / (2 * rad + 1); s += a[o + min(x + rad + 1, w - 1) * 3] - a[o + max(x - rad, 0) * 3]; } }
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let s = 0; const o = x * 3 + c, st = w * 3; for (let y = -rad; y <= rad; y++) s += tmp[o + clamp(y, 0, h - 1) * st]; for (let y = 0; y < h; y++) { a[o + y * st] = s / (2 * rad + 1); s += tmp[o + min(y + rad + 1, h - 1) * st] - tmp[o + max(y - rad, 0) * st]; } }
  }
  return a;
}
const EXPOSURE = 1.5;
function finish(hdr, w, h) {
  const bright = new Float32Array(hdr.length);
  for (let i = 0; i < hdr.length; i++) bright[i] = max(0, hdr[i] - .55);
  const s = Math.max(w, h) / 1920, b1 = blur(bright, w, h, max(1, round(5 * s))), b2 = blur(bright, w, h, max(2, round(22 * s)));
  const px = Buffer.alloc(w * h * 3);
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w - .5, v = y / h - .5, vig = 1 - .5 * sstep(.3, .75, sqrt(u * u * (w > h ? 1 : .6) + v * v * (w > h ? .8 : 1)) * 1.1);
    for (let c = 0; c < 3; c++) {
      const i = (y * w + x) * 3 + c, l = (hdr[i] + .35 * b1[i] + .3 * b2[i]) * EXPOSURE * vig;
      const tm = clamp(l * (2.51 * l + .03) / (l * (2.43 * l + .59) + .14));
      px[i] = clamp(round(pow(tm, 1 / 2.2) * 255 + rnd() - .5), 0, 255);
    }
  }
  return px;
}

if (!isMainThread) {
  parentPort.on('message', ({ name, j, w, h, spp }) => { const row = renderRow(name, j, w, h, spp); parentPort.postMessage({ j, row }, [row.buffer]); });
} else {
  const scale = +(process.argv[2] || 1), dir = (process.argv[3] || fileURLToPath(new URL('../client/public/', import.meta.url))).replace(/\/?$/, '/'), fmt = process.argv[4] || 'webp';
  mkdirSync(dir, { recursive: true });
  const workers = Array.from({ length: max(1, availableParallelism() - 1) }, () => new Worker(fileURLToPath(import.meta.url)));
  const render = (name, w, h, spp) => new Promise(done => {
    const hdr = new Float32Array(w * h * 3); let next = 0, left = h; const started = Date.now();
    for (const wk of workers) {
      const give = () => { if (next < h) wk.postMessage({ name, j: next++, w, h, spp }); };
      wk.removeAllListeners('message');
      wk.on('message', ({ j, row }) => { hdr.set(row, j * w * 3); if (--left === 0) { console.log(name, `${w}x${h}`, ((Date.now() - started) / 1000).toFixed(0) + 's'); done(hdr); } else give(); });
      give();
    }
  });
  const PY = 'import io,sys\nfrom PIL import Image\nw,h=int(sys.argv[2]),int(sys.argv[3])\nim=Image.frombytes("RGB",(w,h),sys.stdin.buffer.read())\nim.save(sys.argv[1],quality=int(sys.argv[4]),method=6) if sys.argv[1].endswith(".webp") else im.save(sys.argv[1])';
  for (const [name, v] of Object.entries(VIEWS)) {
    const w = round(v.w * scale), h = round(v.h * scale), hdr = await render(name, w, h, scale >= .5 ? 2 : 1);
    const path = `${dir}${name}.${fmt}`, r = spawnSync('python3', ['-c', PY, path, String(w), String(h), '74'], { input: finish(hdr, w, h) });
    if (r.status) { console.error(String(r.stderr)); process.exitCode = 1; } else console.log('wrote', path);
  }
  await Promise.all(workers.map(w => w.terminate()));
}
