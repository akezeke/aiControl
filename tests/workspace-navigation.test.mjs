import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewQueue, matchCommands } from '../client/workspace-navigation.js';

const sessions = [
  { id: 'a', title: 'First', status: 'permission', statusSince: 300, requests: [{ createdAt: 200 }] },
  { id: 'b', title: 'Second', status: 'question', statusSince: 200, requests: [{ createdAt: 100 }] },
  { id: 'c', title: 'Third', status: 'permission', statusSince: 100, requests: [] },
  { id: 'd', title: 'Working', status: 'working', statusSince: 400 },
];
test('review queue advances in overview order instead of bouncing between the first two sessions', () => {
  const result = reviewQueue(sessions, 'b', 1000);
  assert.equal(result.position, 2);
  assert.equal(result.total, 3);
  assert.equal(result.next.id, 'c');
  assert.equal(result.waitMs, 900);
  assert.equal(reviewQueue(sessions, 'c').next.id, 'a');
  assert.deepEqual(sessions.map(s => s.id), ['a', 'b', 'c', 'd']);
});
test('review queue drops resolved requests and handles a removed/current-only/empty session', () => {
  assert.equal(reviewQueue(sessions.filter(s => s.id !== 'b'), 'b').next.id, 'a');
  assert.equal(reviewQueue([{ ...sessions[0], status: 'idle' }, sessions[1]], 'a').next.id, 'b');
  assert.equal(reviewQueue([sessions[0]], 'a').next, null);
  assert.deepEqual(reviewQueue([], null), { total: 0, position: 0, next: null, waitMs: null });
  assert.equal(reviewQueue([{ ...sessions[0], requests: [{ createdAt: 5000 }] }], 'a', 1000).waitMs, 0);
});
test('command search matches all query words across title and metadata without mutating results', () => {
  const commands = [
    { id: '1', label: 'Fix Café', detail: 'Weather · Codex', keywords: 'permission' },
    { id: '2', label: 'Weather station', detail: 'Claude' },
    { id: '3', label: 'Switch theme', detail: 'MU/TH/UR', keywords: 'alien' },
  ];
  assert.deepEqual(matchCommands(commands, 'cafe codex').map(c => c.id), ['1']);
  assert.deepEqual(matchCommands(commands, 'weather').map(c => c.id), ['2', '1']);
  assert.deepEqual(matchCommands(commands, 'alien').map(c => c.id), ['3']);
  assert.deepEqual(matchCommands(commands, '   '), commands);
  assert.deepEqual(matchCommands(commands, 'absent'), []);
  assert.deepEqual(commands.map(c => c.id), ['1', '2', '3']);
});
