import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGhosts, ghostLife, MOST, FADE } from '../client/office/ghosts.js';
import { KINDS, BALL_KINDS } from '../client/office/meeting.js';
import { BALLS, LOOSE, createProps } from '../client/office/props.js';
import { ITEMS, STARTS } from '../client/office/levels.js';
import { createTrickshot } from '../client/office/trickshot.js';
import { createHand } from '../client/office/throwing.js';
import { EYE } from '../client/office/player.js';
import { KITCHEN } from '../client/office/kitchen-plan.js';
import { WALL_T } from '../client/office/furniture.js';
import { kitchenDoor } from '../client/office/layout.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z), DT = 1 / 60;
const close = (a, b, d = 1e-9) => Math.abs(a - b) < d;

test('ghostLife fades after rest and by 6 s', () => {
  // Flying, it's whole until 5 s, then gone over the next second.
  assert.equal(ghostLife(0, null), 1); assert.equal(ghostLife(4.9, null), 1);
  assert.ok(close(ghostLife(5.5, null), 0.5)); assert.equal(ghostLife(6, null), 0); assert.equal(ghostLife(9, null), 0);
  // At rest, it fades over a second from then.
  assert.equal(ghostLife(1.5, 1.5), 1); assert.ok(close(ghostLife(2, 1.5), 0.5)); assert.equal(ghostLife(2.5, 1.5), 0);
  // Resting late is no longer life: still gone by 6 s.
  assert.ok(close(ghostLife(5.5, 5.4), 0.5)); assert.equal(ghostLife(6, 5.9), 0);
  for (let t = 0; t <= 8; t += 0.25) for (const rested of [null, 0, 2, 5.5]) { const life = ghostLife(t, rested); assert.ok(life >= 0 && life <= 1); if (t >= 6) assert.equal(life, 0); }
});

test("every throwable kind is in meeting.js's list", () => {
  const props = [...BALLS.map(kind => kind.key), ...Object.keys(LOOSE)], kitchen = Object.keys(ITEMS);
  assert.equal(new Set(BALLS.map(kind => kind.key)).size, BALLS.length, 'one name a ball');
  for (const key of Object.keys(LOOSE)) assert.equal(LOOSE[key].key, key);
  assert.deepEqual(new Set(KINDS), new Set([...props, ...kitchen]), 'nothing missing and nothing extra');
  assert.deepEqual(BALL_KINDS, BALLS.map(kind => kind.key), 'the shared balls');
  for (const kind of BALLS) assert.ok(kind.spots(40, 40).length <= 8, `${kind.key}: few enough for a word`);
});

// The real props on a stand-in office, as tests/office-flight.test.mjs has it: no document in Node, so a blank canvas for textures.
const blank = () => new Proxy({}, { get: (t, k) => k in t ? t[k] : () => ({ addColorStop() {} }), set: (t, k, v) => { t[k] = v; return true; } });
const withDocument = fn => { globalThis.document = { createElement: () => ({ getContext: blank }) }; try { return fn(); } finally { delete globalThis.document; } };
const box3 = (x0, y0, z0, x1, y1, z1) => new THREE.Box3(V(x0, y0, z0), V(x1, y1, z1));
const WEST = -(WALL_T + KITCHEN.width);
function office({ colliders = [], still = false, people = [] } = {}) {
  const heard = [], told = [], scene = new THREE.Scene(), player = { position: V(1, 1.6, 1), forward: V(0, 0, -1), yaw: 0, flight: null }, size = { width: 10, depth: 10 };
  const room = { flightColliders: colliders, kitchen: { shown: true, within: [], inside: p => { const z = p.z - kitchenDoor(size.depth); return p.x < -WALL_T / 2 && p.x > WEST && z > KITCHEN.back && z < KITCHEN.front; } }, secret: { shown: true, bounds: r => ({ left: WEST, width: r.width + 3 - WEST, depth: r.depth }), inside: () => false, get spot() { return V(9.1, 0, size.depth - 3.8); } } };
  const characters = new Map(people.map(p => [p.id, { scale: 1, root: { visible: true } }]));
  const cast = { characters, positionOf: id => { const p = people.find(p => p.id === id); return p && V(p.x, p.top + 0.08, p.z); } };
  const camera = new THREE.PerspectiveCamera(); camera.position.set(1, 1.6, 1);
  const props = withDocument(() => createProps(scene, { room, cast, camera, player, view: { amount: 0, drunk: 0 }, bounds: () => size, reducedMotion: () => still, onHit: (id, line) => heard.push([id, line]), hand: createHand(camera) }));
  props.onThrow = thrown => told.push(thrown);
  const root = scene.children[0], mine = () => root.children.filter(node => node.isInstancedMesh), ball = root.children[0].userData.prop(0); // the football
  const run = (seconds, rate = 60) => { for (let i = 0; i < seconds * rate; i++) props.update(1 / rate); };
  run(0.1);
  return { props, run, ball, root, mine, player, camera, heard, told, scene };
}

