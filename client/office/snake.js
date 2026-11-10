// Snake on the office floor. Click the snake plant in the back corner (or E on it) and the view drops in behind a snake curled
// at its pot. ← → (A D) turn it left or right of where it's heading, as does a click on that half of the screen. On a phone you pick, before it's off,
// Swipe (the default: a finger that moves sideways turns it at once) or Tap (a finger turns it towards its half the moment it lands).
// ↑ ↓, W S or Space (or a touch, before it's off) sets it off, and again after a crash. Esc or ✕ steps back and pauses it.
// It runs on path.js's walk grid a cell (25 cm) a step, so a turn never waits long. Furniture, walls and its own body end the
// run, though about to hit one it holds a moment first, shivering, for a turn to save it. The grid shows on the floor round it
// while it plays, faint red where it would crash. One apple at a time, somewhere it can get to a few metres off, under a beam
// of light to find it by; each makes it longer over the next few steps and a bit quicker. The best is kept per browser. With
// reduced motion the apple and its beam hold still, the body doesn't sway and nothing pops, shivers or shakes; the game still
// moves. The rules (newSnake to tick) are pure, so they run under node --test; the 3D follows them.
import * as THREE from 'three';
import { piece } from './furniture.js';
import { toonMaterial, withOutline } from './toon.js';
import { CELL, index, nearestOpen } from './path.js';

export const SPAN = CELL; // metres a step: one cell of the walk grid
// Headings, clockwise seen from above (x right, z towards the front): a right turn is +1.
export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const LENGTH = 16, GROW = 3; // segments to start with (4 m: the office is big), and more for each apple
const RATE = 8, FAST = 16, QUICKER = 0.4; // steps a second to start (2 m/s), at most, and more per apple
const NEAR = 3, FAR = 8, AGAIN = 0.5; // metres' crawl off an apple goes when it can be; seconds after a crash before going again
export const CLEAR = 0.12; // metres kept off something moving about (the goose) beyond its own radius: its red circle
export const STALL = 0.12; // seconds it holds, about to hit something, for a turn: about a step at the start

const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const openAt = (grid, x, z) => grid.open[index(grid, { x, z })] === 1;
// Inside one of `blocks` (things moving about, { x, z, r }: the goose), by its red circle. Only the head minds them, so the
// goose can waddle across the body.
const inside = (blocks, [x, z]) => blocks.some(b => Math.hypot(x - b.x, z - b.z) < b.r + CLEAR);
// The next step would hit something: the way it's heading, or will be once the next turn's taken.
const shut = (s, grid, blocks) => {
  const d = DIRS[s.turns.length ? (s.dir + s.turns[0] + 4) % 4 : s.dir], next = [s.body[0][0] + d[0] * SPAN, s.body[0][1] + d[1] * SPAN];
  return !openAt(grid, ...next) || inside(blocks, next) || (s.grow > 0 ? s.body : s.body.slice(0, -1)).some(b => same(b, next));
};
const centre = (grid, k) => [grid.left + (k % grid.cols + 0.5) * CELL, grid.back + (Math.floor(k / grid.cols) + 0.5) * CELL];

// A cell's four neighbours on the grid (-1 off its side; off its top or bottom is past the ends of the cells).
const around = (k, cols) => [k - cols, k + cols, k % cols ? k - 1 : -1, k % cols < cols - 1 ? k + 1 : -1];

