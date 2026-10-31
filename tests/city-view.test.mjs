import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutOffice } from '../client/office/layout.js';
import { cityPlan, screen, LOT } from '../client/city/plan.js';
import { ZOOMS, fitCanvas, cityBox, fitStep, startCamera, toCanvas, fromCanvas, hitSprites, placeBubble, focusBuildings, clearOf } from '../client/city/view.js';

test('art pixels are whole device pixels at any DPR', () => {
  for (const dpr of [1, 1.25, 1.5, 2, 2.625, 3]) for (const step of ZOOMS) {
    const f = fitCanvas(1001, 777, dpr, step); assert.ok(Number.isInteger(f.scale) && f.scale >= 1);
    assert.ok(Number.isInteger(f.width) && Number.isInteger(f.height));
    assert.ok(Math.abs(f.cssW * dpr - f.width * f.scale) < 1e-6); assert.ok(f.cssW <= 1001);
  }
});
test('a box with no size yet is still a valid canvas', () => { const f = fitCanvas(0, 0, 1, 1); assert.equal(f.width, 1); assert.equal(f.height, 1); assert.deepEqual(fitCanvas(NaN, undefined, 0, 1).width, 1); });
test('fit picks the highest step that fits, and never below 1', () => {
  const box = { x0: 0, y0: 0, x1: 400, y1: 200 };
  assert.equal(fitStep(box, 1700, 900, 1), 4); assert.equal(fitStep(box, 900, 500, 1), 2); assert.equal(fitStep(box, 100, 100, 1), 1); assert.equal(fitStep({ x0: 0, y0: 0, x1: 1, y1: 1 }, 0, 0, 1), 1);
});
test('canvas and screen coordinates round-trip', () => { const cam = { cx: 37, cy: -12, step: 2 }, size = { width: 300, height: 200 }, [px, py] = toCanvas(cam, size, 50, 60); assert.deepEqual(fromCanvas(cam, size, px, py), [50, 60]); });
const plan2 = () => cityPlan(layoutOffice([{ id: 'a', project: 'x', cwd: '/x', status: 'idle' }, { id: 'b', project: 'y', cwd: '/y', status: 'idle' }, { id: 'c', project: 'z', cwd: '/z', status: 'idle' }], null, 1));
const middleOf = (hood, view = 0) => screen(hood.x + hood.cols * LOT / 2, hood.z + LOT, view);
test('the start zoom grows with the screen, and is closer than fitting the city', () => {
  const p = plan2();
  assert.deepEqual([390, 1048, 1368, 1600, 2000, 9000].map(w => startCamera(p, 0, w, 900, 1).step), [2, 2, 3, 3, 4, ZOOMS.at(-1)]);
  assert.ok(startCamera(p, 0, 1600, 900, 1).step > fitStep(cityBox(p, 0), 1600, 900, 1));
});
test('the waiting project, or the first, is on the screen, with no more empty space than it takes', () => {
  const p = plan2(), box = cityBox(p, 0);
  const filled = (c, lo, hi, n) => hi - lo <= n ? c === (lo + hi) / 2 : c - n / 2 >= lo && c + n / 2 <= hi;
  for (const [w, h, dpr] of [[390, 844, 3], [1048, 700, 1], [1368, 900, 1], [1600, 900, 1.25], [2380, 1400, 1]]) for (const [hood, key] of [...p.hoods.map(hood => [hood, hood.key]), [p.hoods[0], undefined]]) {
    const cam = startCamera(p, 0, w, h, dpr, key), size = fitCanvas(w, h, dpr, cam.step), [mx, my] = middleOf(hood), [px, py] = toCanvas(cam, size, mx, my);
    assert.ok(px >= 0 && px <= size.width && py >= 0 && py <= size.height, `${hood.key} at ${px},${py} of ${size.width}x${size.height}`);
    assert.ok(filled(cam.cx, box.x0, box.x1, size.width) && filled(cam.cy, box.y0, box.y1, size.height), `${cam.cx},${cam.cy} in ${JSON.stringify(box)} at ${size.width}x${size.height}`);
  }
});
test('a city smaller than the screen sits in the middle', () => {
  const empty = cityPlan(layoutOffice([], null, 1)), box = cityBox(empty, 0), cam = startCamera(empty, 0, 2600, 1400, 1);
  assert.equal(cam.cx, (box.x0 + box.x1) / 2); assert.equal(cam.cy, (box.y0 + box.y1) / 2);
  assert.ok(Number.isFinite(startCamera(empty, 0, 390, 844, 3).cx));
});
test('the frontmost sprite wins, and clear pixels fall through', () => {
  const sprite = { width: 2, height: 1, mask: Uint8Array.of(1, 0) }, back = { sprite: { width: 2, height: 1, mask: Uint8Array.of(1, 1) }, left: 0, top: 0, id: 'back' }, front = { sprite, left: 0, top: 0, id: 'front' };
  assert.equal(hitSprites([back, front], 0, 0).id, 'front'); assert.equal(hitSprites([back, front], 1, 0).id, 'back'); assert.equal(hitSprites([back, front], 9, 9), null);
});
test('a bubble near an edge slides in with its tail on the building', () => {
  const b = placeBubble(5, 50, 60, 20, 300, 200); assert.equal(b.x, 4); assert.equal(b.tail, 1);
  const r = placeBubble(295, 50, 60, 20, 300, 200); assert.equal(r.x, 236); assert.equal(r.tail, 59);
  const t = placeBubble(100, 2, 60, 20, 300, 200); assert.ok(t.y >= 4);
});

