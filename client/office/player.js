import { reducedAtmosphere } from '../atmosphere.js';
// You, the boss: first-person movement with WASD (Shift runs, Space jumps), arrow keys to look, collision with walls and desks.
// With a mouse, a click captures it (pointer lock): moving looks around, a click picks what's under the dot, right-click or Esc lets go.
// Holding something, a press charges a throw instead (`onPress` says so) and letting go throws it (`onRelease`). Right-click calls it
// off first of all (`onCancel`, true if there was one), and so do losing the mouse or the window. Not captured, a drag does too.
// Captured is what you want until you let go yourself: whatever else takes the mouse (a panel, a menu, the overview, another
// window) gives it back when it's done (`wanted`, `resume`). Looking with the arrow keys aims with the dot too, until the mouse moves.
// Touch turns the view as a mouse does (as games have it, not a photo sphere) and taps to walk or pick someone, holding something or not: on touch the throw button (`createThrowButton`) charges, and while it's held (`aimFine`) a finger turns the view finely. While the overview is up it has the keys and drags.
// A click on the floor walks there round the furniture: a walking key calls it off, and looking around doesn't.
// Pinned (`pin`), for a game played from your own eyes, you stay where you are and can still look.
import * as THREE from 'three';
import { menuOpen, officeHasKeys, sceneFocused } from '../scene-keys.js';

export const EYE = 1.5;
export const LOOK_UP = 0.8; // radians: as high as you can look
// How far (px) a press can move and still be a tap, not a drag (darts.js tells them apart the same way).
export const DRAG_SLOP = 6;
const SPEED = 4, RUN = 1.9, RADIUS = 0.3, LOOK = 0.0035, TOUCH_LOOK = 0.006, LOCKED_LOOK = 0.0022, JUMP = 4.2, FLING = 0.3, GRAVITY = 13, TURN = 2.4, TILT = 1.4;
// How far (radians) you have to look on a walk for the view to stay yours; less is a twitch of the mouse as it clicks.
const TAKE_VIEW = 0.05;
// A walk by a click: it picks up speed (m/s²) and slows to a stop at the end; each corner is rounded off from up to ROUND (m)
// before it, in BEND straight bits, where there's room; the view turns toward a point AHEAD (m) on along the way, on a spring
// that settles in about TURN_TIME (s), so it starts round a corner before you get there and never jerks.
const ACCEL = 14, BRAKE = 11, ROUND = 0.8, BEND = 16, AHEAD = 1.5, TURN_TIME = 0.22;
const keys = { KeyW: [0, 1], KeyS: [0, -1], KeyA: [-1, 0], KeyD: [1, 0] };
const turns = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
const turnTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

export { menuOpen, officeHasKeys, sceneFocused };
// What a key does in a game. Seated, the arrows walk you out too and E clicks for as long as it's held. In a free game the arrows
// still look, and a key held from before does nothing.
export const gameKey = ({ key, code, repeat }, { free, holding }) => {
  if (key === 'Escape') return free && repeat ? null : 'leave'; // a held Esc has already called off a charge or closed something: it takes one press more to go
  if (code === 'KeyE') return !free ? 'click' : repeat ? null : holding ? 'charge' : 'click';
  if (code.startsWith('Arrow')) return free ? 'look' : 'leave';
  return /^(Key[WASD]|Space)$/.test(code) && !(free && repeat) ? 'leave' : null;
};

