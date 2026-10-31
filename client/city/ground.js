// The ground the city stands on: every road, parcel and lot in a flat grid of cells, baked once per view. Pure.
import { hex, nearest } from './palette.js';
import { fnv } from './identity.js';
import { fountain, car, stall, tree } from './generator.js';
import { LOT, PLOT, ROAD, WALK, PLANT, unproject, screen } from './plan.js';
import { SHADOW } from './sprite.js';

const C = Object.fromEntries(Object.entries({ floor: '#323353', block: '#484a77', plot: '#625565', tick: '#7f708a', road: '#3e3546', walk: '#7f708a', dash: '#9babb2', zebra: '#c7dcd0', shadow: '#2e222f',
  lawn: '#374e4a', trail: '#ab947a', water: '#0b5e65', water2: '#0b8a8f', paving: '#625565', paving2: '#7f708a', court: '#a24b6f', line: '#c7dcd0', tarmac: '#3e3546' }).map(([k, v]) => [k, hex(v)]));
const MARGIN = 180, ROADW = ROAD + WALK * 2, DARK = .7, INSET = 2, TICK = 7, CARS = ['#e83b3b', '#4d9be6', '#f9c22b', '#c7dcd0', '#0eaf9b'], AWNINGS = ['#e83b3b', '#f9c22b', '#0eaf9b', '#ed8099'];

// Rebuilding a stack is the slow part and only a few dozen ever exist, so the same tree is the same object.
const stacks = new Map(), once = (key, make) => { if (!stacks.has(key)) stacks.set(key, make()); return stacks.get(key); };

