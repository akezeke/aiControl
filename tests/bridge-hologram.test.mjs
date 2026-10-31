import test from 'node:test';
import assert from 'node:assert/strict';
import { fitPanel, hologramLayout, rowAt, listHeight } from '../client/bridge/hologram.js';

const layout = hologramLayout(3, 512, 400);
test('rows stack under the title and stay inside the panel', () => {
  assert.equal(layout.rows.length, 3);
  assert.ok(layout.rows[0].y >= layout.top);
  for (const row of layout.rows) assert.ok(row.x >= 0 && row.x + row.width <= 512 && row.y + row.height <= 400);
  for (let i = 1; i < 3; i++) assert.ok(layout.rows[i].y >= layout.rows[i - 1].y + layout.rows[i - 1].height);
});
const middle = row => [(row.x + row.width / 2) / 512, 1 - (row.y + row.height / 2) / 400];
test('a point on a row picks it, with v running up the panel as in a texture', () => {
  layout.rows.forEach((row, i) => assert.equal(rowAt(layout, ...middle(row)), i));
});
test('the title and the empty space below pick nothing', () => {
  assert.equal(rowAt(layout, .5, 1 - 2 / 400), -1);
  assert.equal(rowAt(hologramLayout(1, 512, 400), .5, .02), -1);
});
test('more rows than fit are left out rather than drawn off the panel', () => {
  const crowded = hologramLayout(40, 512, 400);
  assert.ok(crowded.rows.length < 40);
  assert.ok(crowded.rows.at(-1).y + crowded.rows.at(-1).height <= 400);
});
test('no rows at all', () => assert.equal(rowAt(hologramLayout(0, 512, 400), .5, .5), -1));

test('a panel with room beside the centre of the view stays where it was put', () => {
  assert.deepEqual(fitPanel(-.72, .21, .6, 1.015, 1.99, 1.12), { x: -.72, y: .21, size: 1 });
});

test('a panel too wide to sit to one side of a narrow view opens in the middle of it', () => {
  assert.equal(fitPanel(-.72, .21, .6, 1.015, .52, 1.12).x, 0);
  assert.equal(fitPanel(.72, .21, .78, .6, .52, 1.12).x, 0);
});

test('a panel that would overhang the side is brought just inside it', () => {
  assert.ok(Math.abs(fitPanel(-.72, 0, .6, .6, .76, 1).x + .42) < 1e-9);
  assert.ok(Math.abs(fitPanel(.72, 0, .6, .6, .76, 1).x - .42) < 1e-9);
});

test('a panel above or below the view is brought back into it, or to the middle if it fills it', () => {
  assert.ok(Math.abs(fitPanel(0, .9, .6, .6, 2, 1).y - .66) < 1e-9);
  assert.equal(fitPanel(0, .9, .6, 2.5, 2, 1).y, 0);
});

test('on a phone held upright a panel grows to fill most of the width, in the middle of the view', () => {
  const { x, y, size } = fitPanel(-.72, .21, .6, 1.015, .52, 1.12, true);
  assert.equal(x, 0); assert.equal(y, 0);
  assert.ok(Math.abs(.6 * size - .9 * 2 * .52) < 1e-9);
});

test('on a phone on its side a panel grows to fill most of the height, in the middle of the view, where it faces you square on', () => {
  const { x, y, size } = fitPanel(-.72, .21, .6, 1.015, 1.63, .76, true);
  assert.ok(Math.abs(1.015 * size - .9 * 2 * .76) < 1e-9);
  assert.equal(x, 0); assert.equal(y, 0);
});

test('a grown panel never reaches past the edge of the view', () => {
  for (const [reachX, reachY] of [[.52, 1.12], [1.63, .76], [.6, .6]]) for (const [width, height] of [[.6, 1.015], [.78, .6]]) {
    const { x, y, size } = fitPanel(-.72, .21, width, height, reachX, reachY, true);
    assert.ok(Math.abs(x) + width * size / 2 <= reachX + 1e-9); assert.ok(Math.abs(y) + height * size / 2 <= reachY + 1e-9);
  }
});

test('a panel on a bigger screen is not enlarged, even centred in a narrow window', () => {
  assert.equal(fitPanel(-.72, .21, .6, 1.015, .52, 1.12).size, 1);
});
test('a list is tall enough for every row', () => {
  for (const count of [1, 3, 8, 12]) {
    const height = listHeight(count, .6);
    assert.equal(hologramLayout(count, 512, Math.round(512 * height / .6)).rows.length, count);
    assert.ok(height < listHeight(count + 1, .6));
  }
});
