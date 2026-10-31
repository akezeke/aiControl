import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, MONDAY, PAIRS } from '../client/office/levels.js';
import { dayKey, challenges, randomShot, copyLine, goalOf } from '../client/office/daily.js';
import { loadProgress, saveProgress, recordLevel, recordDaily } from '../client/office/progress.js';

const store = (init) => { const m = new Map(init ? [['aiControl.trickshot', init]] : []); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
// Pinned as generated, so a change to the generator shows up.
const PIN = {
  '2026-10-30': [{ item: 'plate', start: 'doors', target: 'bucket' }, { item: 'teabag', start: 'stove', target: 'bin' }, { item: 'roll', start: 'farTable', target: 'tableMug' }],
  '2027-01-01': [{ item: 'plate', start: 'fridge', target: 'shelf' }, { item: 'paper', start: 'doors', target: 'bin' }, { item: 'rubber', start: 'island', target: 'bucket' }],
  '2028-02-29': [{ item: 'plate', start: 'fridge', target: 'shelf' }, { item: 'teabag', start: 'farTable', target: 'tableMug' }, { item: 'mug', start: 'stove', target: 'bucket' }],
};
const miss = { made: false, score: 0, surfaces: [] };

test('the copy line', () => {
  assert.equal(copyLine('2026-10-30', [12400, 8150, 0]), 'Trickshot 30 Oct: 12,400 / 8,150 / miss');
  assert.equal(copyLine('2026-10-30', [12400, null, 0]), 'Trickshot 30 Oct: 12,400 / - / miss');
});

test('the same date gives the same three challenges', () => {
  for (const k of ['2026-10-30', '2027-01-01', '2028-02-29']) { assert.equal(challenges(k).length, 3); assert.deepEqual(challenges(k), challenges(k)); }
  assert.deepEqual(challenges('2026-10-30'), PIN['2026-10-30']);
  assert.deepEqual(challenges('2027-01-01'), PIN['2027-01-01']);
  assert.deepEqual(challenges('2028-02-29'), PIN['2028-02-29']);
});

test('a day never repeats a target, and every shot is a real pair', () => {
  let d = Date.UTC(2026, 0, 1), repeatedItems = 0;
  for (let i = 0; i < 400; i++, d += 86400000) {
    const cs = challenges(dayKey(new Date(d)));
    assert.equal(new Set(cs.map(c => c.target)).size, 3);
    repeatedItems += 3 - new Set(cs.map(c => c.item)).size;
    for (const c of cs) assert.ok(PAIRS[c.item].some(([s, t]) => s === c.start && t === c.target));
  }
  assert.equal(repeatedItems, 0);
});

test('random shots follow their seed', () => {
  assert.deepEqual(randomShot(42), randomShot(42));
  for (let i = 0; i < 200; i++) { const r = randomShot(i); assert.ok(ITEMS[r.item]); assert.ok(PAIRS[r.item].some(([s, t]) => s === r.start && t === r.target)); }
});

test('the day turns over at UTC midnight', () => {
  assert.equal(dayKey(new Date('2026-10-30T23:59:59Z')), '2026-10-30');
  assert.equal(dayKey(new Date('2026-10-31T00:00:00Z')), '2026-10-31');
});

test('no use of Math.random in daily challenges', () => {
  const r = Math.random; Math.random = () => { throw new Error('random'); };
  try { challenges('2026-10-30'); randomShot(3); } finally { Math.random = r; }
});

test('a daily started before midnight scores under the day it started; the best stays', () => {
  const p = loadProgress(store());
  recordDaily(p, '2026-10-30', 1, { score: 800 });
  recordDaily(p, '2026-10-30', 1, { score: 300 });
  recordDaily(p, '2026-10-30', 0, miss);
  assert.deepEqual(p.daily, { '2026-10-30': [0, 800, null] });
});

test('a daily shot never counts toward the clipboard', () => {
  const p = loadProgress(store());
  recordDaily(p, '2026-10-30', 0, { made: true, score: 5000, surfaces: ['ceiling'] });
  assert.deepEqual(p.lines, {}); assert.deepEqual(p.best, {});
});

test('old daily bests are dropped after 30 days, and clipboard progress is kept', () => {
  const p = loadProgress(store());
  recordLevel(p, 'paper', { made: true, score: 2000, surfaces: ['ceiling'] });
  recordDaily(p, '2026-09-30', 0, { score: 1 });
  recordDaily(p, '2026-10-01', 0, { score: 2 });
  recordDaily(p, '2026-10-31', 0, { score: 3 });
  assert.deepEqual(Object.keys(p.daily), ['2026-10-01', '2026-10-31']);
  assert.deepEqual(p.lines.paper, { away: true, trick: true, score: true });
});

test('clipboard lines never untick, and best keeps the highest', () => {
  const p = loadProgress(store());
  recordLevel(p, 'paper', { made: true, score: 2000, surfaces: ['ceiling'] });
  recordLevel(p, 'paper', { made: true, score: 100, surfaces: [] });
  recordLevel(p, 'paper', miss);
  assert.deepEqual(p.lines.paper, { away: true, trick: true, score: true });
  assert.equal(p.best.paper, 2000);
  recordLevel(p, 'rubber', { made: true, score: 10, surfaces: [] });
  assert.deepEqual(p.lines.rubber, { away: true, trick: false, score: false });
});

test('progress round-trips', () => {
  const s = store(), p = loadProgress(s);
  recordLevel(p, 'mug', { made: true, score: 700, surfaces: ['fridge'] }); recordDaily(p, '2026-10-30', 2, { score: 90 });
  saveProgress(p, s);
  assert.deepEqual(loadProgress(s), p);
});

test('corrupt or old saves start fresh', () => {
  const fresh = { lines: {}, best: {}, daily: {} };
  for (const bad of ['{', 'null', '[]', '{"lines":3}', '{"lines":{"a":3},"best":{},"daily":{}}', '{"lines":{},"best":{"a":"x"},"daily":{}}',
    '{"lines":{},"best":{},"daily":{"2026-10-30":[1]}}', '{"lines":{},"best":{},"daily":{"k":"abc"}}', '{"lines":{"a":{"away":1}},"best":{},"daily":{}}']) assert.deepEqual(loadProgress(store(bad)), fresh, bad);
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.deepEqual(loadProgress(broken), fresh);
  assert.doesNotThrow(() => saveProgress(fresh, broken));
  assert.deepEqual(loadProgress(), fresh); // Node has no localStorage
  assert.doesNotThrow(() => saveProgress(fresh));
});


test('a bad score, slot or day cannot wipe the save', () => {
  const s = store(), p = loadProgress(s);
  recordLevel(p, 'paper', { made: true, score: 2000, surfaces: ['ceiling'] });
  recordLevel(p, 'rubber', {}); recordLevel(p, 'mug', { made: true, score: NaN, surfaces: [] }); recordLevel(p, 'roll', { score: -5 });
  assert.deepEqual(p.best, { paper: 2000, rubber: 0, mug: 0, roll: 0 });
  recordDaily(p, '2026-10-30', 3, { score: 5 }); recordDaily(p, '2026-10-30', -1, { score: 5 }); recordDaily(p, '2026-10-30', 1.5, { score: 5 });
  assert.deepEqual(p.daily, {});
  recordDaily(p, '2026-10-30', 0, {}); recordDaily(p, '2026-10-30', 1, { score: NaN });
  assert.deepEqual(p.daily['2026-10-30'], [0, 0, null]);
  for (const k of ['', 'x', '2026-13-01', '2026-02-30', '2026-10-30T00', undefined]) recordDaily(p, k, 0, { score: 5 });
  assert.deepEqual(Object.keys(p.daily), ['2026-10-30']);
  saveProgress(p, s);
  assert.deepEqual(loadProgress(s), p);
  assert.equal(loadProgress(store('{"lines":{},"best":{},"daily":{"nope":[null,null,null]}}')).daily.nope, undefined);
});

test('big scores group after rounding', () => assert.equal(copyLine('2026-10-30', [12400.5, 999.6, 0]), 'Trickshot 30 Oct: 12,401 / 1,000 / miss'));

test('a shot\'s goal: the item, where it goes and what else the level asks, ticked lines marked', () => {
  const none = { lines: {}, best: {}, daily: {} }, rubber = MONDAY.find(e => e.id === 'rubber'), text = goal => goal.map(g => g.text).join(' · ');
  assert.equal(text(goalOf(rubber, none)), 'Rubber ball → bucket · off the banner · 300');
  assert.deepEqual(goalOf(rubber, { ...none, lines: { rubber: { away: true, trick: false, score: true } } }).map(g => g.done), [true, false, true]);
  assert.equal(text(goalOf(MONDAY.find(e => e.id === 'mug'), none)), 'Mug → shelf · off the fridge · 500');
  for (const e of MONDAY) { const parts = goalOf(e, none); assert.equal(parts.length, 3); assert.ok(parts.every(p => p.text && !p.done && !p.text.includes(','.repeat(2))), e.id); assert.ok(e.trick.name.endsWith(parts[1].text)); }
  const random = { item: 'teabag', start: 'stove', target: 'tableMug' };
  assert.deepEqual(goalOf(random, none), [{ text: 'Tea bag → mug', done: false }], 'a random shot has only where it goes');
  const daily = { ...random, day: '2026-10-31', index: 1 };
  assert.equal(text(goalOf(daily, none)), 'Tea bag → mug');
  assert.equal(text(goalOf(daily, { ...none, daily: { '2026-10-31': [null, 0, null] } })), 'Tea bag → mug', 'no best yet');
  assert.equal(text(goalOf(daily, { ...none, daily: { '2026-10-31': [null, 1250, null] } })), 'Tea bag → mug · best 1,250');
});
