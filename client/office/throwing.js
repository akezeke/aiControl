// One way of throwing, for the office's loose things and whatever else you can have in hand: hold to charge, let go to throw, in
// a hand built like the one that throws darts. No document or window here, so what a throw does can be tested in Node.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STEP, makeBody, simulate, stopShort } from './flight.js';
import { toonMaterial } from './toon.js';

const HOLD = new THREE.Vector3(-0.3, -0.27, -0.8); // the palm, in front of the camera
const SIDE = Math.tan(THREE.MathUtils.degToRad(70 / 2)), CLEAR = 0.05; // the camera's fov (office.js) and what's round the thing, a thumb and a gap
// Where the palm is at this much charge: back towards you and out to the left, as far left as the picture's narrow sides still show all of what's `radius` wide and the thumb round it.
export const palmAt = (out, aspect, radius, charge = 0) => {
  const z = HOLD.z + 0.16 * charge, room = -z * SIDE * aspect - radius - CLEAR;
  return out.set(-Math.min(-HOLD.x + 0.04 * charge, Math.max(0, room)), HOLD.y, z);
};
const FINGERS = 0.016; // the fist's radius, before it's scaled to what it holds

// Full at FULL_CHARGE seconds, and it holds there. Even a tap throws: a quarter of what the thing can do.
export const FULL_CHARGE = 1.5;
export const chargeAt = held => Math.max(0, Math.min(1, held / FULL_CHARGE));
export const throwSpeed = (kind, charge) => kind.throw * (0.25 + 0.75 * charge);
// It leaves on the line you look along, so it goes where you look, on top of how you're moving, with a little lift.
export function launch(kind, charge, camera, direction, walk) {
  const pos = camera.position.clone().addScaledVector(direction, 0.5), vel = direction.clone().multiplyScalar(throwSpeed(kind, charge)).add(walk);
  vel.y += 1.2;
  return { pos, vel };
}

// A throw flies from just ahead of your eyes, but it's seen to leave your hand: drawn `offset` (hand less launch) away from where it
// really is, by less and less over its first BLEND seconds. Only to look at, and never past a wall: what's between stops it (a hand
// poking through the wall you're facing has the throw start this side of it). The hands are drawn in the scene, by the same camera, so
// a palm's world position is where it's seen.
export const BLEND = 0.2;
export const blendLeft = t => { const u = THREE.MathUtils.clamp(t / BLEND, 0, 1); return 1 - u * u * (3 - 2 * u); };
export const drawnAt = (out, pos, offset, t, kind, colliders) => t >= BLEND ? out.copy(pos) : stopShort(pos, out.copy(pos).addScaledVector(offset, blendLeft(t)), kind, colliders);

