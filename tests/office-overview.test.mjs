import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fitOverview, Overview } from '../client/office/overview.js';

// Where the boxes' corners (floor and head height) land on screen, from a fitted view.
function extent(boxes, { look, distance }, fov, aspect) {
  const cam = new THREE.PerspectiveCamera(fov, aspect), pitch = 55 * Math.PI / 180;
  cam.position.copy(look).add(new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch)).multiplyScalar(distance)); cam.lookAt(look); cam.updateMatrixWorld();
  const points = boxes.flatMap(([x0, x1, z0, z1]) => [x0, x1].flatMap(x => [0, 2.2].flatMap(y => [z0, z1].map(z => new THREE.Vector3(x, y, z).project(cam)))));
  return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)), bottom: Math.min(...points.map(p => p.y)), top: Math.max(...points.map(p => p.y)) };
}

test('the overview fits the pods snugly, centred, looking at the floor', () => {
  // Two rows; the front one shorter, so the box round them all would take in an empty corner.
  const boxes = [[1.3, 4.1, 1, 6.4], [8, 10.8, 1, 6.4], [14.7, 17.5, 1, 6.4], [1.3, 4.1, 6.5, 11.9], [8, 10.8, 6.5, 11.9]];
  for (const aspect of [1.31, 0.49, 2.2]) {
    const fit = fitOverview(boxes, 70, aspect), e = extent(boxes, fit, 70, aspect);
    assert.equal(fit.look.y, 0);
    assert.ok(Math.max(e.right, -e.left, e.top, -e.bottom) <= 0.931, `inside the margin at ${aspect}`);
    assert.ok(Math.max(e.right, -e.left, e.top, -e.bottom) > 0.92, `as close as fits at ${aspect}`);
    assert.ok(Math.abs(e.left + e.right) < 0.03 && Math.abs(e.top + e.bottom) < 0.03, `centred at ${aspect}`);
  }
});

// An open overview over a 20 × 16 m room on an 800 × 600 canvas, its own clock, and a hand to drag it with.
function overview(t) {
  const saved = { document: globalThis.document, window: globalThis.window }, canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) });
  let view; Object.assign(globalThis, { document: new EventTarget(), window: new EventTarget() });
  try { view = new Overview(new EventTarget(), canvas, new THREE.PerspectiveCamera(60, 800 / 600)); } finally { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  view.setLayout({ pods: [{ x: 10, z: 8, width: 6, depth: 4 }], room: { width: 20, depth: 16 } }); view.setActive(true);
  const clock = { now: 0 }; t.mock.method(performance, 'now', () => clock.now);
  const send = (type, x, y, pointerId = 1) => canvas.dispatchEvent(Object.assign(new Event(type), { pointerId, clientX: x, clientY: y, button: 0 }));
  const frame = (dt = 1 / 60, instant) => { clock.now += dt * 1000; view.update(dt, instant); };
  frame();
  return { view, send, frame, shown: () => view.pose().look.clone(), goal: () => view.goal().look.clone() };
}

test('a drag in the overview is smoothed, and carries on when let go of mid-swipe', t => {
  const { view, send, frame, shown, goal } = overview(t), start = shown(), under = view.ground({ x: 400, y: 300 });
  send('pointerdown', 400, 300); frame();
  send('pointermove', 300, 300); frame();
  // The floor that was under the pointer is headed to where it's moved to; what's shown is part way there.
  assert.ok(view.ground({ x: 300, y: 300 }).distanceTo(under) < 1e-6);
  const part = shown().distanceTo(start) / goal().distanceTo(start);
  assert.ok(part > 0.1 && part < 0.6, `part way: ${part}`);
  // A quick swipe carries on past where it was let go, slowing to a stop.
  for (let x = 280; x >= 200; x -= 20) { send('pointermove', x, 300); frame(); }
  send('pointerup', 200, 300);
  const left = goal(); assert.ok(view.fling, 'flung');
  for (let i = 0; i < 300 && view.fling; i++) frame();
  assert.equal(view.fling, null, 'it stops');
  assert.ok(goal().x - left.x > 1, `coasted on ${goal().x - left.x} m`);
  for (let i = 0; i < 30; i++) frame();
  assert.ok(shown().distanceTo(goal()) < 1e-3, 'what is shown catches up');
});

test('the overview stays put after a drag that stopped, and grabbing stops a fling where it is shown', t => {
  const { view, send, frame, shown, goal } = overview(t);
  send('pointerdown', 400, 300); frame();
  for (let x = 380; x >= 300; x -= 20) { send('pointermove', x, 300); frame(); }
  for (let i = 0; i < 12; i++) frame(); // held still a moment
  send('pointerup', 300, 300);
  assert.equal(view.fling, null);
  send('pointerdown', 300, 300); frame();
  for (let x = 280; x >= 200; x -= 20) { send('pointermove', x, 300); frame(); }
  send('pointerup', 200, 300); frame(); frame();
  assert.ok(view.fling);
  const seen = shown(); send('pointerdown', 200, 300);
  assert.equal(view.fling, null);
  assert.ok(goal().distanceTo(seen) < 1e-6, 'held where it was shown');
});

test('with reduced motion the overview follows a drag exactly and nothing coasts', t => {
  const { view, send, frame, shown, goal } = overview(t);
  send('pointerdown', 400, 300); frame(undefined, true);
  for (let x = 380; x >= 200; x -= 30) { send('pointermove', x, 300); frame(undefined, true); assert.ok(shown().distanceTo(goal()) < 1e-9); }
  send('pointerup', 200, 300); frame(undefined, true);
  assert.equal(view.fling, null);
});

test('a fling stops at the edge of the room', t => {
  const { view, send, frame, goal } = overview(t);
  send('pointerdown', 400, 300); frame();
  for (let x = 300; x >= -400; x -= 100) { send('pointermove', x, 300); frame(); }
  send('pointerup', -400, 300);
  for (let i = 0; i < 300 && view.fling; i++) frame();
  assert.equal(goal().x, 20);
});

test('a drag between frames still moves the overview, and two fingers pinch it', t => {
  const { view, send, frame } = overview(t), under = view.ground({ x: 400, y: 300 });
  send('pointerdown', 400, 300); send('pointermove', 350, 320); send('pointerup', 350, 320);
  assert.ok(view.ground({ x: 350, y: 320 }).distanceTo(under) < 1e-6, 'all of it, with no frame in between');
  frame();
  const far = view.goal().distance;
  send('pointerdown', 350, 300, 1); send('pointerdown', 450, 300, 2); frame();
  send('pointermove', 300, 300, 1); send('pointermove', 500, 300, 2); frame();
  assert.ok(Math.abs(view.goal().distance - far / 2) < 1e-6, 'twice as far apart, half as far away');
  // Lifting one, the other drags on from where it is.
  const held = view.ground({ x: 500, y: 300 }); send('pointerup', 300, 300, 1); send('pointermove', 520, 310, 2); frame();
  assert.ok(view.ground({ x: 520, y: 310 }).distanceTo(held) < 1e-6);
});
