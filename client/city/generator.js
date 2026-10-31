// Everything in the city, built voxel by voxel from a session's look. Colours outside the palette are snapped to it when baked. Pure.
import { hex } from './palette.js';
import { Stack } from './stack.js';
import { fnv } from './identity.js';

export const STOREY = 3;
const LAMPS = { lit: .4, dim: .18, dark: 0 };
const mul = (c, k) => c.map(v => v * k), mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const glow = c => Object.assign(hex(c), { unlit: true });
const hash = (a, b = 0, c = 0) => { let h = Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// One row of windows is one storey, so a tower's floors can be counted. Lamps only ever change the windows.
const skin = (t, lamp, seed, phase = 0) => {
  const wall = hex(t.colour), edge = mix(wall, [253, 203, 176], .34), ledge = mix(wall, [253, 203, 176], .18), base = mix(mul(wall, .5), [46, 34, 47], .5), glass = mix(mul(wall, .25), [50, 51, 83], .75), tint = mix(wall, [77, 101, 180], .62), warm = glow('#fbff86'), trim = hex(t.trim);
  // Half the lamps never change. The others take turns, so that a working tower's lights go on and off a few at a time.
  const on = (u, v, g = glass) => { const n = fnv(`${u},${v},${seed}`), other = n >>> 31 && (phase % 4 - (n >>> 29 & 3) + 4) % 4 >= 2; return (other ? n >>> 14 : n >>> 4) % 1000 / 1000 < lamp ? warm : g; };
  return (x, y, z, face, corner) => {
    if (face === 'top') return hex(t.roof);
    if (corner) return edge;
    const U = (face === 'x' ? z : x) + 64, v = Math.floor(y / STOREY), b = y % STOREY;
    if (y === STOREY) return trim;
    if (y < STOREY) return U % 4 === 0 ? base : on(Math.floor(U / 4), 0, mix(glass, [90, 130, 160], .3));
    switch (t.windows) {
      case 'strips': return b === 1 ? on(Math.floor(U / 5), v) : !b ? ledge : wall;
      case 'fins': return U % 6 < 2 && b ? on(Math.floor(U / 6), v) : U % 6 === 3 || U % 6 === 4 ? ledge : wall; // Details are two voxels wide: 2:1 sampling lands on every other voxel along a wall.
      case 'wide': return b === 1 && U % 6 > 1 ? on(Math.floor(U / 6), v) : wall;
      case 'curtain': return !b ? ledge : U % 5 ? on(Math.floor(U / 5), v, tint) : wall;
      default: return b && U % 5 > 2 ? on(Math.floor(U / 5), v) : wall;
    }
  };
};

// `windows` is 'lit' | 'dim' | 'dark'; `phase` (0 to 3) picks which lamps are on and how the crown's moving part stands. Without power nothing moves.
export function buildTower(t, windows, storeys = 8, phase = 0) {
  const { w } = t, h = Math.max(4, storeys) * STOREY, room = w + 12, S = new Stack(room, room, h + 30), active = windows !== 'dark', beat = active ? phase % 4 : 0, K = skin(t, LAMPS[windows] ?? 0, fnv(t.id) % 1000, phase), trim = hex(t.trim), roof = hex(t.roof);
  // A cornice: a trim ring with the roof set inside it.
  const band = (x, y, z, W, D) => S.box(x, y, z, W + 2, 1, D + 2, (X, Y, Z, f) => f === 'top' && Math.abs(X + .5 - x) < W / 2 && Math.abs(Z + .5 - z) < D / 2 ? roof : trim);
  let top = h, cx = 0, cw = w;
  S.box(0, 0, 0, w + 2, 1, w + 2, hex('#9babb2'));
  if (t.mass === 'slab') { const D = Math.round(w * .76); S.box(0, 1, 0, w, h, D, K); band(0, h + 1, 0, w, D); cw = D; top = h + 2; }
  if (t.mass === 'stepped') { const a = Math.round(h * .46 / 3) * 3, b = Math.round(h * .32 / 3) * 3, c = h - a - b, w2 = Math.round(w * .76), w3 = Math.round(w * .54); S.box(0, 1, 0, w, a, w, K); band(0, a + 1, 0, w, w); S.box(0, a + 2, 0, w2, b, w2, K); band(0, a + b + 2, 0, w2, w2); S.box(0, a + b + 3, 0, w3, c, w3, K); band(0, h + 3, 0, w3, w3); top = h + 4; cw = w3; }
  if (t.mass === 'twin') { const o = Math.round(w * .28), s = Math.round(w * .46), short = Math.round(h * .78 / 3) * 3; S.box(0, 1, 0, w, 6, Math.round(w * .7), K); S.box(-o, 7, 0, s, h - 6, s, K); S.box(o, 7, 0, s, short - 6, s, K); band(-o, h + 1, 0, s, s); band(o, short + 1, 0, s, s); cx = -o; cw = s; top = h + 2; }
  if (t.mass === 'podium') { const s = Math.round(w * .62); S.box(0, 1, 0, w, 9, w, K); band(0, 10, 0, w, w); S.box(0, 11, 0, s, h - 10, s, K); band(0, h + 1, 0, s, s); cw = s; top = h + 2; }
  if (t.mass === 'notched') { const s = Math.round(w * .64), b = Math.round(h * .62 / 3) * 3, ow = Math.round(w * .4), od = Math.round(w * .6), ox = Math.round(w * .32), oz = -Math.round(w * .1); cx = -Math.round(w * .18); S.box(cx, 1, 0, s, h, Math.round(w * .8), K); S.box(ox, 1, oz, ow, b, od, K); band(ox, b + 1, oz, ow, od); band(cx, h + 1, 0, s, Math.round(w * .8)); cw = s; top = h + 2; }
  const bright = c => active ? glow(c) : hex('#6a6e7c'), wall = hex(t.colour), y = top;
  // A crown with no moving part blinks a lamp at its tip.
  const tip = () => { if (beat % 2) S.box(cx, y + up, 0, 2, 1, 2, glow('#ea4f36')); };
  let up = 0;
  switch (t.crown) {
    case 'Spire': S.pyr(cx, y, 0, Math.max(3, cw * .32), 16, wall); up = 15; tip(); up = 16; break;
    case 'Mast': for (let i = 0; i < 15; i++) S.box(cx, y + i, 0, 2, 1, 2, Math.floor(i / 3) % 2 ? hex('#fdcbb0') : hex('#e83b3b')); S.box(cx, y + 15, 0, 3, 2, 3, beat % 2 ? hex('#7a3045') : bright('#ea4f36')); up = 17; break;
    case 'Dish': { S.box(cx, y, 0, 2, 5, 2, hex('#7f8498')); const yaw = [0, .22, 0, -.22][beat], a = [.56 * Math.cos(yaw) - .55 * Math.sin(yaw), .62, .56 * Math.sin(yaw) + .55 * Math.cos(yaw)], l = Math.hypot(...a), A = a.map(v => v / l), rim = hex('#f6f8fb'), bowl = hex('#a8b4c8'), o = [cx, y + 7, 0]; S.shape(-10, 11, y + 1, y + 16, -10, 11, (X, Y, Z) => { const q = [X - o[0], Y - o[1], Z - o[2]], ax = q[0] * A[0] + q[1] * A[1] + q[2] * A[2], r2 = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] - ax * ax; return r2 < 40 && Math.abs(ax - r2 / 22) < 1 ? (r2 > 22 ? rim : bowl) : null; }); for (let i = 1; i < 6; i++) S.put(cx + A[0] * i, y + 7 + A[1] * i, A[2] * i, hex('#3a4058')); up = 14; break; }
    case 'Helipad': { const P = cw + 2, yel = beat % 2 ? hex('#f9c22b') : glow('#f9c22b'), grey = hex('#7f8498'); S.box(cx, y, 0, P, 1, P, (X, Y, Z, f) => { if (f !== 'top') return grey; const a = X - cx + .5, b = Z + .5; return (Math.abs(b) < 1 && Math.abs(a) < 3) || (Math.abs(Math.abs(a) - 2.5) < 1 && Math.abs(b) < 3.6) ? yel : grey; }); up = 2; break; }
    case 'Tank': { for (const [a, b] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) S.line([cx + a, y, b], [cx + a * .8, y + 3, b * .8], hex('#625565')); for (let i = 0; i < 6; i++) S.cyl(cx, y + 3 + i, 0, 4.6, 1, hex(i % 3 === 2 ? '#694f62' : '#ab947a')); S.cyl(cx, y + 9, 0, 5.2, 4, hex('#9e4539'), .4); up = 13; tip(); break; }
    case 'Pyramid': S.pyr(cx, y, 0, Math.max(4, cw * .56), 9, hex(t.roof)); up = 9; tip(); break;
    case 'Clock': { const s = Math.min(11, Math.max(8, Math.round(cw * .8))), face = active ? glow('#fbff86') : hex('#9c9a8c'), ink = hex('#222222'), [dx, dy] = [[0, 1], [1, 0], [0, -1], [-1, 0]][beat]; S.box(cx, y, 0, s, s, s, (X, Y, Z, f) => { if (f === 'top' || f === 'in') return wall; const u = (f === 'x' ? Z : X - cx) + .5, q = Y - y - s / 2 + .5; if (Math.abs(u) > s / 2 - 1.5 || Math.abs(q) > s / 2 - 1.5) return wall; const along = u * dx + q * dy; return Math.abs(u * dy - q * dx) < 1 && along > -1 && along < 2.5 ? ink : face; }); S.pyr(cx, y + s, 0, s * .6, 4, hex(t.roof)); up = s + 4; break; }
    case 'Dome': { const r = Math.max(4, cw * .44), white = hex('#eef1f6'); S.shape(-10, 11, y, y + 11, -10, 11, (X, Y, Z) => Math.hypot(X - cx + .5, Y - y + .5, Z + .5) <= r ? white : null); up = Math.ceil(r); tip(); break; }
    case 'Ring': { const r = 5, plain = active ? glow('#8ff8e2') : hex('#6d7682'), bright2 = active ? glow('#ffffff') : plain; for (let i = 0; i < 80; i++) { const q = i / 80 * Math.PI * 2, a = Math.cos(q) * r * .72, c = Math.floor(i / 20) === beat ? bright2 : plain; S.put(cx + a, y + r + 1 + Math.sin(q) * r * 1.1, -a, c); S.put(cx + a + 1, y + r + 1 + Math.sin(q) * r * 1.1, -a, c); } S.box(cx, y, 0, 2, 2, 2, hex('#6d7682')); up = 12; break; }
    case 'Flag': { S.box(cx, y, 0, 1, 13, 1, hex('#d0d4dc')); for (let i = 0; i < 7; i++) for (let j = 0; j < 5; j++) S.put(cx + 1 + i, y + 8 + j - ((i + beat) % 4 > 1 ? 1 : 0), 0, wall); up = 13; break; }
  }
  return { stack: S.bake(), top: top + up, cx };
}

