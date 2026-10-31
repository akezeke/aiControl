// How a building moves when nothing about it is being rebuilt. In whole art pixels, and a function of the time, so a redraw can't drift. Pure.
import { fnv } from './identity.js';

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
