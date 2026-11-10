// Paper planes' rules: how a paper plane flies, a course of rings fitted round the office, and flying through them. Pure (no
// document, no three), so node --test flies whole courses; planes.js draws it and takes the controls.
// The plane glides: nose up trades speed for height, nose down the other way, and drag takes speed all the while. Slowing, it
// can lift its nose less and less, so pulled up it levels off and floats rather than stalling. Each ring it goes through pushes
// it on and lifts it a little, so the rings are what keep it up: there's no clock, the run ends when it touches anything.
// Two ways to play: the day's course (makeCourse), or endless rings laid one at a time ahead of it (endless).
import { fnv1a, mulberry32 } from './daily.js';

export const STEP = 1 / 120; // seconds a step
const G = 9.8;
// Pitch (radians): what it trims to with nothing pressed, the most nose up and down; how quickly it gets there.
const GLIDE = -0.08, UP = 0.5, DOWN = 0.6, PITCH = 5;
// Height and speed trade as if gravity were FLOAT of itself: a paper plane here floats more than a real one.
const FLOAT = 0.6;
// Turning at full (rad/s), drag (per metre), what a full turn costs (m/s²); thrown at, a ring's push and the fastest (m/s).
export const TURN = 2, DRAG = 0.078, TURN_DRAG = 0.18, LAUNCH = 3.8, BOOST = 0.55, FASTEST = 6.5;
// Its nose comes all the way up only over CLIMBS (m/s), less and less slower, and not above trim at SLOW.
export const SLOW = 1.6, CLIMBS = 3.2;
// A ring's lift: LIFT m/s up, dying away (about a third of that in metres all told).
const LIFT = 0.6;
export const SIZE = 0.06, HOLE = 0.42; // what the plane touches things from (m); a ring's opening
// Come at slantwise, a ring's opening counts a little wider the way it's slanted (halfway to as wide as head on), to SIDE holes.
const SIDE = 1.5;
// Endless rings narrow by NARROW each, to SMALLEST.
const NARROW = 0.005, SMALLEST = 0.3;

// The course: up to RINGS rings, NEAR to FAR metres on from the last and turning at most BEND (radians) from the way it was going,
// LOW to HIGH up and at most RISE up or FALL down from the last. A ring's middle keeps CLEAR of things, the way to it PATH, other
// rings APART. Anything lower than SEATED from the floor up is somewhere people sit or stand: rings keep above that, or out in the open.
// So do the people at the desks (`people`: { x, z, r, top }, in the chair and stood up behind it), whichever they're doing now.
export const RINGS = 10;
const NEAR = 2.4, FAR = 4, BEND = 1.1, LOW = 0.75, HIGH = 2.45, RISE = 0.4, FALL = 0.6;
const CLEAR = 0.6, PATH = 0.3, APART = 1.4, SEATED = 1.45, TRIES = 80, BACKS = 40, ATTEMPTS = 8;
// The autopilot that tries each course flies with a smaller hole than you do, slower and as fast (a faster plane turns wider),
// so what it gets round you can too.
const TRIAL = { hole: 0.26, drags: [1.25, 1], longest: 60 };

const clamp = (v, a = -1, b = 1) => Math.min(b, Math.max(a, v));
const spin = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
// How far a point is from a box (0 inside it): anything with min and max (THREE.Box3, flight.js's TiltedBox by its outside).
export const gap = (b, x, y, z) => Math.hypot(Math.max(b.min.x - x, 0, x - b.max.x), Math.max(b.min.y - y, 0, y - b.max.y), Math.max(b.min.z - z, 0, z - b.max.z));

// `boxes` by the metre square they're within `margin` of: (x, z) → those a point there might be that near.
function index(boxes, margin) {
  const cells = new Map(), cell = (x, z) => (Math.floor(x) + 99) * 4096 + Math.floor(z) + 99;
  for (const b of boxes) for (let x = Math.floor(b.min.x - margin); x <= b.max.x + margin; x++) for (let z = Math.floor(b.min.z - margin); z <= b.max.z + margin; z++) {
    const k = cell(x, z); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(b);
  }
  return (x, z) => cells.get(cell(x, z)) || [];
}

