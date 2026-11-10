// The snake's 3D, for the game and for watching anyone's: a tube bent along the body, the head and its food. `look`
// ({ fruit, colour }) colours it, with darker bands and a paler belly, and makes its food a small one of that fruit; null is
// the classic green snake and its red apple. It draws whatever snake-shaped state it's `set` to, on its own clock. With
// reduced motion the body doesn't sway, the food holds still and the head neither shivers nor flicks its tongue; callers
// skip the gulp.
import * as THREE from 'three';
import { piece } from './furniture.js';
import { toonMaterial, withOutline } from './toon.js';
import { fruitFood } from './fruit.js';
import { DIRS, SPAN } from './snake.js'; // only used inside functions: snake.js imports this module too

// The body: its radius (m); rings along it at most, points round each, rings a segment (4 cm apart); how many segments either
// side of a corner it's rounded off; how long the tail tapers, at most (m). How fast the head swings round to a new heading.
const R = 0.1, RINGS = 1200, AROUND = 12, PER = 6, ROUND = 0.36, TAIL = 1.2, HEAD_TURN = 22;
const INK = '#1b1a1f', CREAM = new THREE.Color('#fff4d6');
const ball = (r, x, y, z, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, 16, 12).scale(sx, sy, sz).translate(x, y, z);
export const spin = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Its skin, the bands across its back and its belly: the classic green, or the look's colour with the bands darker and the
// belly most of the way to cream. Both worked out on the colour as written (sRGB), as the classic's are: on three's linear
// working colour, 0.7 darkens only half as much.
export function snakeColours(look) {
  if (!look) return { skin: '#5cae4f', band: '#3d7d3c', belly: '#f0e2a6' };
  const srgb = THREE.SRGBColorSpace, c = new THREE.Color(look.colour).getRGB({}, srgb), cream = CREAM.getRGB({}, srgb);
  const hex = f => `#${new THREE.Color().setRGB(f('r'), f('g'), f('b'), srgb).getHexString()}`;
  return { skin: look.colour, band: hex(k => c[k] * 0.7), belly: hex(k => c[k] + (cream[k] - c[k]) * 0.7) };
}

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

// `set(s)`: the state to draw, `{ body, prev, acc, dir, mode, rate, stall }`, kept and read on each update. `face()` snaps
// the head to its heading for a new game; `food(at)` puts the food on that cell, or hides it with null. Only the tube and its
// material are its own to dispose: the pieces and the fruit food are shared.
export function createSnakeModel(look) {
  const { skin, band, belly } = snakeColours(look), root = new THREE.Group();
  let s = null, time = 0, swell = 0, bulge = Infinity, headYaw = 0;

  // The body: a tube bent along it every frame (ring 0 at the head), with darker bands across the back and a pale belly.
  // Only its layout's kept from the cylinder; its normals do for the outline's too.
  const tube = new THREE.CylinderGeometry(1, 1, 1, AROUND, RINGS - 1, true), colors = new Float32Array(tube.attributes.position.count * 3), tint = new THREE.Color();
  for (let r = 0; r < RINGS; r++) for (let a = 0; a <= AROUND; a++) {
    const up = Math.cos(a / AROUND * Math.PI * 2);
    tint.set(up < -0.3 ? belly : (r / PER * SPAN) % 0.32 < 0.08 && up > 0 ? band : skin).toArray(colors, (r * (AROUND + 1) + a) * 3);
  }
  tube.setAttribute('color', new THREE.BufferAttribute(colors, 3)); tube.setAttribute('outlineNormal', tube.attributes.normal);
  const material = toonMaterial('#ffffff', { vertexColors: true }), body = withOutline(new THREE.Mesh(tube, material), 0.008);
  body.frustumCulled = body.children[0].frustumCulled = false; body.raycast = () => {}; root.add(body);
  // The head, facing +z, a little wider than the neck: a flat skull over a pale jaw, eyes up top, nostrils, a forked tongue that flicks.
  const head = new THREE.Group(); root.add(head);
  head.add(piece(`snake-head-${skin}`, () => [[ball(0.12, 0, 0.1, 0.035, 1, 0.62, 1.3), skin], [ball(0.105, 0, 0.07, 0.04, 0.95, 0.42, 1.25), belly], [ball(0.05, 0, 0.142, -0.02, 1, 0.3, 1.3), band],
    ...[1, -1].flatMap(side => [[ball(0.04, side * 0.068, 0.14, 0.085), '#ffffff'], [ball(0.022, side * 0.08, 0.15, 0.115), INK], [ball(0.008, side * 0.03, 0.115, 0.188), INK]])]));
  const tongue = piece('snake-tongue', () => [[new THREE.BoxGeometry(0.012, 0.005, 0.09).translate(0, 0, 0.045), '#e63946'], ...[1, -1].map(side => [new THREE.BoxGeometry(0.009, 0.005, 0.045).translate(0, 0, 0.022).rotateY(side * 0.5).translate(0, 0, 0.09), '#e63946'])], 0);
  tongue.position.set(0, 0.07, 0.19); head.add(tongue);
  // Its food: the apple, or a small one of the look's fruit in its colour.
  const meal = new THREE.Group(); meal.visible = false; root.add(meal);
  meal.add(look ? fruitFood(look.fruit, look.colour) : piece('snake-apple', () => [[ball(0.1, 0, 0.11, 0, 1, 0.9, 1), '#e63946'], [new THREE.CylinderGeometry(0.008, 0.01, 0.07, 6).translate(0, 0.23, 0), '#6b4423'], [ball(0.04, 0.035, 0.23, 0, 1, 0.25, 0.55), '#4f9a4a']]));

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
      mid.addScaledVector(side, sway * Math.sin(d * 14 - time * 9) * Math.min(1, d * 3));
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

  return {
    root, body, head, meal,
    get yaw() { return headYaw; }, // the head's heading, eased
    set(state) { s = state; },
    face() { headYaw = Math.atan2(...DIRS[s.dir]); bulge = Infinity; swell = 0; },
    // The head swells and a lump runs down the body.
    gulp() { swell = 1; bulge = 0; },
    food(at) { meal.visible = !!at; if (at) meal.position.set(at[0], meal.position.y, at[1]); },
    update(dt, reduced) {
      if (!s) return;
      time += dt; bend(reduced, dt);
      // The head turns to where it's going (the heading's set as each step starts).
      segment(0, head.position); headYaw += spin(headYaw, Math.atan2(...DIRS[s.dir])) * (1 - Math.exp(-dt * HEAD_TURN));
      head.rotation.y = headYaw; head.scale.setScalar(1 + 0.3 * swell); swell = Math.max(0, swell - dt * 4);
      head.rotation.z = s.stall > 0 && s.mode === 'play' && !reduced ? Math.sin(time * 70) * 0.08 : 0; // a shiver while it holds
      tongue.visible = !reduced && s.mode !== 'over' && time % 1.6 < 0.3; tongue.scale.z = Math.sin((time % 1.6) / 0.3 * Math.PI);
      if (meal.visible) { meal.position.y = reduced ? 0 : 0.03 + Math.sin(time * 3) * 0.03; if (!reduced) meal.rotation.y += dt; }
    },
    dispose() { tube.dispose(); material.dispose(); },
  };
}