test("a throw is told with its kind and where it starts, in the room's own frame; a drop isn't", () => {
  const a = office(), { ball, props, player, camera, told } = a;
  for (const [kind, key] of [[BALLS[0], 'football'], [BALLS[1], 'paper'], [LOOSE.mug, 'mug']]) {
    ball.kind = kind; ball.pos.set(1.3, 1.2, 1); ball.rest = false; props.grab(ball); a.run(0.05);
    props.throw(V(1, 0.2, 0).normalize(), false, 1);
    const thrown = told.at(-1);
    assert.equal(thrown.kind, key);
    assert.deepEqual(thrown.pos, ball.pos.toArray()); assert.deepEqual(thrown.vel, ball.vel.toArray()); assert.deepEqual(thrown.spin, ball.spin.toArray());
    assert.ok(thrown.spin.some(Boolean), 'the office\'s throws always tumble');
    a.run(2); player.position.set(1, 1.6, 1); camera.position.copy(player.position);
  }
  const before = told.length;
  ball.pos.set(1.3, 1.2, 1); ball.rest = false; props.grab(ball); a.run(0.05);
  props.throw(null, true);
  assert.equal(told.length, before, 'let go is not a throw');
});

test("a friend's throw flies, lands and is gone, and nothing of yours moves or minds", () => {
  const a = office({ people: [{ id: 'agent', x: 7.6, z: 7.4, top: 1.4 }] }), { props, root, mine, heard } = a;
  const yours = () => mine().map(mesh => Array.from(mesh.instanceMatrix.array));
  a.run(1); const was = yours(), count = root.children.length;
  // Straight through the football (at 6.8, 7.4) and on into the agent behind it, along the floor.
  assert.equal(props.ghost({ kind: 'paper', pos: [5, 0.3, 7.4], vel: [6, 0.5, 0], spin: [3, 1, 2] }), true);
  assert.equal(root.children.length, count + 1);
  const copy = root.children.at(-1), start = copy.position.clone();
  a.run(0.4);
  assert.ok(copy.position.distanceTo(start) > 0.5, 'it flies');
  a.run(1.6);
  assert.ok(copy.position.y < 0.06, `it lands: ${copy.position.toArray()}`);
  assert.deepEqual(yours(), was, 'the football and the paper balls are where they were');
  assert.deepEqual(heard, [], 'nobody minds');
  // Faded once at rest, then gone. Its own material is kept for the next copy (a disposed one would take its shader with it), until the office goes.
  const material = copy.material; let disposed = false; material.addEventListener('dispose', () => { disposed = true; });
  assert.ok(material.transparent && material !== BALLS[1].material);
  a.run(4.5);
  assert.equal(root.children.length, count); assert.equal(copy.parent, null); assert.equal(disposed, false);
  props.dispose(); assert.ok(disposed);
});