// What the plane at (x, y, z) touches, or null. `world`: { boxes, columns (people: { id, x, z, r, top }), ceiling, width, depth,
// near? (index of the boxes) }. Out of the office (through a doorway) is the end too.
export function touch(world, x, y, z) {
  if (y < SIZE) return { surface: 'floor' };
  if (y > world.ceiling - SIZE) return { surface: 'ceiling' };
  if (x < 0 || z < 0 || x > world.width || z > world.depth) return { surface: 'away' };
  for (const p of world.columns || []) if (y < p.top + SIZE && Math.hypot(x - p.x, z - p.z) < p.r + SIZE) return { surface: 'person', id: p.id };
  for (const b of world.near ? world.near(x, z) : world.boxes) if (gap(b, x, y, z) < SIZE) return { surface: 'box' };
  return null;
}

// A plane in hand at `start` ({ x, y, z, yaw }; yaw as atan2(dx, dz)), until it's thrown.
export const newFlight = start => ({ x: start.x, y: start.y, z: start.z, yaw: start.yaw, pitch: 0, speed: 0, roll: 0, rise: 0, mode: 'ready', time: 0, next: 0, done: null, hit: null, acc: 0 });
export const launch = f => { if (f.mode !== 'ready') return; f.mode = 'fly'; f.speed = LAUNCH; f.pitch = 0.05; };

// `dt` seconds on, in steps: what happened ({ type: 'ring', index }, { type: 'done' }, { type: 'crash', surface, id? }).
// `input`: { steer, climb }, each -1 to 1 (right, nose up).
export function fly(f, input, world, course, dt) {
  const events = [];
  if (f.mode !== 'fly') return events;
  f.acc += Math.min(dt, 0.1);
  while (f.acc >= STEP && f.mode === 'fly') { f.acc -= STEP; stepFlight(f, input, world, course, events); }
  return events;
}

export function stepFlight(f, input, world, course, events = [], drag = 1) {
  const h = STEP, steer = clamp(input.steer || 0), climb = clamp(input.climb || 0);
  const aim = climb > 0 ? GLIDE + climb * (UP - GLIDE) * clamp((f.speed - SLOW) / (CLIMBS - SLOW), 0, 1) : GLIDE + climb * (DOWN + GLIDE);
  f.pitch += (aim - f.pitch) * (1 - Math.exp(-h * PITCH));
  f.yaw -= steer * TURN * h; // right turns the heading clockwise seen from above
  f.roll += (steer * 0.8 - f.roll) * (1 - Math.exp(-h * 6));
  f.speed = clamp(f.speed + (-G * FLOAT * Math.sin(f.pitch) - DRAG * drag * f.speed * f.speed - TURN_DRAG * Math.abs(steer)) * h, 0.3, FASTEST);
  const px = f.x, py = f.y, pz = f.z, level = Math.cos(f.pitch), d = f.speed * h;
  f.x += Math.sin(f.yaw) * level * d; f.y += Math.sin(f.pitch) * d + f.rise * h; f.z += Math.cos(f.yaw) * level * d; f.time += h;
  f.rise *= Math.exp(-h * 3);
  const ring = course.rings[f.next], hole = course.hole ?? ring?.hole ?? HOLE;
  if (ring) {
    // Through it: across its face, the right way, inside the hole. `along`: how far out it crossed the way it was going (all of
    // that's on the slant), `square`: how square on it came (1 head on).
    const before = (px - ring.x) * ring.nx + (py - ring.y) * ring.ny + (pz - ring.z) * ring.nz, after = (f.x - ring.x) * ring.nx + (f.y - ring.y) * ring.ny + (f.z - ring.z) * ring.nz;
    if (before < 0 && after >= 0) {
      const dx = f.x - px, dy = f.y - py, dz = f.z - pz, moved = Math.hypot(dx, dy, dz), t = before / (before - after);
      const qx = px + dx * t - ring.x, qy = py + dy * t - ring.y, qz = pz + dz * t - ring.z, out = qx * qx + qy * qy + qz * qz;
      const along = (qx * dx + qy * dy + qz * dz) / moved, square = (after - before) / moved;
      if (out < (hole * SIDE) ** 2 && out - along * along / (1 + square) < hole * hole) {
        f.next++; f.speed = Math.min(FASTEST, f.speed + BOOST); f.rise = LIFT; events.push({ type: 'ring', index: f.next - 1 });
        if (f.next === course.rings.length && !course.endless) { f.done = f.time; events.push({ type: 'done' }); }
      }
    }
  }
  const hit = touch(world, f.x, f.y, f.z);
  if (hit) { f.mode = 'over'; f.hit = hit; events.push({ type: 'crash', ...hit }); }
  return events;
}

