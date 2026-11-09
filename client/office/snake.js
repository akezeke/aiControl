// Snake on the office floor. Click the snake plant in the back corner (or E on it) and the view drops in behind a snake curled
// at its pot. ← → (A D) turn it left or right of where it's heading, as does pressing the left or right half of the screen;
// ↑, W or Space sets it off, and again after a crash. Esc, ✕, ↓ or S steps back and pauses it.
// It runs on path.js's walk grid, STEP cells (0.5 m) at a time: furniture, walls and its own body end the run. The tiles it
// can be on are drawn on the floor while it plays, and the ones it would crash into beside them in red. One apple at a
// time, somewhere it can get to a few metres off, under a beam of light to find it by; each makes it longer and a bit quicker.
// The best is kept per browser. With reduced motion the apple and its beam hold still and nothing pops or shakes; the game still moves.
// The rules (newSnake to step) are pure, so they run under node --test; the 3D follows them.
import * as THREE from 'three';
import { piece, canvasTexture } from './furniture.js';
import { toonMaterial, instancedOutline } from './toon.js';
import { CELL, index, nearestOpen } from './path.js';

export const STEP = 2, SPAN = STEP * CELL; // walk-grid cells a step, and metres
// Headings, clockwise seen from above (x right, z towards the front): a right turn is +1.
export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const LENGTH = 3, RATE = 4, FAST = 9, QUICKER = 0.25; // segments to start; steps a second to start, at most, and more per apple
const NEAR = 6, FAR = 16, AGAIN = 0.5; // an apple's this many steps' walk off when it can be; seconds after a crash before going again

const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const key = ([x, z]) => `${x},${z}`;
const openAt = (grid, x, z) => grid.open[index(grid, { x, z })] === 1;
// One step from `at` along `d` crosses only open cells.
const clear = (grid, [x, z], [dx, dz]) => { for (let s = 1; s <= STEP; s++) if (!openAt(grid, x + dx * s * CELL, z + dz * s * CELL)) return false; return true; };

// Every spot the head could get to from `from`, with how many steps away, by a walk round the lattice. ponytail: the body
// doesn't block it, so an apple can land behind the snake's own coils; fine until the snake fills whole aisles.
export function reach(grid, from) {
  const seen = new Map([[key(from), [...from, 0]]]), queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const at = queue[q], steps = seen.get(key(at))[2];
    for (const d of DIRS) {
      const next = [at[0] + d[0] * SPAN, at[1] + d[1] * SPAN];
      if (!seen.has(key(next)) && clear(grid, at, d)) { seen.set(key(next), [...next, steps + 1]); queue.push(next); }
    }
  }
  return [...seen.values()];
}
// Somewhere off the snake it can reach, NEAR to FAR steps away if anywhere is; null if nowhere is.
export function placeApple(s, grid, rand = Math.random) {
  const spots = reach(grid, s.body[0]).filter(([x, z]) => !s.body.some(b => same(b, [x, z])));
  const near = spots.filter(([, , steps]) => steps >= NEAR && steps <= FAR), pool = near.length ? near : spots;
  return pool.length ? pool[Math.floor(rand() * pool.length)].slice(0, 2) : null;
}

