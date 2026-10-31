import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player, EYE, free, gameKey, resolveStep, standNear } from '../client/office/player.js';
import { walkGrid, findPath } from '../client/office/path.js';

const box = (x1, z1, x2, z2) => new THREE.Box3(new THREE.Vector3(x1, 0, z1), new THREE.Vector3(x2, 1, z2));
const room = { width: 10, depth: 10 };

test('walls and desks still block you', () => {
  const p = resolveStep(new THREE.Vector3(2, 1.5, 2), new THREE.Vector3(1, 0, 0), [box(2.5, 0, 3, 4)], room);
  assert.equal(p.x, 2);
});
test('a desk that appears on top of you does not trap you', () => {
  const p = resolveStep(new THREE.Vector3(2, 1.5, 2), new THREE.Vector3(-0.1, 0, 0), [box(1.5, 1.5, 2.5, 2.5)], room);
  assert.equal(p.x, 1.9);
});
test('you stay inside the room', () => {
  const p = resolveStep(new THREE.Vector3(5, 1.5, 14), new THREE.Vector3(0, 0, 0.1), [], room);
  assert.ok(p.z <= 10);
});

test('you stand in front of someone, on the side you come from', () => {
  const p = standNear(new THREE.Vector3(5, 1.2, 5), new THREE.Vector3(5, 1.5, 9), [], room);
  assert.ok(Math.abs(p.x - 5) < 1e-9 && Math.abs(p.z - 6.1) < 1e-9);
});
test('a desk in the way puts you beside them instead', () => {
  const target = new THREE.Vector3(5, 1.2, 5), p = standNear(target, new THREE.Vector3(5, 1.5, 9), [box(3.5, 5.4, 6.5, 6.5)], room);
  assert.ok(p.z < 5.4 - 0.3 || p.x < 3.5 - 0.3 || p.x > 6.5 + 0.3);
  assert.ok(Math.abs(Math.hypot(p.x - 5, p.z - 5) - 1.1) < 1e-9);
});
test('nowhere to stand: null', () => {
  assert.equal(standNear(new THREE.Vector3(5, 1.2, 5), new THREE.Vector3(5, 1.5, 9), [box(3, 3, 7, 7)], room), null);
});

// A Player without a browser: its listeners are kept so a test can press keys and move the mouse.
function walker(t, colliders, { route = (from, to) => findPath(walkGrid(colliders, room), from, to), lookHeld } = {}) {
  const was = { document: globalThis.document, window: globalThis.window }, handlers = {};
  const target = { addEventListener: (type, fn) => { handlers[type] = fn; }, removeEventListener() {} };
  globalThis.document = { ...target, body: { classList: { contains: () => false } }, querySelector: () => null, activeElement: null };
  globalThis.window = target;
  t.after(() => Object.assign(globalThis, was));
  const player = new Player({ ...target, setPointerCapture() {} }, { colliders: () => colliders, room: () => room, onPick() {}, route, lookHeld });
  player.place(5, 2, 0);
  const press = code => handlers.keydown({ code, target: null, preventDefault() {} });
  const run = (seconds, each) => { for (let i = 0; i < seconds * 60; i++) { player.update(1 / 60); each?.(); } };
  return { player, press, handlers, run };
}
const pod = [box(2, 4, 8, 6)], beyond = new THREE.Vector3(5, 0, 8);
const at = (player, x, z) => Math.hypot(player.position.x - x, player.position.z - z);