// Flies at the next ring, coming at it a little square of its face: for trying courses out (and the tests).
export function autopilot(f, { rings }) {
  const ring = rings[f.next]; if (!ring) return { steer: 0, climb: 0 };
  const far = Math.hypot(ring.x - f.x, ring.y - f.y, ring.z - f.z), lead = clamp((far - 0.6) * 0.35, 0, 0.8);
  const tx = ring.x - ring.nx * lead, ty = ring.y - ring.ny * lead, tz = ring.z - ring.nz * lead;
  const pitch = Math.atan2(ty - f.y, Math.hypot(tx - f.x, tz - f.z)), range = pitch > GLIDE ? UP - GLIDE : DOWN + GLIDE;
  return { steer: clamp(-spin(f.yaw, Math.atan2(tx - f.x, tz - f.z)) * 3), climb: clamp((pitch - GLIDE) / range * 1.5) };
}

// How many of `rings` the autopilot gets through from `start`, in order, either way it flies.
function trial(start, rings, world) {
  return Math.min(...TRIAL.drags.map(drag => {
    const f = newFlight(start), course = { rings, hole: TRIAL.hole }; launch(f);
    for (let i = 0; i < TRIAL.longest / STEP && f.mode === 'fly' && f.next < rings.length; i++) stepFlight(f, autopilot(f, course), world, course, undefined, drag);
    return f.next;
  }));
}

// Where rings can go in the office (`boxes`, each place checked only against what's around it).
function field(boxes, { width, depth, ceiling }) {
  const near = index(boxes, CLEAR), off = (x, y, z, room) => near(x, z).every(b => gap(b, x, y, z) >= room);
  // How far on it's open from q heading `yaw` (to 4 m).
  const open = (q, yaw) => { let d = 0; while (d < 4) { const x = q.x + Math.sin(yaw) * (d + 0.25), z = q.z + Math.cos(yaw) * (d + 0.25); if (x < PATH || z < PATH || x > width - PATH || z > depth - PATH || !off(x, q.y, z, PATH)) break; d += 0.25; } return d; };
  return {
    top: Math.min(HIGH, ceiling - CLEAR),
    fits: q => q.x > CLEAR && q.z > CLEAR && q.x < width - CLEAR && q.z < depth - CLEAR && off(q.x, q.y, q.z, CLEAR),
    clear: (a, b, skip) => { const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.15); for (let i = skip ? 3 : 1; i < n; i++) { const t = i / n; if (!off(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t, PATH)) return false; } return true; },
    // The most it's open any way it could turn next: somewhere to go on to.
    onward: (q, yaw) => { let most = 0; for (const k of [0, -0.5, 0.5, -1, 1]) if ((most = Math.max(most, open(q, yaw + k * BEND))) >= 4) break; return most; },
  };
}

// Places for the ring after `p` (a ring, or where it's thrown from: `first`), heading `yaw` there, that fit; best first (most
// room on, and chance; the first, the straighter on the better). `bend`: the most it turns; `height(p)`: how high, given the one
// before; `last`: needn't lead on. The first can be a little off the way it's thrown, for someone standing in the way.
function places(room, p, yaw, rings, rand, { first = false, last = false, bend = BEND, height }) {
  const found = [];
  for (let t = 0; t < TRIES; t++) {
    const a = yaw + (first ? (rand() - 0.5) * 0.9 : (rand() * 2 - 1) * bend), d = first ? 2.2 + rand() * 0.9 : NEAR + rand() * (FAR - NEAR);
    const q = { x: p.x + Math.sin(a) * d, y: clamp(first ? p.y - 0.1 - rand() * 0.15 : height(p), LOW, room.top), z: p.z + Math.cos(a) * d };
    if (!room.fits(q) || rings.some(r => Math.hypot(r.x - q.x, r.y - q.y, r.z - q.z) < APART) || !room.clear(p, q, first)) continue;
    const on = last ? 4 : room.onward(q, a); if (on < NEAR + CLEAR) continue; // a dead end
    found.push({ q, a, score: on / 4 + rand() * 0.6 - (first ? Math.abs(a - yaw) * 1.5 : 0) });
  }
  return found.sort((m, n) => n.score - m.score);
}