// A subagent: a small building beside its parent, same colour and windows, no crown.
export function annex(t, i, windows, storeys = 2 + fnv(`f:${t.id}:${i}`) % 3, phase = 0) {
  const n = fnv(`${t.id}:${i}`), W = 7 + n % 2, D = 7 + (n >> 3) % 2, H = storeys * STOREY, S = new Stack(12, 12, H + 3), K = skin({ ...t, windows: t.windows === 'fins' ? 'wide' : t.windows }, LAMPS[windows] ?? 0, n % 1000, phase), trim = hex(t.trim), roof = hex(t.roof);
  S.box(0, 0, 0, W, H, D, K); S.box(0, H, 0, W + 1, 1, D + 1, (X, Y, Z, f) => f === 'top' && Math.abs(X + .5) < W / 2 - .5 && Math.abs(Z + .5) < D / 2 - .5 ? roof : trim);
  return { stack: S.bake(), top: H + 2 };
}

// Green is the accent: a chunky round tree.
export function tree(seed) {
  const S = new Stack(10, 10, 11), g = hex(hash(seed, 1) > .5 ? '#239063' : '#1ebc73'), r = 3.2 + hash(seed, 2);
  S.box(0, 0, 0, 2, 3, 2, hex('#694f62'));
  S.shape(-5, 5, 2, 10, -5, 5, (X, Y, Z) => Math.hypot(X + .5, (Y - 5.5) * 1.05, Z + .5) <= r ? g : null);
  return S.bake();
}
export function fountain() {
  const S = new Stack(14, 14, 6);
  S.cyl(0, 0, 0, 6, 1, hex('#9babb2')); S.cyl(0, 1, 0, 5, 1, hex('#0b8a8f')); S.cyl(0, 1, 0, 1.2, 4, hex('#c7dcd0'));
  return S.bake();
}
// A street lamp. Only ever one stack, so all of them share a sprite.
let streetLamp = null;
export function lamp() {
  if (streetLamp) return streetLamp;
  const S = new Stack(4, 4, 9);
  S.box(0, 0, 0, 1, 7, 1, hex('#3e3546')); S.box(0, 7, 0, 2, 2, 2, glow('#fbff86'));
  return streetLamp = S.bake();
}
// `along` lays a car along the world's x axis, otherwise along z.
export function car(colour, along) {
  const S = new Stack(10, 10, 4);
  S.box(0, 0, 0, along ? 6 : 3, 2, along ? 3 : 6, hex(colour)); S.box(0, 2, 0, along ? 3 : 2, 1, along ? 2 : 3, hex('#2e222f'));
  return S.bake();
}

