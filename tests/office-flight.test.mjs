import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { STEP, TiltedBox, makeBody, stepBody, advance, simulate, escaped, stopShort } from '../client/office/flight.js';
import { BALLS, LOOSE, createProps, moveBody } from '../client/office/props.js';
import { createArc, createHand } from '../client/office/throwing.js';
import { KITCHEN } from '../client/office/kitchen-plan.js';
import { WALL_T } from '../client/office/furniture.js';
import { kitchenDoor } from '../client/office/layout.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const kind = (extra = {}) => ({ radius: 0.1, low: 0.1, bounce: 0.5, roll: 1, drag: 0.1, throw: 8, tumble: 4, upright: false, centre: V(0, 0, 0), ...extra });
const deg = (a, b) => a.angleTo(b) * 180 / Math.PI;
const until = (b, world, done, limit = 2400) => { for (let i = 0; i < limit && !done(); i++) stepBody(b, world); };
const plate = (centre, half, rotation, extra = {}) => new TiltedBox({ centre, half, rotation, ...extra });
const box = (x0, y0, z0, x1, y1, z1) => new THREE.Box3(V(x0, y0, z0), V(x1, y1, z1));

test('the same throw lands in exactly the same place at any frame rate', () => {
  const world = { colliders: [plate([2, 0.5, 0], [0.05, 0.5, 1], [0, 0, 0.3]), box(3, 0, -1, 4, 0.8, 1)], ceiling: 2.6 };
  const k = kind({ radius: 0.07, low: 0.07 });
  const reference = makeBody(k, V(0, 1.2, 0.1), V(5, 2, 0.4));
  const out = simulate(reference, world, { maxTime: 20 });
  assert.ok(out.rest);
  const rates = [[1 / 30], [1 / 60], [1 / 144], [1 / 50, 1 / 75, 1 / 31, 1 / 120]];
  for (const list of rates) {
    const b = makeBody(k, V(0, 1.2, 0.1), V(5, 2, 0.4));
    for (let i = 0; !b.rest && i < 100000; i++) advance(b, list[i % list.length], world);
    assert.ok(b.rest);
    assert.deepEqual(b.pos.toArray(), out.pos);
  }
});

test('a ball bounces off a 45° plate at the right angle', () => {
  for (const bounce of [1]) {
    const world = { colliders: [plate([0, 0.5, 0], [1, 0.02, 1], [0, 0, Math.PI / 4])] };
    const b = makeBody(kind({ bounce, roll: 0, drag: 0 }), V(0, 1.2, 0), V(0, 0, 0));
    let hit = false, fall = 0; world.onContact = body => { hit = true; fall = body.vel.length(); };
    until(b, world, () => hit);
    assert.ok(hit);
    assert.ok(Math.abs(b.vel.y) / b.vel.length() < Math.sin(Math.PI / 180), 'horizontal within 1°');
    assert.ok(Math.abs(b.vel.length() - fall) / fall < 0.02, 'speed kept');
  }
  // the same check must fail for a softer ball, or it measures nothing
  const world = { colliders: [plate([0, 0.5, 0], [1, 0.02, 1], [0, 0, Math.PI / 4])] }, b = makeBody(kind({ bounce: 0.1, roll: 0, drag: 0 }), V(0, 1.2, 0), V(0, 0, 0));
  let hit = false, fall = 0; world.onContact = body => { hit = true; fall = body.vel.length(); };
  until(b, world, () => hit);
  assert.ok(Math.abs(b.vel.length() - fall) / fall > 0.02);
});

// A ball dropped on a corner leaves reflected about the line from the corner to its centre.
const corner = (colliders, point, start) => {
  const world = { colliders }, b = makeBody(kind({ bounce: 1, roll: 0, drag: 0 }), start, V(0, -5, 0));
  const into = V(); let reported = false; world.onContact = body => { reported = true; into.copy(body.vel); };
  until(b, world, () => reported);
  assert.ok(reported);
  const n = b.pos.clone().sub(point).normalize(), expected = into.clone().addScaledVector(n, -2 * into.dot(n));
  assert.ok(deg(b.vel, expected) < 2, `${deg(b.vel, expected)}`);
  assert.ok(deg(b.vel, V(0, 1, 0)) > 5, 'not just straight back');
};
test('edges and corners deflect along the line from the point of contact', () => {
  corner([box(0, 0.5, -1, 1, 1, 1)], V(1, 1, 0), V(1.04, 1.6, 0)); // an edge
  corner([box(0, 0.5, -1, 1, 1, 1)], V(1, 1, 1), V(1.04, 1.6, 1.05)); // a corner
  const rot = new THREE.Euler(0, 0.4, 0), tilted = plate([0, 0.75, 0], [0.5, 0.25, 1], [0, 0.4, 0]);
  const point = V(0.5, 0.25, 1).applyEuler(rot).add(V(0, 0.75, 0));
  corner([tilted], point, point.clone().add(V(0.04, 0.6, 0.05).applyEuler(rot)));
});

