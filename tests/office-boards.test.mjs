import test from 'node:test';
import assert from 'node:assert/strict';
import { usedUp } from '../client/office/boards.js';

test('the coffee machine runs empty while a usage window is used up, saying when each agent is back', () => {
  const now = new Date(2026, 9, 29, 12, 0).getTime(), at = minutes => now + minutes * 60_000;
  const usage = [
    { provider: 'claude', windows: [{ label: '5-hour', usedPercent: 100, resetsAt: at(150) }, { label: 'Weekly', usedPercent: 60, resetsAt: at(3000) }] },
    { provider: 'codex', windows: [{ label: '5-hour', usedPercent: 99, resetsAt: at(30) }] },
  ];
  assert.deepEqual(usedUp(usage, now), [{ provider: 'claude', back: 'back 14:30' }]);
  usage[1].windows.push({ label: 'Weekly', usedPercent: 100, resetsAt: at(2 * 1440) });
  assert.deepEqual(usedUp(usage, now)[1], { provider: 'codex', back: 'back in 2d' });
  assert.deepEqual(usedUp([{ provider: 'claude', windows: [{ label: '5-hour', usedPercent: 100, resetsAt: at(-1) }] }], now), [], 'a window past its reset is waiting on a refresh, not empty');
  assert.deepEqual(usedUp(undefined, now), []);
});
