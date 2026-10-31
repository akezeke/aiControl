// The ground the city stands on: every road, parcel and lot in a flat grid of cells, baked once per view. Pure.
import { hex, nearest } from './palette.js';
import { fnv } from './identity.js';
import { fountain, car, tree, lamp } from './generator.js';
import { LOT, PLOT, ROAD, WALK, PLANT, unproject, screen } from './plan.js';
import { SHADOW } from './sprite.js';

const C = Object.fromEntries(Object.entries({ block: '#484a77', road: '#3e3546', walk: '#966c6c', dash: '#9babb2', zebra: '#c7dcd0', shadow: '#2e222f',
  trail: '#ab947a', water: '#0b5e65', water2: '#0b8a8f', paving: '#966c6c', paving2: '#ab947a', court: '#a24b6f', line: '#c7dcd0', tarmac: '#3e3546', sea: '#0b5e65', ripple: '#0b8a8f', foam: '#8ff8e2', sand: '#ab947a', flower: '#fbb954', stake: '#c7dcd0', bush: '#239063', bud: '#1ebc73' }).map(([k, v]) => [k, hex(v)]));
// The land goes by the viewer's clock, sage by day and dusk blue by night, so the lit windows have the dark to glow against once it's dark out.
const DAWN = 7, DUSK = 18;
export const timeOfDay = (date = new Date()) => { const hour = date.getHours(); return hour >= DAWN && hour < DUSK ? 'day' : 'night'; };
const SOILS = { day: { land: hex('#4b7058'), land2: hex('#547e64'), tuft: hex('#92a984') }, night: { land: hex('#323353'), land2: hex('#3a3a60'), tuft: hex('#484a77') } };
export const soilOf = time => SOILS[time];
const MARGIN = 180, ROADW = ROAD + WALK * 2, DARK = .7, INSET = 2, CARS = ['#e83b3b', '#4d9be6', '#f9c22b', '#c7dcd0', '#0eaf9b'];

// What a session's lot is paved with: its own for as long as it lasts, in big quiet patterns so that a building still stands out on it.
const CHECK = (u, v) => ((u >> 3) ^ (v >> 3)) & 1, MOWN = (u, v) => (u >> 3) & 1, RINGS = (u, v) => (Math.max(Math.abs(u - 32.5), Math.abs(v - 32.5)) >> 3) & 1, BRICK = (u, v) => ((u + ((v >> 3) & 1) * 6) >> 3 ^ (v >> 2)) & 1, PANELS = (u, v) => (u % 16 === 0 || v % 16 === 0) ? 1 : 0;
const LOTS = [['#6e2727', '#7a3045', '#cd683d', '#e6904e', CHECK], ['#165a4c', '#1a6a55', '#92a984', '#ab947a', MOWN], ['#45293f', '#553350', '#6b3e75', '#905ea9', RINGS], ['#7f5f5a', '#8a6a62', '#ab947a', '#c9a98e', BRICK], ['#0b5e65', '#0a525a', '#0b8a8f', '#0eaf9b', PANELS]].map(([a, b, kerb, path, pattern]) => {
  const A = hex(a), B = hex(b);
  return { a: A, b: B, kerb: hex(kerb), path: hex(path), tile: (u, v) => pattern(u, v) ? A : B };
});
export const lotLook = id => LOTS[fnv(`lot:${id}`) % LOTS.length];
const KERB = 2, PATH = 4, BUSH = 8, STAKE = 6;
// How far the land runs past the city: its power plants stand north and west of it, so that's where it needs the room.
export const LAND = 98, LAND_FAR = 40;
const RIPPLES = 66, CORNER = 34, TREE_GRID = 21;
// Cheap and without a visible grain, which a sum of multiples isn't: this runs for every cell of the map.
const mix = (a, b) => { let n = Math.imul(a, 73856093) ^ Math.imul(b, 19349663); n = Math.imul(n ^ n >>> 13, 1274126177); return (n ^ n >>> 16) >>> 0; };
// Slow waves, so that the meadow's lighter part comes in big soft patches and trees gather in them.
const patch = (x, z) => Math.sin(x / 19 + z / 31) + Math.sin(z / 13 - x / 41);
const meadow = (x, z, soil) => { const n = mix(x, z); return patch(x, z) > .55 ? n % 401 === 0 ? C.flower : n % 37 === 0 ? soil.tuft : soil.land2 : n % 149 === 0 ? soil.tuft : soil.land; };

// Rebuilding a stack is the slow part and only a few dozen ever exist, so the same tree is the same object.
const stacks = new Map(), once = (key, make) => { if (!stacks.has(key)) stacks.set(key, make()); return stacks.get(key); };