test("a fast paper ball can't pass through a thin door", () => {
  for (let i = 0; i < 20; i++) {
    const angle = (i / 19) * Math.PI / 3 * (i % 2 ? 1 : -1), off = (i * 0.0137) % 0.05;
    const door = plate([0, 1, 0], [0.01, 1, 20], [0, 0, 0]); // a 2 cm plate, wide enough to go round only by tunnelling
    const speed = 12, dir = V(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(speed);
    const b = makeBody(kind({ radius: 0.045, low: 0.045, bounce: 0.3, drag: 0.02 }), V(-1 + off, 1, off), dir);
    for (let s = 0; s < 480; s++) stepBody(b, { colliders: [door] });
    assert.ok(b.pos.x < 0, `start ${i}: x ${b.pos.x}`);
  }
  // head on, fast enough for the centre to land inside the plate, flat and turned 0.5 rad about y
  for (const turn of [0, 0.5]) {
    const door = plate([0, 1, 0], [0.01, 1, 20], [0, turn, 0]), n = V(Math.cos(turn), 0, -Math.sin(turn)), t = V(Math.sin(turn), 0, Math.cos(turn));
    for (let i = 0; i < 40; i++) {
      const b = makeBody(kind({ radius: 0.045, low: 0.045, bounce: 0.3, drag: 0.02 }), n.clone().multiplyScalar(-1 - i * 0.00137).addScaledVector(t, i * 0.01).setY(1), n.clone().multiplyScalar(15));
      for (let s = 0; s < 240; s++) stepBody(b, { colliders: [door] });
      assert.ok(b.pos.dot(n) < 0, `turn ${turn} start ${i}: ${b.pos.dot(n)}`);
    }
    // centre ending the step just past the middle, having come in from the near side: back out that way
    const b = makeBody(kind({ radius: 0.045, low: 0.045 }), n.clone().multiplyScalar(-0.046).setY(1), n.clone().multiplyScalar(12));
    stepBody(b, { colliders: [door] });
    assert.ok(b.pos.dot(n) < -0.01, `turn ${turn}: ${b.pos.dot(n)}`);
  }
});

test('a ball on a sloped tray rolls off rather than freezing', () => {
  const tray = plate([0, 0.5, 0], [0.5, 0.01, 0.5], [0, 0, Math.PI / 6]); // +z turns +x up: it slopes down towards -x
  const world = { colliders: [tray] };
  const b = makeBody(kind({ radius: 0.05, low: 0.05, roll: 0.5, drag: 0 }), V(0, 0.5 + 0.05 / Math.cos(Math.PI / 6) + 0.013, 0), V(0, 0, 0));
    for (let s = 0; s < 240 * 8 && !b.rest; s++) stepBody(b, world);
  assert.ok(b.rest); assert.ok(b.pos.x < tray.min.x); assert.ok(Math.abs(b.pos.y - 0.05) < 1e-6);
});

test('a body whose centre is inside a box comes out, with finite numbers', () => {
  const door = plate([0, 1, 0], [0.01, 1, 1], [0, 0, 0]);
  const b = makeBody(kind(), V(0.003, 1, 0), V(0, 0, 0));
  for (let s = 0; s < 240; s++) stepBody(b, { colliders: [door] });
  assert.ok(!door.containsPoint(b.pos));
  for (const v of [...b.pos.toArray(), ...b.vel.toArray(), ...b.spin.toArray()]) assert.ok(Number.isFinite(v));
  // a fast one that tunnelled to the middle goes back out the face it came in by
  const c = makeBody(kind(), V(0.005, 1, 0), V(-3, 0, 0));
  stepBody(c, { colliders: [door] }); assert.ok(c.pos.x > 0.01);
});

test('a body at rest inside a box leaves by the nearest side, never through the top or bottom', () => {
  const door = plate([0, 1, 0], [0.01, 1, 1], [0, 0, 0]), wall = box(-0.01, 0, -1, 0.01, 2.6, 1);
  for (const c of [door, wall]) {
    const b = makeBody(kind(), V(0.003, 1.3, 0), V(0, 0, 0));
    stepBody(b, { colliders: [c], ceiling: 2.6 });
    assert.ok(Math.abs(b.pos.x) > 0.01 && Math.abs(b.pos.y - 1.3) < 0.01, `${b.pos.toArray()}`);
  }
});

test('a desk appearing around a body never leaves it below the floor', () => {
  const desk = box(0, 0, 0, 1, 0.75, 1);
  for (const [upright, y, vy] of [[false, 0.045, 0], [true, 0.045, 0], [false, 0.3, 3], [false, 0.1, 3]]) {
    const b = makeBody(kind({ radius: 0.045, low: 0.045, upright }), V(0.5, y, 0.5), V(0, vy, 0));
    for (let s = 0; s < 480; s++) stepBody(b, { colliders: [desk] });
    assert.ok(b.pos.y >= 0.045 - 1e-9, `${upright} ${y} ${vy}: ${b.pos.y}`);
  }
});

test('contacts name their surface', () => {
  const world = { colliders: [box(0, 0, 0, 1, 0.5, 1), box(2, 0, 0, 3, 0.5, 1)], ceiling: 2.6 };
  world.colliders.forEach(c => { c.surface = 'chair'; });
  const seen = new Set();
  world.onContact = (b, c) => { seen.add(c.surface); assert.ok(c.speed > 0); };
  for (const [x, y, vy] of [[0.5, 1, -3], [2.5, 1, -3], [5, 1, -3], [5, 2.4, 6]]) {
    const b = makeBody(kind(), V(x, y, 0.5), V(0, vy, 0)); for (let s = 0; s < 120; s++) stepBody(b, world);
  }
  assert.deepEqual([...seen].sort(), ['ceiling', 'chair', 'floor']);
});

test('a shot stops at 8 s at the latest', () => {
  const b = makeBody(kind({ gravity: 0, drag: 0 }), V(0, 1, 0), V(1, 0, 0));
  const out = simulate(b, { colliders: [] });
  assert.ok(out.time <= 8 && out.time > 7.99); assert.ok(!out.rest);
  assert.ok(out.path instanceof Float32Array && out.path.length === 480 * 3);
  const c = makeBody(kind(), V(0, 1, 0), V(1, 0, 0));
  assert.ok(simulate(c, { colliders: [] }, { stop: ({ surface }) => surface === 'floor' }).contacts.at(-1).surface === 'floor');
  assert.equal(STEP, 1 / 240);
});

test('a body outside the building counts as escaped', () => {
  const building = { left: -9, width: 20, depth: 10 };
  for (const [x, z] of [[-10.1, 5], [21.1, 5], [5, -1.1], [5, 11.1]]) assert.ok(escaped(V(x, 1, z), building), `${x} ${z}`);
  for (const [x, z] of [[5, 5], [-3, 5], [-9, 5], [-9.9, 5], [20.9, 5], [5, -0.9], [5, 10.9]]) assert.ok(!escaped(V(x, 1, z), building), `${x} ${z}`);
  assert.ok(!escaped(V(-3, 1, -2.5), { ...building, back: -2 }) && escaped(V(-3, 1, -3.1), { ...building, back: -2 }), 'a building that starts behind z = 0');
});

test('put by hand, a thing stops short of what\'s between you and there', () => {
  const k = { radius: 0.1, low: 0.05 }, wall = box(5, 0, 0, 5.2, 3, 10), to = (x, y, z) => V(x, y, z);
  const put = (from, there, boxes) => stopShort(from, there, k, boxes).toArray();
  assert.deepEqual(put(V(4, 1, 5), to(6, 1, 5), []), [6, 1, 5], 'nothing in the way');
  assert.deepEqual(put(V(4, 1, 5), to(4.5, 1, 5), [wall]), [4.5, 1, 5], 'not as far as it');
  assert.deepEqual(put(V(4, 1, 5), to(6, 1, 5), [wall]), [4.9, 1, 5], 'past it');
  assert.deepEqual(put(V(4, 1, 5), to(5.05, 1, 5), [wall]), [4.9, 1, 5], 'into it');
  assert.deepEqual(put(V(6, 1, 5), to(4, 1, 5), [wall]), [5.3, 1, 5], 'from the other side');
  const near = stopShort(V(4, 1, 5), to(5, 2, 5), k, [wall]); // keeps the line it was on
  assert.ok(Math.abs(near.x - 4.9) < 1e-9 && Math.abs(near.y - 1.9) < 1e-9, `${near.toArray()}`);
  // the nearest of several; a gap between two lets it by
  assert.deepEqual(put(V(4, 1, 5), to(8, 1, 5), [box(7, 0, 0, 7.2, 3, 10), wall]), [4.9, 1, 5]);
  const gap = [box(5, 0, 0, 5.2, 3, 4), box(5, 0, 6, 5.2, 3, 10), box(5, 2.2, 4, 5.2, 3, 6)];
  assert.deepEqual(put(V(4, 1, 5), to(6, 1, 5), gap), [6, 1, 5], 'through the gap');
  assert.deepEqual(put(V(4, 2.5, 5), to(6, 2.5, 5), gap), [4.9, 2.5, 5], 'over the gap');
  // along the top of a desk it stands on (by `low`, not its radius), but into it from above it stops on it
  const desk = box(4, 0, 4, 6, 0.75, 6);
  assert.deepEqual(put(V(3.7, 0.8, 5), to(4.5, 0.8, 5), [desk]), [4.5, 0.8, 5]);
  assert.ok(Math.abs(stopShort(V(5, 1.8, 5), to(5, 0.2, 5), k, [desk]).y - 0.8) < 1e-5);
  // already within a box it's left to flight, which pushes it out
  assert.deepEqual(put(V(5, 0.3, 5), to(5, 0.5, 5), [desk]), [5, 0.5, 5]);
  // a turned box is met turned: a thin plate at 45° across the line
  const slant = plate([5, 1, 5], [0.05, 1, 1], [0, Math.PI / 4, 0]), met = stopShort(V(4, 1, 5), to(6, 1, 5), k, [slant]);
  assert.ok(met.x < 5 && met.x > 4.7, `${met.toArray()}`); assert.equal(met.y, 1); assert.equal(met.z, 5);
  assert.deepEqual(put(V(4, 1, 8), to(6, 1, 8), [slant]), [6, 1, 8], 'and missed where it isn\'t, inside its world box or not');
  const there = to(6, 1, 5); assert.equal(stopShort(V(4, 1, 5), there, k, [wall]), there, 'it moves the one you gave it');
});

// What props.js adds to a flight body.
const thing = (k, pos, vel) => Object.assign(makeBody(k, pos, vel), { turn: new THREE.Quaternion(), hits: new Set(), home: pos.clone() });
const building = { left: 0, width: 10, depth: 10 };
const mug = { radius: 0.07, low: 0.05, bounce: 0.2, roll: 6, drag: 0.3, upright: true };
const lean = b => V(0, 1, 0).applyQuaternion(b.turn).y;

test('a mug that stops leaning stands back up before it counts as still', () => {
  const tilted = () => { const b = thing(mug, V(5, 0.05, 5), V(0, 0, 0)); b.turn.setFromAxisAngle(V(1, 0, 0), 1.2); return b; };
  // flight alone rests it as it is, or there'd be nothing here to check
  const alone = tilted(); for (let i = 0; i < 60 && !alone.rest; i++) advance(alone, 1 / 60, { colliders: [] });
  assert.ok(alone.rest); assert.ok(lean(alone) < 0.5);
  for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
    const b = tilted(); let frames = 0;
    for (; !b.rest && frames < 600; frames++) { moveBody(b, dt, { colliders: [] }, building); if (b.rest) break; }
    assert.ok(b.rest, `${dt}`); assert.ok(lean(b) > 0.999, `${dt}: ${lean(b)}`);
    assert.ok(frames * dt > 0.2 && frames * dt < 1.5, `${dt}: took ${frames * dt}`);
    assert.deepEqual(b.pos.toArray(), [5, 0.05, 5]); // straightening doesn't creep
  }
});

