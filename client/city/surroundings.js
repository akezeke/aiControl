// What goes on around the city without having anything to do with it. Pure: where things are at a given moment, in numbers.
import { screen } from './plan.js';
import { LAND, LAND_FAR, mix } from './ground.js';

// The sea is a list of little dashes per frame. They only ever cover cells that are still water, so a pier or a shadow stays dry.
export const SEA_FRAMES = 8, SEA_KINDS = [{ colour: '#8ff8e2', w: 2 }, { colour: '#0eaf9b', w: 2 }, { colour: '#0b8a8f', w: 6 }, { colour: '#0eaf9b', w: 4 }];
const WAVE_MIDDLE = 3, WAVE_REACH = 2.5, BEHIND = 2, GAPPY = 5;
// `[sx, sy, kind, ...]` by kind, so a paint changes colour as little as it can.
export function seaFrame({ shore, past, glint }, frame, view) {
  const f = frame % SEA_FRAMES, kinds = SEA_KINDS.map(() => []), turn = 2 * Math.PI * f / SEA_FRAMES;
  const put = (kind, x, z) => { const [sx, sy] = screen(x, z, view); kinds[kind].push(Math.floor(sx), Math.floor(sy), kind); };
  for (let i = 0, c = 0; i < shore.length; i += 2, c++) {
    const x = shore[i], z = shore[i + 1], crest = past[c] - (2 + WAVE_MIDDLE + WAVE_REACH * Math.sin(turn + x / 29 + z / 37)), n = mix(x, z);
    if (crest >= 0 && crest < 1) { if (n % GAPPY) put(0, x, z); } else if (crest >= BEHIND && crest < BEHIND + 1 && n % 3 === 0) put(1, x, z);
  }
  for (let i = 0; i < glint.length; i += 2) { const x = glint[i], z = glint[i + 1], n = mix(z, x); if ((n + f) % SEA_FRAMES === 0) put(n % 4 ? 2 : 3, x, z); }
  return Int16Array.from(kinds.flat());
}

// Boats sail one long lap round the whole coast, all the same way and evenly spaced, so they never meet. Far enough out for the island and the pier to be behind them.
export const BOATS = 3;
const BOAT_SPEED = .004, OUT_WEST = LAND + 44, OUT_EAST = 165, OUT_SOUTH = 72;
export function boatsAt({ w, d }, now) {
  const x0 = -OUT_WEST, z0 = -OUT_WEST, x1 = w + OUT_EAST, z1 = d + LAND_FAR + OUT_SOUTH, W = x1 - x0, D = z1 - z0, lap = 2 * (W + D);
  return Array.from({ length: BOATS }, (_, i) => {
    let s = (now * BOAT_SPEED + i * lap / BOATS) % lap;
    if (s < W) return { x: Math.round(x0 + s), z: z0, along: true, dir: 1 };
    s -= W;
    if (s < D) return { x: x1, z: Math.round(z0 + s), along: false, dir: 1 };
    s -= D;
    if (s < W) return { x: Math.round(x1 - s), z: z1, along: true, dir: -1 };
    return { x: x0, z: Math.round(z1 - (s - W)), along: false, dir: -1 };
  });
}

// A duck and her young, out and back round each big lake, turning before they reach the jetty.
const YOUNG = [false, true, true], DUCK_OUT = -12, DUCK_GAP = .5, DUCK_SPEED = .0015, DUCK_APART = 5;
export function ducksAt(lakes, now) {
  return lakes.filter(lake => lake.big).flatMap(lake => {
    const sweep = 2 * Math.PI - 2 * DUCK_GAP, length = (lake.ra + lake.rb) / 2 * .8 * sweep;
    return YOUNG.map((young, i) => {
      const t = (((now * DUCK_SPEED + lake.cx * 7 + lake.cz * 3 - i * DUCK_APART) / length) % 2 + 2) % 2, way = t < 1 ? 1 : -1, a = lake.jetty.facing + DUCK_GAP + (t < 1 ? t : 2 - t) * sweep;
      const [x, z] = lake.at(a, DUCK_OUT), [nx, nz] = lake.at(a + way * .02, DUCK_OUT), along = Math.abs(nx - x) >= Math.abs(nz - z);
      return { x: Math.round(x), z: Math.round(z), along, dir: (along ? nx - x : nz - z) < 0 ? -1 : 1, young, lake };
    });
  });
}

