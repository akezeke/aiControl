import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { labelRects, labelColour } from '../client/bricks3d/stickers.js';
import { geometryFor } from '../client/bricks3d/parts.js';
import { summary } from '../client/theme-console.js';
import * as bond from '../client/bricks3d/bond.js';
import { STUD, BRICK, PLATE, rng, layCourse, layWall, seamsOf, runOf, stackOf, buttonStuds, LENGTHS } from '../client/bricks3d/bond.js';

const read = path => readFileSync(new URL(`../client/${path}`, import.meta.url), 'utf8');
const css = read('bricks.css');

test('a stud is 20px, a brick 24 and a plate 8, as real bricks are in proportion (8, 9.6 and 3.2 mm)', () => {
  assert.equal(STUD / 8, 2.5); assert.equal(BRICK / 9.6, 2.5); assert.equal(PLATE / 3.2, 2.5);
});

test('a course of bricks fills the wall exactly, with real brick lengths only', () => {
  for (let n = 1; n < 60; n++) {
    const lengths = layCourse(n, rng(n));
    assert.equal(lengths.reduce((a, b) => a + b, 0), n); assert.ok(lengths.every(length => LENGTHS.includes(length)));
  }
});

test('running bond: seams of one course stay clear of the course below wherever the width allows', () => {
  const wall = layWall(24, 12, 5);
  for (let r = 1; r < wall.length; r++) {
    const below = seamsOf(wall[r - 1].map(b => b.length)), here = seamsOf(wall[r].map(b => b.length));
    assert.equal([...here].filter(seam => below.has(seam)).length, 0, `course ${r} lines up with the one below`);
  }
  assert.deepEqual(layWall(24, 12, 5), layWall(24, 12, 5), 'the same seed lays the same wall');
});

test('runs, stacks and buttons are built of whole real pieces', () => {
  for (let n = 1; n < 40; n++) { const run = runOf(n); assert.equal(run.reduce((a, b) => a + b, 0), n); assert.ok(run.every(length => LENGTHS.includes(length))); }
  assert.deepEqual(stackOf(56), { bricks: 2, plates: 1, height: 56 });
  assert.deepEqual(stackOf(32), { bricks: 1, plates: 1, height: 32 });
  assert.equal(buttonStuds(30), 2); assert.equal(buttonStuds(41), 3); assert.equal(buttonStuds(100), 6); assert.equal(buttonStuds(170), 8);
  for (const width of [1, 19, 20, 21, 39, 61, 99, 101, 150, 160]) assert.ok(LENGTHS.includes(buttonStuds(width)) && buttonStuds(width) * STUD >= width);
});

test('masonry leaves openings clear using whole bricks and plates', () => {
  assert.equal(typeof bond.masonry, 'function');
  const openings = [{ x: 39, y: 7, w: 83, h: 35 }, { x: 100, y: 24, w: 80, h: 24 }];
  const pieces = bond.masonry(200, 72, openings, 17);
  assert.ok(pieces.length);
  for (const p of pieces) {
    assert.ok(LENGTHS.includes(p.length));
    assert.ok([BRICK, PLATE].includes(p.height));
    assert.ok(p.x >= 0 && p.x + p.length * STUD <= 200 && p.y >= 0 && p.y + p.height <= 72);
    for (const hole of openings) assert.ok(p.x + p.length * STUD <= hole.x || p.x >= hole.x + hole.w || p.y + p.height <= hole.y || p.y >= hole.y + hole.h, JSON.stringify(p));
  }
  assert.deepEqual(bond.masonry(200, 72, openings, 17), pieces);
  assert.deepEqual(bond.masonry(20, 24, [{ x: -10, y: -10, w: 40, h: 50 }]), []);
});