// A charged throw's way to the first thing it hits and a bit over a metre on, so you see the angle it leaves at, as dots: places it really passes,
// evenly apart in the world from where it starts, so the gaps shrink into the distance; a longer way to the hit than DOTS can do opens the gaps
// up to it, and a few are kept for the stretch, always GAP apart. And how far into the flight each is. The stretch ends early at a second hit;
// what's after that stays unshown: that's the puzzle. A soft landing just stops, and has next to no stretch. Thrown from `eye`, like the throw
// (stopShort): so a wall right in front of you shows. None closer to `eye` than CLOSE: coming back off that wall, one would be a big disc.
const ARC_TIME = 2.5, AFTER = 1.2, GAP = 0.3, DOTS = 24, STRETCH = 4, CLOSE = 0.3, SAMPLE = 4 * STEP; // simulate's path has every fourth step
const AFTER_TIME = 0.9; // Only to bound it: falling, the stretch is gone by then.
const first = () => true, LIFT = 0.003, SIGHT = { radius: 1e-3, low: 1e-3 };
// A piece of flight's corners and times: the samples from before its hit (the step that hits goes on after it, so not that one's), then the hit.
function addFlight(corners, clock, begun, { path, contacts: [hit] }) {
  const samples = hit ? Math.floor((hit.time / STEP - 0.5) / 4) : path.length / 3;
  for (let i = 0; i < samples * 3; i += 3) { corners.push(path[i], path[i + 1], path[i + 2]); clock.push(begun + (i / 3 + 1) * SAMPLE); }
  if (hit) { corners.push(...hit.pos); clock.push(begun + hit.time); }
}
function arcWay(kind, launched, world, eye) {
  const start = stopShort(eye, launched.pos.clone(), kind, world.colliders), body = makeBody(kind, start, launched.vel), corners = [start.x, start.y, start.z], clock = [0];
  const flight = simulate(body, world, { maxTime: ARC_TIME, stop: first }), [hit, next] = flight.contacts;
  addFlight(corners, clock, 0, flight);
  const upTo = corners.length;
  if (next) { corners.push(...next.pos); clock.push(next.time); } // a second hit in the same step
  else if (hit && !body.rest) {
    corners.push(body.pos.x, body.pos.y, body.pos.z); clock.push(hit.time);
    let left = AFTER; lastPos.copy(body.pos);
    const until = b => { left -= lastPos.distanceTo(b.pos); lastPos.copy(b.pos); return left <= 0; }, after = simulate(body, world, { maxTime: AFTER_TIME, stop: first, until });
    addFlight(corners, clock, hit.time, after);
    if (!after.contacts.length) { corners.push(body.pos.x, body.pos.y, body.pos.z); clock.push(hit.time + after.time); }
  }
  let length = 0, run = 0;
  for (let i = 3; i < corners.length; i += 3) { length += Math.hypot(corners[i] - corners[i - 3], corners[i + 1] - corners[i - 2], corners[i + 2] - corners[i - 1]); if (i < upTo) run = length; }
  const gap = Math.max(GAP, run / (DOTS - 1 - (length > run ? STRETCH : 0))), points = [], times = [];
  const put = (x, y, z, t) => { if (Math.hypot(x - eye.x, y - eye.y, z - eye.z) < CLOSE) return; points.push(x, y, z); times.push(t); };
  const nextMark = m => m + gap <= run ? m + gap : m > run || gap === GAP ? m + GAP : run + GAP;
  put(start.x, start.y, start.z, 0);
  let along = 0, mark = gap;
  for (let i = 3; i < corners.length; i += 3) {
    const piece = Math.hypot(corners[i] - corners[i - 3], corners[i + 1] - corners[i - 2], corners[i + 2] - corners[i - 1]);
    for (; mark <= along + piece && times.length < DOTS; mark = nextMark(mark)) {
      const u = (mark - along) / piece;
      put(corners[i - 3] + (corners[i] - corners[i - 3]) * u, corners[i - 2] + (corners[i + 1] - corners[i - 2]) * u, corners[i - 1] + (corners[i + 2] - corners[i - 1]) * u, clock[i / 3 - 1] + (clock[i / 3] - clock[i / 3 - 1]) * u);
    }
    along += piece;
  }
  return { start, points: Float32Array.from(points), times, ring: hit ? ringAt(hit, kind, world, eye) : null };
}
export const arcPoints = (kind, launched, world, eye) => arcWay(kind, launched, world, eye).points;

// Where the ring lies: on the surface under the thing's middle, as far from it as flight.js keeps it. None if you couldn't see that spot from `eye`.
function ringAt({ pos, normal }, { low, radius }, world, eye) {
  const n = new THREE.Vector3().fromArray(normal), at = new THREE.Vector3().fromArray(pos).addScaledVector(n, LIFT - (n.y > 0.7 ? low : radius));
  return stopShort(eye, sight.copy(at), SIGHT, world.colliders).equals(at) ? { at, n } : null;
}

