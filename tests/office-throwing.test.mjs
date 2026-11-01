import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { SLIDE_OFF, FULL_CHARGE, chargeAt, createCharge, createHand, createThrowButton, handModel, handParts, launch, palmAt, throwSpeed } from '../client/office/throwing.js';
import { Player } from '../client/office/player.js';

test('a tap tosses at a quarter of full speed, a long hold gets all of it, and it holds', () => {
  const kind = { throw: 8 };
  assert.equal(throwSpeed(kind, chargeAt(0)), 2);
  assert.equal(FULL_CHARGE, 1.5);
  assert.ok(chargeAt(FULL_CHARGE * 0.9) < 1, 'not there yet');
  assert.equal(throwSpeed(kind, chargeAt(FULL_CHARGE)), 8);
  assert.equal(chargeAt(FULL_CHARGE * 3), 1);
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
// Inside a convex mesh: behind every one of its faces. A tube's start: the middle of its first ring of vertices.
const inside = (mesh, p) => { const at = mesh.attributes.position, tri = new THREE.Triangle(), n = new THREE.Vector3(), [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], index = mesh.index;
  for (let i = 0; i < index.count; i += 3) { a.fromBufferAttribute(at, index.getX(i)); b.fromBufferAttribute(at, index.getX(i + 1)); c.fromBufferAttribute(at, index.getX(i + 2)); if (tri.set(a, b, c).getArea() > 1e-12 && tri.getNormal(n).dot(p.clone().sub(a)) > 0) return false; } return true; };
const tubeStart = (tube) => { const at = tube.attributes.position, ring = tube.parameters.radialSegments, p = new THREE.Vector3(), v = new THREE.Vector3(); for (let i = 0; i < ring; i++) p.add(v.fromBufferAttribute(at, i)); return p.divideScalar(ring); };
test('the arm, the fingers and the thumb all start inside the palm, for everything it can hold', () => {
  for (const [radius, low] of [...ITEMS, [0.02, 0.02], [0.1, 0.1], [0.2, 0.2], [0.2, 0.01]]) {
    const { palm, joint, tubes } = handParts(radius, low);
    assert.ok(tubes.length >= 5, 'the arm, three fingers and a thumb');
    for (const tube of tubes) assert.ok(inside(palm, tubeStart(tube)), `${radius}, ${low}: ${tubeStart(tube).toArray()}`);
    joint.computeBoundingSphere(); assert.ok(joint.boundingSphere.center.distanceTo(tubeStart(tubes[0])) < 1e-6, "a ball over the arm's open end");
  }
});
test('the arm goes with the hand: one mesh, so a pull can\'t part them', () => {
  const hand = createHand(new THREE.Group()); hand.hold(null, 0.07, 0.05); const meshes = []; hand.palm.traverse(n => { if (n.isMesh) meshes.push(n); });
  assert.equal(meshes.length, 1); const [body] = meshes, same = body.geometry;
  for (const charge of [0.25, 1]) { hand.pull(charge); body.updateMatrix(); assert.ok(body.parent === hand.palm && body.matrix.equals(new THREE.Matrix4()) && body.geometry === same); }
});
test('the darts\' arm starts inside its fist too', () => {
  const { arm, grip } = handModel(), [fist] = grip.children, tube = arm.children.find(n => n.geometry?.type === 'TubeGeometry'); grip.updateMatrix();
  assert.ok(inside(fist.geometry.clone().applyMatrix4(grip.matrix), tubeStart(tube.geometry)));
});
test('a hand fitted once is kept, and what\'s flatter than it\'s wide gets a flatter one', () => {
  const hand = createHand(new THREE.Group()); let body; hand.hold(null, 0.08, 0.012); hand.palm.traverse(n => { if (n.isMesh) body = n; });
  const flat = body.geometry; hand.hold(null, 0.08); assert.ok(body.geometry !== flat); hand.hold(null, 0.08, 0.012); assert.ok(body.geometry === flat);
});
test('the fingertips come over the thing\'s face, apart, to show against it as the mug\'s hand\'s do against its mug', () => {
  for (const radius of [0.03, 0.045, 0.07, 0.08, 0.11, 0.16]) {
    const { tips } = handParts(radius, radius), at = tips.slice(0, 3).map(g => { g.computeBoundingSphere(); return g.boundingSphere.center; });
    for (const tip of at) { assert.ok(Math.hypot(tip.x, tip.y) < radius + 0.0105, `${radius}: within its edge`); assert.ok(tip.z > 0.7 * radius, `${radius}: on the side towards you`); }
    for (let i = 1; i < 3; i++) assert.ok(at[i - 1].distanceTo(at[i]) > 0.02, `${radius}: a finger's width apart`);
  }
});
const SIDE = Math.tan(THREE.MathUtils.degToRad(35)), V3 = () => new THREE.Vector3();
test('a phone\'s narrow picture shows all of what you hold and the thumb round it, charged or not; a wide one has the palm where it was', () => {
  for (const radius of [0.03, 0.04, 0.045, 0.06, 0.07, 0.08, 0.11, 0.13, 0.16]) for (const charge of [0, 0.5, 1]) {
    for (const aspect of [390 / 780, 390 / 724, 360 / 800, 320 / 568]) { const at = palmAt(V3(), aspect, radius, charge), edge = -at.z * SIDE * aspect; assert.ok(at.x - radius - 0.03 > -edge && at.x + radius < edge, `${aspect} ${radius} ${charge} ${at.x}`); assert.ok(at.x <= 0); }
    for (const aspect of [1.23, 16 / 9, 844 / 390, Infinity]) assert.deepEqual(palmAt(V3(), aspect, radius, charge).toArray(), [-0.3 - 0.04 * charge, -0.27, -0.8 + 0.16 * charge]);
  }
  const small = palmAt(V3(), 0.54, 0.03), big = palmAt(V3(), 0.54, 0.16); assert.ok(small.x < -0.2 && big.x > small.x + 0.1, 'as far out as it can be, so the arm still comes in from the side');
  assert.match(readFileSync(new URL('../client/office/office.js', import.meta.url), 'utf8'), /new THREE\.PerspectiveCamera\(70,/, 'the angle it reckons with');
});
test('the hand refits on a resize, at the charge it\'s at, and to the thing it\'s given', () => {
  const hand = createHand(new THREE.Group()), at = V3(); hand.hold(null, 0.08); assert.equal(hand.palm.position.x, -0.3);
  hand.fit(0.54); assert.ok(hand.palm.position.equals(palmAt(at, 0.54, 0.08)) && at.x > -0.3);
  hand.hold(null, 0.03); assert.ok(hand.palm.position.equals(palmAt(at, 0.54, 0.03)));
  hand.pull(1); assert.ok(hand.palm.position.equals(palmAt(at, 0.54, 0.03, 1))); hand.fit(0.6); assert.ok(hand.palm.position.equals(palmAt(at, 0.6, 0.03, 1)), 'mid-charge');
  hand.free(); assert.ok(hand.palm.position.equals(palmAt(at, 0.6, 0.03))); hand.fit(2); assert.equal(hand.palm.position.x, -0.3);
  assert.match(readFileSync(new URL('../client/office/office.js', import.meta.url), 'utf8'), /const resize = \(\) => \{[\s\S]{0,200}hand\.fit\(w \/ h\);\s*\};\s*const observer = new ResizeObserver\(resize\)/);
});
test('what hides the throw button calls a charge off: both ask the one condition', () => {
  const source = readFileSync(new URL('../client/office/office.js', import.meta.url), 'utf8'), clear = source.match(/const clearToThrow = \(\) => ([^,]*),/)?.[1] ?? '';
  for (const gate of ['officeHasKeys(noEvent)', '!overlays.copying', '!office.talking', '!player.flight']) assert.ok(clear.includes(gate), gate);
  assert.match(source, /canThrow = \(\) => canCharge\(\) && clearToThrow\(\)/);
  assert.match(source, /startCharge = \(\) => \{ if \(!canThrow\(\)\) return false;/, 'never starts');
  assert.match(source, /letGo = at => \{\s*if \(!canThrow\(\)\) \{ callOff\(\); return; \}/, 'never throws');
  assert.match(source, /if \(charge\.active\) \{\s*if \(!canThrow\(\)\) callOff\(\);/, 'stops once it applies');
  assert.match(source, /overlays\.showThrow\(touched && \(canCharge\(\) \|\| again\) && clearToThrow\(\), again\)/);
  assert.equal(source.split('officeHasKeys(noEvent)').length, 2, 'asked in the one place');
  assert.ok(clear.trim().endsWith('officeHasKeys(noEvent)'), 'its document-wide query last, after the cheap gates');
});
test('every fit goes when the office does, not only the one on the hand at the time', () => {
  const hand = createHand(new THREE.Group()); let body; const fits = new Set(), gone = new Set(); hand.hold(null, 0.08, 0.012); hand.palm.traverse(n => { if (n.isMesh) body = n; });
  for (const [radius, low] of [[0.08, 0.012], [0.08, 0.08], [0.03, 0.03], [0.16, 0.16]]) { hand.hold(null, radius, low); const fit = body.geometry; fits.add(fit); fit.addEventListener('dispose', () => gone.add(fit)); }
  assert.equal(fits.size, 4); hand.free(); hand.dispose(); assert.equal(gone.size, 4);
  assert.match(readFileSync(new URL('../client/office/office.js', import.meta.url), 'utf8'), /disposers: \[[^\n]*\(\) => hand\.dispose\(\)/);
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
test('holding, a finger on the canvas never charges: a tap is a tap', t => {
  const { calls, pointer } = presses(t), touch = { pointerType: 'touch' };
  pointer('down', 80, touch); assert.deepEqual(calls, []);
  pointer('up', 80, touch); assert.deepEqual(calls, [['pick', 80]]);
});
test('holding, a finger dragged on the canvas looks round at the speed it always had, and flings, however long it was held first', t => {
  const { calls, pointer, player } = presses(t), yaw = player.yaw, touch = { pointerType: 'touch' };
  globalThis.innerWidth = 390; t.after(() => { delete globalThis.innerWidth; });
  pointer('down', 20, { ...touch, timeStamp: 1000 }); pointer('move', 120, { ...touch, timeStamp: 1500 });
  assert.ok(Math.abs(player.yaw - yaw) >= 100 * 0.006 - 1e-9, 'a look, not aiming');
  pointer('move', 140, { ...touch, timeStamp: 1520 }); pointer('up', 140, { ...touch, timeStamp: 1530 });
  assert.deepEqual(calls, []); assert.ok(player.spin > 0, 'it carries on');
});
test('holding, a second finger on the canvas calls nothing off and makes it no tap', t => {
  const { calls, pointer } = presses(t), touch = { pointerType: 'touch' };
  pointer('down', 20, touch); pointer('down', 60, { ...touch, pointerId: 2 }); pointer('up', 60, { ...touch, pointerId: 2 });
  assert.deepEqual(calls, []);
});
// The canvas's side of the throw button: `aimFine` says it's held, whichever finger came first.
test('while the button is held a finger turns the view finely, with the scene, and no fling; down first or second', t => {
  for (const first of [true, false]) {
    const { calls, pointer, player } = presses(t), yaw = player.yaw, touch = { pointerType: 'touch' };
    player.spin = 2;
    if (first) player.aimFine(true);
    pointer('down', 20, { ...touch, timeStamp: 1000 });
    if (!first) { pointer('move', 22, { ...touch, timeStamp: 1010 }); player.aimFine(true); }
    assert.equal(player.spin, 0, 'it stops any fling still going');
    const from = player.yaw;
    pointer('move', 120, { ...touch, timeStamp: 1100 });
    const turned = player.yaw - from;
    assert.ok(turned > 0, 'the scene follows the finger'); assert.ok(Math.abs(turned - 100 * 0.0022) < 1e-9, `at the fine speed, ${turned}`);
    pointer('move', 200, { ...touch, timeStamp: 1120 }); pointer('up', 200, { ...touch, timeStamp: 1125 });
    assert.equal(player.spin, 0, 'no fling'); assert.deepEqual(calls, [], 'no tap, nothing called off');
    assert.ok(player.yaw !== yaw);
  }
});
test('a tap on the canvas while the button is held is nothing', t => {
  const { calls, pointer, player } = presses(t), touch = { pointerType: 'touch' };
  player.aimFine(true); pointer('down', 20, touch); pointer('up', 20, touch);
  assert.deepEqual(calls, []);
});
test('the button let go with the other finger still down: it looks at its own speed from there, with no fling, and is no tap', t => {
  const { calls, pointer, player } = presses(t), touch = { pointerType: 'touch' };
  globalThis.innerWidth = 390; t.after(() => { delete globalThis.innerWidth; });
  player.aimFine(true); pointer('down', 20, { ...touch, timeStamp: 1000 }); player.aimFine(false);
  const from = player.yaw; pointer('move', 120, { ...touch, timeStamp: 1010 });
  assert.ok(Math.abs(player.yaw - from) >= 100 * 0.006 - 1e-9);
  pointer('up', 120, { ...touch, timeStamp: 1015 });
  assert.equal(player.spin, 0); assert.deepEqual(calls, []);
});
test('with the button let go a new finger is an ordinary look and tap again', t => {
  const { calls, pointer, player } = presses(t), touch = { pointerType: 'touch' };
  player.aimFine(true); player.aimFine(false); pointer('down', 20, touch); pointer('up', 20, touch);
  assert.deepEqual(calls, [['pick', 20]]);
});

// The throw button, without a browser: 72 px, its middle at 336, 636.
function throwButton(t, answer = () => true) {
  const handlers = {}, calls = [], classes = new Set(), captured = new Set();
  const el = { textContent: 'Throw', addEventListener: (type, fn) => { handlers[type] = fn; }, setPointerCapture: id => captured.add(id), releasePointerCapture: id => captured.delete(id), hasPointerCapture: id => captured.has(id), getBoundingClientRect: () => ({ left: 300, top: 600, width: 72, height: 72 }), classList: { toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) } };
  const button = createThrowButton(el, { press: () => { calls.push('press'); return answer(); }, release: () => calls.push('release'), cancel: () => calls.push('cancel') });
  const fire = (type, clientX = 336, clientY = 636, pointerId = 1) => handlers[type]({ pointerId, clientX, clientY, preventDefault() { calls.push('no menu'); } });
  return { button, calls, classes, captured, el, fire };
}
test('a tap on the button throws, at the same low power as ever', t => {
  const { calls, classes, fire, captured } = throwButton(t), charge = createCharge();
  charge.press(10); fire('pointerdown'); assert.deepEqual(calls, ['press']); assert.ok(classes.has('held')); assert.ok(captured.has(1), 'its own pointer');
  fire('pointerup'); assert.deepEqual(calls, ['press', 'release']); assert.ok(!classes.has('held'));
  const kind = { throw: 8 }; assert.ok(throwSpeed(kind, charge.release(10.05)) < 0.35 * kind.throw, 'a tap\'s toss');
});
test('held, the button keeps on holding, whatever the finger does on it, and throws when it comes up', t => {
  const { calls, classes, fire } = throwButton(t);
  fire('pointerdown'); fire('pointermove', 336 + 36 + SLIDE_OFF - 2);
  assert.ok(!classes.has('off'), 'not by a clear margin yet'); assert.deepEqual(calls, ['press']);
  fire('pointerup', 336 + 36 + SLIDE_OFF - 2); assert.deepEqual(calls, ['press', 'release']);
});
test('slid off the button by a clear margin it shows so, and coming up calls it off', t => {
  const { calls, classes, fire, el } = throwButton(t);
  fire('pointerdown'); fire('pointermove', 336, 636 - 36 - SLIDE_OFF - 2);
  assert.ok(classes.has('off')); assert.equal(el.textContent, '✕'); assert.deepEqual(calls, ['press'], 'not until it comes up');
  fire('pointerup', 336, 636 - 36 - SLIDE_OFF - 2);
  assert.deepEqual(calls, ['press', 'cancel']); assert.ok(!classes.has('off') && !classes.has('held')); assert.equal(el.textContent, 'Throw');
});
test('slid off and back, it throws after all', t => {
  const { calls, classes, fire, el } = throwButton(t);
  fire('pointerdown'); fire('pointermove', 100, 100); fire('pointermove', 340, 640);
  assert.ok(!classes.has('off')); assert.equal(el.textContent, 'Throw');
  fire('pointerup', 340, 640); assert.deepEqual(calls, ['press', 'release']);
});
for (const lost of ['pointercancel', 'lostpointercapture']) test(`a ${lost} calls it off, once`, t => {
  const { calls, classes, fire } = throwButton(t);
  fire('pointerdown'); fire(lost); assert.deepEqual(calls, ['press', 'cancel']); assert.ok(!classes.has('held'));
  fire('pointerup'); fire('lostpointercapture'); assert.deepEqual(calls, ['press', 'cancel']);
});
test('only the finger that pressed it counts: others on the button do nothing', t => {
  const { calls, classes, fire } = throwButton(t);
  fire('pointerdown'); fire('pointerdown', 340, 640, 2); fire('pointermove', 0, 0, 2); assert.ok(!classes.has('off'));
  fire('pointerup', 0, 0, 2); fire('pointercancel', 0, 0, 2); assert.deepEqual(calls, ['press']);
  fire('pointerup'); assert.deepEqual(calls, ['press', 'release']);
});
test('with nothing to charge a press is nothing, and takes no pointer', t => {
  const { calls, classes, fire, captured } = throwButton(t, () => false);
  fire('pointerdown'); assert.deepEqual(calls, ['press']); assert.ok(!classes.has('held')); assert.equal(captured.size, 0);
  fire('pointerup'); assert.deepEqual(calls, ['press']);
});
test('called off from elsewhere, the button lets go, and its finger coming up is nothing', t => {
  const { button, calls, classes, fire, captured } = throwButton(t);
  fire('pointerdown'); button.drop(); assert.ok(!classes.has('held')); assert.equal(captured.size, 0);
  fire('lostpointercapture'); fire('pointerup'); assert.deepEqual(calls, ['press']);
  fire('pointerdown', 336, 636, 2); assert.deepEqual(calls, ['press', 'press'], 'and it can be pressed again');
});
test('a long press on the button brings up no menu', t => {
  const { calls, fire } = throwButton(t); fire('contextmenu'); assert.deepEqual(calls, ['no menu']);
});
test('a mouse drag still calls the throw off however long it was held', t => {
  const { calls, pointer, player } = presses(t);
  pointer('down', 20, { timeStamp: 1000 }); pointer('move', 60, { timeStamp: 2000 });
  assert.deepEqual(calls, [['press', 20], 'cancel']);
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