// How many steps each cell is from `from` round the furniture (-1: no way there). ponytail: the body doesn't block it, so an
// apple can land behind the snake's own coils; fine until the snake fills whole aisles.
export function reach(grid, from) {
  const { cols, open } = grid, steps = new Int32Array(open.length).fill(-1), queue = new Int32Array(open.length), start = index(grid, { x: from[0], z: from[1] });
  if (start < 0) return steps;
  let tail = 0; steps[start] = 0; queue[tail++] = start;
  for (let q = 0; q < tail; q++) {
    const k = queue[q];
    for (const n of around(k, cols)) if (n >= 0 && open[n] && steps[n] < 0) { steps[n] = steps[k] + 1; queue[tail++] = n; }
  }
  return steps;
}
// 1 for each cell with room to turn round in (part of a 2×2 that's all open) in the biggest stretch of them joined up
// through each other: the office floor. Not a dead end one cell wide, nor a pocket behind a gap that narrow: the snake
// can't reverse, and coming back out its own body would be in the gap.
export function roomy(grid) {
  const { cols, open } = grid, wide = new Uint8Array(open.length), group = new Int32Array(open.length).fill(-1), queue = new Int32Array(open.length);
  for (let k = 0; k < open.length - cols; k++) if (k % cols < cols - 1 && open[k] && open[k + 1] && open[k + cols] && open[k + cols + 1]) wide[k] = wide[k + 1] = wide[k + cols] = wide[k + cols + 1] = 1;
  let biggest = -1, most = 0;
  for (let k = 0; k < open.length; k++) { // each stretch is known by the first cell found in it
    if (!wide[k] || group[k] >= 0) continue;
    let tail = 0; queue[tail++] = k; group[k] = k;
    for (let q = 0; q < tail; q++) for (const n of around(queue[q], cols)) if (n >= 0 && wide[n] && group[n] < 0) { group[n] = k; queue[tail++] = n; }
    if (tail > most) { most = tail; biggest = k; }
  }
  return Uint8Array.from(group, g => g >= 0 && g === biggest ? 1 : 0);
}
// Somewhere off the snake it can reach and get away from again (roomy), NEAR to FAR metres' crawl off if anywhere is; any
// spot it can reach if none's roomy; null if it can reach nowhere.
export function placeApple(s, grid, rand = Math.random) {
  const steps = reach(grid, s.body[0]), taken = new Set(s.body.map(([x, z]) => index(grid, { x, z }))), ok = roomy(grid), pools = [[], [], []];
  for (let k = 0; k < steps.length; k++) {
    if (steps[k] <= 0 || taken.has(k)) continue;
    pools[2].push(k); if (!ok[k]) continue;
    pools[1].push(k); if (steps[k] * SPAN >= NEAR && steps[k] * SPAN <= FAR) pools[0].push(k);
  }
  const pool = pools.find(p => p.length);
  return pool ? centre(grid, pool[Math.floor(rand() * pool.length)]) : null;
}

// A snake at the open cell nearest `at`, all of it there until it moves off, facing the longest way clear.
export function newSnake(grid, at, best = 0, rand = Math.random) {
  const start = nearestOpen(grid, at); if (!start) return null;
  const head = [start.x, start.z], run = ([dx, dz]) => { let n = 0; while (openAt(grid, head[0] + dx * SPAN * (n + 1), head[1] + dz * SPAN * (n + 1))) n++; return n; };
  const dir = DIRS.reduce((b, d, i) => run(d) > run(DIRS[b]) ? i : b, 0), body = Array.from({ length: LENGTH }, () => [...head]);
  const s = { body, prev: body, dir, turns: [], mode: 'ready', eaten: 0, grow: 0, stall: 0, best, record: false, rate: RATE, acc: 0, time: 0, overAt: 0, apple: null };
  s.apple = placeApple(s, grid, rand);
  return s;
}
// Left (-1) or right (+1) of where it's heading, at its next step; two can wait, so a quick pair turns it round.
export function turn(s, side) {
  if (s.mode === 'over') return;
  s.mode = 'play';
  if (s.turns.length < 2) s.turns.push(side);
}
export const go = s => { if (s.mode === 'ready') s.mode = 'play'; };
export const settled = s => s.mode === 'over' && s.time - s.overAt >= AGAIN;
// One step: 'step', 'eat', 'crash' or 'bump' (into one of `blocks`, which ends it too).
export function step(s, grid, blocks = [], rand = Math.random) {
  if (s.turns.length) s.dir = (s.dir + s.turns.shift() + 4) % 4;
  const d = DIRS[s.dir], next = [s.body[0][0] + d[0] * SPAN, s.body[0][1] + d[1] * SPAN], eats = !!s.apple && same(next, s.apple);
  if (eats) s.grow += GROW;
  const body = s.grow > 0 ? s.body : s.body.slice(0, -1); // the tail moves off, unless it's growing
  const bump = inside(blocks, next);
  if (bump || !openAt(grid, ...next) || body.some(b => same(b, next))) { s.mode = 'over'; s.overAt = s.time; s.prev = s.body; s.acc = 0; s.turns = []; s.record = s.eaten > s.best; s.best = Math.max(s.best, s.eaten); return bump ? 'bump' : 'crash'; }
  if (s.grow > 0) s.grow--;
  s.prev = s.body; s.body = [next, ...body];
  if (!eats) return 'step';
  s.eaten++; s.rate = Math.min(FAST, RATE + s.eaten * QUICKER); s.apple = placeApple(s, grid, rand);
  return 'eat';
}
// `dt` seconds on: what happened, a step at a time. An apple something's been put down on goes somewhere else. About to hit
// something, it holds where it is up to STALL seconds; a turn then is taken on the spot (one into something else as well, so
// the next can still save it), and it crashes if it's still shut when the time's up.
export function tick(s, grid, dt, blocks = [], rand = Math.random) {
  const happened = []; s.time += dt;
  if (s.apple && !openAt(grid, ...s.apple)) s.apple = placeApple(s, grid, rand);
  if (s.mode !== 'play') return happened;
  s.acc += dt * s.rate;
  while (s.mode === 'play' && s.acc >= 1) {
    if (shut(s, grid, blocks)) {
      if (s.turns.length) { s.dir = (s.dir + s.turns.shift() + 4) % 4; continue; }
      if ((s.stall += (s.acc - 1) / s.rate) < STALL) { s.acc = 1; break; } // only the time since the step fell due, whatever the frame rate
    }
    s.stall = 0; s.acc--; happened.push(step(s, grid, blocks, rand)); // a crash stops it where it is
  }
  return happened;
}