// Facing ring `i` along the way through it: from the one before (or `start`) to the one after (the last, from the one before).
function face(rings, i, start) {
  const r = rings[i], a = i ? rings[i - 1] : start, b = rings[i + 1] || r, nx = b.x - a.x, ny = b.y - a.y, nz = b.z - a.z, n = Math.hypot(nx, ny, nz) || 1;
  Object.assign(r, { nx: nx / n, ny: ny / n, nz: nz / n });
}

// Rings from `start` on, each where `rand` picks among places that fit; facing along the way through them.
function lay(start, boxes, office, count, rand) {
  const room = field(boxes, office), height = p => p.y - FALL + rand() * (FALL + RISE);
  // Nowhere left to go, it takes the last ring back and tries again from the one before (up to BACKS times).
  const rings = [], yaws = [start.yaw]; let longest = [], backs = 0;
  while (rings.length < count) {
    const i = rings.length, pick = places(room, i ? rings[i - 1] : start, yaws[i], rings, rand, { first: !i, last: i === count - 1, height })[0];
    if (pick) { rings.push(pick.q); yaws.push(pick.a); if (rings.length > longest.length) longest = rings.slice(); continue; }
    if (!i || backs++ >= BACKS) break;
    rings.pop(); yaws.pop();
  }
  const laid = longest.map(r => ({ x: r.x, y: r.y, z: r.z }));
  laid.forEach((_, i) => face(laid, i, start));
  return laid;
}

// A course from `start` round the office's `boxes`, the same for the same `seed` and boxes: the attempt the autopilot got
// furthest round, up to the last ring it made. { rings: [{ x, y, z, nx, ny, nz }], par }; may be empty if nothing fits.
// `par`: the autopilot's time round it, the rings as anyone flies them (null if it doesn't get round), for the medals.
export function makeCourse({ start, boxes, people, width, depth, ceiling = 3, seed = '', count = RINGS }) {
  const { tall, world } = office(boxes, people, width, depth, ceiling), room = { width, depth, ceiling };
  let best = [];
  for (let attempt = 0; attempt < ATTEMPTS && best.length < count; attempt++) {
    const rings = lay(start, tall, room, count, mulberry32(fnv1a(`planes:${seed}:${attempt}`))), made = trial(start, rings, world);
    if (made > best.length) best = rings.slice(0, made);
  }
  const f = newFlight(start), course = { rings: best }; launch(f);
  for (let i = 0; best.length && i < TRIAL.longest / STEP && f.mode === 'fly' && f.done == null; i++) stepFlight(f, autopilot(f, course), world, course);
  return { rings: best, par: f.done };
}

// Medals for a time round a course, as many times its par, to a tenth of a second as they show. The autopilot flies about
// as tight a line as there is (sharper or diving pilots gain a percent at most), so gold is within a breath of it, silver a
// clean run, bronze round without going back for one; a pilot a beat late (0.15 s) makes gold about half the time.
export const MEDALS = [['🥇', 1.1], ['🥈', 1.3], ['🥉', 1.6]];
export const medalTime = (par, k) => Math.round(par * k * 10) / 10;
export const medal = (time, par) => time == null || !par ? null : MEDALS.find(([, k]) => Math.round(time * 10) / 10 <= medalTime(par, k))?.[0] ?? null;