export class Player {
  constructor(canvas, { colliders, room, onPick, onPress = () => false, onRelease = () => {}, onCancel = () => false, onLetGo = () => {}, lookHeld = () => false, route }) {
    this.canvas = canvas; this.position = new THREE.Vector3(0, EYE, 0); this.yaw = Math.PI; this.pitch = -0.08; this.spin = 0;
    this.colliders = colliders; this.room = room; this.onPick = onPick; this.onPress = onPress; this.onRelease = onRelease; this.onCancel = onCancel; this.onLetGo = onLetGo; this.lookHeld = lookHeld; this.route = route; this.held = new Set(); this.target = null;
    this.locked = this.wanted = this.releasing = this.asking = false; this.overview = this.pinned = false; this.keyLook = false; this.shift = false; this.running = false; this.height = 0; this.rise = 0; this.flight = null;
    const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); this.disposers.push(() => target.removeEventListener(type, fn, options)); };
    this.disposers = [];
    // A drag; and `charging`: this press charged a throw, so its release is that throw's, even if it's been called off since, and
    // never a click. Called off with the button out of sight, the press is over, for it may come up where we can't see it.
    let drag = null, charging = false, fine = false;
    const noThrow = () => { if (charging) { charging = false; this.onCancel(); } };
    const callOff = () => { if (charging) drag = null; charging = false; this.onCancel(); };
    // The throw button's held: any finger on the canvas turns the view finely, whichever came down first. That finger's no tap and no fling, even if the button's let go first.
    this.aimFine = on => { fine = on; if (!on) return; this.spin = 0; if (drag) { drag.moved = drag.fine = true; drag.v = 0; } };
    listen(document, 'keydown', event => {
      this.shift = event.shiftKey;
      if (!officeHasKeys(event) || this.overview) return;
      if (keys[event.code] || turns[event.code]) { this.held.add(event.code); if (keys[event.code]) { this.stand(); this.target = null; } else this.keyLook = true; event.preventDefault(); }
      else if (event.code === 'Space' && sceneFocused(canvas)) { event.preventDefault(); this.jump(); }
    });
    listen(document, 'keyup', event => { this.shift = event.shiftKey; this.held.delete(event.code); });
    listen(window, 'blur', () => { this.held.clear(); this.shift = false; callOff(); });
    // Let go of without our asking: Esc (you want the mouse), or the window losing focus (you'll want it back).
    listen(document, 'pointerlockchange', () => {
      const lost = this.locked && document.pointerLockElement !== canvas && !this.releasing;
      if (this.locked && document.pointerLockElement !== canvas) callOff();
      this.locked = document.pointerLockElement === canvas; this.releasing = this.asking = false;
      if (lost) setTimeout(() => { if (document.hasFocus() && !document.hidden) { this.wanted = false; this.onLetGo(); } }, 100);
    });
    listen(document, 'pointerlockerror', () => { this.asking = false; });
    const look = (x, y, speed) => { if (this.lookHeld()) return; this.yaw -= x * speed; this.pitch = THREE.MathUtils.clamp(this.pitch - y * speed, -1.1, LOOK_UP); if (this.target) this.target.looked += (Math.abs(x) + Math.abs(y)) * speed; };
    // Captured: every move looks, a left click picks under the dot, a right click lets go.
    // Otherwise a drag looks around and a press that barely moves is a click on what's under it; a second finger makes it neither.
    listen(canvas, 'contextmenu', event => event.preventDefault());
    listen(canvas, 'pointerdown', event => {
      if (this.locked) {
        if (event.button === 0) { charging = this.onPress(this.centre, true); if (!charging) this.onPick(this.centre, true); }
        else if (event.button === 2 && !this.onCancel()) { this.wanted = false; this.unlock(); }
        return;
      }
      this.keyLook = false;
      if (event.button !== 0) { if (event.button === 2) this.onCancel(); return; }
      this.spin = 0;
      if (drag) { drag.moved = true; noThrow(); return; }
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: fine, fine, t: event.timeStamp, v: 0 }; canvas.setPointerCapture(event.pointerId);
      charging = event.pointerType !== 'touch' && this.onPress(event, event.pointerType === 'mouse');
    });
    listen(canvas, 'pointermove', event => {
      if (event.button === 2) this.onCancel(); // pressed with the left still down, a right click is only a move
      if (this.locked) { look(event.movementX, event.movementY, LOCKED_LOOK); return; }
      // Browsers send still moves when the page shifts under the pointer (bubbles move); only a real one takes over from the keys.
      if (event.pointerType === 'mouse' && (event.movementX || event.movementY)) this.keyLook = false;
      if (!drag || drag.id !== event.pointerId) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_SLOP) return;
      drag.moved = true; noThrow();
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y; drag.x = event.clientX; drag.y = event.clientY;
      // A finger turns the way a mouse would, so a swipe right looks right and the aim goes where the finger does: a swipe across the screen
      // turns about 225° whatever its size, and the turn's speed (smoothed) carries on as a fling when the finger lifts.
      if (this.overview) return;
      if (fine) { look(dx, dy, LOCKED_LOOK); return; }
      if (event.pointerType !== 'touch') { look(dx, dy, LOOK); return; }
      const speed = Math.max(TOUCH_LOOK, 1.25 * Math.PI / innerWidth), ms = Math.max(1, event.timeStamp - drag.t);
      look(dx, dy, speed);
      drag.v = drag.v * 0.6 - dx * speed / ms * 1000 * 0.4; drag.t = event.timeStamp;
    });
    listen(canvas, 'pointerup', event => {
      if (charging) { charging = false; this.onRelease(this.locked || event.pointerType !== 'mouse' ? this.centre : event); }
      else if (drag && !drag.moved) this.onPick(event, event.pointerType === 'mouse');
      // A finger that stopped before lifting doesn't fling.
      else if (drag && !drag.fine && event.pointerType === 'touch' && event.timeStamp - drag.t < 100 && !reducedAtmosphere()) this.spin = drag.v;
      drag = null;
    });
    listen(canvas, 'pointercancel', () => { drag = null; noThrow(); });
  }

  // You stop where you are while the overview is up.
  setOverview(on) { this.overview = on; this.spin = 0; this.held.clear(); this.target = null; this.keyLook = false; }
  // No walking, on foot or by a click, and no jump. A walking key still down doesn't count afterwards.
  pin(on) {
    this.pinned = on; if (!on) return;
    this.stand();
    this.target = null; this.height = this.rise = 0; this.position.y = EYE;
    for (const code of Object.keys(keys)) this.held.delete(code);
  }
  // Browsers without pointer lock, or that refuse it, keep drag-to-look.
  lock() {
    this.wanted = true; if (this.locked || this.asking) return;
    this.asking = true;
    try { this.canvas.requestPointerLock()?.catch?.(() => { this.asking = false; }); } catch { this.asking = false; /* not allowed here */ }
  }
  // Something else needs the mouse for now; it comes back with `resume`.
  unlock() { if (this.locked) { this.releasing = true; document.exitPointerLock(); } }
  // Captures the mouse again if it was captured before something else took it. Without a click or key press, browsers allow
  // that only after the page itself let go (Chrome), so after another window it can wait for the next key.
  resume() { if (this.wanted) this.lock(); }
  // Aiming with the dot in the middle rather than the pointer: captured, or looking with the arrow keys.
  get aiming() { return this.locked || this.keyLook; }
  get centre() { const r = this.canvas.getBoundingClientRect(); return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; }

  place(x, z, yaw) { this.stand(); this.position.set(x, EYE, z); this.yaw = yaw; }
  // The standing place is clear of furniture; return there before moving away from the seat.
  sit(point, yaw) {
    this.stand(); this.seated = this.position.clone().setY(EYE); this.target = this.flight = null;
    this.height = this.rise = this.spin = 0; this.position.copy(point); this.yaw = yaw; this.pitch = -0.08;
    for (const code of Object.keys(keys)) this.held.delete(code);
  }
  stand() { if (this.seated) { this.position.copy(this.seated); this.seated = null; } }
  // There at once, facing that way and level, whatever you were up to on the way.
  jumpTo(x, z, yaw) { this.target = this.flight = null; this.height = this.rise = this.spin = 0; this.pitch = -0.08; this.place(x, z, yaw); }
  face(point) { this.yaw = Math.atan2(point.x - this.position.x, point.z - this.position.z); }
  get forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  jump() { if (!this.pinned && !this.height && !this.rise && !this.flight) { this.stand(); this.rise = JUMP; } }

  // Walks to a floor point round the furniture (`route`), or straight there sliding along what's in the way if there's no way
  // through; `then` runs on arrival, or when stuck if `always`. The view turns to face the way until you look somewhere yourself.
  // Stopping short is of the last leg: through a desk, the end can be near long before you are. A new walk on the way keeps its pace.
  walkTo(point, then, stopShort = 0, always = false) {
    if (this.pinned) return;
    this.stand();
    if (!this.target) this.pace = this.turning = 0;
    const start = this.position.clone().setY(0), way = rounded([start, ...(this.route?.(this.position, point) || [point]).map(at => at.clone().setY(0))], this.colliders(), this.room()).slice(1);
    const end = way.at(-1), leg = end.clone().sub(way.at(-2) ?? start);
    this.target = { way, then, stopShort: Math.min(stopShort, leg.length()), ahead: leg.normalize(), always, stuck: 0, looked: 0 };
  }

  // Flies to a spot, turning to face `look` (clicking someone or a board) and tilting to `pitch`: quick and eased, with a small arc over the desks.
  flyTo(point, look, then, instant = false, pitch = -0.08) {
    this.stand();
    const to = point.clone().setY(EYE), distance = this.position.distanceTo(to);
    this.target = null; this.height = this.rise = 0;
    this.spin = 0;
    this.flight = { from: this.position.clone(), to, yaw: this.yaw, turn: turnTo(this.yaw, Math.atan2(look.x - to.x, look.z - to.z)), pitch: this.pitch, tilt: pitch, t: 0,
      duration: instant ? 0 : THREE.MathUtils.clamp(0.2 + distance * 0.05, 0.3, 0.7), lift: Math.min(0.5, distance * 0.08), then };
  }

  update(dt) {
    this.running = false;
    if (this.lookHeld()) this.spin = 0;
    if (this.spin) { this.yaw += this.spin * dt; this.spin *= Math.exp(-dt / FLING); if (Math.abs(this.spin) < 0.05) this.spin = 0; }
    if (this.flight) { this.fly(dt); return; }
    if (this.rise || this.height) { this.rise -= GRAVITY * dt; this.height = Math.max(0, this.height + this.rise * dt); if (!this.height) this.rise = 0; this.position.y = EYE + this.height; }
    const speed = SPEED * (this.shift ? RUN : 1), move = new THREE.Vector3();
    for (const code of this.held) {
      if (turns[code]) { if (this.lookHeld()) continue; const [yaw, pitch] = turns[code]; this.yaw += yaw * TURN * dt; this.pitch = THREE.MathUtils.clamp(this.pitch + pitch * TILT * dt, -1.1, LOOK_UP); if (this.target) this.target.looked += TURN * dt; }
      else if (!this.pinned) { const [x, z] = keys[code]; move.x += x; move.z += z; this.target = null; } // also a walk begun with this key already down
    }
    if (move.lengthSq()) {
      // Forward is where you look; strafe is to its right.
      const f = this.forward, right = new THREE.Vector3(-f.z, 0, f.x);
      this.step(f.multiplyScalar(move.z).add(right.multiplyScalar(move.x)).normalize().multiplyScalar(speed * dt));
      this.running = this.shift;
      return;
    }
    const target = this.target; if (!target) return;
    const { way } = target, here = this.position.clone().setY(0);
    while (way.length > 1 && here.distanceTo(way[0]) <= 0.01) way.shift();
    let left = -target.stopShort;
    for (let i = 0, from = here; i < way.length; from = way[i++]) left += from.distanceTo(way[i]);
    if (left <= 0.01) { this.target = null; this.pace = this.turning = 0; target.then?.(); return; }
    // Up to speed and back down, braking to arrive at no speed at all.
    this.pace = Math.min(this.pace + THREE.MathUtils.clamp(speed - this.pace, -ACCEL * dt, ACCEL * dt), Math.sqrt(2 * BRAKE * left));
    const go = Math.min(this.pace * dt, left), to = here.clone();
    let rest = go;
    while (way.length > 1 && to.distanceTo(way[0]) <= rest) { rest -= to.distanceTo(way[0]); to.copy(way.shift()); }
    const d = to.distanceTo(way[0]); if (d > 0) to.lerp(way[0], Math.min(1, rest / d));
    this.step(to.sub(here));
    this.running = this.shift;
    if (target.looked < TAKE_VIEW) {
      const look = along(this.position.clone().setY(0), way, AHEAD, target.ahead).sub(this.position).setY(0);
      if (look.lengthSq() > 1e-6) this.turnToward(Math.atan2(look.x, look.z), dt);
    } else this.turning = 0;
    target.stuck = this.position.clone().setY(0).distanceTo(here) < go * 0.2 ? target.stuck + dt : 0;
    // Blocked by a desk: stop here; a talk still goes ahead from as close as we got.
    if (target.stuck > 0.4) { this.target = null; this.pace = this.turning = 0; if (target.always) target.then?.(); }
  }

  // Eases the view's yaw toward `aim` on a critically damped spring (`turning` its speed, as Unity's SmoothDamp): when the
  // aim jumps, the turn picks up speed rather than starting at full tilt.
  turnToward(aim, dt) {
    const w = 2 / TURN_TIME, x = w * dt, decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x), off = turnTo(aim, this.yaw), push = (this.turning + w * off) * dt;
    this.turning = (this.turning - w * push) * decay; this.yaw += (off + push) * decay - off;
  }

  fly(dt) {
    const f = this.flight; f.t = f.duration ? Math.min(1, f.t + dt / f.duration) : 1;
    const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (2 - 2 * f.t) ** 3 / 2;
    this.position.lerpVectors(f.from, f.to, e); this.position.y += Math.sin(Math.PI * e) * f.lift;
    this.yaw = f.yaw + f.turn * e; this.pitch = f.pitch + (f.tilt - f.pitch) * e; this.running = f.t < 1;
    if (f.t === 1) { this.flight = null; f.then?.(); }
  }

  step(delta) { this.position.copy(resolveStep(this.position, delta, this.colliders(), this.room())); }

  dispose() { this.unlock(); for (const fn of this.disposers) fn(); }
}

