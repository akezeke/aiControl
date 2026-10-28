// The overview (Tab): the desks from the front and above, as close as fits them, then wherever you take it: drag or
// WASD/arrows to pan, scroll, pinch or +/- to zoom. It starts from the fitted view each time it opens.
import * as THREE from 'three';
import { officeHasKeys } from './player.js';

// Looking down at 55°, with room for the heads and bubbles over the desks and a margin round the screen edge.
// Zoom goes from 3 m off the floor out to 1.6 times the fitted distance.
const PITCH = 55 * Math.PI / 180, HEADS = 2.2, MARGIN = 0.07, CLOSEST = 3, FURTHEST = 1.6, KEY_PAN = 0.9, KEY_ZOOM = 1.5;
const SLOPE = new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
const PAN = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
const ZOOM = { '+': -1, '=': -1, '-': 1, '_': 1 };

// The closest spot on the slope that keeps the boxes ([minX, maxX, minZ, maxZ], floor up to head height) on screen,
// centred: the floor point in the middle of the screen, and how far back along the slope the camera is from it.
export function fitOverview(boxes, fov, aspect) {
  const cam = new THREE.PerspectiveCamera(fov, aspect), p = new THREE.Vector3();
  const corners = boxes.flatMap(([minX, maxX, minZ, maxZ]) => [minX, maxX].flatMap(x => [0, HEADS].flatMap(y => [minZ, maxZ].map(z => new THREE.Vector3(x, y, z)))));
  const span = i => [Math.min(...boxes.map(box => box[i])), Math.max(...boxes.map(box => box[i + 1]))];
  const [minX, maxX] = span(0), [minZ, maxZ] = span(2), target = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  // How far the corners reach across the screen from `distance` along the slope; null while one is behind the camera.
  const extent = distance => {
    cam.position.copy(target).addScaledVector(SLOPE, distance); cam.lookAt(target); cam.updateMatrixWorld();
    const e = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity };
    for (const corner of corners) {
      p.copy(corner).project(cam); if (p.z < -1 || p.z > 1) return null;
      e.left = Math.min(e.left, p.x); e.right = Math.max(e.right, p.x); e.bottom = Math.min(e.bottom, p.y); e.top = Math.max(e.top, p.y);
    }
    return e;
  };
  const closest = () => {
    let near = 0.5, far = 300;
    for (let i = 0; i < 30; i++) { const mid = (near + far) / 2, e = extent(mid); if (e && Math.max(e.right, -e.left, e.top, -e.bottom) <= 1 - MARGIN) far = mid; else near = mid; }
    return far;
  };
  let distance = closest();
  // Nearer things spread wider, and the back row's heads reach further up the screen than the front row's chairs reach
  // down: slide the target to even out the gaps, then come closer into the room that makes.
  for (let pass = 0; pass < 8; pass++) {
    const e = extent(distance), half = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * distance, up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    target.x += (e.left + e.right) / 2 * half * aspect; target.addScaledVector(up, (e.top + e.bottom) / 2 * half);
    distance = closest();
  }
  // The slide lifted the target off the floor: take the floor point on the same line of sight instead.
  const from = target.addScaledVector(SLOPE, distance), back = from.y / SLOPE.y;
  return { look: from.clone().addScaledVector(SLOPE, -back).setY(0), distance: back };
}

