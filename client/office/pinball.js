// Pinball in the secret room: Tutti Frutti, a wide-body fruit table against the front wall between the beanbags and the
// green (the far end is the green's). Click the cabinet to step up: the view looks down the playfield, steeper on a narrow
// screen so all of it fits. Flippers: ← →, A D, Z M or the Shifts, or press the left or right half of the screen (a finger
// each works); the plunger: hold Space, S or ↓, or either half while a ball waits in the lane, and let go; nudge: ↑ or W
// (three in a few seconds is a tilt). A flip starts a game; leaving pauses it.
// Three balls, and shots that flow: both wire ramps drop the ball back into an inlane, onto a flipper, so they chain into
// combos. Each shot holds a fruit (the orbit a banana, the ramps a strawberry and grapes, the juicer an orange, the drop
// targets a lemon, the J-U-I-C-E lanes cherries); collect all six for Fruit Salad, thirty seconds of triple scoring. The
// lanes light as the ball rolls through (the flippers shift which are lit) and all five raise the multiplier, up to 5×;
// the drop targets start multiball, when the juicer pays the jackpot. Four pop bumpers (an orange, a lime, cherries and a
// lemon), watermelon slingshots, a spinner in the orbit (25 spins relight the kickback in the left outlane) and the
// blender, a spinning disc mid-table that whirls the ball off somewhere. The lane flashing as a ball is served is the
// skill shot, and a ball that drains in its first 8 s comes back once. The score shows on the backbox and again on the
// apron (which reads from above on a phone); the best is kept per browser.
// The table is flat (x across, y up it, metres; a ramp adds height h), stepped at 1 kHz by the pure part below, which runs
// under node --test; the 3D and the sound follow it. With reduced motion there's no shake, flashing, juice or chasing
// lamps; the game itself still moves.
import * as THREE from 'three';
import { mesh, paint, painted, canvasTexture, glowTexture } from './furniture.js';
import { SECRET } from './secret.js';

export const R = 0.0135, G = 1.6, DT = 1 / 1000, BALLS = 3; // ball radius (m), the table's pull down it (m/s²), a step (s)
// Seconds of ball save, skill shot, combo window and Fruit Salad; to pull the plunger right back; the fastest a ball goes
// (m/s); how hard a ramp's rise pulls back (m/s² per unit of slope); the blender's spin (rad/s).
const SAVE = 8, SKILL = 4, COMBO = 3, SALAD = 30, PULL = 0.9, TOP = 5, LIFT = 8, BLEND = 9;
// The lane a ball is served into (its middle, inner wall and outer wall), the left wall, and the arc over the top.
export const LANE = { x: 0.3025, wall: 0.28, out: 0.325, top: 0.82 }, LEFT = -0.28, ARC = { x: 0.0225, y: 0.8475, r: 0.3025 };
// m; rad/s up and back; bounce off a swinging flipper, and off a still one (dead rubber, so the ball can be caught).
export const FLIP = { len: 0.085, base: 0.011, tip: 0.006, up: 40, down: 18, e: 0.5, dead: 0.15 };
// What each shot collects: the orbit, the left ramp, the right ramp, the juicer, the drop targets, the lanes.
export const FRUITS = ['banana', 'strawberry', 'grape', 'orange', 'lemon', 'cherry'];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// A smooth path through [x, y, h] points (Catmull-Rom), as samples with how far along each is (s).
function spline(points) {
  const at = i => points[clamp(i, 0, points.length - 1)], out = [];
  for (let i = 0; i < points.length - 1; i++) for (let k = 0; k < 10; k++) {
    const u = k / 10, [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    out.push([0, 1, 2].map(j => 0.5 * (2 * p1[j] + (p2[j] - p0[j]) * u + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u * u + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * u ** 3)));
  }
  out.push(points.at(-1));
  let s = 0;
  return out.map((p, i) => ({ x: p[0], y: p[1], h: p[2], s: s += i ? Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1], p[2] - out[i - 1][2]) : 0 }));
}

export const TABLE = (() => {
  const walls = [], posts = [], slings = [];
  // A wall is a line `h` thick either side; `e` is how much of the speed into it a ball keeps. A slingshot's are under its
  // watermelon, and its face kicks.
  const wall = (x1, y1, x2, y2, h = 0.003, e = 0.35, sling, kick) => walls.push({ x1, y1, x2, y2, h, e, sling, kick });
  const post = (x, y, r = 0.004, e = 0.55) => posts.push({ x, y, r, e });
  wall(LANE.out, -0.06, LANE.out, ARC.y, 0.004);
  for (let i = 0; i < 36; i++) { const a = Math.PI * i / 36, b = Math.PI * (i + 1) / 36; wall(ARC.x + ARC.r * Math.cos(a), ARC.y + ARC.r * Math.sin(a), ARC.x + ARC.r * Math.cos(b), ARC.y + ARC.r * Math.sin(b), 0.004); }
  wall(LEFT, ARC.y, LEFT, 0, 0.004);
  wall(LANE.wall, -0.06, LANE.wall, LANE.top, 0.004); post(LANE.wall, LANE.top);
  // Each side, the left as written and the right mirrored: the outlane's divider, the inlane's floor down onto the flipper
  // (aimed past the pivot, so a ball rolling off it meets the flipper's base along its curve, not head on), and the
  // slingshot (its face, a to c, kicks).
  for (const s of [1, -1]) {
    const X = x => x * s, i = slings.length;
    wall(X(-0.238), 0.4, X(-0.238), 0.29); post(X(-0.238), 0.4);
    wall(X(-0.238), 0.29, X(-0.103), 0.1637);
    const a = [X(-0.195), 0.39], b = [X(-0.195), 0.305], c = [X(-0.135), 0.255];
    wall(...a, ...b, 0.003, 0.35, i); wall(...b, ...c, 0.003, 0.35, i); wall(...a, ...c, 0.003, 0.3, i, true); for (const p of [a, b, c]) post(...p, 0.005);
    slings.push([a, b, c]);
  }
  // The orbit up the left, and a post where what comes back down it meets the outlane.
  wall(-0.235, 0.52, -0.235, 0.84); post(-0.235, 0.84, 0.005); wall(-0.235, 0.52, -0.215, 0.49); post(-0.215, 0.49); post(-0.262, 0.455, 0.008);
  // The ramps' mouths: walls either side, and a roof across the back (under the ramp) sloping so nothing sits on it.
  wall(-0.168, 0.54, -0.168, 0.66); post(-0.168, 0.54); wall(-0.235, 0.69, -0.168, 0.66); post(-0.168, 0.66);
  wall(0.136, 0.6, 0.136, 0.72); wall(0.204, 0.6, 0.204, 0.75); post(0.136, 0.6); post(0.204, 0.6); wall(0.204, 0.75, 0.136, 0.72); post(0.136, 0.72);
  for (const x of [-0.15, -0.09, -0.03, 0.03, 0.09, 0.15]) { wall(x, 0.95, x, 1.01); post(x, 0.95); post(x, 1.01); } // the lanes' guides
  wall(0.27, 0.41, 0.27, 0.56, 0.002); // behind the drop targets, so one that's down leaves no pocket to sit in
  return {
    walls, posts, slings,
    bumpers: [[-0.09, 0.87], [0.05, 0.87], [-0.02, 0.77], [0.12, 0.79]].map(([x, y]) => ({ x, y, r: 0.03 })),
    targets: [0.44, 0.485, 0.53].map(y => ({ x: 0.262, y, h: 0.018 })), // upright, `h` either way along y
    lanes: [-0.12, -0.06, 0, 0.06, 0.12].map(x => ({ x, y: 0.98 })),
    saucer: { x: 0.24, y: 0.69 },
    blender: { x: 0, y: 0.53, r: 0.05 },
    spinner: { x1: -0.276, x2: -0.239, y: 0.66 },
    kickback: { x: -0.259, y: 0.12 },
    // One way: the lane's lets balls out but not back down it; the orbit's lets them up it but turns away what comes down
    // the arc (a launch) into the playfield.
    gates: [{ x1: LANE.wall, y1: 0.835, x2: LANE.out, y2: 0.875 }, { x1: LEFT, y1: 0.875, x2: -0.235, y2: 0.845, orbit: true }],
    // Wire ramps: their mouths (x from, x to, the line at y that takes the ball on) and paths, which end over an inlane.
    ramps: [
      { mouth: [-0.231, -0.171, 0.6], path: spline([[-0.201, 0.6, 0], [-0.201, 0.68, 0.04], [-0.19, 0.8, 0.085], [-0.13, 0.95, 0.11], [-0.02, 1.04, 0.125], [0.12, 1.02, 0.12], [0.235, 0.92, 0.105], [0.25, 0.78, 0.085], [0.235, 0.62, 0.05], [0.2165, 0.5, 0.012], [0.2165, 0.45, 0]]) },
      { mouth: [0.14, 0.2, 0.66], path: spline([[0.17, 0.66, 0], [0.17, 0.74, 0.035], [0.165, 0.86, 0.07], [0.09, 0.99, 0.085], [-0.05, 1.03, 0.09], [-0.17, 0.98, 0.085], [-0.255, 0.87, 0.075], [-0.257, 0.72, 0.055], [-0.235, 0.58, 0.03], [-0.2165, 0.5, 0.01], [-0.2165, 0.45, 0]]) },
    ],
    flippers: [{ x: -0.1, y: 0.15, rest: -0.5, up: 0.5 }, { x: 0.1, y: 0.15, rest: Math.PI + 0.5, up: Math.PI - 0.5 }],
  };
})();