test('thrown things tumble in the air, a mug too until it lands; a ball rolls along the floor', () => {
  for (const k of [mug, kind()]) {
    const b = thing(k, V(5, 2.5, 5), V(1, 0, 0)); b.spin.set(0, 0, 8);
    for (let i = 0; i < 12; i++) moveBody(b, 1 / 60, { colliders: [] }, building);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(b.turn.w)));
    assert.ok(Math.abs(angle - 8 * Math.exp(-0.5 * 0.1) * 0.2) < 0.05, `${angle}`);
    assert.ok(b.spin.length() > 7);
  }
  const b = thing(kind({ roll: 0.5 }), V(1, 0.1, 5), V(3, 0, 0));
  for (let i = 0; i < 3; i++) moveBody(b, 1 / 60, { colliders: [] }, building); // 30 rad/s
  const roll = V(0, 1, 0).applyQuaternion(b.turn); // rolling toward +x turns its top toward +x
  assert.ok(roll.x > 0.5, `${roll.toArray()}`);
});

test('a body rests where its home is, and an escaped one goes back there still', () => {
  const b = thing(kind(), V(5, 0.5, 5), V(1, 0, 1)); b.hits.add('someone');
  for (let i = 0; i < 600 && !b.rest; i++) moveBody(b, 1 / 60, { colliders: [] }, building);
  assert.ok(b.rest); assert.deepEqual(b.home.toArray(), b.pos.toArray()); assert.notDeepEqual(b.home.toArray(), [5, 0.5, 5]);
  assert.equal(b.hits.size, 0, 'at rest it can hit them again');
  const home = b.home.clone();
  b.rest = false; b.pos.set(-1.5, 1, 5); b.vel.set(-4, 0, 0); b.spin.set(1, 1, 1);
  moveBody(b, 1 / 60, { colliders: [] }, building);
  assert.deepEqual(b.pos.toArray(), home.toArray()); assert.deepEqual(b.vel.toArray(), [0, 0, 0]); assert.deepEqual(b.spin.toArray(), [0, 0, 0]);
  // one that's never rested goes back to where it started
  const c = thing(kind(), V(3, 1, 3), V(-50, 0, 0));
  moveBody(c, 0.1, { colliders: [] }, building);
  assert.deepEqual(c.pos.toArray(), [3, 1, 3]);
  // nor does coming to rest somewhere nobody can reach, with the building round it
  const e = thing(kind(), V(3, 0.1, 3), V(0, 0, 0)); e.pos.set(8, 0.1, 3); e.quiet = 1;
  moveBody(e, 1 / 60, { colliders: [] }, building, p => p.x < 5);
  assert.deepEqual(e.pos.toArray(), [3, 0.1, 3]); assert.deepEqual(e.home.toArray(), [3, 0.1, 3]); assert.equal(e.rest, false);
  // coming to rest out there doesn't make out there home
  const d = thing(kind(), V(3, 0.1, 3), V(0, 0, 0)); d.pos.set(-5, 0.1, 3); d.quiet = 1;
  moveBody(d, 1 / 60, { colliders: [] }, building);
  assert.deepEqual(d.pos.toArray(), [3, 0.1, 3]); assert.deepEqual(d.home.toArray(), [3, 0.1, 3]);
});

