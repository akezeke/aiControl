import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityPlan, screen } from '../client/city/plan.js';
import { groundCells, reachOf } from '../client/city/ground.js';
import { seaFrame, SEA_FRAMES } from '../client/city/surroundings.js';

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