// The 3D. Behind and above the head, looking on ahead of it; how fast the view and the head swing round to a new heading, the
// view follows the head, and the view comes in (when something's behind) and goes back out again.
const BACK = 1.7, NEAREST = 0.4, UP = 1.75, AHEAD = 2.2, FOV = 70, VIEW_TURN = 10, HEAD_TURN = 22, FOLLOW = 10, IN = 12, OUT = 3;
// The body: its radius (m); rings along it at most, points round each, rings a segment (4 cm apart); how many segments either
// side of a corner it's rounded off; how long the tail tapers, at most (m).
const R = 0.1, RINGS = 1200, AROUND = 12, PER = 6, ROUND = 0.36, TAIL = 1.2;
const GRID = 5, BEST = 'ai-control-snake-best', TOUCH = 'ai-control-snake-touch'; // metres round the head the grid shows
const GREEN = '#5cae4f', DARK = '#3d7d3c', BELLY = '#f0e2a6', INK = '#1b1a1f';
const ball = (r, x, y, z, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, 16, 12).scale(sx, sy, sz).translate(x, y, z);
const spin = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Where a ring goes: the middle of the body `m` segments from the head (segment i's drawn at `points[i]`), corners rounded off
// ROUND segments either side; `tangent`, if given, runs towards the tail. By segment rather than by length, so a ring keeps to
// its bit of the snake while a corner's cut short mid-step (spaced by length, the rings slid as it came and went, the more so
// the further down the body: the tail shook).
const p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
export function spine(points, m, out, tangent) {
  const at = (x, o) => { const i = Math.min(Math.max(Math.floor(x), 0), points.length - 2); return o.lerpVectors(points[i], points[i + 1], Math.min(Math.max(x - i, 0), 1)); };
  at(m - ROUND, p1); at(m + ROUND, p2); tangent?.subVectors(p2, p1);
  return out.addVectors(p1, p2).multiplyScalar(0.5);
}

// The grid on the floor, worked out in the shader so its lines stay one pixel thin and sharp however near: white round the
// cells it can go on, a red wash on the shut ones beside them, fading out GRID metres from the head and wherever the cells
// get too small to tell apart. `cells`: one texel a cell, 1 open, ½ shut beside open, 0 neither.
function gridMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { cells: { value: null }, origin: { value: new THREE.Vector2() }, size: { value: new THREE.Vector2(1, 1) }, head: { value: new THREE.Vector2() } },
    vertexShader: 'varying vec2 vAt; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vAt = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform sampler2D cells; uniform vec2 origin, size, head; varying vec2 vAt;
      void main() {
        vec2 c = (vAt - origin) / ${CELL.toFixed(4)}, w = fwidth(c), edge = (0.5 - abs(fract(c) - 0.5)) / w;
        float state = texture2D(cells, (floor(c) + 0.5) / size).r;
        float line = (1.0 - smoothstep(0.0, 1.0, min(edge.x, edge.y))) * (1.0 - smoothstep(0.08, 0.25, max(w.x, w.y)));
        float fade = 1.0 - smoothstep(${(GRID / 2).toFixed(1)}, ${GRID.toFixed(1)}, distance(vAt, head));
        float a = state > 0.75 ? line * 0.3 : state > 0.25 ? 0.3 + line * 0.45 : 0.0;
        gl_FragColor = vec4(state > 0.75 ? vec3(1.0) : vec3(1.0, 0.18, 0.22), a * fade);
      }`,
  });
}

// `grid()`: the walk grid (null before there's an office); `home()`: where the snake plant stands; `score(goal, verdict)`:
// the score bar (null clears it); `blocks()`: what's moving about to keep off ({ x, z, r }: the goose); `bump()`: one was hit.
export function createSnake({ canvas, grid, home, score, blocks = () => [], bump = () => {} }) {
  let best = 0; try { best = Number(localStorage.getItem(BEST)) || 0; } catch { /* no storage here */ }
  let touchMode = 'swipe'; try { if (localStorage.getItem(TOUCH) === 'tap') touchMode = 'tap'; } catch { /* no storage here */ }
  let s = null, active = false, linger = 0, shake = 0, gulp = 0, bulge = Infinity, headYaw = 0, viewYaw = 0, distance = 0, fresh = true, bumped = false, shown = '', gridKey = '';
  const held = new Set(), from = new THREE.Vector3(), look = new THREE.Vector3(), wobble = new THREE.Vector3(), at = new THREE.Vector3(), follow = new THREE.Vector3();
  const root = new THREE.Group(); root.visible = false;

  // The body: a tube bent along it every frame (ring 0 at the head), green with darker bands across the back and a pale belly.
  // Only its layout's kept from the cylinder; its normals do for the outline's too.
  const tube = new THREE.CylinderGeometry(1, 1, 1, AROUND, RINGS - 1, true), colors = new Float32Array(tube.attributes.position.count * 3), tint = new THREE.Color();
  for (let r = 0; r < RINGS; r++) for (let a = 0; a <= AROUND; a++) {
    const up = Math.cos(a / AROUND * Math.PI * 2);
    tint.set(up < -0.3 ? BELLY : (r / PER * SPAN) % 0.32 < 0.08 && up > 0 ? DARK : GREEN).toArray(colors, (r * (AROUND + 1) + a) * 3);
  }
  tube.setAttribute('color', new THREE.BufferAttribute(colors, 3)); tube.setAttribute('outlineNormal', tube.attributes.normal);
  const body = withOutline(new THREE.Mesh(tube, toonMaterial('#ffffff', { vertexColors: true })), 0.008);
  body.frustumCulled = body.children[0].frustumCulled = false; body.raycast = () => {}; root.add(body);
  // The head, facing +z, a little wider than the neck: a flat skull over a pale jaw, eyes up top, nostrils, a forked tongue that flicks.
  const head = new THREE.Group(); root.add(head);
  head.add(piece('snake-head', () => [[ball(0.12, 0, 0.1, 0.035, 1, 0.62, 1.3), GREEN], [ball(0.105, 0, 0.07, 0.04, 0.95, 0.42, 1.25), BELLY], [ball(0.05, 0, 0.142, -0.02, 1, 0.3, 1.3), DARK],
    ...[1, -1].flatMap(side => [[ball(0.04, side * 0.068, 0.14, 0.085), '#ffffff'], [ball(0.022, side * 0.08, 0.15, 0.115), INK], [ball(0.008, side * 0.03, 0.115, 0.188), INK]])]));
  const tongue = piece('snake-tongue', () => [[new THREE.BoxGeometry(0.012, 0.005, 0.09).translate(0, 0, 0.045), '#e63946'], ...[1, -1].map(side => [new THREE.BoxGeometry(0.009, 0.005, 0.045).translate(0, 0, 0.022).rotateY(side * 0.5).translate(0, 0, 0.09), '#e63946'])], 0);
  tongue.position.set(0, 0.07, 0.19); head.add(tongue);
  // The apple, and a beam over it to find it by from across the office.
  const apple = new THREE.Group(); root.add(apple);
  apple.add(piece('snake-apple', () => [[ball(0.1, 0, 0.11, 0, 1, 0.9, 1), '#e63946'], [new THREE.CylinderGeometry(0.008, 0.01, 0.07, 6).translate(0, 0.23, 0), '#6b4423'], [ball(0.04, 0.035, 0.23, 0, 1, 0.25, 0.55), '#4f9a4a']]));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 3, 16, 1, true).translate(0, 1.5, 0), new THREE.MeshBasicMaterial({ color: '#ffe14d', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.raycast = () => {}; apple.add(beam);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), gridMaterial()); floor.raycast = () => {}; root.add(floor);
  // A red circle under each thing moving about, as far out as it's kept off: a disc and a rim, made as they're needed.
  const circles = [], red = new THREE.MeshBasicMaterial({ color: '#ff2e38', transparent: true, opacity: 0.3, depthWrite: false });
  const rim = new THREE.MeshBasicMaterial({ color: '#ff2e38', transparent: true, opacity: 0.8, depthWrite: false });
  const circle = () => { const c = new THREE.Group(); c.add(new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), red), new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48).rotateX(-Math.PI / 2), rim)); c.traverse(m => { m.raycast = () => {}; }); root.add(c); return c; };

  const restart = () => { const g = grid(), spot = home(); s = g && spot ? newSnake(g, spot, best) : null; if (s) headYaw = viewYaw = Math.atan2(...DIRS[s.dir]); bulge = Infinity; fresh = true; bumped = false; };
  const press = () => { if (!s) return; if (settled(s)) restart(); else go(s); };
  const showScore = () => {
    const over = s?.mode === 'over', touch = globalThis.matchMedia?.('(pointer: coarse)')?.matches, line = s ? [s.eaten, best, s.mode, bumped, touch && touchMode].join() : '';
    if (line === shown) return; shown = line;
    if (!s) { score(null); return; }
    const pick = mode => () => { touchMode = mode; try { localStorage.setItem(TOUCH, mode); } catch { /* no storage here */ } shown = ''; showScore(); };
    const chips = s.mode === 'ready' && touch ? [['swipe', '↔ Swipe'], ['tap', '👆 Tap']].map(([mode, text]) => ({ text, on: touchMode === mode, pick: pick(mode) })) : [];
    const hint = s.mode === 'ready' ? (touch ? 'Tap to go' : '↑ go · ← → turn') : over ? (touch ? 'Tap again' : '↑ again') : null;
    score([{ text: `🍎 ${s.eaten}` }, { text: `Best ${best}` }, ...chips, ...hint ? [{ text: hint }] : []], over ? (s.record ? 'New best!' : bumped ? 'Honk!' : 'Crash!') : null);
  };
  // ↓ and S as well as ↑: unclaimed, they'd be walking keys, which step out of a game (office.js).
  const KEYS = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1, ArrowUp: 0, KeyW: 0, ArrowDown: 0, KeyS: 0, Space: 0 };

  const snake = {
    root,
    get game() { return s; }, // for tests
    enter() { active = true; fresh = true; if (!s || s.mode === 'over') restart(); else s.mode = 'ready'; shown = ''; showScore(); },
    leave() { active = false; held.clear(); linger = 0.6; score(null); shown = ''; }, // drawn on while the view comes back
    blur() { held.clear(); },
    // In front of the plant, facing it.
    stand() { const spot = home(), g = grid(), p = spot && g && nearestOpen(g, spot) || spot || new THREE.Vector3(); return { x: p.x, z: p.z, yaw: spot ? Math.atan2(spot.x - p.x, spot.z - p.z) : 0 }; },
    pose() { return { from: from.clone().add(wobble), look: look.clone().add(wobble), fov: FOV, hands: false, wide: true }; }, // wide: more across on a phone held upright (camera.js)
    click() { return false; }, // presses steer (below)
    // A key while playing: true if it's one of the snake's (office.js leaves it be); held keys don't repeat.
    key(code, down) {
      if (!(code in KEYS) || !active) return false;
      if (!down) { held.delete(code); return true; }
      if (held.has(code)) return true;
      held.add(code);
      if (s && KEYS[code]) turn(s, KEYS[code]); else press();
      return true;
    },
    update(dt, reduced) {
      if (!active && (linger -= dt) <= 0) { root.visible = false; return; }
      const g = grid(); root.visible = !!s && !!g; if (!root.visible) return;
      const near = blocks();
      if (active) for (const happened of tick(s, g, dt, near)) {
        if (happened === 'eat' && !reduced) { gulp = 1; bulge = 0; }
        if (happened === 'bump') { bumped = true; bump(); }
        if (happened === 'crash' || happened === 'bump') { if (!reduced) shake = 1; if (s.best > best) { best = s.best; try { localStorage.setItem(BEST, String(best)); } catch { /* no storage here */ } } }
      }
      draw(dt, reduced, g, near); if (active) showScore();
    },
  };

  // Where segment i is drawn: on its way from where it was to where it is.
  const segment = (i, out) => { const b = s.body[i], a = s.prev[i] || b; return out.set(a[0] + (b[0] - a[0]) * s.acc, 0, a[1] + (b[1] - a[1]) * s.acc); };
  const points = [], mid = new THREE.Vector3(), t = new THREE.Vector3(), side = new THREE.Vector3(), vertical = new THREE.Vector3(0, 1, 0);
  // The tube along the segments, corners rounded off, thinning to the tail, swaying a little as it goes, with a lump where it swallowed.
  function bend(reduced, dt) {
    const n = s.body.length; while (points.length < n) points.push(new THREE.Vector3());
    points.length = n; for (let i = 0; i < n; i++) segment(i, points[i]);
    body.visible = points.some(p => p.distanceToSquared(points[0]) > 0.0025); if (!body.visible) return; // still curled up
    const per = Math.min(PER, Math.floor((RINGS - 1) / (n - 1))), rings = (n - 1) * per + 1, long = (n - 1) * SPAN, tail = Math.min(TAIL, long * 0.6);
    const sway = reduced || s.mode !== 'play' ? 0 : 0.018, back = DIRS[s.dir], pos = tube.attributes.position.array, nor = tube.attributes.normal.array;
    bulge += dt * (s.rate * SPAN + 1);
    for (let r = 0; r < RINGS; r++) {
      // Rings past the tail fold away under the floor, at its tip.
      if (r >= rings) { for (let a = 0, k = r * (AROUND + 1) * 3; a <= AROUND; a++, k += 3) { pos[k] = mid.x; pos[k + 1] = -0.05; pos[k + 2] = mid.z; } continue; }
      const d = r / per * SPAN; // metres down the body, as it'd be laid out straight
      spine(points, r / per, mid, t); if (t.lengthSq() < 1e-8) t.set(-back[0], 0, -back[1]); t.normalize();
      side.crossVectors(vertical, t);
      mid.addScaledVector(side, sway * Math.sin(d * 14 - s.time * 9) * Math.min(1, d * 3));
      const radius = R * (0.15 + 0.85 * smooth(0, tail, long - d)) * (1 + 0.45 * Math.exp(-(((d - bulge) / 0.1) ** 2)));
      for (let a = 0; a <= AROUND; a++) {
        const th = a / AROUND * Math.PI * 2, sx = Math.sin(th), cy = Math.cos(th), k = (r * (AROUND + 1) + a) * 3;
        const nx = side.x * sx, ny = cy, nz = side.z * sx; // round it: side × sin, up × cos (side × up runs along the body, as the cylinder's rows do)
        pos[k] = mid.x + nx * radius; pos[k + 1] = radius * 0.85 * (1 + cy); pos[k + 2] = mid.z + nz * radius;
        nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz;
      }
    }
    tube.attributes.position.needsUpdate = tube.attributes.normal.needsUpdate = true;
  }
  function draw(dt, reduced, g, near) {
    while (circles.length < near.length) circles.push(circle());
    circles.forEach((c, i) => { const b = near[i]; c.visible = !!b; if (b) { c.position.set(b.x, 0.022, b.z); c.scale.setScalar(b.r + CLEAR); } });
    shade(g); bend(reduced, dt);
    // The head turns to where it's going (the heading's set as each step starts); the view swings round after it.
    segment(0, at); const yaw = Math.atan2(...DIRS[s.dir]);
    headYaw += spin(headYaw, yaw) * (1 - Math.exp(-dt * HEAD_TURN)); viewYaw += spin(viewYaw, headYaw) * (1 - Math.exp(-dt * VIEW_TURN));
    head.position.copy(at); head.rotation.y = headYaw; head.scale.setScalar(1 + 0.3 * gulp); gulp = Math.max(0, gulp - dt * 4);
    head.rotation.z = s.stall > 0 && s.mode === 'play' && !reduced ? Math.sin(s.time * 70) * 0.08 : 0; // a shiver while it holds
    tongue.visible = !reduced && s.mode !== 'over' && s.time % 1.6 < 0.3; tongue.scale.z = Math.sin((s.time % 1.6) / 0.3 * Math.PI);
    floor.material.uniforms.head.value.set(at.x, at.z);

    // Back as far as BACK over open floor (a wall or the printer behind it would be in the way of the view), looking nearer
    // when it's closer in so the head stays in sight. The point it follows trails the head a little, rounding off its corners,
    // and the distance eases to what's open, so neither jolts the view.
    const ahead = new THREE.Vector3(Math.sin(viewYaw), 0, Math.cos(viewYaw));
    if (fresh) { follow.copy(at); } else follow.lerp(at, 1 - Math.exp(-dt * FOLLOW));
    let room = NEAREST; while (room < BACK && openAt(g, follow.x - ahead.x * (room + 0.05), follow.z - ahead.z * (room + 0.05))) room += 0.05;
    distance = fresh ? room : distance + (room - distance) * (1 - Math.exp(-dt * (room < distance ? IN : OUT))); fresh = false;
    from.copy(follow).addScaledVector(ahead, -distance).setY(UP); look.copy(follow).addScaledVector(ahead, AHEAD * distance / BACK).setY(0.1);
    wobble.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.12 * shake); shake = Math.max(0, shake - dt * 3);

    apple.visible = !!s.apple;
    if (s.apple) {
      apple.position.set(s.apple[0], reduced ? 0 : 0.03 + Math.sin(s.time * 3) * 0.03, s.apple[1]);
      if (!reduced) apple.rotation.y += dt; beam.material.opacity = reduced ? 0.22 : 0.18 + Math.sin(s.time * 4) * 0.06;
    }
  }

  // The grid's cells for the shader, again only when the furniture's moved.
  function shade(g) {
    if (g.key === gridKey) return; gridKey = g.key;
    const { cols, rows, open } = g, cells = new Uint8Array(cols * rows), u = floor.material.uniforms;
    for (let k = 0; k < cells.length; k++) {
      const i = k % cols, beside = (k >= cols && open[k - cols]) || open[k + cols] || (i && open[k - 1]) || (i < cols - 1 && open[k + 1]);
      cells[k] = open[k] ? 255 : beside ? 128 : 0;
    }
    u.cells.value?.dispose();
    u.cells.value = Object.assign(new THREE.DataTexture(cells, cols, rows, THREE.RedFormat), { unpackAlignment: 1, needsUpdate: true });
    u.origin.value.set(g.left, g.back); u.size.value.set(cols, rows);
    floor.scale.set(cols * CELL, 1, rows * CELL); floor.position.set(g.left + cols * CELL / 2, 0.02, g.back + rows * CELL / 2);
  }

  // Presses. Swipe: a finger that goes SWIPE px sideways (more than up or down) turns that way at once, before it's lifted, once
  // a finger. Tap: a finger turns to its side of the screen as it lands. A click turns as it's pressed. Before it's off, or after
  // a crash, any press sets it going.
  const SWIPE = 12, downs = new Map(); // css px; pointer → where it went down, null once it's swiped
  const half = x => { const r = canvas.getBoundingClientRect(); return x < r.left + r.width / 2 ? -1 : 1; };
  const playing = () => active && s?.mode === 'play';
  canvas.addEventListener('pointerdown', event => {
    if (!active || !s || event.pointerType === 'mouse' && event.button !== 0) return;
    if (s.mode !== 'play') press();
    else if (event.pointerType === 'mouse' || touchMode === 'tap') turn(s, half(event.clientX));
    else downs.set(event.pointerId, { x: event.clientX, y: event.clientY });
  });
  canvas.addEventListener('pointermove', event => {
    const down = downs.get(event.pointerId), dx = down && event.clientX - down.x;
    if (!down || !playing() || Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(event.clientY - down.y)) return;
    downs.set(event.pointerId, null); turn(s, Math.sign(dx));
  });
  const lift = event => { downs.delete(event.pointerId); };
  canvas.addEventListener('pointerup', lift); canvas.addEventListener('pointercancel', lift);
  return snake;
}
