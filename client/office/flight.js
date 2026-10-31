import * as THREE from 'three';

// Fixed-step flight for loose things: gravity and drag, then the floor, the ceiling, columns (people) and boxes. Pure (no
// document, no window), so a whole shot can be simulated ahead in Node or the browser and replayed frame by frame to the same spot.
export const STEP = 1 / 240, GRAVITY = 9.8, MOST = 24, REST = 0.1; // seconds per step; most steps in a frame; quiet time before rest
const { Vector3, Quaternion, Euler } = THREE;
const normal = new Vector3(), near = new Vector3(), local = new Vector3(), speed = new Vector3(), mid = new Vector3(), half = new Vector3();
const floor = new Vector3(0, 1, 0), ceiling = new Vector3(0, -1, 0), event = { surface: '', box: null, speed: 0, normal }; // `event` is reused: copy what you keep

// A box turned by Euler angles (x, y, z). Same duck type as Box3: min/max are its world AABB, plus owner and surface.
export class TiltedBox {
  constructor({ centre, half, rotation = [0, 0, 0], surface, owner }) {
    this.centre = new Vector3(...centre); this.half = new Vector3(...half); this.surface = surface; this.owner = owner;
    const e = new Euler(...rotation);
    this.quaternion = new Quaternion().setFromEuler(e); this.inverse = this.quaternion.clone().invert();
    const m = new THREE.Matrix4().makeRotationFromEuler(e).elements; // world extent: |R| · half
    const reach = i => Math.abs(m[i]) * this.half.x + Math.abs(m[i + 4]) * this.half.y + Math.abs(m[i + 8]) * this.half.z;
    this.min = new Vector3(this.centre.x - reach(0), this.centre.y - reach(1), this.centre.z - reach(2));
    this.max = new Vector3(this.centre.x + reach(0), this.centre.y + reach(1), this.centre.z + reach(2));
  }
  containsPoint(p) { local.copy(p).sub(this.centre).applyQuaternion(this.inverse); return Math.abs(local.x) <= this.half.x && Math.abs(local.y) <= this.half.y && Math.abs(local.z) <= this.half.z; }
  clampPoint(p, out) {
    out.copy(p).sub(this.centre).applyQuaternion(this.inverse);
    out.x = Math.max(-this.half.x, Math.min(this.half.x, out.x)); out.y = Math.max(-this.half.y, Math.min(this.half.y, out.y)); out.z = Math.max(-this.half.z, Math.min(this.half.z, out.z));
    return out.applyQuaternion(this.quaternion).add(this.centre);
  }
}

const vec = v => v?.isVector3 ? v.clone() : new Vector3().fromArray(v ?? [0, 0, 0]);
export const makeBody = (kind, pos, vel) => ({ kind, pos: vec(pos), vel: vec(vel), spin: new Vector3(), ground: false, rest: false, due: 0, quiet: 0 });
// More than a metre outside the building: it got past the walls somehow.
export const escaped = (p, { left, back = 0, width, depth }) => p.x < left - 1 || p.x > width + 1 || p.z < back - 1 || p.z > depth + 1;

// Put somewhere by hand (let go of, nudged), not flown: a thing of this kind goes from `from` to `to` in one jump, too far to bounce.
// `to` is moved back to the first box on the way, on `from`'s side, so it can't be put through a wall or left past its middle; a
// gap gets through, whatever it's in. Tops count by `low`, as they do to stand on, so it slides along a desk it's on. A box `from`
// is already in doesn't count: flight pushes it out of that. Returns `to`.
export function stopShort(from, to, { radius: r, low }, colliders) {
  let first = 1;
  for (const box of colliders) {
    const turned = box.inverse;
    local.copy(from); speed.copy(to);
    if (turned) { local.sub(box.centre).applyQuaternion(turned); speed.sub(box.centre).applyQuaternion(turned); mid.copy(box.half).negate(); half.copy(box.half); } else { mid.copy(box.min); half.copy(box.max); }
    let enter = -Infinity, exit = Infinity;
    for (let i = 0; i < 3; i++) {
      const a = local.getComponent(i), d = speed.getComponent(i) - a, lo = mid.getComponent(i) - r, hi = half.getComponent(i) + (i === 1 ? low - 1e-6 : r);
      if (Math.abs(d) < 1e-9) { if (a <= lo || a >= hi) enter = Infinity; continue; }
      const t0 = (lo - a) / d, t1 = (hi - a) / d;
      enter = Math.max(enter, Math.min(t0, t1)); exit = Math.min(exit, Math.max(t0, t1));
    }
    if (enter >= 0 && enter <= exit && enter < first) first = enter;
  }
  return first < 1 ? to.lerpVectors(from, to, first) : to;
}

