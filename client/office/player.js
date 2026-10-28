// You, the boss: first-person movement with WASD (Shift runs, Space jumps), arrow keys to look, collision with walls and desks.
// With a mouse, a click captures it (pointer lock): moving looks around, a click picks what's under the dot, right-click or Esc lets go.
// Looking with the arrow keys aims with the dot too, until the mouse moves.
// Touch drags the view along with the finger and taps to walk or pick someone. While the overview is up it has the keys and drags.
import * as THREE from 'three';
import { isTypingTarget } from './status.js';

export const EYE = 1.5;
const SPEED = 4, RUN = 1.9, RADIUS = 0.3, LOOK = 0.0035, TOUCH_LOOK = 0.006, LOCKED_LOOK = 0.0022, DRAG_SLOP = 6, JUMP = 4.2, GRAVITY = 13, TURN = 2.4, TILT = 1.4;
const keys = { KeyW: [0, 1], KeyS: [0, -1], KeyA: [-1, 0], KeyD: [1, 0] };
const turns = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
const turnTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

// Keys belong to the office only when nothing else wants them: no focused input, no open panel or dialog.
export function officeHasKeys(event) {
  return !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target) && !isTypingTarget(document.activeElement)
    && !document.body.classList.contains('panel-open') && !document.querySelector('dialog[open], details[open]');
}
// Nothing focused but the scene: on a button or link, Tab and Space keep their usual meaning.
export const sceneFocused = canvas => [document.body, canvas, null].includes(document.activeElement);