const P = { x: 0, y: 0 }, N = { x: 0, y: 0 };
// The point on a segment nearest (x, y), into P; returns how far along it that is (0 to 1).
function nearest(x, y, x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1, k = clamp(((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy), 0, 1); P.x = x1 + dx * k; P.y = y1 + dy * k; return k; }
// Ball `b` within `reach` of (cx, cy): pushed out to it, and bounced off a surface there moving at (sx, sy), keeping `e` of
// its speed in. The normal is left in N. Returns how hard it hit, 0 if it doesn't touch.
function touch(b, cx, cy, reach, e, sx = 0, sy = 0) {
  let nx = b.x - cx, ny = b.y - cy; const d = Math.hypot(nx, ny);
  if (d >= reach || d < 1e-9) return 0;
  nx /= d; ny /= d; N.x = nx; N.y = ny; b.x = cx + nx * reach; b.y = cy + ny * reach;
  const vn = (b.vx - sx) * nx + (b.vy - sy) * ny;
  if (vn < 0) { b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; }
  return Math.max(-vn, 1e-6);
}
// Which side of a gate (x, y) is: positive on the side it stops.
const side = (g, x, y) => { const gx = g.x2 - g.x1, gy = g.y2 - g.y1, l = Math.hypot(gx, gy); return ((x - g.x1) * -gy + (y - g.y1) * gx) / l; };

const fresh = () => ({ score: 0, mult: 1, lit: [false, false, false, false, false], targets: [true, true, true], fruits: FRUITS.map(() => false), resetAt: 0, multiball: false,
  saladUntil: 0, combo: 0, comboUntil: 0, kickback: true, spins: 0, saveUntil: 0, tilted: false, nudges: [] });
export function newTable(best = 0) {
  return { mode: 'attract', time: 0, balls: [], flippers: TABLE.flippers.map(f => ({ ...f, a: f.rest, w: 0 })), input: { left: false, right: false, plunge: false, nudge: false }, was: {},
    pull: 0, last: 0, best, ball: 0, launched: false, skillUntil: 0, skillLane: 0, cool: [0, 0, 0, 0, 0], hitAt: {}, overAt: -Infinity, message: null, events: [],
    spinAngle: 0, spinSpeed: 0, spinCount: 0, blendAngle: 0, blendFor: 0, ...fresh() };
}
// A ball on the plunger, waiting to go.
export const waiting = t => t.balls.some(b => b.x > LANE.wall && b.y < 0.1);
const serve = t => { t.balls.push({ x: LANE.x, y: R + 0.005, vx: 0, vy: 0 }); t.launched = false; t.tilted = false; t.skillUntil = Infinity; t.skillLane = t.ball % 5; };
const say = (t, text) => { t.message = { text, at: t.time }; };
const award = (t, points) => { t.score += points * t.mult * (t.time < t.saladUntil ? 3 : 1); };
export function start(t) { Object.assign(t, fresh(), { mode: 'play', ball: 1, balls: [] }); serve(t); say(t, 'BALL 1'); t.events.push({ kind: 'start' }); }
// A shot's fruit, if it hasn't been had; all six start Fruit Salad. True if it was new.
function collect(t, i) {
  if (t.fruits[i]) return false;
  t.fruits[i] = true; award(t, 2500); say(t, FRUITS[i].toUpperCase()); t.events.push({ kind: 'fruit', i });
  if (t.fruits.every(Boolean)) { t.fruits = FRUITS.map(() => false); t.saladUntil = t.time + SALAD; say(t, 'FRUIT SALAD'); t.events.push({ kind: 'salad' }); }
  return true;
}
// A ramp or the orbit made: its points, its fruit, and more for each one made hard on the heels of the last.
function shot(t, points, fruit, x, y) {
  t.combo = t.time < t.comboUntil ? t.combo + 1 : 0; t.comboUntil = t.time + COMBO;
  award(t, points + t.combo * 2500);
  if (!collect(t, fruit) && t.combo) say(t, `COMBO ×${t.combo + 1}`);
  t.events.push({ kind: 'shot', i: fruit, x, y, combo: t.combo });
}

// One step of DT: flippers, plunger and nudges from t.input, every ball, then what drained. What happened goes in t.events.
export function step(t) {
  t.time += DT;
  for (const [key, i] of [['left', 0], ['right', 1]]) {
    const down = t.input[key] && !t.tilted;
    if (down && !t.was[key]) {
      if (t.mode !== 'play' && t.time - t.overAt > 1.5) start(t);
      else if (t.mode === 'play') t.lit = i ? [t.lit.at(-1), ...t.lit.slice(0, -1)] : [...t.lit.slice(1), t.lit[0]]; // lane change
      t.events.push({ kind: 'flip', i });
    }
    t.was[key] = down;
    const f = t.flippers[i], goal = down ? f.up : f.rest, speed = down ? FLIP.up : FLIP.down, d = goal - f.a;
    if (Math.abs(d) <= speed * DT) { f.a = goal; f.w = 0; } else { f.w = Math.sign(d) * speed; f.a += f.w * DT; }
  }
  // A nudge shoves every ball on the playfield up the table a little; a third within four seconds tilts, and the flippers
  // go dead until the ball's gone.
  if (t.input.nudge && !t.was.nudge && t.mode === 'play' && !t.tilted) {
    for (const b of t.balls) if (!b.ramp && !b.held) { b.vy += 0.35; b.vx += 0.25 * Math.sin(t.time * 977); }
    t.nudges = [...t.nudges.filter(at => t.time - at < 4), t.time];
    if (t.nudges.length >= 3) { t.tilted = true; say(t, 'TILT'); t.events.push({ kind: 'tilt' }); } else if (t.nudges.length === 2) say(t, 'CAREFUL');
    t.events.push({ kind: 'nudge' });
  }
  t.was.nudge = t.input.nudge;
  // The plunger pulls back while held and fires the ball sitting on it as it's let go, harder the further it was pulled;
  // barely pulled (a tap, or a press that was for a flipper), it just goes back.
  if (t.input.plunge && t.mode === 'play') t.pull = Math.min(1, t.pull + DT / PULL);
  else if (t.pull) {
    if (t.pull > 0.15) for (const b of t.balls) if (b.x > LANE.wall && b.y < plungerY(t) + R + 0.016) { b.y = R + 0.0045; b.vy = 0.9 + 2.5 * t.pull; launch(t); } // up with the plunger
    t.pull = 0;
  }
  if (t.resetAt && t.time > t.resetAt) { t.targets = [true, true, true]; t.resetAt = 0; }
  // The spinner turns down from however fast it was flicked, a hundred points a half turn.
  t.spinAngle += t.spinSpeed * DT; t.spinSpeed *= 1 - 1.5 * DT;
  if (t.spinAngle - t.spinCount * Math.PI >= Math.PI) {
    t.spinCount++; award(t, 100); t.events.push({ kind: 'spin' });
    if (++t.spins >= 25 && !t.kickback) { t.kickback = true; t.spins = 0; say(t, 'KICKBACK LIT'); }
  }
  t.blendAngle += BLEND * (t.time < t.saladUntil ? 2 : 1) * DT;
  for (const b of t.balls) move(t, b);
  // Balls knock into each other (the same weight).
  for (let i = 0; i < t.balls.length; i++) for (let j = i + 1; j < t.balls.length; j++) {
    const a = t.balls[i], b = t.balls[j]; if (a.held || b.held || a.ramp || b.ramp) continue;
    let nx = b.x - a.x, ny = b.y - a.y; const d = Math.hypot(nx, ny); if (d >= 2 * R || d < 1e-9) continue;
    nx /= d; ny /= d; const push = (2 * R - d) / 2, vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
    if (vn < 0) { const k = 0.95 * vn; a.vx += k * nx; a.vy += k * ny; b.vx -= k * nx; b.vy -= k * ny; }
  }
  if (!t.balls.some(b => b.gone)) return;
  for (const b of t.balls) if (b.gone) t.events.push({ kind: 'drain', x: b.x, y: b.y });
  t.balls = t.balls.filter(b => !b.gone);
  if (t.balls.length < 2) t.multiball = false;
  if (t.mode !== 'play' || t.balls.length) return;
  if (t.time < t.saveUntil && !t.tilted) { t.saveUntil = 0; serve(t); t.launched = true; say(t, 'BALL SAVED'); t.events.push({ kind: 'saved' }); return; }
  t.mult = 1; t.lit = t.lit.map(() => false); t.saladUntil = 0;
  if (t.ball < BALLS) { t.ball++; serve(t); say(t, `BALL ${t.ball}`); return; }
  t.mode = 'over'; t.overAt = t.time; t.last = t.score; t.best = Math.max(t.best, t.score); say(t, 'GAME OVER'); t.events.push({ kind: 'over' });
}
const plungerY = t => -0.035 * t.pull;
// The first launch of a served ball starts its ball save and the skill shot's clock.
function launch(t) { t.events.push({ kind: 'launch' }); if (t.launched) return; t.launched = true; t.saveUntil = t.time + SAVE; t.skillUntil = t.time + SKILL; }

// Along a ramp: slowed by its rise (and rolling), sped by its fall. Back out of the mouth if it doesn't make it, else
// dropped off the end into the inlane, and the shot is made.
function ride(t, b) {
  const r = b.ramp, path = TABLE.ramps[r.i].path, last = path.length - 1;
  const a = path[r.k], c = path[r.k + 1];
  r.v -= ((G * (c.y - a.y) + LIFT * (c.h - a.h)) / (c.s - a.s) + Math.sign(r.v) * 0.3) * DT; r.s += r.v * DT;
  while (r.k < last - 1 && path[r.k + 1].s < r.s) r.k++;
  while (r.k > 0 && path[r.k].s > r.s) r.k--;
  const p = path[r.k], q = path[r.k + 1], u = clamp((r.s - p.s) / (q.s - p.s), 0, 1), drift = r.dx * Math.max(0, 1 - r.s / 0.06);
  b.x = p.x + (q.x - p.x) * u + drift; b.y = p.y + (q.y - p.y) * u; b.h = p.h + (q.h - p.h) * u;
  const out = (from, to, v) => { const dx = to.x - from.x, dy = to.y - from.y, l = Math.hypot(dx, dy); b.vx = dx / l * v; b.vy = dy / l * v; b.ramp = null; b.h = 0; };
  if (r.s <= 0) { b.x = path[0].x + r.dx; b.y = path[0].y - 0.001; out(path[1], path[0], -r.v); }
  else if (r.s >= path[last].s) { b.x = path[last].x; b.y = path[last].y; out(path[last - 1], path[last], Math.max(0.4, r.v)); shot(t, 5000, r.i + 1, b.x, b.y); }
}

function move(t, b) {
  if (b.held) { if (t.time < b.held) return; b.held = 0; b.free = t.time + 0.5; b.vx = -0.7; b.vy = -1.1; t.events.push({ kind: 'eject', x: b.x, y: b.y }); }
  if (b.auto && t.time > b.auto) { b.auto = 0; b.vy = 3; launch(t); }
  if (b.ramp) { ride(t, b); return; }
  b.vy -= G * DT;
  const speed = Math.hypot(b.vx, b.vy); if (speed > TOP) { b.vx *= TOP / speed; b.vy *= TOP / speed; }
  const px = b.x, py = b.y; b.x += b.vx * DT; b.y += b.vy * DT;
  const ev = t.events, ready = key => { if (t.time - (t.hitAt[key] ?? -1) < 0.08) return false; t.hitAt[key] = t.time; return true; };
  // Up into a ramp's mouth: onto the ramp.
  for (const [i, { mouth: [x1, x2, y] }] of TABLE.ramps.entries()) {
    if (py < y && b.y >= y && b.x > x1 && b.x < x2 && b.vy > 0) { b.ramp = { i, s: 0.001, v: b.vy, k: 0, dx: b.x - TABLE.ramps[i].path[0].x }; ev.push({ kind: 'up', i }); return; }
  }
  for (const w of TABLE.walls) {
    nearest(b.x, b.y, w.x1, w.y1, w.x2, w.y2);
    const hit = touch(b, P.x, P.y, R + w.h, w.e);
    // A slingshot kicks back anything that comes at it with a bit of pace.
    if (w.kick && hit > 0.15 && ready(`s${w.sling}`)) { b.vx += N.x * 1.1; b.vy += N.y * 1.1; award(t, 10); ev.push({ kind: 'sling', i: w.sling, x: b.x, y: b.y, hit }); }
    else if (hit > 0.6 && ready('wall')) ev.push({ kind: 'wall', hit });
  }
  for (const p of TABLE.posts) { const hit = touch(b, p.x, p.y, R + p.r, p.e); if (hit > 0.6 && ready('wall')) ev.push({ kind: 'wall', hit }); }
  TABLE.bumpers.forEach((p, i) => {
    const hit = touch(b, p.x, p.y, R + p.r, 0.5);
    if (hit && ready(`b${i}`)) { b.vx += N.x * 1.3; b.vy += N.y * 1.3; award(t, 100); ev.push({ kind: 'bump', i, x: p.x, y: p.y, hit }); }
  });
  TABLE.targets.forEach((g, i) => {
    if (!t.targets[i]) return;
    nearest(b.x, b.y, g.x, g.y - g.h, g.x, g.y + g.h);
    if (!touch(b, P.x, P.y, R + 0.004, 0.3)) return;
    t.targets[i] = false; award(t, 750); ev.push({ kind: 'target', i, x: g.x, y: g.y });
    if (t.targets.some(up => up)) return;
    award(t, 5000); t.resetAt = t.time + 1.5; collect(t, 4);
    if (t.multiball) return;
    t.multiball = true; t.balls.push({ x: LANE.x, y: R + 0.005, vx: 0, vy: 0, auto: t.time + 0.8 }); say(t, 'MULTIBALL'); ev.push({ kind: 'multiball' });
  });
  for (const g of TABLE.gates) {
    const now = side(g, b.x, b.y);
    if (g.orbit && side(g, px, py) < 0 && now >= 0 && b.x > g.x1 && b.x < g.x2) shot(t, 3000, 0, b.x, b.y); // up the orbit, out through its gate
    if (now > 0 && (b.vx * -(g.y2 - g.y1) + b.vy * (g.x2 - g.x1)) < 0) { nearest(b.x, b.y, g.x1, g.y1, g.x2, g.y2); touch(b, P.x, P.y, R + 0.002, 0.3); }
  }
  const py0 = plungerY(t);
  if (b.x > LANE.wall && b.y > py0) { nearest(b.x, b.y, LANE.wall, py0, LANE.out, py0); touch(b, P.x, P.y, R + 0.004, 0.15); }
  for (const f of t.flippers) {
    const c = Math.cos(f.a), s = Math.sin(f.a), k = nearest(b.x, b.y, f.x, f.y, f.x + c * FLIP.len, f.y + s * FLIP.len), r = FLIP.base + (FLIP.tip - FLIP.base) * k;
    const dx = b.x - P.x, dy = b.y - P.y, d = Math.hypot(dx, dy);
    // Where it meets the flipper's edge moves at ω × its distance from the pivot.
    if (d < R + r && d > 1e-9) { const ex = P.x + dx / d * r - f.x, ey = P.y + dy / d * r - f.y; touch(b, P.x, P.y, R + r, f.w ? FLIP.e : FLIP.dead, -f.w * ey, f.w * ex); }
  }
  // Rolling over a top lane lights it (the flashing one first thing after a launch is the skill shot); all five lit go up
  // a multiplier and collect the cherries.
  TABLE.lanes.forEach((l, i) => {
    if (Math.abs(b.x - l.x) > 0.02 || Math.abs(b.y - l.y) > 0.02 || t.time < t.cool[i]) return;
    t.cool[i] = t.time + 0.4; ev.push({ kind: 'lane', i, x: l.x, y: l.y });
    if (t.time < t.skillUntil && i === t.skillLane) { award(t, 10000); say(t, 'SKILL SHOT'); ev.push({ kind: 'skill' }); }
    t.skillUntil = 0;
    award(t, t.lit[i] ? 100 : 500); t.lit[i] = true;
    if (t.lit.every(Boolean)) {
      t.lit = t.lit.map(() => false);
      if (t.mult < 5) { t.mult++; say(t, `${t.mult}X`); ev.push({ kind: 'mult' }); }
      collect(t, 5);
    }
  });
  const S = TABLE.saucer;
  if (Math.hypot(b.x - S.x, b.y - S.y) < 0.016 && Math.hypot(b.vx, b.vy) < 1.2 && !(t.time < b.free)) {
    Object.assign(b, { x: S.x, y: S.y, vx: 0, vy: 0, held: t.time + 1.3 });
    award(t, t.multiball ? 25000 : 2500); ev.push({ kind: t.multiball ? 'jackpot' : 'juicer', x: S.x, y: S.y });
    if (!collect(t, 3)) say(t, t.multiball ? 'JACKPOT' : 'JUICED');
  }
  // The spinner, flicked as the ball goes through (either way).
  const sp = TABLE.spinner;
  if (b.x > sp.x1 && b.x < sp.x2 && (py - sp.y) * (b.y - sp.y) <= 0 && py !== b.y) t.spinSpeed = Math.max(t.spinSpeed, Math.abs(b.vy) * 40);
  // The blender drags the ball round with it, a few points as it goes.
  const B = TABLE.blender, bx = b.x - B.x, by = b.y - B.y;
  if (bx * bx + by * by < B.r * B.r) {
    const w = BLEND * (t.time < t.saladUntil ? 2 : 1), k = Math.min(1, 6 * DT); b.vx += (-w * by - b.vx) * k; b.vy += (w * bx - b.vy) * k;
    if ((t.blendFor += DT) > 0.15) { t.blendFor = 0; award(t, 50); ev.push({ kind: 'blend', x: b.x, y: b.y }); }
  }
  // Lit, the kickback fires a ball in the left outlane back up the table.
  if (t.kickback && b.x < -0.24 && b.y < 0.3 && b.y > 0.08 && b.vy < 0) { b.vy = 3.4; b.vx = 0.05; t.kickback = false; t.spins = 0; award(t, 500); say(t, 'KICKBACK'); ev.push({ kind: 'kick' }); }
  if (b.y < 0.02 && b.x < LANE.wall || !(Math.abs(b.x) < 0.4 && b.y > -0.2 && b.y < 1.2)) b.gone = true; // down the drain (or, somehow, off the table)
}

// In the secret room's frame: the cabinet's back to the front wall, between the beanbags and the green, facing into the
// room. The playfield tilts up TILT (radians) away from you, its bottom HEIGHT above the floor and FRONT out from the
// wall, which leaves room behind its top end for the backbox.
const CAB = { x: 4.2, z: SECRET.front - 0.02 }, TILT = 0.115, HEIGHT = 0.86, FRONT = 1.43, FOV = 50, BEST = 'ai-control-pinball-best';
const PACE = 0.8; // the table plays at 80% of its speed: full speed is too quick to follow on a screen
// What the playfield's art covers (table metres) and its pixels to a metre; the body's middle across.
const FIELD = { x0: LEFT - 0.02, x1: LANE.out + 0.02, y0: -0.07, y1: ARC.y + ARC.r + 0.02 }, PPM = 1400, MIDDLE = (FIELD.x0 + FIELD.x1) / 2;
const BUMPERS = ['orange', 'lime', 'cherry', 'lemon'], JUICE = ['#ff9a1f', '#9be25a', '#ff2d55', '#ffe14f'];
const TARGETS = ['#ffe14f', '#8fd14f', '#ff8c1a'], RAMPS = ['#ff4fd8', '#38f2ff'];
const FRUIT_COLORS = ['#ffe14f', '#ff2d55', '#a35bff', '#ff8c1a', '#fff06a', '#e0213a'];
// The lamps on the playfield and what lights each; a fruit's lights only as a glow over its picture.
const LAMPS = [
  ...TABLE.lanes.map((l, i) => ({ x: l.x, y: 0.928, r: 0.01, color: '#ffe14f', kind: 'lane', i })),
  ...TABLE.targets.map((g, i) => ({ x: 0.238, y: g.y, r: 0.008, color: TARGETS[i], kind: 'target', i })),
  ...[2, 3, 4, 5].map((k, i) => ({ x: -0.054 + i * 0.036, y: 0.395, r: 0.011, color: '#38f2ff', kind: 'mult', i: k })),
  { x: 0, y: 0.08, r: 0.01, color: '#ff8a3d', kind: 'save' },
  { x: TABLE.saucer.x, y: TABLE.saucer.y, r: 0.03, color: '#7dff6b', kind: 'juicer' },
  { x: -0.259, y: 0.23, r: 0.009, color: '#ff3b30', kind: 'kickback' },
  { x: -0.2575, y: 0.6, r: 0.008, color: '#ffe14f', kind: 'spinner' },
  // An arrow in front of each shot, flashing while its fruit's still to get (the drop targets' says multiball).
  ...[[-0.25, 0.505], [-0.2, 0.565], [0.17, 0.625], [0.24, 0.645], [0.215, 0.485]].map(([x, y], i) => ({ x, y, r: 0.011, color: FRUIT_COLORS[i], kind: 'shot', i })),
  ...FRUITS.map((_, i) => { const a = Math.PI / 2 + i * Math.PI / 3; return { x: Math.cos(a) * 0.085, y: TABLE.blender.y + Math.sin(a) * 0.085, r: 0.016, color: FRUIT_COLORS[i], kind: 'fruit', i, glow: true }; }),
];
const jitter = (i, salt) => { const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453; return v - Math.floor(v); };
const fmt = n => n.toLocaleString('en-US');

// Geometry on the table, in its frame: playfield point (x, y) is (x, height, -y).
const along = (x1, y1, x2, y2, thick, high, lift = 0) => new THREE.BoxGeometry(Math.hypot(x2 - x1, y2 - y1), high, thick).rotateY(Math.atan2(y2 - y1, x2 - x1)).translate((x1 + x2) / 2, lift + high / 2, -(y1 + y2) / 2);
const cyl = (r, high, x, y, lift = 0, n = 16) => new THREE.CylinderGeometry(r, r, high, n).translate(x, lift + high / 2, -y);
const box = (w, high, d, x, y, lift = 0) => new THREE.BoxGeometry(w, high, d).translate(x, lift + high / 2, -y);
// A flat shape (playfield points) stood up `high` from `lift`.
const slab = (points, high, lift = 0) => new THREE.ExtrudeGeometry(points instanceof THREE.Shape ? points : new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))), { depth: high, bevelEnabled: false, curveSegments: 10 }).rotateX(-Math.PI / 2).translate(0, lift, 0);
const ball = (r, x, h, z, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, 14, 10).scale(sx, sy, sz).translate(x, h, z);