// An island: the distance past the edge of a rounded box, made uneven by a couple of slow waves.
export const reachOf = (W, D) => (x, z) => { const qx = Math.abs(x - (W + LAND_FAR - LAND) / 2) - (W + LAND_FAR + LAND) / 2 + CORNER, qz = Math.abs(z - (D + LAND_FAR - LAND) / 2) - (D + LAND_FAR + LAND) / 2 + CORNER; return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - CORNER + Math.sin(x / 23) * 3 + Math.sin(z / 17) * 2; };
// The slow part of the ground, and the part a new session doesn't change, so it's only painted when the city changes size.
let land = { key: '', rgb: null };
function landscape(W, D, x0, z0, w, d, time) {
  const key = `${W},${D},${time}`;
  if (land.key === key) return land.rgb;
  const out = new Uint8Array(w * d * 3), reach = reachOf(W, D), soil = soilOf(time);
  for (let b = 0; b < d; b++) for (let a = 0; a < w; a++) {
    const past = reach(x0 + a, z0 + b);
    // Ripples are dashes, thinning out the further they are from shore so that they never end in a line.
    const c = past < 0 ? meadow(x0 + a, z0 + b, soil) : past < 4 ? C.sand : past < 5 ? C.foam : past < RIPPLES && a % 9 < 5 && mix(a >> 3, b) % (12 + Math.floor(past)) === 0 ? C.ripple : C.sea;
    out.set(c, (a + b * w) * 3);
  }
  land = { key, rgb: out };
  return out;
}