// The real props on a stand-in office: no document in Node, so a blank canvas for its textures.
const blank = () => new Proxy({}, { get: (t, k) => k in t ? t[k] : () => ({ addColorStop() {} }), set: (t, k, v) => { t[k] = v; return true; } });
const box3 = (x0, y0, z0, x1, y1, z1, extra) => Object.assign(box(x0, y0, z0, x1, y1, z1), extra);
const WEST = -(WALL_T + KITCHEN.width); // how far the building goes that way
function office({ colliders = [], still = false, people = [] } = {}) {
  const heard = [], scene = new THREE.Scene(), player = { position: V(1, 1.6, 1), forward: V(0, 0, -1), yaw: 0, flight: null }, size = { width: 10, depth: 10 };
  const room = { flightColliders: colliders, kitchen: { shown: true, inside: p => { const z = p.z - kitchenDoor(size.depth); return p.x < -WALL_T / 2 && p.x > WEST && z > KITCHEN.back && z < KITCHEN.front; } }, secret: { shown: true, bounds: r => ({ left: WEST, width: r.width + 3 - WEST, depth: r.depth }), inside: p => p.x > 10.1 && p.z > size.depth - 7.9 && p.z < size.depth - 0.7, get spot() { return V(9.1, 0, size.depth - 3.8); } } };
  const characters = new Map(people.map(p => [p.id, { scale: 1, root: { visible: true } }]));
  const cast = { characters, positionOf: id => { const p = people.find(p => p.id === id); return p && V(p.x, p.top + 0.08, p.z); } };
  const camera = new THREE.PerspectiveCamera(); camera.position.set(1, 1.6, 1);
  const view = { amount: 0, drunk: 0 };
  globalThis.document = { createElement: () => ({ getContext: blank }) };
  const props = createProps(scene, { room, cast, camera, player, view, bounds: () => size, reducedMotion: () => still, onHit: (id, line) => heard.push([id, line]), hand: createHand(camera) });
  delete globalThis.document;
  const ball = scene.children[0].children[0].userData.prop(0); // the football
  const run = (seconds, rate = 60) => { for (let i = 0; i < seconds * rate; i++) props.update(1 / rate); };
  run(0.1);
  const send = (pos, vel) => { ball.pos.set(...pos); ball.vel.set(...vel); ball.rest = false; };
  return { props, run, ball, send, room, player, heard, camera, view, size, scene };
}

test('the arc ends where the office\'s real throw first lands, short of a far wall', () => {
  for (const kind of [LOOSE.mug, LOOSE.frame, BALLS[0], BALLS[1]]) {
    const wall = box3(13, 0, 0, 13.2, 3, 30), a = office({ colliders: [wall] }), { ball, props, player, camera } = a;
    ball.kind = kind; ball.rest = false; // a desk thing, without its desk
    player.position.set(1, 1.6, 5); camera.position.copy(player.position); a.run(0.05);
    ball.pos.set(1.3, 1.2, 5); props.grab(ball); a.run(0.05);
    assert.equal(props.heldKind, kind);
    const direction = V(Math.cos(0.1), Math.sin(0.1), 0), arc = createArc();
    arc.show(kind, props.launch(1, direction), props.aimWorld(), player.position, V(1.3, 1.3, 5.3));
    assert.equal(arc.ring.visible, true);
    const ring = arc.ring.position.clone(), last = V(...arc.points.slice(-3));
    assert.ok(ring.y < 0.01, `${ring.toArray()}`);
    assert.ok(ring.x < 12.5, `it falls short of the wall: ${ring.x}`);
    props.throw(direction, false, 1);
    let falling = false, landed = null, again = 0;
    const flown = [];
    for (let i = 0; i < 240 * 3 && again < 240; i++) { const y = ball.vel.y; props.update(1 / 240); flown.push(ball.pos.clone()); if (landed) again++; if (y < 0) falling = true; if (!landed && falling && ball.vel.y > y + 1) landed = ball.pos.clone(); }
    assert.ok(landed, 'it came down');
    assert.ok(Math.hypot(landed.x - ring.x, landed.z - ring.z) < 0.1, `thrown, it lands at ${landed.x}, the ring's at ${ring.x}`);
    const dots = Array.from({ length: arc.points.length / 3 }, (_, i) => V(...arc.points.subarray(i * 3, i * 3 + 3)));
    assert.ok(Math.min(...dots.map(d => d.distanceTo(landed))) < 0.6, 'the dots get there');
    assert.ok(last.x <= landed.x + 1.3, `and go a bit over a metre on: ${last.x} to ${landed.x}`);
    assert.ok(dots.some(d => d.x > landed.x), 'it keeps going, so there are dots after the landing');
    for (const d of dots) if (d.x > landed.x) assert.ok(Math.min(...flown.map(p => p.distanceTo(d))) < 0.05, `the dot at ${d.toArray()} is where the thrown thing went`);
  }
});

test('only real walls stop things now: the room has no invisible edge', () => {
  const a = office(); a.send([9.5, 1, 5], [4, 0, 0]); a.run(0.5);
  assert.ok(a.ball.pos.x > 10.5, `${a.ball.pos.x}`);
  const b = office({ colliders: [box3(10, 0, 0, 10.2, 3, 10)] }); b.send([9.5, 1, 5], [4, 0, 0]); b.run(0.5);
  assert.ok(b.ball.pos.x <= 10 - 0.11 + 1e-6, `${b.ball.pos.x}`);
});