// A snake at the open cell nearest `at`, all of it there until it moves off, facing the longest way clear.
export function newSnake(grid, at, best = 0, rand = Math.random) {
  const start = nearestOpen(grid, at); if (!start) return null;
  const head = [start.x, start.z], run = d => { let n = 0; for (let p = head; clear(grid, p, d); n++) p = [p[0] + d[0] * SPAN, p[1] + d[1] * SPAN]; return n; };
  const dir = DIRS.reduce((b, d, i) => run(d) > run(DIRS[b]) ? i : b, 0), body = Array.from({ length: LENGTH }, () => [...head]);
  const s = { body, prev: body, dir, turns: [], mode: 'ready', eaten: 0, best, record: false, rate: RATE, acc: 0, time: 0, overAt: 0, apple: null };
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
// One step: 'step', 'eat' or 'crash'.
export function step(s, grid, rand = Math.random) {
  if (s.turns.length) s.dir = (s.dir + s.turns.shift() + 4) % 4;
  const d = DIRS[s.dir], next = [s.body[0][0] + d[0] * SPAN, s.body[0][1] + d[1] * SPAN];
  const eats = !!s.apple && same(next, s.apple), body = eats ? s.body : s.body.slice(0, -1); // the tail moves off, unless it grows
  if (!clear(grid, s.body[0], d) || body.some(b => same(b, next))) { s.mode = 'over'; s.overAt = s.time; s.prev = s.body; s.acc = 0; s.turns = []; s.record = s.eaten > s.best; s.best = Math.max(s.best, s.eaten); return 'crash'; }
  s.prev = s.body; s.body = [next, ...body];
  if (!eats) return 'step';
  s.eaten++; s.rate = Math.min(FAST, RATE + s.eaten * QUICKER); s.apple = placeApple(s, grid, rand);
  return 'eat';
}
// `dt` seconds on: what happened, a step at a time. An apple something's been put down on goes somewhere else.
export function tick(s, grid, dt, rand = Math.random) {
  const happened = []; s.time += dt;
  if (s.apple && !openAt(grid, ...s.apple)) s.apple = placeApple(s, grid, rand);
  if (s.mode !== 'play') return happened;
  s.acc += dt * s.rate;
  while (s.mode === 'play' && s.acc >= 1) { s.acc--; happened.push(step(s, grid, rand)); } // a crash stops it where it is
  return happened;
}

// The 3D. Behind and above the head, looking on ahead of it; how fast the view and the head swing round to a new heading.
const BACK = 1.7, NEAREST = 0.4, UP = 1.15, AHEAD = 2.2, FOV = 70, VIEW_TURN = 5, HEAD_TURN = 18;
const R = 0.13, BALLS = 3, MAX = 1800, BEST = 'ai-control-snake-best'; // body radius (m); balls a segment, and drawn at most (600 segments)
const GREEN = '#5cae4f', YELLOW = '#f2c14e', INK = '#1b1a1f';
const ball = (r, x, y, z, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, 14, 10).scale(sx, sy, sz).translate(x, y, z);
const spin = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

// `grid()`: the walk grid (null before there's an office); `home()`: where the snake plant stands; `score(goal, verdict)`:
// the score bar (null clears it).
export function createSnake({ canvas, grid, home, score }) {
  let best = 0; try { best = Number(localStorage.getItem(BEST)) || 0; } catch { /* no storage here */ }
  let s = null, active = false, linger = 0, shake = 0, gulp = 0, headYaw = 0, viewYaw = 0, shown = '';
  const held = new Set(), from = new THREE.Vector3(), look = new THREE.Vector3(), wobble = new THREE.Vector3(), at = new THREE.Vector3();
  const root = new THREE.Group(); root.visible = false;

  // The body: BALLS balls from each segment to the next, in bands, thinning to the tail.
  const body = new THREE.InstancedMesh(new THREE.SphereGeometry(R, 14, 10), toonMaterial('#ffffff'), MAX);
  for (let k = 0; k < MAX; k++) body.setColorAt(k, new THREE.Color(Math.floor(k / BALLS) % 3 === 2 ? YELLOW : GREEN));
  const hull = instancedOutline(body, 0.008); body.count = hull.count = 0; body.frustumCulled = hull.frustumCulled = false; body.raycast = () => {};
  root.add(body);
  // The head, facing +z: eyes and a forked tongue that flicks.
  const head = new THREE.Group(); root.add(head);
  head.add(piece('snake-head', () => [[ball(0.16, 0, 0.13, 0.04, 1, 0.7, 1.35), GREEN], ...[1, -1].flatMap(side => [[ball(0.05, side * 0.08, 0.2, 0.1), '#ffffff'], [ball(0.026, side * 0.09, 0.21, 0.145), INK]])]));
  const tongue = piece('snake-tongue', () => [[new THREE.BoxGeometry(0.014, 0.006, 0.1).translate(0, 0, 0.05), '#e63946'], ...[1, -1].map(side => [new THREE.BoxGeometry(0.01, 0.006, 0.05).translate(0, 0, 0.025).rotateY(side * 0.5).translate(0, 0, 0.1), '#e63946'])], 0);
  tongue.position.set(0, 0.1, 0.24); head.add(tongue);
  // The apple, and a beam over it to find it by from across the office.
  const apple = new THREE.Group(); root.add(apple);
  apple.add(piece('snake-apple', () => [[ball(0.11, 0, 0.12, 0, 1, 0.9, 1), '#e63946'], [new THREE.CylinderGeometry(0.008, 0.01, 0.07, 6).translate(0, 0.25, 0), '#6b4423'], [ball(0.04, 0.035, 0.25, 0, 1, 0.25, 0.55), '#4f9a4a']]));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 3, 16, 1, true).translate(0, 1.5, 0), new THREE.MeshBasicMaterial({ color: '#ffe14d', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.raycast = () => {}; apple.add(beam);
  // The tiles, across the whole grid; drawn again only when the furniture moves (or a new snake's on the other squares).
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
  floor.raycast = () => {}; root.add(floor);
  let floorKey = '';

  const restart = () => { const g = grid(), spot = home(); s = g && spot ? newSnake(g, spot, best) : null; if (s) headYaw = viewYaw = Math.atan2(...DIRS[s.dir]); };
  const press = () => { if (!s) return; if (settled(s)) restart(); else go(s); };
  const showScore = () => {
    const over = s?.mode === 'over', line = s ? [s.eaten, best, s.mode].join() : '';
    if (line === shown) return; shown = line;
    if (!s) { score(null); return; }
    const hint = s.mode === 'ready' ? '↑ go · ← → turn' : over ? '↑ again' : null;
    score([{ text: `🍎 ${s.eaten}` }, { text: `Best ${best}` }, ...hint ? [{ text: hint }] : []], over ? (s.record ? 'New best!' : 'Crash!') : null);
  };
  const KEYS = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1, ArrowUp: 0, KeyW: 0, Space: 0 };

  const snake = {
    root,
    enter() { active = true; if (!s || s.mode === 'over') restart(); else s.mode = 'ready'; shown = ''; showScore(); },
    leave() { active = false; held.clear(); linger = 0.6; score(null); shown = ''; }, // drawn on while the view comes back
    blur() { held.clear(); },
    // In front of the plant, facing it.
    stand() { const spot = home(), g = grid(), p = spot && g && nearestOpen(g, spot) || spot || new THREE.Vector3(); return { x: p.x, z: p.z, yaw: spot ? Math.atan2(spot.x - p.x, spot.z - p.z) : 0 }; },
    pose() { return { from: from.clone().add(wobble), look: look.clone().add(wobble), fov: FOV, hands: false }; },
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
      if (active) for (const happened of tick(s, g, dt)) {
        if (happened === 'eat' && !reduced) gulp = 1;
        if (happened === 'crash') { if (!reduced) shake = 1; if (s.best > best) { best = s.best; try { localStorage.setItem(BEST, String(best)); } catch { /* no storage here */ } } }
      }
      draw(dt, reduced, g); if (active) showScore();
    },
  };

  const p = new THREE.Vector3(), q = new THREE.Vector3(), m = new THREE.Matrix4();
  // Where segment i is drawn: on its way from where it was to where it is.
  const segment = (i, out) => { const b = s.body[i], a = s.prev[i] || b; return out.set(a[0] + (b[0] - a[0]) * s.acc, 0, a[1] + (b[1] - a[1]) * s.acc); };
  function draw(dt, reduced, g) {
    tile(g);
    const count = Math.min(MAX, BALLS * (s.body.length - 1));
    for (let k = 0; k < count; k++) {
      const i = Math.floor(k / BALLS) + 1; segment(i - 1, p).lerp(segment(i, q), (k % BALLS + 1) / BALLS);
      const thin = Math.min(1, 0.35 + (count - k) / BALLS * 0.2);
      body.setMatrixAt(k, m.makeScale(thin, thin * 0.85, thin).setPosition(p.x, R * 0.85 * thin, p.z));
    }
    body.count = hull.count = count; body.instanceMatrix.needsUpdate = true;

    // The head turns to where it's going (the heading's set as each step starts); the view swings round after it, slower.
    segment(0, at); const yaw = Math.atan2(...DIRS[s.dir]);
    headYaw += spin(headYaw, yaw) * (1 - Math.exp(-dt * HEAD_TURN)); viewYaw += spin(viewYaw, headYaw) * (1 - Math.exp(-dt * VIEW_TURN));
    head.position.copy(at); head.rotation.y = headYaw; head.scale.setScalar(1 + 0.3 * gulp); gulp = Math.max(0, gulp - dt * 4);
    tongue.visible = !reduced && s.mode !== 'over' && s.time % 1.6 < 0.3; tongue.scale.z = Math.sin((s.time % 1.6) / 0.3 * Math.PI);

    // Back as far as BACK over open floor (a wall or the printer behind it would be in the way of the view), looking nearer
    // when it's closer in so the head stays in sight.
    const ahead = new THREE.Vector3(Math.sin(viewYaw), 0, Math.cos(viewYaw));
    let back = NEAREST; while (back < BACK && openAt(g, at.x - ahead.x * (back + 0.1), at.z - ahead.z * (back + 0.1))) back += 0.1;
    from.copy(at).addScaledVector(ahead, -back).setY(UP); look.copy(at).addScaledVector(ahead, AHEAD * back / BACK).setY(0.25);
    wobble.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.12 * shake); shake = Math.max(0, shake - dt * 3);

    apple.visible = !!s.apple;
    if (s.apple) {
      apple.position.set(s.apple[0], reduced ? 0 : 0.03 + Math.sin(s.time * 3) * 0.03, s.apple[1]);
      if (!reduced) apple.rotation.y += dt; beam.material.opacity = reduced ? 0.22 : 0.18 + Math.sin(s.time * 4) * 0.06;
    }
  }

  // A tile on each spot of the snake's lattice that's open (outlined), and on each shut one beside them (red), PX px a cell.
  function tile(g) {
    const PX = 8, size = STEP * PX, on = (v, from) => ((Math.round((v - from) / CELL - 0.5) % STEP) + STEP) % STEP;
    const pi = on(s.body[0][0], g.left), pj = on(s.body[0][1], g.back), next = `${g.key}|${pi},${pj}`;
    if (next === floorKey) return; floorKey = next;
    const open = (i, j) => i >= 0 && j >= 0 && i < g.cols && j < g.rows && g.open[j * g.cols + i] === 1;
    floor.material.map?.dispose();
    floor.material.map = canvasTexture(g.cols * PX, g.rows * PX, c => {
      c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,0.55)'; c.fillStyle = 'rgba(230,57,70,0.4)';
      for (let j = pj; j < g.rows; j += STEP) for (let i = pi; i < g.cols; i += STEP) {
        const x = (i + 0.5) * PX - size / 2, y = (j + 0.5) * PX - size / 2;
        if (open(i, j)) c.strokeRect(x + 2, y + 2, size - 4, size - 4);
        else if (open(i - STEP, j) || open(i + STEP, j) || open(i, j - STEP) || open(i, j + STEP)) c.fillRect(x + 1, y + 1, size - 2, size - 2);
      }
    });
    floor.material.needsUpdate = true;
    floor.scale.set(g.cols * CELL, 1, g.rows * CELL); floor.position.set(g.left + g.cols * CELL / 2, 0.02, g.back + g.rows * CELL / 2);
  }

  // Presses: the left or right half of the screen turns that way; before it's off, or after a crash, a press sets it going.
  canvas.addEventListener('pointerdown', event => {
    if (!active || !s || event.pointerType === 'mouse' && event.button !== 0) return;
    if (s.mode !== 'play') { press(); return; }
    const r = canvas.getBoundingClientRect(); turn(s, event.clientX < r.left + r.width / 2 ? -1 : 1);
  });
  return snake;
}