// Small balls of one size in the world, so they shrink with distance and go behind what's in front. One flat unlit colour that reads
// on a white wall and in the dark. One draw, a new way is worked out only when the throw changed, and it's drawn again only if that or the
// hand did. The ring is the mesh's child, so it comes and goes with the dots. Nothing's listening to the ray.
const DOT_RADIUS = 0.011, COLOUR = '#14b8c4', RING = [0.028, 0.047], FACING = new THREE.Vector3(0, 0, 1);
let dotShape, ringShape;
const placed = new THREE.Matrix4(), near = new THREE.Vector3(), real = new THREE.Vector3(), offset = new THREE.Vector3(), sight = new THREE.Vector3(), lastPos = new THREE.Vector3(), SAME_HAND = 1e-3 ** 2, deaf = () => {};
export function createArc() {
  dotShape ??= new THREE.IcosahedronGeometry(DOT_RADIUS, 1);
  ringShape ??= new THREE.RingGeometry(RING[0], RING[1], 28);
  const mesh = new THREE.InstancedMesh(dotShape, new THREE.MeshBasicMaterial({ color: COLOUR, toneMapped: false }), DOTS);
  mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false; mesh.raycast = deaf; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const ring = new THREE.Mesh(ringShape, new THREE.MeshBasicMaterial({ color: COLOUR, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  ring.visible = false; ring.raycast = deaf; mesh.add(ring);
  const was = { kind: null, pos: new THREE.Vector3(), vel: new THREE.Vector3(), palm: new THREE.Vector3() };
  let way = null;
  const arc = {
    mesh, ring, points: new Float32Array(0), times: [],
    // `palm`: where the hand is, in the same frame as the world.
    show(kind, launched, world, eye, palm) {
      mesh.visible = true;
      const same = was.kind === kind && was.pos.equals(launched.pos) && was.vel.equals(launched.vel);
      if (same && was.palm.distanceToSquared(palm) < SAME_HAND) return;
      was.palm.copy(palm);
      if (!same) {
        was.kind = kind; was.pos.copy(launched.pos); was.vel.copy(launched.vel); way = arcWay(kind, launched, world, eye);
        ring.visible = !!way.ring;
        if (way.ring) { ring.position.copy(way.ring.at); ring.quaternion.setFromUnitVectors(FACING, way.ring.n); }
      }
      offset.subVectors(palm, way.start); arc.times = []; arc.points = way.points.slice(); mesh.count = 0;
      for (let i = 0; i < way.times.length; i++) {
        drawnAt(near, real.fromArray(way.points, i * 3), offset, way.times[i], kind, world.colliders);
        if (near.distanceTo(eye) < CLOSE) continue; // drawn on its way from the hand, it can come closer than it really is
        near.toArray(arc.points, mesh.count * 3); arc.times.push(way.times[i]); mesh.setMatrixAt(mesh.count++, placed.makeTranslation(near));
      }
      arc.points = arc.points.subarray(0, mesh.count * 3);
      mesh.instanceMatrix.needsUpdate = true;
    },
    hide() { mesh.visible = false; was.kind = null; },
  };
  return arc;
}

// `t` in seconds. A release with no press (or after a cancel) throws nothing. `hide`: a press has ended, either way.
export function createCharge(hide = () => {}) {
  let from = null;
  return {
    get active() { return from !== null; },
    press(t) { from ??= t; },
    level(t) { return from === null ? 0 : chargeAt(t - from); },
    release(t) { if (from === null) return null; const charge = chargeAt(t - from); from = null; hide(); return charge; },
    cancel() { if (from === null) return; from = null; hide(); },
  };
}

// On touch, the button that throws. Pressed it charges and up it throws, along the view's centre; slid SLIDE_OFF px past its edge it shows ✕, and comes up calling it off, as a lost pointer does. Its finger's its own: others on it, or on the canvas, do something else.
export const SLIDE_OFF = 40;
export function createThrowButton(el, { press, release, cancel }) {
  let id = null;
  const done = () => { el.classList.toggle('held', false); el.classList.toggle('off', false); el.textContent = 'Throw'; if (id !== null && el.hasPointerCapture(id)) el.releasePointerCapture(id); id = null; };
  const ours = fn => event => { if (event.pointerId === id) fn(event); };
  el.addEventListener('pointerdown', event => { if (id !== null || !press()) return; id = event.pointerId; el.setPointerCapture(id); el.classList.toggle('held', true); });
  el.addEventListener('pointermove', ours(({ clientX, clientY }) => {
    const { left, top, width, height } = el.getBoundingClientRect(), off = Math.hypot(clientX - left - width / 2, clientY - top - height / 2) > width / 2 + SLIDE_OFF;
    if (off !== el.classList.contains('off')) { el.classList.toggle('off', off); el.textContent = off ? '✕' : 'Throw'; }
  }));
  el.addEventListener('pointerup', ours(() => { const off = el.classList.contains('off'); done(); if (off) cancel(); else release(); }));
  for (const lost of ['pointercancel', 'lostpointercapture']) el.addEventListener(lost, ours(() => { done(); cancel(); }));
  el.addEventListener('contextmenu', event => event.preventDefault());
  return { drop: done };
}

// The power gauge's colour at a charge, 0 to 1: calm, then warm, then hot.
const HEAT = [[0.18, 0.72, 0.8], [1, 0.76, 0.2], [1, 0.2, 0.1]], MIDDLE = 0.55;
export function gaugeColour(level) {
  const u = THREE.MathUtils.clamp(level, 0, 1), side = u < MIDDLE ? 0 : 1, t = side ? (u - MIDDLE) / (1 - MIDDLE) : u / MIDDLE;
  return `rgb(${HEAT[side].map((c, i) => Math.round((c + (HEAT[side + 1][i] - c) * t) * 255)).join(',')})`;
}
// Where its middle goes, in the container: round where the throw aims, kept on screen.
export const GAUGE_SIZE = 76;
export function gaugeAt(x, y, width, height) {
  const out = GAUGE_SIZE / 2;
  return { x: THREE.MathUtils.clamp(x, out, width - out), y: THREE.MathUtils.clamp(y, out, height - out) };
}

// The gauge on screen: how far a throw's charged, 0 to 1, and the screen point it aims at; null hides it. Once a frame while it's up: it only
// writes when the level or the point moved, and only reads the container's place when the point did.
export function createGauge(container, meter, fill) {
  let charged = null, gaugeX = null, gaugeY = null;
  return (level, at) => {
    if (level === null) { if (charged !== null) { charged = gaugeX = gaugeY = null; meter.classList.remove('shown', 'full'); } return; }
    if (charged === null) meter.classList.add('shown');
    const step = Math.round(level * 100);
    if (step !== charged) { charged = step; fill.setAttribute('stroke-dasharray', `${step / 100} 2`); fill.style.stroke = gaugeColour(step / 100); meter.classList.toggle('full', step === 100); }
    if (at.clientX === gaugeX && at.clientY === gaugeY) return;
    gaugeX = at.clientX; gaugeY = at.clientY;
    const box = container.getBoundingClientRect(), { x, y } = gaugeAt(gaugeX - box.left, gaugeY - box.top, box.width, box.height);
    meter.style.transform = `translate(${x}px, ${y}px)`;
  };
}

// The arm and grip, with `fist` where the fist is on the arm: the arm runs off the bottom left, like the mug's (camera.js).
export function handModel() {
  const arm = new THREE.Group(), grip = new THREE.Group(), ink = toonMaterial('#26252b');
  arm.add(grip); grip.rotation.set(0.3, -0.5, 0.2);
  const fist = new THREE.Vector3(0.006, -0.022, 0.068);
  grip.add(new THREE.Mesh(new THREE.SphereGeometry(FINGERS, 14, 10).scale(1, 1.1, 1.2).translate(fist.x, fist.y, fist.z), ink));
  for (const z of [0.044, 0.056]) grip.add(new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.0042, 6, 12, Math.PI * 1.15).rotateZ(-0.35).translate(0, 0, z), ink));
  grip.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.0045, 0.022, 4, 8).rotateX(Math.PI / 2).rotateY(0.4).translate(-0.006, -0.007, 0.06), ink));
  grip.updateMatrix(); fist.applyMatrix4(grip.matrix); const wrist = new THREE.Vector3(0.006, -0.03, 0.08).applyMatrix4(grip.matrix);
  arm.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(wrist, new THREE.Vector3(-0.04, -0.12, 0.12), new THREE.Vector3(-0.14, -0.3, 0.3)), 16, 0.012, 8), ink));
  arm.add(new THREE.Mesh(new THREE.SphereGeometry(0.0125, 12, 8).translate(wrist.x, wrist.y, wrist.z), ink));
  return { arm, grip, fist };
}