// Compacting: the top storeys come off in a cloud of dust.
export function dust(w) {
  const R = Math.ceil(w / 2) + 6, S = new Stack(R * 2, R * 2, 16), c = [hex('#f6f0e0'), hex('#dcd5c6')];
  for (let i = 0; i < 8; i++) { const a = i * 2.4, q = i ? R * .52 : 0, r = 3 + hash(i, 12) * 2.4, X = Math.cos(a) * q, Z = Math.sin(a) * q, Y = 4 + hash(i, 13) * 6; S.shape(-R, R, 0, 16, -R, R, (x, y, z) => Math.hypot(x - X, (y - Y) * 1.2, z - Z) <= r ? c[i % 2] : null); }
  return S.bake();
}
export function crane(on) {
  const S = new Stack(34, 8, 36), y = hex(on ? '#f9c22b' : '#8d7a3c');
  S.box(-9, 0, 0, 2, 30, 2, (X, Y) => Y % 4 < 2 ? y : mul(y, .7)); S.box(-3, 30, 0, 26, 1, 2, y); S.box(-15, 28, 0, 4, 3, 3, hex('#4a4e60'));
  S.box(9, 17, 0, 2, 13, 2, hex('#2b3040')); S.box(9, 14, 0, 3, 3, 2, hex('#776644'));
  return S.bake();
}
// The crane beside a working tower, reaching over it. Only the jib turns, about the top of the mast, so a beat changes nothing below it. `mast` keeps it just above what it's building.
// Everything on it is two voxels thick: a screen pixel samples one point, and a part one voxel thick can fall between the samples in a view or at an angle, and be gone.
export const JIB_BEATS = 8;
// It moves round the tower as the city turns, always to its right on screen: anywhere else it would stand in front of it or behind it.
const CRANE_AT = 20, CRANE_SIDES = [[1, -1], [-1, -1], [-1, 1], [1, 1]];
export const craneSpot = view => CRANE_SIDES[view].map(side => side * CRANE_AT);
export function siteCrane(beat, mast = 30, view = 0) {
  const R = 26, S = new Stack(R * 2, R * 2, mast + 6), steel = hex('#fb6b1d'), dark = hex('#2e222f'), yaw = Math.PI * (.75 - view / 2) + Math.sin(beat / JIB_BEATS * Math.PI * 2) * .5, cos = Math.cos(yaw), sin = Math.sin(yaw);
  S.box(0, 0, 0, 3, 1, 3, dark);
  S.box(0, 1, 0, 2, mast - 1, 2, (X, Y) => Y % 2 ? steel : mul(steel, .7));
  S.box(0, mast, 0, 2, 2, 2, hex('#2b3040'));
  for (let along = -6; along <= 24; along += .5) S.box(along * cos, mast + 1, along * sin, 2, 1, 2, steel);
  S.box(-6 * cos, mast, -6 * sin, 3, 1, 3, dark);
  S.box(18 * cos, mast - 8, 18 * sin, 2, 9, 2, dark);
  S.box(18 * cos, mast - 10, 18 * sin, 3, 2, 2, hex('#776644'));
  return { stack: S.bake() };
}
// Rising steam. Everything goes by where a puff is, not which one it is, so that after four phases the next has taken its place unseen.
const PUFFS = 5;
const puffs = (S, x, y, z, seed, phase) => { const c = [hex('#f6f0e0'), hex('#e0dccf')]; for (let i = 0; i < PUFFS; i++) { const a = (i + phase % 4 / 4) / PUFFS, r = 1.4 + a * 2, X = x + a * 5, Y = y + a * 13, Z = z + Math.sin(a * 9 + seed), colour = c[Math.floor(a * 2)]; S.shape(Math.floor(X - r), Math.ceil(X + r), Math.floor(Y - r), Math.ceil(Y + r), Math.floor(Z - r), Math.ceil(Z + r), (p, q, u) => Math.hypot(p - X, q - Y, u - Z) <= r ? colour : null); } };
// Two cooling towers. Their stripe and steam show the Claude limit.
// `lit` while the agent is connected: stripes glow whether or not reduced motion took the steam away.
export function coolingPlant(stripe, steam = true, lit = steam, phase = 0) {
  const S = new Stack(36, 26, 50), c = hex('#9babb2'), st = lit ? glow(stripe) : hex(stripe);
  S.box(0, 0, 0, 30, 1, 20, hex('#9babb2'));
  for (const x of [-7, 7]) { for (let y = 0; y < 24; y++) { const a = y / 23, r = 6.6 - 3 * Math.sin(a * Math.PI * .72); S.cyl(x, y + 1, 0, r, 1, y > 16 && y < 21 ? st : c); } S.cyl(x, 25, 0, 3, 1, hex('#2b3040')); if (steam) puffs(S, x, 28, 0, x + 40, phase); }
  return S.bake();
}
// A turbine hall and two striped stacks for the Codex limit.
export function stackPlant(stripe, steam = true, lit = steam, phase = 0) {
  const S = new Stack(36, 26, 54), g = hex('#9aa0b4'), st = hex(stripe), band = lit ? glow(stripe) : st;
  S.box(0, 0, 0, 30, 1, 20, hex('#9babb2'));
  S.box(0, 1, 2, 24, 9, 13, (X, Y, Z, f) => f === 'top' ? st : Y % 3 === 0 ? mul(g, .85) : g);
  for (const x of [-7, 5]) { for (let y = 0; y < 28; y++) S.cyl(x, y + 1, -7, 2.4, 1, Math.floor(y / 5) % 2 ? hex('#fdcbb0') : band); if (steam) puffs(S, x, 31, -7, x + 80, phase); }
  return S.bake();
}