export class Player {
  constructor(canvas, { colliders, room, onPick }) {
    this.canvas = canvas; this.position = new THREE.Vector3(0, EYE, 0); this.yaw = Math.PI; this.pitch = -0.08;
    this.colliders = colliders; this.room = room; this.onPick = onPick; this.held = new Set(); this.target = null;
    this.locked = false; this.overview = false; this.keyLook = false; this.shift = false; this.running = false; this.height = 0; this.rise = 0; this.flight = null;
    const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); this.disposers.push(() => target.removeEventListener(type, fn, options)); };
    this.disposers = [];
    listen(document, 'keydown', event => {
      this.shift = event.shiftKey;
      if (!officeHasKeys(event) || this.overview) return;
      if (keys[event.code] || turns[event.code]) { this.held.add(event.code); this.target = null; if (turns[event.code]) this.keyLook = true; event.preventDefault(); }
      else if (event.code === 'Space' && sceneFocused(canvas)) { event.preventDefault(); this.jump(); }
    });
    listen(document, 'keyup', event => { this.shift = event.shiftKey; this.held.delete(event.code); });
    listen(window, 'blur', () => { this.held.clear(); this.shift = false; });
    listen(document, 'pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    const look = (x, y, speed) => { this.yaw -= x * speed; this.pitch = THREE.MathUtils.clamp(this.pitch - y * speed, -1.1, 0.8); };
    // Captured: every move looks, a left click picks under the dot, a right click lets go.
    // Otherwise a drag looks around and a press that barely moves is a click on what's under it; a second finger makes it neither.
    let drag = null;
    listen(canvas, 'contextmenu', event => event.preventDefault());
    listen(canvas, 'pointerdown', event => {
      if (this.locked) { if (event.button === 0) this.onPick(this.centre, true); else if (event.button === 2) this.unlock(); return; }
      this.keyLook = false;
      if (event.button !== 0) return;
      if (drag) { drag.moved = true; return; }
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; canvas.setPointerCapture(event.pointerId);
    });
    listen(canvas, 'pointermove', event => {
      if (this.locked) { look(event.movementX, event.movementY, LOCKED_LOOK); return; }
      // Browsers send still moves when the page shifts under the pointer (bubbles move); only a real one takes over from the keys.
      if (event.pointerType === 'mouse' && (event.movementX || event.movementY)) this.keyLook = false;
      if (!drag || drag.id !== event.pointerId) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_SLOP) return;
      drag.moved = true;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y; drag.x = event.clientX; drag.y = event.clientY;
      // A finger drags the scene along with it (turning the other way to a mouse), and a bit quicker: phone screens are small.
      if (!this.overview) { if (event.pointerType === 'touch') look(-dx, -dy, TOUCH_LOOK); else look(dx, dy, LOOK); }
    });
    listen(canvas, 'pointerup', event => { if (drag && !drag.moved) this.onPick(event, event.pointerType === 'mouse'); drag = null; });
    listen(canvas, 'pointercancel', () => { drag = null; });
  }

  // You stop where you are while the overview is up.
  setOverview(on) { this.overview = on; this.held.clear(); this.target = null; this.keyLook = false; }
  // Browsers without pointer lock, or that refuse it, keep drag-to-look.
  lock() { if (!this.locked) try { this.canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* not allowed here */ } }
  unlock() { if (this.locked) document.exitPointerLock(); }
  // Aiming with the dot in the middle rather than the pointer: captured, or looking with the arrow keys.
  get aiming() { return this.locked || this.keyLook; }
  get centre() { const r = this.canvas.getBoundingClientRect(); return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; }

  place(x, z, yaw) { this.position.set(x, EYE, z); this.yaw = yaw; }
  face(point) { this.yaw = Math.atan2(point.x - this.position.x, point.z - this.position.z); }
  get forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  jump() { if (!this.height && !this.rise && !this.flight) this.rise = JUMP; }

  // Walks straight toward a floor point, sliding along whatever is in the way; `then` runs on arrival, or when stuck if `always`.
  walkTo(point, then, stopShort = 0, always = false) { this.target = { point: point.clone().setY(EYE), then, stopShort, always, stuck: 0 }; }

  // Flies to a spot, turning to face `look` (clicking someone or a board) and tilting to `pitch`: quick and eased, with a small arc over the desks.
  flyTo(point, look, then, instant = false, pitch = -0.08) {
    const to = point.clone().setY(EYE), distance = this.position.distanceTo(to);
    this.target = null; this.height = this.rise = 0;
    this.flight = { from: this.position.clone(), to, yaw: this.yaw, turn: turnTo(this.yaw, Math.atan2(look.x - to.x, look.z - to.z)), pitch: this.pitch, tilt: pitch, t: 0,
      duration: instant ? 0 : THREE.MathUtils.clamp(0.2 + distance * 0.05, 0.3, 0.7), lift: Math.min(0.5, distance * 0.08), then };
  }

  update(dt) {
    this.running = false;
    if (this.flight) { this.fly(dt); return; }
    if (this.rise || this.height) { this.rise -= GRAVITY * dt; this.height = Math.max(0, this.height + this.rise * dt); if (!this.height) this.rise = 0; this.position.y = EYE + this.height; }
    const speed = SPEED * (this.shift ? RUN : 1), move = new THREE.Vector3();
    for (const code of this.held) {
      if (turns[code]) { const [yaw, pitch] = turns[code]; this.yaw += yaw * TURN * dt; this.pitch = THREE.MathUtils.clamp(this.pitch + pitch * TILT * dt, -1.1, 0.8); }
      else { const [x, z] = keys[code]; move.x += x; move.z += z; }
    }
    if (move.lengthSq()) {
      // Forward is where you look; strafe is to its right.
      const f = this.forward, right = new THREE.Vector3(-f.z, 0, f.x);
      this.step(f.multiplyScalar(move.z).add(right.multiplyScalar(move.x)).normalize().multiplyScalar(speed * dt));
      this.running = this.shift;
      return;
    }
    const target = this.target; if (!target) return;
    const to = target.point.clone().sub(this.position).setY(0), distance = to.length();
    if (distance <= target.stopShort + 0.05) { this.target = null; target.then?.(); return; }
    this.yaw += turnTo(this.yaw, Math.atan2(to.x, to.z)) * Math.min(1, dt * 8);
    const before = this.position.clone();
    this.step(to.normalize().multiplyScalar(Math.min(speed * dt, distance - target.stopShort)));
    this.running = this.shift;
    target.stuck = this.position.distanceTo(before) < speed * dt * 0.2 ? target.stuck + dt : 0;
    // Blocked by a desk: stop here; a talk still goes ahead from as close as we got.
    if (target.stuck > 0.4) { this.target = null; if (target.always) target.then?.(); }
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

// Moves on x, then z, undoing an axis that would push the body into a collider it wasn't already in, so you slide along
// walls and desks, and a desk that appears on top of you can't trap you. Then keeps you inside the room.
const inside = (p, box) => p.x > box.min.x - RADIUS && p.x < box.max.x + RADIUS && p.z > box.min.z - RADIUS && p.z < box.max.z + RADIUS;
export function resolveStep(position, delta, colliders, room) {
  const p = position.clone(), already = new Set(colliders.filter(box => inside(p, box)));
  for (const axis of ['x', 'z']) {
    if (!delta[axis]) continue;
    const before = p[axis];
    p[axis] += delta[axis];
    if (colliders.some(box => !already.has(box) && inside(p, box))) p[axis] = before;
  }
  if (room) { p.x = THREE.MathUtils.clamp(p.x, RADIUS, room.width - RADIUS); p.z = THREE.MathUtils.clamp(p.z, RADIUS, room.depth - RADIUS); }
  return p;
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
  for (const shift of [0, 0.5, -0.5, 1, -1]) for (let d = distance; d >= 0.8; d -= 0.3) {
    const p = point.clone().addScaledVector(normal, d).addScaledVector(side, shift).setY(EYE);
    if (free(p, colliders, room)) return p;
  }
  return null;
}
const free = (p, colliders, room) => (!room || (p.x >= RADIUS && p.x <= room.width - RADIUS && p.z >= RADIUS && p.z <= room.depth - RADIUS)) && !colliders.some(box => inside(p, box));

// What's under a screen point: a character (by session id), a board on the wall (userData.board), a spare desk
// (userData.spare: { cwd, name }) or a spot on the floor.
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
export function pick(event, canvas, camera, scene) {
  const rect = canvas.getBoundingClientRect();
  ndc.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  for (const hit of raycaster.intersectObjects(scene.children, true)) {
    let node = hit.object;
    while (node && !node.userData.sessionId && !node.userData.board && !node.userData.spare) node = node.parent;
    if (node?.userData.sessionId) return { kind: 'character', id: node.userData.sessionId };
    if (node?.userData.spare) return { kind: 'spare', node, point: hit.point, ...node.userData.spare };
    // A board on a wall that's faded out for the overview is hidden: look past it.
    if (node) { if (node.visible) return { kind: 'board', node }; continue; }
    if (hit.object.userData.floor) return { kind: 'floor', point: hit.point };
    if (hit.object.visible && !hit.object.material?.transparent) return null;
  }
  return null;
}
