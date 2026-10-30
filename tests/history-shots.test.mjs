import test from 'node:test';
import assert from 'node:assert/strict';
import { placeShots } from '../client/history-shots.js';

const message = (id, timestamp) => ({ id, timestamp });
const shot = (id, at, tool = true) => ({ id, at, tool });

test('screenshots sit where they were taken, a run shares a strip per side, and older ones wait for older messages', () => {
  const run = [message('t1', 30), message('t2', 31), message('t3', 32)];
  const items = [message('a', 10), run, message('b', 50)];
  const placed = placeShots(items, [shot('early', 5), shot('s1', 35), shot('s2', 36), shot('pasted', 37, false), shot('late', 60), shot('undated', null)]);
  assert.deepEqual(placed.map(item => item.shots ? item.shots.map(image => image.id) : Array.isArray(item) ? 'run' : item.id),
    ['a', 'run', ['s1', 's2'], ['pasted'], 'b', ['late', 'undated']]);
  assert.equal(placed[3].user, true);
  assert.deepEqual(placeShots([], [shot('only', 5)]).map(item => item.shots.length), [1]);
});
