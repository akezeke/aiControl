// The office goose: it waddles about between the desks, honks, makes off with things (props.js) and won't have the boss near
// it. Come close and it charges, wings out, and nips; hit it with anything, click it or take back what it took, and it chases
// you for longer. Its ways round the furniture come from path.js. With reduced motion it stands still and a click just honks.
import * as THREE from 'three';
import { piece } from './furniture.js';
import { toonMaterial, withOutline } from './toon.js';
import { findPath, nearestOpen } from './path.js';

export const GOOSE = 'goose'; // its id for the bubbles and props.js's hits
const WADDLE = 0.75, HAUL = 0.95, CHASE = 2.6, STRIDE = 0.07; // m/s (you walk at 4); metres per radian of a leg's swing
const NEAR = 1.3, NIP = 0.55, NECK = 0.95, SHOVE = 0.35; // metres
const SHORT = 2.5, LONG = 6, CALM = 8, REPLAN = 0.5; // seconds: a chase for coming close, and for anything worse; then it leaves you be; how often a chase looks for you again
const HONKS = [20, 40], THEFTS = [40, 90], LOITER = [2, 6]; // seconds
const LINES = ['HONK!', 'Honk!', 'HONK HONK!'], IDLE = ['look', 'peck', 'preen'];
const WHITE = '#f7f5ef', ORANGE = '#ff9f1c', INK = '#1b1a1f';
// The shoulder the head is placed from; where the neck starts, deep in the chest so it grows out of the body at any angle; the
// beak's tip on the head.
const PIVOT = new THREE.Vector3(0, 0.44, 0.13), ROOT = new THREE.Vector3(0, 0.36, 0.06), TIP = new THREE.Vector3(0, -0.02, 0.14);
const ROWS = 14, AROUND = 10, THICK = 0.05, THIN = 0.03; // the neck's rings, the points round each, its radius at the base and the head
// The head's place (lean from upright and turn from ahead, `len` from the neck's base), the neck's shape on the way (`bend` an S,
// `bow` a C bulging forward, or up when it's leaning over), the head's tilt (down +) and turn, the beak open, the wings spread.
const REST = { lean: 0.25, turn: 0, len: 0.3, bend: 0.2, bow: 0, pitch: 0.1, look: 0, jaw: 0, wings: 0 };
const rand = ([a, b]) => a + Math.random() * (b - a), pick = list => list[Math.floor(Math.random() * list.length)];
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const ball = (r, x, y, z, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, 14, 10).scale(sx, sy, sz).translate(x, y, z);
const beak = (r, h, x, y, z) => new THREE.ConeGeometry(r, h, 10).rotateX(Math.PI / 2).translate(x, y, z); // pointing ahead (+z)

// Facing +z, feet on the floor: a body and tail, a neck that bends (bendNeck), a head with the top of the beak, a jaw that opens,
// wings that spread and legs that swing. Eight meshes with their outlines.
function model() {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  body.add(piece('goose-body', () => [[ball(0.15, 0, 0.36, -0.02, 1, 0.85, 1.55), WHITE], [new THREE.ConeGeometry(0.07, 0.15, 10).rotateX(0.5 - Math.PI / 2).translate(0, 0.43, -0.27), WHITE]]));
  // Only the tube's layout is kept: bendNeck moves every point. Open-ended, its normals do for the outline's too.
  const tube = new THREE.CylinderGeometry(THIN, THICK, 1, AROUND, ROWS, true); tube.setAttribute('outlineNormal', tube.attributes.normal);
  const neck = withOutline(new THREE.Mesh(tube, toonMaterial(WHITE)), 0.006); body.add(neck);
  const head = new THREE.Group(); head.rotation.order = 'YXZ'; body.add(head);
  head.add(piece('goose-head', () => [[ball(0.058, 0, 0, 0, 0.9, 0.9, 1.15), WHITE], [beak(0.027, 0.09, 0, -0.006, 0.1), ORANGE], [ball(0.02, 0, 0.024, 0.058), ORANGE], ...[1, -1].map(side => [ball(0.011, side * 0.043, 0.018, 0.03), INK])], 0.006));
  const jaw = piece('goose-jaw', () => [[beak(0.02, 0.075, 0, 0, 0.0375), ORANGE]], 0.004); jaw.position.set(0, -0.024, 0.06); head.add(jaw);
  const wings = [1, -1].map(side => { const wing = piece('goose-wing', () => [[ball(0.1, 0, -0.02, -0.11, 0.3, 0.7, 1.45), '#ebe8e0']], 0.006); wing.position.set(side * 0.13, 0.42, 0.06); wing.rotation.order = 'ZYX'; body.add(wing); return wing; });
  const legs = [1, -1].map(side => { const leg = piece('goose-leg', () => [[new THREE.CylinderGeometry(0.013, 0.013, 0.24, 6).translate(0, -0.12, 0), ORANGE], [ball(0.035, 0, -0.245, 0.04, 1.1, 0.3, 1.4), ORANGE]], 0.004); leg.position.set(side * 0.06, 0.26, 0); root.add(leg); return leg; });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20).rotateX(-Math.PI / 2).scale(1, 1, 1.5), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.16, depthWrite: false }));
  shadow.position.y = 0.017; shadow.raycast = () => {}; root.add(shadow);
  return { root, body, neck, head, jaw, wings, legs };
}

