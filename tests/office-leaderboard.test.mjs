import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMES, bests, clean, merge, standings, format, cleanName } from '../client/office/leaderboard.js';
import { MONDAY } from '../client/office/levels.js';

const none = { trickshot: { best: {}, daily: {} }, darts: null, pinball: 0, snake: 0, golf: { best: {}, endlessBest: 0 } };
const holes = (n, strokes) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, strokes]));

test('the games, in board order', () => {
  assert.deepEqual(GAMES.map(g => g.id), ['trickshotToday', 'trickshot', 'darts', 'pinball', 'golf', 'golfEndless', 'snake']);
  assert.deepEqual(GAMES.filter(g => g.lower).map(g => g.id), ['darts', 'golf']);
});

test('bests: golf counts only with every hole', () => {
  assert.equal(bests({ ...none, golf: { best: holes(49, 2), endlessBest: 0 } }, '2026-11-09').golf, undefined);
  assert.deepEqual(bests({ ...none, golf: { best: holes(50, 2), endlessBest: 7 } }, '2026-11-09'), { golf: 100, golfEndless: 7 });
});

test("bests: trickshot today sums today's three, levels sum MONDAY", () => {
  const best = Object.fromEntries(MONDAY.map(({ id }, i) => [id, 100 * (i + 1)]));
  const trickshot = { best: { ...best, retired: 5000 }, daily: { '2026-11-09': [100, null, 50], '2026-11-08': [999, 0, 0] } };
  assert.deepEqual(bests({ ...none, trickshot }, '2026-11-09'), { trickshotToday: { day: '2026-11-09', score: 150 }, trickshot: 2100 });
  assert.deepEqual(bests({ ...none, trickshot }, '2026-11-10'), { trickshot: 2100 });
});

test('bests: nothing played gives {}', () => {
  assert.deepEqual(bests(none, '2026-11-09'), {});
  assert.deepEqual(bests({ ...none, darts: 11, pinball: 48210, snake: 7 }, '2026-11-09'), { darts: 11, pinball: 48210, snake: 7 });
});

test('clean: drops unknown, out of range and non-numbers', () => {
  assert.deepEqual(clean({ darts: 0, pinball: -1, snake: 1e9, golfEndless: '5', chess: 3, trickshot: 500, golf: NaN }, '2026-11-09'), { trickshot: 500 });
  assert.deepEqual(clean(null, '2026-11-09'), {});
  assert.deepEqual(clean([1, 2], '2026-11-09'), {});
});

test('clean: trickshot today from today or yesterday only', () => {
  const at = day => clean({ trickshotToday: { day, score: 10 } }, '2026-11-09');
  assert.deepEqual(at('2026-11-09'), { trickshotToday: { day: '2026-11-09', score: 10 } });
  assert.deepEqual(at('2026-11-08'), { trickshotToday: { day: '2026-11-08', score: 10 } });
  assert.deepEqual(at('2026-11-07'), {});
  assert.deepEqual(at('2026-11-10'), {});
  assert.deepEqual(clean({ trickshotToday: { day: '2026-11-09', score: -1 } }, '2026-11-09'), {});
  assert.deepEqual(clean({ trickshotToday: 5 }, '2026-11-09'), {});
});

test('merge: lower and higher per game', () => {
  assert.deepEqual(merge({ darts: 11, pinball: 500 }, { darts: 12, pinball: 900 }), { darts: 11, pinball: 900 });
  assert.deepEqual(merge({ darts: 11 }, { darts: 9, snake: 4 }), { darts: 9, snake: 4 });
  assert.deepEqual(merge({}, {}), {});
});

test('merge: trickshot today, newer day replaces, older ignored', () => {
  const t = (day, score) => ({ trickshotToday: { day, score } });
  assert.deepEqual(merge(t('2026-11-08', 900), t('2026-11-09', 10)), t('2026-11-09', 10));
  assert.deepEqual(merge(t('2026-11-09', 10), t('2026-11-08', 900)), t('2026-11-09', 10));
  assert.deepEqual(merge(t('2026-11-09', 10), t('2026-11-09', 30)), t('2026-11-09', 30));
  assert.deepEqual(merge(t('2026-11-09', 30), t('2026-11-09', 10)), t('2026-11-09', 30));
});

test('standings: top three by direction, today only', () => {
  const players = [
    { name: 'Anna', scores: { darts: 12, pinball: 100, trickshotToday: { day: '2026-11-08', score: 999 } } },
    { name: 'Bo', scores: { darts: 9, pinball: 300, trickshotToday: { day: '2026-11-09', score: 20 } } },
    { name: 'Cy', scores: { darts: 15, pinball: 200 } },
    { name: 'Di', scores: { darts: 10, pinball: 50 } },
  ];
  const rows = standings({ day: '2026-11-09', players });
  assert.deepEqual(rows.map(r => r.id), ['trickshotToday', 'darts', 'pinball']);
  assert.deepEqual(rows[0].top, [{ name: 'Bo', value: 20 }]);
  assert.deepEqual(rows[1].top, [{ name: 'Bo', value: 9 }, { name: 'Di', value: 10 }, { name: 'Anna', value: 12 }]);
  assert.deepEqual(rows[2].top.map(t => t.name), ['Bo', 'Cy', 'Anna']);
  assert.equal(rows[1].label, 'Darts');
  assert.deepEqual(standings({ day: '2026-11-09', players: [] }), []);
});

test('format: units where a number alone would be unclear', () => {
  assert.equal(format('darts', 9), '9 darts');
  assert.equal(format('golf', 112), '112 strokes');
  assert.equal(format('golfEndless', 7), '7 holes');
  assert.equal(format('pinball', 48210), '48,210');
});

test('cleanName', () => {
  assert.equal(cleanName(' Anna '), 'Anna');
  assert.equal(cleanName('Åsa-Li'), 'Åsa-Li');
  assert.equal(cleanName("O'Neil 2"), "O'Neil 2");
  for (const bad of ['', '   ', '<b>', 'x'.repeat(17), '-dash', 42, null, 'tab\there']) assert.equal(cleanName(bad), null, String(bad));
});