test('someone hit, or whose desk is knocked, says so', () => {
  const ann = { id: 'ann', x: 5, z: 5, top: 1.6 }, desk = box3(7, 0, 4, 8, 0.75, 6, { owner: 'bob' }), bob = { id: 'bob', x: 7.5, z: 8, top: 1.6 };
  const a = office({ people: [ann, bob], colliders: [desk] });
  a.send([4, 1, 5], [5, 0, 0]); a.run(0.2);
  assert.deepEqual(a.heard.map(h => h[0]), ['ann']); assert.ok(a.ball.vel.x < 0, 'and it bounced');
  a.send([6.5, 0.4, 5], [5, 0, 0]); a.run(0.1); // bob's desk, hard
  assert.deepEqual(a.heard.map(h => h[0]), ['ann', 'bob']);
  const quiet = office({ people: [ann, bob], colliders: [desk] }); // gently: not worth a word
  quiet.send([6.8, 0.4, 5], [1, 0, 0]); quiet.run(0.5);
  quiet.send([4.55, 1, 5], [1, 0, 0]); quiet.run(0.3);
  assert.deepEqual(quiet.heard, []);
});

test('a new flightColliders list wakes things: what lay on a desk falls', () => {
  const desk = box3(4, 0, 4, 6, 0.75, 6), a = office({ colliders: [desk] });
  a.send([5, 0.9, 5], [0, 0, 0]); a.run(1);
  assert.ok(a.ball.rest); assert.ok(Math.abs(a.ball.pos.y - 0.86) < 1e-6);
  a.room.flightColliders = []; a.run(4);
  assert.ok(a.ball.rest); assert.ok(Math.abs(a.ball.pos.y - 0.11) < 1e-6);
});

test('a kick settles at once with reduced motion', () => {
  const a = office({ still: true });
  a.ball.pos.set(2, 0.11, 1); a.ball.rest = true; a.player.position.set(1.55, 1.6, 1); a.props.update(1 / 60); a.player.position.set(1.6, 1.6, 1); a.props.update(1 / 60);
  assert.ok(a.ball.rest); assert.ok(a.ball.pos.x > 3, `${a.ball.pos.x}`);
});

test('what you drop going through the secret door stays in the office', () => {
  const a = office(); a.player.position.set(10.5, 1.6, 5); a.ball.pos.set(10.8, 1, 5); a.run(0.05);
  a.ball.pos.set(10.8, 1, 5); a.props.grab(a.ball); a.props.update(1 / 60);
  a.props.throw(null, true);
  assert.ok(a.ball.pos.x <= 10 - 0.11 + 1e-9, `${a.ball.pos.x}`);
});

test('each person minds once a throw, however long it bounces about, and again once it has rested', () => {
  const clock = performance.now, ann = { id: 'ann', x: 5, z: 5, top: 1.6 }; let t = 1000; performance.now = () => t;
  try {
    const a = office({ people: [ann], colliders: [box(-0.2, 0, 0, 0, 3, 10)] }); // the left wall: it's a long roll to anywhere else
    a.send([4, 1, 5], [5, 0, 0]); a.run(0.2);
    assert.deepEqual([...a.ball.hits], ['ann']); assert.equal(a.heard.length, 1);
    t += 10000; a.send([4, 1, 5], [5, 0, 0]); a.run(0.2); // well past "once a moment": only hits holds this one back
    assert.equal(a.heard.length, 1);
    a.run(6); assert.ok(a.ball.rest); assert.equal(a.ball.hits.size, 0);
    t += 10000; a.send([4, 1, 5], [5, 0, 0]); a.run(0.2);
    assert.equal(a.heard.length, 2);
  } finally { performance.now = clock; }
});

// The office's real walls, 10 by 10, with the doorway in the right wall and the games room beyond it.
const doorZ = 6.2, shelf = open => box3(9.61, 0, doorZ - 0.75 - (open ? 1.6 : 0), 10, 2.3, doorZ + 0.75 - (open ? 1.6 : 0));
const walls = open => [box3(-0.2, 0, -0.2, 10.2, 3, 0), box3(-0.2, 0, 10, 10.2, 3, 10.2), box3(-0.2, 0, 0, 0, 3, 10),
  box3(10, 0, 0, 10.2, 3, doorZ - 0.65), box3(10, 0, doorZ + 0.65, 10.2, 3, 10), box3(10, 2.2, doorZ - 0.65, 10.2, 3, doorZ + 0.65),
  box3(10.2, 0, doorZ - 4.3, 23.4, 3, doorZ - 4.1), box3(10.2, 0, doorZ + 3.1, 23.4, 3, doorZ + 3.3), box3(23.2, 0, doorZ - 4.3, 23.4, 3, doorZ + 3.3), shelf(open)];
const at = (a, x, z, dx, dz) => { a.player.position.set(x, 1.6, z); a.camera.position.set(x, 1.6, z); a.camera.lookAt(x + dx, 1.6, z + dz); a.camera.updateMatrixWorld(); a.player.yaw = Math.atan2(-dx, -dz); a.props.update(1 / 60); };
const inHand = (a, x, z, dx, dz) => { at(a, x, z, dx, dz); a.ball.pos.copy(a.player.position); a.ball.rest = false; a.props.grab(a.ball); assert.equal(a.props.holding, a.ball); a.props.update(1 / 60); };
// Watches every frame, so going out and being sent back counts too.
const stays = (a, seconds) => { const r = a.ball.kind.radius; for (let i = 0; i < seconds * 60; i++) { a.props.update(1 / 60); const { x, z } = a.ball.pos; assert.ok(x >= r - 1e-6 && x <= 10 - r + 1e-6 && z >= r - 1e-6 && z <= 10 - r + 1e-6, `frame ${i} at ${x}, ${z}`); } assert.ok(a.ball.rest); };
const sides = [['left', 0.35, 5, -1, 0], ['windows', 5, 0.35, 0, -1], ['door', 5, 9.65, 0, 1], ['right, nothing behind', 9.65, 1, 1, 0], ['right, games room behind', 9.65, 8.5, 1, 0]];