// The point `distance` on along a way (floor points) from `from`, carrying on past its end the way its last leg goes (`ahead`).
function along(from, way, distance, ahead) {
  const at = from.clone();
  for (const to of way) { const d = at.distanceTo(to); if (d >= distance) return at.lerp(to, distance / d); at.copy(to); distance -= d; }
  return at.addScaledVector(ahead, distance);
}

// A way (floor points) with each corner rounded off: a curve from up to ROUND before it to as far after, never more than half
// of either leg so the next corner has its half, where the body fits all along it (free); else a tighter one, else the corner.
function rounded(points, colliders, room) {
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const corner = points[i], back = points[i - 1].clone().sub(corner), on = points[i + 1].clone().sub(corner);
    let bend = null;
    for (let r = Math.min(ROUND, back.length() / 2, on.length() / 2); r > 0.05 && !bend; r /= 2) {
      const a = corner.clone().addScaledVector(back, r / back.length()), b = corner.clone().addScaledVector(on, r / on.length());
      const curve = Array.from({ length: BEND + 1 }, (_, k) => { const t = k / BEND; return a.clone().multiplyScalar((1 - t) ** 2).addScaledVector(corner, 2 * t * (1 - t)).addScaledVector(b, t * t); });
      if (curve.every(p => free(p, colliders, room))) bend = curve;
    }
    out.push(...(bend || [corner]));
  }
  if (points.length > 1) out.push(points.at(-1));
  return out;
}