test('a walk to a floor point goes round the furniture and arrives', t => {
  const { player, run } = walker(t, pod);
  let arrived = false;
  player.walkTo(beyond, () => { arrived = true; });
  run(8, () => assert.ok(free(player.position, pod, room), 'never into the pod'));
  assert.ok(arrived && at(player, 5, 8) < 0.1, 'got there');
  assert.equal(player.position.y, EYE);
});
test('with no way through it still heads straight there, and stops at what blocks it', t => {
  const wall = [box(0, 4, 10, 6)];
  const { player, run } = walker(t, wall);
  let called = false;
  player.walkTo(beyond, () => { called = true; }, 0, true);
  run(4);
  assert.equal(player.target, null);
  assert.ok(called && player.position.z < 4, 'gives up at the wall, and a talk still goes ahead');
});
test('stopping short counts on the last leg, not through the furniture', t => {
  const { player, run } = walker(t, pod);
  let arrived = false;
  player.walkTo(new THREE.Vector3(5, 0, 6.5), () => { arrived = true; }, 4.6);
  run(1 / 60);
  assert.equal(arrived, false, 'already within 4.6 m as the crow flies, but the way round is much further');
  run(8);
  assert.ok(arrived && player.position.z > 6, 'came round the pod first');
});
test('WASD calls off a walk, and whatever it was going to do', t => {
  for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
    const { player, press, run } = walker(t, pod);
    let arrived = false;
    player.walkTo(beyond, () => { arrived = true; });
    run(0.2);
    press(code);
    assert.equal(player.target, null, code);
    run(8);
    assert.equal(arrived, false, code);
  }
});
test('a walk started with a walking key held is called off too, not resumed on letting go', t => {
  const { player, press, handlers, run } = walker(t, pod);
  press('KeyD');
  player.walkTo(beyond);
  run(0.1);
  handlers.keyup({ code: 'KeyD', shiftKey: false });
  const stopped = player.position.clone();
  run(1);
  assert.equal(player.target, null);
  assert.ok(player.position.distanceTo(stopped) < 1e-9);
});
test('the arrow keys look around on the way without stopping it', t => {
  const { player, press, handlers, run } = walker(t, pod);
  let arrived = false;
  player.walkTo(beyond, () => { arrived = true; });
  run(0.2);
  press('ArrowLeft');
  run(0.5);
  handlers.keyup({ code: 'ArrowLeft', shiftKey: false });
  const yaw = player.yaw;
  run(8);
  assert.ok(arrived, 'still got there');
  assert.equal(player.yaw, yaw, 'and the view stayed where it was left');
});
test('the mouse looks around on the way, and the view stays yours', t => {
  const { player, handlers, run } = walker(t, pod);
  player.locked = true;
  let arrived = false;
  player.walkTo(beyond, () => { arrived = true; });
  run(0.2);
  handlers.pointermove({ movementX: 200, movementY: 40, pointerId: 1 });
  const { yaw, pitch } = player;
  run(8);
  assert.ok(arrived);
  assert.equal(player.yaw, yaw);
  assert.equal(player.pitch, pitch);
});
test('untouched, the view turns to face the way it walks; a twitch of the mouse does not stop that', t => {
  const { player, handlers, run } = walker(t, []);
  player.locked = true; player.yaw = Math.PI;
  player.walkTo(beyond);
  handlers.pointermove({ movementX: 2, movementY: -1, pointerId: 1 });
  run(0.6);
  assert.ok(Math.abs(Math.sin(player.yaw)) < 0.05 && Math.cos(player.yaw) > 0.95, `yaw ${player.yaw}`);
});

const circle = { width: 16, depth: 16, inside: ({ x, z }) => Math.hypot(x - 8, z - 8) <= 6.6 };
test('while the look is held nothing turns the view, and you come back to the same aim', t => {
  let held = false;
  const { player, press, handlers, run } = walker(t, [], { lookHeld: () => held });
  player.yaw = 1; player.pitch = 0.2; player.locked = true;
  held = true;
  handlers.pointermove({ movementX: 200, movementY: 40, pointerId: 1 });
  press('ArrowLeft'); press('ArrowUp'); player.spin = 3;
  run(0.5);
  assert.equal(player.yaw, 1); assert.equal(player.pitch, 0.2); assert.equal(player.spin, 0);
  held = false;
  run(0.1);
  assert.ok(player.yaw > 1, 'an arrow still down turns again');
  const { yaw } = player;
  handlers.pointermove({ movementX: 200, movementY: 0, pointerId: 1 });
  assert.notEqual(player.yaw, yaw, 'and so does the mouse');
});

