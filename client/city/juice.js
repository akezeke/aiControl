// How a building moves when nothing about it is being rebuilt. In whole art pixels, and a function of the time, so a redraw can't drift. Pure.
import { fnv } from './identity.js';
import { ROAD } from './plan.js';

export const HOP_MS = 360, PHASE_MS = 650, SPARK_MS = 250, STEAM_MS = 400;
const THUMP_EVERY = 2400, THUMP_MS = 180;
const CROUCH = 2, LEAP = 5, LEAVES = .2, LANDS = .75;
const bump = t => Math.sin(t * Math.PI);

// Crouch, leap, land heavily. Null once it's over.
export function hop(age) {
  if (age >= HOP_MS) return null;
  const t = Math.max(0, age) / HOP_MS;
  if (t < LEAVES) return { lift: 0, squash: Math.round(bump(t / LEAVES) * CROUCH) };
  if (t < LANDS) return { lift: Math.round(bump((t - LEAVES) / (LANDS - LEAVES)) * LEAP), squash: 0 };
  return { lift: 0, squash: Math.round(bump((t - LANDS) / (1 - LANDS)) * CROUCH) };
}

// A tower at work gives a small thump now and then, each at its own time.
export function hum(now, id) { return (now + fnv(id) % THUMP_EVERY) % THUMP_EVERY < THUMP_MS ? 1 : 0; }

// Which of the four looks a working building is on: lamps, flags and the like.
export function phaseAt(now, id) { return Math.floor((now + fnv(id) % (PHASE_MS * 4)) / PHASE_MS) % 4; }

// Welding sparks off a working roof, relative to its crown. Three at most, cooling as they climb.
const SPARKS = ['#fbff86', '#f9c22b', '#fb6b1d', '#ea4f36'], SLOTS = 3, EVERY = 13;
export function sparks(now, id) {
  const tick = Math.floor(now / SPARK_MS), seed = fnv(`sparks:${id}`), out = [];
  for (let slot = 0; slot < SLOTS; slot++) {
    const at = tick + (seed >>> slot * 8 & 255), age = at % EVERY;
    if (age >= SPARKS.length) continue;
    const n = fnv(`${id}:${slot}:${Math.floor(at / EVERY)}`);
    out.push({ x: n % 9 - 4, y: -1 - age * 2 - (n >>> 8) % 2, colour: SPARKS[age] });
  }
  return out;
}

// Which way a site crane's jib is turned: round and round through its beats, from each tower's own start.
export const JIB_MS = 420;
export function jibBeat(now, id, beats) { return Math.floor((now + fnv(`jib:${id}`) % (JIB_MS * beats)) / JIB_MS) % beats; }

// Traffic follows the work: a car for each tower that's awake, on the roads round its block. Every circuit keeps to the lane nearest its own block, so that a road between two blocks carries them opposite ways and nothing ever has to pass through anything.
const LANE = 3, CAR_SPEED = .02, CAR_COLOURS = ['#e83b3b', '#4d9be6', '#c7dcd0', '#0eaf9b', '#fb6b1d', '#f5a097'];
export const CARS_PER_BLOCK = 4;
export function circuits({ xs, zs }) {
  const out = [], mid = ROAD / 2;
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) out.push({ x0: xs[i] + mid + LANE, z0: zs[j] + mid + LANE, x1: xs[i + 1] + mid - LANE, z1: zs[j + 1] + mid - LANE });
  return out;
}
// `t` is how far round, from 0 to 1. `along` says the car points down x rather than z.
export function carAt({ x0, z0, x1, z1 }, t) {
  const w = x1 - x0, d = z1 - z0;
  let s = t * 2 * (w + d);
  if (s < w) return { x: x0 + s, z: z0, along: true };
  s -= w;
  if (s < d) return { x: x1, z: z0 + s, along: false };
  s -= d;
  if (s < w) return { x: x1 - s, z: z1, along: true };
  return { x: x0, z: z1 - (s - w), along: false };
}
// A car has a slot on its circuit, evenly spaced from the others, chosen by its id: one joining or leaving doesn't move the rest.
export function traffic(roads, busy, now) {
  const loops = circuits(roads), taken = loops.map(() => new Set()), cars = [];
  for (const { id, x, z } of [...busy].sort((a, b) => a.id < b.id ? -1 : 1)) {
    const at = loops.findIndex(c => x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1);
    if (at < 0 || taken[at].size >= CARS_PER_BLOCK) continue;
    const seed = fnv(`car:${id}`);
    let slot = seed % CARS_PER_BLOCK;
    while (taken[at].has(slot)) slot = (slot + 1) % CARS_PER_BLOCK;
    taken[at].add(slot);
    const loop = loops[at], lapMs = 2 * (loop.x1 - loop.x0 + loop.z1 - loop.z0) / CAR_SPEED;
    cars.push({ id, ...carAt(loop, (now / lapMs + slot / CARS_PER_BLOCK + at * .37) % 1), colour: CAR_COLOURS[seed % CAR_COLOURS.length] });
  }
  return cars;
}

