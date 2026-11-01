import { STEP, simulate } from './flight.js';
import { TIERS, surfaceTier, levelWorld } from './kitchen-plan.js';

// Trickshot scoring and playback, Node-runnable. A shot is simulated whole at release (runShot), then played back (createRun), so slow
// motion can start before the score is known to the player. Coordinates are kitchen-local, as in kitchen-plan.js.
export const SOFT = 0.5, FLIGHT = 0.45, SLOW = 0.15, SLOW_FOR = 0.5, RETRY = 1, LONGEST = 10; // m/s under which a hit scores nothing; playback rate of a whole flight, and in the last SLOW_FOR s of a made shot; real s after release a click retries, and a miss is cut off
export const MOST_TIME = 8, SETTLE = 1, HARD_TIME = 20; // past MOST_TIME a shot ends once the item's been SETTLE s on a surface; HARD_TIME's only a guard against one that never does
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

// Hops shorter than this (3 mm high) aren't in the air: a wedged thing rattling, say.
const ON_IT = 0.05;

// Simulates `body` to its end, consuming it (stepped in place: each shot takes a fresh body): at rest, or past MOST_TIME and SETTLE s on a surface, in the air it plays on. Made: at rest inside `zone`.
export function runShot(body, zone) {
  const last = new Map(), contacts = []; let now = 0, on = 0, touched = -1;
  const out = simulate(body, shared(), { maxTime: HARD_TIME, stop(c) {
    if (now - touched > ON_IT) on = now; touched = now;
    const before = last.get(c.surface);
    if (before !== undefined && c.time - before < SAME) { last.set(c.surface, c.time); return false; }
    if (c.speed < SOFT) return false; // settling, not a hit: scores nothing and opens no run
    last.set(c.surface, c.time);
    contacts.push({ time: c.time, surface: c.surface, speed: c.speed, pos: body.pos.toArray() });
    return false;
  }, until() {
    now += STEP;
    return now >= MOST_TIME - 1e-9 && now - touched <= ON_IT && now - on >= SETTLE;
  } });
  const made = out.rest && !!zone && inZone(out.pos, zone), { points, multiplier, surfaces } = scoreContacts(contacts);
  return { path: out.path, contacts, time: out.time, made, rest: out.rest, pos: out.pos, points, multiplier, score: made ? points * multiplier : 0, surfaces };
}

const RATE = 1 / (4 * STEP); // path samples per second
const EMPTY = Object.freeze([]);
const touch = c => ({ type: 'contact', surface: c.surface, speed: c.speed, pos: c.pos, time: c.time });

// `now`: real seconds, as frames' dt are clamped and a slow machine's would stretch RETRY and LONGEST. Without it, flown adds up the dts it's given.
export function createRun({ start, reducedMotion = false, now = null }) {
  let from = null, clock = 0, next = 0, hits = EMPTY, released = 0; // from: where the item was let go; next: the first of hits not yet emitted
  const rate = reducedMotion ? 1 : FLIGHT;
  const run = {
    state: 'aiming', timeScale: 1, result: null, time: 0, flown: 0, // flown: real seconds since release
    shoot(body, zone) { from = body.pos.toArray(); run.result = runShot(body, zone); hits = run.result.contacts; run.state = 'flying'; run.time = clock = run.flown = 0; next = 0; run.timeScale = rate; released = now?.() ?? 0; },
    reset() { run.state = 'aiming'; run.timeScale = 1; run.result = null; run.time = clock = run.flown = 0; next = 0; hits = EMPTY; from = null; },
    get retrying() { return run.state === 'done' || run.state === 'flying' && run.flown >= RETRY; },
    // The item's place now: aiming, at `start`; flying, along the path (the throw point, a sample every 1/60 s, then where it ended).
    at(out) {
      const r = run.result;
      if (!r || run.state === 'aiming') return out.set(...(start.toArray?.() ?? start));
      const n = r.path.length / 3, k = Math.min(Math.floor(clock * RATE), n), t0 = k / RATE, t1 = k < n ? (k + 1) / RATE : r.time, f = t1 > t0 ? Math.min(1, Math.max(0, (clock - t0) / (t1 - t0))) : 1;
      const p = i => i === 0 ? from : i <= n ? r.path.subarray(i * 3 - 3, i * 3) : r.pos;
      const a = p(k), b = p(k + 1);
      return out.set(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
    },
    // dt real seconds; returns the contacts passed and, once, the end. The rate changes at a time known at release, split here so a big dt keeps it: a made shot slows for its last SLOW_FOR s, a miss
    // settles at full speed after its last hit. A rubber ball's miss bounces for 10 s and more: nothing it does can matter, so that's cut off (run.time short of result.time).
    advance(dt) {
      const r = run.result; if (run.state !== 'flying') return EMPTY;
      const turn = reducedMotion ? Infinity : r.made ? r.time - SLOW_FOR : r.contacts.at(-1)?.time ?? r.time, after = r.made ? SLOW : 1, real = dt > 0 ? dt : 0, events = [];
      let t = clock, left = real; // a negative or NaN dt waits
      run.flown = now ? now() - released : run.flown + real;
      if (t < turn) { const till = (turn - t) / rate; if (left < till) { t += left * rate; left = 0; } else { t = turn; left -= till; } }
      t += left * after;
      clock = Math.min(t, r.time); run.time = clock;
      for (; next < hits.length && hits[next].time <= clock; next++) events.push(touch(hits[next]));
      const over = clock >= r.time || !r.made && run.flown >= LONGEST;
      if (over) { run.state = 'done'; events.push({ type: 'end', result: r }); }
      run.timeScale = over ? 1 : clock >= turn ? after : rate;
      return events;
    },
  };
  return run;
}