// Reports a hit before resolving it (the speed into the surface), then bounces: a hard knock keeps `bounce` (the kind's, unless the box has its own), a soft one just stops.
export const contact = (b, world, n, surface, box) => {
  const vn = b.vel.dot(n);
  if (vn < 0) {
    if (world.onContact) { event.surface = surface; event.box = box; event.speed = -vn; event.normal = n; world.onContact(b, event); }
    b.vel.addScaledVector(n, -(vn < -1 ? 1 + (box?.bounce ?? b.kind.bounce) : 1) * vn);
  }
  return n.y > 0.7;
};

// The centre is inside the box: out through the face the velocity came in by (the nearest would send a ball through the far
// side of a thin plate), if it can only just have got in; otherwise the nearest face. Never the bottom, which would put it
// under the floor. Sets `normal`, returns the (negative) gap along it.
let axis = 0, sign = 1, best = Infinity;
function choose(timed) { // timed: by time since entering along the velocity; else by depth
  best = Infinity;
  for (let i = 0; i < 3; i++) {
    const l = local.getComponent(i), v = speed.getComponent(i), h = half.getComponent(i);
    if (timed && Math.abs(v) < 1e-9) continue;
    for (let k = 0; k < 2; k++) {
      const s = timed ? (v >= 0 ? 1 : -1) : (k ? -1 : 1); // s: the way it was heading; it came in by the face at -s
      if (timed && k) break;
      if (i === 1 && s === 1) continue; // that would leave through the bottom
      const depth = h + s * l, t = timed ? depth / Math.abs(v) : depth;
      if (t < best) { best = t; axis = i; sign = s; }
    }
  }
}
function leave(b, box) {
  const q = box.inverse; box.getCenter?.(mid); half.copy(box.half ?? (box.getSize(half).multiplyScalar(0.5)));
  const c = box.centre ?? mid;
  local.copy(b.pos).sub(c); speed.copy(b.vel);
  if (q) { local.applyQuaternion(q); speed.applyQuaternion(q); }
  choose(true);
  if (!(best <= 2 * STEP)) choose(false); // it didn't just arrive (or isn't moving): gravity alone says nothing about where from
  normal.set(0, 0, 0).setComponent(axis, -sign);
  const depth = half.getComponent(axis) + sign * local.getComponent(axis);
  if (q) normal.applyQuaternion(box.quaternion);
  return -depth;
}

