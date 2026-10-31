import { STEP, simulate } from './flight.js';
import { TIERS, surfaceTier, levelWorld } from './kitchen-plan.js';

// Trickshot scoring and playback, Node-runnable. A shot is simulated whole at release (runShot), then played back (createRun), so slow
// motion can start before the score is known to the player. Coordinates are kitchen-local, as in kitchen-plan.js.
export const SOFT = 0.5, FLIGHT = 0.45, SLOW = 0.15, SLOW_FOR = 0.5, MOST_TIME = 8; // m/s under which a hit scores nothing; playback rate of a whole flight, and in the last SLOW_FOR s of a made shot
const REPEAT = [1, 0.5, 0.25, 0]; // what the 1st, 2nd, 3rd and later hit on one surface are worth

// ponytail: one shared collider list for every shot (levelWorld builds them all each call); nothing writes to it.
let world; const shared = () => world ??= levelWorld();

export function scoreContacts(contacts) {
  const seen = new Map(), surfaces = []; let points = 0, multiplier = 1;
  for (const { surface, speed } of contacts) {
    if (speed < SOFT) continue;
    surfaces.push(surface);
    const n = seen.get(surface) ?? 0, tier = TIERS[surfaceTier(surface)]; seen.set(surface, n + 1);
    points += tier.points * REPEAT[Math.min(n, 3)]; if (!n) multiplier += tier.multiplier;
  }
  return { points: Math.round(points), multiplier, surfaces };
}

export const inZone = (pos, { centre, half }) => {
  const x = pos.x ?? pos[0], y = pos.y ?? pos[1], z = pos.z ?? pos[2];
  return Math.abs(x - centre.x) <= half.x && Math.abs(y - centre.y) <= half.y && Math.abs(z - centre.z) <= half.z;
};

// flight.js reports a contact on every step the item is on a surface (before the bounce is resolved), so a rolling or resting item streams
// events of a few cm/s (and a settling bounce is a soft touch of its own; only contacts of SOFT or more are kept). A touch is the first kept
// event of a run on one surface: the next events within SAME of it are the same touch, and the first one carries the speed into the surface.
// A real bounce back onto one flat face takes at least 5 steps, so it breaks the run. ponytail: two faces with one name (a chair's seat and
// back, a vessel's corner) can rebound in 3-4 steps and count as two touches; accepted.
const SAME = 2.5 * STEP;

// Simulates `body` to its end, consuming it (stepped in place: each shot takes a fresh body): rest, a second floor touch, or 8 s. Made: at rest inside `zone`.
export function runShot(body, zone) {
  const last = new Map(), contacts = []; let floors = 0;
  const out = simulate(body, shared(), { maxTime: MOST_TIME, stop(c) {
    const before = last.get(c.surface);
    if (before !== undefined && c.time - before < SAME) { last.set(c.surface, c.time); return false; }
    if (c.speed < SOFT) return false; // settling, not a hit: scores nothing, isn't a floor touch and opens no run
    last.set(c.surface, c.time);
    contacts.push({ time: c.time, surface: c.surface, speed: c.speed, pos: body.pos.toArray() });
    return c.surface === 'floor' && ++floors >= 2;
  } });
  const made = out.rest && !!zone && inZone(out.pos, zone), { points, multiplier, surfaces } = scoreContacts(contacts);
  return { path: out.path, contacts, time: out.time, made, rest: out.rest, pos: out.pos, points, multiplier, score: made ? points * multiplier : 0, surfaces };
}

const RATE = 1 / (4 * STEP); // path samples per second
const EMPTY = Object.freeze([]);

export function createRun({ start, reducedMotion = false }) {
  let from = null, clock = 0, next = 0; // from: where the item was let go; next: the first contact not yet emitted
  const rate = reducedMotion ? 1 : FLIGHT;
  const run = {
    state: 'aiming', timeScale: 1, result: null, time: 0,
    shoot(body, zone) { from = body.pos.toArray(); run.result = runShot(body, zone); run.state = 'flying'; run.time = clock = 0; next = 0; run.timeScale = rate; },
    reset() { run.state = 'aiming'; run.timeScale = 1; run.result = null; run.time = clock = 0; next = 0; from = null; },
    // The item's place now: aiming, at `start`; flying, along the path (the throw point, a sample every 1/60 s, then where it ended).
    at(out) {
      const r = run.result;
      if (!r || run.state === 'aiming') return out.set(...(start.toArray?.() ?? start));
      const n = r.path.length / 3, k = Math.min(Math.floor(clock * RATE), n), t0 = k / RATE, t1 = k < n ? (k + 1) / RATE : r.time, f = t1 > t0 ? Math.min(1, Math.max(0, (clock - t0) / (t1 - t0))) : 1;
      const p = i => i === 0 ? from : i <= n ? r.path.subarray(i * 3 - 3, i * 3) : r.pos;
      const a = p(k), b = p(k + 1);
      return out.set(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
    },
    // dt real seconds; returns the contacts passed and, once, the end. Slow motion is a rate change at a fixed time, split here so a big dt keeps it.
    advance(dt) {
      const r = run.result; if (run.state !== 'flying') return EMPTY;
      const slowAt = r.made && !reducedMotion ? r.time - SLOW_FOR : Infinity, events = [];
      let t = clock, left = dt > 0 ? dt : 0; // a negative or NaN dt waits
      if (t < slowAt) { const till = (slowAt - t) / rate; if (left < till) { t += left * rate; left = 0; } else { t = slowAt; left -= till; } }
      t += left * SLOW;
      clock = Math.min(t, r.time); run.time = clock;
      for (; next < r.contacts.length && r.contacts[next].time <= clock; next++) { const c = r.contacts[next]; events.push({ type: 'contact', surface: c.surface, speed: c.speed, pos: c.pos, time: c.time }); }
      const over = clock >= r.time;
      if (over) { run.state = 'done'; events.push({ type: 'end', result: r }); }
      run.timeScale = over ? 1 : clock > slowAt ? SLOW : rate;
      return events;
    },
  };
  return run;
}