export class Overview {
  // `container` gets the wheel (the speech bubbles sit over the canvas); drags start on the canvas.
  constructor(container, canvas, camera) {
    this.canvas = canvas; this.camera = camera; this.fov = camera.fov; this.on = false;
    this.boxes = [[0, 10, 0, 10]]; this.room = { width: 10, depth: 10 };
    this.view = null; // where you've taken it; null while it's the fitted view
    this.pointers = new Map(); this.held = new Map();
    this.from = new THREE.Vector3(); this.look = new THREE.Vector3(); this.cam = new THREE.PerspectiveCamera(); this.ray = new THREE.Raycaster();
    this.disposers = [];
    const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); this.disposers.push(() => target.removeEventListener(type, fn, options)); };
    // One finger (or the mouse) drags the floor along; two also pinch.
    listen(canvas, 'pointerdown', event => { if (this.on && event.button === 0) this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); });
    listen(canvas, 'pointermove', event => {
      const pointer = this.pointers.get(event.pointerId); if (!pointer) return;
      const before = this.gesture(); pointer.x = event.clientX; pointer.y = event.clientY; const after = this.gesture();
      this.pan(before, after); if (before.spread) this.zoom(after, before.spread / after.spread);
    });
    const up = event => this.pointers.delete(event.pointerId);
    listen(canvas, 'pointerup', up); listen(canvas, 'pointercancel', up);
    // Trackpad pinches arrive as wheel events with ctrlKey and small steps.
    listen(container, 'wheel', event => {
      if (!this.on) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1;
      this.zoom({ x: event.clientX, y: event.clientY }, Math.exp(event.deltaY * unit * (event.ctrlKey ? 0.01 : 0.0015)));
    }, { passive: false });
    listen(document, 'keydown', event => {
      if (!this.on || !officeHasKeys(event) || !(PAN[event.code] || ZOOM[event.key])) return;
      event.preventDefault(); this.held.set(event.code, ZOOM[event.key] || 0);
    });
    listen(document, 'keyup', event => this.held.delete(event.code));
    listen(window, 'blur', () => this.held.clear());
  }

  // Each pod with its chairs (not the box round them all, which takes in empty corners), or the whole room while it's empty.
  setLayout({ pods, room }) {
    this.room = room;
    this.boxes = pods.length ? pods.map(pod => [pod.x - pod.width / 2 - 0.6, pod.x + pod.width / 2 + 0.6, pod.z - pod.depth / 2 - 0.9, pod.z + pod.depth / 2 + 0.9]) : [[0, room.width, 0, room.depth]];
  }
  // Opening starts from the fitted view; closing keeps yours so the camera leaves from where it is.
  setActive(on) { this.on = on; if (on) this.view = null; this.pointers.clear(); this.held.clear(); }
  get dragging() { return this.pointers.size > 0; }

  // Worked out again only when the boxes or the screen's shape change.
  fitted() {
    const key = `${this.boxes.join(';')},${this.camera.aspect.toFixed(3)}`;
    if (this.fit?.key !== key) this.fit = { key, ...fitOverview(this.boxes, this.fov, this.camera.aspect) };
    return this.fit;
  }
  // Where the camera goes: { from, look }, reused between calls.
  pose() {
    const { look, distance } = this.view || this.fitted();
    this.look.copy(look); this.from.copy(look).addScaledVector(SLOPE, distance);
    return this;
  }

  // Held keys pan at a pace that suits how far away you are, and zoom about the middle of the screen.
  update(dt) {
    if (!this.on || !this.held.size) return;
    const step = new THREE.Vector3(); let zoom = 0;
    for (const [code, z] of this.held) { const pan = PAN[code]; if (pan) { step.x += pan[0]; step.z += pan[1]; } else zoom += z; }
    if (step.lengthSq()) this.move(step.normalize().multiplyScalar(this.edit().distance * KEY_PAN * dt));
    if (zoom) this.zoom(null, Math.exp(zoom * KEY_ZOOM * dt));
  }

  edit() { const { look, distance } = this.fitted(); return this.view ||= { look: look.clone(), distance }; }
  // The floor under one screen point moves to sit under the other.
  pan(a, b) { const p = this.ground(a), q = this.ground(b); if (p && q) this.move(p.sub(q)); }
  move(delta) {
    const look = this.edit().look.add(delta);
    look.x = THREE.MathUtils.clamp(look.x, 0, this.room.width); look.z = THREE.MathUtils.clamp(look.z, 0, this.room.depth);
  }
  // Closer or further by `factor`, keeping the floor under `at` (the middle of the screen when null) where it is.
  zoom(at, factor) {
    const view = this.edit(), distance = THREE.MathUtils.clamp(view.distance * factor, CLOSEST, Math.max(CLOSEST, this.fitted().distance * FURTHEST));
    const p = at && this.ground(at);
    if (p) this.move(view.look.clone().sub(p).multiplyScalar(distance / view.distance - 1));
    view.distance = distance;
  }
  // The middle of the pointers and, with two or more, how far apart the first two are.
  gesture() {
    const [a, b] = this.pointers.values();
    return b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spread: Math.hypot(a.x - b.x, a.y - b.y) || 1 } : { x: a.x, y: a.y, spread: 0 };
  }
  // The floor point under a screen point, from where the overview is now.
  ground({ x, y }) {
    const { from, look } = this.pose(), r = this.canvas.getBoundingClientRect(), cam = this.cam;
    cam.fov = this.fov; cam.aspect = this.camera.aspect; cam.updateProjectionMatrix();
    cam.position.copy(from); cam.lookAt(look); cam.updateMatrixWorld();
    this.ray.setFromCamera(new THREE.Vector2((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1), cam);
    const { origin, direction } = this.ray.ray;
    return direction.y < -0.01 ? origin.clone().addScaledVector(direction, -origin.y / direction.y) : null;
  }

  dispose() { for (const fn of this.disposers) fn(); }
}