export function groundCells(plan, time = 'day') {
  const { w: W, d: D } = plan.bounds, x0 = -MARGIN, z0 = -MARGIN, w = W + MARGIN * 2, d = D + MARGIN * 2, rgb = new Uint8Array(w * d * 3), props = [], soil = soilOf(time), lawn = soil.land;
  const set = (x, z, c) => { const a = Math.floor(x) - x0, b = Math.floor(z) - z0; if (a < 0 || b < 0 || a >= w || b >= d) return; const i = (a + b * w) * 3; rgb[i] = c[0]; rgb[i + 1] = c[1]; rgb[i + 2] = c[2]; };
  const rect = (x, z, W2, D2, c) => { for (let b = 0; b < D2; b++) for (let a = 0; a < W2; a++) set(x + a, z + b, typeof c === 'function' ? c(a, b) : c); };
  const prop = (stack, x, z) => props.push({ stack, x, z });
  rgb.set(landscape(W, D, x0, z0, w, d, time));
  rect(0, 0, W, D, C.block);

  // Roads run the length of the city; a walk either side, dashes down the middle, a crossing at each junction.
  const road = (x, z, W2, D2) => { const along = W2 > D2; rect(x, z, W2, D2, (a, b) => { const v = along ? b : a, u = along ? a : b; return v < WALK || v >= ROAD + WALK ? C.walk : (v === WALK + 6 || v === WALK + 7) && u % 8 < 4 ? C.dash : C.road; }); };
  for (const z of plan.roads.zs) road(0, z - WALK, W, ROADW);
  for (const x of plan.roads.xs) road(x - WALK, 0, ROADW, D);
  for (const x of plan.roads.xs) for (const z of plan.roads.zs) {
    rect(x - WALK, z - WALK, ROADW, ROADW, C.road);
    const across = a => a % 3 < 2 ? C.zebra : C.road, down = (a, b) => b % 3 < 2 ? C.zebra : C.road;
    // A crossing only where a road carries on.
    if (z > plan.roads.zs[0]) rect(x, z - WALK, ROAD, WALK, across);
    if (z < plan.roads.zs.at(-1)) rect(x, z + ROAD, ROAD, WALK, across);
    if (x > plan.roads.xs[0]) rect(x - WALK, z, WALK, ROAD, down);
    if (x < plan.roads.xs.at(-1)) rect(x + ROAD, z, WALK, ROAD, down);
  }

  for (const { kind, x, z, w: W2, d: D2, seed } of plan.parcels) PARCELS[kind]({ rect, prop, lawn, h: n => fnv(`${seed}:${n}`) }, x, z, W2, D2);
  for (const park of plan.parks) bigPark({ rect, prop, lawn, h: n => fnv(`${park.seed}:${n}`) }, park.x, park.z, park.w, park.d);

  // Paved where someone's building; corner ticks where one could go.
  for (const hood of plan.hoods) for (const lot of hood.lots) {
    const a = lot.x - LOT / 2, b = lot.z - LOT / 2, n = LOT - INSET * 2, A = n - 1;
    if (lot.sessionId) {
      const N = LOT - PLOT * 2, look = lotLook(lot.sessionId), towardRoad = lot.slot & 1 ? v => v > N / 2 : v => v < N / 2;
      rect(a + PLOT, b + PLOT, N, N, (u, v) => {
        if (u < KERB || v < KERB || u >= N - KERB || v >= N - KERB) return look.kerb;
        if (Math.abs(u + .5 - N / 2) < PATH && towardRoad(v)) return look.path;
        const inU = Math.min(u, N - 1 - u) - KERB, inV = Math.min(v, N - 1 - v) - KERB;
        if (inU >= 1 && inU < BUSH && inV >= 1 && inV < BUSH) return (u + v) % 5 ? C.bush : C.bud;
        return look.tile(u, v);
      });
    } else rect(a + INSET, b + INSET, n, n, (u, v) => (u === 0 || v === 0 || u === A || v === A) && (u < STAKE || A - u < STAKE) && (v < STAKE || A - v < STAKE) ? C.stake : meadow(a + INSET + u, b + INSET + v, soil));
  }

  // A lamp at each corner of each lot, on the pavement: enough to read the streets by at night, too short to hide anything.
  for (const hood of plan.hoods) {
    for (let i = 0; i <= hood.cols; i++) prop(lamp(), hood.x + i * LOT, hood.z - 1);
    for (const r of [1, 2]) prop(lamp(), hood.x - 1, hood.z + r * LOT);
  }

  // Trees on the outskirts, in the meadow's patches, never in front of a plant or its road.
  for (let z = -LAND; z < D + LAND_FAR; z += TREE_GRID) for (let x = -LAND; x < W + LAND_FAR; x += TREE_GRID) {
    const n = mix(x, z), X = x + n % 9, Z = z + (n >>> 8) % 9;
    if (X > -12 && Z > -12 && X < W + 12 && Z < D + 12) continue;
    if (reachOf(W, D)(X, Z) > -10 || patch(X, Z) < .1 || n % 3 === 0) continue;
    if (plan.plants.some(plant => Math.hypot(X - plant.x, Z - plant.z) < 36 || (plant.provider === 'claude' ? X < 0 && Math.abs(Z - plant.z) < 16 : Z < 0 && Math.abs(X - plant.x) < 16))) continue;
    const seed = n % 9; prop(once(`tree${seed}`, () => tree(seed)), X, Z);
  }

  // A spur from the ring road to each plant.
  for (const plant of plan.plants) {
    if (plant.provider === 'claude') road(-PLANT + 16, plant.z - 9, PLANT - 16, ROADW);
    else road(plant.x - 9, -PLANT + 12, ROADW, PLANT - 12);
    rect(plant.x - 18, plant.z - 14, 36, 28, C.walk);
  }

  // The props' shadows lie on the ground for good. A building's is its own sprite, because it changes height.
  const shaded = new Uint8Array(w * d);
  for (const { stack, x: px, z: pz } of props) for (let y = 0; y < stack.h; y++) {
    const L = stack.layers[y]; if (!L) continue;
    for (let z = L.z0; z <= L.z1; z++) for (let x = L.x0; x <= L.x1; x++) if (L.data[(x + z * stack.w) * 4 + 3]) {
      const a = Math.floor(px - stack.w / 2 + x + SHADOW.x * y - x0), b = Math.floor(pz - stack.d / 2 + z + SHADOW.z * y - z0);
      if (a >= 0 && b >= 0 && a < w && b < d) shaded[a + b * w] = 1;
    }
  }
  for (let i = 0; i < shaded.length; i++) if (shaded[i]) {
    const dark = nearest([0, 1, 2].map(k => rgb[i * 3 + k] + (C.shadow[k] - rgb[i * 3 + k]) * DARK));
    rgb[i * 3] = dark[0]; rgb[i * 3 + 1] = dark[1]; rgb[i * 3 + 2] = dark[2];
  }
  return { x0, z0, w, d, rgb, props };
}

