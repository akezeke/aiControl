import test from 'node:test';
import assert from 'node:assert/strict';
import { statusEvents } from '../client/alerts.js';

test('alerts fire when a session starts waiting or finishes, never on first sight', () => {
  const previous = new Map(), s = (id, status, extra) => ({ id, status, ...extra });
  assert.deepEqual(statusEvents(previous, [s('a', 'working'), s('b', 'question'), s('c', 'working', { parentId: 'a' })]), []);
  const events = statusEvents(previous, [s('a', 'idle'), s('b', 'permission'), s('c', 'idle', { parentId: 'a' }), s('d', 'question')]);
  assert.deepEqual(events.map(e => [e.kind, e.session.id]), [['ready', 'a']]);
  assert.deepEqual(statusEvents(previous, [s('a', 'question')]).map(e => e.kind), ['input']);
});
