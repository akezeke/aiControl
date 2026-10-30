// The putting green in the secret room. Every hole comes from its number, so hole 7 is the same for everyone (as in
// Desert Golfing): humps and hollows from the start, a tilt from hole 3, then office things to play round (books, a mug, the
// duck, a stapler, planks off the rails), more of them further on. A hole is only used if it's makeable: some putt from the
// tee sinks (par 2), or leaves a putt that does (par 3); one that isn't is passed over for the next seed.
// Click the green or the ball (or E on it) to play: the view moves behind the ball, looking down the line to the cup, and
// follows it as it rolls. Click (tap, or E) where on the green it should stop: on the flat it stops right there, but slopes
// bend it and the rails and whatever's in the way turn it. Esc, ✕ or a walking key steps back (office.js runs that). Sink it and the next hole comes up out of the floor; after eight
// strokes you pick up. Which hole you're on and how far over par, per browser. With reduced motion a putt finishes at once.
import * as THREE from 'three';
import { mesh, once, canvasTexture, paint, painted } from './furniture.js';
import { toonMaterial } from './toon.js';
import { drawCall, CHALK } from './darts.js';
import { SECRET } from './secret.js';

// In the secret room's frame: the green's playing area, the ball's and the cup's radii (metres).
export const GREEN = { x0: 0.45, x1: 4.85, z0: 0.95, z1: 2.95 }, BALL = 0.022, CUP = 0.054;
// Rolling: friction (m/s²), how hard a slope pulls (per unit of slope), the fastest a ball drops in (m/s), the time step (s),
// the hardest putt (m/s), how much of its speed a ball keeps off a rail, and how long a putt may roll (s).
const DECEL = 0.6, PULL = 7, CAPTURE = 1.25, DT = 1 / 120, MAX = 3.8, BOUNCE = 0.65, LIMIT = 12;
const BASE = 0.12, STROKES = 8, SAVE = 'ai-control-golf';
const SIZES = { books: { w: 0.22, d: 0.16 }, mug: { r: 0.05 }, duck: { r: 0.06 }, stapler: { w: 0.19, d: 0.05 }, plank: { d: 0.05 } };

// mulberry32: a small seeded generator, the same numbers everywhere.
const rng = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// A spot kept `inset` metres inside the secret room's walls.
const within = (x, z, inset) => [clamp(x, inset, SECRET.w - inset), clamp(z, -SECRET.back + inset, SECRET.front - inset)];

// The green's height at (x, z) above its base: flat by the rails, at the tee and round the cup.
export function height(c, x, z) {
  let h = c.tilt.x * (x - c.mid.x) + c.tilt.z * (z - c.mid.z);
  for (const b of c.bumps) h += b.a * Math.exp(-((x - b.x) ** 2 + (z - b.z) ** 2) / (b.r * b.r));
  const edge = Math.min(x - GREEN.x0, GREEN.x1 - x, z - GREEN.z0, GREEN.z1 - z);
  return clamp(h, -0.1, 0.1) * smooth(0, 0.25, edge) * smooth(0.1, 0.35, Math.hypot(x - c.cup.x, z - c.cup.z)) * smooth(0.05, 0.3, Math.hypot(x - c.tee.x, z - c.tee.z));
}