// The neck along a curve from the chest to the head (in the body's frame), in the upright plane it turns to: out through the
// shoulder, then off the straight line by `bend` (opposite ways at a third and two thirds, an S) and `bow` (the same way, a C).
// In place, every frame; returns where the head goes.
const curve = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], v = Array.from({ length: 6 }, () => new THREE.Vector3());
function bendNeck(tube, { lean, turn, len, bend, bow }) {
  const [a, b, c, d] = curve, [across, side, centre, tangent, outward, ring] = v;
  across.set(Math.cos(lean) * Math.sin(turn), -Math.sin(lean), Math.cos(lean) * Math.cos(turn)); // square to the line: forward when upright, down when leaning right over
  side.set(Math.cos(turn), 0, -Math.sin(turn)); // square to the plane
  d.set(Math.sin(lean) * Math.sin(turn), Math.cos(lean), Math.sin(lean) * Math.cos(turn)).multiplyScalar(len).add(PIVOT);
  a.copy(ROOT); b.lerpVectors(PIVOT, d, 0.15).addScaledVector(across, (bow + bend) * len); c.lerpVectors(PIVOT, d, 2 / 3).addScaledVector(across, (bow - bend) * len);
  const { position, normal } = tube.attributes;
  for (let row = 0; row <= ROWS; row++) { // row 0 is at the head
    const t = 1 - row / ROWS, u = 1 - t, r = THICK + (THIN - THICK) * t;
    centre.copy(a).multiplyScalar(u * u * u).addScaledVector(b, 3 * u * u * t).addScaledVector(c, 3 * u * t * t).addScaledVector(d, t * t * t);
    tangent.copy(a).multiplyScalar(-3 * u * u).addScaledVector(b, 3 * u * u - 6 * u * t).addScaledVector(c, 6 * u * t - 3 * t * t).addScaledVector(d, 3 * t * t).normalize();
    outward.crossVectors(side, tangent).normalize(); // with `side`, the tube's own x and z
    for (let k = 0; k <= AROUND; k++) {
      const angle = k / AROUND * Math.PI * 2, i = row * (AROUND + 1) + k;
      ring.copy(side).multiplyScalar(Math.sin(angle)).addScaledVector(outward, Math.cos(angle));
      normal.setXYZ(i, ring.x, ring.y, ring.z); position.setXYZ(i, centre.x + ring.x * r, centre.y + ring.y * r, centre.z + ring.z * r);
    }
  }
  position.needsUpdate = normal.needsUpdate = true; tube.computeBoundingSphere();
  return d;
}

