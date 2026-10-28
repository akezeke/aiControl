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