// Now and then a flock crosses, high up. It is over the city for a while and gone for longer, a new line each time.
export const BIRD_EVERY = 60000;
const BIRD_FLIGHT = 24000, BIRD_OFF = 160, WINGBEAT = 240, FLOCK = [[0, 0], [-6, -5], [-6, 5], [-12, -10], [-12, 10]];
export function birdsAt({ w, d }, now) {
  const pass = Math.floor(now / BIRD_EVERY), t = (now % BIRD_EVERY) / BIRD_FLIGHT;
  if (t > 1) return [];
  const along = pass % 2 === 0, back = mix(pass, 3) % 2 ? -1 : 1, spot = (mix(pass, 11) % 80 + 10) / 100, length = (along ? w : d) + BIRD_OFF * 2;
  const run = (back > 0 ? t : 1 - t) * length - BIRD_OFF, side = spot * (along ? d : w);
  return FLOCK.map(([behind, out], i) => {
    const u = run + behind * back, wings = Math.floor(now / WINGBEAT + i * .5) % 2;
    return { x: Math.round(along ? u : side + out), z: Math.round(along ? side + out : u), wings };
  });
}

// The shadows of a few clouds, drifting across land and sea alike and coming round again.
export const CLOUDS = 3;
const CLOUD_SPEED = .002, CLOUD_OFF = 300, CLOUD_DRIFT = .4;
export function cloudsAt({ w, d }, now) {
  const across = w + CLOUD_OFF * 2;
  return Array.from({ length: CLOUDS }, (_, i) => {
    const s = (now * CLOUD_SPEED + i * across / CLOUDS + mix(i, 5) % 97) % across;
    return { x: Math.round(s - CLOUD_OFF), z: Math.round(d * (i + .5) / CLOUDS - d / 6 + s * CLOUD_DRIFT * d / across), shape: i };
  });
}
// A blob of overlapping puffs, as `[from, length]` per row: a picture's worth of runs.
export function cloudBlob(shape) {
  const W = 200 + mix(shape, 2) % 60, H = 70 + mix(shape, 4) % 40, n = 4 + mix(shape, 6) % 3, STEP = 3;
  const puffs = Array.from({ length: n }, (_, i) => { const t = (i + .5) / n, rx = W * (.14 + mix(shape, 20 + i) % 6 / 100), ry = H * (.3 + mix(shape, 40 + i) % 16 / 100) * (1 - Math.abs(t - .5)); return { x: Math.max(rx + STEP, Math.min(W - rx - STEP, t * W)), y: H / 2 + (mix(shape, 60 + i) % 7 - 3) / 3 * H * .12, rx, ry }; });
  const rows = Array.from({ length: H }, (_, y) => {
    // Whole steps, so its edge looks drawn rather than smoothed.
    const Y = y - y % STEP + STEP / 2; let from = W, to = 0;
    for (const puff of puffs) { const q = 1 - ((Y - puff.y) / puff.ry) ** 2; if (q <= 0) continue; const half = puff.rx * Math.sqrt(q); from = Math.min(from, puff.x - half); to = Math.max(to, puff.x + half); }
    if (to <= from) return [0, 0];
    const start = Math.max(0, Math.round(from / STEP) * STEP), end = Math.min(W, Math.round(to / STEP) * STEP);
    return [start, Math.max(0, end - start)];
  });
  return { w: W, h: H, rows };
}
