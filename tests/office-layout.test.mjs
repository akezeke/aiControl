import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutOffice, MAX_SUBAGENTS } from '../client/office/layout.js';

const s = (id, project, extra = {}) => ({ id, project, cwd: `/p/${project}`, status: 'idle', ...extra });

test('one pod per project, sorted by name', () => {
  const l = layoutOffice([s('a', 'zeta'), s('b', 'alpha'), s('c', 'alpha')]);
  assert.deepEqual(l.pods.map(p => p.name), ['alpha', 'zeta']);
  assert.equal(l.pods[0].deskIds.length, 2);
});
test('keeps seats when a session joins', () => {
  const first = layoutOffice([s('b', 'x'), s('c', 'x')]);
  const next = layoutOffice([s('a', 'x'), s('b', 'x'), s('c', 'x')], first);
  for (const id of ['b', 'c']) assert.deepEqual([next.desks.get(id).x, next.desks.get(id).z], [first.desks.get(id).x, first.desks.get(id).z]);
});
test('missing project goes to Unknown', () => {
  const l = layoutOffice([{ id: 'a', status: 'idle' }]);
  assert.equal(l.pods[0].name, 'Unknown');
});
test('subagents sit on the parent desk with overflow', () => {
  const kids = Array.from({ length: MAX_SUBAGENTS + 2 }, (_, i) => s(`k${i}`, 'x', { parentId: 'p' }));
  const desk = layoutOffice([s('p', 'x'), ...kids]).desks.get('p');
  assert.equal(desk.subagents.length, MAX_SUBAGENTS);
  assert.equal(desk.overflow, 2);
  assert.equal(layoutOffice([s('p', 'x'), ...kids]).desks.size, 1);
});
test('orphan subagents are dropped', () => {
  assert.equal(layoutOffice([s('k', 'x', { parentId: 'gone' })]).desks.size, 0);
});
test('room grows with pods and desks never overlap', () => {
  const many = Array.from({ length: 30 }, (_, i) => s(`s${i}`, `p${i % 7}`));
  const l = layoutOffice(many), small = layoutOffice(many.slice(0, 2));
  assert.ok(l.room.width * l.room.depth > small.room.width * small.room.depth);
  const spots = [...l.desks.values()].map(d => `${d.x.toFixed(2)},${d.z.toFixed(2)}`);
  assert.equal(new Set(spots).size, spots.length);
});
test('departed desks stay 30 s, then free up', () => {
  const first = layoutOffice([s('a', 'x'), s('b', 'x')], undefined, 0);
  const gone = layoutOffice([s('b', 'x')], first, 1000);
  assert.ok(gone.desks.get('a').vacantSince === 1000);
  assert.equal(layoutOffice([s('b', 'x')], gone, 31_001).desks.has('a'), false);
});
test('a new project never moves pods already placed', () => {
  const spot = (l, id) => [l.desks.get(id).x, l.desks.get(id).z];
  const first = layoutOffice([s('b1', 'beta')], undefined, 0);
  const next = layoutOffice([s('a1', 'alpha'), s('b1', 'beta')], first, 1);
  assert.deepEqual(spot(next, 'b1'), spot(first, 'b1'));
  const four = layoutOffice(['p0', 'p1', 'p2', 'p3'].map(p => s(`${p}x`, p)), next, 2);
  const five = layoutOffice(['p0', 'p1', 'p2', 'p3', 'p4'].map(p => s(`${p}x`, p)), four, 3);
  for (const p of ['p0', 'p1', 'p2', 'p3']) assert.deepEqual(spot(five, `${p}x`), spot(four, `${p}x`));
});
test('a pod gaining desks does not push its neighbours', () => {
  const first = layoutOffice([s('a1', 'a'), s('b1', 'b')], undefined, 0);
  const grown = layoutOffice([s('a1', 'a'), s('a2', 'a'), s('a3', 'a'), s('a4', 'a'), s('b1', 'b')], first, 1);
  assert.equal(grown.desks.get('b1').x, first.desks.get('b1').x);
});
test('the room never shrinks under you', () => {
  const big = layoutOffice(['p0', 'p1', 'p2'].map(p => s(`${p}x`, p)), undefined, 0);
  const small = layoutOffice([s('p0x', 'p0')], layoutOffice([s('p0x', 'p0')], big, 1), 100_000);
  assert.ok(small.room.width >= big.room.width && small.room.depth >= big.room.depth);
});