// Hole `n`: tee, cup, humps, tilt and things in the way, from a seed; `plain` is flat and clear, the fallback.
function make(n, seed, plain = false) {
  const r = rng(seed), between = (a, b) => a + (b - a) * r(), { x0, x1, z0, z1 } = GREEN;
  const tee = { x: x0 + 0.35, z: between(z0 + 0.35, z1 - 0.35) }, cup = { x: x1 - between(0.3, 0.9), z: between(z0 + 0.3, z1 - 0.3) };
  if (n >= 5 && r() < 0.5) [tee.x, cup.x] = [x0 + x1 - tee.x, x0 + x1 - cup.x];
  const bumps = plain ? [] : Array.from({ length: 1 + Math.min(3, Math.floor(n / 3)) }, () => ({ x: between(x0, x1), z: between(z0, z1), r: between(0.35, 0.8), a: (r() < 0.5 ? -1 : 1) * (0.025 + 0.008 * Math.min(n, 10)) }));
  const lean = plain || n < 3 ? 0 : 0.015 * Math.min(1, (n - 2) / 5), dir = r() * Math.PI * 2;
  const kinds = n >= 6 ? Object.keys(SIZES) : n >= 4 ? ['books', 'mug', 'duck', 'stapler'] : ['books', 'mug'], things = [];
  for (let tries = 0; !plain && things.length < Math.min(5, Math.floor(n / 2)) && tries < 40; tries++) {
    const kind = kinds[Math.floor(r() * kinds.length)], o = { kind, ...SIZES[kind], x: between(x0 + 0.3, x1 - 0.3), z: between(z0 + 0.25, z1 - 0.25), turn: r() * Math.PI };
    if (kind === 'plank') { o.w = between(0.5, 0.9); o.turn = Math.PI / 2; o.z = r() < 0.5 ? z0 + o.w / 2 : z1 - o.w / 2; }
    const reach = (o.r || Math.max(o.w, o.d) / 2) + 0.3;
    if ([tee, cup, ...things].some(p => Math.hypot(p.x - o.x, p.z - o.z) < reach + (p.kind ? 0.1 : 0))) continue;
    things.push(o);
  }
  return { n, tee, cup, bumps, things, mid: { x: (x0 + x1) / 2, z: (z0 + z1) / 2 }, tilt: { x: Math.cos(dir) * lean, z: Math.sin(dir) * lean } };
}

// The slope's pull at every RES metres across the green (bilinear between), worked out once a hole rather than every step.
const RES = 0.02;
function pulls(c) {
  const cols = Math.round((GREEN.x1 - GREEN.x0) / RES) + 1, rows = Math.round((GREEN.z1 - GREEN.z0) / RES) + 1, x = new Float32Array(cols * rows), z = new Float32Array(cols * rows), e = 0.005;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const px = GREEN.x0 + i * RES, pz = GREEN.z0 + j * RES;
    x[j * cols + i] = -PULL * (height(c, px + e, pz) - height(c, px - e, pz)) / (2 * e); z[j * cols + i] = -PULL * (height(c, px, pz + e) - height(c, px, pz - e)) / (2 * e);
  }
  return { cols, rows, x, z };
}
const pull = (p, px, pz, out) => {
  const u = clamp((px - GREEN.x0) / RES, 0, p.cols - 1.001), v = clamp((pz - GREEN.z0) / RES, 0, p.rows - 1.001), i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, k = j * p.cols + i;
  for (const [axis, grid] of [[0, p.x], [1, p.z]]) out[axis] = (grid[k] * (1 - a) + grid[k + 1] * a) * (1 - b) + (grid[k + p.cols] * (1 - a) + grid[k + p.cols + 1] * a) * b;
  return out;
};
const force = [0, 0];