test('a copy fades out over a second once it rests, and its ink goes with the fade', () => {
  const a = office(), { props, root } = a;
  props.ghost({ kind: 'football', pos: [3, 0.12, 3], vel: [0, 0, 0], spin: [1, 0, 0] });
  const copy = root.children.at(-1), ink = copy.children.find(node => node.userData.outline);
  assert.ok(ink?.visible, 'outlined like the real one');
  let rested = null;
  for (let i = 0; i < 120 && copy.material.opacity === 1; i++) { a.run(DT); rested ??= i; }
  assert.ok(copy.material.opacity < 1 && copy.material.opacity > 0.9); assert.equal(ink.visible, false);
  a.run(0.5); assert.ok(close(copy.material.opacity, 0.5, 0.05), `${copy.material.opacity}`);
});

test("copies can't be picked up, clicked or carried off, and there are at most 12, the oldest going first", () => {
  const a = withDocument(() => office()), { props, root } = a, count = root.children.length;
  const kinds = [...Object.keys(LOOSE), 'paper', 'football', 'paper', 'paper', 'paper'];
  assert.equal(kinds.length, MOST);
  withDocument(() => { for (const kind of kinds) props.ghost({ kind, pos: [5, 1, 5], vel: [0, 0, 0], spin: [0.5, 0, 0] }); });
  const copies = root.children.slice(count);
  assert.equal(copies.length, MOST);
  for (const copy of copies) { assert.equal(copy.userData.loose, undefined); copy.traverse(node => assert.equal(node.userData.prop, undefined)); }
  a.run(0.05);
  root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(V(5, 3, 5), V(0, -1, 0));
  assert.ok(new THREE.Raycaster(V(5, 3, 5), V(0, -1, 0)).intersectObjects(copies.map(copy => new THREE.Mesh(copy.geometry, copy.material).copy(copy, false))).length, 'the ray goes through them');
  assert.equal(ray.intersectObjects(copies, true).length, 0);
  assert.deepEqual(props.loose().filter(b => copies.includes(b.obj)), [], 'not for the goose');
  props.ghost({ kind: 'paper', pos: [5, 1, 5], vel: [0, 0, 0], spin: [1, 0, 0] }); props.ghost({ kind: 'paper', pos: [5, 1, 5], vel: [0, 0, 0], spin: [1, 0, 0] });
  assert.equal(root.children.length, count + MOST);
  assert.equal(copies[0].parent, null); assert.equal(copies[1].parent, null); assert.equal(copies[2].parent, root);
  assert.equal(props.ghost({ kind: 'rubber', pos: [5, 1, 5], vel: [0, 0, 0], spin: [1, 0, 0] }), false, 'not one of the office\'s things');
  assert.equal(props.ghost({ kind: 'toString', pos: [5, 1, 5], vel: [0, 0, 0], spin: [1, 0, 0] }), false);
});

test('with reduced motion a copy is just where it lands, whole, and gone a second later', () => {
  const a = office({ still: true }), { props, root } = a, count = root.children.length;
  props.ghost({ kind: 'paper', pos: [3, 1.5, 3], vel: [4, 1, 0], spin: [1, 0, 0] });
  const copy = root.children.at(-1);
  assert.ok(copy.position.y < 0.06 && copy.position.x > 4, `already down: ${copy.position.toArray()}`);
  a.run(0.5); assert.equal(copy.material.opacity, 1);
  a.run(0.6); assert.equal(root.children.length, count);
});

test('going through the door takes every copy along: clearGhosts', () => {
  const a = office(), { props, root } = a, count = root.children.length;
  props.ghost({ kind: 'paper', pos: [3, 1, 3], vel: [2, 1, 0], spin: [1, 0, 0] }); props.ghost({ kind: 'football', pos: [4, 1, 4], vel: [0, 2, 1], spin: [0, 1, 0] });
  const copies = root.children.slice(count);
  assert.equal(copies.length, 2);
  props.clearGhosts();
  assert.equal(root.children.length, count); for (const copy of copies) assert.equal(copy.parent, null);
  a.run(0.5); assert.equal(root.children.length, count, 'and nothing comes back');
});

