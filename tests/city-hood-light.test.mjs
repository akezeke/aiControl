import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityPlan, screen, LOT } from '../client/city/plan.js';
import { groundCells, paintGround, paintHood } from '../client/city/ground.js';

const layout = { pods: [{ key: 'a', name: 'alpha', cwd: '/a', col: 0, row: 0 }, { key: 'b', name: 'beta', cwd: '/b', col: 1, row: 0 }], desks: new Map([['s1', { podKey: 'a', slot: 0, sessionId: 's1' }]]), grid: { cols: 2 } };
const plan = cityPlan(layout), cells = groundCells(plan), hood = plan.hoods[0];
// An odd x + z lands on a half pixel, which rounds off the spot asked for.
const pixel = (image, x, z0, view, key = 'rgba') => { const z = z0 + (x + z0) % 2, [sx, sy] = screen(x, z, view), i = (Math.round(sx) + image.originX + (Math.round(sy) + image.originY) * image.width) * 4; return image[key]?.slice(i, i + 4); };
const light = c => c[0] + c[1] + c[2];
const W = hood.cols * LOT, D = 2 * LOT;

for (const view of [0, 1, 2, 3]) {
  const lit = paintHood(cells, hood, view), ground = paintGround(cells, view);

  test(`view ${view}: every cell of the neighbourhood is lit, and nothing outside it`, () => {
    for (const lot of hood.lots) assert.equal(pixel(lit, lot.x, lot.z, view)[3], 255, lot.key);
    for (const [x, z] of [[hood.x - 6, hood.z + 20], [hood.x + W + 6, hood.z + 20], [hood.x + 20, hood.z - 6], [hood.x + 20, hood.z + D + 6]]) assert.equal(pixel(lit, x, z, view)?.[3] ?? 0, 0, `${x},${z}`);
    for (const lot of hood.lots) for (const [dx, dz] of [[-20, -20], [20, 20]]) assert.ok(light(pixel(lit, lot.x + dx, lot.z + dz, view)) > light(pixel(ground, lot.x + dx, lot.z + dz, view)), `${lot.key} is brighter than the ground it lies on`);
  });

  test(`view ${view}: the edge stands out from the lots, and the lots from each other`, () => {
    const fill = pixel(lit, hood.x + LOT / 2 + 20, hood.z + LOT / 2 + 20, view), line = pixel(lit, hood.x + LOT, hood.z + 20, view), rim = pixel(lit, hood.x + 1, hood.z + 20, view);
    assert.ok(light(line) > light(fill), 'a line between lots');
    assert.ok(light(rim) > light(line), 'the edge');
    for (const [x, z] of [[hood.x + 1, hood.z + D - 2], [hood.x + W - 2, hood.z + 1], [hood.x + W - 2, hood.z + D - 2]]) assert.deepEqual([...pixel(lit, x, z, view)], [...rim]);
  });

  test(`view ${view}: only the edge glows`, () => {
    assert.ok(light(pixel(lit, hood.x + 1, hood.z + 20, view, 'edge')) > 0);
    assert.equal(pixel(lit, hood.x + LOT / 2, hood.z + LOT / 2, view, 'edge')[3], 0);
  });
}

test('a lot with a building on it stays told apart from an empty one', () => {
  const taken = hood.lots.find(lot => lot.sessionId), empty = hood.lots.find(lot => !lot.sessionId), lit = paintHood(cells, hood, 0);
  assert.notDeepEqual([...pixel(lit, taken.x + 20, taken.z + 20, 0)], [...pixel(lit, empty.x + 20, empty.z + 20, 0)]);
});
test('lit ground stays the same kind of ground: a meadow does not turn into water', () => {
  const olive = [0x56, 0x54, 0x30], hood = { x: 0, z: 0, cols: 1 }, W = 70, D = 140, big = new Uint8Array(W * D * 3);
  for (let i = 0; i < W * D; i++) big.set(olive, i * 3);
  const { width, height, rgba } = paintHood({ x0: 0, z0: 0, w: W, rgb: big }, hood, 0);
  let seen = 0;
  for (let i = 0; i < width * height; i++) if (rgba[i * 4 + 3]) { const [r, g, b] = rgba.slice(i * 4, i * 4 + 3); if (r === 0x8f || r === 0xfb) continue; seen++; assert.ok(r > b && g > b, `${r},${g},${b}`); assert.ok(r > olive[0] - 1 && g > olive[1] - 1, `not brighter: ${r},${g},${b}`); }
  assert.ok(seen > 100);
});