// A ball touching something: pushed out along (nx, nz) and bounced; the push is remembered, so next step a slope can't
// press it on into what it rests against.
const hit = (b, nx, nz, depth) => {
  b.x += nx * depth; b.z += nz * depth;
  const vn = b.vx * nx + b.vz * nz; if (vn < 0) { b.vx -= (1 + BOUNCE) * vn * nx; b.vz -= (1 + BOUNCE) * vn * nz; }
  b.touch.push([nx, nz]);
};
function collide(o, b) {
  if (o.r) { const dx = b.x - o.x, dz = b.z - o.z, d = Math.hypot(dx, dz); if (d < o.r + BALL && d > 1e-6) hit(b, dx / d, dz / d, o.r + BALL - d); return; }
  const cos = Math.cos(o.turn), sin = Math.sin(o.turn), lx = (b.x - o.x) * cos + (b.z - o.z) * sin, lz = -(b.x - o.x) * sin + (b.z - o.z) * cos;
  let nx = lx - clamp(lx, -o.w / 2, o.w / 2), nz = lz - clamp(lz, -o.d / 2, o.d / 2), depth;
  const d = Math.hypot(nx, nz);
  if (d > 1e-6) { if (d >= BALL) return; nx /= d; nz /= d; depth = BALL - d; }
  else { const px = o.w / 2 - Math.abs(lx), pz = o.d / 2 - Math.abs(lz); [nx, nz, depth] = px < pz ? [Math.sign(lx) || 1, 0, px + BALL] : [0, Math.sign(lz) || 1, pz + BALL]; } // inside: out the nearest side
  hit(b, nx * cos - nz * sin, nx * sin + nz * cos, depth);
}
// One step of a rolling ball { x, z, vx, vz, touch }: slope, friction, rails, things, the cup. Sets b.sunk or b.rest.
export function step(c, b) {
  c.pulls ??= pulls(c);
  let [fx, fz] = pull(c.pulls, b.x, b.z, force);
  for (const [nx, nz] of b.touch) { const into = fx * nx + fz * nz; if (into < 0) { fx -= into * nx; fz -= into * nz; } }
  b.touch = [];
  b.vx += fx * DT; b.vz += fz * DT;
  const s = Math.hypot(b.vx, b.vz), drop = DECEL * DT;
  if (s <= drop) { b.vx = b.vz = 0; if (Math.hypot(fx, fz) <= DECEL) { b.rest = true; return b; } }
  else { b.vx -= b.vx / s * drop; b.vz -= b.vz / s * drop; }
  b.x += b.vx * DT; b.z += b.vz * DT;
  const { x0, x1, z0, z1 } = GREEN;
  if (b.x < x0 + BALL) hit(b, 1, 0, x0 + BALL - b.x); if (b.x > x1 - BALL) hit(b, -1, 0, b.x - x1 + BALL);
  if (b.z < z0 + BALL) hit(b, 0, 1, z0 + BALL - b.z); if (b.z > z1 - BALL) hit(b, 0, -1, b.z - z1 + BALL);
  for (const o of c.things) collide(o, b);
  if (Math.hypot(b.x - c.cup.x, b.z - c.cup.z) < CUP && Math.hypot(b.vx, b.vz) < CAPTURE) b.sunk = true;
  return b;
}
// The speed that stops a ball `d` metres away on the flat.
export const speedFor = d => Math.min(MAX, Math.sqrt(2 * DECEL * d));
// Where a putt from `from` at (vx, vz) ends up.
export function roll(c, from, vx, vz) {
  const b = { x: from.x, z: from.z, vx, vz, touch: [] };
  for (let t = 0; t < LIMIT && !b.sunk && !b.rest; t += DT) step(c, b);
  return b;
}
// Par for a hole: 2 if some putt from the tee sinks, 3 if one leaves a putt that does, 0 if neither (not makeable). Putts are
// tried from straight at the cup outward, as hard as it is far first, and the search stops at the first that drops.
function par(c) {
  const left = b => Math.hypot(b.x - c.cup.x, b.z - c.cup.z);
  const putts = (from, spread, every) => {
    const out = [], toward = Math.atan2(c.cup.z - from.z, c.cup.x - from.x), far = left(from);
    const lengths = Array.from({ length: 18 }, (_, i) => 0.3 + i * 0.3).sort((a, b) => Math.abs(a - far) - Math.abs(b - far));
    for (let k = 0; k * every <= spread + 1e-9; k++) for (const a of k ? [k * every, -k * every] : [0]) for (const d of lengths) {
      const s = speedFor(d), b = roll(c, from, Math.cos(toward + a) * s, Math.sin(toward + a) * s);
      if (b.sunk) return null; out.push(b);
    }
    return out;
  };
  const first = putts(c.tee, 1.3, 0.052);
  if (!first) return 2;
  return first.sort((a, b) => left(a) - left(b)).slice(0, 3).some(b => !putts(b, 0.8, 0.07)) ? 3 : 0;
}
// Hole `n`, makeable, with its par.
export function course(n) {
  for (let k = 0; k < 6; k++) { const c = make(n, n * 7919 + k * 104729), p = par(c); if (p) return { ...c, par: p }; }
  return { ...make(n, n, true), par: 2 };
}