// Moves on x, then z, undoing an axis that would push the body into a collider it wasn't already in, so you slide along
// walls and desks, and a desk that appears on top of you can't trap you. Then keeps you inside the room; a round room says so
// itself (`room.inside`), one axis at a time so you slide along it too.
const inside = (p, box) => p.x > box.min.x - RADIUS && p.x < box.max.x + RADIUS && p.z > box.min.z - RADIUS && p.z < box.max.z + RADIUS;
export function resolveStep(position, delta, colliders, room) {
  const p = position.clone(), already = new Set(colliders.filter(box => inside(p, box)));
  const hits = () => colliders.some(box => !already.has(box) && inside(p, box));
  for (const axis of ['x', 'z']) {
    if (!delta[axis]) continue;
    const before = p[axis];
    p[axis] += delta[axis];
    if (hits() || room?.inside?.(p) === false && !slide(p, axis, delta[axis], room, hits)) p[axis] = before;
  }
  if (room) { p.x = THREE.MathUtils.clamp(p.x, (room.left ?? 0) + RADIUS, room.width - RADIUS); p.z = THREE.MathUtils.clamp(p.z, (room.back ?? 0) + RADIUS, room.depth - RADIUS); }
  return p;
}

// A curved wall can turn both axes away at once: giving up a little of the other one carries you on along it.
function slide(p, axis, amount, room, hits) {
  const other = axis === 'x' ? 'z' : 'x', at = p[other];
  for (const part of [0.05, 0.1, 0.2, 0.5]) for (const sign of [-1, 1]) {
    p[other] = at + sign * part * Math.abs(amount);
    if (room.inside(p) && !hits()) return true;
  }
  p[other] = at;
  return false;
}

