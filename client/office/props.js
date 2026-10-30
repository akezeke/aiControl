// Loose things to kick, pick up and throw, and the coffee in your mug to pour on stuff, with homemade physics (no engine).
// A football in the lounge and paper balls by the printer are one instanced mesh per kind plus its outline. What stands on
// the desks (furniture.js marks it userData.loose) comes loose the first time it's picked up and stays the mesh it was. The
// coffee is a stream of drops and the puddles they leave, one draw call each, and only while there are any.
// Walking into a ball kicks it; E or a click picks a thing up and throws it; F (held) pours; the machine (fill) tops it up.
// Whoever gets hit, or whose desk or things do, turns on the boss with a word or two (onHit).
// With reduced motion a kick or a throw lands at once, and pouring leaves its puddle without the stream.
import * as THREE from 'three';
import { WALL_H, canvasTexture } from './furniture.js';
import { toonMaterial, instancedOutline, highlight } from './toon.js';
import { EYE } from './player.js';

export const REACH = 2.6; // from your eyes
const GRAVITY = 9.8, BODY = 0.3, KICK = 10; // the boss is a column this wide; the hardest kick, m/s
const HOLD = new THREE.Vector3(-0.3, -0.27, -0.8); // where a thing sits in hand, in front of the camera
const UP = new THREE.Vector3(0, 1, 0);
// Balls: spots are [x, z] in a room `w` by `d`; `roll` is how fast they slow on the ground, `drag` in the air, `tumble` how
// fast a throw spins them. `low` is how high their middle rests, `centre` where it is from their mesh's origin.
const BALLS = [
  { radius: 0.11, bounce: 0.6, roll: 0.8, drag: 0.05, throw: 7, spots: (w, d) => [[w - 3.2, d - 2.6]], make: football },
  { radius: 0.045, bounce: 0.25, roll: 4, drag: 0.5, throw: 8, spots: w => [[w - 0.95, 0.85], [w - 1.25, 1.45], [w - 1.5, 2.2], [w - 0.85, 2.7]], make: () => crumpled(0.045) },
].map(kind => ({ ...kind, low: kind.radius, tumble: 20, centre: new THREE.Vector3() }));
// What's on the desks, by furniture.js's name: how high its middle is over its base, how far it reaches from there, what its
// owner calls it, and how bouncy it is. These slide rather than roll, and stand back up.
const LOOSE = Object.fromEntries(Object.entries({
  mug: [0.05, 0.07, 'mug'], cup: [0.07, 0.08, 'coffee'], duck: [0.07, 0.09, 'duck', 0.55], books: [0.054, 0.12, 'books'],
  plant: [0.13, 0.16, 'plant'], cactus: [0.11, 0.13, 'cactus'], frame: [0.07, 0.09, 'photo'],
}).map(([key, [low, radius, name, bounce = 0.2]]) => [key, { low, radius, name, bounce, roll: 6, drag: 0.3, throw: 6, tumble: 8, upright: true, centre: new THREE.Vector3(0, low, 0) }]));
// What they say: hit by something, by the coffee, coffee on their desk, something knocking into it.
const LINES = { hit: ['Hey!', 'Ow!', 'Watch it!', 'Really?'], coffee: ['Hot!', 'My shirt!', 'Seriously?'], desk: ['My desk!', 'Not the keyboard!', 'Ugh, sticky!'], knock: ['Careful!', 'Hey!', 'Easy!'] };
// Coffee: drops a second while pouring, how much of a mug a second, what each drop adds to a puddle (m²), the largest puddle.
const RATE = 100, DRAIN = 0.3, DROP = 0.0012, PUDDLE = 0.4, PUDDLES = 24, DROPS = 128, DRY = 90; // seconds before a puddle is gone
const FILL = 0.5, MACHINE = 1.3; // how much of a mug the machine pours a second; how near it you stand