// Its look: what each thing in the way is made of, in its own frame, standing on y = 0.
const thingParts = {
  books: () => { let top = 0; return [['#d1495b', 0.05, 0.22, 0.16, 0], ['#2e86ab', 0.045, 0.2, 0.15, 0.2], ['#edae49', 0.04, 0.18, 0.14, -0.15]].map(([color, h, w, d, turn]) => { const g = new THREE.BoxGeometry(w, h, d).rotateY(turn).translate(0, top + h / 2, 0); top += h; return [g, color]; }); },
  mug: () => [[new THREE.CylinderGeometry(0.05, 0.045, 0.11, 18).translate(0, 0.055, 0), '#f4efe6'], [new THREE.TorusGeometry(0.03, 0.009, 8, 14).translate(0.055, 0.06, 0), '#f4efe6'], [new THREE.CylinderGeometry(0.044, 0.044, 0.01, 18).translate(0, 0.1, 0), '#5b3a24']],
  duck: () => [[new THREE.SphereGeometry(0.06, 14, 10).scale(1.15, 0.85, 1).translate(0, 0.05, 0), '#ffd23f'], [new THREE.SphereGeometry(0.035, 12, 8).translate(0.04, 0.115, 0), '#ffd23f'], [new THREE.ConeGeometry(0.014, 0.03, 8).rotateZ(-Math.PI / 2).translate(0.085, 0.11, 0), '#ff8a3d']],
  stapler: () => [[new THREE.BoxGeometry(0.19, 0.02, 0.05).translate(0, 0.01, 0), '#2f3542'], [new THREE.BoxGeometry(0.18, 0.03, 0.04).translate(0.005, 0.04, 0), '#d63a3a'], [new THREE.BoxGeometry(0.03, 0.03, 0.035).translate(-0.08, 0.025, 0), '#8a8f99']],
};
function thing(o) {
  if (o.kind === 'plank') return mesh(new THREE.BoxGeometry(o.w, 0.06, o.d).translate(0, 0.03, 0), toonMaterial('#b07a4a'), 0.004);
  return mesh(once(`golf-${o.kind}`, () => paint(thingParts[o.kind]())), painted(), 0.004);
}
// The chalkboard over the green.
function drawCard(g, w, h, s) {
  g.fillStyle = '#24302b'; g.fillRect(0, 0, w, h); g.fillStyle = '#f2f2ea'; g.textBaseline = 'alphabetic';
  g.font = `bold 64px ${CHALK}`; g.textAlign = 'left'; g.fillText(`Hole ${s.n}`, 28, 78);
  g.textAlign = 'right'; g.font = `bold 44px ${CHALK}`; g.fillText(`Par ${s.par}`, w - 28, 74);
  g.textAlign = 'left'; g.fillText(`Strokes ${s.strokes}`, 28, 150);
  g.textAlign = 'right'; g.fillText(s.total ? `${s.total > 0 ? '+' : ''}${s.total}` : 'Even', w - 28, 150);
  if (s.hint) { g.textAlign = 'center'; g.fillStyle = '#b8c2bb'; g.font = `bold 34px ${CHALK}`; g.fillText(s.hint, w / 2, 212); }
}
const verdict = (strokes, par) => strokes === 1 ? 'Hole in one!' : ['Albatross!', 'Eagle!', 'Birdie!', 'Par', 'Bogey', 'Double bogey'][strokes - par + 3] ?? `+${strokes - par}`;

