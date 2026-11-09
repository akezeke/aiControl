import test from 'node:test';
import assert from 'node:assert/strict';
import { visitorLines } from '../client/office/boards.js';

const board = names => ({ day: '2026-11-09', players: names.map((name, i) => ({ name, scores: {}, seen: i })) });

test('not signed in, the page asks you to', () => {
  assert.deepEqual(visitorLines(null), { title: 'Visitors', lines: ['Sign in here'], closed: null });
  assert.deepEqual(visitorLines({ joined: false }), { title: 'Visitors', lines: ['Sign in here'], closed: null });
});

test('signed in: you first, then whoever was in last, under the hub', () => {
  const page = visitorLines({ joined: true, name: 'Bo', host: 'pc.tail1.ts.net', board: board(['Anna', 'bo', 'Cy']) });
  assert.deepEqual(page, { title: 'Visitors · pc', lines: ['bo', 'Cy', 'Anna'], closed: null });
  assert.equal(visitorLines({ joined: true, name: 'Bo', host: '127.0.0.1', board: board(['Bo']) }).title, 'Visitors · 127.0.0.1');
});

test('a closed hub or a replaced code keeps the names and says so', () => {
  assert.deepEqual(visitorLines({ joined: true, name: 'Bo', host: 'pc', board: board(['Bo', 'Anna']), offline: true }), { title: 'Visitors · pc', lines: ['Bo', 'Anna'], closed: 'Hub closed' });
  assert.equal(visitorLines({ joined: true, name: 'Bo', host: 'pc', board: null, error: 'code' }).closed, 'Code replaced');
  assert.deepEqual(visitorLines({ joined: true, name: 'Bo', host: 'pc', board: null }).lines, ['Bo']);
});

test('at most six names, big enough to read', () => {
  assert.equal(visitorLines({ joined: true, name: 'P0', host: 'pc', board: board(Array.from({ length: 12 }, (_, i) => `P${i}`)) }).lines.length, 6);
});
