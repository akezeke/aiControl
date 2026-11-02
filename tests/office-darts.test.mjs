import test from 'node:test';
import assert from 'node:assert/strict';
import { score, play, newGame, finishes, RINGS } from '../client/office/darts.js';

test('a dart scores by segment and ring, clockwise from 20 at the top', () => {
  const at = (r, degrees) => score(r * Math.sin(degrees * Math.PI / 180), r * Math.cos(degrees * Math.PI / 180));
  assert.deepEqual(score(0, 0), { points: 50, label: 'Bull' });
  assert.deepEqual(score(0.01, 0), { points: 25, label: '25' });
  assert.deepEqual(at(0.103, 0), { points: 60, label: 'T20' });
  assert.deepEqual(at(0.166, 0), { points: 40, label: 'D20' });
  assert.equal(at(0.05, 90).label, '6');
  assert.equal(at(0.05, 180).label, '3');
  assert.equal(at(0.05, 270).label, '11');
  assert.equal(at(0.05, 8).label, '20'); // either side of 20's middle
  assert.equal(at(0.05, 10).label, '1');
  assert.equal(at(0.05, -10).label, '5');
  assert.deepEqual(at(RINGS.doubleOut + 0.01, 0), { points: 0, label: 'Miss' });
});

test('301: three darts a turn, a bust undoes the turn, exactly 0 wins and the next dart starts again', () => {
  const T20 = { points: 60, label: 'T20' }, D20 = { points: 40, label: 'D20' };
  let g = newGame();
  for (let i = 0; i < 3; i++) g = play(g, T20);
  assert.deepEqual([g.left, g.over, g.darts], [121, true, 3]);
  g = play(g, T20); assert.deepEqual([g.left, g.turn.length, g.over], [61, 1, false]); // a new turn
  g = play(g, T20); assert.deepEqual([g.left, g.bust], [1, false]); // 1 left is fine with any finish
  g = play(g, D20); assert.deepEqual([g.left, g.bust, g.over], [121, true, true]); // bust: back to where the turn began
  g = play(g, T20); g = play(g, T20); g = play(g, { points: 1, label: '1' });
  assert.deepEqual([g.left, g.over, g.won], [0, true, true]);
  assert.equal(g.darts, 9);
  g = play(g, T20); assert.deepEqual([g.left, g.darts, g.won], [241, 1, false]);
});

test('the beds one dart would finish on: singles, doubles and trebles that make it, the 25 and the bull', () => {
  assert.deepEqual(finishes(40), ['D20']);
  assert.deepEqual(finishes(18).sort(), ['18', 'D9', 'T6']);
  assert.deepEqual(finishes(60), ['T20']);
  assert.deepEqual(finishes(50), ['Bull']);
  assert.deepEqual(finishes(25), ['25']);
  assert.deepEqual(finishes(59), []);
  assert.deepEqual(finishes(61), []);
  assert.deepEqual(finishes(0), []);
  // Each one scores just that.
  for (const left of [1, 7, 20, 21, 36, 45, 50, 57]) for (const label of finishes(left)) assert.equal(label === 'Bull' ? 50 : label === '25' ? 25 : Number(label.slice(/^[DT]/.test(label))) * ({ D: 2, T: 3 }[label[0]] || 1), left);
});