// Endless rings from `start`: { rings, endless: true, more(f) }. `more` lays on so there are always AHEAD past the next one
// showing, and SPARE more out of sight, so a dead end can be taken back unseen. Each new ring is one the autopilot gets
// through within REACH seconds, flying on from how it came through the one before; facing the way in from that one, a little
// narrower, heights wandering about the middle of the room. With nowhere to go on it bends further. Random unless `seed`.
export const AHEAD = 3;
const SPARE = 3, REACH = 4;
export function endless({ start, boxes, people, width, depth, ceiling = 3, seed = null }) {
  const { tall, world } = office(boxes, people, width, depth, ceiling), room = field(tall, { width, depth, ceiling });
  const rand = seed == null ? Math.random : mulberry32(fnv1a(`planes-endless:${seed}`));
  const height = p => p.y + (rand() * 2 - 1) * RISE + (1.55 - p.y) * 0.25;
  const thrown = newFlight(start); launch(thrown);
  // How the autopilot's come through each ring, slower and as fast (TRIAL.drags), to fly on from.
  const rings = [], yaws = [start.yaw], states = [TRIAL.drags.map(() => thrown)];
  // First time, not on a go round after missing it: the way round would be one only a miss takes, the next ring laid for that.
  const reach = (from, ring, drag) => {
    const f = { ...from, next: 0, done: null }, course = { rings: [ring], hole: TRIAL.hole };
    const short = () => (f.x - ring.x) * ring.nx + (f.y - ring.y) * ring.ny + (f.z - ring.z) * ring.nz < 0;
    for (let i = 0; i < REACH / STEP && f.mode === 'fly' && !f.next && short(); i++) stepFlight(f, autopilot(f, course), world, course, undefined, drag);
    return f.next ? f : null;
  };
  const add = () => {
    const i = rings.length, p = rings[i - 1] || start;
    for (const bend of [BEND, BEND * 1.8, Math.PI]) {
      for (const { q, a } of places(room, p, yaws[i], rings.slice(-6), rand, { first: !i, bend, height }).slice(0, 8)) {
        const ring = { ...q, hole: Math.max(SMALLEST, HOLE - NARROW * i) }, n = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
        Object.assign(ring, { nx: (q.x - p.x) / n, ny: (q.y - p.y) / n, nz: (q.z - p.z) / n });
        const through = TRIAL.drags.map((drag, k) => reach(states[i][k], ring, drag));
        if (through.every(Boolean)) { rings.push(ring); yaws.push(a); states.push(through); return true; }
      }
    }
    return false;
  };
  // Lays on, taking back rings from `seen` on at a dead end (none seen yet before it's thrown).
  const lay = (want, seen, most) => {
    for (let backs = 0; rings.length < want && backs < most;) {
      if (add()) continue;
      if (rings.length <= seen) break;
      rings.pop(); yaws.pop(); states.pop(); backs++;
    }
  };
  const course = { rings, endless: true, more: f => lay(f.next + AHEAD + 1 + SPARE, f.next + AHEAD + 1, 20) };
  lay(AHEAD + 1 + SPARE, 0, 60);
  return course;
}

// The office's boxes (those in it, or about it), the low ones as tall as anyone sitting or standing there, and people's columns
// as boxes too; and it to fly in, people and all.
function office(boxes, people = [], width, depth, ceiling) {
  const near = boxes.filter(b => b.max.x > -1 && b.min.x < width + 1 && b.max.z > -1 && b.min.z < depth + 1);
  const tall = near.map(b => b.max.y < SEATED && b.min.y < 0.5 ? { min: b.min, max: { x: b.max.x, y: SEATED, z: b.max.z } } : b);
  for (const p of people) tall.push({ min: { x: p.x - p.r, y: 0, z: p.z - p.r }, max: { x: p.x + p.r, y: p.top, z: p.z + p.r } });
  return { tall, world: { boxes: near, near: index(near, SIZE * 2), columns: people, ceiling, width, depth } };
}

// Whether `course` still does in the office as it is now (things moved, desks came and went): every ring clear and the
// autopilot round it. So a course only changes when it has to.
export function holds({ rings }, { start, boxes, people, width, depth, ceiling = 3 }) {
  const { tall, world } = office(boxes, people, width, depth, ceiling);
  return rings.length > 0 && rings.every(r => r.x > CLEAR && r.z > CLEAR && r.x < width - CLEAR && r.z < depth - CLEAR && tall.every(b => gap(b, r.x, r.y, r.z) >= CLEAR * 0.9))
    && trial(start, rings, world) === rings.length;
}

// Better than `best` ({ rings, time } or null): more rings, or as many sooner.
export const better = (run, best) => !best || run.rings > best.rings || (run.rings === best.rings && run.time != null && (best.time == null || run.time < best.time));