// Where to stand to talk to someone: `distance` from them, as near the side you come from as desks and walls allow; null if boxed in.
export function standNear(target, from, colliders, room, distance = 1.1) {
  const toward = Math.atan2(from.x - target.x, from.z - target.z);
  for (let i = 0; i < 12; i++) {
    const a = toward + Math.ceil(i / 2) * (i % 2 ? 1 : -1) * Math.PI / 6, p = new THREE.Vector3(target.x + Math.sin(a) * distance, EYE, target.z + Math.cos(a) * distance);
    if (free(p, colliders, room)) return p;
  }
  return null;
}
// Where to stand to read a board: `distance` straight out from it along the wall's `normal`, else nearer, else a little to one side.
export function standBefore(point, normal, distance, colliders, room) {
  const side = new THREE.Vector3(-normal.z, 0, normal.x);
  for (const shift of [0, 0.5, -0.5, 1, -1]) for (let d = distance; d >= Math.min(distance, 0.8); d -= 0.3) {
    const p = point.clone().addScaledVector(normal, d).addScaledVector(side, shift).setY(EYE);
    if (free(p, colliders, room)) return p;
  }
  return null;
}
export const free = (p, colliders, room) => (!room || (p.x >= (room.left ?? 0) + RADIUS && p.x <= room.width - RADIUS && p.z >= (room.back ?? 0) + RADIUS && p.z <= room.depth - RADIUS)) && room?.inside?.(p) !== false && !colliders.some(box => inside(p, box));