// `walkable()`: path.js's grid of the room as it is now; `busy()`: you're in the overview or off to someone, so it lets you be;
// `say(icon, text)`: its speech bubble.
export function createGoose(scene, { props, player, walkable, bounds, busy, reducedMotion, say }) {
  const { root, body, neck, head, jaw, wings, legs } = model(); root.visible = false; scene.add(root);
  const at = root.position, pose = { ...REST }, aim = { ...REST }, dir = new THREE.Vector3(), local = new THREE.Vector3(), tip = new THREE.Vector3(), above = new THREE.Vector3();
  let t = 0, yaw = 0, phase = 0, stepping = 0, mode = 'loiter', idle = 'look', side = 1, until = 0, path = null, loot = null, mine = false, last = null; // mine: it's had it in its beak; last: what it took last time
  let chaseUntil = 0, replanAt = 0, calmUntil = 0, honkUntil = 0, honkIn = rand(HONKS), stealIn = rand(THEFTS);

  const honk = (icon = '🪿') => { honkUntil = t + 0.6; say(icon, pick(LINES)); };
  const loiter = (seconds = rand(LOITER)) => { mode = 'loiter'; path = null; until = t + seconds; idle = pick(IDLE); side = Math.random() < 0.5 ? 1 : -1; };
  const go = (to, next) => { const way = to && findPath(walkable(), at, to); if (way) { path = way; mode = next; } return !!way; };
  // An open spot at least `far` away, from a few tries.
  const spot = far => {
    const { width, depth } = bounds(), grid = walkable();
    for (let i = 0; i < 8; i++) { const p = nearestOpen(grid, new THREE.Vector3(Math.random() * width, 0, Math.random() * depth)); if (p && flat(p, at) >= far) return p; }
    return null;
  };
  // Within reach of the neck from where it stands.
  const reach = (from, p) => Math.hypot(Math.max(0, flat(from, p) - PIVOT.z), p.y - PIVOT.y) < NECK;
  // Something lying still it can get at from the floor (a desk thing from beside its desk), from a few tries; not what it just left.
  const steal = () => {
    const grid = walkable();
    for (const b of props.loose().filter(b => b !== last).sort(() => Math.random() - 0.5).slice(0, 4)) {
      const stand = nearestOpen(grid, b.pos);
      if (stand && reach(stand, b.pos) && go(stand, 'fetch')) { loot = last = b; return; }
    }
  };
  const drop = () => { if (loot?.carried) props.drop(loot); loot = null; mine = false; };
  // Gets cross: drops what it has and goes for you, for `seconds`.
  const provoke = (seconds, icon) => {
    honk(icon);
    if (reducedMotion() || busy()) return;
    drop(); mode = 'chase'; chaseUntil = Math.max(chaseUntil, t + seconds); replanAt = 0;
  };
  const face = (p, dt) => { const turn = Math.atan2(p.x - at.x, p.z - at.z) - yaw; yaw += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 8); };
  // Along the path at `speed`; true once at its end.
  const follow = (speed, dt) => {
    while (path.length > 1 && flat(at, path[0]) < 0.05) path.shift();
    const next = path[0], d = flat(at, next); if (d < 0.05) return true;
    const step = Math.min(d, speed * dt);
    at.x += (next.x - at.x) / d * step; at.z += (next.z - at.z) / d * step; phase += step / STRIDE; stepping = 1;
    face(next, dt);
    return false;
  };

  // What it's up to, a frame at a time.
  function think(dt) {
    const you = player.position;
    if (loot?.held) { const taken = mine; drop(); if (taken) provoke(LONG, '💢'); else loiter(); } // you got there first, or took it back
    if (mode !== 'chase' && t > calmUntil && flat(you, at) < NEAR && !busy()) provoke(SHORT);
    if (mode === 'loiter' || mode === 'walk') { honkIn -= dt; stealIn -= dt; }
    if (honkIn < 0) { honkIn = rand(HONKS); honk(); }
    if (mode === 'chase') {
      if (busy() || t > chaseUntil) { calmUntil = t + 2; loiter(1); return; }
      if (t > replanAt) { replanAt = t + REPLAN; path = findPath(walkable(), at, you) || [you.clone().setY(0)]; }
      follow(CHASE, dt);
      // Caught you: a nip, a shove and a honk, and that'll do for a while.
      if (flat(you, at) < NIP) { player.step(dir.set(you.x - at.x, 0, you.z - at.z).normalize().multiplyScalar(SHOVE)); honk('💢'); calmUntil = t + CALM; loiter(); }
    } else if (mode === 'walk') { if (follow(WADDLE, dt)) loiter(); }
    else if (mode === 'fetch') {
      if (follow(WADDLE, dt)) { mode = 'reach'; until = t + 0.9; }
    } else if (mode === 'reach') {
      face(loot.pos, dt);
      if (!loot.carried && !reach(at, loot.pos)) { loot = null; loiter(); } // it moved
      else if (!loot.carried) { if (t > until - 0.4) mine = props.carry(loot, () => head.localToWorld(tip.copy(TIP))); }
      else if (t > until && !go(spot(3), 'haul')) { mode = 'drop'; until = t + 0.6; } // nowhere to take it: down it goes here
    } else if (mode === 'haul') { if (follow(HAUL, dt)) { mode = 'drop'; until = t + 0.6; } }
    else if (mode === 'drop') { if (t > until) { drop(); honk(); loiter(); } }
    else if (t > until) {
      if (stealIn < 0) { stealIn = rand(THEFTS); steal(); }
      if (mode === 'loiter' && !go(spot(1), 'walk')) loiter(1);
    }
  }

  // How it holds itself for what it's doing, eased toward.
  function strike(dt, still) {
    Object.assign(aim, REST);
    if (still) { /* stands as it is */ }
    else if (mode === 'chase') Object.assign(aim, { lean: 1.2, len: 0.36, bend: 0.3, pitch: -0.15, jaw: 0.35 + Math.sin(t * 30) * 0.1, wings: 0.85 + Math.sin(t * 14) * 0.15 });
    else if (mode === 'reach' && !loot?.carried && loot) {
      root.updateMatrixWorld(); root.worldToLocal(local.copy(loot.pos)).sub(PIVOT);
      const d = local.length();
      Object.assign(aim, { lean: Math.acos(THREE.MathUtils.clamp(local.y / d, -1, 1)), turn: Math.atan2(local.x, local.z), len: THREE.MathUtils.clamp(d - 0.13, 0.25, NECK), bend: 0.06, pitch: Math.atan2(-local.y, Math.hypot(local.x, local.z)) });
    } else if (mode === 'drop') Object.assign(aim, { lean: 1.7, len: 0.3, bend: 0, bow: -0.3, pitch: 0.7 });
    else if (loot?.carried) Object.assign(aim, { lean: 0.55, pitch: 0.25 });
    else if (mode === 'walk' || mode === 'fetch') aim.lean = 0.3 + Math.sin(phase * 2) * 0.08; // bobbing along
    else if (idle === 'look') { aim.turn = Math.sin(t * 0.8 + side) * 0.35; aim.look = Math.sin(t * 0.8 + side) * 0.6; }
    else if (idle === 'peck') { const peck = Math.sin(t * 1.3 + side) > 0 ? Math.max(0, Math.sin(t * 11)) ** 3 : 0; Object.assign(aim, { lean: 1.95 + 0.4 * peck, len: 0.42, bend: 0.05, bow: -0.35, pitch: 1 }); }
    else if (idle === 'preen') Object.assign(aim, { lean: 1.3, turn: side * 2.5, len: 0.26, bend: 0, bow: -0.5, pitch: 0.5 + Math.sin(t * 12) * 0.15 });
    // A honk: head thrown up, beak working.
    if (!still && t < honkUntil && mode !== 'chase' && mode !== 'reach') Object.assign(aim, { lean: 0.05, turn: 0, len: 0.36, bend: 0.1, pitch: -0.7, look: 0, jaw: 0.15 + 0.4 * Math.abs(Math.sin((honkUntil - t) * 10)) });
    const k = still ? 1 : 1 - Math.exp(-dt * 10);
    for (const key in pose) pose[key] += (aim[key] - pose[key]) * k;
    stepping *= still ? 0 : 1 - k * 0.5;
  }

  const goose = {
    root,
    // For props.js: things thrown, and coffee, hit it.
    get column() { return { id: GOOSE, x: at.x, z: at.z, r: 0.2, top: 0.55 }; },
    // Just over its head, for its bubble.
    top() { return root.visible ? head.getWorldPosition(above).setY(above.y + 0.16) : null; },
    hit() { provoke(LONG, '💢'); },
    poke() { provoke(LONG); },
    update(dt) {
      const room = bounds(); if (!room) return;
      const still = reducedMotion();
      // In by the lounge on the first frame there's a room, facing into it.
      if (!root.visible) { root.visible = true; const home = nearestOpen(walkable(), new THREE.Vector3(room.width - 2.4, 0, room.depth - 2.7)); if (home) at.copy(home); yaw = Math.atan2(room.width / 2 - at.x, room.depth / 2 - at.z); loiter(); }
      t += dt;
      if (still) { drop(); if (mode !== 'loiter') loiter(); } else think(dt);
      strike(dt, still);
      root.rotation.y = yaw;
      body.rotation.set(0.15 * pose.wings, 0, Math.sin(phase) * 0.12 * stepping); // waddling side to side; leaning in to a charge
      body.position.y = Math.abs(Math.sin(phase)) * 0.015 * stepping;
      legs[0].rotation.x = Math.sin(phase) * 0.6 * stepping; legs[1].rotation.x = -legs[0].rotation.x;
      head.position.copy(bendNeck(neck.geometry, pose)); head.rotation.set(pose.pitch, pose.turn + pose.look, 0);
      jaw.rotation.x = pose.jaw;
      wings.forEach((wing, i) => { const s = i ? -1 : 1; wing.rotation.set(0, -s * 1.2 * pose.wings, s * 0.7 * pose.wings); });
      root.updateMatrixWorld(true); // props.update moves what's in its beak after this
    },
    dispose() { drop(); root.removeFromParent(); },
  };
  root.userData.toggle = () => goose.poke(); // a click or E on it
  return goose;
}
