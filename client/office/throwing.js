// One way of throwing, for the office's loose things and whatever else you can have in hand: hold to charge, let go to throw, in
// a hand built like the one that throws darts. No document or window here, so what a throw does can be tested in Node.
import * as THREE from 'three';
import { STEP, makeBody, simulate, stopShort } from './flight.js';
import { toonMaterial } from './toon.js';

const HOLD = new THREE.Vector3(-0.3, -0.27, -0.8); // the palm, in front of the camera
const FINGERS = 0.016; // the fist's radius, before it's scaled to what it holds

// Full at a second, and it holds there. Even a tap throws: a quarter of what the thing can do.
export const chargeAt = held => Math.max(0, Math.min(1, held));
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
// evenly apart in the world from where it starts, so the gaps shrink into the distance; a longer way than DOTS can do opens the gaps. And how far
// into the flight each is. The stretch ends early at a second hit; what's after that stays unshown: that's the puzzle. A soft landing just stops,
// and has next to no stretch. Thrown from `eye`, like the throw (stopShort): so a wall right in front of you shows.
const ARC_TIME = 2.5, AFTER = 1.2, GAP = 0.3, DOTS = 24, SAMPLE = 4 * STEP; // simulate's path has every fourth step
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
  if (next) { corners.push(...next.pos); clock.push(next.time); } // a second hit in the same step
  else if (hit && !body.rest) {
    corners.push(body.pos.x, body.pos.y, body.pos.z); clock.push(hit.time);
    let left = AFTER; lastPos.copy(body.pos);
    const until = b => { left -= lastPos.distanceTo(b.pos); lastPos.copy(b.pos); return left <= 0; }, after = simulate(body, world, { maxTime: AFTER_TIME, stop: first, until });
    addFlight(corners, clock, hit.time, after);
    if (!after.contacts.length) { corners.push(body.pos.x, body.pos.y, body.pos.z); clock.push(hit.time + after.time); }
  }
  let length = 0;
  for (let i = 3; i < corners.length; i += 3) length += Math.hypot(corners[i] - corners[i - 3], corners[i + 1] - corners[i - 2], corners[i + 2] - corners[i - 1]);
  const gap = Math.max(GAP, length / (DOTS - 1)), points = [start.x, start.y, start.z], times = [0];
  let along = 0, mark = gap;
  for (let i = 3; i < corners.length; i += 3) {
    const piece = Math.hypot(corners[i] - corners[i - 3], corners[i + 1] - corners[i - 2], corners[i + 2] - corners[i - 1]);
    for (; mark <= along + piece && times.length < DOTS; mark += gap) {
      const u = (mark - along) / piece;
      points.push(corners[i - 3] + (corners[i] - corners[i - 3]) * u, corners[i - 2] + (corners[i + 1] - corners[i - 2]) * u, corners[i - 1] + (corners[i + 2] - corners[i - 1]) * u);
      times.push(clock[i / 3 - 1] + (clock[i / 3] - clock[i / 3 - 1]) * u);
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
const DOT_RADIUS = 0.011, COLOUR = '#ff3d14', RING = [0.028, 0.047], FACING = new THREE.Vector3(0, 0, 1);
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
      offset.subVectors(palm, way.start); arc.times = way.times; arc.points = way.points.slice(); mesh.count = arc.points.length / 3;
      for (let i = 0; i < mesh.count; i++) {
        drawnAt(near, real.fromArray(way.points, i * 3), offset, way.times[i], kind, world.colliders).toArray(arc.points, i * 3);
        mesh.setMatrixAt(i, placed.makeTranslation(near));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    hide() { mesh.visible = false; was.kind = null; },
  };
  return arc;
}

// `t` in seconds. A release with no press (or after a cancel) throws nothing.
export function createCharge() {
  let from = null;
  return {
    get active() { return from !== null; },
    press(t) { from ??= t; },
    level(t) { return from === null ? 0 : chargeAt(t - from); },
    release(t) { if (from === null) return null; const charge = chargeAt(t - from); from = null; return charge; },
    cancel() { from = null; },
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

// What you're holding sits at `palm`, the fist under it, sized to it. A real mesh goes with the hand, and clicks go through it
// till it's let go of. A thing that isn't one (null: an instance of a mesh of balls) is kept at `palm` by its owner.
// `hands.userData.full`: you don't sip from your mug with it.
export function createHand(hands) {
  const palm = new THREE.Group(), { arm, fist } = handModel();
  palm.position.copy(HOLD); palm.visible = false; palm.add(arm); hands.add(palm);
  const ignored = () => {}, ignore = node => { if (!Object.hasOwn(node, 'raycast')) node.raycast = ignored; }, notice = node => { if (node.raycast === ignored) delete node.raycast; };
  palm.traverse(ignore);
  let held = null;
  const letGo = () => { if (!held) return; held.traverse(notice); held.removeFromParent(); held = null; };
  const hand = {
    palm,
    hold(mesh, radius) {
      const size = 1.6 + radius * 12;
      arm.scale.setScalar(size); arm.position.set(0, -radius - FINGERS * size * 0.4, radius * 0.2).addScaledVector(fist, -size);
      letGo(); held = mesh; if (mesh) { palm.add(mesh); mesh.position.set(0, 0, 0); mesh.traverse(ignore); }
      palm.visible = hands.userData.full = true;
    },
    // Back towards you and tipped, the whole way at a full charge.
    pull(charge) { palm.position.set(HOLD.x - 0.04 * charge, HOLD.y, HOLD.z + 0.16 * charge); palm.rotation.x = 0.35 * charge; },
    free() { letGo(); palm.visible = hands.userData.full = false; hand.pull(0); },
  };
  return hand;
}