test('castle slopes have a sloping front profile and fit the brick grid', () => {
  const geometry = geometryFor('1:24:20:slope');
  geometry.computeBoundingBox();
  assert.deepEqual(geometry.boundingBox.min.toArray(), [0, 0, 0]);
  assert.deepEqual(geometry.boundingBox.max.toArray(), [20, 24, 20]);
  const vertices = geometry.attributes.position;
  let upperFront = 0, lowerFront = 0;
  for (let i = 0; i < vertices.count; i++) {
    if (vertices.getY(i) > 23) upperFront = Math.max(upperFront, vertices.getZ(i));
    if (vertices.getY(i) < 1) lowerFront = Math.max(lowerFront, vertices.getZ(i));
  }
  assert.ok(upperFront < lowerFront / 2, `${upperFront} vs ${lowerFront}`);
});

test('timber braces are mirrored wedges that meet the stud grid', () => {
  const left = geometryFor('2:48:20:wedge-left'), right = geometryFor('2:48:20:wedge-right');
  for (const g of [left, right]) { g.computeBoundingBox(); assert.deepEqual(g.boundingBox.min.toArray(), [0, 0, 0]); assert.deepEqual(g.boundingBox.max.toArray(), [40, 48, 20]); }
  const contains = (g, x, y) => { const a = g.attributes.position; for (let i = 0; i < a.count; i++) if (Math.abs(a.getX(i) - x) < .01 && Math.abs(a.getY(i) - y) < .01) return true; return false; };
  assert.ok(contains(left, 0, 0)); assert.equal(contains(left, 40, 0), false);
  assert.ok(contains(right, 40, 0)); assert.equal(contains(right, 0, 0), false);
});

test('nested surfaces build on the immediate parent face', () => {
  assert.equal(typeof bond.surfaceBase, 'function');
  assert.equal(bond.surfaceBase(0), 0);
  assert.equal(bond.surfaceBase(0, 12), 12);
  assert.equal(bond.surfaceBase(0, 24), 24);
  assert.equal(bond.surfaceBase(80, 92), 92);
});

test('progress coins fill whole two-stud cells and clamp out-of-range values', () => {
  assert.equal(typeof bond.meterCells, 'function');
  assert.deepEqual(bond.meterCells(120, .5), [true, true, false]);
  assert.deepEqual(bond.meterCells(80, -1), [false, false]);
  assert.deepEqual(bond.meterCells(80, 2), [true, true]);
  assert.deepEqual(bond.meterCells(19, .8), []);
});

test('side-stud bricks have connectors projecting from the brick face', () => {
  const g = geometryFor('2:24:20:side'); g.computeBoundingBox();
  assert.equal(g.boundingBox.min.z, 0);
  assert.equal(g.boundingBox.max.z, 24);
  const v = g.attributes.position; const centers = new Set();
  for (let i = 0; i < v.count; i++) if (v.getZ(i) > 23.9) centers.add(v.getX(i) < 20 ? 0 : 1);
  assert.deepEqual([...centers].sort(), [0, 1]);
});

test('round plates face outward and fit their mounting footprint', () => {
  const g = geometryFor('1:20:4:round'); g.computeBoundingBox();
  assert.deepEqual(g.boundingBox.min.toArray(), [0, 0, 0]);
  assert.deepEqual(g.boundingBox.max.toArray(), [20, 20, 4]);
  let closest = Infinity; const v = g.attributes.position;
  for (let i = 0; i < v.count; i++) closest = Math.min(closest, Math.hypot(v.getX(i), v.getY(i)));
  assert.ok(closest > 3, `round plate has a square corner: ${closest}`);
});

test('button hover keeps most of the brick in its opening', () => {
  assert.equal(typeof bond.buttonHover, 'number');
  assert.ok(bond.buttonHover > 0 && bond.buttonHover <= 3);
});

test('a pressed button has the same depth with or without hover', () => {
  assert.equal(typeof bond.buttonDepth, 'function');
  assert.equal(bond.buttonDepth(0, 1), bond.buttonDepth(bond.buttonHover, 1));
  assert.equal(bond.buttonDepth(0, 1), -20);
  assert.equal(bond.buttonDepth(0, 0), -10);
  assert.equal(bond.buttonDepth(bond.buttonHover, 0), -10 + bond.buttonHover);
});