// Parcels are flat or nearly so: nothing here is ever tall enough to get in a building's way.
const PARCELS = {
  park({ rect, prop, lawn, h }, x, z, W, D) {
    rect(x, z, W, D, lawn);
    const mid = D > W;
    for (let i = 0; i < Math.max(W, D); i++) { const j = Math.round(Math.min(W, D) / 2 + Math.sin(i / 7 + h(1) % 6) * 4); rect(x + (mid ? j : i), z + (mid ? i : j), 2, 2, C.trail); }
    const n = 2 + h(2) % 3;
    for (let i = 0; i < n; i++) { const a = (i + .5) / n, side = i % 2 ? .62 : .88, seed = h(3 + i) % 9; prop(once(`tree${seed}`, () => tree(seed)), x + (mid ? W * side : W * a), z + (mid ? D * a : D * side)); }
  },
  pond({ rect, prop, lawn, h }, x, z, W, D) {
    const cx = W / 2, cz = D / 2, ra = W / 2 - 3, rb = D / 2 - 3;
    rect(x, z, W, D, (a, b) => { const q = ((a - cx) / ra) ** 2 + ((b - cz) / rb) ** 2; return q < .72 ? (a * 3 + b * 5) % 23 === 0 ? C.water2 : C.water : q < 1 ? C.water2 : lawn; });
    const seed = h(1) % 9; prop(once(`tree${seed}`, () => tree(seed)), x + W - 3, z + D - 3);
  },
  plaza({ rect, prop }, x, z, W, D) {
    rect(x, z, W, D, (a, b) => (a >> 2) % 2 === (b >> 2) % 2 ? C.paving : C.block);
    prop(once('fountain', fountain), x + W / 2, z + D / 2);
  },
  court({ rect, lawn }, x, z, W, D) {
    const I = 3, A = W - I * 2, B = D - I * 2;
    rect(x, z, W, D, lawn);
    rect(x + I, z + I, A, B, (a, b) => a === 0 || b === 0 || a === A - 1 || b === B - 1 || (A > B ? a === A >> 1 : b === B >> 1) ? C.line : C.court);
  },
  parking({ rect, prop, h }, x, z, W, D) {
    const mid = D > W, L = Math.max(W, D), V = Math.min(W, D);
    rect(x, z, W, D, (a, b) => { const u = mid ? b : a, v = mid ? a : b; return u % 7 === 0 && (v < V * .36 || v > V * .64) ? C.dash : C.tarmac; });
    for (let i = 0; i * 7 + 7 < L; i++) for (const side of [0, 1]) {
      if (h(9 + i * 2 + side) % 3) continue;
      const colour = CARS[h(40 + i + side * 7) % CARS.length], u = i * 7 + 3.5, v = side ? V * .82 : V * .18;
      prop(once(`car${colour}${mid}`, () => car(colour, mid)), x + (mid ? v : u), z + (mid ? u : v));
    }
  },
  market({ rect, prop, h }, x, z, W, D) {
    rect(x, z, W, D, (a, b) => (a + b) % 12 < 1 ? C.paving2 : C.paving);
    const mid = D > W, L = Math.max(W, D), n = Math.floor(L / 16);
    // Trees rather than stalls: anything square and this small would pass for a subagent with no building of its own.
    for (let i = 0; i < n; i++) { const seed = h(i + 2) % 9, u = (i + .5) * L / n, v = Math.min(W, D) / 2; prop(once(`tree${seed}`, () => tree(seed)), x + (mid ? v : u), z + (mid ? u : v)); }
  },
};
function bigPark({ rect, prop, lawn, h }, x, z, W, D) {
  const cx = W * .56, cz = D * .46;
  rect(x, z, W, D, (a, b) => { const q = ((a - cx) / (W * .24)) ** 2 + ((b - cz) / (D * .2)) ** 2; if (q < .78) return (a * 3 + b * 5) % 29 === 0 ? C.water2 : C.water; if (q < 1) return C.water2; return Math.abs(((a - cx) / (W * .34)) ** 2 + ((b - cz) / (D * .3)) ** 2 - 1) < .05 ? C.trail : lawn; });
  for (let i = 0; i < 14; i++) {
    const X = 8 + h(i * 2) % 1000 / 1000 * (W - 16), Z = 8 + h(i * 2 + 1) % 1000 / 1000 * (D - 16);
    if (((X - cx) / (W * .4)) ** 2 + ((Z - cz) / (D * .36)) ** 2 < 1) continue;
    const seed = h(40 + i) % 9; prop(once(`tree${seed}`, () => tree(seed)), x + X, z + Z);
  }
}

