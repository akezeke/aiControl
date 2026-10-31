import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutOffice } from '../client/office/layout.js';
import { cityPlan, spawnTarget, screen, unproject, turned, lotAt, annexAt, LOT, PLANT, SPOTS } from '../client/city/plan.js';
import { groundCells, paintGround } from '../client/city/ground.js';
import { tower } from '../client/city/identity.js';
import { inPalette } from '../client/city/palette.js';

const s = (id, project, extra = {}) => ({ id, project, cwd: `/p/${project}`, status: 'idle', ...extra });
const plan = (sessions, ...rest) => cityPlan(layoutOffice(sessions, null, 1), ...rest);
const views = [0, 1, 2, 3];
test('slot to lot', () => {
  const p = plan([s('a', 'x')]), hood = p.hoods[0], lot = k => hood.lots.find(l => l.slot === k);
  assert.equal(lot(1).x, lot(0).x); assert.equal(lot(1).z, lot(0).z + LOT);
  assert.equal(lot(2).x, lot(0).x + LOT); assert.equal(lot(2).z, lot(0).z);
});
test('a neighbourhood starts with 4 lots and always has an empty one', () => {
  assert.equal(plan([s('a', 'x')]).hoods[0].lots.length, 4);
  for (let n = 1; n < 12; n++) { const lots = plan([...Array(n).keys()].map(i => s(`s${i}`, 'x'))).hoods[0].lots; assert.ok(lots.some(l => !l.sessionId), `${n}`); assert.equal(lots.length % 2, 0); }
});
test('holes in the slots: every building has a lot and one stays empty', () => {
  const saved = { saved: true, desks: new Map([['a', { podKey: '/p/x', slot: 0 }], ['b', { podKey: '/p/x', slot: 5 }]]), pods: [{ key: '/p/x', col: 0, row: 0, name: 'x' }], room: { width: 0, depth: 0 } };
  const hood = cityPlan(layoutOffice([s('a', 'x'), s('b', 'x')], saved, 1)).hoods[0];
  assert.equal(hood.cols, 4); assert.equal(hood.lots.find(l => l.slot === 5).sessionId, 'b'); assert.ok(hood.lots.some(l => !l.sessionId));
});
test('positions stay put across updates, and columns only grow on an open page', () => {
  const l1 = layoutOffice([s('a', 'x'), s('b', 'y')], null, 1), p1 = cityPlan(l1), l2 = layoutOffice([s('a', 'x'), s('b', 'y'), s('c', 'y')], l1, 2), p2 = cityPlan(l2, {}, p1);
  assert.equal(p2.buildings.find(b => b.id === 'a').x, p1.buildings.find(b => b.id === 'a').x);
  const many = [...Array(6).keys()].map(i => s(`s${i}`, 'x')), big = cityPlan(layoutOffice(many, null, 1)), small = cityPlan(layoutOffice([s('s0', 'x')], null, 1), {}, big);
  assert.equal(small.hoods[0].cols, big.hoods[0].cols);
});
test('projection and inverse projection match, in every view', () => {
  for (const v of views) for (const [x, z] of [[0, 0], [10, 4], [-30, 77], [501, -12]]) { const [sx, sy] = screen(x, z, v), [a, b] = unproject(sx, sy, v); assert.ok(Math.abs(a - x) < 1e-9 && Math.abs(b - z) < 1e-9); }
});
test('four turns of an annex spot come back round', () => { for (const spot of SPOTS) { let at = spot; for (const v of [1, 1, 1, 1]) at = turned(at, v); assert.deepEqual(at.map(n => n + 0), spot); } });
test('lotAt finds lots and misses the roads', () => {
  const p = plan([s('a', 'x')]), lot = p.hoods[0].lots[0];
  assert.equal(lotAt(p, lot.x, lot.z).key, lot.key); assert.equal(lotAt(p, -5, -5), null);
});
test('parcels are stable for a project name, whoever else is around', () => {
  const kinds = sessions => plan(sessions).parcels.map(c => c.kind + c.seed);
  assert.deepEqual(kinds([s('a', 'x')]), kinds([s('zzz', 'x')]));
  assert.ok(plan([s('a', 'x')]).parcels.every(c => ['park', 'pond', 'plaza', 'court', 'parking', 'market'].includes(c.kind)));
});
test('a vacant grid position is a park until a project replaces it', () => {
  const three = plan([s('a', 'x'), s('b', 'y'), s('c', 'z')]); assert.equal(three.parks.length, 1);
  assert.equal(plan([s('a', 'x'), s('b', 'y'), s('c', 'z'), s('d', 'w')]).parks.length, 0);
});
test('missing data still draws: no towers entry, no towers at all, an ended session', () => {
  const l1 = layoutOffice([s('a', 'x')], null, 1), ended = layoutOffice([], l1, 2);
  for (const towers of [undefined, {}, { other: { storeys: 9 } }]) { const b = cityPlan(l1, towers).buildings[0]; assert.equal(b.storeys, 4); assert.deepEqual(b.look, tower('a')); }
  assert.ok(cityPlan(ended).buildings[0].vacantSince !== undefined);
});
test('a subagent with no entry gets 2 storeys; desk fields carry through', () => {
  const b = plan([s('a', 'x'), s('k', 'x', { parentId: 'a', status: 'working' })]).buildings.find(q => q.id === 'a');
  assert.deepEqual(b.subagents, [{ id: 'k', storeys: 2, leaving: false }]); assert.equal(b.overflow, 0);
});
test('no projects at all is a valid, empty city', () => { const p = cityPlan(layoutOffice([], null, 1)); assert.deepEqual(p.hoods, []); assert.ok(p.bounds.w > 0 && p.bounds.d > 0); });
test('a neighbourhood with no folder asks for one', () => {
  const hood = plan([{ id: 'a', project: 'x', status: 'idle' }]).hoods[0];
  assert.deepEqual(spawnTarget(hood, hood.lots[1]), { cwd: null, slot: null });
  const known = plan([s('a', 'x')]).hoods[0]; assert.deepEqual(spawnTarget(known, known.lots[1]), { cwd: '/p/x', slot: known.lots[1].slot });
});
test('plants sit outside the grid and show the connection', () => {
  const p = plan([s('a', 'x')], {}, null, [{ name: 'Claude Code', connected: false }, { name: 'Codex', connected: true }]);
  const claude = p.plants.find(q => q.provider === 'claude'), codex = p.plants.find(q => q.provider === 'codex');
  assert.equal(claude.x, -PLANT); assert.equal(codex.z, -PLANT); assert.equal(claude.connected, false); assert.equal(codex.connected, true);
});
test('the painted ground is all palette, in every view', () => {
  const p = plan([s('a', 'x'), s('b', 'y')]), g = groundCells(p);
  for (const v of views) { const q = paintGround(g, v); for (let i = 0; i < q.rgba.length; i += 4) if (q.rgba[i + 3]) assert.ok(inPalette(q.rgba[i], q.rgba[i + 1], q.rgba[i + 2])); }
});
