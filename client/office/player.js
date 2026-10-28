// You, the boss: first-person movement with WASD/arrows, drag to look, click or tap to walk or pick someone, collision with walls and desks.
import * as THREE from 'three';
import { isTypingTarget } from './status.js';

export const EYE = 1.5;
const SPEED = 3, RADIUS = 0.3, LOOK = 0.0035, DRAG_SLOP = 6;
const keys = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };

// Keys belong to the office only when nothing else wants them: no focused input, no open panel or dialog.
export function officeHasKeys(event) {
  return !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target) && !isTypingTarget(document.activeElement)
    && !document.body.classList.contains('panel-open') && !document.querySelector('dialog[open], details[open]');
}

export class Player {
  constructor(canvas, { colliders, room, onPick }) {
    this.position = new THREE.Vector3(0, EYE, 0); this.yaw = Math.PI; this.pitch = -0.08;
    this.colliders = colliders; this.room = room; this.onPick = onPick; this.held = new Set(); this.target = null;
    const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); this.disposers.push(() => target.removeEventListener(type, fn, options)); };
    this.disposers = [];
    listen(document, 'keydown', event => { if (keys[event.code] && officeHasKeys(event)) { this.held.add(event.code); this.target = null; event.preventDefault(); } });
    listen(document, 'keyup', event => this.held.delete(event.code));
    listen(window, 'blur', () => this.held.clear());
    // Drag looks around; a press that barely moves is a click and picks what's under it.
    let drag = null;
    listen(canvas, 'pointerdown', event => { drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; canvas.setPointerCapture(event.pointerId); });
    listen(canvas, 'pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_SLOP) return;
      drag.moved = true;
      this.yaw -= event.movementX * LOOK; this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * LOOK, -1.1, 0.8);
    });
    listen(canvas, 'pointerup', event => { if (drag && !drag.moved) this.onPick(event); drag = null; });
    listen(canvas, 'pointercancel', () => { drag = null; });
  }

  place(x, z, yaw) { this.position.set(x, EYE, z); this.yaw = yaw; }
  face(point) { this.yaw = Math.atan2(point.x - this.position.x, point.z - this.position.z); }
  get forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  // Walks straight toward a floor point, sliding along whatever is in the way; `then` runs on arrival, or when stuck if `always`.
  walkTo(point, then, stopShort = 0, always = false) { this.target = { point: point.clone().setY(EYE), then, stopShort, always, stuck: 0 }; }

  update(dt) {
    const move = new THREE.Vector3();
    for (const code of this.held) { const [x, z] = keys[code]; move.x += x; move.z += z; }
    if (move.lengthSq()) {
      // Forward is where you look; strafe is to its right.
      const f = this.forward, right = new THREE.Vector3(-f.z, 0, f.x);
      this.step(f.multiplyScalar(move.z).add(right.multiplyScalar(move.x)).normalize().multiplyScalar(SPEED * dt));
      return;
    }
    const target = this.target; if (!target) return;
    const to = target.point.clone().sub(this.position).setY(0), distance = to.length();
    if (distance <= target.stopShort + 0.05) { this.target = null; target.then?.(); return; }
    const wanted = Math.atan2(to.x, to.z), turn = Math.atan2(Math.sin(wanted - this.yaw), Math.cos(wanted - this.yaw));
    this.yaw += turn * Math.min(1, dt * 8);
    const before = this.position.clone();
    this.step(to.normalize().multiplyScalar(Math.min(SPEED * dt, distance - target.stopShort)));
    target.stuck = this.position.distanceTo(before) < SPEED * dt * 0.2 ? target.stuck + dt : 0;
    // Blocked by a desk: stop here; a talk still goes ahead from as close as we got.
    if (target.stuck > 0.4) { this.target = null; if (target.always) target.then?.(); }
  }

  step(delta) { this.position.copy(resolveStep(this.position, delta, this.colliders(), this.room())); }

  dispose() { for (const fn of this.disposers) fn(); }
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

// What's under a screen point: a character (by session id) or a spot on the floor.
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
export function pick(event, canvas, camera, scene) {
  const rect = canvas.getBoundingClientRect();
  ndc.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  for (const hit of raycaster.intersectObjects(scene.children, true)) {
    let node = hit.object;
    while (node && !node.userData.sessionId) node = node.parent;
    if (node) return { kind: 'character', id: node.userData.sessionId };
    if (hit.object.userData.floor) return { kind: 'floor', point: hit.point };
    if (hit.object.visible && !hit.object.material?.transparent) return null;
  }
  return null;
}
