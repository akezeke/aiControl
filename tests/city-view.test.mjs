import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutOffice } from '../client/office/layout.js';
import { cityPlan, screen, LOT } from '../client/city/plan.js';
import { ZOOMS, fitCanvas, cityBox, fitStep, startCamera, toCanvas, fromCanvas, hitSprites, placeBubble, focusBuildings } from '../client/city/view.js';

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
test('a phone starts on the waiting project, or the first', () => {
  const p = plan2(), hood = p.hoods[1], [sx, sy] = screen(hood.x + hood.cols * LOT / 2, hood.z + LOT, 0);
  const cam = startCamera(p, 0, 390, 844, 3, hood.key); assert.equal(cam.step, 2); assert.equal(Math.round(cam.cx), Math.round(sx)); assert.equal(Math.round(cam.cy), Math.round(sy));
  assert.equal(startCamera(p, 0, 390, 844, 3, undefined).step, 2);
});
test('a desktop starts fitted to the whole city; an empty city starts anywhere valid', () => {
  const p = plan2(), cam = startCamera(p, 0, 1600, 900, 1); assert.equal(cam.step, fitStep(cityBox(p, 0), 1600, 900, 1));
  const e = startCamera(cityPlan(layoutOffice([], null, 1)), 0, 390, 844, 3); assert.ok(Number.isFinite(e.cx) && Number.isFinite(e.cy));
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