// A thrown thing's materials, for the next copy: a new transparent one would be a new shader to compile on a phone, each throw.
test("a copy that's gone keeps its material for the next of its kind: no new clone and nothing disposed in between; dispose lets them go", () => {
  const source = new THREE.MeshBasicMaterial(), clone = source.clone.bind(source); let clones = 0, disposed = 0;
  source.clone = () => { clones++; const m = clone(); m.addEventListener('dispose', () => { disposed++; }); return m; };
  const kind = { radius: 0.05, low: 0.05, bounce: 0.3, roll: 4, drag: 0.3, tumble: 1, upright: false };
  const ghosts = createGhosts({ world: () => ({ colliders: [], columns: [], ceiling: 3 }) }), parent = new THREE.Group();
  const throwOne = () => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), source); ghosts.add(parent, mesh, kind, { pos: [0, 0.5, 0], vel: [1, 0, 0], spin: [0, 0, 0] }); return mesh; };
  const first = throwOne(), material = first.material;
  assert.notEqual(material, source); assert.equal(material.transparent, true); assert.equal(clones, 1);
  for (let i = 0; i < 7 * 60 && parent.children.length; i++) ghosts.update(1 / 60);
  assert.equal(first.parent, null, 'faded and gone'); assert.equal(disposed, 0);
  const second = throwOne();
  assert.equal(second.material, material); assert.equal(material.opacity, 1); assert.equal(clones, 1); assert.equal(disposed, 0);
  ghosts.clear(); assert.equal(second.parent, null); assert.equal(disposed, 0);
  throwOne(); throwOne(); assert.equal(clones, 2, 'two at once need two');
  ghosts.dispose(); assert.equal(disposed, 2); assert.equal(parent.children.length, 0);
});