// A chosen neighbourhood lit up, to lay over the ground: its own cells brighter, a line between them, and a rim round the lot.
// `edge` is the rim alone, which is the part that glows.
const LIT = new Map([[C.stake, '#ffffff']].map(([from, to]) => [from.join(), hex(to)]));
const RIM = 3, LINE = hex('#8fd3ff'), RIM_LIGHT = hex('#fbff86'), LIFT = .22;
const lifted = c => { const key = c.join(); if (!LIT.has(key)) LIT.set(key, c.map((v, i) => Math.round(v + (LINE[i] - v) * LIFT))); return LIT.get(key); };
export function paintHood({ x0, z0, w, rgb }, hood, view) {
  const W = hood.cols * LOT, D = 2 * LOT, corners = [[0, 0], [W, 0], [0, D], [W, D]].map(([x, z]) => screen(hood.x + x, hood.z + z, view));
  const minX = Math.floor(Math.min(...corners.map(c => c[0]))), maxX = Math.ceil(Math.max(...corners.map(c => c[0]))), minY = Math.floor(Math.min(...corners.map(c => c[1]))), maxY = Math.ceil(Math.max(...corners.map(c => c[1])));
  const width = maxX - minX + 1, height = maxY - minY + 1, rgba = new Uint8ClampedArray(width * height * 4), edge = new Uint8ClampedArray(width * height * 4);
  const seam = v => v % LOT === 0 || v % LOT === LOT - 1;
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const [x, z] = unproject(px + minX, py + minY, view), a = Math.floor(x) - hood.x, b = Math.floor(z) - hood.z;
    if (a < 0 || b < 0 || a >= W || b >= D) continue;
    const i = (px + py * width) * 4, rim = a < RIM || b < RIM || a >= W - RIM || b >= D - RIM;
    let colour = rim ? RIM_LIGHT : seam(a) || seam(b) ? LINE : null;
    if (!colour) { const c = (Math.floor(x) - x0 + (Math.floor(z) - z0) * w) * 3, here = [rgb[c], rgb[c + 1], rgb[c + 2]]; colour = lifted(here); }
    rgba[i] = colour[0]; rgba[i + 1] = colour[1]; rgba[i + 2] = colour[2]; rgba[i + 3] = 255;
    if (rim) { edge[i] = colour[0]; edge[i + 1] = colour[1]; edge[i + 2] = colour[2]; edge[i + 3] = 255; }
  }
  return { width, height, rgba, edge, originX: -minX, originY: -minY };
}

// Night over a sleeping session's lot, centred on the lot. Lots are all one size, so one per view does for all of them.
// Under a night sky the land is that same blue, so a sleeper's lot goes darker than its land instead of vanishing into it.
const NIGHT_OVER = { day: hex('#323353'), night: hex('#17121f') }, NIGHT_ALPHA = 165;
export function paintLotShade(view, time = 'day') {
  const half = LOT / 2, corners = [[-half, -half], [half, -half], [-half, half], [half, half]].map(([x, z]) => screen(x, z, view));
  const minX = Math.floor(Math.min(...corners.map(c => c[0]))), maxX = Math.ceil(Math.max(...corners.map(c => c[0]))), minY = Math.floor(Math.min(...corners.map(c => c[1]))), maxY = Math.ceil(Math.max(...corners.map(c => c[1])));
  const width = maxX - minX + 1, height = maxY - minY + 1, rgba = new Uint8ClampedArray(width * height * 4);
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const [x, z] = unproject(px + minX, py + minY, view), a = Math.floor(x), b = Math.floor(z);
    if (a < -half || b < -half || a >= half || b >= half) continue;
    const i = (px + py * width) * 4, over = NIGHT_OVER[time]; rgba[i] = over[0]; rgba[i + 1] = over[1]; rgba[i + 2] = over[2]; rgba[i + 3] = NIGHT_ALPHA;
  }
  return { width, height, rgba, originX: -minX, originY: -minY };
}

// World (x, z) lands on pixel (screen x + originX, screen y + originY).
export function paintGround({ x0, z0, w, d, rgb }, view) {
  const corners = [[x0, z0], [x0 + w, z0], [x0, z0 + d], [x0 + w, z0 + d]].map(([x, z]) => screen(x, z, view));
  const minX = Math.floor(Math.min(...corners.map(c => c[0]))), maxX = Math.ceil(Math.max(...corners.map(c => c[0]))), minY = Math.floor(Math.min(...corners.map(c => c[1]))), maxY = Math.ceil(Math.max(...corners.map(c => c[1])));
  const width = maxX - minX + 1, height = maxY - minY + 1, rgba = new Uint8ClampedArray(width * height * 4);
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const [x, z] = unproject(px + minX, py + minY, view), a = Math.floor(x) - x0, b = Math.floor(z) - z0;
    if (a < 0 || b < 0 || a >= w || b >= d) continue;
    const c = (a + b * w) * 3, i = (px + py * width) * 4;
    rgba[i] = rgb[c]; rgba[i + 1] = rgb[c + 1]; rgba[i + 2] = rgb[c + 2]; rgba[i + 3] = 255;
  }
  return { width, height, rgba, originX: -minX, originY: -minY };
}
