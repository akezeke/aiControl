// What goes on around the city without having anything to do with it. Pure: where things are at a given moment, in numbers.
import { screen } from './plan.js';
import { mix } from './ground.js';

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
