import test from 'node:test';
import assert from 'node:assert/strict';
import { clampDrag, open, close, minimize, restore, toggleMax, front, moveTo, loadCart, frontmost, defaults, rectOf, uncovered, gameHidden, normalizeWindows } from '../client/office/pc-windows.js';

test('drag clamp keeps the title bar inside vertically and 80 px of it horizontally', () => {
  assert.deepEqual(clampDrag({ x: -2000, y: -5, w: 900 }), { x: -820, y: 0 });
  assert.deepEqual(clampDrag({ x: 5000, y: 5000, w: 520 }), { x: 1000, y: 570 });
});
test('open fronts, minimize hides, restore fronts, close', () => {
  let s = open(defaults(), 'notepad'); assert.equal(frontmost(s), 'notepad');
  s = open(s, 'browser'); assert.deepEqual(s.order.slice(-1), ['browser']);
  s = minimize(s, 'browser'); assert.equal(frontmost(s), 'notepad');
  s = restore(s, 'browser'); assert.equal(frontmost(s), 'browser');
  s = close(s, 'browser'); assert.equal(s.windows.browser.open, false);
});
test('maximize fills the work area and restores; PICO-8 has a fixed size', () => {
  let s = toggleMax(open(defaults(), 'browser'), 'browser');
  assert.deepEqual(rectOf(s, 'browser'), { x: 0, y: 0, w: 1080, h: 596 });
  s = toggleMax(s, 'browser'); assert.deepEqual(rectOf(s, 'browser'), { x: 60, y: 12, w: 900, h: 572 });
  const p = open(defaults(), 'pico8'); assert.deepEqual(toggleMax(p, 'pico8'), p);
});
test('coverage: a game is hidden only when nothing of its frame shows', () => {
  let s = open(defaults(), 'pico8'); assert.equal(gameHidden(s), false);
  s = toggleMax(open(s, 'browser'), 'browser'); assert.equal(gameHidden(s), true);
  s = toggleMax(s, 'browser'); assert.equal(gameHidden(s), true, 'the default browser rect covers the whole frame');
  s = moveTo(s, 'browser', { x: 300, y: 12 }); assert.equal(gameHidden(s), false, 'a 23 px strip shows left of the browser');
  s = moveTo(front(s, 'pico8'), 'pico8', { x: 1000, y: 0 }); assert.equal(gameHidden(s), false, 'clamped, 80 px stays on screen');
  assert.equal(gameHidden(moveTo(s, 'pico8', { x: 274, y: 570 })), true, 'only the title bar is on screen');
  assert.equal(gameHidden(minimize(s, 'pico8')), true);
  assert.equal(uncovered({ x: 0, y: 0, w: 10, h: 10 }, [{ x: 0, y: 0, w: 10, h: 5 }, { x: 0, y: 5, w: 10, h: 5 }]).length, 0);
});
test('loadCart opens and fronts PICO-8 with the cart', () => {
  const s = loadCart(open(defaults(), 'browser'), { pid: 'a-1', title: 'A' });
  assert.deepEqual(s.windows.pico8, { open: true, mode: 'normal', x: 274, y: 21, cart: { pid: 'a-1', title: 'A' } });
  assert.equal(frontmost(s), 'pico8');
});
test('normalizeWindows keeps what is valid and clamps positions', () => {
  const s = normalizeWindows({ windows: { pico8: { open: true, mode: 'max', x: 9999, y: 2, cart: { pid: 'x', title: '' } }, browser: { open: 'yes' } }, order: ['pico8'] });
  assert.deepEqual(s.windows.pico8, { open: true, mode: 'normal', x: 1000, y: 2, cart: null });
  assert.equal(s.windows.browser.open, false); assert.deepEqual(s.order, ['notepad', 'browser', 'pico8']);
});
