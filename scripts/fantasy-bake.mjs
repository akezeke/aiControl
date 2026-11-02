// Offline ray-marcher for the Fantasy backgrounds: late-90s pre-rendered CG, all original scenes.
// Each place bakes a 360° backdrop (a strip seen from the stage) and a floor (top-down, fading into the same haze).
// node scripts/fantasy-bake.mjs <rawDir> [name|all] [scale], then python3 scripts/fantasy-plates.py <rawDir> client/public/fantasy
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

const { abs, min, max, sqrt, sin, cos, atan2, floor, round, exp, PI, pow } = Math;
const mix = (a, b, t) => a + (b - a) * t, clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v, sstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
// ---- Noise
const PERM = new Uint8Array(512); { let s = 1234567; const p = Array.from({ length: 256 }, (_, i) => i); for (let i = 255; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; }
const h3 = (x, y, z) => PERM[(PERM[(PERM[x & 255] + y) & 255] + z) & 255] / 255;
function noise(x, y, z) { const X = floor(x), Y = floor(y), Z = floor(z), a = x - X, b = y - Y, c = z - Z, u = a * a * (3 - 2 * a), v = b * b * (3 - 2 * b), w = c * c * (3 - 2 * c); return mix(mix(mix(h3(X, Y, Z), h3(X + 1, Y, Z), u), mix(h3(X, Y + 1, Z), h3(X + 1, Y + 1, Z), u), v), mix(mix(h3(X, Y, Z + 1), h3(X + 1, Y, Z + 1), u), mix(h3(X, Y + 1, Z + 1), h3(X + 1, Y + 1, Z + 1), u), v), w); }
function fbm(x, y, z, o = 4) { let s = 0, a = .5, n = 0; for (let i = 0; i < o; i++) { s += a * noise(x, y, z); n += a; a *= .5; x = x * 2.03 + 11.3; y = y * 2.03 + 3.7; z = z * 2.03 + 7.1; } return s / n; }
let W1 = 0, W2 = 0; function worley(x, z) { const X = floor(x), Z = floor(z); W1 = W2 = 9; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const px = X + i + h3(X + i, 7, Z + j), pz = Z + j + h3(X + i, 13, Z + j), d = sqrt((px - x) ** 2 + (pz - z) ** 2); if (d < W1) { W2 = W1; W1 = d; } else if (d < W2) W2 = d; } }
// ---- Shapes
const box = (x, y, z, a, b, c) => { const p = abs(x) - a, q = abs(y) - b, r = abs(z) - c, P = max(p, 0), Q = max(q, 0), R = max(r, 0); return sqrt(P * P + Q * Q + R * R) + min(max(p, q, r), 0); };
const cylY = (x, y, z, r, h) => { const a = sqrt(x * x + z * z) - r, b = abs(y) - h, A = max(a, 0), B = max(b, 0); return min(max(a, b), 0) + sqrt(A * A + B * B); };
const cap = (x, y, z, ax, ay, az, bx, by, bz, r) => { const px = x - ax, py = y - ay, pz = z - az, dx = bx - ax, dy = by - ay, dz = bz - az, t = clamp((px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz)), qx = px - dx * t, qy = py - dy * t, qz = pz - dz * t; return sqrt(qx * qx + qy * qy + qz * qz) - r; };
const rep = (v, s) => v - s * round(v / s);
const sminf = (a, b, k) => { const h = clamp(.5 + .5 * (b - a) / k); return mix(b, a, h) - k * h * (1 - h); };
const cone = (x, y, z, r, h) => { const q = sqrt(x * x + z * z), t = clamp(1 - y / h); return max(q - r * t, -y, y - h) * .8; };
// Results of map() and material().
let D = 1e9, M = 0, GL = 1e9, AR = 0, AG = 0, AB = 0, ER = 0, EG = 0, EB = 0, SP = 0, NX = 0, NY = 1, NZ = 0;
const U = (v, m) => { if (v < D) { D = v; M = m; } };
const alb = (r, g, b) => { AR = r; AG = g; AB = b; };
const emit = (r, g, b) => { ER = r; EG = g; EB = b; };
const lerpAlb = (r, g, b, t) => { AR = mix(AR, r, t); AG = mix(AG, g, t); AB = mix(AB, b, t); };
function bump(x, y, z, s, k, o = 3) { const e = .5 / s, n = fbm(x * s, y * s, z * s, o), a = fbm((x + e) * s, y * s, z * s, o) - n, b = fbm(x * s, (y + e) * s, z * s, o) - n, c = fbm(x * s, y * s, (z + e) * s, o) - n; NX -= a * k / e / s; NY -= b * k / e / s; NZ -= c * k / e / s; const l = sqrt(NX * NX + NY * NY + NZ * NZ) || 1; NX /= l; NY /= l; NZ /= l; }
const tilt = (dx, dz) => { NX -= dx; NZ -= dz; const l = sqrt(NX * NX + NY * NY + NZ * NZ); NX /= l; NY /= l; NZ /= l; };
// Panels on whichever plane the surface faces: darkens seams and picks out rivets.
// The stage's floor is drawn apart, so inside its radius the ground exists only from its rim outwards. This is the true distance to that rim.
const ring = (fr, y, radius) => sqrt((radius - fr) ** 2 + y * y);
function panels(x, y, z, s, seam = .03) { const ax = abs(NX), ay = abs(NY), az = abs(NZ), u = ax > ay && ax > az ? z : x, v = ay > ax && ay > az ? z : y, fu = abs(rep(u, s)), fv = abs(rep(v, s * .75)), edge = min(s / 2 - fu, s * .375 - fv); if (edge < seam) { AR *= .35; AG *= .35; AB *= .35; } else { const iu = floor(u / s + .5), iv = floor(v / (s * .75) + .5), t = .82 + .36 * h3(iu, iv, 3); AR *= t; AG *= t; AB *= t; const rx = fu - s / 2 + .16, ry = fv - s * .375 + .16; if (rx * rx + ry * ry < .006) { AR *= 1.8; AG *= 1.8; AB *= 1.8; } } }
function grime(x, y, z, amt = .6) { const g = fbm(x * 1.2, y * .18, z * 1.2, 3), s = sstep(.42, .75, g) * amt; AR *= 1 - s; AG *= 1 - s; AB *= 1 - s; }
function rust(x, y, z, amt = 1) { const r = sstep(.47, .68, fbm(x * .5 + 3, y * .5, z * .5, 4)) * amt, f = fbm(x * 4, y * 4, z * 4, 2); lerpAlb(.33 + f * .12, .15 + f * .06, .07, r); }

// Natural sky: a gradient from horizon to zenith, with lit-and-shaded clouds on a flat layer overhead.
function daySky(dx, dy, dz, zen, hor, lit, dark, sun, cover) {
  const t = pow(clamp(dy * 1.5), .55), r = mix(hor[0], zen[0], t), g = mix(hor[1], zen[1], t), b = mix(hor[2], zen[2], t); if (dy <= 0) return [r, g, b];
  const q = 1.5 / (max(dy, .02) + .14), u = dx * q, v = dz * q, c = fbm(u * .8 + 7, 1, v * .8, 5), c2 = fbm((u + sun[0] * .4) * .8 + 7, 1, (v + sun[2] * .4) * .8, 5), cl = sstep(cover, cover + .17, c) * sstep(.0, .07, dy), l = clamp((c - c2) * 7 + .55);
  const sd = max(0, dx * sun[0] + dy * sun[1] + dz * sun[2]), glare = pow(sd, 240) * 4 + pow(sd, 14) * .22;
  return [mix(r, mix(dark[0], lit[0], l), cl * .94) + glare, mix(g, mix(dark[1], lit[1], l), cl * .94) + glare * .85, mix(b, mix(dark[2], lit[2], l), cl * .94) + glare * .6];
}
function verd(x, y, z, amt = 1) { const k = sstep(.5, .66, fbm(x * .45 + 11, y * .45, z * .45, 4)) * amt; lerpAlb(.2, .42, .32, k); }
const HILLS = new Map();

