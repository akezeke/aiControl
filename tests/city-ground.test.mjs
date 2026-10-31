import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityPlan, LOT, PLOT, PLANT } from '../client/city/plan.js';
import { groundCells, lotLook } from '../client/city/ground.js';
import { lamp } from '../client/city/generator.js';
import { renderSprite } from '../client/city/sprite.js';
import { hex } from '../client/city/palette.js';

const sessions = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
const layout = { pods: [{ key: 'a', name: 'alpha', cwd: '/a', col: 0, row: 0 }, { key: 'b', name: 'beta', cwd: '/b', col: 1, row: 0 }], desks: new Map(sessions.map((id, i) => [id, { podKey: 'a', slot: i, sessionId: id }])), grid: { cols: 2 } };
const plan = cityPlan(layout, {}, null, [{ name: 'Claude Code', connected: true }, { name: 'Codex', connected: true }]), cells = groundCells(plan);
const at = (x, z) => { const i = (x - cells.x0 + (z - cells.z0) * cells.w) * 3; return [...cells.rgb.slice(i, i + 3)]; };
const coloursOf = (lot, half = LOT / 2 - PLOT) => { const seen = new Map(); for (let z = -half; z < half; z++) for (let x = -half; x < half; x++) { const c = at(lot.x + x, lot.z + z).join(); seen.set(c, (seen.get(c) || 0) + 1); } return seen; };
const taken = plan.hoods[0].lots.filter(lot => lot.sessionId), empty = plan.hoods[1].lots[0];

test('a lot in use is no longer one flat colour, and none of it is the old grey', () => {
  for (const lot of taken) {
    const seen = coloursOf(lot);
    assert.ok(seen.size >= 3, `${lot.key} has ${seen.size} colours`);
    // A shadow may land on it, once it's darkened to the nearest colour: the ground itself may not.
    const grey = seen.get(hex('#625565').join()) || 0, all = [...seen.values()].reduce((a, b) => a + b);
    assert.ok(grey / all < .02, `${lot.key} is ${(grey / all * 100).toFixed(1)}% the old grey`);
  }
});
test('a session keeps its ground, and sessions differ', () => {
  for (const id of sessions) assert.equal(lotLook(id), lotLook(id));
  assert.ok(new Set(sessions.map(lotLook)).size > 1);
  const again = groundCells(plan);
  assert.deepEqual(again.rgb, cells.rgb);
});
test('an empty lot is just the meadow, with stakes at its corners and no paving', () => {
  const seen = coloursOf(empty, LOT / 2 - 2), all = [...seen.values()].reduce((a, b) => a + b), [top, next] = [...seen.values()].sort((a, b) => b - a);
  assert.ok((top + (next || 0)) / all > .9, `${seen.size} colours, the main two only ${((top + next) / all * 100).toFixed(1)}%`);
  for (const look of ['a', 'b', 'kerb', 'path']) for (const lot of taken) assert.ok(!seen.has(lotLook(lot.sessionId)[look].join()) || seen.get(lotLook(lot.sessionId)[look].join()) / all < .02, `${look} of ${lot.key} on an empty lot`);
  const stake = hex('#c7dcd0').join(), half = LOT / 2 - 2;
  assert.ok(seen.has(stake), 'no stakes');
  assert.deepEqual(at(empty.x - half, empty.z - half).join(), stake);
  assert.notEqual(at(empty.x, empty.z).join(), stake);
});
test('the patterns of the lots differ, not only their colours', () => {
  const stripes = new Set(), N = 40;
  for (const id of sessions) { const look = lotLook(id); let row = ''; for (let i = 0; i < N; i++) row += look.tile(i, 11) === look.a ? 'a' : 'b'; for (let i = 0; i < N; i++) row += look.tile(11, i) === look.a ? 'a' : 'b'; stripes.add(row); }
  assert.ok(stripes.size >= 2);
});
test('roads stop at the city\'s edge without a crossing leading nowhere', () => {
  const zebra = hex('#c7dcd0').join(), ROADW = 18, outer = plan.roads.xs[0], north = plan.roads.zs[0];
  for (let a = 0; a < 14; a++) for (let b = 1; b <= 2; b++) assert.notEqual(at(outer + a, north - b).join(), zebra, `north of the corner at ${a},${b}`);
  for (let a = 0; a < 14; a++) for (let b = 1; b <= 2; b++) assert.notEqual(at(outer - b, north + a).join(), zebra, `west of the corner at ${a},${b}`);
  assert.ok(ROADW);
});
test('trees stand on the outskirts, out of the way of the city and its plants', () => {
  const trees = cells.props.filter(({ x, z }) => x < -6 || z < -6 || x > plan.bounds.w + 6 || z > plan.bounds.d + 6);
  assert.ok(trees.length >= 6, `${trees.length} trees`);
  const water = c => c[2] > c[0] && c[1] > c[0] && c[0] < 20;
  for (const { x, z } of trees) {
    assert.ok(!water(at(Math.floor(x), Math.floor(z))), `in the sea at ${x},${z}`);
    for (const plant of plan.plants) assert.ok(Math.hypot(x - plant.x, z - plant.z) > 30, `on the ${plant.provider} plant`);
  }
});
test('the city is an island: land under the city and its plants, water beyond', () => {
  const water = c => c[2] > c[0] && c[1] > c[0] && c[0] < 20;
  assert.ok(water(at(cells.x0 + 1, cells.z0 + 1)), 'the far corner is sea');
  assert.ok(water(at(cells.x0 + cells.w - 2, cells.z0 + cells.d - 2)), 'so is the opposite one');
  for (const plant of plan.plants) {
    const x = Math.floor(plant.x), z = Math.floor(plant.z);
    for (const [dx, dz] of [[-30, 0], [30, 0], [0, -24], [0, 24]]) assert.ok(!water(at(x + dx, z + dz)), `${plant.provider} at ${dx},${dz}`);
  }
  assert.ok(PLANT > 0);
});
test('streets have lamps, and a lamp is lit', () => {
  const posts = cells.props.filter(prop => prop.stack === lamp());
  assert.ok(posts.length >= plan.hoods.length * 3, `${posts.length} lamps`);
  assert.ok(renderSprite(lamp(), 0).lit.includes(1));
  assert.ok(lamp().h < 12, 'too short to hide anything');
});