test('sticker placement is stable and stays close to the brick face', () => {
  assert.equal(typeof bond.stickerPlacement, 'function');
  const a = bond.stickerPlacement(123, 160, 32), b = bond.stickerPlacement(456, 160, 32);
  assert.deepEqual(a, bond.stickerPlacement(123, 160, 32));
  assert.notDeepEqual(a, b);
  for (const p of [a, b, bond.stickerPlacement(12, 800, 100)]) {
    assert.ok(Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1);
    assert.ok(Math.abs(p.angle) <= .012);
  }
});

test('sticker labels stay inside their clipping region on wrapped text', () => {
  const lines = [{ left: 5, top: 3, right: 55, bottom: 19 }, { left: 5, top: 23, right: 85, bottom: 39 }];
  assert.deepEqual(labelRects(lines, { left: 4, top: 0, right: 70, bottom: 36 }), [
    { left: 4, top: 2, right: 57, bottom: 20 }, { left: 4, top: 22, right: 70, bottom: 36 },
  ]);
  assert.deepEqual(labelRects(lines, { left: 100, top: 0, right: 120, bottom: 50 }), []);
});

test('sticker backing contrasts with dark and light printing', () => {
  assert.equal(labelColour('rgb(25, 32, 42)'), 'light');
  assert.equal(labelColour('rgb(240, 232, 210)'), 'dark');
  assert.equal(labelColour('rgb(226, 194, 115)'), 'dark');
});

test('a status label gets a whole-stud plate wide enough for its text', async () => {
  const previous = globalThis.document; globalThis.document = { createRange: () => ({}) };
  try {
    const { BrickUi } = await import('../client/bricks3d/ui.js');
    const badge = { offsetWidth: 83, offsetHeight: 20, style: {} };
    BrickUi.prototype.snapSizesNow.call({}, [{ el: badge, kind: 'badge' }]);
    assert.equal(badge.style.minWidth, '100px'); assert.equal(badge.style.minHeight, '24px');
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('page scene leaves modal controls in the browser top layer', async () => {
  const previous = globalThis.document;
  globalThis.document = { createRange: () => ({}) };
  try {
    const { PAGE } = await import('../client/bricks3d/ui.js');
    const withinDialog = { closest: selector => selector.split(',').map(s => s.trim()).includes('dialog') ? {} : null };
    const ordinary = { closest: () => null };
    assert.equal(PAGE.skip(withinDialog), true);
    assert.equal(PAGE.skip(ordinary), false);
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('every image the Brick Knights styles name is shipped', () => {
  const urls = [...css.matchAll(/url\('(\/[^']+)'\)/g), ...read('provider-icons.css').matchAll(/url\('(\/providers\/bricks-[^']+)'\)/g), ...read('spend-art.js').matchAll(/href="(\/spend-bricks[^"]+)"/g)].map(match => match[1]);
  assert.ok(urls.length > 10);
  for (const url of new Set(urls)) assert.ok(existsSync(new URL(`../client/public${url}`, import.meta.url)), `${url} is missing`);
});

test('the theme is registered everywhere a theme must be', () => {
  assert.match(read('themes.js'), /id: 'bricks'/);
  assert.match(read('main.js'), /bricks: 'Brick Knights'/);
  assert.match(read('alerts.js'), /\n\s+bricks: kind =>/);
  assert.match(read('spend.css'), /data-theme=bricks\] \.spend-art\.bricks/);
  assert.equal(summary([{ status: 'working' }, { status: 'permission' }]).bricks, '1 awaits your orders · 1 on a quest');
  assert.equal(summary([]).bricks, 'The keep is quiet');
});

test('the page and the chat panel are built in one scene each, by the same camera', () => {
  const layer = read('bricks3d/layer.js'), ui = read('bricks3d/ui.js');
  assert.match(layer, /PerspectiveCamera/); assert.doesNotMatch(layer, /OrthographicCamera/);
  assert.match(ui, /export const PAGE/); assert.match(ui, /export const PANEL/);
  assert.match(read('bricks3d/mount.js'), /new BrickUi\(new BrickLayer\(canvas\), PANEL, el\)/);
});