export function groundCells(plan) {
  const { w: W, d: D } = plan.bounds, x0 = -MARGIN, z0 = -MARGIN, w = W + MARGIN * 2, d = D + MARGIN * 2, rgb = new Uint8Array(w * d * 3), props = [];
  const set = (x, z, c) => { const a = Math.floor(x) - x0, b = Math.floor(z) - z0; if (a < 0 || b < 0 || a >= w || b >= d) return; const i = (a + b * w) * 3; rgb[i] = c[0]; rgb[i + 1] = c[1]; rgb[i + 2] = c[2]; };
  const rect = (x, z, W2, D2, c) => { for (let b = 0; b < D2; b++) for (let a = 0; a < W2; a++) set(x + a, z + b, typeof c === 'function' ? c(a, b) : c); };
  const prop = (stack, x, z) => props.push({ stack, x, z });
  rect(x0, z0, w, d, C.floor);
  rect(0, 0, W, D, C.block);

  // Roads run the length of the city; a walk either side, dashes down the middle, a crossing at each junction.
  const road = (x, z, W2, D2) => { const along = W2 > D2; rect(x, z, W2, D2, (a, b) => { const v = along ? b : a, u = along ? a : b; return v < WALK || v >= ROAD + WALK ? C.walk : (v === WALK + 6 || v === WALK + 7) && u % 8 < 4 ? C.dash : C.road; }); };
  for (const z of plan.roads.zs) road(0, z - WALK, W, ROADW);
  for (const x of plan.roads.xs) road(x - WALK, 0, ROADW, D);
  for (const x of plan.roads.xs) for (const z of plan.roads.zs) {
    rect(x - WALK, z - WALK, ROADW, ROADW, C.road);
    const across = a => a % 3 < 2 ? C.zebra : C.road, down = (a, b) => b % 3 < 2 ? C.zebra : C.road;
    rect(x, z - WALK, ROAD, WALK, across); rect(x, z + ROAD, ROAD, WALK, across); rect(x - WALK, z, WALK, ROAD, down); rect(x + ROAD, z, WALK, ROAD, down);
  }

  for (const { kind, x, z, w: W2, d: D2, seed } of plan.parcels) PARCELS[kind]({ rect, prop, h: n => fnv(`${seed}:${n}`) }, x, z, W2, D2);
  for (const park of plan.parks) bigPark({ rect, prop, h: n => fnv(`${park.seed}:${n}`) }, park.x, park.z, park.w, park.d);

  // Paved where someone's building; corner ticks where one could go.
  for (const hood of plan.hoods) for (const lot of hood.lots) {
    const a = lot.x - LOT / 2, b = lot.z - LOT / 2, n = LOT - INSET * 2, A = n - 1;
    rect(a + INSET, b + INSET, n, n, C.floor);
    if (lot.sessionId) rect(a + PLOT, b + PLOT, LOT - PLOT * 2, LOT - PLOT * 2, C.plot);
    else rect(a + INSET, b + INSET, n, n, (u, v) => (u === 0 || v === 0 || u === A || v === A) && (u < TICK || A - u < TICK) && (v < TICK || A - v < TICK) ? C.tick : C.floor);
  }

  // A spur from the ring road to each plant.
  for (const plant of plan.plants) {
    if (plant.provider === 'claude') road(-PLANT + 16, plant.z - 9, PLANT - 16, ROADW);
    else road(plant.x - 9, -PLANT + 12, ROADW, PLANT - 12);
    rect(plant.x - 18, plant.z - 14, 36, 28, C.plot);
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
  park({ rect, prop, h }, x, z, W, D) {
    rect(x, z, W, D, C.lawn);
    const mid = D > W;
    for (let i = 0; i < Math.max(W, D); i++) { const j = Math.round(Math.min(W, D) / 2 + Math.sin(i / 7 + h(1) % 6) * 4); rect(x + (mid ? j : i), z + (mid ? i : j), 2, 2, C.trail); }
    const n = 2 + h(2) % 3;
    for (let i = 0; i < n; i++) { const a = (i + .5) / n, side = i % 2 ? .62 : .88, seed = h(3 + i) % 9; prop(once(`tree${seed}`, () => tree(seed)), x + (mid ? W * side : W * a), z + (mid ? D * a : D * side)); }
  },
  pond({ rect, prop, h }, x, z, W, D) {
    const cx = W / 2, cz = D / 2, ra = W / 2 - 3, rb = D / 2 - 3;
    rect(x, z, W, D, (a, b) => { const q = ((a - cx) / ra) ** 2 + ((b - cz) / rb) ** 2; return q < .72 ? (a * 3 + b * 5) % 23 === 0 ? C.water2 : C.water : q < 1 ? C.water2 : C.lawn; });
    const seed = h(1) % 9; prop(once(`tree${seed}`, () => tree(seed)), x + W - 3, z + D - 3);
  },
  plaza({ rect, prop }, x, z, W, D) {
    rect(x, z, W, D, (a, b) => (a >> 2) % 2 === (b >> 2) % 2 ? C.paving : C.block);
    prop(once('fountain', fountain), x + W / 2, z + D / 2);
  },
  court({ rect }, x, z, W, D) {
    const I = 3, A = W - I * 2, B = D - I * 2;
    rect(x, z, W, D, C.lawn);
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
    for (let i = 0; i < n; i++) { const colour = AWNINGS[h(i + 2) % AWNINGS.length], u = (i + .5) * L / n, v = Math.min(W, D) / 2; prop(once(`stall${colour}`, () => stall(colour)), x + (mid ? v : u), z + (mid ? u : v)); }
  },
};
function bigPark({ rect, prop, h }, x, z, W, D) {
  const cx = W * .56, cz = D * .46;
  rect(x, z, W, D, (a, b) => { const q = ((a - cx) / (W * .24)) ** 2 + ((b - cz) / (D * .2)) ** 2; if (q < .78) return (a * 3 + b * 5) % 29 === 0 ? C.water2 : C.water; if (q < 1) return C.water2; return Math.abs(((a - cx) / (W * .34)) ** 2 + ((b - cz) / (D * .3)) ** 2 - 1) < .05 ? C.trail : C.lawn; });
  for (let i = 0; i < 14; i++) {
    const X = 8 + h(i * 2) % 1000 / 1000 * (W - 16), Z = 8 + h(i * 2 + 1) % 1000 / 1000 * (D - 16);
    if (((X - cx) / (W * .4)) ** 2 + ((Z - cz) / (D * .36)) ** 2 < 1) continue;
    const seed = h(40 + i) % 9; prop(once(`tree${seed}`, () => tree(seed)), x + X, z + Z);
  }
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
