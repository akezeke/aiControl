import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityPlan, screen, unproject, LOT, PLANT, ROAD, WALK } from '../client/city/plan.js';
import { coastOf, groundCells } from '../client/city/ground.js';
import { powerLines } from '../client/city/power.js';
import { PYLON_ARM, PYLON_REACH } from '../client/city/generator.js';
import { hex } from '../client/city/palette.js';

const pods = n => Array.from({ length: n }, (_, i) => ({ key: `p${i}`, name: `p${i}`, cwd: `/p${i}`, col: i % 3, row: Math.floor(i / 3) }));
const cityOf = (n, accounts = ['']) => cityPlan({ pods: pods(n), desks: new Map(), grid: { cols: 3 } }, {}, null, [{ name: 'Claude Code', connected: true }, { name: 'Codex', connected: true }], [], accounts);
const plan = cityOf(9), cells = groundCells(plan), { xs, zs } = plan.roads;
const at = (x, z) => { const i = (x - cells.x0 + (z - cells.z0) * cells.w) * 3; return [...cells.rgb.slice(i, i + 3)].join(); };
const ROADS = hex('#3e3546').join(), WALKS = hex('#966c6c').join(), ZEBRA = hex('#c7dcd0').join(), BLOCK = hex('#484a77').join();

test('a junction keeps its kerb at all four corners', () => {
  const x = xs[1], z = zs[1];
  for (const [a, b] of [[x - 1, z - 1], [x + ROAD, z - 1], [x - 1, z + ROAD], [x + ROAD, z + ROAD]]) assert.equal(at(a, b), WALKS, `${a},${b}`);
  assert.equal(at(x + (ROAD >> 1), z + (ROAD >> 1)), ROADS);
});
test('a crossing is bars across each road that carries on, deeper than the kerb', () => {
  const x = xs[1], z = zs[1];
  // Going north out of the junction: a bar along the traffic, a gap, a bar, the depth of the crossing.
  for (const depth of [1, 2, 3, 4]) { assert.equal(at(x, z - depth), ZEBRA, `north, ${depth} in`); assert.equal(at(x + 2, z - depth), ROADS, `gap, ${depth} in`); assert.equal(at(x + 4, z - depth), ZEBRA); }
  for (const depth of [1, 2, 3, 4]) assert.equal(at(x - depth, z), ZEBRA, `west, ${depth} in`);
  assert.equal(at(x + ROAD + 3, z), ZEBRA, 'east');
  assert.equal(at(x, z + ROAD + 3), ZEBRA, 'south');
});
test('nothing runs down the middle of a road right up to a crossing', () => {
  const x = xs[1], z = zs[1], mid = x + (ROAD >> 1);
  // Bars either side of the centre have a gap between them, and the dashes start some way back.
  for (const depth of [5, 6, 7]) assert.equal(at(mid, z - depth), ROADS, `${depth} back`);
});
test('where a road stops at the ring, the kerb carries on past the end of it', () => {
  const x = xs[1], first = zs[0], last = zs.at(-1), west = xs[0], east = xs.at(-1);
  for (const a of [x, x + 6, x + ROAD - 1]) { assert.equal(at(a, first - 1), WALKS, `north, ${a}`); assert.equal(at(a, last + ROAD), WALKS, `south, ${a}`); }
  for (const b of [zs[1], zs[1] + 6, zs[1] + ROAD - 1]) { assert.equal(at(west - 1, b), WALKS, `west, ${b}`); assert.equal(at(east + ROAD, b), WALKS, `east, ${b}`); }
  // And there's no crossing to nowhere.
  assert.notEqual(at(x, first - 1), ZEBRA);
});
test('a road running into the ring opens onto it: no kerb across its mouth', () => {
  const { w: W } = plan.bounds, { bridge } = coastOf(W, plan.bounds.d);
  for (const plant of plan.plants) for (const out of [1, 2]) {
    const mouth = plant.provider === 'claude' ? [xs[0] - out, Math.round(plant.z)] : [Math.round(plant.x) + 3, zs[0] - out];
    assert.equal(at(...mouth), ROADS, `${plant.key} ${out} out`);
  }
  for (const out of [1, 2]) assert.equal(at(xs.at(-1) + ROAD + out - 1, bridge.z + 3), ROADS, `bridge ${out} out`);
});
test('there are no lines between empty lots: the meadow runs on', () => {
  const hood = plan.hoods.find(h => h.cols > 1), lot = hood.lots.find(l => !l.sessionId);
  for (const z of [lot.z - 10, lot.z, lot.z + 10]) for (const x of [hood.x + LOT - 1, hood.x + LOT]) assert.notEqual(at(x, z), BLOCK, `${x},${z}`);
});

// A wire hangs up in the air, so what it's drawn over depends on the view: all four have to come out clear.
const onRoad = (p, x, z) => {
  const { w: W, d: D } = p.bounds;
  if (x >= 0 && z >= 0 && x < W && z < D && (p.roads.xs.some(a => x >= a - WALK && x < a + ROAD + WALK) || p.roads.zs.some(b => z >= b - WALK && z < b + ROAD + WALK))) return true;
  return p.plants.some(plant => plant.provider === 'claude' ? x >= -PLANT + 16 && x < 0 && Math.abs(z - plant.z) < 9 : z >= -PLANT + 12 && z < 0 && Math.abs(x - plant.x) < 9);
};
for (const [name, p] of [['a big city', plan], ['a small one', cityOf(1)], ['two accounts', cityOf(4, ['', 'work'])], ['three accounts', cityOf(1, ['', 'work', 'side'])]]) test(`no wire is drawn across a road, in any view: ${name}`, () => {
  const { wires, feeds } = powerLines(p), hits = [];
  for (const view of [0, 1, 2, 3]) for (const [ax, az, bx, bz] of [...wires, ...feeds]) for (const side of [-PYLON_REACH, PYLON_REACH]) {
    const along = az === bz, A = screen(ax + (along ? 0 : side), az + (along ? side : 0), view), B = screen(bx + (along ? 0 : side), bz + (along ? side : 0), view), n = Math.ceil(Math.max(Math.abs(B[0] - A[0]), Math.abs(B[1] - A[1])));
    for (let k = 0; k <= n; k++) { const t = k / n, [x, z] = unproject(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t - PYLON_ARM, view); if (onRoad(p, x, z)) { hits.push(`view ${view}: ${ax},${az} to ${bx},${bz}`); break; } }
  }
  assert.deepEqual([...new Set(hits)], []);
});