test('a throw from right up against a wall stays this side of it', () => {
  for (const [name, x, z, dx, dz] of sides) {
    const a = office({ colliders: walls() }); inHand(a, x, z, dx, dz);
    a.props.throw(V(dx, 0, dz));
    assert.doesNotThrow(() => stays(a, 8), name);
    assert.ok(a.ball.home.x > 0 && a.ball.home.x < 10 && a.ball.home.z > 0 && a.ball.home.z < 10, `${name} home ${a.ball.home.toArray()}`);
  }
});

test('what you drop with your back to the room, facing a wall, stays this side of it', () => {
  for (const [name, x, z, dx, dz] of [...sides.map(([n, x, z, dx, dz]) => [n, x, z, dx, dz]), ['left from further off', 0.5, 5, -1, 0]]) {
    const a = office({ colliders: walls() }); inHand(a, x, z, dx, dz);
    a.view.amount = 1; a.props.update(1 / 60); a.view.amount = 0;
    assert.equal(a.props.holding, null);
    const near = dx ? Math.abs(a.ball.pos.z - z) : Math.abs(a.ball.pos.x - x);
    assert.ok(near < 0.5, `${name}: it lands where you are, not ${a.ball.pos.toArray()}`);
    assert.doesNotThrow(() => stays(a, 4), name);
  }
});

test('standing on a ball against a wall leaves it this side', () => {
  for (const [name, x, z, dx, dz] of sides) {
    const a = office({ colliders: walls() }), r = a.ball.kind.radius;
    a.send([x + dx * (0.35 - r), r, z + dz * (0.35 - r)], [0, 0, 0]); at(a, x - dx * 0.2, z - dz * 0.2, dx, dz); a.run(0.5);
    at(a, x, z, dx, dz);
    assert.doesNotThrow(() => stays(a, 2), name);
  }
});

test('a nudge moves a thing along the desk it stands on, and doesn\'t knock it off the near edge', () => {
  const desk = box3(4, 0, 4, 6, 0.75, 6), a = office({ colliders: [desk] }), r = a.ball.kind.radius;
  a.send([4.15, 0.75 + r, 5], [0, 0, 0]); at(a, 3.9, 8, 0, -1); a.run(0.5); assert.ok(a.ball.rest);
  at(a, 3.7, 5, 1, 0); // 0.3 from the desk, as near as you can stand: pushes it 0.41 from you, along the top
  assert.ok(a.ball.pos.x >= 4.11 - 1e-6, `${a.ball.pos.x}`); assert.ok(Math.abs(a.ball.pos.y - (0.75 + r)) < 0.01, `${a.ball.pos.y}`);
});

test('a throw through the open secret door gets through, point-blank too; shut, or too high, it doesn\'t', () => {
  const a = office({ colliders: walls(true) }); inHand(a, 9.7, doorZ, 1, 0); a.props.throw(V(1, 0, 0)); a.run(8);
  assert.ok(a.ball.rest); assert.ok(a.ball.pos.x > 10.2, `${a.ball.pos.x}`); assert.deepEqual(a.ball.home.toArray(), a.ball.pos.toArray(), 'and in there is home');
  const shut = office({ colliders: walls() }); inHand(shut, 9.3, doorZ, 1, 0); shut.props.throw(V(1, 0, 0));
  assert.doesNotThrow(() => stays(shut, 8));
  const high = office({ colliders: walls(true) }); inHand(high, 9.3, doorZ, 1, 0); high.props.throw(V(1, 1.2, 0).normalize()); // into the wall over the door
  assert.doesNotThrow(() => stays(high, 8));
  // from under the lintel it's already through: it comes off the underside into the games room
  const under = office({ colliders: walls(true) }); inHand(under, 9.7, doorZ, 1, 0); under.props.throw(V(0.45, 0.9, 0).normalize()); under.run(8);
  assert.ok(under.ball.rest && under.ball.pos.x > 0 && under.ball.pos.x < 23.2 && under.ball.pos.z > doorZ - 4.1 && under.ball.pos.z < doorZ + 3.1, `${under.ball.pos.toArray()}`);
});

test('picked up in the games room, it lands in the office clear of the shelf, wherever along the room it was', () => {
  for (const z of [3, doorZ - 1.6, 5, doorZ, 8.5]) {
    const a = office({ colliders: walls(true) }); a.run(0.05); a.player.position.set(12, 1.6, z); a.camera.position.set(12, 1.6, z); a.camera.updateMatrixWorld();
    a.ball.pos.set(12, 1, z); a.ball.rest = false; a.props.grab(a.ball); a.props.update(1 / 60); a.props.throw(null, true);
    const box = shelf(true); assert.ok(!box.containsPoint(a.ball.pos), `${z}: in the shelf at ${a.ball.pos.toArray()}`);
    a.player.position.set(1, 1.6, 1); a.camera.position.set(1, 1.6, 1); a.camera.updateMatrixWorld();
    assert.doesNotThrow(() => stays(a, 4), `${z}`);
  }
});

test('nothing stays lost: what comes to rest where nobody can reach goes home, and that\'s not saved as home', () => {
  const lost = [['beside the games room', [15, 0.11, 1]], ['past the far end of it', [15, 0.11, 9.6]], ['behind the kitchen', [-0.5, 0.11, 0.1]], ['past the kitchen\'s far end', [-0.5, 0.11, 9.8]], ['outside the window wall', [5, 0.11, -0.5]]];
  for (const [name, pos] of lost) {
    const a = office(), home = a.ball.home.clone();
    a.run(2); const start = a.ball.home.clone(); assert.deepEqual(start.toArray(), a.ball.pos.toArray());
    a.send(pos, [0, 0, 0]); a.run(1);
    assert.deepEqual(a.ball.home.toArray(), start.toArray(), name); assert.deepEqual(a.ball.pos.toArray(), start.toArray(), name); assert.ok(a.ball.rest, name); assert.ok(home);
  }
  for (const [name, pos] of [['the games room', [15, 0.11, 5]], ['the doorway', [10.05, 0.11, doorZ]], ['the office', [5, 0.11, 5]], ['the kitchen', [-3, 0.11, 5]], ['its doorway', [-0.05, 0.11, 8.5]]]) {
    const a = office(); a.run(2); a.send(pos, [0, 0, 0]); a.run(1);
    assert.deepEqual(a.ball.pos.toArray(), pos, name); assert.deepEqual(a.ball.home.toArray(), pos, name);
  }
});

