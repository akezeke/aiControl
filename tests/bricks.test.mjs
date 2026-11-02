import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { summary } from '../client/theme-console.js';
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
