import test from 'node:test';
import assert from 'node:assert/strict';
import { meetingLines } from '../client/office/boards.js';

const board = names => ({ day: '2026-11-09', players: names.map((name, i) => ({ name, scores: {}, seen: i })) });

test('not in a meeting, the page says where to join one', () => {
  assert.deepEqual(meetingLines(null), { title: 'Meetings', lines: ['Join one here'], closed: null });
  assert.deepEqual(meetingLines({ joined: false }), { title: 'Meetings', lines: ['Join one here'], closed: null });
});

test('in a meeting: where it is, you first, then whoever was in last', () => {
  const page = meetingLines({ joined: true, name: 'Bo', host: 'pc.tail1.ts.net', board: board(['Anna', 'bo', 'Cy']) });
  assert.deepEqual(page, { title: 'Meeting at pc', lines: ['bo', 'Cy', 'Anna'], closed: null });
  assert.equal(meetingLines({ joined: true, name: 'Bo', host: '127.0.0.1', board: board(['Bo']) }).title, 'Meeting at 127.0.0.1');
});

test("a meeting that can't be reached or has a new code keeps the names and says so", () => {
  assert.deepEqual(meetingLines({ joined: true, name: 'Bo', host: 'pc', board: board(['Bo', 'Anna']), offline: true }), { title: 'Meeting at pc', lines: ['Bo', 'Anna'], closed: 'Off for now' });
  assert.equal(meetingLines({ joined: true, name: 'Bo', host: 'pc', board: null, error: 'code' }).closed, 'New code');
  assert.deepEqual(meetingLines({ joined: true, name: 'Bo', host: 'pc', board: null }).lines, ['Bo']);
});

test('at most six names, big enough to read', () => {
  assert.equal(meetingLines({ joined: true, name: 'P0', host: 'pc', board: board(Array.from({ length: 12 }, (_, i) => `P${i}`)) }).lines.length, 6);
});