test('a room that grows leaves nothing in the void: the ball in the old games room, the mug too', () => {
  const a = office(); a.run(2); a.send([15, 0.11, 3], [0, 0, 0]); a.run(1); assert.deepEqual(a.ball.home.toArray(), [15, 0.11, 3]);
  const mug = new THREE.Object3D(); mug.userData.loose = 'mug'; a.scene.add(mug); a.room.flightColliders = []; a.run(0.05);
  const b = mug.userData.prop(); a.player.position.set(14.5, 1.6, 3); a.camera.position.copy(a.player.position); a.camera.updateMatrixWorld(); b.pos.set(14.5, 1, 3); a.props.grab(b); a.run(0.05);
  a.props.throw(V(0, 0, 0), false); b.pos.set(14.5, 0.5, 3); b.vel.set(0, 0, 0); a.run(1); assert.ok(b.rest); assert.deepEqual([b.home.x, b.home.z], [14.5, 3]);
  a.player.position.set(1, 1.6, 1); a.camera.position.copy(a.player.position); a.camera.updateMatrixWorld(); a.run(0.05);
  a.size.depth = 14; a.room.flightColliders = []; a.run(1); // the door's now at z 10.2: both lie where no room is
  for (const thing of [a.ball, b]) {
    assert.ok(thing.rest); assert.ok(thing.pos.x > 0 && thing.pos.x < 10 && thing.pos.z > 0 && thing.pos.z < 14, `${thing.pos.toArray()}`);
    assert.deepEqual(thing.home.toArray(), thing.pos.toArray());
  }
});

test('in hand it sits on the palm, wherever you are', () => {
  const a = office(); inHand(a, 5, 5, 0, -1);
  assert.deepEqual(a.props.heldKind, a.ball.kind);
  const palm = V(-0.3, -0.27, -0.8).applyMatrix4(a.camera.matrixWorld);
  assert.ok(a.ball.pos.distanceTo(palm) < 1e-6, a.ball.pos.toArray().join());
});
test('how hard it leaves is how long you held: a tap a quarter, a full charge all of it, on the line you look along', () => {
  const a = office(), b = office();
  inHand(a, 5, 5, 0, -1); inHand(b, 5, 5, 0, -1);
  a.props.release(0, V(0, 0, -1)); b.props.release(1, V(0, 0, -1));
  assert.equal(a.props.holding, null); assert.ok(a.ball.grace > 0);
  assert.ok(Math.abs(a.ball.vel.z + a.ball.kind.throw * 0.25) < 1e-9, `tap ${a.ball.vel.z}`);
  assert.ok(Math.abs(b.ball.vel.z + b.ball.kind.throw) < 1e-9, `full ${b.ball.vel.z}`);
  assert.deepEqual(a.ball.pos.toArray(), [5, 1.6, 4.5]);
});
test('a charge called off leaves it in your hand', () => {
  const a = office(); inHand(a, 5, 5, 0, -1);
  a.props.abort();
  assert.equal(a.props.holding, a.ball);
});
test('with reduced motion a throw flies too, and comes down where a thrown thing does', () => {
  const quick = office({ colliders: walls() }), still = office({ colliders: walls(), still: true });
  for (const a of [quick, still]) { inHand(a, 5, 8, 0, -1); a.props.release(0.5, V(0, 0, -1)); }
  assert.equal(still.ball.rest, false, 'not there yet');
  assert.ok(still.ball.pos.z > 7, `${still.ball.pos.z}`);
  for (const a of [quick, still]) a.run(8);
  assert.ok(still.ball.rest && still.ball.pos.distanceTo(quick.ball.pos) < 1e-6, `${still.ball.pos.toArray()} ${quick.ball.pos.toArray()}`);
});
test('with reduced motion a thing let go of lands at once, as a thing thrown doesn\'t', () => {
  const dropped = office({ colliders: walls(), still: true }), thrown = office({ colliders: walls(), still: true });
  inHand(dropped, 5, 8, 0, -1); inHand(thrown, 5, 8, 0, -1);
  dropped.props.throw(null, true); thrown.props.release(1, V(0, 0, -1));
  assert.equal(dropped.ball.rest, true); assert.equal(dropped.ball.pos.y, dropped.ball.kind.low);
  assert.equal(thrown.ball.rest, false);
});
test('with reduced motion a ball let go of is drawn where it landed, not left in the hand', () => {
  const a = office({ colliders: walls(), still: true }), drawn = new THREE.Matrix4(), at = new THREE.Vector3();
  inHand(a, 5, 8, 0, -1); a.props.throw(null, true);
  a.scene.children[0].children[0].getMatrixAt(0, drawn); at.setFromMatrixPosition(drawn);
  assert.ok(a.ball.rest && at.distanceTo(a.ball.pos) < 1e-6, `${at.toArray()} ${a.ball.pos.toArray()}`);
});
test('with reduced motion a thing off a desk let go of is drawn where it landed too', () => {
  const a = office({ colliders: walls(), still: true }), mug = new THREE.Object3D(); mug.userData.loose = 'mug'; a.scene.add(mug); a.room.flightColliders = walls(); a.run(0.05);
  at(a, 5, 8, 0, -1);
  const b = mug.userData.prop(); b.pos.copy(a.player.position); a.props.grab(b); a.run(0.05); a.props.throw(null, true);
  const middle = b.kind.centre.clone().applyQuaternion(mug.quaternion).add(mug.position); // a thing's origin is at its foot, its `pos` at its middle
  assert.ok(b.rest && middle.distanceTo(b.pos) < 1e-6, `${middle.toArray()} ${b.pos.toArray()}`);
});

test('a thing that comes to rest in the kitchen stays there, out of the goose\'s reach', () => {
  const { props, run, ball, send } = office();
  send([-3, 0.5, 5], [0, 0, 0]); run(3);
  assert.ok(ball.rest && ball.pos.x === -3, 'it lies where it fell');
  assert.ok(ball.home.x === -3);
  assert.ok(!props.loose().includes(ball));
});

// A mug tipped over at this spot, facing away from you: the stream and what it leaves.
const pourAt = (a, x, z) => {
  a.view.mug = new THREE.Object3D(); a.view.mug.position.set(x, 1.2, z); a.scene.add(a.view.mug);
  a.camera.position.set(x, 1.6, z); a.props.pour(true); a.run(1);
  let stream, pool; a.scene.traverse(o => { if (o.isPoints) stream = o; else if (o.isInstancedMesh && o.geometry.type === 'PlaneGeometry') pool = o; });
  return { stream, pool };
};
const puddleAt = pool => { const m = new THREE.Matrix4(); pool.getMatrixAt(0, m); return new THREE.Vector3().setFromMatrixPosition(m); };