// ---- Places. Each: map, material, floor, sky, lights, haze.
const PLACES = {
  // A reactor hall: a great core behind the stage, ringed by catwalks and pipe runs.
  reactor: {
    haze: [.01, .06, .045], fog: .005, mist: .5, ambient: [.06, .1, .09], ambientLow: [.02, .05, .04], exposure: 1.6, glow: [.3, 1, .55], glowK: .85, glowGain: .05,
    lights: [
      { p: [0, 9, -21], c: [.35, 1, .55], i: 420 }, { p: [4, 30, 6], c: [.72, 1, .9], i: 850 }, { p: [-6, 26, 40], c: [.6, .95, .9], i: 420 },
      { p: [-30, 12, -13], c: [.3, 1, .7], i: 170 }, { p: [31, 7, -14], c: [1, .25, .15], i: 130 },
    ],
    sky() { return [.02, .03, .02]; },
    map(x, y, z) {
      D = 1e9; GL = 1e9;
      const cz = z + 36, r = sqrt(x * x + cz * cz);
      U(max(r - 13, y - 34), 2); // the core
      U(cylY(x, y - 36, cz, 15, 2.2), 5); U(cap(x, y, cz, 0, 38, 0, 0, 60, 0, 6.5), 5);
      const ry = rep(y - 2, 7.5), a = atan2(x, cz), sect = PI / 16, as = a - sect * 2 * round(a / (sect * 2));
      U(max(abs(r - 13.4) - .6, abs(ry) - .34, y - 36), 5); // flanges
      const sx = r * sin(as), sz = r * cos(as);
      U(max(box(sx, ry, sz - 14.2, .55, 1.25, .7), y - 36), 3); // brackets
      if (y < 36) GL = min(GL, max(abs(sx) - .06, r - 13.3) + max(0, abs(ry) - 2.6));
      // Hall wall and ribs.
      const hz = z + 8, hr = sqrt(x * x + hz * hz), ha = atan2(x, hz), hs = PI / 13, has = ha - hs * 2 * round(ha / (hs * 2)), hx = hr * sin(has), hzz = hr * cos(has);
      U(55 - hr, 1); U(46 - y, 1);
      U(box(hx, y - 20, hzz + 52.5, 2.1, 30, 1.8), 5);
      U(box(rep(x, 10), y - 44.4, rep(z, 14), .7, 1.7, 40), 5); U(box(rep(x, 30), y - 44, rep(z, 12), 40, 1.3, .55), 5);
      // Catwalk rings around the core.
      for (const [h, R] of [[7, 17], [15, 16]]) { U(max(abs(r - R) - 2.6, abs(y - h) - .14), 4); const pz = cos(a - (PI / 22) * 2 * round(a / (PI / 11))) * (r), pp = r * sin(a - (PI / 22) * 2 * round(a / (PI / 11))); U(box(pp, y - h - .75, pz - R - 2.5, .06, .75, .06), 3); U(sqrt((r - R - 2.5) ** 2 + (y - h - 1.5) ** 2) - .07, 3); U(sqrt((r - R - 2.5) ** 2 + (y - h - .8) ** 2) - .05, 3); }
      // Bridge and struts to the catwalk.
      // Pipe runs along the wall.
      for (const [h, t] of [[3, .9], [5.2, .7], [6.9, .5], [15, 1.3], [17.8, .85]]) { U(sqrt((hr - 51) ** 2 + (y - h) ** 2) - t, 3); if (hr > 47) U(max(sqrt((hr - 51) ** 2 + (y - h) ** 2) - t - .16, abs(hx) - .22), 5); }
      // Big feed pipes arching from the walls into the core.
      U(cap(x, y, z, -44, 19, -14, -17, 26, -30, 1.8), 3); U(cap(x, y, z, 44, 15, -13, 17, 23, -31, 1.8), 3); U(cap(x, y, z, -41, 7, -25, -18, 7, -33, 1.3), 3); U(cap(x, y, z, 43, 8, -24, 18, 6, -33, 1.2), 3);
      U(cap(x, y, z, -30, 42, -6, -6, 30, -30, 1), 3); U(cap(x, y, z, 26, 44, -2, 5, 31, -30, 1.1), 3);
      // Columns framing the stage.
      for (const [cx, cz2] of [[-27, -6], [27, -6], [-34, 13], [34, 13]]) { U(box(x - cx, y - 20, z - cz2, 1.5, 28, 1.5), 1); U(box(x - cx, rep(y, 9), z - cz2, 1.85, .24, 1.85), 5); }
      // Warning lamps.
      for (const [lx, lz, h] of [[-27, -4.2, 12], [27, -4.2, 7]]) { const d = sqrt((x - lx) ** 2 + (y - h) ** 2 + (z - lz) ** 2) - .28; U(d, 6); GL = min(GL, d + 1.5); }
      return D;
    },
    material(m, x, y, z) {
      alb(.3, .33, .35); emit(0, 0, 0); SP = .3;
      if (m === 1) { alb(.13, .2, .2); bump(x, y, z, 1.2, .1); panels(x, y, z, 5.4, .05); verd(x, y, z, .35); grime(x, y, z); }
      else if (m === 2) {
        const cz = z + 36, r = sqrt(x * x + cz * cz), a = atan2(x, cz), fa = abs(a / (PI / 16) - 2 * round(a / (PI / 8))), ry = rep(y - 2, 7.5);
        alb(.14, .24, .24); panels(x, y, z, 4, .04); verd(x, y, z, .6); grime(x, y, z, .5);
        if (r < 13.05 && fa < .17 && abs(ry) > .45) { const f = .8 + .9 * fbm(x * .8, y * .4, z * .8, 3); emit(.42 * f, 1.5 * f, .7 * f); alb(.05, .1, .06); }
        SP = .4;
      } else if (m === 3) { alb(.18, .36, .32); verd(x, y, z, .7); grime(x, y, z, .5); SP = .75; bump(x, y, z, 5, .03, 2); }
      else if (m === 4) { alb(.14, .2, .2); const g = sin(x * 14) * sin(z * 14) > 0 ? 1 : .5; AR *= g; AG *= g; AB *= g; SP = .4; }
      else if (m === 5) { alb(.12, .2, .2); verd(x, y, z, .4); grime(x, y, z, .5); SP = .35; }
      else if (m === 6) emit(3, 1.1, .25);
    },
    floor(x, z) {
      alb(.11, .18, .17); emit(0, 0, 0); NX = 0; NY = 1; NZ = 0; SP = .3;
      const s = 4, fx = abs(rep(x, s)), fz = abs(rep(z, s)), edge = min(s / 2 - fx, s / 2 - fz), ix = round(x / s), iz = round(z / s), t = .75 + .5 * h3(ix, iz, 1); AR *= t; AG *= t; AB *= t;
      // Tread plate, seams, bolts.
      const tr = abs(sin((x + z) * 6)) * abs(sin((x - z) * 6)); if (h3(ix, iz, 5) > .45) { const k = sstep(.55, .9, tr) * .35; AR += k * .1; AG += k * .16; AB += k * .15; tilt(cos((x + z) * 6) * .05, cos((x - z) * 6) * .05); }
      if (edge < .05) { AR *= .18; AG *= .18; AB *= .18; } const bx = fx - s / 2 + .24, bz = fz - s / 2 + .24; if (bx * bx + bz * bz < .012) { alb(.42, .58, .52); tilt(bx * 3, bz * 3); }
      { const w = sstep(.5, .7, fbm(x * 1.6 + 3, 1, z * 1.6, 4)) * sstep(.42, .62, fbm(x * .2, 6, z * .2, 3)); lerpAlb(.04, .14 + w * .1, .11, w * .6); }
      if (abs(rep(x * .7 + z * .13 + fbm(x * .4, 4, z * .4, 2) * 3, .9)) < .006) { AR *= 1.5; AG *= 1.5; AB *= 1.5; }
      grime(x, 0, z, .7);
      const oil = sstep(.55, .72, fbm(x * .22 + 40, 2, z * .22, 4)) * .75; AR *= 1 - oil; AG *= 1 - oil; AB *= 1 - oil; SP += oil * .35;
      // A grate strip across the stage lets the core's light up through it.
      const gz = abs(z + 8), inGrate = gz < 1 && abs(x) < 15; if (inGrate) { const bar = abs(rep(x, .36)); if (bar < .08 || gz > .9) { alb(.07, .11, .11); } else { alb(.01, .02, .02); const f = fbm(x * .4, 3, z * 2, 3); emit(.1 * f, 1.3 * f, .75 * f); } }
      // Worn yellow hazard paint at the stage's edge.
      const hz = abs(abs(x) - 11.4); if (hz < .55 && abs(z) < 13) { const st = rep(z + x, 1.5) > 0, wear = sstep(.46, .62, fbm(x * .9, 8, z * .9, 4)); if (st && wear < .5) { alb(.42, .3, .05); grime(x, 0, z, .8); } else if (wear < .5) alb(.05, .05, .05); }
    },
  },

  // Red rock country: scarlet buttes banded with pale stone, a stone arch, and big white clouds in a turquoise sky.
  mesa: {
    haze: [.72, .46, .42], fog: .0026, mist: .06, ambient: [.3, .36, .4], ambientLow: [.3, .1, .07], exposure: 1.12, glow: [1, .8, .5], glowK: .3, glowGain: 0,
    lights: [{ dir: [-.62, .55, .56], c: [1.4, 1.26, 1.08], i: 1.75 }],
    sky(dx, dy, dz) { return daySky(dx, dy, dz, [.02, .4, .48], [.7, .9, .86], [1.6, 1.6, 1.55], [.72, .8, .82], [-.55, .49, .5], .5); },
    map(x, y, z) {
      D = 1e9; GL = 1e9;
      const fr = sqrt(x * x + z * z);
      if (fr < 86) U(ring(fr, y, 86) * .7, 1); else { const n = fbm(x * .017, 2, z * .017, 4), ridge = sstep(86, 150, fr) * (pow(1 - abs(n * 2 - 1), 1.6) * 34 + 1.5); U((y - ridge) * .7, 1); }
      // Buttes and spires on a jittered grid, the middle kept clear.
      const s = 33, ix = round(x / s), iz = round(z / s);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const a = ix + i & 255, b = iz + j & 255, cx = (ix + i) * s + (h3(a, 3, b) - .5) * 21, cz = (iz + j) * s + (h3(a, 9, b) - .5) * 21; if (cx * cx + cz * cz < 42 * 42 || cx * cx + (cz - 14) ** 2 < 42 * 42) continue;
        const sel = h3(a, 5, b), spire = sel < .3, R = spire ? 2.6 + sel * 11 : 8 + h3(a, 7, b) * 11, H = spire ? 14 + h3(a, 7, b) * 26 : 11 + h3(a, 11, b) ** 1.5 * 30, q = sqrt((x - cx) ** 2 + (z - cz) ** 2);
        if (q > R * 1.6 + 7 || y > H + 7) { U(max(q - R * 1.6 - 5, y - H - 5), 1); continue; }
        const tier = clamp(y / H) * 4, step = floor(tier), terr = (step + sstep(.85, 1, tier - step)) / 4, rad = R * (1.32 - .4 * terr), dis = 2.6 * fbm(x * .1, y * .035, z * .1, 3) + .5 * fbm(x * .55, y * .3, z * .55, 2);
        U(max(q - rad - dis, y - H) * .72, 1);
      }
      // A natural arch.
      const ax = x + 37, az = z + 46, q = sqrt(ax * ax + y * y) - 19, tb = sqrt((ax) ** 2 + y * y + az * az) - 28; if (tb < 3) U(sqrt(q * q + az * az) - 3.4 - 1.7 * fbm(x * .22, y * .22, z * .22, 3), 1); else U(tb, 1);
      return D;
    },
    material(m, x, y, z) {
      emit(0, 0, 0); SP = .04;
      const b = fbm(x * .03, y * .4, z * .03, 3), band = sin(y * .95 + b * 8) * .5 + .5; alb(mix(.6, .9, band), mix(.1, .22 + band * band * .08, band), mix(.06, .13 + band * band * .07, band));
      const dark = sstep(.5, .72, fbm(x * .18, y * .18, z * .18, 3)); AR *= 1 - dark * .35; AG *= 1 - dark * .38; AB *= 1 - dark * .38;
      const top = sstep(.55, .85, NY); lerpAlb(.86, .66, .58, top);
      bump(x, y * 2.2, z, .6, .5, 4); bump(x, y, z, 3, .16, 2);
    },
    floor(x, z) {
      emit(0, 0, 0); NX = 0; NY = 1; NZ = 0; SP = .02;
      worley(x * .55 + fbm(x * .3, 0, z * .3, 2) * 1.2, z * .55); const crack = sstep(.02, .085, W2 - W1), plate = fbm(x * .1, 4, z * .1, 3), dune = sin(x * 1.6 + z * .55 + fbm(x * .3, 2, z * .3, 2) * 5) * .5 + .5, sand = sstep(.42, .66, plate);
      alb(mix(.62, .86, plate), mix(.15, .3, plate), mix(.09, .17, plate)); const k = mix(.3, 1, crack) * (1 - sand) + sand; AR *= k; AG *= k * .98; AB *= k * .96;
      bump(x, 0, z, 2.2, .22, 3); if (sand > .4) tilt(cos(x * 1.6 + z * .55) * .16 * sand, 0); if (crack < .6) tilt((W1 - W2) * .3, (W1 - W2) * .15);
      const f2 = fbm(x * 3.6, 7, z * 3.6, 3), v = .84 + f2 * .32; AR *= v; AG *= v; AB *= v;
      const pb = fbm(x * 3.4, 9, z * 3.4, 2); if (pb > .68) { alb(.4, .1, .07); tilt((pb - .68) * 2, -(pb - .68)); } const ds = dune * sand * .08; AR += ds; AG += ds * .35; AB += ds * .25;
    },
  },

  // A primeval wood: towering moss-green trunks, emerald ground, shafts of light and drifting spores.
  wood: {
    haze: [.02, .13, .07], fog: .0065, mist: .1, ambient: [.1, .2, .13], ambientLow: [.02, .07, .035], exposure: 1.5, glow: [.8, 1, .45], glowK: 3.2, glowGain: .012, shafts: { dir: [.34, .9, -.28], c: [.75, 1, .55], k: .13 },
    lights: [{ dir: [.34, .9, -.28], c: [1.05, 1.3, .72], i: 2.2 }, { p: [-14, 6, -22], c: [.7, 1, .35], i: 120 }, { p: [18, 5, -16], c: [.45, 1, .55], i: 90 }],
    sky(dx, dy, dz) { const t = clamp(dy); return [mix(.6, .9, t), mix(.95, 1, t), mix(.45, .6, t)]; },
    map(x, y, z) {
      D = 1e9; GL = 1e9;
      // Trunks on a jittered grid, nothing near the stage.
      const s = 11, ix = round(x / s), iz = round(z / s);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const cx = (ix + i) * s + (h3(ix + i & 255, 3, iz + j & 255) - .5) * 6, cz = (iz + j) * s + (h3(ix + i & 255, 9, iz + j & 255) - .5) * 6; if (cx * cx * .6 + cz * cz < 19 * 19) continue;
        const rr = .8 + h3(ix + i & 255, 5, iz + j & 255) * 2.7, dx = x - cx - sin(y * .06 + cz) * 1.4, dz = z - cz - cos(y * .05 + cx) * 1.1, a = atan2(dx, dz), flare = rr * (1 + 1.5 * exp(-y * .28) * (.75 + .3 * sin(a * 5 + cx))), ridges = .13 * sin(a * 9 + y * .12) * rr;
        U((sqrt(dx * dx + dz * dz) - flare - ridges) * .72, 1);
      }
      // The canopy.
      if (y > 26) U((58 - y - 26 * fbm(x * .05, 3, z * .05, 3)) * .6, 2);
      else U(32 - y, 2);
      // A fallen giant and arching roots.
      U(cap(x, y, z, -46, 2.2, -32, -9, 5.5, -41, 3.2), 1); U(cap(x, y, z, 12, 0, -26, 25, 8, -31, 1.1), 1); U(cap(x, y, z, 25, 8, -31, 39, 0, -29, 1.3), 1); U(cap(x, y, z, -20, 0, -21, -29, 5, -26, .9), 1);
      // Spores.
      const px = rep(x, 5.2), py = rep(y - 1.1, 3.9), pz = rep(z, 5.2), hh = h3(round(x / 5.2) & 255, round(y / 3.9) & 255, round(z / 5.2) & 255); if (hh > .55 && x * x * .6 + z * z > 200) { const d = sqrt((px - hh + .5) ** 2 + (py + hh - .5) ** 2 + pz * pz) - .05 - hh * .05; U(d, 3); GL = min(GL, d); }
      return D;
    },
    material(m, x, y, z) {
      emit(0, 0, 0); SP = .04;
      if (m === 1) { const a = atan2(x, z), g = fbm(x * .45, y * .09, z * .45, 4); alb(mix(.07, .2, g), mix(.14, .3, g), mix(.09, .17, g)); bump(x, y * .22, z, 2, .7, 3); const moss = sstep(.52, .72, fbm(x * .34, y * .22, z * .34, 4) + NY * .28 + (y < 5 ? .08 : 0)); lerpAlb(.14, .5, .1, moss * .9); }
      else if (m === 2) { const g = fbm(x * .15, y * .15, z * .15, 3); alb(.12 + g * .2, .22 + g * .26, .04); emit(.03 + g * .14, .06 + g * .15, .005); }
      else emit(2.5, 2.2, .8);
    },
    floor(x, z) {
      emit(0, 0, 0); NX = 0; NY = 1; NZ = 0; SP = .03;
      const g = fbm(x * .4, 0, z * .4, 5), g2 = fbm(x * 2.2, 1, z * 2.2, 3); alb(mix(.05, .2, g), mix(.3, .62, g), mix(.08, .16, g)); AR *= .7 + g2 * .6; AG *= .7 + g2 * .6; AB *= .7 + g2 * .6; bump(x, 0, z, 3.2, .3, 3);
      const earth = sstep(.48, .62, fbm(x * .18 + 9, 3, z * .18, 4)); lerpAlb(.03, .2, .1, earth * .85);
      // Roots wander across the ground.
      for (let i = 0; i < 3; i++) { const v = abs(fbm(x * .1 + i * 7.3, i, z * .1, 3) - .5) * 24; if (v < .34) { const k = 1 - v / .34; alb(.1 + k * .06, .28 + k * .1, .14); tilt((fbm(x + .1, i, z, 2) - .5) * 2 * k, 0); bump(x, 0, z, 1.4, .16, 2); } }
      // Fallen leaves and little glowing caps.
      worley(x * 1.45, z * 1.45); if (W1 < .12 && h3(floor(x * 1.45) & 255, 2, floor(z * 1.45) & 255) > .55) { const v = h3(floor(x * 1.45) & 255, 4, floor(z * 1.45) & 255); alb(mix(.5, .78, v), mix(.72, .85, v), .12); }
      worley(x * .43 + 17, z * .43); if (W1 < .05 && h3(floor(x * .43 + 17) & 255, 8, floor(z * .43) & 255) > .55) { alb(.95, .85, .45); emit(.3, .24, .06); }
    },
  },

  // High summer on a meadow: bright grass hills, flat-topped trees, wild flowers and a granite outcrop.
  meadow: {
    open: true,
    haze: [.66, .86, .84], fog: .0042, mist: .04, ambient: [.34, .42, .42], ambientLow: [.14, .28, .1], exposure: 1.05, glow: [1, .95, .5], glowK: .3, glowGain: 0,
    lights: [{ dir: [.6, .6, -.52], c: [1.45, 1.38, 1.1], i: 1.7 }],
    sky(dx, dy, dz) { return daySky(dx, dy, dz, [.1, .5, .72], [.74, .94, .92], [1.6, 1.6, 1.55], [.72, .82, .84], [.6, .6, -.52], .52); },
    hill(x, z) { const fr = sqrt(x * x + z * z); if (fr < 40) return 0; const n = fbm(x * .017 + 3, 1, z * .017, 3), near = sstep(40, 84, fr) * max(0, n * 30 - 7), r2 = fbm(x * .011 + 40, 2, z * .011, 4), far = sstep(95, 165, fr) * pow(1 - abs(r2 * 2 - 1), 1.5) * 44; return near + far; },
    map(x, y, z) {
      D = 1e9; GL = 1e9;
      const fr = sqrt(x * x + z * z); if (fr < 40) U(ring(fr, y, 40) * .72, 1); else U((y - this.hill(x, z)) * .72, 1);
      // Acacias on a jittered grid.
      const s = 21, ix = round(x / s), iz = round(z / s);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const a = ix + i & 255, b = iz + j & 255; if (h3(a, 2, b) < .45) continue;
        const cx = (ix + i) * s + (h3(a, 3, b) - .5) * 13, cz = (iz + j) * s + (h3(a, 9, b) - .5) * 13; if (cx * cx + cz * cz < 30 * 30 || cx * cx + (cz - 14) ** 2 < 26 * 26) continue;
        const key = (ix + i) * 4096 + (iz + j); let by = HILLS.get(key); if (by === undefined) { by = this.hill(cx, cz) - .4; HILLS.set(key, by); }
        const H = 7 + h3(a, 5, b) * 7, Rc = 5.5 + h3(a, 7, b) * 5, q = sqrt((x - cx) ** 2 + (z - cz) ** 2), bound = max(q - Rc - 2, y - by - H - 3); if (bound > 2.5) { U(bound, 2); continue; }
        const lx = (h3(a, 11, b) - .5) * 3, lz = (h3(a, 13, b) - .5) * 3, cty = by + H;
        U(cap(x, y, z, cx, by, cz, cx + lx, cty - .6, cz + lz, .34 + h3(a, 7, b) * .16), 3); U(cap(x, y, z, cx + lx * .5, by + H * .5, cz + lz * .5, cx + lx + 2.4, cty - .4, cz + lz + 1, .17), 3); U(cap(x, y, z, cx + lx * .5, by + H * .5, cz + lz * .5, cx + lx - 2.6, cty - .4, cz + lz - .8, .17), 3);
        const dx = x - cx - lx, dy = (y - cty) * 3.1 + .4, dz = z - cz - lz; U((sqrt(dx * dx + dy * dy + dz * dz) - Rc - 2.2 * (fbm(x * .4, y * 1.1, z * .4, 3) - .5)) * .33, 2);
      }
      // Granite outcrops.
      for (const [cx, cz, R] of [[-44, -40, 11], [-33, -48, 7.5], [-52, -29, 6], [46, 42, 9], [38, 50, 6]]) { const d = sqrt((x - cx) ** 2 + (y - R * .25) ** 2 + (z - cz) ** 2) - R; U(d > 4 ? d - 2 : d - 3.2 * (fbm(x * .16, y * .16, z * .16, 3) - .5) - .5 * fbm(x * .9, y * .9, z * .9, 2), 4); }
      return D;
    },
    material(m, x, y, z) {
      emit(0, 0, 0); SP = .03;
      if (m === 1) { const g = fbm(x * .06, y * .1, z * .06, 4), f = fbm(x * .6, y * .5, z * .6, 2); alb(mix(.22, .46, g), mix(.56, .76, g), mix(.1, .18, g)); const o = sstep(.55, .72, fbm(x * .05 + 8, 1, z * .05, 3)); lerpAlb(.1, .44, .12, o); const v = .78 + f * .44; AR *= v; AG *= v; AB *= v; bump(x, y, z, .7, .35, 3); }
      else if (m === 2) { const g = fbm(x * .5, y * .9, z * .5, 3); alb(mix(.03, .14, g), mix(.22, .46, g), mix(.06, .14, g)); bump(x, y, z, 1.6, .6, 3); }
      else if (m === 3) { alb(.1, .1, .1); bump(x, y * .3, z, 3, .25, 2); }
      else { const g = fbm(x * .3, y * .3, z * .3, 3); alb(mix(.36, .62, g), mix(.38, .64, g), mix(.38, .62, g)); const l = sstep(.58, .68, fbm(x * .9, y * .9, z * .9, 3)); lerpAlb(.3, .55, .2, l * .7); bump(x, y, z, .7, .5, 4); bump(x, y, z, 3, .1, 2); }
    },
    floor(x, z) {
      emit(0, 0, 0); NX = 0; NY = 1; NZ = 0; SP = .02;
      const g = fbm(x * .28, 0, z * .28, 4), ang = fbm(x * .07, 5, z * .07, 2) * 3, ca = cos(ang), sa = sin(ang), u = x * ca + z * sa, v = -x * sa + z * ca, blade = fbm(u * 11, 1, v * 2.2, 3); alb(mix(.2, .5, g), mix(.52, .78, g), mix(.08, .16, g)); const b = .62 + blade * .76; AR *= b; AG *= b; AB *= b;
      const soil = sstep(.52, .66, fbm(x * .13 + 9, 4, z * .13, 4)); lerpAlb(.08, .36, .1, soil * .9); bump(x, 0, z, 1.1, .3, 3); tilt((blade - .5) * .35, (blade - .5) * .2);
      worley(x * .85, z * .85); if (W1 < .24 && h3(floor(x * .85) & 255, 3, floor(z * .85) & 255) > .55 && soil < .5) { const k = 1 - W1 / .24; lerpAlb(.1, .3, .08, k * .55); tilt((blade - .5) * .6, 0); }
      worley(x * .5 + 9, z * .5); if (W1 < .06 && h3(floor(x * .5 + 9) & 255, 8, floor(z * .5) & 255) > .7) { alb(.5, .5, .5); tilt((W1 - .03) * 9, (W1 - .03) * 6); }
      // Wild flowers.
      worley(x * 2.3 + 3, z * 2.3); if (W1 < .1 && h3(floor(x * 2.3 + 3) & 255, 6, floor(z * 2.3) & 255) > .62) { const v = h3(floor(x * 2.3 + 3) & 255, 9, floor(z * 2.3) & 255); if (v < .5) alb(1, .85, .1); else if (v < .8) alb(1, 1, .92); else alb(.95, .25, .2); }
    },
  },

  // A cavern over a fire: black basalt split by red-hot seams, spikes of glowing ruby, cold light from far above.
  ember: {
    haze: [.045, .006, .008], fog: .005, mist: .3, ambient: [.07, .07, .09], ambientLow: [.04, .012, .012], exposure: 1.5, glow: [1, .22, .06], glowK: .3, glowGain: .016,
    lights: [{ p: [-12, 9, -27], c: [1, .14, .05], i: 170 }, { p: [18, 7, -22], c: [1, .12, .04], i: 130 }, { p: [0, 32, -3], c: [.72, .85, .95], i: 300 }, { p: [-29, 6, 3], c: [1, .16, .06], i: 60 }, { p: [10, 8, 34], c: [1, .14, .05], i: 120 }],
    sky() { return [.02, .004, .004]; },
    map(x, y, z) {
      D = 1e9; GL = 1e9;
      const cz = z + 14, r = sqrt(x * x * .68 + cz * cz + (y - 7) ** 2 * 1.25), dis = 16 * fbm(x * .038, y * .05, z * .038, 4) + 2.5 * fbm(x * .25, y * .25, z * .25, 2);
      U((43 - r + dis - 8) * .6, 1);
      // Hanging stone.
      const s = 9.5, ix = round(x / s), iz = round(z / s);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = ix + i & 255, b = iz + j & 255, cx = (ix + i) * s + (h3(a, 1, b) - .5) * 6, ccz = (iz + j) * s + (h3(a, 2, b) - .5) * 6, top = 34, len = 7 + h3(a, 4, b) ** 2 * 24; U(cone(x - cx, top - y, z - ccz, 1.2 + h3(a, 6, b) * 2.6, len) + .28 * fbm(x * .9, y * .4, z * .9, 2), 1); }
      // Crystal clusters. Each spike is a hex prism with a pointed tip.
      for (const [cx, cz2, sc] of [[-19, -28, 1.5], [15, -36, 1.05], [28, -24, 1.25], [-34, -12, 1.1], [-5, -43, .8], [35, -5, .85], [-26, 30, 1.2], [24, 36, 1.3]]) {
        for (let k = 0; k < 8; k++) {
          const ax = (h3(k * 3 & 255, 7, 9) - .5) * 1.4, az = (h3(k * 5 & 255, 8, 1) - .5) * 1.4, h = (6 + 12 * h3(k * 7 & 255, 4, 3)) * sc, w = (.5 + h3(k * 11 & 255, 2, 8) * .9) * sc, bx = cx + ax * 3.6 * sc, bz = cz2 + az * 3.6 * sc, py = y, px = x - bx - y * ax * .5, pz = z - bz - y * az * .5, hx = abs(px), hz = abs(pz), hex = max(hx * .866 + hz * .5, hz) - w * clamp((h - py) / (h * .22)), d = max(hex, py - h) * .75;
          U(d, 2); if (d < GL) GL = d;
        }
      }
      return D;
    },
    material(m, x, y, z) {
      emit(0, 0, 0); SP = .1;
      if (m === 1) { const g = fbm(x * .14, y * .28, z * .14, 4); alb(mix(.05, .14, g), mix(.05, .13, g), mix(.06, .15, g)); bump(x, y, z, .55, .55, 4); bump(x, y * 2, z, 3, .12, 2); const w = sstep(.56, .68, fbm(x * .24, y, z * .24, 3)); lerpAlb(.22, .22, .25, w * .6); }
      else { const v = fbm(x * .55, y * .22, z * .55, 3), band = sin(y * 1.9 + v * 6) * .5 + .5; alb(mix(.8, 1, v), mix(.08, .24, v), mix(.05, .12, v)); emit(.8 + band * .5, .06 + band * .16, .03 + band * .05); SP = 1.3; }
    },
    floor(x, z) {
      emit(0, 0, 0); NX = 0; NY = 1; NZ = 0; SP = .3;
      const g = fbm(x * .22, 2, z * .22, 5); alb(mix(.05, .17, g), mix(.05, .15, g), mix(.06, .18, g)); bump(x, 0, z, .75, .5, 4); bump(x, 0, z, 4, .08, 2);
      worley(x * .34 + fbm(x * .2, 8, z * .2, 3) * 1.4, z * .34); const e = W2 - W1; AR *= .35 + .65 * sstep(.02, .09, e); AG *= .35 + .65 * sstep(.02, .09, e); AB *= .35 + .65 * sstep(.02, .09, e);
      // Seams of crystal light that follow the cracks; damp stone catches reflections.
      const seam = sstep(.05, .012, e) * sstep(.34, .5, fbm(x * .07 + 40, 4, z * .07, 3)); if (seam > 0) { emit(seam * 2.4, seam * .55, seam * .06); }
      const wet = sstep(.55, .68, fbm(x * .14 + 12, 9, z * .14, 3)); SP += wet * 1.2; if (wet > 0) { NX *= 1 - wet; NZ *= 1 - wet; NY = sqrt(max(.01, 1 - NX * NX - NZ * NZ)); AR *= 1 - wet * .4; AG *= 1 - wet * .4; AB *= 1 - wet * .3; }
      // Scattered shards.
      worley(x * 1.1 + 5, z * 1.1); if (W1 < .085 && h3(floor(x * 1.1 + 5) & 255, 3, floor(z * 1.1) & 255) > .68) { alb(.9, .14, .08); emit(.8, .08, .04); SP = 1; tilt((W1 - .04) * 7, -(W1 - .04) * 5); }
    },
  },

  // A ship graveyard frozen into the sea: great black hulls, one with its ribs bare, on white ice under a cold sky.
  wrecks: {
    open: true,
    haze: [.78, .88, .9], fog: .0058, mist: .1, ambient: [.4, .47, .5], ambientLow: [.3, .38, .42], exposure: .92, glow: [1, .9, .6], glowK: .9, glowGain: 0,
    lights: [{ dir: [.42, .52, .6], c: [1.3, 1.26, 1.18], i: 1.45 }],
    sky(dx, dy, dz) { return daySky(dx, dy, dz, [.2, .44, .54], [.84, .94, .96], [1.45, 1.5, 1.5], [.6, .68, .72], [.46, .57, .66], .46); },
    hull(x, y, z, cx, cy, cz, rot, roll, L, B, H, cut) {
      const px = x - cx, py = y - cy, pz = z - cz, big = sqrt(px * px + py * py + pz * pz) - L - 3; if (big > 4) { U(big, 1); return; }
      const ca = cos(rot), sa = sin(rot), qx = px * ca + pz * sa, qz = -px * sa + pz * ca, cr = cos(roll), sr = sin(roll), rx = qx * cr + py * sr, ry = -qx * sr + py * cr;
      const taper = sqrt(max(.0001, 1 - (qz / L) ** 2)), w = B * taper * (.38 + .62 * sstep(-H, H * .3, ry)), outer = max(abs(rx) - w, abs(qz) - L, abs(ry) - H) * .72;
      if (qz > cut) { const shell = abs(outer) - .16, frames = abs(rep(qz, 3.2)) - .3; U(max(min(max(shell, frames), max(shell, abs(ry - H * .2) - .3), max(shell, ry + H * .55)), ry - H * .86, cut - qz), 1); }
      else { U(max(outer, qz - cut), 1); U(box(rx, ry - H - 1.6, qz + L * .45, B * .55, 2.2, L * .13), 1); }
    },
    map(x, y, z) {
      D = 1e9; GL = 1e9;
      const r = sqrt(x * x * .7 + z * z), fr = sqrt(x * x + z * z); if (fr < 40) U(ring(fr, y, 40), 2); else { const m = sstep(40, 90, r) * (3 + 13 * fbm(x * .03, 1, z * .03, 3)), far = sstep(110, 170, fr) * 14 * fbm(x * .02, 3, z * .02, 3); U((y - m - far) * .7, 2); }
      this.hull(x, y, z, -33, 6, -42, .55, .22, 27, 7, 9, 7); this.hull(x, y, z, 42, 7, -54, -.75, -.14, 33, 8.5, 12, 34); this.hull(x, y, z, -48, 5, 34, 1.15, -.3, 24, 6.5, 8, 2); this.hull(x, y, z, 50, 4, 30, .2, .18, 22, 6, 7, 30);
      // Scrap on a jittered grid.
      const s = 8.5, ix = round(x / s), iz = round(z / s);
      if (y < 12 && fr > 22) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const a = ix + i & 255, b = iz + j & 255, cx = (ix + i) * s + (h3(a, 1, b) - .5) * 5, cz = (iz + j) * s + (h3(a, 2, b) - .5) * 5, rc = sqrt(cx * cx + cz * cz); if (rc < 25 || h3(a, 6, b) < .55) continue;
        const rot = h3(a, 3, b) * 6.28, ro = (h3(a, 4, b) - .5) * 1.1, px = x - cx, py = y - .9, pz = z - cz, ca = cos(rot), sa = sin(rot), qx = px * ca + pz * sa, qz = -px * sa + pz * ca, cb = cos(ro), sb = sin(ro), rx = qx * cb + py * sb, ry = -qx * sb + py * cb, kind = h3(a, 5, b);
        if (kind < .5) U(max(sqrt(ry * ry + qz * qz) - 1.5, abs(rx) - 2.9), 3); else U(box(rx, ry, qz, 2.2, 1.1, 1.6), 3);
      }
      // A breaker's crane.
      const ly = rep(y, 3), ltx = abs(x - 22) - 2.2, ltz = abs(z + 44) - 2.2; if (y < 41) { U(sqrt(ltx * ltx + ltz * ltz) - .22, 4); U(max(box(x - 22, ly, z + 44, 2.2, .13, 2.2), -box(x - 22, ly, z + 44, 1.9, 1, 1.9)), 4); }
      U(cap(x, y, z, 22, 40, -44, -10, 36, -38, .55), 4); U(cap(x, y, z, 22, 40, -44, 30, 37, -46, .55), 4); U(cap(x, y, z, -9, 36, -38, -9, 17, -38, .05), 4);
      return D;
    },
    material(m, x, y, z) {
      emit(0, 0, 0); SP = .12;
      if (m === 1) { const line = sstep(5.5, 7.5, y + 2 * fbm(x * .1, 2, z * .1, 2)); alb(mix(.72, .06, line), mix(.08, .07, line), mix(.06, .09, line)); panels(x, y, z, 5, .05); rust(x, y, z, .28); const streak = sstep(.5, .7, fbm(x * .9, y * .07, z * .9, 3)); lerpAlb(.12, .13, .15, streak * .6); grime(x, y, z, .35); bump(x, y, z, 1.6, .1, 2); }
      else if (m === 2) { const g = fbm(x * .1, y * .3, z * .1, 3); alb(mix(.66, .92, g), mix(.72, .95, g), mix(.76, .98, g)); bump(x, y, z, .7, .4, 3); }
      else if (m === 3) { alb(.09, .1, .12); rust(x, y, z, .3); grime(x, y, z, .4); SP = .3; bump(x, y, z, 2.2, .12, 2); }
      else { alb(.95, .7, .05); grime(x, y, z, .4); SP = .3; }
    },
    floor(x, z) {
      emit(0, 0, 0); NX = 0; NY = 1; NZ = 0; SP = .05;
      const g = fbm(x * .2, 0, z * .2, 5), f2 = fbm(x * 2.6, 2, z * 2.6, 3); alb(mix(.68, .9, g), mix(.74, .94, g), mix(.78, .97, g)); const v = .86 + f2 * .24; AR *= v; AG *= v; AB *= v; bump(x, 0, z, 1.1, .24, 4);
      // Ripples left by the tide, and pools holding the sky.
      const ph = x * .6 + z * 2.3 + fbm(x * .1, 1, z * .1, 3) * 14, rip = sin(ph); tilt(cos(ph) * .1, cos(ph) * .22); AR *= 1 + rip * .07; AG *= 1 + rip * .07; AB *= 1 + rip * .07;
      const wet = sstep(.56, .62, fbm(x * .1 + 30, 1, z * .1, 4) + rip * .012); if (wet > 0) { const d = sstep(.62, .75, fbm(x * .1 + 30, 1, z * .1, 4)); alb(mix(.2, .05, d), mix(.42, .3, d), mix(.46, .36, d)); AR *= 1; emit(wet * (.06 + d * .02), wet * (.28 + d * .08), wet * (.3 + d * .1)); NX *= 1 - wet; NZ *= 1 - wet; NY = sqrt(max(.01, 1 - NX * NX - NZ * NZ)); SP = wet * 1.6; }
      // Bits of plate and rivets of rust.
      const s = 6.5, ix = round(x / s), iz = round(z / s), px = x - ix * s, pz = z - iz * s, rot = h3(ix & 255, 4, iz & 255) * 6.28, qx = px * cos(rot) + pz * sin(rot), qz = -px * sin(rot) + pz * cos(rot); if (h3(ix & 255, 2, iz & 255) > .68 && wet < .3) { const w = .8 + h3(ix & 255, 7, iz & 255) * .9 + (fbm(x * .9, 8, z * .9, 2) - .5) * .9; if (abs(qx) < w && abs(qz) < w * .7) { alb(.08, .09, .11); rust(x, 0, z, .3); SP = .2; NX *= .4; NZ *= .4; if (abs(rep(qx, .7)) < .02) { AR *= .4; AG *= .4; AB *= .4; } } }
    },
  },
};

