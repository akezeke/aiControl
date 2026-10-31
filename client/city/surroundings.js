// What goes on around the city without having anything to do with it. Pure: where things are at a given moment, in numbers.
import { screen } from './plan.js';
import { LAND_FAR, mix } from './ground.js';

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
const BOAT_SPEED = .004, OUT_WEST = 142, OUT_EAST = 165, OUT_SOUTH = 72;
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
