import test from 'node:test';
import assert from 'node:assert/strict';
import { RESURRECT_64, EXTRAS, hex, inPalette, nearest } from '../client/city/palette.js';
import { Stack } from '../client/city/stack.js';

test('Resurrect 64 is complete and has no extras yet', () => {
  assert.equal(RESURRECT_64.length, 64);
  assert.equal(new Set(RESURRECT_64).size, 64);
  assert.ok(RESURRECT_64.includes('#2e222f') && RESURRECT_64.includes('#ffffff'));
  assert.deepEqual(EXTRAS, []);
});
test('nearest always lands on the palette and keeps palette colours', () => {
  for (const c of RESURRECT_64) assert.deepEqual(nearest(hex(c)), hex(c));
  for (const c of [[0, 0, 0], [255, 255, 255], [12, 200, 99], [300, -5, 128]]) assert.ok(inPalette(...nearest(c)));
});
test('bake outputs only palette colours and the lit, wall and shaded tones of a ramp', () => {
  const s = new Stack(8, 8, 8); s.box(0, 0, 0, 6, 6, 6, hex('#e83b3b')); s.bake();
  const seen = new Set();
  for (const l of s.layers) if (l) for (let i = 0; i < l.data.length; i += 4) if (l.data[i + 3]) { assert.ok(inPalette(l.data[i], l.data[i + 1], l.data[i + 2])); seen.add([l.data[i], l.data[i + 1], l.data[i + 2]].join()); }
  for (const c of ['#f68181', '#e83b3b', '#ae2334']) assert.ok(seen.has(hex(c).join()), c);
  assert.equal(s.v, null);
});
test('put ignores anything outside the stack', () => {
  const s = new Stack(2, 2, 2); s.put(99, 0, 0, hex('#ffffff')); s.put(0, -1, 0, hex('#ffffff')); s.bake();
  assert.ok(s.layers.every(l => l === null));
});
