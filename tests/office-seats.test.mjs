import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OfficeSeats, IDLE_MS, RESERVE_MS } from '../server/seats.mjs';
import { sharedLayout } from '../client/office/layout.js';

const s = (id, project, extra = {}) => ({ id, project, cwd: `/p/${project}`, status: 'idle', ...extra });
const file = () => join(mkdtempSync(join(tmpdir(), 'seats-')), 'office-seats.json');
const slots = office => Object.fromEntries(office.desks.map(desk => [desk.sessionId, desk.slot]));
const spots = office => office.desks.map(desk => [desk.sessionId, desk.x, desk.z]).sort();
const T = 1_000_000;

test('seats go by who came first, which a page opened later can read off the server', () => {
  const seats = new OfficeSeats();
  seats.update([s('z', 'x')], T);
  assert.deepEqual(slots(seats.update([s('a', 'x'), s('z', 'x')], T + 3000)), { z: 0, a: 1 }, 'by id, a would have the first seat');
});
test('what the server sends comes back as the layout a page draws', () => {
  const sent = new OfficeSeats().update([s('a', 'x'), s('b', 'y')], T), layout = sharedLayout(JSON.parse(JSON.stringify(sent)));
  assert.equal(layout.desks.get('b').podKey, '/p/y');
  assert.deepEqual([...layout.desks.keys()].sort(), ['a', 'b']);
  assert.deepEqual(layout.room, sent.room);
  assert.deepEqual(layout.pods.map(pod => pod.key), ['/p/x', '/p/y']);
});
test('a restart keeps the seats, and the cells of the pods', () => {
  const path = file(), before = new OfficeSeats(path);
  for (const [i, project] of ['zeta', 'beta', 'alpha'].entries()) before.update(['zeta', 'beta', 'alpha'].slice(0, i + 1).map(p => s(p, p)), T + i);
  const sessions = ['zeta', 'beta', 'alpha'].map(p => s(p, p));
  assert.deepEqual(spots(new OfficeSeats(path).update(sessions, T + 9000)), spots(before.update(sessions, T + 9000)));
});
test('a restart that lists nobody for a moment loses no one', () => {
  const path = file(), before = new OfficeSeats(path);
  before.update([s('z', 'x')], T);
  const expected = spots(before.update([s('a', 'x'), s('z', 'x')], T + 1)), after = new OfficeSeats(path), empty = after.update([], T + 2);
  assert.ok(empty.desks.every(desk => desk.vacantSince === T + 2), 'they get the usual time to walk out');
  assert.equal(after.update([], T + 3).pods[0].name, 'x', 'the sign keeps its name meanwhile');
  assert.deepEqual(spots(after.update([s('a', 'x'), s('z', 'x')], T + 4)), expected);
});
test('a project that goes leaves its floor while anyone is watching, and it closes up once nobody has been', () => {
  // Two columns: a and c down the first, b and d down the second.
  const seats = new OfficeSeats(), everyone = ['a', 'b', 'c', 'd'].map(p => s(p, p)), rest = everyone.filter(session => 'bd'.includes(session.id));
  const first = seats.update(everyone, T), kept = office => spots(office).filter(([id]) => 'bd'.includes(id));
  seats.update(rest, T + 1000);
  const left = seats.update(rest, T + 1000 + 60_000);
  assert.deepEqual(kept(left), kept(first), 'nobody has moved yet');
  assert.deepEqual(left.room, first.room);
  const closed = seats.update(rest, T + 1000 + 60_000 + IDLE_MS);
  assert.deepEqual(closed.pods.map(pod => [pod.key, pod.col, pod.row]), [['/p/b', 0, 0], ['/p/d', 0, 1]]);
});
test('the room shrinks to what closing up leaves', () => {
  const seats = new OfficeSeats(), first = seats.update(['a', 'b', 'c', 'd', 'e'].map(p => s(p, p)), T);
  assert.ok(seats.update([s('e', 'e')], T + IDLE_MS).room.width < first.room.width);
});
test('gone by the time anyone looks again, they are not shown walking out', () => {
  const seats = new OfficeSeats();
  seats.update([s('a', 'x'), s('b', 'x')], T);
  assert.deepEqual(Object.keys(slots(seats.update([s('b', 'x')], T + IDLE_MS + 1))), ['b']);
});
test('a damaged seats file starts over', () => {
  const path = file(); writeFileSync(path, '{nope');
  assert.deepEqual(slots(new OfficeSeats(path).update([s('a', 'x')], T)), { a: 0 });
});
test('a reservation is honoured once', () => {
  const seats = new OfficeSeats(); seats.update([s('a', 'p')], 1); seats.reserve('/p/p', 3, 2);
  assert.equal(slots(seats.update([s('a', 'p'), s('b', 'p')], 3)).b, 3);
  assert.equal(slots(seats.update([s('a', 'p'), s('b', 'p'), s('c', 'p')], 4)).c, 1);
});
test('a reservation for a taken slot moves nobody, and the newcomer gets the lowest free', () => {
  const seats = new OfficeSeats(); seats.update([s('a', 'p')], 1); seats.reserve('/p/p', 0, 2);
  assert.deepEqual(slots(seats.update([s('a', 'p'), s('b', 'p')], 3)), { a: 0, b: 1 });
});
test('what the server sends carries no reservations', () => { const seats = new OfficeSeats(); seats.reserve('/p/p', 3, 0); assert.ok(!JSON.stringify(seats.update([s('b', 'p')], 1)).includes('reserv')); });
test('a reservation expires after 2 minutes', () => {
  const seats = new OfficeSeats(); seats.reserve('/p/p', 3, 0);
  assert.equal(slots(seats.update([s('b', 'p')], RESERVE_MS)).b, 0);
});
test('junk slots are ignored', () => {
  const seats = new OfficeSeats();
  for (const junk of [-1, 1.5, '2', null, undefined, 64, 1e9, NaN]) seats.reserve('/p/p', junk, 0);
  assert.equal(slots(seats.update([s('b', 'p')], 1)).b, 0);
});
test('a released reservation leaves the next newcomer alone', () => {
  const seats = new OfficeSeats(); seats.reserve('/p/p', 3, 0); seats.release('/p/p', 3);
  assert.equal(slots(seats.update([s('b', 'p')], 1)).b, 0);
});
test('a reservation in one folder does nothing for another', () => {
  const seats = new OfficeSeats(); seats.reserve('/p/q', 3, 0);
  assert.equal(slots(seats.update([s('b', 'p')], 1)).b, 0);
});