// The hand round something `radius` wide, reaching `low` below its middle (which is at the origin): as chunky to look at as the mug's hand (camera.js), for
// being further off. All one draw, in the mug's ink, so a finger only shows by its outline: each ends at its own place up the right, a bump apiece. They're arcs round the
// thing, seen across it, from the palm under it, their ends turned in over its edge towards you. The thumb's a short one the other way up the left, hugging it too, so it never stands up by itself. The arm runs off the bottom left, the mug's mirrored.
const SEEN = 0.8 / 0.62, TUBE = 0.0105 * SEEN, THUMB = 0.011 * SEEN, ARM = 0.02 * SEEN * 0.9, ANGLE = Math.PI / 180;
const PALM_AT = -115 * ANGLE, TIP = 25 * ANGLE, FINGER_LONG = 0.27, THUMB_LONG = 0.17, FINGERS_Z = [2.4, 1.2, 0].map(z => z * TUBE), WRIST = new THREE.Vector3(-0.027, -0.024, 0.024);
const curled = (ax, ay, z, over, from, to, tube) => {
  const at = u => { const t = from + (to - from) * u, turn = Math.max(0, (u - 0.5) * 2) ** 2, near = 1 - 0.12 * turn; return new THREE.Vector3(ax * Math.cos(t) * near, ay * Math.sin(t) * near, z + over * turn); };
  const end = at(1);
  return [new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => at(i / 8))), 14, tube, 8), new THREE.SphereGeometry(tube, 8, 6).translate(end.x, end.y, end.z)];
};
// Every tube starts inside the palm, worked out from where the palm is, and the arm's open end has a ball over it there, like the mug's: they can't part at any size.
export function handParts(radius, low) {
  const across = radius + TUBE * 0.7, under = low + TUBE * 0.7, over = radius * 0.5, top = Math.min(TIP, PALM_AT + FINGER_LONG / across), apart = Math.min(32 * ANGLE, 2.1 * TUBE / across); // each a finger's width below the last
  const fingers = FINGERS_Z.map((z, i) => curled(across, under, z, over, PALM_AT, top - i * apart, TUBE));
  const thumb = curled(across + (THUMB - TUBE) * 0.7, under, TUBE * 2, over, PALM_AT, Math.max(-210 * ANGLE, PALM_AT - THUMB_LONG / across), THUMB);
  const at = new THREE.Vector3(across * Math.cos(PALM_AT), under * Math.sin(PALM_AT) - 0.022, TUBE * 2), wrist = at.clone().add(WRIST);
  const here = HOLD.clone().negate(), arm = new THREE.QuadraticBezierCurve3(wrist, new THREE.Vector3(-0.42, -0.34, -0.55).add(here), new THREE.Vector3(-0.62, -0.75, -0.25).add(here));
  return {
    palm: new THREE.SphereGeometry(0.038 * SEEN, 14, 10).scale(1.1, 0.8, 1.15).rotateZ(0.5).translate(at.x, at.y, at.z),
    joint: new THREE.SphereGeometry(ARM * 1.05, 12, 8).translate(wrist.x, wrist.y, wrist.z),
    tubes: [new THREE.TubeGeometry(arm, 16, ARM, 8), ...[...fingers, thumb].map(([tube]) => tube)], tips: [...fingers, thumb].map(([, tip]) => tip),
  };
}
function gripping(radius, low) {
  const { palm, joint, tubes, tips } = handParts(radius, low), parts = [palm, joint, ...tubes, ...tips];
  const whole = mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g)); parts.forEach(g => g.dispose());
  return whole;
}

