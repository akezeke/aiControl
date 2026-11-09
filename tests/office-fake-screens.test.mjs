import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeMonitor, COMMANDS, PROGRESS, RESULTS, BANNERS } from '../client/office/meeting.js';

const working = (seed, t) => fakeMonitor(seed, 'green', t);
const fromLists = ({ kind, text }) => kind === 'user' ? COMMANDS.includes(text) : kind === 'tool' ? PROGRESS.some(p => text.startsWith(p)) : kind === 'assistant' ? RESULTS.includes(text) : false;

test('working screens are deterministic per desk and second, and desks differ', () => {
  assert.deepEqual(working('d1', 5.2), working('d1', 5.9));
  assert.notDeepEqual(working('d1', 5), working('d2', 5));
  const m = working('d1', 9);
  assert.equal(m.lines.length, 6); assert.equal(m.title, ''); assert.equal(m.plan, null);
  assert.deepEqual(working('d1', 10).lines.slice(0, 5), m.lines.slice(1));
});

test('every line comes from the lists, and the lists are big enough', () => {
  for (const list of [COMMANDS, PROGRESS, RESULTS]) assert.ok(list.length >= 12);
  for (let t = 0; t < 200; t++) for (const l of working('x', t).lines) assert.ok(fromLists(l), JSON.stringify(l));
});

test('all three kinds appear within a minute', () => {
  for (const seed of ['a', 'b', 'c']) {
    const kinds = new Set();
    for (let t = 0; t < 60; t++) for (const l of working(seed, t).lines) kinds.add(l.kind);
    assert.deepEqual([...kinds].sort(), ['assistant', 'tool', 'user']);
  }
});

test('banners: about one second in twelve, never two in a row, from the list', () => {
  for (const seed of ['a', 'b', 'c']) {
    let n = 0, prev = false;
    for (let t = 0; t < 1200; t++) {
      const b = working(seed, t).banner;
      if (b !== undefined) { assert.ok(BANNERS.includes(b)); assert.ok(!prev, `${seed} ${t}`); n++; }
      prev = b !== undefined;
    }
    assert.ok(n > 1200 * 0.05 && n < 1200 * 0.12, `${seed}: ${n}`);
  }
  const at = seed => Array.from({ length: 200 }, (_, t) => working(seed, t).banner !== undefined).join();
  assert.notEqual(at('a'), at('b'), 'desks do not flash together');
});

test('waiting screens blink their prompt', () => {
  const even = fakeMonitor('d', 'amber', 4.5), odd = fakeMonitor('d', 'amber', 5.5);
  assert.deepEqual(even.lines, [{ kind: 'user', text: 'hello? anyone? (tap tap tap)' }]);
  assert.deepEqual(odd.lines, [{ kind: 'user', text: '' }]);
  assert.equal(even.banner, undefined);
});

test('idle screens bounce a saver inside the screen, moving every second', () => {
  let flipped = { x: false, y: false }, last = null;
  for (const seed of ['a', 'b']) for (let t = 0; t < 300; t++) {
    const m = fakeMonitor(seed, 'dark', t), p = m.saver, q = fakeMonitor(seed, 'dark', t + 1).saver;
    assert.deepEqual(m.lines, []); assert.equal(p.text, 'brb ☕');
    for (const v of [p.x, p.y]) assert.ok(v >= 0 && v <= 1);
    assert.ok(p.x !== q.x && p.y !== q.y, `${seed} ${t}`);
    assert.deepEqual(fakeMonitor(seed, 'dark', t + 0.4), m);
    if (last) { if ((p.x - last.x) * (q.x - p.x) < 0) flipped.x = true; if ((p.y - last.y) * (q.y - p.y) < 0) flipped.y = true; }
    last = p;
  }
  assert.ok(flipped.x && flipped.y, 'it reflects off the edges');
  assert.notDeepEqual(fakeMonitor('a', 'dark', 3).saver, fakeMonitor('b', 'dark', 3).saver);
});

test('off and the other tones are null', () => {
  for (const tone of ['off', 'blue', 'red']) assert.equal(fakeMonitor('d', tone, 3), null);
});