test('at 125% and 150% the zoom steps reach the sizes in between, not past them', () => {
  assert.deepEqual(ZOOMS.map(step => fitCanvas(800, 600, 1.25, step).scale), [1, 2, 4, 5]);
  assert.deepEqual(ZOOMS.map(step => fitCanvas(800, 600, 1.5, step).scale), [1, 3, 4, 6]);
});

test('focusBuildings centres on the buildings it is given, close enough to hold them', () => {
  const near = { x: 700, z: 700 }, far = { x: 1400, z: 700 }, [ax, ay] = screen(near.x, near.z, 0), [bx, by] = screen(far.x, far.z, 0);
  const one = focusBuildings([near], 0, 1600, 900, 1), both = focusBuildings([near, far], 0, 1600, 900, 1);
  assert.ok(Math.abs(one.cx - ax) < 2, `${one.cx} against ${ax}`);
  assert.ok(one.step >= both.step);
  assert.ok(Math.abs(both.cx - (ax + bx) / 2) < 2 && both.cy > Math.min(ay, by) - 80 && both.cy < Math.max(ay, by));
});

test('a sign clear of the bubbles stays where it is', () => {
  assert.deepEqual(clearOf({ x: 100, y: 100, w: 80, h: 20 }, [{ x: 300, y: 100, w: 80, h: 30 }], 800, 600), { x: 100, y: 100 });
});

test('a sign under a bubble steps to the nearest side that is clear', () => {
  const bubble = { x: 90, y: 90, w: 200, h: 30 }, sign = { x: 100, y: 105, w: 80, h: 20 }, spot = clearOf(sign, [bubble], 800, 600);
  assert.deepEqual(spot, { x: 100, y: 122 });
});

test('a sign steps past a second bubble and past the edge of the box', () => {
  const sign = { x: 100, y: 105, w: 80, h: 20 }, top = { x: 90, y: 90, w: 200, h: 30 }, below = { x: 90, y: 122, w: 200, h: 30 };
  assert.deepEqual(clearOf(sign, [top, below], 800, 600), { x: 100, y: 68 });
  assert.deepEqual(clearOf({ x: 0, y: 5, w: 80, h: 20 }, [{ x: 0, y: 0, w: 60, h: 30 }], 800, 600), { x: 0, y: 32 });
  assert.deepEqual(clearOf({ x: 700, y: 580, w: 80, h: 20 }, [{ x: 690, y: 560, w: 110, h: 30 }], 800, 600), { x: 700, y: 538 });
});

test('with nowhere clear a sign stays put, and an empty rect takes no room', () => {
  const sign = { x: 10, y: 10, w: 80, h: 20 };
  assert.deepEqual(clearOf(sign, [{ x: 0, y: 0, w: 100, h: 40 }], 100, 40), { x: 10, y: 10 });
  assert.deepEqual(clearOf(sign, [{ x: 20, y: 15, w: 0, h: 0 }], 800, 600), { x: 10, y: 10 });
});