// ---- Renderer
const BACK_TOP = .8, BACK_BOTTOM = -.5, BACK_SPAN = 2 * PI, EYE = [0, 2.8, 14];
let P = null;
const mp = (x, y, z) => P.map(x, y, z);
function normalAt(x, y, z, e) {
  const a = mp(x + e, y - e, z - e), b = mp(x - e, y - e, z + e), c = mp(x - e, y + e, z - e), d = mp(x + e, y + e, z + e), nx = a - b - c + d, ny = -a - b + c + d, nz = -a + b - c + d, l = sqrt(nx * nx + ny * ny + nz * nz) || 1; NX = nx / l; NY = ny / l; NZ = nz / l;
}
// The penumbra stops widening at PENUMBRA: far out, a bounding volume's distance would pass for a near miss and draw rings and cell edges on the floor.
const PENUMBRA = 20;
function shadow(x, y, z, dx, dy, dz, tmax, k = 14) { let s = 1, t = .08; for (let i = 0; i < 32 && t < tmax; i++) { const d = mp(x + dx * t, y + dy * t, z + dz * t); if (d < .004) return 0; s = min(s, k * d / min(t, PENUMBRA)); t += clamp(d, .05, 6); } return s; }
function ao(x, y, z, nx, ny, nz) { let o = 0, w = 1; for (let i = 1; i <= 5; i++) { const h = .2 * i * i * .55, d = mp(x + nx * h, y + ny * h, z + nz * h); o += w * (h - d); w *= .62; } return clamp(1 - o * .42); }
const out = [0, 0, 0];
function light(px, py, pz, vx, vy, vz, occl) {
  // Uses material results A*, E*, SP and normal N*.
  const nx = NX, ny = NY, nz = NZ, ar = AR, ag = AG, ab = AB, er = ER, eg = EG, eb = EB, sp = SP, up = .5 + .5 * ny, L = P.ambient, Lo = P.ambientLow;
  let r = (Lo[0] + (L[0] - Lo[0]) * up) * occl, g = (Lo[1] + (L[1] - Lo[1]) * up) * occl, b = (Lo[2] + (L[2] - Lo[2]) * up) * occl, sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < P.lights.length; i++) {
    const l = P.lights[i]; let lx, ly, lz, att = l.i, far = 90;
    if (l.dir) { const q = sqrt(l.dir[0] ** 2 + l.dir[1] ** 2 + l.dir[2] ** 2); lx = l.dir[0] / q; ly = l.dir[1] / q; lz = l.dir[2] / q; }
    else { const dx = l.p[0] - px, dy = l.p[1] - py, dz = l.p[2] - pz, q = dx * dx + dy * dy + dz * dz, dl = sqrt(q); lx = dx / dl; ly = dy / dl; lz = dz / dl; att = l.i / (q + 6); far = dl; }
    const nl = nx * lx + ny * ly + nz * lz; if (nl <= 0 || att < .004) continue;
    const s = l.noShadow ? 1 : shadow(px + nx * .03, py + ny * .03, pz + nz * .03, lx, ly, lz, far); if (s <= 0) continue;
    const c = l.c, k = att * nl * s; r += c[0] * k; g += c[1] * k; b += c[2] * k;
    if (sp > 0) { const hx = lx + vx, hy = ly + vy, hz = lz + vz, hl = sqrt(hx * hx + hy * hy + hz * hz) || 1, h = max(0, (nx * hx + ny * hy + nz * hz) / hl), q = pow(h, 34) * sp * att * s * .5; sr += c[0] * q; sg += c[1] * q; sb += c[2] * q; }
  }
  out[0] = ar * r + sr + er; out[1] = ag * g + sg + eg; out[2] = ab * b + sb + eb;
}
function shafts(ox, oy, oz, dx, dy, dz, t, jit) {
  const S = P.shafts, q = sqrt(S.dir[0] ** 2 + S.dir[1] ** 2 + S.dir[2] ** 2), lx = S.dir[0] / q, ly = S.dir[1] / q, lz = S.dir[2] / q, n = 11, end = min(t, 62); let acc = 0;
  for (let i = 0; i < n; i++) { const u = (i + jit) / n * end, x = ox + dx * u, y = oy + dy * u, z = oz + dz * u; let vis = 1, s = .4; for (let k = 0; k < 13; k++) { const d = mp(x + lx * s, y + ly * s, z + lz * s); if (d < .01) { vis = 0; break; } s += clamp(d, .3, 11); if (s > 75) break; } acc += vis * exp(-u * .02); }
  return acc / n * S.k;
}
function ray(ox, oy, oz, dx, dy, dz, jit, res) {
  let t = .05, hit = false, glow = 0; const g = P.glowGain, k = P.glowK;
  const plane = dy < -.0001 ? -oy / dy : 1e9, tMax = min(plane, 190);
  for (let i = 0; i < 220 && t < tMax; i++) { const d = mp(ox + dx * t, oy + dy * t, oz + dz * t); if (g > 0 && GL < 1e8) glow += min(d, 3) * g / (1 + (GL * k) ** 2); if (d < .0012 * t + .001) { hit = true; break; } t += d * .92; }
  let r, gg, b;
  const fh = P.haze;
  if (hit) {
    const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t, m = M, e = max(.003, t * .0009); normalAt(x, y, z, e); const nx0 = NX, ny0 = NY, nz0 = NZ;
    const oc = ao(x, y, z, nx0, ny0, nz0); NX = nx0; NY = ny0; NZ = nz0; P.material(m, x, y, z);
    light(x, y, z, -dx, -dy, -dz, oc); r = out[0]; gg = out[1]; b = out[2];
    // Haze: thicker with distance and low down, so everything stands in the mist that the floor fades into.
    const low = sstep(3, .1, y), f = max(1 - exp(-t * P.fog), low * (P.mist ?? .5)); r = mix(r, fh[0], f); gg = mix(gg, fh[1], f); b = mix(b, fh[2], f);
  } else if (plane < 190) {
    t = plane; const x = ox + dx * t, z = oz + dz * t; P.floor(x, z); const nx = NX, ny = NY, nz = NZ, ar = AR, ag = AG, ab = AB, er = ER, eg = EG, eb = EB, sp = SP, oc = ao(x, 0, z, 0, 1, 0);
    NX = nx; NY = ny; NZ = nz; AR = ar; AG = ag; AB = ab; ER = er; EG = eg; EB = eb; SP = sp; light(x, .001, z, -dx, -dy, -dz, oc); const f = 1 - exp(-t * P.fog); r = mix(out[0], fh[0], f); gg = mix(out[1], fh[1], f); b = mix(out[2], fh[2], f);
  }
  else { const s = P.sky(dx, dy, dz), f = sstep(.05, .0, dy); r = mix(s[0], fh[0], f); gg = mix(s[1], fh[1], f); b = mix(s[2], fh[2], f); t = 190; }
  const gc = P.glow; r += gc[0] * glow; gg += gc[1] * glow; b += gc[2] * glow;
  if (P.shafts) { const a = shafts(ox, oy, oz, dx, dy, dz, t, jit); r += P.shafts.c[0] * a; gg += P.shafts.c[1] * a; b += P.shafts.c[2] * a; }
  res[0] = r; res[1] = gg; res[2] = b;
}
const tone = v => { const c = 1 - exp(-v * P.exposure); return pow(clamp(c), 1 / 2.2); };
const ign = (x, y) => { const v = (.06711056 * x + .00583715 * y) % 1; return (52.9829189 * v) % 1; };
function backdropRow(j, w, h, spp) {
  const row = new Float32Array(w * 3), res = [0, 0, 0];
  for (let i = 0; i < w; i++) {
    let r = 0, g = 0, b = 0;
    for (let s = 0; s < spp; s++) {
      const u = (i + (spp > 1 ? (s + .5) / spp : .5)) / w, v = (j + (s * 2 + 1) % spp / spp + (spp === 1 ? .5 : 0)) / h, th = (u - .5) * BACK_SPAN, tp = mix(BACK_TOP, BACK_BOTTOM, v), dx0 = sin(th), dz0 = -cos(th), l = sqrt(1 + tp * tp), dx = dx0 / l, dy = tp / l, dz = dz0 / l;
      ray(EYE[0], EYE[1], EYE[2], dx, dy, dz, ign(i + s * 3, j), res); r += res[0]; g += res[1]; b += res[2];
    }
    row[i * 3] = tone(r / spp); row[i * 3 + 1] = tone(g / spp); row[i * 3 + 2] = tone(b / spp);
  }
  return row;
}
const FLOOR_R = 26;
function floorRow(j, w, h, spp) {
  const row = new Float32Array(w * 3), fh = P.haze;
  for (let i = 0; i < w; i++) {
    let r = 0, g = 0, b = 0;
    for (let s = 0; s < spp; s++) {
      const x = ((i + (s + .5) / spp) / w - .5) * FLOOR_R * 2, z = ((j + ((s * 2 + 1) % spp) / spp) / h - .5) * FLOOR_R * 2;
      P.floor(x, z); const nx = NX, ny = NY, nz = NZ, ar = AR, ag = AG, ab = AB, er = ER, eg = EG, eb = EB, sp = SP;
      const vx0 = 0 - x, vy0 = 2.8, vz0 = 14 - z, vl = sqrt(vx0 * vx0 + vy0 * vy0 + vz0 * vz0), oc = ao(x, 0, z, 0, 1, 0);
      NX = nx; NY = ny; NZ = nz; AR = ar; AG = ag; AB = ab; ER = er; EG = eg; EB = eb; SP = sp;
      // Under a trunk or a rock the ground is only in deep shade: the floor plate's rim shows through as earth, not as a black hole.
      if (!P.open && mp(x, .05, z) < .02) { const L = P.ambient; out[0] = ar * L[0] * .5 + er; out[1] = ag * L[1] * .5 + eg; out[2] = ab * L[2] * .5 + eb; }
      else light(x, .001, z, vx0 / vl, vy0 / vl, vz0 / vl, oc);
      const f = 1 - exp(-vl * P.fog);
      r += mix(out[0], fh[0], f); g += mix(out[1], fh[1], f); b += mix(out[2], fh[2], f);
    }
    row[i * 3] = tone(r / spp); row[i * 3 + 1] = tone(g / spp); row[i * 3 + 2] = tone(b / spp);
  }
  return row;
}