// Hits at the body's place: the floor, the ceiling, columns (people), boxes. Port of the old props.js step, without the room's walls (they're colliders now) and without knocking owners. True if it's standing on something.
function collide(b, world) {
  const { radius: r, low } = b.kind;
  let ground = false;
  if (b.pos.y < low) { b.pos.y = low; ground = contact(b, world, floor, 'floor', null); }
  if (world.ceiling != null && b.pos.y > world.ceiling - r) { b.pos.y = world.ceiling - r; contact(b, world, ceiling, 'ceiling', null); }
  if (world.columns) for (const p of world.columns) { // people: a round column to the head
    const dx = b.pos.x - p.x, dz = b.pos.z - p.z, gap = Math.hypot(dx, dz), reach = p.r + r;
    if (gap >= reach || b.pos.y - low > p.top) continue;
    normal.set(dx, 0, dz).divideScalar(gap || 1); b.pos.x = p.x + normal.x * reach; b.pos.z = p.z + normal.z * reach;
    contact(b, world, normal, p.surface ?? 'person', p);
  }
  for (const box of world.colliders) {
    const { min, max } = box, p = b.pos;
    if (p.x < min.x - r || p.x > max.x + r || p.y < min.y - r || p.y > max.y + r || p.z < min.z - r || p.z > max.z + r) continue;
    box.clampPoint(p, near); normal.subVectors(p, near);
    let gap = normal.length();
    if (gap >= r) continue;
    if (gap > 1e-6) normal.divideScalar(gap); else gap = leave(b, box);
    const reach = normal.y > 0.7 ? low : r; // it stands on what it lands on
    if (gap >= reach) continue;
    b.pos.addScaledVector(normal, reach - gap);
    ground = contact(b, world, normal, box.surface ?? 'box', box) || ground;
  }
  return ground;
}

// One STEP, moved in parts no longer than the distance a face is felt from (its radius, or `low` on a top): its middle can't get past a face between looks, so no thing is too thin and no speed too fast.
export function stepBody(b, world) {
  if (b.rest) return;
  const h = STEP, { radius: r, low, roll, drag, upright } = b.kind;
  b.vel.y -= (b.kind.gravity ?? GRAVITY) * h; b.vel.multiplyScalar(Math.exp(-drag * h));
  const parts = Math.max(1, Math.ceil(b.vel.length() * h / Math.min(r, low)));
  let ground = false;
  for (let i = 0; i < parts; i++) { b.pos.addScaledVector(b.vel, h / parts); ground = collide(b, world) || ground; }
  // ponytail: no orientation here, only spin; whoever draws the thing turns it by `spin`
  if (ground) { const k = Math.exp(-roll * h); b.vel.x *= k; b.vel.z *= k; if (upright) b.spin.set(0, 0, 0); else b.spin.set(b.vel.z, 0, -b.vel.x).divideScalar(r); }
  else b.spin.multiplyScalar(Math.exp(-0.5 * h));
  b.ground = ground;
  b.quiet = ground && b.vel.lengthSq() < 0.01 ? b.quiet + h : 0;
  if (b.quiet >= REST - 1e-9) { b.vel.set(0, 0, 0); b.spin.set(0, 0, 0); b.rest = true; }
}

// A frame's worth: whole steps only, the remainder waits in `due`. Past MOST steps the rest of the frame is dropped.
export function advance(b, dt, world) {
  if (b.rest) return;
  b.due += dt;
  let n = 0;
  while (b.due >= STEP && n < MOST && !b.rest) { stepBody(b, world); b.due -= STEP; n++; }
  if (b.due > STEP) b.due = STEP;
}

// A whole shot ahead of time on a body (stepped in place): the path every 4 steps, each contact (with where the thing was and which way the surface faces), and where it ends.
// `stop(contact)` true ends it at that step, and so does `until(body)` after any step. Called again on the same body, it goes on from there.
export function simulate(b, world, { maxTime = 8, stop, until } = {}) {
  const most = Math.floor(maxTime / STEP + 1e-9), path = new Float32Array(Math.floor(most / 4) * 3), contacts = [];
  let n = 0, done = false, at = 0;
  const watch = { ...world, onContact(body, e) { world.onContact?.(body, e); const c = { time: (n + 1) * STEP, surface: e.surface, speed: e.speed, box: e.box, normal: e.normal.toArray(), pos: body.pos.toArray() }; contacts.push(c); if (stop?.(c)) done = true; } };
  for (; n < most && !b.rest && !done; n++) {
    stepBody(b, watch);
    if ((n + 1) % 4 === 0) { path[at++] = b.pos.x; path[at++] = b.pos.y; path[at++] = b.pos.z; }
    if (until?.(b)) done = true;
  }
  return { path: path.slice(0, at), contacts, time: Math.min(maxTime, n * STEP), rest: b.rest, pos: b.pos.toArray() };
}