// Matcaps: how a sphere looks lit, so the table shines whatever the room's lights do. Glossy plastic, and chrome with the
// room's neon in it.
let looks;
const matcaps = () => looks ??= {
  plastic: canvasTexture(128, 128, (g, w) => {
    const grad = g.createRadialGradient(w * 0.4, w * 0.34, 0, w / 2, w / 2, w / 2);
    for (const [at, c] of [[0, '#ffffff'], [0.12, '#f4f4f4'], [0.5, '#b4b4b4'], [0.85, '#585858'], [1, '#242424']]) grad.addColorStop(at, c);
    g.fillStyle = grad; g.fillRect(0, 0, w, w);
  }),
  chrome: canvasTexture(128, 128, (g, w) => {
    const sky = g.createLinearGradient(0, 0, 0, w);
    for (const [at, c] of [[0, '#ffffff'], [0.32, '#bfe6ff'], [0.47, '#5b6078'], [0.5, '#15131f'], [0.62, '#7a2f8f'], [0.8, '#ff6be0'], [1, '#ffe8a0']]) sky.addColorStop(at, c);
    g.fillStyle = sky; g.fillRect(0, 0, w, w);
    const spot = g.createRadialGradient(w * 0.36, w * 0.3, 0, w * 0.36, w * 0.3, w * 0.16); spot.addColorStop(0, '#ffffff'); spot.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = spot; g.fillRect(0, 0, w, w);
    const rim = g.createRadialGradient(w / 2, w / 2, w * 0.36, w / 2, w / 2, w / 2); rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(1, 'rgba(0,0,0,0.6)'); g.fillStyle = rim; g.fillRect(0, 0, w, w);
  }),
  spark: canvasTexture(64, 64, (g, w) => { const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.3, 'rgba(255,255,255,0.5)'); grad.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grad; g.fillRect(0, 0, w, w); }),
};
const shiny = (options = {}) => new THREE.MeshMatcapMaterial({ matcap: matcaps().plastic, vertexColors: true, ...options });
const glowing = (map, color = '#ffffff', options = {}) => new THREE.MeshBasicMaterial({ map, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, ...options });

