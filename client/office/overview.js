// The overview (Tab): the desks from the front and above, as close as fits them, then wherever you take it: drag or
// WASD/arrows to pan, scroll, pinch or +/- to zoom; a drag let go of carries on. It starts from the fitted view each time it opens.
import * as THREE from 'three';
import { officeHasKeys } from './player.js';

// Looking down at 55°, with room for the heads and bubbles over the desks and a margin round the screen edge.
// Zoom goes from 3 m off the floor out to 1.6 times the fitted distance.
export const PITCH = 55 * Math.PI / 180; const HEADS = 2.2, MARGIN = 0.07, CLOSEST = 3, FURTHEST = 1.6, KEY_PAN = 0.9, KEY_ZOOM = 1.5, GLIDE = 0.7;
// The view shown trails where it's headed by about EASE seconds, so uneven touch events come out smooth; a drag let go of
// keeps its pace over the last TRAIL seconds, losing COAST of it a second (when it's quicker than a slow drag).
const EASE = 0.05, TRAIL = 0.1, COAST = 4, FLICK = 0.3;
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
    this.grip = null; this.trail = []; this.fling = null; this.shown = null; // the drag as of last frame, its recent path, a let-go drag's pace, the view shown
    this.from = new THREE.Vector3(); this.look = new THREE.Vector3(); this.aim = new THREE.Vector3(); this.cam = new THREE.PerspectiveCamera(); this.ray = new THREE.Raycaster();
    this.disposers = [];
    const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); this.disposers.push(() => target.removeEventListener(type, fn, options)); };
    // One finger (or the mouse) drags the floor along; two also pinch. Moves only note where the pointer is: the view
    // follows once a frame (drag), however often they come.
    listen(canvas, 'pointerdown', event => {
      if (!this.on || event.button !== 0) return;
      if (this.pointers.size) this.drag(); else this.hold();
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); this.regrip();
    });
    listen(canvas, 'pointermove', event => { const pointer = this.pointers.get(event.pointerId); if (pointer) { pointer.x = event.clientX; pointer.y = event.clientY; } });
    const up = event => {
      if (!this.pointers.has(event.pointerId)) return;
      this.drag(); this.pointers.delete(event.pointerId);
      if (this.pointers.size) this.regrip(); else this.letGo(event.type === 'pointerup');
    };
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
  // The sidebar's pick (office.pick): fit these desks instead of the pods until it closes, gliding over if it's open.
  frame(boxes, glide) {
    const was = glide && this.on && this.pose(), start = was && { look: was.look.clone(), distance: was.from.distanceTo(was.look), t: 0 };
    // Never closer than a few desks' worth: one desk alone would put its pod's sign in your face.
    const mid = i => (Math.min(...boxes.map(box => box[i])) + Math.max(...boxes.map(box => box[i + 1]))) / 2, x = mid(0), z = mid(2);
    this.picked = boxes.length ? [...boxes, [x - 3.5, x + 3.5, z - 2.5, z + 2.5]] : null; this.view = null; this.glide = start || null; this.fling = null;
  }
  // Opening starts from the fitted view; closing keeps the one shown so the camera leaves from where it is.
  setActive(on) {
    if (!on && this.picked) { this.edit(); this.picked = null; }
    this.on = on; if (on) this.view = this.shown = null;
    this.glide = this.fling = this.grip = null; this.trail = []; this.pointers.clear(); this.held.clear();
  }
  get dragging() { return this.pointers.size > 0; }

  // Worked out again only when the boxes or the screen's shape change.
  fitted() {
    const boxes = this.picked || this.boxes, key = `${boxes.join(';')},${this.camera.aspect.toFixed(3)}`;
    if (this.fit?.key !== key) this.fit = { key, ...fitOverview(boxes, this.fov, this.camera.aspect) };
    return this.fit;
  }
  // Where the view's headed: yours or the fitted one, part way there while gliding over. Its `look` is reused.
  goal() {
    const { look, distance } = this.view || this.fitted(), glide = this.glide, k = glide && (1 - Math.cos(Math.PI * glide.t)) / 2;
    if (glide) this.aim.lerpVectors(glide.look, look, k); else this.aim.copy(look);
    return { look: this.aim, distance: glide ? glide.distance + (distance - glide.distance) * k : distance };
  }
  // Where the camera is: { from, look }, reused between calls.
  pose() {
    const { look, distance } = this.shown || this.goal();
    this.look.copy(look); this.from.copy(look).addScaledVector(SLOPE, distance);
    return this;
  }

  // Drags and held keys move where it's headed, then the view shown eases after it (straight there with reduced motion).
  // Keys pan at a pace that suits how far away you are, and zoom about the middle of the screen.
  update(dt, instant = false) {
    if (this.glide && (this.glide.t += dt / GLIDE) >= 1) this.glide = null;
    if (!this.on) return;
    if (instant) this.fling = null;
    this.drag(); this.coast(dt);
    if (this.held.size) {
      const step = new THREE.Vector3(); let zoom = 0;
      for (const [code, z] of this.held) { const pan = PAN[code]; if (pan) { step.x += pan[0]; step.z += pan[1]; } else zoom += z; }
      if (step.lengthSq()) this.move(step.normalize().multiplyScalar(this.edit().distance * KEY_PAN * dt));
      if (zoom) this.zoom(null, Math.exp(zoom * KEY_ZOOM * dt));
    }
    const goal = this.goal(), k = instant || !this.shown ? 1 : 1 - Math.exp(-dt / EASE);
    this.shown ??= { look: new THREE.Vector3(), distance: 0 };
    this.shown.look.lerp(goal.look, k); this.shown.distance += (goal.distance - this.shown.distance) * k;
  }
  // The floor follows the pointers from where they were last frame (or put down); two also pinch.
  drag() {
    const grip = this.grip; if (!grip) return;
    const now = this.gesture(); this.pan(grip, now); if (grip.spread) this.zoom(now, grip.spread / now.spread);
    this.grip = { ...now, count: grip.count }; this.track();
  }
  // A finger put down or lifted starts the drag afresh from where they all are.
  regrip() { this.grip = { ...this.gesture(), count: this.pointers.size }; this.trail = []; this.track(); }
  // Where it's headed, kept back to the newest point at least TRAIL old, for the pace a drag's let go at.
  track() {
    const t = performance.now() / 1000, { look } = this.goal();
    this.trail.push({ t, x: look.x, z: look.z }); while (this.trail.length > 2 && this.trail[1].t <= t - TRAIL) this.trail.shift();
  }
  // Taking hold stops a fling and keeps the view where it's shown, so the floor under the finger is the floor you see.
  hold() {
    this.fling = this.grip = null; this.trail = [];
    const goal = this.goal(), shown = this.shown;
    if (shown && (shown.look.distanceToSquared(goal.look) > 1e-6 || Math.abs(shown.distance - goal.distance) > 1e-3)) {
      const view = this.edit(); view.look.copy(shown.look); view.distance = shown.distance;
    }
  }
  // Let go of mid-drag (one finger or the mouse, not a pinch), the floor carries on at the pace it had.
  letGo(released) {
    const t = performance.now() / 1000, first = this.trail[0], { look, distance } = this.goal();
    if (released && this.grip?.count === 1 && first && t - first.t > 0.02) {
      const pace = new THREE.Vector3(look.x - first.x, 0, look.z - first.z).divideScalar(t - first.t);
      if (pace.length() > distance * FLICK) this.fling = pace.clampLength(0, distance * 5);
    }
    this.grip = null; this.trail = [];
  }
  // A fling slows to a stop, and stops along a wall it runs into.
  coast(dt) {
    if (!this.fling || this.pointers.size) return;
    const look = this.edit().look, was = look.clone(), step = this.fling.clone().multiplyScalar(dt);
    this.move(step);
    if (Math.abs(look.x - was.x) < Math.abs(step.x) - 1e-9) this.fling.x = 0;
    if (Math.abs(look.z - was.z) < Math.abs(step.z) - 1e-9) this.fling.z = 0;
    this.fling.multiplyScalar(Math.exp(-COAST * dt));
    if (this.fling.length() < this.view.distance * 0.02) this.fling = null;
  }

  // Taking hold mid-glide keeps it where it's got to.
  edit() {
    if (this.glide) { const { look, distance } = this.goal(); this.view = { look: look.clone(), distance }; this.glide = null; }
    const { look, distance } = this.fitted(); return this.view ||= { look: look.clone(), distance };
  }
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
  // The floor point under a screen point, from where the overview's headed.
  ground({ x, y }) {
    const { look, distance } = this.goal(), r = this.canvas.getBoundingClientRect(), cam = this.cam;
    cam.fov = this.fov; cam.aspect = this.camera.aspect; cam.updateProjectionMatrix();
    cam.position.copy(look).addScaledVector(SLOPE, distance); cam.lookAt(look); cam.updateMatrixWorld();
    this.ray.setFromCamera(new THREE.Vector2((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1), cam);
    const { origin, direction } = this.ray.ray;
    return direction.y < -0.01 ? origin.clone().addScaledVector(direction, -origin.y / direction.y) : null;
  }

  dispose() { for (const fn of this.disposers) fn(); }
}