// What you're holding sits at `palm`, the hand round it, fitted to it. A real mesh goes with the hand, and clicks go through it
// till it's let go of. A thing that isn't one (null: an instance of a mesh of balls) is kept at `palm` by its owner.
// `hands.userData.full`: you don't sip from your mug with it.
export function createHand(hands) {
  const palm = new THREE.Group(), fits = new Map(), body = new THREE.Mesh(new THREE.BufferGeometry(), toonMaterial('#26252b'));
  palm.position.copy(HOLD); palm.visible = false; palm.add(body); hands.add(palm);
  const ignored = () => {}, ignore = node => { if (!Object.hasOwn(node, 'raycast')) node.raycast = ignored; }, notice = node => { if (node.raycast === ignored) delete node.raycast; };
  palm.traverse(ignore);
  let held = null, aspect = Infinity, radius = 0, pulled = 0;
  const place = () => palmAt(palm.position, aspect, radius, pulled);
  const letGo = () => { if (!held) return; held.traverse(notice); held.removeFromParent(); held = null; };
  const hand = {
    palm,
    // `low`: how far it reaches below its middle, for what's flatter than it's wide.
    hold(mesh, fitted, low = fitted) {
      const key = `${fitted}:${low}`; if (!fits.has(key)) fits.set(key, gripping(fitted, low));
      body.geometry = fits.get(key);
      letGo(); held = mesh; if (mesh) { palm.add(mesh); mesh.position.set(0, 0, 0); mesh.traverse(ignore); }
      radius = fitted; place(); palm.visible = hands.userData.full = true;
    },
    // Back towards you and tipped, the whole way at a full charge.
    pull(charge) { pulled = charge; place(); palm.rotation.x = 0.35 * charge; },
    // The picture's width over its height: the throws leave from the eye, so all this moves is what they're seen to leave from.
    fit(ratio) { aspect = ratio; place(); },
    free() { letGo(); palm.visible = hands.userData.full = false; hand.pull(0); },
    // Only what's on `body` when the scene goes is seen by its traversal: the other fits are kept for next time.
    dispose() { for (const fit of fits.values()) fit.dispose(); fits.clear(); body.geometry.dispose(); },
  };
  return hand;
}
