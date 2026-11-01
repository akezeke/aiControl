import test from 'node:test';
import assert from 'node:assert/strict';
import { ImagePanZoom } from '../client/image-pan-zoom.js';

function node(properties) {
  const listeners = new Map();
  return Object.assign(properties, {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    emit(type, event = {}) { listeners.get(type)?.({ type, button: 0, pointerType: 'touch', preventDefault() {}, ...event }); },
  });
}
function fixture() {
  const viewport = node({ clientWidth: 400, clientHeight: 300, setPointerCapture() {}, getBoundingClientRect() { return { left: 10, top: 20, width: this.clientWidth, height: this.clientHeight }; } });
  const picture = node({ offsetWidth: 400, offsetHeight: 300, style: {} }), swipes = [];
  const zoom = new ImagePanZoom(viewport, picture, direction => swipes.push(direction));
  const pointer = (type, id, x, y = 170, pointerType = 'touch') => viewport.emit(type, { pointerId: id, clientX: x, clientY: y, pointerType });
  return { viewport, picture, zoom, swipes, pointer };
}

test('pinch keeps the point under the fingers anchored and continues panning with one finger', () => {
  const { zoom, pointer, swipes } = fixture();
  pointer('pointerdown', 1, 210); pointer('pointerdown', 2, 310);
  pointer('pointermove', 1, 160); pointer('pointermove', 2, 360);
  assert.equal(zoom.scale, 2); assert.equal(zoom.x, -50);
  pointer('pointerup', 2, 360);
  pointer('pointermove', 1, 210);
  assert.equal(zoom.scale, 2); assert.equal(zoom.x, 0);
  pointer('pointerup', 1, 210);
  assert.deepEqual(swipes, []);
});

test('panning stops at image edges and zooming back to fit recenters the image', () => {
  const { zoom, pointer } = fixture();
  zoom.zoom(2);
  pointer('pointerdown', 1, 210);
  pointer('pointermove', 1, 1000, -1000);
  assert.equal(zoom.x, 200); assert.equal(zoom.y, -150);
  zoom.zoom(.1);
  assert.equal(zoom.scale, 1); assert.ok(zoom.x === 0 && zoom.y === 0);
  zoom.zoom(100);
  assert.equal(zoom.scale, 8);
});

test('letterboxed images remain centered on axes where they fit', () => {
  const { zoom, pointer, picture } = fixture();
  picture.offsetWidth = 100;
  zoom.zoom(2);
  pointer('pointerdown', 1, 210);
  pointer('pointermove', 1, 280, 210);
  assert.equal(zoom.x, 0); assert.equal(zoom.y, 40);
});

test('only a completed single-finger swipe at fit size navigates', () => {
  const { zoom, pointer, swipes } = fixture();
  pointer('pointerdown', 1, 300); pointer('pointerup', 1, 200);
  assert.deepEqual(swipes, [1]);
  pointer('pointerdown', 2, 200); pointer('pointercancel', 2, 300);
  pointer('pointerdown', 3, 200); pointer('pointerup', 3, 300, 170, 'mouse');
  pointer('pointerdown', 4, 200); pointer('pointerdown', 5, 300);
  pointer('pointerup', 5, 300); pointer('pointerup', 4, 300);
  zoom.zoom(2);
  pointer('pointerdown', 6, 300); pointer('pointerup', 6, 200);
  assert.deepEqual(swipes, [1]);
});

test('mouse-wheel zoom anchors at the cursor and double-click resets', () => {
  const { viewport, zoom } = fixture();
  let prevented = false;
  viewport.emit('wheel', { deltaY: -Math.log(2) / .002, deltaMode: 0, clientX: 260, clientY: 170, preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(zoom.scale, 2); assert.equal(zoom.x, -50);
  viewport.emit('dblclick', { clientX: 260, clientY: 170 });
  assert.equal(zoom.scale, 1); assert.ok(zoom.x === 0);
});

test('a new image resets zoom and active drags, and closing removes listeners', () => {
  const { picture, viewport, zoom, pointer } = fixture();
  zoom.zoom(3);
  pointer('pointerdown', 1, 210);
  picture.emit('load');
  pointer('pointermove', 1, 300);
  assert.equal(zoom.scale, 1); assert.equal(zoom.x, 0);
  zoom.destroy();
  viewport.emit('wheel', { deltaY: -500, deltaMode: 0, clientX: 210, clientY: 170 });
  assert.equal(zoom.scale, 1);
});