const random = seed => () => (seed = seed * 16807 % 2147483647) / 2147483647;
const hash = v => { const h = Math.sin(Math.round(v.x * 1e3) * 12.9898 + Math.round(v.y * 1e3) * 78.233 + Math.round(v.z * 1e3) * 37.719) * 43758.5453; return h - Math.floor(h); };
const pick = list => list[Math.floor(Math.random() * list.length)];

// White with a black pentagon round each corner of an icosahedron, plotted point by point onto the sphere's map.
function football() {
  const map = canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#26252b';
    const t = (1 + Math.sqrt(5)) / 2, a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3();
    const uv = q => [((Math.atan2(q.z, -q.x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * w, Math.acos(q.y) / Math.PI * h];
    for (const corner of [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]) {
      const n = new THREE.Vector3(...corner).normalize(), [cx] = uv(n);
      a.crossVectors(n, Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize(); b.crossVectors(n, a);
      const points = Array.from({ length: 5 }, (_, i) => {
        const angle = i * Math.PI * 0.4, [x, y] = uv(p.copy(n).multiplyScalar(Math.cos(0.36)).addScaledVector(a, Math.sin(0.36) * Math.cos(angle)).addScaledVector(b, Math.sin(0.36) * Math.sin(angle)));
        return [x + Math.round((cx - x) / w) * w, y]; // the same side of the seam as its middle
      });
      for (const dx of [0, -w, w]) { g.beginPath(); for (const [x, y] of points) g.lineTo(x + dx, y); g.fill(); }
    }
  });
  return [new THREE.SphereGeometry(0.11, 24, 16), toonMaterial('#ffffff', { map })];
}
// A crumpled sheet: an icosahedron with its corners pushed in and out, flat shaded.
function crumpled(radius) {
  const geometry = new THREE.IcosahedronGeometry(radius, 1), position = geometry.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) { v.fromBufferAttribute(position, i); v.multiplyScalar(0.8 + 0.35 * hash(v)); position.setXYZ(i, v.x, v.y, v.z); }
  geometry.computeVertexNormals();
  return [geometry, toonMaterial('#f4f1ea')];
}

export function createProps(scene, { room, cast, camera, player, view, bounds, reducedMotion, onHit }) {
  const root = new THREE.Group(); scene.add(root);
  const bodies = [], matrix = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
  const near = new THREE.Vector3(), normal = new THREE.Vector3(), axis = new THREE.Vector3(), q = new THREE.Quaternion(), tilt = new THREE.Quaternion();
  // `free`: ours to move (a desk thing isn't until it's first picked up); `grip`: how it's turned in hand, from where you face.
  const body = (kind, extra) => ({ kind, pos: new THREE.Vector3(), vel: new THREE.Vector3(), turn: new THREE.Quaternion(), spin: new THREE.Vector3(), grip: new THREE.Quaternion(), held: false, rest: false, grace: 0, hits: new Set(), ...extra });
  for (const kind of BALLS) {
    const [geometry, material] = kind.make(), count = kind.spots(10, 10).length;
    const mesh = new THREE.InstancedMesh(geometry, material, count), hull = instancedOutline(mesh, kind.radius > 0.1 ? 0.008 : 0.005);
    mesh.userData.prop = i => { const b = bodies.find(b => b.mesh === mesh && b.i === i); return b?.held ? null : b; };
    root.add(mesh);
    for (let i = 0; i < count; i++) bodies.push(body(kind, { mesh, hull, i, free: true }));
  }
  let placed = false, holding = null, aimed = null, boxes = null;
  const show = b => {
    if (b.obj) { b.obj.quaternion.copy(b.turn); b.obj.position.copy(b.kind.centre).applyQuaternion(b.turn).negate().add(b.pos); return; }
    b.mesh.setMatrixAt(b.i, matrix.compose(b.pos, b.turn, one)); b.mesh.instanceMatrix.needsUpdate = true;
    b.mesh.boundingSphere = b.hull.boundingSphere = null; // worked out again for culling and picking
  };
  const light = (b, on) => b.obj ? highlight(b.obj, on) : b.hull.light(b.i, on);
  const spawn = (b, w, d) => { const [x, z] = b.kind.spots(w, d)[b.i]; b.pos.set(x, b.kind.radius, z); b.vel.set(0, 0, 0); b.rest = false; b.turn.setFromAxisAngle(UP, b.i * 2.1); };

  // The characters as columns: where, how wide, how tall. Someone hit, or whose things are, says so (once a moment).
  let people = [];
  const gather = () => { people = []; for (const [id, c] of cast.characters) if (!c.plus && c.root.visible) { const top = cast.positionOf(id); if (top) people.push({ id, x: top.x, z: top.z, r: 0.24 * c.scale, top: top.y - 0.08 }); } };
  const minded = new Map(); // who and why → when they last said so, so a stream of coffee is one complaint
  const hit = (id, now, cause, line) => {
    const key = `${id}:${cause}`;
    if (!people.some(p => p.id === id) || now - (minded.get(key) ?? -Infinity) < 2.5) return;
    minded.set(key, now); onHit?.(id, line || pick(LINES[cause]));
  };

  // A desk thing where it stands now (its desk may have moved), until it's picked up and ours.
  const scale = new THREE.Vector3();
  const thing = item => {
    const b = item.userData.body ??= body(LOOSE[item.userData.loose], { obj: item });
    if (!b.free) { item.updateWorldMatrix(true, false); item.matrixWorld.decompose(b.pos, b.turn, scale); b.pos.add(near.copy(b.kind.centre).applyQuaternion(b.turn)); }
    return b.held ? null : b;
  };
  // Picked up the first time: a stand-in keeps its place (room.js counts the cups) and it joins the balls. Its owner minds.
  const free = b => {
    const item = b.obj, parent = item.parent, stub = new THREE.Object3D();
    stub.position.copy(item.position); parent.children[parent.children.indexOf(item)] = stub; stub.parent = parent; item.parent = null;
    root.add(item); b.free = true; bodies.push(b);
    near.copy(b.pos).y -= b.kind.low + 0.01;
    const owner = boxes?.find(box => box.owner && box.containsPoint(near))?.owner;
    if (owner) hit(owner, performance.now() / 1000, null, `My ${b.kind.name}!`);
  };
  // pick() in player.js finds anything with userData.prop.
  const scan = () => scene.traverse(node => { if (node.userData.loose && !node.userData.prop) node.userData.prop = () => thing(node); });

  // One step of a thing's flight: gravity and drag, then the floor, the walls and the ceiling, then people (before their
  // chairs, which would shield them), then furniture and desks (pushed out of the nearest face and bouncing off it; a hard
  // knock bounces, a soft one just stops). A ball rolls on the ground; anything else slides and stands back up.
  const contact = (b, n) => { const vn = b.vel.dot(n); if (vn < 0) b.vel.addScaledVector(n, -(vn < -1 ? 1 + b.kind.bounce : 1) * vn); return n.y > 0.7; };
  function step(b, h, w, d, now) {
    const { radius: r, low, roll, drag, upright } = b.kind;
    b.vel.y -= GRAVITY * h; b.vel.multiplyScalar(Math.exp(-drag * h)); b.pos.addScaledVector(b.vel, h);
    let ground = false;
    if (b.pos.y < low) { b.pos.y = low; ground = contact(b, normal.set(0, 1, 0)); }
    if (b.pos.y > WALL_H - r) { b.pos.y = WALL_H - r; contact(b, normal.set(0, -1, 0)); }
    for (const [key, max] of [['x', w], ['z', d]]) {
      if (b.pos[key] < r) { b.pos[key] = r; contact(b, normal.set(0, 0, 0).setComponent(key === 'x' ? 0 : 2, 1)); }
      if (b.pos[key] > max - r) { b.pos[key] = max - r; contact(b, normal.set(0, 0, 0).setComponent(key === 'x' ? 0 : 2, -1)); }
    }
    for (const p of people) {
      const dx = b.pos.x - p.x, dz = b.pos.z - p.z, gap = Math.hypot(dx, dz), reach = p.r + r;
      if (gap >= reach || b.pos.y - low > p.top) continue;
      normal.set(dx, 0, dz).divideScalar(gap || 1); b.pos.x = p.x + normal.x * reach; b.pos.z = p.z + normal.z * reach;
      if (b.vel.length() > 1.5 && !b.hits.has(p.id)) { b.hits.add(p.id); hit(p.id, now, 'hit'); }
      contact(b, normal);
    }
    for (const box of boxes) {
      box.clampPoint(b.pos, near); normal.subVectors(b.pos, near);
      let gap = normal.length();
      if (gap >= r) continue;
      if (gap > 1e-6) normal.divideScalar(gap);
      else { // its middle is inside: out through the nearest side or the top
        const sides = [[b.pos.x - box.min.x, -1, 0, 0], [box.max.x - b.pos.x, 1, 0, 0], [b.pos.z - box.min.z, 0, 0, -1], [box.max.z - b.pos.z, 0, 0, 1], [box.max.y - b.pos.y, 0, 1, 0]];
        const [depth, x, y, z] = sides.reduce((best, side) => side[0] < best[0] ? side : best);
        normal.set(x, y, z); gap = -depth;
      }
      const reach = normal.y > 0.7 ? low : r; // it stands on what it lands on
      if (gap >= reach) continue;
      if (box.owner && b.vel.lengthSq() > 4 && !b.hits.has(box.owner)) { b.hits.add(box.owner); hit(box.owner, now, 'knock'); }
      b.pos.addScaledVector(normal, reach - gap);
      ground = contact(b, normal) || ground;
    }
    const turning = b.spin.length();
    if (turning > 1e-4) b.turn.premultiply(q.setFromAxisAngle(axis.copy(b.spin).normalize(), turning * h));
    if (ground && upright) {
      const k = Math.exp(-roll * h); b.vel.x *= k; b.vel.z *= k; b.spin.set(0, 0, 0);
      b.turn.premultiply(tilt.identity().slerp(q.setFromUnitVectors(axis.copy(UP).applyQuaternion(b.turn), UP), 1 - Math.exp(-12 * h)));
    } else if (ground) { const k = Math.exp(-roll * h); b.vel.x *= k; b.vel.z *= k; b.spin.set(b.vel.z, 0, -b.vel.x).divideScalar(r); }
    else b.spin.multiplyScalar(Math.exp(-0.5 * h));
    return ground;
  }
  // A frame of a thing: small enough steps not to pass through a desk; at rest once it's barely moving on the ground, upright.
  function fly(b, dt, w, d, now) {
    const steps = Math.min(10, Math.ceil(b.vel.length() * dt / (b.kind.radius * 0.5)) || 1);
    let ground = false;
    for (let s = 0; s < steps; s++) ground = step(b, dt / steps, w, d, now);
    b.grace = Math.max(0, b.grace - dt);
    if (ground && b.vel.lengthSq() < 0.01 && (!b.kind.upright || axis.copy(UP).applyQuaternion(b.turn).y > 0.999)) { b.vel.set(0, 0, 0); b.spin.set(0, 0, 0); b.rest = true; b.hits.clear(); }
  }
  // Reduced motion: straight to where it ends up.
  const settle = (b, w, d, now) => { for (let i = 0; i < 600 && !b.rest; i++) fly(b, 1 / 60, w, d, now); };

  // Coffee: drops in flight, and puddles that grow where they land and dry up in time.
  const dot = canvasTexture(32, 32, (g, w) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 1, 0, 7); g.fill(); });
  const drops = [], dropPositions = new Float32Array(DROPS * 3), dropGeometry = new THREE.BufferGeometry();
  dropGeometry.setAttribute('position', new THREE.BufferAttribute(dropPositions, 3).setUsage(THREE.DynamicDrawUsage));
  const stream = new THREE.Points(dropGeometry, new THREE.PointsMaterial({ color: '#5b3a24', size: 0.014, map: dot, alphaTest: 0.5 }));
  stream.frustumCulled = false; stream.visible = false; stream.raycast = () => {}; root.add(stream);
  const splat = canvasTexture(128, 128, (g, w) => {
    const r = random(5); g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, w / 2, w * 0.31, 0, 7); g.fill();
    for (let i = 0; i < 10; i++) { const a = r() * 7, d = w * (0.2 + r() * 0.12), s = w * (0.04 + r() * 0.08); g.beginPath(); g.arc(w / 2 + Math.cos(a) * d, w / 2 + Math.sin(a) * d, s, 0, 7); g.fill(); }
  });
  const puddles = [], pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), toonMaterial('#7a4a2a', { map: splat, transparent: true, opacity: 0.92, depthWrite: false }), PUDDLES);
  pool.count = 0; pool.frustumCulled = false; pool.raycast = () => {}; root.add(pool);
  const land = (x, y, z, area, now) => {
    let puddle = puddles.find(p => Math.abs(p.y - y) < 0.05 && Math.hypot(p.x - x, p.z - z) < Math.sqrt(p.area / Math.PI) * 0.8);
    if (!puddle) {
      if (puddles.length === PUDDLES) puddles.shift();
      puddles.push(puddle = { x, y, z, area: 0, angle: Math.random() * 7 });
    }
    puddle.area = Math.min(Math.PI * PUDDLE ** 2, puddle.area + area); puddle.at = now;
  };
  // Where coffee poured at a point ends up: on a desk or table it lands on, or the floor; taller things just get wet. `wet`
  // is whose it was.
  let wet = null;
  const surface = (x, y, z) => {
    wet = null;
    for (const box of boxes) if (box.containsPoint(near.set(x, y, z))) { wet = box.owner; return box.max.y < 0.9 && y > box.max.y - 0.1 ? box.max.y : null; }
    return y <= 0 ? 0 : undefined; // undefined: still falling
  };

  let pouring = false, filling = false, tip = 0, level = 1, due = 0;
  const walk = new THREE.Vector3(), was = new THREE.Vector3(), lip = new THREE.Vector3(), out = new THREE.Vector3(), forward = new THREE.Vector3(), spout = new THREE.Vector3();
  // Reduced motion: a splash in front of you at once.
  const splash = now => {
    if (level < 0.05) return;
    const ahead = player.forward.multiplyScalar(0.55).add(player.position);
    let y = 0, owner = null;
    for (const box of boxes) if (box.max.y < 0.9 && ahead.x > box.min.x && ahead.x < box.max.x && ahead.z > box.min.z && ahead.z < box.max.z && box.max.y > y) { y = box.max.y; owner = box.owner; }
    for (const p of people) if (Math.hypot(p.x - ahead.x, p.z - ahead.z) < p.r + 0.15) hit(p.id, now, 'coffee');
    if (owner) hit(owner, now, 'desk');
    land(ahead.x, y, ahead.z, DROP * RATE * Math.min(level, 0.3) / DRAIN, now); level = Math.max(0, level - 0.3);
  };
  // By the coffee machine: its spout (into `spout`) is within a step or two.
  const byMachine = () => {
    const machine = room.coffeeMachine; if (!machine?.parent) return false;
    machine.localToWorld(spout.copy(machine.userData.spout));
    return Math.hypot(player.position.x - spout.x, player.position.z - spout.z) < MACHINE;
  };

  const props = {
    get holding() { return holding; },
    // A thing comes to hand if it's within reach; it turns with you from then on.
    grab(b) {
      if (holding || b.held || b.pos.distanceTo(player.position) > REACH) return;
      if (!b.free) free(b);
      holding = b; b.held = true; b.rest = false; b.vel.set(0, 0, 0); b.spin.set(0, 0, 0);
      b.grip.setFromAxisAngle(UP, -player.yaw).multiply(b.turn);
      if (aimed === b) props.aim(null);
    },
    // Where you look (or along `direction`), on top of how you're moving; a let go drops it.
    throw(direction, drop = false) {
      const b = holding; if (!b) return;
      holding = null; b.held = false; b.grace = 0.3; b.hits.clear();
      if (drop) b.vel.set(0, 0, 0);
      else { // let go on the line you aim along, so it goes where you look
        const aim = direction || camera.getWorldDirection(forward);
        b.pos.copy(camera.position).addScaledVector(aim, 0.5); b.vel.copy(aim).multiplyScalar(b.kind.throw).add(walk); b.vel.y += 1.2;
        b.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(b.kind.tumble);
      }
      const size = bounds(); if (reducedMotion() && size) settle(b, size.width, size.depth, performance.now() / 1000);
    },
    // Outline the thing a click or E would pick up.
    aim(b) { if (b === aimed) return; if (aimed) light(aimed, false); if (b) light(b, true); aimed = b; },
    pour(on) { if (on && !pouring && reducedMotion() && boxes) splash(performance.now() / 1000); pouring = on; },
    // The machine fills your mug while you stand by it; false if you're too far away.
    fill() { if (!byMachine()) return false; filling = level < 1; return true; },
    // Where to stand to use the machine: in front of the counter.
    get machineSpot() { const machine = room.coffeeMachine; return machine && machine.localToWorld(new THREE.Vector3(machine.userData.spout.x, 0, 0.8)); },

    update(dt) {
      const size = bounds(); if (!size) return;
      const { width: w, depth: d } = size, still = reducedMotion(), now = performance.now() / 1000;
      if (!placed) { placed = true; for (const b of bodies) { spawn(b, w, d); show(b); } }
      // Desks come and go: whatever rested on one falls, and there may be new things on them.
      if (boxes !== room.colliders) { boxes = room.colliders; for (const b of bodies) b.rest = false; scan(); }
      gather();
      // How you're moving; flying over to someone doesn't kick.
      walk.subVectors(player.position, was).setY(0).divideScalar(Math.max(dt, 1e-3)); was.copy(player.position);
      if (player.flight || walk.length() > 12) walk.set(0, 0, 0);
      // Hands go with the overview and while talking: what you hold drops.
      const busy = view.amount > 0.2 || !!view.focusPoint;
      if (holding && busy) props.throw(null, true);
      camera.updateMatrixWorld();
      for (const b of bodies) {
        if (b.held) { b.pos.copy(HOLD).applyMatrix4(camera.matrixWorld); b.turn.setFromAxisAngle(UP, player.yaw).multiply(b.grip); show(b); continue; }
        if (!Number.isFinite(b.pos.x + b.pos.y + b.pos.z)) { if (b.obj) b.pos.set(w / 2, 1, d / 2); else spawn(b, w, d); }
        // You walk into it: a kick if you're moving and it's at your feet, else it's nudged aside.
        const feet = player.position.y - EYE, r = BODY + b.kind.radius, bottom = b.pos.y - b.kind.low;
        normal.subVectors(b.pos, player.position).setY(0);
        const gap = normal.length();
        if (!b.grace && gap < r && bottom < feet + 1.7 && b.pos.y + b.kind.radius > feet) {
          normal.divideScalar(gap || 1); b.pos.x = player.position.x + normal.x * r; b.pos.z = player.position.z + normal.z * r;
          const speed = walk.length();
          if (speed > 0.5 && bottom < feet + 0.4) {
            const push = Math.min(KICK, speed * 1.5 + 1);
            b.vel.copy(walk).normalize().add(normal).normalize().multiplyScalar(push).setY(1 + push * 0.25); b.hits.clear();
            if (still) { b.rest = false; settle(b, w, d, now); }
          } else contact(b, normal);
          b.rest = false;
        }
        if (!b.rest) { fly(b, dt, w, d, now); show(b); }
      }
      // Things knock into each other, the heavier pushing the lighter more.
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j]; if (a.held || b.held) continue;
        normal.subVectors(b.pos, a.pos); const gap = normal.length(), r = a.kind.radius + b.kind.radius;
        if (gap >= r || gap < 1e-6) continue;
        normal.divideScalar(gap);
        const ma = a.kind.radius ** 3, mb = b.kind.radius ** 3, share = mb / (ma + mb), closing = b.vel.clone().sub(a.vel).dot(normal);
        a.pos.addScaledVector(normal, -(r - gap) * share); b.pos.addScaledVector(normal, (r - gap) * (1 - share));
        if (closing < 0) { const j = -(1 + Math.min(a.kind.bounce, b.kind.bounce)) * closing / (1 / ma + 1 / mb); a.vel.addScaledVector(normal, -j / ma); b.vel.addScaledVector(normal, j / mb); }
        a.rest = b.rest = false; show(a); show(b);
      }

      // The mug tips while F is held, and pours once it's over far enough. The machine fills it while you stay by it, its
      // own little stream running into the drip tray.
      const want = pouring && !busy ? 1 : 0;
      tip = still ? want : tip + (want - tip) * (1 - Math.exp(-dt * 8));
      if (filling && (level >= 1 || !byMachine())) filling = false;
      if (filling) level = still ? 1 : Math.min(1, level + dt * FILL);
      view.pour = tip; view.level = level;
      const pours = !still && tip > 0.75 && level > 0 && view.mug;
      if (pours) {
        view.mug.updateWorldMatrix(true, false);
        // Out of the lip and a little ahead, so the stream arcs down in front of you.
        lip.set(-0.055, 0.06, 0).applyMatrix4(view.mug.matrixWorld); out.set(0, 1, 0).transformDirection(view.mug.matrixWorld).multiplyScalar(0.4);
        out.add(camera.getWorldDirection(forward).setY(0).normalize().multiplyScalar(0.7)).add(walk);
        level = Math.max(0, level - dt * DRAIN);
      } else if (filling && !still) { lip.copy(spout); out.set(0, -0.2, 0); }
      if (pours || (filling && !still)) {
        for (due += dt * RATE * (pours ? 1 : 0.4); due >= 1 && drops.length < DROPS; due--) {
          const drop = { pos: lip.clone(), vel: out.clone().add(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(pours ? 0.1 : 0)), machine: !pours };
          const t = Math.random() * dt; drop.pos.addScaledVector(drop.vel, t).y -= GRAVITY * t * t / 2; drop.vel.y -= GRAVITY * t; // spread over the frame: a stream, not spurts
          drops.push(drop);
        }
        due = Math.min(due, 2);
      } else due = 0;
      for (let i = drops.length - 1; i >= 0; i--) {
        const drop = drops[i]; drop.vel.y -= GRAVITY * dt; drop.pos.addScaledVector(drop.vel, dt);
        const { x, y, z } = drop.pos;
        if (drop.machine) { if (y < spout.y - 0.1) drops.splice(i, 1); continue; } // into the drip tray
        const top = surface(x, y, z), who = people.find(p => Math.hypot(p.x - x, p.z - z) < p.r && y < p.top);
        if (who) hit(who.id, now, 'coffee');
        else if (top !== undefined) { if (top !== null) land(x, top, z, DROP, now); if (wet) hit(wet, now, 'desk'); }
        if (who || top !== undefined || x < 0 || z < 0 || x > w || z > d) drops.splice(i, 1);
      }
      drops.forEach((drop, i) => drop.pos.toArray(dropPositions, i * 3));
      dropGeometry.setDrawRange(0, drops.length); dropGeometry.attributes.position.needsUpdate = true; stream.visible = drops.length > 0;
      // Puddles shrink over their last 20 seconds.
      for (let i = puddles.length - 1; i >= 0; i--) if (now - puddles[i].at > DRY) puddles.splice(i, 1);
      puddles.forEach((p, i) => {
        const size = Math.sqrt(p.area / Math.PI) * Math.min(1, (DRY - (now - p.at)) / 20);
        pool.setMatrixAt(i, matrix.compose(near.set(p.x, p.y + 0.02, p.z), q.setFromAxisAngle(axis.set(0, 1, 0), p.angle), out.setScalar(size)));
      });
      pool.count = puddles.length; pool.instanceMatrix.needsUpdate = true; pool.visible = puddles.length > 0;
    },
    dispose() { root.removeFromParent(); },
  };
  return props;
}