// `camera`; `aim()`: where you're pointing, as a direction; `onPlay(golf)`: the green was clicked.
export function createGolf({ camera, aim, onPlay }) {
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(SAVE) || '{}'); } catch {}
  let n = saved.hole || 1, total = saved.total || 0, c = course(n), strokes = 0, room = null, time = 0, still = false, active = false;
  let ball = { x: c.tee.x, z: c.tee.z, vx: 0, vz: 0, touch: [], rest: true }, rolling = false, sunkAt = -1, morph = 1, from = null, acc = 0;
  let surface, things = [], cup, flag, flagTexture, ballMesh, line, target, card, call, tee, course3d;
  // The view while playing, easing after the ball: from behind it along `heading` (toward the cup when it last stopped).
  const view = { from: new THREE.Vector3(), look: new THREE.Vector3(), heading: new THREE.Vector2(1, 0), set: false };
  const local = new THREE.Vector3(), cols = 89, rows = 41;
  const hint = () => !strokes && (n === 1 || !active) ? (active ? 'Click where it should stop' : 'Click the green to play') : '';
  const redraw = () => card.redraw({ n, par: c.par, strokes, total, hint: hint() });
  const save = () => { try { localStorage.setItem(SAVE, JSON.stringify({ hole: n, total })); } catch {} };
  // Where the camera's ray along `direction` meets the green, in the room's frame; null if it doesn't.
  const spot = direction => {
    if (!room || direction.y > -0.02) return null;
    const o = room.worldToLocal(local.copy(camera.position)), p = { x: 0, z: 0 };
    let y = BASE;
    for (let i = 0; i < 3; i++) { const t = (y - o.y) / direction.y; p.x = o.x + direction.x * t; p.z = o.z + direction.z * t; y = BASE + height(c, p.x, p.z); }
    return p.x > GREEN.x0 + BALL && p.x < GREEN.x1 - BALL && p.z > GREEN.z0 + BALL && p.z < GREEN.z1 - BALL ? p : null;
  };
  // The green's surface heights for the hole on now, blending in from the last (morph 0 → 1).
  const shape = () => {
    const pos = surface.geometry.attributes.position, e = morph * morph * (3 - 2 * morph);
    for (let i = 0; i < pos.count; i++) { const h = height(c, pos.getX(i) + c.mid.x, pos.getZ(i) + c.mid.z); pos.setY(i, from ? from[i] + (h - from[i]) * e : h); }
    pos.needsUpdate = true; surface.geometry.computeVertexNormals();
  };
  // Sets out hole `c`: its things rise out of the floor as the green settles into its new shape.
  const lay = () => {
    for (const m of things) { m.removeFromParent(); if (m.userData.own) m.geometry.dispose(); } // a plank's is its own
    things = c.things.map(o => { const m = thing(o); m.position.set(o.x, BASE + height(c, o.x, o.z) - 0.3, o.z); m.rotation.y = -o.turn; m.userData = { y: BASE + height(c, o.x, o.z), own: o.kind === 'plank' }; course3d.add(m); return m; });
    cup.position.set(c.cup.x, BASE + 0.002, c.cup.z); flag.position.set(c.cup.x, BASE, c.cup.z); tee.position.set(c.tee.x, BASE + 0.002, c.tee.z);
    flagTexture.redraw(n); redraw(); aimAtCup();
  };
  const next = () => {
    from = Array.from({ length: cols * rows }, (_, i) => surface.geometry.attributes.position.getY(i));
    n++; save(); c = course(n); strokes = 0; morph = still ? 1 : 0; sunkAt = -1;
    ball = { x: c.tee.x, z: c.tee.z, vx: 0, vz: 0, touch: [], rest: true }; ballMesh.visible = true;
    lay(); shape();
  };
  const aimAtCup = () => { const d = view.heading.set(c.cup.x - ball.x, c.cup.z - ball.z); if (d.lengthSq() > 1e-6) d.normalize(); };
  const golf = {
    // Ready to putt: playing, nothing rolling, the hole settled.
    get ready() { return active && !rolling && sunkAt < 0 && morph >= 1; },
    enter() { active = true; view.set = false; aimAtCup(); redraw(); },
    leave() { active = false; redraw(); },
    // Where you stand when you step back (on the floor, in world space, facing the cup), and the view while playing.
    stand() { const [x, z] = within(ball.x - view.heading.x * 0.9, ball.z - view.heading.y * 0.9, 0.4), p = room.localToWorld(new THREE.Vector3(x, 0, z)); return { x: p.x, z: p.z, yaw: Math.atan2(view.heading.x, view.heading.y) }; },
    pose() { return { from: room.localToWorld(view.from.clone()), look: room.localToWorld(view.look.clone()), fov: 60, hands: false }; },
    click(direction) { return golf.putt(direction); },
    build(group) {
      room = group;
      // The whole course: click any of it to play (outlined under the pointer).
      course3d = new THREE.Group(); course3d.userData.toggle = () => onPlay(golf); group.add(course3d); group = course3d;
      const { x0, x1, z0, z1 } = GREEN, w = x1 - x0, d = z1 - z0;
      const stripes = canvasTexture(256, 32, (g, tw, th) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#5fbf4a' : '#54b03f'; g.fillRect(i * tw / 8, 0, tw / 8, th); } });
      stripes.wrapS = THREE.RepeatWrapping; stripes.repeat.set(w / 2, 1);
      surface = new THREE.Mesh(new THREE.PlaneGeometry(w, d, cols - 1, rows - 1).rotateX(-Math.PI / 2), toonMaterial('#ffffff', { map: stripes }));
      surface.position.set(c.mid.x, BASE, c.mid.z); group.add(surface);
      // The platform under it and its rails, wood.
      const wood = toonMaterial('#8a5a34'), base = new THREE.Mesh(new THREE.BoxGeometry(w, BASE - 0.1, d).translate(0, (BASE - 0.1) / 2, 0), toonMaterial('#3b6e33')); base.position.set(c.mid.x, 0, c.mid.z); group.add(base);
      for (const [rw, rd, x, z] of [[w + 0.12, 0.06, c.mid.x, z0 - 0.03], [w + 0.12, 0.06, c.mid.x, z1 + 0.03], [0.06, d, x0 - 0.03, c.mid.z], [0.06, d, x1 + 0.03, c.mid.z]]) {
        const rail = mesh(new THREE.BoxGeometry(rw, BASE + 0.05, rd).translate(0, (BASE + 0.05) / 2, 0), wood, 0.005); rail.position.set(x, 0, z); group.add(rail);
      }
      cup = new THREE.Mesh(new THREE.CircleGeometry(CUP, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#141317' })); group.add(cup);
      tee = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.045, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#f4f2ec' })); group.add(tee);
      flagTexture = canvasTexture(128, 96, (g, tw, th, number) => { g.fillStyle = '#e63946'; g.beginPath(); g.moveTo(0, 0); g.lineTo(tw, th / 2); g.lineTo(0, th); g.fill(); g.fillStyle = '#ffffff'; g.font = `bold 44px ${CHALK}`; g.textBaseline = 'middle'; g.fillText(number ?? '', 10, th / 2 + 2); });
      flag = new THREE.Group(); group.add(flag);
      flag.add(new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.62).translate(0, 0.31, 0), new THREE.MeshBasicMaterial({ color: '#e8e6df' })));
      const pennant = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.15).translate(0.1, 0.53, 0), new THREE.MeshBasicMaterial({ map: flagTexture, transparent: true, side: THREE.DoubleSide })); flag.add(pennant);
      ballMesh = mesh(new THREE.SphereGeometry(BALL, 16, 12), toonMaterial('#ffffff'), 0.003); group.add(ballMesh);
      line = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(24 * 3), 3)), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.05, gapSize: 0.035 }));
      line.visible = false; line.raycast = () => {}; room.add(line);
      target = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.042, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff' })); target.visible = false; target.raycast = () => {}; room.add(target);
      card = canvasTexture(512, 240, (g, tw, th, s) => s && drawCard(g, tw, th, s));
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.47), new THREE.MeshBasicMaterial({ map: card })); board.rotation.y = Math.PI; board.position.set(c.mid.x, 1.7, z1 + 0.13); room.add(board);
      const frame = mesh(new THREE.BoxGeometry(1.06, 0.53, 0.03), toonMaterial('#7a4e2d'), 0); frame.position.set(c.mid.x, 1.7, z1 + 0.15); room.add(frame);
      call = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTexture(256, 128, drawCall), transparent: true, depthTest: false })); call.scale.set(0.5, 0.25, 1); call.renderOrder = 3; call.visible = false; room.add(call);
      document.fonts?.load(`bold 44px 'Comic Neue'`).then(() => { flagTexture.redraw(n); redraw(); }).catch(() => {});
      lay(); for (const m of things) m.position.y = m.userData.y; shape();
    },
    // Putts toward where you aim on the green (it stops there on the flat); false if that isn't on the green.
    putt(direction = aim()) {
      if (!golf.ready) return false;
      const p = spot(direction), d = p && Math.hypot(p.x - ball.x, p.z - ball.z); if (!p || d < 0.05) return false;
      const s = speedFor(d); Object.assign(ball, { vx: (p.x - ball.x) / d * s, vz: (p.z - ball.z) / d * s, rest: false, touch: [] });
      rolling = true; strokes++; acc = 0; redraw();
      if (still) { while (!ball.sunk && !ball.rest) step(c, ball); }
      return true;
    },
    update(dt, at, reduced, shown) {
      time += dt; still = reduced;
      if (!room || !shown) return;
      if (morph < 1) {
        morph = Math.min(1, morph + dt / 0.9); shape();
        const e = morph * morph * (3 - 2 * morph); for (const m of things) m.position.y = m.userData.y - 0.3 * (1 - e);
        if (morph === 1) from = null;
      }
      if (rolling) {
        for (acc += dt; acc >= DT && rolling; acc -= DT) { step(c, ball); if (ball.sunk || ball.rest) rolling = false; }
        if (ball.rest) aimAtCup();
        const s = Math.hypot(ball.vx, ball.vz); if (s > 0) ballMesh.rotateOnWorldAxis(new THREE.Vector3(ball.vz / s, 0, -ball.vx / s), s * dt / BALL);
        if (ball.sunk) {
          sunkAt = time; total += strokes - c.par; save();
          call.material.map.redraw(verdict(strokes, c.par), strokes < c.par ? '#ffe14f' : '#f4f2ec'); call.position.set(c.cup.x, BASE + 0.45, c.cup.z); call.userData.at = time; call.visible = true; call.material.opacity = 1;
        } else if (!rolling && strokes >= STROKES) {
          sunkAt = time; total += strokes + 1 - c.par; save();
          call.material.map.redraw('Picked up', '#f4f2ec'); call.position.set(ball.x, BASE + 0.4, ball.z); call.userData.at = time; call.visible = true; call.material.opacity = 1;
        }
      }
      // In the cup: it drops out of sight; a moment later, the next hole.
      const down = sunkAt >= 0 && ball.sunk ? Math.min(1, (time - sunkAt) / 0.2) : 0;
      ballMesh.position.set(ball.sunk ? c.cup.x : ball.x, BASE + height(c, ball.x, ball.z) + BALL - down * 0.06, ball.sunk ? c.cup.z : ball.z);
      if (call.visible) { const age = time - call.userData.at; call.material.opacity = Math.max(0, 1 - age / 1.6); if (age > 1.6) call.visible = false; }
      if (sunkAt >= 0 && time - sunkAt > (still ? 0.6 : 1.8)) next();
      // The view: behind the ball, up a little, looking past it down the line; it eases after the ball. Kept off the walls, it
      // rises by however far it was pulled in, so the ball stays in sight.
      const k = still || !view.set ? 1 : 1 - Math.exp(-dt * 2.5), y = BASE + height(c, ball.x, ball.z);
      const back = [ball.x - view.heading.x * 1.4, ball.z - view.heading.y * 1.4], [cx, cz] = within(...back, 0.3);
      view.from.lerp(local.set(cx, y + 1.25 + Math.hypot(back[0] - cx, back[1] - cz) * 0.7, cz), k);
      view.look.lerp(local.set(ball.x + view.heading.x * 0.9, y, ball.z + view.heading.y * 0.9), k); view.set = true;
      // Where a putt would stop on the flat, and the line to it.
      const aimAt = golf.ready && spot(aim());
      line.visible = target.visible = !!aimAt;
      if (aimAt) {
        const pos = line.geometry.attributes.position;
        for (let i = 0; i < 24; i++) { const t = i / 23, x = ball.x + (aimAt.x - ball.x) * t, z = ball.z + (aimAt.z - ball.z) * t; pos.setXYZ(i, x, BASE + height(c, x, z) + 0.008, z); }
        pos.needsUpdate = true; line.computeLineDistances(); line.geometry.computeBoundingSphere();
        target.position.set(aimAt.x, BASE + height(c, aimAt.x, aimAt.z) + 0.006, aimAt.z);
      }
    },
  };
  return golf;
}