// What's under a screen point: a character (by session id), a desk's monitor (userData.monitor: whose), a board on the wall
// (userData.board), a pod's sign (userData.hire: { cwd, name }), a toggle (the light switch, the coffee machine), something to
// pick up (userData.prop(instance) gives its body) or a spot on the floor.
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
// The direction into the scene through a screen point.
export function rayAt(event, canvas, camera) {
  const rect = canvas.getBoundingClientRect();
  ndc.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.direction.clone();
}
// Drawn: it and everything it's in (a ray finds what's hidden too).
const shown = node => { for (let n = node; n; n = n.parent) if (!n.visible) return false; return true; };
export function pick(event, canvas, camera, scene) {
  rayAt(event, canvas, camera);
  for (const hit of raycaster.intersectObjects(scene.children, true)) {
    let node = hit.object;
    while (node && !node.userData.sessionId && !node.userData.monitor && !node.userData.board && !node.userData.hire && !node.userData.toggle) node = node.parent;
    if (node?.userData.sessionId) return { kind: 'character', id: node.userData.sessionId };
    if (node?.userData.monitor) return { kind: 'monitor', id: node.userData.monitor, node, point: hit.point };
    // A toggle (with where it was hit): the light switch, hidden with its wall, or a game behind a shut shelf, look past.
    if (node?.userData.toggle) { if (shown(node)) return { kind: 'toggle', node, point: hit.point }; continue; }
    if (node?.userData.hire) return { kind: 'hire', node, point: hit.point, ...node.userData.hire };
    // A board on a wall that's faded out for the overview is hidden: look past it.
    if (node) { if (node.visible) return { kind: 'board', node }; continue; }
    if (hit.object.userData.prop) { const body = hit.object.userData.prop(hit.instanceId); if (body) return { kind: 'prop', body, distance: hit.distance }; continue; }
    if (hit.object.userData.floor) return { kind: 'floor', point: hit.point };
    if (hit.object.visible && !hit.object.material?.transparent) return null;
  }
  return null;
}