// Something just happened to a building, and it's worth a moment. `ground` is under the buildings rather than in front of them; `crown` starts from the roof rather than the foot; `glow` also goes to the bloom.
export const BURSTS = { finish: { ms: 1100, crown: true, glow: true }, grow: { ms: 450, crown: true }, ask: { ms: 800, ground: true }, fail: { ms: 800, ground: true }, spawn: { ms: 600, ground: true }, tap: { ms: 240, ground: true }, fall: { ms: 650 } };
const SHELLS = [['#fbff86', '#f9c22b', '#fb6b1d', '#ea4f36'], ['#ffffff', '#f5a097', '#e86a73', '#bc4a9b'], ['#ffffff', '#8fd3ff', '#4d9be6', '#4d65b4'], ['#fbff86', '#91db69', '#30e1b9', '#0eaf9b']];
const RINGS = { ask: ['#fbff86', '#f9c22b', '#f79617', '#fb6b1d'], fail: ['#f5a097', '#e83b3b', '#ea4f36', '#b33831'] };
const DUST = ['#f6f0e0', '#dcd5c6', '#c7dcd0', '#9babb2'], RUBBLE = ['#c7dcd0', '#9babb2', '#7f708a', '#625565'], TAP = '#ffffff';
const of = (ramp, t) => ramp[Math.min(ramp.length - 1, Math.floor(t * ramp.length))];
const dot = (x, y, colour, size = 1) => ({ x: Math.round(x), y: Math.round(y), colour, size });
// The shape a square makes on this ground, walked in whole pixels. `thin` leaves gaps as it fades.
const diamond = (out, R, colour, thin = 1, size = 1) => {
  for (let x = -R, i = 0; x <= R; x += 2, i++) if (i % thin === 0) { const y = (R - Math.abs(x)) / 2; out.push(dot(x, -y, colour, size)); if (y) out.push(dot(x, y, colour, size)); }
};
// A puff of bits leaving one point. `up` and `fall` shape the arc; `floor` is as low as they go.
const flung = (out, n, key, t, reach, up, fall, ramp, floor = Infinity, size = 1, squash = .5) => {
  for (let i = 0; i < n; i++) {
    const h = fnv(`${key}:${i}`), a = i / n * Math.PI * 2 + (h % 100) / 100, r = reach * (.5 + (h >>> 8) % 50 / 100) * (1 - (1 - t) ** 2);
    out.push(dot(Math.cos(a) * r, Math.min(floor, Math.sin(a) * r * squash - up * t + fall * t * t), of(ramp, t), size));
  }
};
const fireworks = (out, t, seed) => {
  for (let shell = 0; shell < 3; shell++) {
    const start = shell * .16, u = (t - start) / (1 - .32), h = fnv(`${seed}:${shell}`);
    if (u < 0 || u >= 1) continue;
    const x = (h % 41) - 20, top = 26 + (h >>> 8) % 16;
    if (u < .3) { const q = u / .3; out.push(dot(x * q, -top * q, '#ffffff')); if (q > .1) out.push(dot(x * (q - .1), -top * (q - .1), '#f9c22b')); continue; }
    const v = (u - .3) / .7, spark = [];
    flung(spark, 24, `${seed}:${shell}`, v, 30, 0, 14, SHELLS[(h >>> 16) % SHELLS.length], Infinity, v < .55 ? 2 : 1, .85);
    if (v < .2) spark.push(dot(-1, -1, '#ffffff', 3));
    for (const s of spark) out.push({ ...s, x: s.x + Math.round(x), y: s.y - top });
  }
};
// Pure, a function of how long ago it started, in pixels from where it started. Null once it's over.
export function burst(kind, age, seed) {
  const spec = BURSTS[kind];
  if (!spec || age >= spec.ms) return null;
  const t = Math.max(0, age) / spec.ms, out = [];
  switch (kind) {
    case 'finish': fireworks(out, t, seed); if (!out.length) out.push(dot(0, -1, '#ffffff')); break;
    case 'grow': flung(out, 14, seed, t, 16, 2, 8, DUST, Infinity, 2); break;
    case 'ask': case 'fail': for (const lag of [0, .3]) { const u = (t - lag) / (1 - lag); if (u >= 0) diamond(out, 10 + Math.round(u * 50), of(RINGS[kind], u), u > .7 ? 2 : 1, 2); } break;
    case 'spawn': diamond(out, 8 + Math.round(t * 40), of(DUST, t), t > .6 ? 2 : 1, 2); flung(out, 14, seed, t, 22, 10, 4, DUST, Infinity, 2); break;
    case 'tap': for (const r of [20, 10]) diamond(out, Math.max(2, Math.round(r * (1 - t) ** 1.5 + 2)), TAP, 1, 2); break;
    case 'fall': flung(out, 22, seed, t, 26, 18, 24, RUBBLE, 0, 2); break;
  }
  return out;
}

// What a change in a building is worth. `was` is null the first time it's seen: only a change counts.
export function momentOf(was, now) {
  if (!was) return null;
  if (now.beacon && !was.beacon) return 'ask';
  if (now.smoke && !was.smoke) return 'fail';
  if (was.twinkle && !now.twinkle && !now.offline && !now.beacon && !now.smoke) return 'finish';
  return now.storeys > was.storeys ? 'grow' : null;
}