test('coffee poured in the kitchen is a stream, and a puddle where it lands', () => {
  const a = office(), { stream, pool } = pourAt(a, -3, 5);
  assert.ok(stream.visible, 'a stream'); assert.ok(pool.count > 0, 'a puddle');
  const at = puddleAt(pool);
  assert.ok(a.room.kitchen.inside(at), `${at.toArray()}`);
});

test('coffee poured in the doorway lands too, and past the building it is gone', () => {
  assert.ok(pourAt(office(), -0.05, 8.5).pool.count > 0, 'the kitchen\'s doorway');
  assert.ok(pourAt(office(), 3, 5).pool.count > 0, 'the office');
  assert.equal(pourAt(office(), -12, 5).pool.count, 0, 'outside');
});

test('the room grows: a puddle in the kitchen goes along with it, and one in the office stays', () => {
  const a = office(), there = pourAt(a, -3, 5).pool, b = office(), here = pourAt(b, 3, 5).pool;
  a.props.pour(false); b.props.pour(false); a.run(1); b.run(1);
  const was = puddleAt(there).z, stays = puddleAt(here).z;
  a.props.shift(a.room.kitchen.inside, 2); b.props.shift(b.room.kitchen.inside, 2); a.run(0.1); b.run(0.1);
  assert.ok(Math.abs(puddleAt(there).z - was - 2) < 1e-6);
  assert.ok(Math.abs(puddleAt(here).z - stays) < 1e-6);
});

// Drawn: a ball's instance has a size, a desk thing its visibility; puddles and drops are as many as are drawn.
const drawn = b => { if (b.obj) return b.obj.visible; const m = new THREE.Matrix4(); b.mesh.getMatrixAt(b.i, m); return m.determinant() !== 0; };
for (const [name, side, x] of [['kitchen', 'kitchen', -3], ['secret room', 'secret', 11]]) {
  test(`what's in the ${name} isn't drawn while the room is hidden, and an office one is`, () => {
    const a = office(), { pool } = pourAt(a, x, 5);
    a.props.pour(false); a.run(1);
    a.send([x, 0.5, 5], [0, 0, 0]); a.run(2);
    const other = a.scene.children[0].children[1].userData.prop(0);
    assert.ok(a.room[side].inside(a.ball.pos) && !a.room[side].inside(other.pos));
    const mug = new THREE.Object3D(); mug.userData.loose = 'mug'; a.scene.add(mug); a.room.flightColliders = []; a.run(0.05);
    const b = mug.userData.prop(); a.props.carry(b, () => V(x + 1, 0.5, 5)); a.run(0.05); a.props.drop(b); a.run(2);
    assert.ok(a.room[side].inside(b.pos), `${b.pos.toArray()}`);
    const puddles = pool.count;
    assert.ok(puddles > 0 && drawn(a.ball) && drawn(b) && drawn(other));
    a.room[side].shown = false; a.run(0.05);
    assert.equal(pool.count, 0, 'its puddles'); assert.ok(!drawn(a.ball), 'a ball'); assert.ok(!drawn(b), 'a desk thing'); assert.equal(mug.userData.prop(), null, 'and it can\'t be picked');
    assert.ok(drawn(other), 'one in the office');
    a.room[side].shown = true; a.run(0.05);
    assert.equal(pool.count, puddles); assert.ok(drawn(a.ball)); assert.ok(drawn(b)); assert.equal(mug.userData.prop(), b); assert.ok(drawn(other));
  });
}

test('a hidden room hides only what\'s in it: an office puddle stays, and drops in the air go', () => {
  const a = office(), { pool, stream } = pourAt(a, 3, 5), puddles = pool.count;
  a.room.kitchen.shown = a.room.secret.shown = false; a.run(0.05);
  assert.equal(pool.count, puddles); assert.ok(stream.visible, 'poured in the office');
  const b = office(), there = pourAt(b, -3, 5);
  assert.ok(there.stream.visible);
  b.room.kitchen.shown = false; b.run(0.02);
  assert.equal(there.stream.visible, false, 'poured in the kitchen'); assert.equal(there.stream.geometry.drawRange.count, 0);
});

test('the room grows: what lies hidden in the kitchen stays hidden, in its new place', () => {
  const a = office();
  a.send([-3, 0.5, 5], [0, 0, 0]); a.run(2); a.room.kitchen.shown = false; a.run(0.05);
  a.props.shift(a.room.kitchen.inside, 2); a.run(0.05);
  assert.ok(!drawn(a.ball));
  a.room.kitchen.shown = true; a.run(0.05);
  const m = new THREE.Matrix4(); a.ball.mesh.getMatrixAt(a.ball.i, m);
  assert.ok(Math.abs(new THREE.Vector3().setFromMatrixPosition(m).z - a.ball.pos.z) < 1e-9 && drawn(a.ball));
});

test('thrown past the kitchen, a thing goes back where it was', () => {
  const { run, ball, send } = office();
  const home = ball.home.clone();
  send([-12, 1, 5], [0, 0, 0]); run(0.1);
  assert.deepEqual(ball.pos.clone().setY(0).toArray(), home.clone().setY(0).toArray());
});

test('the room grows: what lies in the kitchen goes along with it, and what lies in the office stays', () => {
  const { props, run, ball, send, room, size, scene } = office();
  send([-3, 0.5, 5], [0, 0, 0]); run(3);
  const inKitchen = ball.pos.clone(), other = scene.children[0].children[1].userData.prop(0), stays = other.pos.clone();
  assert.ok(other.pos.x > 0);
  props.shift(room.kitchen.inside, 2);
  assert.equal(ball.pos.z, inKitchen.z + 2);
  assert.equal(ball.home.z, inKitchen.z + 2);
  assert.deepEqual(other.pos.toArray(), stays.toArray());
  size.depth += 2; room.flightColliders = [...room.flightColliders]; run(1);
  assert.ok(room.kitchen.inside(ball.pos) && Math.abs(ball.pos.z - inKitchen.z - 2) < 1e-9, 'it stays where it was put');
});