// Fruit drawn round (0, 0), about `r` from the middle to the edge.
const disc = (g, x, y, r, color) => { g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
const slice = (g, r, peel, pith, flesh) => {
  disc(g, 0, 0, r, peel); disc(g, 0, 0, r * 0.88, pith); g.fillStyle = flesh;
  for (let k = 0; k < 8; k++) { g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r * 0.8, k * Math.PI / 4 + 0.07, (k + 1) * Math.PI / 4 - 0.07); g.closePath(); g.fill(); }
};
const DRAW = {
  orange: (g, r) => slice(g, r, '#ff7a00', '#fff1d6', '#ffa630'),
  lime: (g, r) => slice(g, r, '#3f9b2f', '#f0ffd8', '#9be25a'),
  lemon: (g, r) => slice(g, r, '#f2c200', '#fffbe0', '#ffe55c'),
  cherry: (g, r) => {
    g.strokeStyle = '#3d8b37'; g.lineWidth = r * 0.12; g.lineCap = 'round'; g.beginPath();
    g.moveTo(-r * 0.45, r * 0.2); g.quadraticCurveTo(-r * 0.2, -r * 0.6, r * 0.15, -r * 0.95); g.moveTo(r * 0.45, r * 0.3); g.quadraticCurveTo(r * 0.35, -r * 0.4, r * 0.15, -r * 0.95); g.stroke();
    for (const [x, y] of [[-0.45, 0.45], [0.45, 0.55]]) { disc(g, x * r, y * r, r * 0.42, '#e0213a'); disc(g, (x - 0.14) * r, (y - 0.14) * r, r * 0.1, '#ffd0d8'); }
  },
  strawberry: (g, r) => {
    g.fillStyle = '#ff2d55'; g.beginPath(); g.moveTo(0, r); g.bezierCurveTo(-r * 1.1, r * 0.2, -r * 0.9, -r * 0.75, 0, -r * 0.6); g.bezierCurveTo(r * 0.9, -r * 0.75, r * 1.1, r * 0.2, 0, r); g.fill();
    g.fillStyle = '#ffe14f'; for (let k = 0; k < 9; k++) g.fillRect((k % 3 - 1) * r * 0.38 - r * 0.04, (Math.floor(k / 3) - 0.6) * r * 0.42, r * 0.08, r * 0.12);
    g.fillStyle = '#3fae49'; for (let k = 0; k < 5; k++) { g.save(); g.translate(0, -r * 0.6); g.rotate(-1 + k * 0.5); g.beginPath(); g.ellipse(0, -r * 0.18, r * 0.1, r * 0.24, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
  },
  banana: (g, r) => {
    g.lineCap = 'round'; g.lineWidth = r * 0.5; g.strokeStyle = '#ffe14f'; g.beginPath(); g.arc(0, -r * 0.9, r * 1.3, 0.28 * Math.PI, 0.72 * Math.PI); g.stroke();
    for (const a of [0.28, 0.72]) disc(g, Math.cos(a * Math.PI) * r * 1.3, -r * 0.9 + Math.sin(a * Math.PI) * r * 1.3, r * 0.14, '#6b4423');
  },
  grape: (g, r) => {
    for (const [x, y] of [[-0.5, -0.35], [0, -0.42], [0.5, -0.35], [-0.27, 0.08], [0.27, 0.08], [0, 0.5]]) { disc(g, x * r, y * r, r * 0.3, '#8e3bd1'); disc(g, (x - 0.1) * r, (y - 0.1) * r, r * 0.08, '#d9b3ff'); }
    g.fillStyle = '#3fae49'; g.beginPath(); g.ellipse(r * 0.3, -r * 0.85, r * 0.3, r * 0.14, -0.4, 0, Math.PI * 2); g.fill();
  },
  melon: (g, r) => {
    for (const [k, c] of [[1, '#2e9c5a'], [0.9, '#e9f7d8'], [0.8, '#ff3b5c']]) { g.fillStyle = c; g.beginPath(); g.arc(0, -r * 0.3, r * k, 0, Math.PI); g.fill(); }
    g.fillStyle = '#1b1a1f'; for (let k = 0; k < 5; k++) { const a = (k + 1) / 6 * Math.PI; g.beginPath(); g.ellipse(Math.cos(a) * r * 0.5, -r * 0.3 + Math.sin(a) * r * 0.5, r * 0.04, r * 0.08, a - Math.PI / 2, 0, Math.PI * 2); g.fill(); }
  },
};
const fruit = (g, kind, x, y, r, turn = 0, alpha = 1) => { g.save(); g.globalAlpha = alpha; g.translate(x, y); g.rotate(turn); DRAW[kind](g, r); g.restore(); };
const FONT = "'Comic Neue', 'Comic Sans MS', cursive";
const neonText = (g, text, x, y, size, fill, edge, glow) => {
  g.font = `bold ${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.shadowColor = glow; g.shadowBlur = size * 0.35; g.lineWidth = size * 0.16; g.strokeStyle = edge; g.strokeText(text, x, y);
  g.shadowBlur = 0; g.fillStyle = fill; g.fillText(text, x, y);
};

// The playfield's art, drawn once: glows where the action is, a sunburst, a scatter of little fruit, the shots' fruit, and
// the labels by the lamps.
function drawField(g, w, h) {
  const X = x => (x - FIELD.x0) * PPM, Y = y => (FIELD.y1 - y) * PPM, S = m => m * PPM;
  const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#2a0b4d'); bg.addColorStop(0.55, '#45105c'); bg.addColorStop(1, '#14052a'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const glow = (x, y, r, color) => { const grad = g.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), S(r)); grad.addColorStop(0, color); grad.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grad; g.fillRect(0, 0, w, h); };
  glow(-0.02, 0.84, 0.25, 'rgba(255,79,216,0.45)'); glow(0, 0.18, 0.28, 'rgba(56,242,255,0.28)'); glow(0.24, 0.69, 0.09, 'rgba(125,255,107,0.35)');
  glow(0, TABLE.blender.y, 0.14, 'rgba(255,225,79,0.3)'); glow(-0.25, 0.6, 0.1, 'rgba(255,225,79,0.2)');
  g.save(); g.translate(X(0), Y(TABLE.blender.y));
  for (let k = 0; k < 28; k++) { g.fillStyle = k % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(255,79,216,0.06)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, S(1.2), k * Math.PI / 14, (k + 1) * Math.PI / 14); g.fill(); }
  g.restore();
  const kinds = Object.keys(DRAW);
  for (let i = 0; i < 56; i++) fruit(g, kinds[i % kinds.length], jitter(i, 1) * w, jitter(i, 2) * h, S(0.01 + jitter(i, 4) * 0.01), jitter(i, 3) * 6.3, 0.18);
  // The logo between the slingshots: an orange slice with TUTTI FRUTTI across it.
  fruit(g, 'orange', X(0), Y(0.29), S(0.06), 0.2, 0.85);
  neonText(g, 'TUTTI', X(0), Y(0.31), S(0.034), '#ffe14f', '#c2187f', '#ff4fd8');
  neonText(g, 'FRUTTI', X(0), Y(0.272), S(0.034), '#7ff6ff', '#1d3fae', '#38f2ff');
  // Where the bumpers stand, in their fruit's colour; round the blender, its six fruit; under the slingshots, a pink splash.
  TABLE.bumpers.forEach((p, i) => { disc(g, X(p.x), Y(p.y), S(0.045), JUICE[i] + '55'); disc(g, X(p.x), Y(p.y), S(0.036), '#120420'); });
  disc(g, X(0), Y(TABLE.blender.y), S(0.058), '#120420');
  LAMPS.filter(l => l.kind === 'fruit').forEach(l => { disc(g, X(l.x), Y(l.y), S(0.017), '#120420'); fruit(g, FRUITS[l.i], X(l.x), Y(l.y), S(0.012)); });
  for (const [a, , c] of TABLE.slings) glow((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, 0.07, 'rgba(255,59,92,0.35)');
  // The lane and the orbit: dark, with chevrons up them.
  g.fillStyle = '#0c0418'; g.fillRect(X(LANE.wall), Y(LANE.top), S(LANE.out - LANE.wall), h); g.fillRect(X(LEFT), Y(0.84), S(0.045), S(0.33));
  g.fillStyle = '#ffe14f';
  for (const [x, y0, y1] of [[LANE.x, 0.1, 0.75], [-0.2575, 0.62, 0.82]]) for (let y = y0; y < y1; y += 0.07) { g.globalAlpha = 0.4 + 0.5 * y; g.beginPath(); g.moveTo(X(x - 0.012), Y(y)); g.lineTo(X(x), Y(y + 0.015)); g.lineTo(X(x + 0.012), Y(y)); g.lineTo(X(x), Y(y + 0.007)); g.fill(); }
  g.globalAlpha = 1;
  // Lamp rings, the lanes' letters, the shots' fruit, labels.
  for (const l of LAMPS) if (!l.glow) { g.strokeStyle = l.color; g.lineWidth = S(0.0025); g.beginPath(); g.arc(X(l.x), Y(l.y), S(l.r + 0.002), 0, Math.PI * 2); g.stroke(); }
  TABLE.lanes.forEach((l, i) => neonText(g, 'JUICE'[i], X(l.x), Y(l.y), S(0.022), '#ffffff', '#c2187f', '#ff4fd8'));
  [[-0.2575, 0.545], [-0.2, 0.515], [0.17, 0.575], [0.24, 0.6], [0.215, 0.44]].forEach(([x, y], i) => fruit(g, FRUITS[i], X(x), Y(y), S(0.011)));
  g.save(); g.translate(X(0.2), Y(0.53)); g.rotate(-Math.PI / 2); neonText(g, 'MULTIBALL', 0, 0, S(0.014), '#ffffff', '#c2187f', '#ff4fd8'); g.restore();
  g.save(); g.translate(X(-0.259), Y(0.31)); g.rotate(-Math.PI / 2); neonText(g, 'KICKBACK', 0, 0, S(0.012), '#ffffff', '#a3201a', '#ff3b30'); g.restore();
  neonText(g, 'JUICER', X(TABLE.saucer.x), Y(TABLE.saucer.y + 0.04), S(0.014), '#ffffff', '#1f7a2a', '#7dff6b');
  [2, 3, 4, 5].forEach((k, i) => neonText(g, `${k}×`, X(-0.054 + i * 0.036), Y(0.372), S(0.012), '#ffffff', '#1d3fae', '#38f2ff'));
  neonText(g, 'SAVE', X(0), Y(0.105), S(0.011), '#ffffff', '#b34700', '#ff8a3d');
}
// The backglass: the name in neon over a sunburst, fruit all round.
function drawGlass(g, w, h) {
  const bg = g.createRadialGradient(w / 2, h * 0.55, 0, w / 2, h * 0.55, w * 0.7); bg.addColorStop(0, '#ff4fd8'); bg.addColorStop(0.45, '#6a1fb8'); bg.addColorStop(1, '#1c0638'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.save(); g.translate(w / 2, h * 0.55); for (let k = 0; k < 24; k++) { g.fillStyle = k % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(255,225,79,0.08)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, w, k * Math.PI / 12, (k + 1) * Math.PI / 12); g.fill(); } g.restore();
  for (const [kind, x, y, r, turn] of [['orange', 0.1, 0.18, 0.09, 0.3], ['lime', 0.9, 0.2, 0.08, -0.4], ['cherry', 0.12, 0.8, 0.09, -0.2], ['strawberry', 0.88, 0.8, 0.09, 0.3], ['banana', 0.5, 0.9, 0.08, 0], ['grape', 0.27, 0.92, 0.07, 0.2], ['melon', 0.73, 0.95, 0.08, 0], ['lemon', 0.5, 0.1, 0.06, 0.5]]) fruit(g, kind, x * w, y * h, r * w, turn);
  neonText(g, 'TUTTI', w / 2, h * 0.36, h * 0.24, '#ffe14f', '#c2187f', '#ff4fd8');
  neonText(g, 'FRUTTI', w / 2, h * 0.6, h * 0.24, '#7ff6ff', '#1d3fae', '#38f2ff');
}
// The dot-matrix display: text drawn small, then each pixel a dot, orange, or a rainbow for news.
let dotCanvas;
function drawDots(g, w, h, s) {
  dotCanvas ??= Object.assign(document.createElement('canvas'), { width: 128, height: 32 });
  const d = dotCanvas.getContext('2d', { willReadFrequently: true }); d.clearRect(0, 0, 128, 32);
  const line = (text, size, y) => { d.font = `${size}px VT323, monospace`; d.font = `${Math.min(size, Math.floor(size * 124 / d.measureText(text).width))}px VT323, monospace`; d.fillText(text, 64, y); };
  if (s) { d.fillStyle = '#fff'; d.textAlign = 'center'; d.textBaseline = 'middle'; if (s.top) { line(s.top, 13, 6.5); line(s.big, 21, 21.5); } else line(s.big, 30, 17); }
  const px = d.getImageData(0, 0, 128, 32).data, cw = w / 128, ch = h / 32, lit = new Path2D(), dark = new Path2D();
  for (let y = 0; y < 32; y++) for (let x = 0; x < 128; x++) (px[(y * 128 + x) * 4 + 3] > 100 ? lit : dark).rect(x * cw + 0.6, y * ch + 0.6, cw - 1.2, ch - 1.2);
  g.fillStyle = '#0d0503'; g.fillRect(0, 0, w, h); g.fillStyle = '#2a1407'; g.fill(dark);
  if (s?.rainbow) { const grad = g.createLinearGradient(0, 0, w, 0); for (let k = 0; k <= 6; k++) grad.addColorStop(k / 6, `hsl(${(k * 60 + s.phase * 36) % 360} 100% 62%)`); g.fillStyle = grad; } else g.fillStyle = '#ff9b2e';
  g.fill(lit);
}

// Sound, made up as it goes: a pitch sweep with a quick fade for each knock, and little fanfares for the big moments, as
// loud as what made them. It starts with your first press while playing (browsers wait for one).
let audio, master;
function tone(from, to, length, type = 'sine', gain = 0.3, delay = 0) {
  if (!audio) return;
  const at = audio.currentTime + delay, o = audio.createOscillator(), g = audio.createGain();
  o.type = type; o.frequency.setValueAtTime(from, at); o.frequency.exponentialRampToValueAtTime(to, at + length);
  g.gain.setValueAtTime(Math.min(0.6, gain), at); g.gain.exponentialRampToValueAtTime(0.0005, at + length);
  o.connect(g).connect(master); o.start(at); o.stop(at + length + 0.02);
}
const tune = (notes, gap = 0.08, type = 'square', gain = 0.16) => notes.forEach((f, i) => tone(f, f * 1.01, gap * 1.8, type, gain, i * gap));
const SOUNDS = {
  flip: () => tone(150, 60, 0.05, 'square', 0.2),
  bump: e => { tone(560, 150, 0.09, 'triangle', 0.15 + 0.25 * Math.min(1, e.hit / 1.5)); tone(1400, 900, 0.03, 'square', 0.05); },
  sling: () => tone(330, 90, 0.07, 'sawtooth', 0.18),
  wall: e => tone(1000, 700, 0.02, 'sine', 0.06 * Math.min(2, e.hit)),
  target: () => tone(1200, 500, 0.07, 'square', 0.14),
  lane: () => tone(1320, 1980, 0.09, 'sine', 0.18),
  up: () => tone(220, 700, 0.35, 'sawtooth', 0.07),
  shot: e => tune([523, 659, 784, ...(e.combo ? [1047, 1319].slice(0, e.combo) : [])]),
  spin: () => tone(2600, 2200, 0.012, 'square', 0.03),
  blend: () => tone(180, 300, 0.05, 'sawtooth', 0.04),
  juicer: () => { tone(110, 50, 0.6, 'sawtooth', 0.18); tone(330, 160, 0.4, 'square', 0.05); },
  eject: () => tone(200, 700, 0.09, 'square', 0.15),
  kick: () => tone(90, 500, 0.12, 'square', 0.3),
  launch: () => tone(110, 800, 0.25, 'sawtooth', 0.12),
  nudge: () => tone(70, 40, 0.12, 'sine', 0.35),
  drain: () => tone(420, 55, 0.7, 'sawtooth', 0.13),
  tilt: () => tone(110, 98, 0.9, 'square', 0.18),
  fruit: () => tune([784, 988, 1175], 0.07),
  mult: () => tune([659, 880, 1109, 1319], 0.07),
  skill: () => tune([1047, 1319, 1568, 2093], 0.06),
  saved: () => tune([523, 784], 0.1, 'triangle', 0.2),
  start: () => tune([392, 523, 659, 784], 0.09),
  multiball: () => tune([523, 659, 784, 1047, 784, 1047, 1319], 0.08),
  jackpot: () => tune([784, 988, 1175, 1568, 1175, 1568, 1976, 2349], 0.07),
  salad: () => tune([523, 659, 784, 1047, 659, 784, 1047, 1319, 784, 1047, 1319, 1568], 0.08),
  over: () => tune([523, 466, 415, 349], 0.16, 'triangle', 0.18),
};

// `canvas`: the scene's, for presses; `camera`, whose aspect sets the view; `onPlay(pinball)`: the cabinet was clicked.
export function createPinball({ canvas, camera, onPlay }) {
  let best = 0; try { best = Number(localStorage.getItem(BEST)) || 0; } catch {}
  const t = newTable(best), keys = { left: false, right: false, plunge: false, nudge: false }, pointers = new Map();
  let room = null, table, active = false, still = false, time = 0, acc = 0, shake = 0, party = 0, flash = 0, dmdAt = 0, dmdKey = '', kicked = 0;
  let flippers, plunger, targets, caps, rings, bands, balls, shadows, dots, halos, trail, juice, overlay, dmd, neon, floorGlow, spinner, blender, kicker;
  const fit = { aspect: 0, height: 0, from: new THREE.Vector3(), look: new THREE.Vector3() }, probe = new THREE.PerspectiveCamera(), wobble = new THREE.Vector3(), tint = new THREE.Color();
  const KEYS = { ArrowLeft: 'left', KeyA: 'left', KeyZ: 'left', ShiftLeft: 'left', ArrowRight: 'right', KeyD: 'right', KeyM: 'right', Slash: 'right', ShiftRight: 'right', Space: 'plunge', ArrowDown: 'plunge', KeyS: 'plunge', ArrowUp: 'nudge', KeyW: 'nudge' };
  const release = () => { keys.left = keys.right = keys.plunge = keys.nudge = false; pointers.clear(); }, coarse = globalThis.matchMedia?.('(pointer: coarse)');
  const hear = () => { try { if (!audio) { audio = new AudioContext(); master = audio.createGain(); master.gain.value = 0.35; master.connect(audio.destination); } audio.resume(); } catch { /* no sound here */ } };

  const pinball = {
    // Where the cabinet stands, so nobody walks through it (secret.js), in the room's frame.
    blocks: [new THREE.Box3(new THREE.Vector3(CAB.x - 0.39, 0, CAB.z - 1.55), new THREE.Vector3(CAB.x + 0.39, 1.9, CAB.z + 0.02))],
    enter() { active = true; },
    leave() { active = false; release(); },
    blur: release, // the window lost focus: no key-ups are coming
    stand() { const p = room.localToWorld(new THREE.Vector3(CAB.x, 0, CAB.z - 1.95)); return { x: p.x, z: p.z, yaw: 0 }; },
    pose() {
      const height = camera.userData.canvas?.clientHeight || 0;
      if (fit.aspect !== camera.aspect || fit.height !== height) frame(camera.aspect, height);
      return { from: fit.from.clone().add(wobble), look: fit.look.clone().add(wobble), fov: FOV, hands: false };
    },
    click() { return false; }, // presses work the flippers (below)
    // A key while playing: true if it's one of the table's (office.js then leaves it be).
    key(code, down) { const k = KEYS[code]; if (!k || !active) return false; keys[k] = down; if (down) hear(); return true; },
    build(group) {
      room = group; fit.aspect = 0;
      const cab = new THREE.Group(); cab.position.set(CAB.x, 0, CAB.z); cab.rotation.y = Math.PI; cab.userData.toggle = () => onPlay(pinball); group.add(cab);
      const deck = new THREE.Group(); deck.position.set(0, HEIGHT, FRONT); deck.rotation.x = TILT; cab.add(deck);
      table = new THREE.Group(); table.position.x = -MIDDLE; deck.add(table);
      dmd = canvasTexture(512, 128, drawDots);
      buildBody(cab, deck); buildTable(); buildBackbox(cab, deck);
      document.fonts?.load(`bold 40px 'Comic Neue'`).then(() => document.fonts.load('20px VT323')).then(() => { for (const m of [table.userData.field, cab.userData.glass]) m.redraw(); dmdKey = ''; }).catch(() => {});
    },
    update(dt, at, reduced, shown) {
      time += dt; still = reduced;
      if (!room || !shown) return;
      if (active) {
        const sides = [...pointers.values()];
        t.input.left = keys.left || sides.includes('left'); t.input.right = keys.right || sides.includes('right'); t.input.nudge = keys.nudge;
        t.input.plunge = keys.plunge || (pointers.size > 0 && waiting(t));
        for (acc += dt * PACE; acc >= DT; acc -= DT) step(t);
      }
      react(dt); draw(dt);
    },
  };

  // The cabinet: a purple body with chrome rails and legs, a coin door, and the plunger's knob out front.
  function buildBody(cab, deck) {
    const x0 = FIELD.x0 - 0.03, x1 = FIELD.x1 + 0.03, y0 = FIELD.y0 - 0.025, y1 = FIELD.y1 + 0.03, wide = x1 - x0, long = y1 - y0, mid = (y0 + y1) / 2, body = '#3a1670', chrome = '#d4d8e2';
    const parts = [[box(wide, 0.25, long, MIDDLE, mid, -0.254), body], [box(wide, 0.064, 0.025, MIDDLE, y0 + 0.0125, -0.004), body], [box(wide, 0.064, 0.03, MIDDLE, y1 - 0.015, -0.004), body],
      [box(wide + 0.012, 0.022, 0.05, MIDDLE, y0 + 0.02, 0.06), chrome], [box(0.24, 0.15, 0.012, MIDDLE, y0 - 0.006, -0.21), '#1b1a1f'], [box(0.2, 0.012, 0.014, MIDDLE, y0 - 0.007, -0.08), chrome]];
    for (const [x, s] of [[x0 + 0.015, -1], [x1 - 0.015, 1]]) {
      parts.push([box(0.03, 0.064, long, x, mid, -0.004), body], [box(0.036, 0.012, long, x, mid, 0.06), chrome]);
      parts.push([box(0.004, 0.02, long - 0.12, x + s * 0.0165, mid, -0.06), '#ffe14f'], [box(0.004, 0.02, long - 0.12, x + s * 0.0165, mid, -0.1), '#ff4fd8'], [box(0.004, 0.02, long - 0.12, x + s * 0.0165, mid, -0.14), '#38f2ff']);
    }
    table.add(mesh(paint(parts), painted(), 0.006));
    table.add(new THREE.Mesh(paint([-0.05, 0.05].map(x => [box(0.012, 0.03, 0.004, MIDDLE + x, y0 - 0.013, -0.2), '#ff3b30'])), new THREE.MeshBasicMaterial({ vertexColors: true }))); // coin slots, lit
    // Legs stand straight down from the body's corners.
    deck.updateMatrix(); table.updateMatrix();
    const legs = [];
    for (const x of [x0 + 0.03, x1 - 0.03]) for (const y of [y0 + 0.05, y1 - 0.06]) {
      const p = new THREE.Vector3(x, -0.25, -y).applyMatrix4(table.matrix).applyMatrix4(deck.matrix);
      legs.push([new THREE.CylinderGeometry(0.02, 0.018, p.y, 10).translate(p.x, p.y / 2, p.z), '#c9ced8'], [new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12).translate(p.x, 0.01, p.z), '#1b1a1f']);
    }
    cab.add(mesh(paint(legs), painted(), 0.006));
    floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.3).rotateX(-Math.PI / 2), glowing(glowTexture(), '#ff4fd8')); floorGlow.position.set(0, 0.012, 0.8); floorGlow.raycast = () => {}; cab.add(floorGlow);
  }

  // The playfield and everything on it.
  function buildTable() {
    const field = canvasTexture(Math.ceil((FIELD.x1 - FIELD.x0) * PPM), Math.ceil((FIELD.y1 - FIELD.y0) * PPM), drawField); table.userData.field = field;
    table.add(new THREE.Mesh(new THREE.PlaneGeometry(FIELD.x1 - FIELD.x0, FIELD.y1 - FIELD.y0).rotateX(-Math.PI / 2).translate(MIDDLE, 0, -(FIELD.y0 + FIELD.y1) / 2), new THREE.MeshBasicMaterial({ map: field })));
    // What doesn't move, in one: rails, guides, gates and rubber posts, the bumpers' bases, the watermelons, the juicer,
    // the ramps' legs, the spinner's bracket, the apron, and a pineapple and a strawberry in the top corners.
    const parts = [];
    for (const w of TABLE.walls) if (w.sling === undefined) {
      const rail = w.h >= 0.004;
      parts.push([along(w.x1, w.y1, w.x2, w.y2, w.h * 2, rail ? 0.035 : 0.022), rail ? '#c9ced8' : w.h < 0.003 ? '#2a1450' : Math.max(w.y1, w.y2) > 0.9 ? '#ff4fd8' : '#38f2ff']);
    }
    for (const g of TABLE.gates) parts.push([along(g.x1, g.y1, g.x2, g.y2, 0.003, 0.012, 0.018), '#ffe14f']);
    for (const p of TABLE.posts) parts.push([cyl(p.r + 0.0015, 0.026, p.x, p.y), '#f4f2ec'], [cyl(p.r * 0.7, 0.004, p.x, p.y, 0.026), '#ffe14f']);
    TABLE.bumpers.forEach((p, i) => parts.push([cyl(p.r, 0.016, p.x, p.y, 0, 24), '#1b1a1f'], [cyl(p.r + 0.003, 0.004, p.x, p.y, 0.002, 24), '#f4f2ec'], [cyl(p.r - 0.002, 0.006, p.x, p.y, 0.012, 24), JUICE[i]]));
    for (const [a, b, c] of TABLE.slings) {
      const toward = (p, k) => [p[0] + (b[0] - p[0]) * k, p[1] + (b[1] - p[1]) * k];
      parts.push([slab([a, b, c], 0.028), '#2e9c5a'], [slab([toward(a, 0.12), b, toward(c, 0.12)], 0.001, 0.028), '#e9f7d8'], [slab([toward(a, 0.22), b, toward(c, 0.22)], 0.0015, 0.0285), '#ff3b5c']);
      for (const k of [0.35, 0.5, 0.65]) { const p = toward([a[0] + (c[0] - a[0]) * k, a[1] + (c[1] - a[1]) * k], 0.45); parts.push([ball(0.003, p[0], 0.03, -p[1], 1, 0.4, 1.6), '#1b1a1f']); }
    }
    const S = TABLE.saucer; parts.push([cyl(0.019, 0.0015, S.x, S.y, 0.001, 24), '#050308'], [new THREE.TorusGeometry(0.02, 0.0025, 6, 24).rotateX(Math.PI / 2).translate(S.x, 0.003, -S.y), '#c9ced8']);
    parts.push([slab([[LEFT - 0.004, FIELD.y0], [LANE.wall + 0.004, FIELD.y0], [LANE.wall + 0.004, 0.035], [LEFT - 0.004, 0.035]], 0.03), '#2b1650']);
    const sp = TABLE.spinner; for (const x of [sp.x1, sp.x2]) parts.push([cyl(0.0025, 0.034, x, sp.y), '#c9ced8']); parts.push([along(sp.x1, sp.y, sp.x2, sp.y, 0.003, 0.003, 0.031), '#c9ced8']);
    parts.push([ball(0.022, -0.25, 0.035, -1.11, 1, 1.5, 1), '#f2a516'], ...[0, 1, 2, 3, 4].map(k => [new THREE.ConeGeometry(0.007, 0.05, 5).translate(0, 0.025, 0).rotateZ(Math.sin(k * 1.3) * 0.5).rotateX(Math.cos(k * 1.3) * 0.5).translate(-0.25, 0.064, -1.11), '#3fae49']));
    parts.push([ball(0.025, 0.3, 0.028, -1.1, 1, 1.15, 1), '#ff2d55'], [ball(0.016, 0.3, 0.056, -1.1, 1.4, 0.35, 1.4), '#3fae49']);
    // The wire ramps: two neon rails at the ball's sides and one under it, on chrome legs.
    const rails = [], up = new THREE.Vector3(0, 1, 0);
    TABLE.ramps.forEach(({ path }, i) => {
      const at = p => new THREE.Vector3(p.x, p.h, -p.y), across = path.map((p, k) => at(path[Math.min(path.length - 1, k + 1)]).sub(at(path[Math.max(0, k - 1)])).cross(up).normalize());
      for (const [out, lift] of [[R + 0.0025, R * 0.9], [-R - 0.0025, R * 0.9], [0, -0.0025]]) {
        const curve = new THREE.CatmullRomCurve3(path.map((p, k) => at(p).addScaledVector(across[k], out).setY(p.h + lift)));
        rails.push([new THREE.TubeGeometry(curve, path.length, 0.0022, 5), RAMPS[i]]);
      }
      for (let k = 14; k < path.length - 10; k += 16) parts.push([cyl(0.0025, path[k].h - 0.003, path[k].x, path[k].y), '#c9ced8']);
    });
    table.add(new THREE.Mesh(paint(parts), shiny()), new THREE.Mesh(paint(rails), new THREE.MeshBasicMaterial({ vertexColors: true })));
    // The bumpers' fruit (each its own material, to flash) and the rings that burst off them.
    const fruitParts = {
      orange: [[ball(0.026, 0, 0.034, 0, 1, 0.82, 1), '#ff8c1a'], [ball(0.008, 0.006, 0.055, 0, 1.6, 0.35, 0.8), '#3fae49'], [cyl(0.002, 0.006, 0, 0, 0.052), '#6b4423']],
      lime: [[ball(0.025, 0, 0.033, 0, 1.15, 0.8, 0.9), '#8fd14f'], [ball(0.006, 0.028, 0.033, 0), '#6fb13a'], [ball(0.006, -0.028, 0.033, 0), '#6fb13a']],
      cherry: [[ball(0.016, -0.012, 0.03, 0.004), '#e0213a'], [ball(0.016, 0.013, 0.029, -0.004), '#e0213a'],
        [new THREE.CylinderGeometry(0.0015, 0.0015, 0.04).rotateZ(-0.45).translate(-0.004, 0.062, 0), '#3d8b37'], [new THREE.CylinderGeometry(0.0015, 0.0015, 0.04).rotateZ(0.35).translate(0.009, 0.062, 0), '#3d8b37'], [ball(0.007, 0.006, 0.083, 0, 1.6, 0.3, 0.8), '#3fae49']],
      lemon: [[ball(0.024, 0, 0.033, 0, 1.25, 0.82, 0.9), '#ffe14f'], [ball(0.006, 0.03, 0.033, 0), '#f2c200'], [ball(0.006, -0.03, 0.033, 0), '#f2c200']],
    };
    caps = TABLE.bumpers.map((p, i) => { const m = new THREE.Mesh(paint(fruitParts[BUMPERS[i]]), shiny()); m.position.set(p.x, 0, -p.y); m.userData.flash = 0; table.add(m); return m; });
    rings = TABLE.bumpers.map(p => { const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2), glowing(null, '#ffffff', { side: THREE.DoubleSide })); m.position.set(p.x, 0.004, -p.y); m.visible = false; m.userData.age = 1; m.raycast = () => {}; table.add(m); return m; });
    // The slingshots' rubber, which jumps as it kicks.
    bands = TABLE.slings.map(([a, b, c]) => {
      const m = new THREE.Mesh(along(...a, ...c, 0.004, 0.012, 0.008), shiny({ vertexColors: false, color: '#f4f2ec' })), mx = (a[0] + c[0]) / 2 - b[0], my = (a[1] + c[1]) / 2 - b[1], l = Math.hypot(mx, my);
      m.userData.out = new THREE.Vector3(mx / l, 0, -my / l); m.userData.kick = 0; table.add(m); return m;
    });
    // The flippers are bananas.
    const shape = new THREE.Shape(); shape.absarc(0, 0, FLIP.base, Math.PI / 2, Math.PI * 1.5, false); shape.lineTo(FLIP.len, -FLIP.tip); shape.absarc(FLIP.len, 0, FLIP.tip, -Math.PI / 2, Math.PI / 2, false); shape.lineTo(0, FLIP.base);
    const flipper = paint([[slab(shape, 0.02), '#ffe14f'], [cyl(FLIP.tip * 0.9, 0.022, FLIP.len, 0), '#6b4423'], [cyl(0.005, 0.024, 0, 0), '#c9ced8']]);
    flippers = TABLE.flippers.map(f => { const m = new THREE.Mesh(flipper, shiny()); m.position.set(f.x, 0, -f.y); table.add(m); return m; });
    targets = TABLE.targets.map((g, i) => { const m = new THREE.Mesh(paint([[box(0.008, 0.03, g.h * 2 - 0.002, g.x, g.y), TARGETS[i]], [box(0.0085, 0.005, g.h * 2 - 0.001, g.x, g.y, 0.022), '#ffffff']]), shiny()); table.add(m); return m; });
    // The spinner: a flap hung across the orbit, turning about its wire; the blender, a disc with blades and fruit on it;
    // the kickback's kicker at the foot of the left outlane.
    spinner = new THREE.Mesh(paint([[new THREE.BoxGeometry(sp.x2 - sp.x1 - 0.006, 0.024, 0.0016).translate(0, -0.013, 0), '#ffe14f'], [new THREE.BoxGeometry(sp.x2 - sp.x1 - 0.006, 0.004, 0.0022).translate(0, -0.023, 0), '#ff4fd8']]), shiny());
    spinner.position.set((sp.x1 + sp.x2) / 2, 0.031, -sp.y); table.add(spinner);
    const B = TABLE.blender;
    blender = new THREE.Mesh(paint([[cyl(B.r, 0.003, 0, 0, 0, 32), '#d4d8e2'], [cyl(0.009, 0.012, 0, 0), '#ff4fd8'],
      ...[0, 1, 2].map(k => [new THREE.BoxGeometry(B.r * 0.85, 0.004, 0.009).translate(B.r * 0.42, 0.005, 0).rotateY(k * Math.PI * 2 / 3), '#ff4fd8']),
      ...[0, 1, 2, 3, 4, 5].map(k => [new THREE.BoxGeometry(0.008, 0.006, 0.008).translate(0.032, 0.006, 0).rotateY(k * Math.PI / 3 + 0.5), FRUIT_COLORS[k]])]), shiny());
    blender.position.set(B.x, 0.0005, -B.y); table.add(blender);
    kicker = new THREE.Mesh(box(0.026, 0.014, 0.012, 0, 0), shiny({ vertexColors: false, color: '#ff3b30' })); kicker.position.set(TABLE.kickback.x, 0, -TABLE.kickback.y); table.add(kicker);
    // The plunger: a rod up the lane with a red tip, and its knob out the front, moving together.
    plunger = new THREE.Mesh(paint([[new THREE.CylinderGeometry(0.0045, 0.0045, 0.1).rotateX(Math.PI / 2).translate(LANE.x, 0.012, 0.055), '#c9ced8'], [new THREE.CylinderGeometry(0.011, 0.011, 0.01).rotateX(Math.PI / 2).translate(LANE.x, 0.012, 0.001), '#e0213a'],
      [new THREE.CylinderGeometry(0.006, 0.006, 0.07).rotateX(Math.PI / 2).translate(LANE.x, -0.05, -FIELD.y0 + 0.06), '#c9ced8'], [ball(0.016, LANE.x, -0.05, -FIELD.y0 + 0.1), '#e0213a']]), shiny());
    table.add(plunger);
    balls = [0, 1, 2].map(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), new THREE.MeshMatcapMaterial({ matcap: matcaps().chrome })); m.visible = false; table.add(m); return m; });
    shadows = balls.map(() => { const m = new THREE.Mesh(new THREE.CircleGeometry(R * 1.1, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.45, depthWrite: false })); m.raycast = () => {}; table.add(m); return m; });
    // The lamps, and a glow round each, as two instanced meshes; their colours change each frame.
    dots = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial(), LAMPS.length);
    halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), glowing(matcaps().spark), LAMPS.length); halos.raycast = () => {};
    const place = new THREE.Matrix4();
    LAMPS.forEach((l, i) => {
      l.c = new THREE.Color(l.color);
      dots.setMatrixAt(i, place.makeScale(l.glow ? 1e-4 : l.r, 1, l.glow ? 1e-4 : l.r).setPosition(l.x, 0.0007, -l.y)); halos.setMatrixAt(i, place.makeScale(l.r * 5, 1, l.r * 5).setPosition(l.x, 0.0012, -l.y));
      dots.setColorAt(i, l.c); halos.setColorAt(i, l.c);
    });
    table.add(dots, halos);
    // Sparks: the balls' trails and the juice that splashes off what they hit.
    const points = (n, size) => { const p = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)).setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3)), new THREE.PointsMaterial({ size, map: matcaps().spark, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); p.frustumCulled = false; p.raycast = () => {}; table.add(p); return p; };
    trail = points(3 * 12, 0.03); trail.userData.past = [[], [], []];
    juice = points(160, 0.02); juice.userData = { v: new Float32Array(480), life: new Float32Array(160), hue: new Float32Array(480), next: 0 };
    // A wash of colour over the whole table for the big moments.
    overlay = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.x1 - FIELD.x0, FIELD.y1 - FIELD.y0).rotateX(-Math.PI / 2).translate(MIDDLE, 0.15, -(FIELD.y0 + FIELD.y1) / 2), glowing(null, '#ffffff', { opacity: 0 }));
    overlay.visible = false; overlay.raycast = () => {}; table.add(overlay);
  }

  // The backbox stands behind the playfield's top end (so it hides none of it): the display at its foot, tipped back to
  // read from above, the backglass over it with a neon frame, and a cherry pair on top.
  function buildBackbox(cab, deck) {
    const end = new THREE.Vector3(MIDDLE, 0.064, -(FIELD.y1 + 0.03)).applyMatrix4(table.matrix).applyMatrix4(deck.matrix), base = end.y, wide = FIELD.x1 - FIELD.x0 + 0.08, back = 0.01, face = end.z - 0.005;
    const at = (x, y, z) => [x, base + y, z];
    cab.add(mesh(paint([[new THREE.BoxGeometry(wide, base + 0.78 - 0.7, face - back).translate(0, (0.7 + base + 0.78) / 2, (face + back) / 2), '#3a1670'], [new THREE.BoxGeometry(wide + 0.02, 0.03, face - back + 0.02).translate(0, base + 0.795, (face + back) / 2), '#d4d8e2'],
      [new THREE.BoxGeometry(wide, 0.16, 0.06).rotateX(-0.6).translate(0, base + 0.06, face + 0.005), '#2b1650'],
      ...[-0.31, 0.31].map(x => [new THREE.CylinderGeometry(0.035, 0.035, 0.006, 20).rotateX(Math.PI / 2).translate(x, base + 0.2, face + 0.002), '#1b1a1f']),
      [ball(0.055, -0.045, base + 0.88, (face + back) / 2), '#e0213a'], [ball(0.055, 0.05, base + 0.865, (face + back) / 2 + 0.01), '#e0213a'], [new THREE.CylinderGeometry(0.006, 0.006, 0.16).rotateZ(-0.4).translate(-0.015, base + 0.99, (face + back) / 2), '#3d8b37'],
      [new THREE.CylinderGeometry(0.006, 0.006, 0.16).rotateZ(0.3).translate(0.03, base + 0.98, (face + back) / 2), '#3d8b37'], [ball(0.03, 0.04, base + 1.06, (face + back) / 2, 1.8, 0.35, 0.9), '#3fae49']]), painted(), 0.006));
    const glass = canvasTexture(512, 384, drawGlass); cab.userData.glass = glass;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(wide - 0.08, (wide - 0.08) * 0.72), new THREE.MeshBasicMaterial({ map: glass })); front.position.set(...at(0, 0.5, face + 0.002)); cab.add(front);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.115), new THREE.MeshBasicMaterial({ map: dmd })); screen.rotation.x = -0.6; screen.position.set(...at(0, 0.075, face + 0.04)); cab.add(screen); cab.userData.screen = screen;
    const top = 0.5 + (wide - 0.08) * 0.36 + 0.01, bottom = 0.5 - (wide - 0.08) * 0.36 - 0.01, half = (wide - 0.06) / 2;
    neon = new THREE.Mesh(paint([[0, top, half * 2, 0.012], [0, bottom, half * 2, 0.012], [-half, 0.5, 0.012, top - bottom], [half, 0.5, 0.012, top - bottom]].map(([x, y, w, h]) => [new THREE.BoxGeometry(w, h, 0.012).translate(x, base + y, face + 0.006), '#ffffff'])), new THREE.MeshBasicMaterial({ vertexColors: true, color: '#ff4fd8' }));
    cab.add(neon);
  }

  // The view: from the table's front, steeper on a narrow screen, as close as fits the playfield and the display, kept
  // clear of the buttons along the top and centred on what it shows. Worked out again only when the screen changes.
  function frame(aspect, height) {
    fit.aspect = aspect; fit.height = height; table.updateWorldMatrix(true, true);
    const world = (x, y, h = 0) => table.localToWorld(new THREE.Vector3(x, h, -y)), screen = table.parent.parent.userData.screen;
    const ends = [[FIELD.x0, FIELD.y0], [FIELD.x1, FIELD.y0], [FIELD.x0, FIELD.y1], [FIELD.x1, FIELD.y1]].map(([x, y]) => world(x, y));
    ends.push(...[-0.23, 0.23].map(x => screen.localToWorld(new THREE.Vector3(x, 0.0575, 0))));
    const rise = THREE.MathUtils.lerp(0.8, 1.2, clamp(1.5 - aspect, 0, 1)), up = new THREE.Vector3(0, 1, 0).transformDirection(table.matrixWorld), ahead = new THREE.Vector3(0, 0, -1).transformDirection(table.matrixWorld);
    const back = ahead.multiplyScalar(-Math.cos(rise)).addScaledVector(up, Math.sin(rise)), look = world(MIDDLE, 0.55), ndc = new THREE.Vector3(), roof = 1 - 2 * 64 / (height || 600);
    probe.fov = FOV; probe.aspect = aspect; probe.updateProjectionMatrix();
    const put = d => { probe.position.copy(look).addScaledVector(back, d); probe.lookAt(look); probe.updateMatrixWorld(); };
    const box = () => { const b = new THREE.Box2(); for (const p of ends) { ndc.copy(p).project(probe); b.expandByPoint(new THREE.Vector2(ndc.x, ndc.y)); } return b; };
    let d = 1.5;
    for (let pass = 0; pass < 3; pass++) {
      let near = 0.3, far = 6;
      for (let k = 0; k < 20; k++) { d = (near + far) / 2; put(d); const b = box(); if (b.min.x > -0.97 && b.max.x < 0.97 && b.min.y > -0.98 && b.max.y < roof) far = d; else near = d; }
      d = far; put(d);
      // Centre it in what's left: across, and between the bottom and the buttons.
      const b = box(), half = d * Math.tan(THREE.MathUtils.degToRad(FOV / 2)), right = new THREE.Vector3().setFromMatrixColumn(probe.matrixWorld, 0), upward = new THREE.Vector3().setFromMatrixColumn(probe.matrixWorld, 1);
      look.addScaledVector(right, (b.min.x + b.max.x) / 2 * half * aspect).addScaledVector(upward, ((b.min.y + b.max.y) / 2 - (roof - 0.98) / 2) * half);
    }
    put(d); fit.from.copy(probe.position); fit.look.copy(look);
  }

  // What just happened on the table: sounds, flashes, juice, a shake, the best kept.
  function react(dt) {
    for (const e of t.events) {
      if (e.kind === 'over') { best = t.best; try { localStorage.setItem(BEST, String(best)); } catch {} }
      if (active) SOUNDS[e.kind]?.(e);
      if (still) continue;
      if (e.kind === 'bump') { caps[e.i].userData.flash = 1; rings[e.i].userData.age = 0; splash(e.x, e.y, JUICE[e.i], 16); shake = Math.max(shake, 0.004); }
      else if (e.kind === 'sling') { bands[e.i].userData.kick = 1; splash(e.x, e.y, '#ff3b5c', 10); shake = Math.max(shake, 0.003); }
      else if (e.kind === 'target') { splash(e.x - 0.012, e.y, TARGETS[e.i], 14); shake = Math.max(shake, 0.003); }
      else if (e.kind === 'juicer' || e.kind === 'eject') splash(e.x, e.y, '#7dff6b', 24);
      else if (e.kind === 'lane') splash(e.x, e.y, '#ffe14f', 8);
      else if (e.kind === 'blend') splash(e.x, e.y, FRUIT_COLORS[Math.floor(time * 7) % 6], 3);
      else if (e.kind === 'shot') { splash(e.x, e.y, FRUIT_COLORS[e.i], 30); wash(FRUIT_COLORS[e.i], 0.25 + 0.1 * Math.min(3, e.combo), e.combo ? 0.8 : 0); }
      else if (e.kind === 'kick') { kicked = 1; wash('#ff3b30', 0.4, 0); shake = Math.max(shake, 0.005); }
      else if (e.kind === 'nudge') shake = Math.max(shake, 0.008);
      else if (e.kind === 'tilt') wash('#ff2d55', 0.6, 0);
      else if (e.kind in { jackpot: 1, multiball: 1, skill: 1, mult: 1, saved: 1, start: 1, fruit: 1, salad: 1 }) {
        wash({ jackpot: '#ffe14f', multiball: '#ff4fd8', skill: '#38f2ff', mult: '#38f2ff', saved: '#ff8a3d', start: '#7dff6b', salad: '#ffe14f' }[e.kind] ?? FRUIT_COLORS[e.i], e.kind === 'start' ? 0.25 : 0.55, { jackpot: 1.6, multiball: 1.6, salad: 3 }[e.kind] ?? 0.8);
        if (e.kind === 'jackpot') splash(TABLE.saucer.x, TABLE.saucer.y, '#ffe14f', 60);
        if (e.kind !== 'start') shake = Math.max(shake, 0.006);
      } else if (e.kind === 'drain' && !t.balls.length) wash('#ff2d55', 0.3, 0);
    }
    t.events.length = 0;
    shake *= Math.exp(-dt * 18); if (shake < 2e-4 || still) shake = 0;
    wobble.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake);
  }
  // A wash of `color` over the table, and the lamps going wild for `wild` seconds.
  function wash(color, amount, wild) { overlay.material.color.set(color); flash = Math.max(flash, amount); party = Math.max(party, time + wild); }
  // `n` drops of juice off (x, y), in `color`.
  function splash(x, y, color, n) {
    const { v, life, hue } = juice.userData, pos = juice.geometry.attributes.position; tint.set(color);
    for (let k = 0; k < n; k++) {
      const i = juice.userData.next = (juice.userData.next + 1) % life.length, a = Math.random() * Math.PI * 2, s = 0.25 + Math.random() * 0.6;
      pos.setXYZ(i, x, 0.02, -y); v.set([Math.cos(a) * s, 0.3 + Math.random() * 0.6, Math.sin(a) * s], i * 3); life[i] = 0.35 + Math.random() * 0.35;
      hue.set([tint.r * (0.7 + Math.random() * 0.6), tint.g * (0.7 + Math.random() * 0.6), tint.b * (0.7 + Math.random() * 0.6)], i * 3);
    }
  }

  function draw(dt) {
    t.flippers.forEach((f, i) => { flippers[i].rotation.y = f.a; });
    plunger.position.z = 0.035 * t.pull;
    spinner.rotation.x = t.spinAngle; blender.rotation.y = t.blendAngle;
    kicker.position.z = -0.02 * kicked; kicked = Math.max(0, kicked - dt * 8);
    targets.forEach((m, i) => { m.position.y += ((t.targets[i] ? 0 : -0.035) - m.position.y) * (still ? 1 : Math.min(1, dt * 25)); });
    // The balls (up on a ramp, or sunk in the juicer), and their trails as they go.
    const past = trail.userData.past, tp = trail.geometry.attributes.position, tc = trail.geometry.attributes.color;
    balls.forEach((m, i) => {
      const b = t.balls[i]; m.visible = shadows[i].visible = !!b;
      const h = b ? (b.h || 0) + R - (b.held ? 0.008 : 0) : 0;
      if (b) { m.position.set(b.x, h, -b.y); shadows[i].position.set(b.x, 0.0015, -b.y + 0.004 + (b.h || 0) * 0.3); }
      const line = past[i]; if (b && !still) { line.unshift([b.x, h, -b.y, Math.hypot(b.vx, b.vy, b.ramp?.v || 0)]); line.length = Math.min(line.length, 12); } else line.length = 0;
      for (let k = 0; k < 12; k++) {
        const p = line[k], j = i * 12 + k, glow = p ? (1 - k / 12) * Math.min(1, p[3] / 2.5) : 0;
        if (p) tp.setXYZ(j, p[0], p[1], p[2]); tc.setXYZ(j, glow, glow * 0.55, glow * 0.95);
      }
    });
    tp.needsUpdate = tc.needsUpdate = true;
    // Juice: thrown up off the table, falling back and fading.
    const { v, life, hue } = juice.userData, jp = juice.geometry.attributes.position, jc = juice.geometry.attributes.color;
    for (let i = 0; i < life.length; i++) {
      if (life[i] <= 0) { jc.setXYZ(i, 0, 0, 0); continue; }
      life[i] -= dt; v[i * 3 + 1] -= 3 * dt;
      jp.setXYZ(i, jp.getX(i) + v[i * 3] * dt, Math.max(0.001, jp.getY(i) + v[i * 3 + 1] * dt), jp.getZ(i) + v[i * 3 + 2] * dt);
      const k = Math.min(1, life[i] * 3); jc.setXYZ(i, hue[i * 3] * k, hue[i * 3 + 1] * k, hue[i * 3 + 2] * k);
    }
    jp.needsUpdate = jc.needsUpdate = true;
    caps.forEach(m => { m.material.color.setScalar(1 + 1.6 * m.userData.flash); m.userData.flash = Math.max(0, m.userData.flash - dt * 7); });
    rings.forEach(m => { const age = m.userData.age += dt; m.visible = age < 0.35; if (m.visible) { m.scale.setScalar(0.035 + age * 0.2); m.material.opacity = 1 - age / 0.35; } });
    bands.forEach(m => { m.position.copy(m.userData.out).multiplyScalar(0.005 * m.userData.kick); m.userData.kick = Math.max(0, m.userData.kick - dt * 14); });
    overlay.visible = flash > 0.01; overlay.material.opacity = flash; flash *= Math.exp(-dt * 5);
    lamps();
    const salad = t.time < t.saladUntil, cycle = still ? 0.88 : (time * (salad ? 0.5 : 0.08)) % 1;
    neon.material.color.setHSL(cycle, 1, 0.6); floorGlow.material.color.setHSL((cycle + 0.5) % 1, 1, 0.55);
    // The display, at most ten times a second and only when what it shows changes.
    if (time - dmdAt > 0.1) {
      dmdAt = time; const s = screen(), key = JSON.stringify(s);
      if (key !== dmdKey) { dmdKey = key; dmd.redraw(s); }
    }
  }
  function lamps() {
    const blink = hz => still || (time * hz) % 1 < 0.5 ? 1 : 0, wild = !still && (time < party || t.time < t.saladUntil), down = t.targets.filter(up => !up).length;
    LAMPS.forEach((l, n) => {
      let on;
      if (wild) on = (time * 12 + n) % 2 < 1 ? 1 : 0.1;
      else if (t.mode !== 'play') on = still ? 0.6 : 0.5 + 0.5 * Math.sin(time * 5 - n * 0.7);
      else if (t.tilted) on = 0;
      else if (l.kind === 'lane') on = t.lit[l.i] ? 1 : t.time < t.skillUntil && l.i === t.skillLane ? blink(5) : 0;
      else if (l.kind === 'target') on = t.targets[l.i] ? 0 : 1;
      else if (l.kind === 'mult') on = t.mult >= l.i ? 1 : 0;
      else if (l.kind === 'save') on = t.time < t.saveUntil ? blink(2.5) : 0;
      else if (l.kind === 'juicer') on = t.balls.some(b => b.held) ? blink(10) : t.multiball ? blink(3) : 0.3;
      else if (l.kind === 'kickback') on = t.kickback ? 1 : 0;
      else if (l.kind === 'spinner') on = Math.min(1, t.spinSpeed / 20);
      else if (l.kind === 'fruit') on = t.fruits[l.i] ? 1 : 0;
      else if (l.i === 4) on = t.multiball ? 0 : down === 2 ? blink(4) : blink(1.5); // the drop targets' arrow: multiball
      else on = t.fruits[l.i] ? 0.15 : t.time < t.comboUntil ? blink(6) : blink(1.5);
      dots.setColorAt(n, tint.copy(l.c).multiplyScalar(0.14 + 0.86 * on)); halos.setColorAt(n, tint.copy(l.c).multiplyScalar((l.glow ? 1.4 : 2) * on));
    });
    dots.instanceColor.needsUpdate = halos.instanceColor.needsUpdate = true;
  }
  // What the display says: news first, then the game, else the attract loop.
  function screen() {
    const news = t.message && t.time - t.message.at < 1.8 ? t.message.text : '', phase = still ? 0 : Math.floor(time * 10);
    if (news) return { big: news, rainbow: true, phase };
    if (t.mode === 'play') {
      const top = !active ? 'PAUSED' : t.tilted ? 'TILT' : waiting(t) && !t.launched ? (coarse?.matches ? 'HOLD, LET GO' : 'HOLD SPACE, LET GO')
        : t.time < t.saladUntil ? `FRUIT SALAD ${Math.ceil(t.saladUntil - t.time)}` : `BALL ${t.ball}  ${t.fruits.filter(Boolean).length}/6${t.mult > 1 ? `  ${t.mult}X` : ''}`;
      return { top, big: fmt(t.score), rainbow: t.time < t.saladUntil, phase };
    }
    return [{ top: 'TUTTI FRUTTI', big: active ? 'FLIP TO PLAY' : 'PINBALL' }, { top: 'HIGH SCORE', big: fmt(best) }, { top: t.last ? 'LAST GAME' : 'FRUIT SALAD', big: t.last ? fmt(t.last) : 'GET ALL SIX' }][Math.floor(time / 2.5) % 3];
  }

  // Presses: the left or right half of the screen works that flipper (and the plunger, while a ball waits).
  canvas.addEventListener('pointerdown', event => {
    if (!active || event.pointerType === 'mouse' && event.button !== 0) return;
    const r = canvas.getBoundingClientRect(); pointers.set(event.pointerId, event.clientX < r.left + r.width / 2 ? 'left' : 'right'); hear();
  });
  const lift = event => pointers.delete(event.pointerId);
  canvas.addEventListener('pointerup', lift); canvas.addEventListener('pointercancel', lift);
  return pinball;
}