test('a key in a game: seated, E clicks while it\'s held and the arrows leave', () => {
  const seated = { free: false }, key = (code, repeat = false) => ({ key: code === 'Escape' ? 'Escape' : '', code, repeat });
  for (const repeat of [false, true]) {
    assert.equal(gameKey(key('KeyE', repeat), seated), 'click');
    for (const code of ['KeyW', 'KeyD', 'Space', 'ArrowLeft', 'Escape']) assert.equal(gameKey(key(code, repeat), seated), 'leave', code);
  }
  assert.equal(gameKey(key('KeyQ'), seated), null);
});
test('a key in a free game: a held one doesn\'t leave or throw again, and the arrows look', () => {
  const free = { free: true, holding: true }, key = (code, repeat = false) => ({ key: code === 'Escape' ? 'Escape' : '', code, repeat });
  assert.equal(gameKey(key('KeyE'), free), 'charge');
  assert.equal(gameKey(key('KeyE'), { free: true, holding: false }), 'click');
  assert.equal(gameKey(key('KeyE', true), free), null);
  assert.equal(gameKey(key('KeyE', true), { free: true, holding: false }), null);
  for (const code of ['KeyW', 'KeyS', 'Space']) { assert.equal(gameKey(key(code), free), 'leave', code); assert.equal(gameKey(key(code, true), free), null, code); }
  for (const repeat of [false, true]) assert.equal(gameKey(key('ArrowUp', repeat), free), 'look');
  assert.equal(gameKey(key('Escape', true), free), 'leave');
  assert.equal(gameKey(key('KeyQ'), free), null);
});

test('a round room stops you at its edge', () => {
  let p = new THREE.Vector3(14.5, 1.5, 8);
  for (let i = 0; i < 20; i++) p = resolveStep(p, new THREE.Vector3(.2, 0, 0), [], circle);
  assert.ok(circle.inside(p));
});
test('walking into a round wall at an angle slides along it', () => {
  let p = new THREE.Vector3(14.5, 1.5, 8);
  for (let i = 0; i < 10; i++) p = resolveStep(p, new THREE.Vector3(.1, 0, .2), [], circle);
  assert.ok(circle.inside(p));
  assert.ok(p.z > 8.5);
});
test('a round room still has colliders', () => {
  assert.equal(free(new THREE.Vector3(8, 1.5, 8), [box(7.5, 7.5, 8.5, 8.5)], circle), false);
});
test('a rectangular room is unchanged', () => {
  const p = resolveStep(new THREE.Vector3(9.9, 1.5, 5), new THREE.Vector3(1, 0, 0), [], { width: 10, depth: 10 });
  assert.ok(p.x < 10);
  assert.equal(free(new THREE.Vector3(5, 1.5, 5), [], { width: 10, depth: 10 }), true);
});

test('free and resolveStep respect a left edge', () => {
  const west = new THREE.Vector3(-5, 1.5, 5), wide = { left: -10, width: 10, depth: 10 };
  assert.equal(free(west, [], wide), true);
  assert.equal(free(west, [], room), false, 'without a left edge the building starts at 0');
  assert.equal(free(new THREE.Vector3(-9.9, 1.5, 5), [], wide), false, 'it keeps a body clear of the edge');
  assert.equal(resolveStep(west, new THREE.Vector3(-1, 0, 0), [], wide).x, -6);
  assert.ok(Math.abs(resolveStep(new THREE.Vector3(-9.5, 1.5, 5), new THREE.Vector3(-2, 0, 0), [], wide).x + 9.7) < 1e-9, 'stopped a body short of it');
  assert.ok(resolveStep(new THREE.Vector3(1, 1.5, 5), new THREE.Vector3(-3, 0, 0), [], room).x > 0, 'no left edge: stopped at the old wall');
});
