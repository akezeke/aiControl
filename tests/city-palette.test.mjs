import test from 'node:test';
import assert from 'node:assert/strict';
import { tower } from '../client/city/identity.js';
import { annex, buildTower } from '../client/city/generator.js';
import { renderSprite } from '../client/city/sprite.js';
import { RESURRECT_64, EXTRAS, hex, inPalette, nearest } from '../client/city/palette.js';
import { Stack } from '../client/city/stack.js';

test('Resurrect 64 is complete, and the few extras are new colours of its own kind', () => {
  assert.equal(RESURRECT_64.length, 64);
  assert.equal(new Set(RESURRECT_64).size, 64);
  assert.ok(RESURRECT_64.includes('#2e222f') && RESURRECT_64.includes('#ffffff'));
  assert.ok(EXTRAS.length <= 8);
  for (const c of EXTRAS) assert.ok(!RESURRECT_64.includes(c), c);
  assert.equal(new Set(EXTRAS).size, EXTRAS.length);
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
test('every pixel of every sprite, view and window state is in the palette', () => {
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) for (const windows of ['lit', 'dim', 'dark']) for (const view of [0, 1, 2, 3]) for (const dim of [false, true]) {
    const look = tower(id), p = renderSprite(buildTower(look, windows, 12).stack, view, { dim });
    for (let i = 0; i < p.rgba.length; i += 4) if (p.rgba[i + 3]) assert.ok(inPalette(p.rgba[i], p.rgba[i + 1], p.rgba[i + 2]), `${id} ${windows} ${view}`);
    const a = renderSprite(annex(look, 0, windows, 4).stack, view, { dim }); for (let i = 0; i < a.rgba.length; i += 4) if (a.rgba[i + 3]) assert.ok(inPalette(a.rgba[i], a.rgba[i + 1], a.rgba[i + 2]));
  }
});
