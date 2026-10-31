import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { chargeAt, createCharge, createHand, handModel, launch, throwSpeed } from '../client/office/throwing.js';
import { Player } from '../client/office/player.js';

test('a tap tosses at a quarter of full speed, a second gets all of it, and it holds', () => {
  const kind = { throw: 8 };
  assert.equal(throwSpeed(kind, chargeAt(0)), 2);
  assert.equal(throwSpeed(kind, chargeAt(1)), 8);
  assert.equal(chargeAt(3), 1);
});
test('a cancelled charge throws nothing when the button comes up', () => {
  const c = createCharge(); c.press(10); c.cancel();
  assert.equal(c.active, false);
  assert.equal(c.release(11), null);
});
test('a release with no press throws nothing', () => assert.equal(createCharge().release(5), null));
test('launch leaves on the line you look along, with the walk and the lift added', () => {
  const { pos, vel } = launch({ throw: 8 }, 1, { position: new THREE.Vector3(0, 1.5, 0) }, new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0));
  assert.deepEqual(pos.toArray(), [0, 1.5, -0.5]); assert.deepEqual(vel.toArray(), [1, 1.2, -8]);
});

test('the palm sits where things used to float, pulls back with the charge, and a let go puts it back', () => {
  const hands = new THREE.Group(), hand = createHand(hands), at = new THREE.Vector3();
  assert.deepEqual(hand.palm.getWorldPosition(at).toArray(), [-0.3, -0.27, -0.8]);
  assert.equal(hand.palm.visible, false);
  hand.hold(null, 0.1); assert.ok(hand.palm.visible && hands.userData.full);
  hand.pull(1); assert.ok(hand.palm.getWorldPosition(at).z > -0.8 + 0.1, 'back towards you');
  hand.free(); assert.deepEqual(hand.palm.getWorldPosition(at).toArray(), [-0.3, -0.27, -0.8]);
  assert.ok(!hand.palm.visible && !hands.userData.full);
});
test('a real mesh goes with the hand, its middle on the palm, until it\'s let go of', () => {
  const hand = createHand(new THREE.Group()), mesh = new THREE.Mesh();
  mesh.position.set(9, 9, 9); hand.hold(mesh, 0.1);
  assert.equal(mesh.parent, hand.palm); assert.deepEqual(mesh.position.toArray(), [0, 0, 0]);
  hand.free(); assert.equal(mesh.parent, null);
});
test('held, a real mesh keeps out of what a click finds too; let go of, it counts again', () => {
  const hand = createHand(new THREE.Group()), ball = new THREE.Mesh(new THREE.SphereGeometry(0.1)), part = new THREE.Mesh(new THREE.SphereGeometry(0.1)); ball.add(part);
  const hits = () => { ball.updateWorldMatrix(true, true); const at = ball.getWorldPosition(new THREE.Vector3()); return new THREE.Raycaster(at.setZ(at.z + 5), new THREE.Vector3(0, 0, -1)).intersectObject(ball, true).length; };
  assert.equal(hits(), 2);
  hand.hold(ball, 0.1); assert.equal(hits(), 0);
  hand.free(); assert.equal(hits(), 2);
  const own = () => {}; part.raycast = own; hand.hold(ball, 0.1); hand.free();
  assert.ok(part.raycast === own, 'its own stays its own'); assert.equal(hits(), 1);
});
test('taking another thing in hand lets go of the one before', () => {
  const hand = createHand(new THREE.Group()), one = new THREE.Mesh(new THREE.SphereGeometry(0.1)), two = new THREE.Mesh(new THREE.SphereGeometry(0.1));
  hand.hold(one, 0.1); hand.hold(two, 0.1);
  assert.ok(one.parent === null && two.parent === hand.palm); // not equal(): printing a hand when it fails runs Node out of memory
  one.updateWorldMatrix(true, true);
  assert.equal(new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1)).intersectObject(one).length, 1);
  hand.hold(null, 0.1); assert.ok(two.parent === null);
});
test('the hand keeps out of what a click finds', () => {
  const hand = createHand(new THREE.Group()), ray = new THREE.Raycaster(), centre = new THREE.Vector3();
  hand.hold(null, 0.1); hand.palm.updateWorldMatrix(true, true);
  let meshes = 0;
  hand.palm.traverse(node => {
    if (!node.isMesh) return;
    meshes++; node.geometry.computeBoundingSphere(); node.localToWorld(centre.copy(node.geometry.boundingSphere.center));
    ray.set(centre.clone().setZ(centre.z + 5), new THREE.Vector3(0, 0, -1));
    assert.equal(ray.intersectObject(node, false).length, 0);
  });
  assert.ok(meshes >= 1);
});
const ITEMS = [[0.03, 0.015], [0.04, 0.04], [0.045, 0.045], [0.06, 0.05], [0.07, 0.05], [0.08, 0.012], [0.11, 0.11], [0.12, 0.054], [0.16, 0.13]];
const handBody = (radius, low) => { const hand = createHand(new THREE.Group()); hand.hold(null, radius, low); let body; hand.palm.traverse(n => { if (n.isMesh) body = n; }); return body.geometry; };
test('the hand holds round what it holds, whatever its size: palm under it, fingers up the right, thumb up the left, the arm off the bottom left', () => {
  for (const [radius, low] of ITEMS) {
    const at = handBody(radius, low).attributes.position, v = new THREE.Vector3(); let right = -9, left = 9, top = -9;
    for (let i = 0; i < at.count; i++) { v.fromBufferAttribute(at, i); if (v.y > -low * 0.5) { right = Math.max(right, v.x); left = Math.min(left, v.x); top = Math.max(top, v.y); } }
    assert.ok(right > radius * 0.5 && left < -radius * 0.5, `round both sides of ${radius}: ${left}, ${right}`);
    assert.ok(top < radius + 0.03, `nothing stands up over it: ${top}`);
    const box = new THREE.Box3().setFromBufferAttribute(at);
    assert.ok(box.min.x < -0.3 && box.min.y < -0.45, `the arm goes off the bottom left: ${box.min.x}, ${box.min.y}`);
  }
});
test('a hand fitted once is kept, and what\'s flatter than it\'s wide gets a flatter one', () => {
  const hand = createHand(new THREE.Group()); let body; hand.hold(null, 0.08, 0.012); hand.palm.traverse(n => { if (n.isMesh) body = n; });
  const flat = body.geometry; hand.hold(null, 0.08); assert.ok(body.geometry !== flat); hand.hold(null, 0.08, 0.012); assert.ok(body.geometry === flat);
});
test('the arm runs off to the bottom left of the fist, for the darts as it did', () => {
  const { arm, grip, fist } = handModel(), box = new THREE.Box3().setFromObject(arm);
  assert.equal(grip.parent, arm); assert.deepEqual(grip.rotation.toArray().slice(0, 3), [0.3, -0.5, 0.2]);
  assert.ok(box.min.x < fist.x - 0.1 && box.min.y < fist.y - 0.2 && box.max.z > fist.z + 0.1);
});

