import test from 'node:test';
import assert from 'node:assert/strict';
import { attractPages } from '../client/office/pinball.js';
import { leaderLine } from '../client/office/online.js';
import { createGolf } from '../client/office/golf.js'; // no other test loads golf.js: at least it parses
import { createDarts } from '../client/office/darts.js';

test('attractPages adds a page per leader, after the high score', () => {
  assert.equal(attractPages(100, 0, false, []).length, 3);
  const pages = attractPages(100, 50, true, [{ name: 'Anna', value: 48210 }, { name: 'Bartholomew-Ann', value: 900 }]);
  assert.equal(pages.length, 5);
  assert.deepEqual(pages[0], { top: 'TUTTI FRUTTI', big: 'FLIP TO PLAY' });
  assert.deepEqual(pages[1], { top: 'HIGH SCORE', big: '100' });
  assert.deepEqual(pages[2], { top: '1 ANNA', big: '48,210' });
  assert.deepEqual(pages[3], { top: '2 BARTHOLOME', big: '900' });
  assert.deepEqual(pages[4], { top: 'LAST GAME', big: '50' });
});

test("leaderLine appends the leader unless it's you", () => {
  const goal = [{ text: '🍎 3' }, { text: 'Best 7' }];
  assert.deepEqual(leaderLine(goal, { name: 'Anna', text: '23', you: false }), [...goal, { text: 'Top Anna 23' }]);
  assert.equal(leaderLine(goal, { name: 'Me', text: '30', you: true }), goal);
  assert.equal(leaderLine(goal, undefined), goal);
});

test('the games with leaders take online', () => {
  assert.equal(typeof createGolf, 'function');
  assert.equal(typeof createDarts, 'function');
});

// A 2D context that keeps what's written on it.
const pen = () => {
  const written = [], g = new Proxy({}, { get: (t, k) => k === 'fillText' ? text => written.push(String(text)) : k === 'measureText' ? text => ({ width: String(text).length * 12 }) : k in t ? t[k] : () => {}, set: (t, k, v) => { t[k] = v; return true; } });
  return { g, written };
};

test('the chalkboard writes the darts leader under your best', async () => {
  const { drawScore, newGame } = await import('../client/office/darts.js');
  const { g, written } = pen();
  drawScore(g, 512, 384, newGame(), 11, false, { name: 'Anna', value: 9, you: false });
  assert.ok(written.includes('top Anna 9'), written.join('|'));
  const none = pen(); drawScore(none.g, 512, 384, newGame(), 11, false, undefined);
  assert.ok(!none.written.some(t => t.startsWith('top ')));
});

test('the golf board writes the course and endless leaders', async () => {
  const { drawBoard } = await import('../client/office/golf.js');
  const { g, written } = pen();
  const s = { mode: 'holes', n: 1, index: 0, over: 0, par: 2, strokes: 0, best: {}, reached: 1, endlessBest: 0, hint: '', leaders: { course: { name: 'Anna', text: '140 strokes' }, endless: { name: 'Bo', text: '12 holes' } } };
  drawBoard(g, 1024, 720, s);
  assert.ok(written.includes('Course Anna 140 strokes · Endless Bo 12 holes'), written.join('|'));
  const only = pen(); drawBoard(only.g, 1024, 720, { ...s, leaders: { endless: { name: 'Bo', text: '12 holes' } } });
  assert.ok(only.written.includes('Endless Bo 12 holes'));
});