// Trickshot on a stand-in kitchen, as tests/office-trickshot.test.mjs has it.
const ORIGIN = { x: -0.2, z: 5 };
function kitchen({ reduced = false } = {}) {
  const group = new THREE.Group(), props = { holding: false, throw() {}, loose: () => [] }, told = [];
  const hand = { palm: new THREE.Object3D(), held: null, hold(mesh) { hand.held = mesh; }, free() { hand.held?.removeFromParent(); hand.held = null; }, pull() {} };
  const room = { origin: ORIGIN, group, shut() {} }, memory = { value: null, getItem: () => memory.value, setItem(k, v) { memory.value = v; } };
  const game = createTrickshot({ kitchen: room, hand, props, view: { play() {}, gameAmount: 0 }, onPlay: () => {}, store: memory, reducedMotion: () => reduced });
  game.build(group); game.onThrow = thrown => told.push(thrown);
  return { game, group, hand, told };
}
const look = (yaw, pitch) => V(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
const IN = { yaw: 2.416772208600941, pitch: 0.17453292519943295, charge: 0.625 }; // the paper ball into the sink (tests/office-trickshot.test.mjs)

test("a kitchen throw is told in the office's frame with no spin, and a friend's kitchen lands it in the same place", () => {
  const me = kitchen(), friend = kitchen();
  me.game.start(me.game.entry('paper')); me.game.enter(); const { x, z } = me.game.stand(); me.hand.palm.position.set(x - 0.2, EYE - 0.27, z + 0.2);
  me.game.release(IN.charge, look(IN.yaw, IN.pitch));
  assert.equal(me.told.length, 1);
  const thrown = me.told[0], result = me.game.run.result;
  assert.equal(thrown.kind, 'paper'); assert.deepEqual(thrown.spin, [0, 0, 0]);
  const eye = V(STARTS.island.x + ORIGIN.x, EYE, STARTS.island.z + ORIGIN.z);
  assert.ok(V(...thrown.pos).distanceTo(eye) <= 0.5 + 1e-9, 'from the mark, in the office\'s frame');
  assert.ok(result.made && result.rest && result.time < 5, `${result.time}`);
  // The friend's kitchen plays it as a copy of the paper ball, in its own frame, to where the shot really ended.
  const count = friend.group.children.length;
  assert.equal(friend.game.ghost(thrown), true);
  const copy = friend.group.children.at(-1), item = friend.game.item('paper'), at = item.position.clone();
  assert.equal(friend.group.children.length, count + 1); assert.notEqual(copy, item);
  for (let t = 0; t < result.time + 0.05; t += DT) friend.game.update(DT, null, false, true);
  assert.ok(copy.position.distanceTo(V(...result.pos)) < 0.01, `${copy.position.toArray()} vs ${result.pos}`);
  assert.ok(item.position.equals(at), 'the friend\'s own paper ball stays put');
  friend.group.updateMatrixWorld(true);
  assert.equal(new THREE.Raycaster(V(...result.pos).setY(2), V(0, -1, 0)).intersectObject(copy, true).length, 0);
  assert.ok(new THREE.Raycaster(V(...result.pos).setY(2), V(0, -1, 0)).intersectObject(new THREE.Mesh(copy.geometry, copy.material).copy(copy, false)).length, 'the ray goes through it');
  for (let t = 0; t < 6; t += DT) friend.game.update(DT, null, false, true);
  assert.equal(copy.parent, null);
  // Going through the door takes a kitchen copy along too.
  friend.game.ghost(thrown); const again = friend.group.children.at(-1);
  assert.equal(again.parent, friend.group);
  friend.game.clearGhosts(); assert.equal(again.parent, null); assert.equal(friend.group.children.length, count);
});

test("Trickshot plays only its own throws: one of its items, with no spin", () => {
  const { game } = kitchen();
  assert.equal(game.ghost({ kind: 'paper', pos: [-3, 1.6, 3], vel: [1, 1, 0], spin: [2, 0, 1] }), false, 'the office\'s paper ball tumbles');
  assert.equal(game.ghost({ kind: 'football', pos: [-3, 1.6, 3], vel: [1, 1, 0], spin: [0, 0, 0] }), false);
  assert.equal(game.ghost({ kind: 'rubber', pos: [-3, 1.6, 3], vel: [1, 1, 0], spin: [0, 0, 0] }), true);
});

test("a copy held in the goose's beak follows it, and falls and fades once let go", () => {
  for (const still of [false, true]) {
    const a = withDocument(() => office({ still })), { props, root } = a, count = root.children.length, loose = props.loose().length;
    const beak = V(3, 0.5, 3), held = withDocument(() => props.holdGhost('mug', () => beak)), copy = root.children.at(-1);
    assert.equal(root.children.length, count + 1); assert.equal(props.loose().length, loose);
    beak.set(4, 0.5, 3); a.run(2); assert.ok(copy.position.distanceTo(beak) < 0.2, 'follows the beak, and lasts');
    held.release(); a.run(FADE - 0.3); assert.equal(copy.parent, root);
    a.run(1.5); assert.equal(copy.parent, null);
    held.release(); // again: nothing
  }
  // a kind the props can't copy (the kitchen's plate)
  assert.equal(withDocument(() => office()).props.holdGhost('plate', () => V(0, 0, 0)), null);
});

test('a held copy is never the one the MOST eviction takes, and release after clear does nothing', () => {
  const a = withDocument(() => office()), { props, root } = a, held = props.holdGhost('mug', () => V(3, 0.5, 3)), copy = root.children.at(-1);
  for (let i = 0; i < MOST + 3; i++) props.ghost({ kind: 'mug', pos: [5, 1, 5], vel: [0, 0, 0], spin: [0, 0, 0] });
  assert.equal(copy.parent, root, 'still held');
  props.clearGhosts(); assert.equal(copy.parent, null); held.release(); // nothing, no throw
});
