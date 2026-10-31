import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityPlan, screen } from '../client/city/plan.js';
import { coastOf, groundCells, reachOf } from '../client/city/ground.js';
import { boatsAt, BOATS, seaFrame, SEA_FRAMES } from '../client/city/surroundings.js';

const desks = ['s1', 's2', 's3'].map((id, i) => [id, { podKey: 'a', slot: i, sessionId: id }]);
const layout = { pods: [{ key: 'a', name: 'alpha', cwd: '/a', col: 0, row: 0 }, { key: 'b', name: 'beta', cwd: '/b', col: 1, row: 0 }], desks: new Map(desks), grid: { cols: 2 } };
const providers = [{ name: 'Claude Code', connected: true }, { name: 'Codex', connected: true }];
const plan = cityPlan(layout, {}, null, providers, [], ['', 'work']), cells = groundCells(plan);
const rectsOf = list => { const out = []; for (let i = 0; i < list.length; i += 3) out.push(list.subarray(i, i + 3)); return out; };

test('the sea moves: its frames differ, and come round again', () => {
  const frames = Array.from({ length: SEA_FRAMES }, (_, f) => seaFrame(cells.water, f, 0));
  for (const frame of frames) assert.ok(frame.length > 0);
  assert.notDeepEqual(frames[0], frames[1]);
  assert.deepEqual(seaFrame(cells.water, SEA_FRAMES, 0), frames[0]);
});
test('waves stay off the land: only ever over sand or water', () => {
  const { w: W, d: D } = plan.bounds, reach = reachOf(W, D);
  assert.ok(cells.water.shore.length > 100);
  for (let i = 0; i < cells.water.shore.length; i += 2) assert.ok(reach(cells.water.shore[i], cells.water.shore[i + 1]) >= 0);
  for (let i = 0; i < cells.water.glint.length; i += 2) assert.ok(reach(cells.water.glint[i], cells.water.glint[i + 1]) >= 4);
});
test('what shows is where its cell is, in every view', () => {
  for (const view of [0, 1, 2, 3]) {
    const seen = new Set();
    for (let i = 0; i < cells.water.shore.length; i += 2) { const [sx, sy] = screen(cells.water.shore[i], cells.water.shore[i + 1], view); seen.add(`${Math.floor(sx)},${Math.floor(sy)}`); }
    for (let i = 0; i < cells.water.glint.length; i += 2) { const [sx, sy] = screen(cells.water.glint[i], cells.water.glint[i + 1], view); seen.add(`${Math.floor(sx)},${Math.floor(sy)}`); }
    for (const [sx, sy] of rectsOf(seaFrame(cells.water, 3, view))) assert.ok(seen.has(`${sx},${sy}`), `${sx},${sy} in view ${view}`);
  }
});

// ---- The coast
test('a small island lies off the east shore, with water between', () => {
  const { w: W, d: D } = plan.bounds, reach = reachOf(W, D), { isle, bridge } = coastOf(W, D);
  assert.ok(reach(isle.x, isle.z) < -10, 'land on the island');
  assert.ok(reach(bridge.x0 + (bridge.x1 - bridge.x0) / 2, bridge.z) > 4, 'water under the middle of the bridge');
  assert.ok(reach(bridge.x0 - 2, bridge.z) < 0 && reach(bridge.x1 + 2, bridge.z) < 0, 'it joins land at both ends');
});
test('a bridge is laid over the water, and the waves stay off it', () => {
  const { w: W, d: D } = plan.bounds, { bridge } = coastOf(W, D), mid = Math.floor((bridge.x0 + bridge.x1) / 2), i = (mid - cells.x0 + (bridge.z - cells.z0) * cells.w) * 3;
  const c = [...cells.rgb.slice(i, i + 3)], water = c[2] > c[0] && c[1] > c[0] && c[0] < 20;
  assert.ok(!water, `${c}`);
  for (let k = 0; k < cells.water.shore.length; k += 2) assert.ok(!(Math.abs(cells.water.shore[k + 1] - bridge.z) < 4 && cells.water.shore[k] > bridge.x0 && cells.water.shore[k] < bridge.x1), 'a wave on the bridge');
});
test('a pier runs from the south shore out over the water', () => {
  const { w: W, d: D } = plan.bounds, reach = reachOf(W, D), { pier } = coastOf(W, D);
  assert.ok(reach(pier.x, pier.z0) < 4, 'starts ashore');
  assert.ok(reach(pier.x, pier.z1) > 8, 'ends over water');
});
test('nothing grows on the bridge, or in the water by the island', () => {
  const { w: W, d: D } = plan.bounds, { bridge } = coastOf(W, D), reach = reachOf(W, D);
  for (const { x, z } of cells.props) {
    assert.ok(!(z > bridge.z - 8 && z < bridge.z + 8 && x > bridge.x0 && x < bridge.x1), `on the bridge at ${x},${z}`);
    if (x > W + 60) assert.ok(reach(x, z) < 0, `in the sea at ${x},${z}`);
  }
});
for (const [name, W, D] of [['small', 330, 200], ['large', 1200, 800]]) test(`boats keep to open water, clear of shore, island and pier: ${name} city`, () => {
  const reach = reachOf(W, D), { pier } = coastOf(W, D);
  for (let now = 0; now < 2e6; now += 773) {
    const boats = boatsAt({ w: W, d: D }, now);
    assert.equal(boats.length, BOATS);
    for (const { x, z } of boats) {
      assert.ok(reach(x, z) > 10, `${x},${z} is ${reach(x, z)} from shore`);
      assert.ok(!(Math.abs(x - pier.x) < 12 && z > pier.z0 && z < pier.z1 + 8), `at the pier: ${x},${z}`);
    }
  }
});
test('boats move, whole cells at a time, and never run into each other', () => {
  const a = boatsAt(plan.bounds, 1000), b = boatsAt(plan.bounds, 21000);
  assert.notDeepEqual(a, b);
  for (const { x, z } of b) { assert.equal(x, Math.round(x)); assert.equal(z, Math.round(z)); }
  for (let now = 0; now < 2e6; now += 9973) { const boats = boatsAt(plan.bounds, now); for (let i = 0; i < boats.length; i++) for (let j = 0; j < i; j++) assert.ok(Math.hypot(boats[i].x - boats[j].x, boats[i].z - boats[j].z) > 20); }
});