if (!isMainThread) {
  parentPort.on('message', ({ name, kind, j, w, h, spp }) => { P = PLACES[name]; const row = kind === 'back' ? backdropRow(j, w, h, spp) : floorRow(j, w, h, spp); parentPort.postMessage({ j, row }, [row.buffer]); });
} else {
  const dir = process.argv[2].replace(/\/?$/, '/'), arg = process.argv[3] || 'all', scale = +(process.argv[4] || 1), names = arg === 'all' ? Object.keys(PLACES) : arg.split(',');
  mkdirSync(dir, { recursive: true });
  const workers = Array.from({ length: Math.max(1, availableParallelism() - 1) }, () => new Worker(fileURLToPath(import.meta.url)));
  const bake = (name, kind, w, h, spp) => new Promise(done => {
    const buf = new Uint8Array(w * h * 3); let next = 0, left = h;
    const started = Date.now();
    for (const wk of workers) {
      const give = () => { if (next < h) wk.postMessage({ name, kind, j: next++, w, h, spp }); };
      wk.removeAllListeners('message');
      wk.on('message', ({ j, row }) => { for (let i = 0; i < row.length; i++) buf[j * w * 3 + i] = clamp(row[i]) * 255; left--; if (left === 0) { writeFileSync(`${dir}${name}-${kind}.ppm`, Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`), Buffer.from(buf)])); console.log(name, kind, `${w}x${h}`, ((Date.now() - started) / 1000).toFixed(0) + 's'); done(); } else give(); });
      give();
    }
  });
  for (const name of names) {
    await bake(name, 'back', Math.round(4096 * scale), Math.round(848 * scale), scale >= 1 ? 2 : 1);
    await bake(name, 'floor', Math.round(1536 * scale), Math.round(1536 * scale), scale >= 1 ? 2 : 1);
  }
  await Promise.all(workers.map(w => w.terminate()));
}