// A Player without a browser, and what it tells the office. `holding` is whether a press has something to charge. What was there
// before the first fake goes back after each test, as `npm test` runs every file in one process.
let found = null;
function presses(t, holding = true) {
  found ??= { document: globalThis.document, window: globalThis.window };
  const handlers = {}, calls = [], listeners = { addEventListener: (type, fn) => { handlers[type] = fn; }, removeEventListener() {} };
  globalThis.document = { ...listeners, body: { classList: { contains: () => false } }, querySelector: () => null, activeElement: null, pointerLockElement: null, hasFocus: () => true, exitPointerLock() { calls.push('unlock'); } };
  globalThis.window = listeners;
  t.after(() => Object.assign(globalThis, found));
  const canvas = { ...listeners, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
  let active = false;
  const player = new Player(canvas, {
    colliders: () => [], room: () => null,
    onPick: at => calls.push(['pick', at.clientX]),
    onPress: at => { if (!holding) return false; active = true; calls.push(['press', at.clientX]); return true; },
    onRelease: at => { calls.push(['release', active ? at.clientX : null]); active = false; },
    onCancel: () => { const was = active; active = false; if (was) calls.push('cancel'); return was; },
  });
  const pointer = (type, clientX = 50, extra = {}) => handlers[`pointer${type}`]({ pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX, clientY: 50, movementX: 0, movementY: 0, timeStamp: 0, ...extra });
  return { player, calls, handlers, pointer, canvas, holds: on => { holding = on; } };
}
test('nothing in hand, a press is the click it always was', t => {
  const { calls, pointer } = presses(t, false);
  pointer('down', 20); assert.deepEqual(calls, []);
  pointer('up', 20); assert.deepEqual(calls, [['pick', 20]]);
});
test('nothing in hand with the mouse captured, a press picks at once and its release is nothing', t => {
  const { calls, pointer, player } = presses(t, false); player.locked = true;
  pointer('down'); pointer('up');
  assert.deepEqual(calls, [['pick', 50]]);
});
test('holding, a press charges and its release throws where the pointer is, without clicking', t => {
  const { calls, pointer } = presses(t);
  pointer('down', 20); pointer('move', 22); pointer('up', 22);
  assert.deepEqual(calls, [['press', 20], ['release', 22]]);
});
test('dragging past the slop calls the throw off and looks around instead', t => {
  const { calls, pointer, player } = presses(t), yaw = player.yaw;
  pointer('down', 20); pointer('move', 40);
  assert.deepEqual(calls, [['press', 20], 'cancel']); assert.notEqual(player.yaw, yaw);
  pointer('up', 40); assert.deepEqual(calls, [['press', 20], 'cancel'], 'neither a throw nor a click');
});
test('a second finger calls the throw off', t => {
  const { calls, pointer } = presses(t);
  pointer('down', 20, { pointerType: 'touch' }); pointer('down', 60, { pointerType: 'touch', pointerId: 2 }); pointer('up', 60, { pointerType: 'touch', pointerId: 2 });
  assert.deepEqual(calls, [['press', 20], 'cancel']);
});
test('a finger held a moment aims as it charges, finely, and throws through where it came down', t => {
  const { calls, pointer, player } = presses(t), yaw = player.yaw, touch = { pointerType: 'touch' };
  pointer('down', 20, { ...touch, timeStamp: 1000 });
  assert.deepEqual(player.aimAt, { clientX: 20, clientY: 50 });
  pointer('move', 120, { ...touch, timeStamp: 1300 });
  assert.deepEqual(calls, [['press', 20]], 'still charging');
  const turned = player.yaw - yaw;
  assert.ok(turned > 0, 'the scene follows the finger, as it does when looking');
  assert.ok(Math.abs(turned) < 100 * 0.003, 'finer than looking');
  pointer('up', 120, { ...touch, timeStamp: 1400 });
  assert.deepEqual(calls, [['press', 20], ['release', 20]]);
  assert.equal(player.spin, 0, 'and no fling');
});
test('a finger swiped straight away looks round: no throw, at the speed it always had', t => {
  const { calls, pointer, player } = presses(t), yaw = player.yaw, touch = { pointerType: 'touch' };
  globalThis.innerWidth = 390; t.after(() => { delete globalThis.innerWidth; });
  pointer('down', 20, { ...touch, timeStamp: 1000 }); pointer('move', 120, { ...touch, timeStamp: 1100 });
  assert.deepEqual(calls, [['press', 20], 'cancel']);
  assert.ok(Math.abs(player.yaw - yaw) >= 100 * 0.006 - 1e-9);
  pointer('up', 120, { ...touch, timeStamp: 1200 });
  assert.deepEqual(calls, [['press', 20], 'cancel']);
});
test('a second finger calls off a throw that is being aimed', t => {
  const { calls, pointer } = presses(t), touch = { pointerType: 'touch' };
  pointer('down', 20, { ...touch, timeStamp: 1000 }); pointer('move', 60, { ...touch, timeStamp: 1300 });
  pointer('down', 90, { ...touch, pointerId: 2, timeStamp: 1400 });
  assert.deepEqual(calls, [['press', 20], 'cancel']);
});
test('a mouse drag still calls the throw off however long it was held', t => {
  const { calls, pointer, player } = presses(t);
  pointer('down', 20, { timeStamp: 1000 }); pointer('move', 60, { timeStamp: 2000 });
  assert.deepEqual(calls, [['press', 20], 'cancel']); assert.equal(player.aimAt, null);
});
test('captured, a press charges, moving looks, and it throws from the middle of the screen', t => {
  const { calls, pointer, player } = presses(t), yaw = player.yaw; player.locked = true;
  pointer('down', 20); pointer('move', 90, { movementX: 40 });
  assert.notEqual(player.yaw, yaw); assert.deepEqual(calls, [['press', 50]]);
  pointer('up', 90); assert.deepEqual(calls, [['press', 50], ['release', 50]]);
});
test('captured, a right click calls the throw off and keeps the mouse; with no throw to call off it lets go', t => {
  const { calls, pointer, player } = presses(t); player.locked = player.wanted = true;
  pointer('down'); pointer('move', 50, { button: 2, buttons: 3 }); // pressed with the left still down
  assert.deepEqual(calls, [['press', 50], 'cancel']); assert.ok(player.wanted);
  pointer('up'); assert.deepEqual(calls, [['press', 50], 'cancel', ['release', null]]);
  calls.length = 0;
  pointer('down', 50, { button: 2 });
  assert.deepEqual(calls, ['unlock']); assert.equal(player.wanted, false);
});
test('a charge held by a key is called off by a right click too, with the mouse kept', t => {
  const { calls, player, pointer } = presses(t); player.locked = player.wanted = true;
  player.onPress({ clientX: 0 }); calls.length = 0; // E, in office.js: the mouse has no part in it
  pointer('down', 50, { button: 2 });
  assert.deepEqual(calls, ['cancel']); assert.ok(player.wanted);
});
test('losing the window calls the throw off, and the button coming up afterwards is nothing', t => {
  const { calls, pointer, handlers } = presses(t);
  pointer('down', 20); handlers.blur();
  assert.deepEqual(calls, [['press', 20], 'cancel']);
  pointer('up', 20); assert.deepEqual(calls, [['press', 20], 'cancel'], 'no click either');
});
test('losing the mouse calls the throw off, and the button coming up afterwards is nothing', t => {
  // Losing it asks a moment later whether the window still has focus: on this test's clock, not after it, when another test's document is up.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { calls, pointer, handlers, player } = presses(t); player.locked = player.wanted = true;
  pointer('down'); handlers.pointerlockchange();
  assert.deepEqual(calls, [['press', 50], 'cancel']); assert.equal(player.locked, false);
  pointer('up'); assert.deepEqual(calls, [['press', 50], 'cancel']);
  t.mock.timers.tick(100); assert.equal(player.wanted, false, 'let go of in the window: you wanted it');
});
test('a right click during a key\'s charge calls it off, even with the left down since before there was a charge', t => {
  const { calls, player, pointer, holds } = presses(t, false); player.locked = player.wanted = true;
  pointer('down'); assert.deepEqual(calls, [['pick', 50]]); // that press picked it up
  holds(true); player.onPress({ clientX: 0 }); calls.length = 0; // E
  pointer('move', 50, { button: 2, buttons: 3 });
  assert.deepEqual(calls, ['cancel']); assert.ok(player.locked && player.wanted);
});
test('captured, a right click with the left down and nothing charging is what it was: nothing', t => {
  const { calls, player, pointer } = presses(t, false); player.locked = player.wanted = true;
  pointer('down'); calls.length = 0;
  pointer('move', 50, { button: 2, buttons: 3 });
  assert.deepEqual(calls, []); assert.ok(player.locked && player.wanted);
});
test('not captured, a right click with the left down and nothing charging is what it was: nothing', t => {
  const { calls, player, pointer } = presses(t, false);
  pointer('down'); pointer('move', 50, { button: 2, buttons: 3 });
  assert.deepEqual(calls, []);
  pointer('up'); assert.deepEqual(calls, [['pick', 50]], 'still the click it was');
});
test('no fake browser is left behind for the files after this one', () => {
  assert.ok(globalThis.document === found.document && globalThis.window === found.window);
});
