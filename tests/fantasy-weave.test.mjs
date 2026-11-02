import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeCharacter } from '../client/fantasy/characters.js';
import { newShared } from '../client/fantasy/rig.js';
import { CLASS_NAMES } from '../client/fantasy/roster.js';
import { PATTERNS, PATTERN_NAMES, drawPattern, layerOf, weaveTexture } from '../client/fantasy/weave.js';

const SIZE = 128, shared = () => newShared({ value: 1 }, { fog: 0, sun: 0xffffff, sky: 0x888888, bounce: 0x444444, dir: [0, 1, 0] });
const dress = (cls, id) => makeCharacter({ id, cls, session: { id } }, new THREE.Scene(), shared(), new Set()).rig;
const texel = (data, col, row) => [data[(row * SIZE + col) * 2], data[(row * SIZE + col) * 2 + 1]];
// How far apart two neighbouring columns (or rows) are on average, in light and ink together.
const gap = (data, a, b, across) => { let sum = 0; for (let i = 0; i < SIZE; i++) { const p = across ? texel(data, a, i) : texel(data, i, a), q = across ? texel(data, b, i) : texel(data, i, b); sum += Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]); } return sum / SIZE; };
const worstInside = (data, across) => { let worst = 0; for (let i = 0; i < SIZE - 1; i++) worst = Math.max(worst, gap(data, i, i + 1, across)); return worst; };

test('every pattern meets itself across the tile', () => {
  for (const name of PATTERN_NAMES) {
    const data = drawPattern(name);
    assert.ok(gap(data, 0, SIZE - 1, true) <= worstInside(data, true) * 1.5 + 2, `${name} shows a seam down the side`);
    assert.ok(gap(data, 0, SIZE - 1, false) <= worstInside(data, false) * 1.5 + 2, `${name} shows a seam across the top`);
  }
});
test('a pattern shades a garment without turning it dark or light', () => {
  for (const name of PATTERN_NAMES) {
    const data = drawPattern(name); let light = 0;
    for (let i = 0; i < data.length; i += 2) light += data[i] / 255;
    const mean = light / (SIZE * SIZE);
    assert.ok(mean > .42 && mean < .58, `${name} averages ${mean.toFixed(2)}`);
  }
});
test('every pattern says how big it is and the stack has a layer for each', () => {
  for (const [name, pattern] of Object.entries(PATTERNS)) assert.ok(pattern.per > 0 || pattern.band > 0, name);
  assert.equal(weaveTexture().image.depth, PATTERN_NAMES.length);
  assert.equal(weaveTexture(), weaveTexture());
  assert.equal(layerOf('nothing'), -1);
});
test('the hides are big enough to read from where a fight is watched', () => {
  for (const name of ['hide', 'fur', 'chitin', 'cracks', 'panels', 'blotch', 'scales', 'rings']) assert.ok(PATTERNS[name]?.per <= 1.5, `${name} repeats ${PATTERNS[name]?.per} times to a unit of body`);
});
test('every class is mostly dressed in patterns, each vertex in a real one', () => {
  for (const cls of Object.keys(CLASS_NAMES)) for (let i = 0; i < 12; i++) {
    const rig = dress(cls, `${cls}${i}`), weave = rig.geometry.getAttribute('weave'), ink = rig.geometry.getAttribute('ink');
    assert.equal(weave.count, rig.geometry.getAttribute('position').count);
    assert.equal(ink.count, weave.count);
    let dressed = 0;
    for (let v = 0; v < weave.count; v++) {
      const layer = weave.getZ(v);
      assert.ok(Number.isFinite(weave.getX(v)) && Number.isFinite(weave.getY(v)), `${cls}${i} has a broken uv`);
      assert.ok(layer === -1 || layer === -2 || (Number.isInteger(layer) && layer < PATTERN_NAMES.length), `${cls}${i} wears layer ${layer}`);
      if (layer >= 0) dressed++;
    }
    assert.ok(dressed / weave.count > .3, `${cls}${i} is only ${(dressed / weave.count).toFixed(2)} patterned`);
    rig.dispose();
  }
});
test('an aura gem shines by itself, whatever the fight is lit with', () => {
  const lit = new Set();
  for (let i = 0; i < 24; i++) { const weave = dress('knight', `knight${i}`).geometry.getAttribute('weave'); for (let v = 2; v < weave.array.length; v += 3) if (weave.array[v] === -2) lit.add(i); }
  assert.ok(lit.size > 12, `only ${lit.size} of 24 knights have a shining gem`);
});
test('a class has several fabrics, and the same person always wears the same one', () => {
  for (const cls of Object.keys(CLASS_NAMES)) {
    const seen = new Set();
    for (let i = 0; i < 24; i++) { const weave = dress(cls, `${cls}${i}`).geometry.getAttribute('weave'); for (let v = 2; v < weave.array.length; v += 3) if (weave.array[v] >= 0) seen.add(weave.array[v]); }
    assert.ok(seen.size >= 4, `${cls} only wears ${seen.size} fabrics`);
    assert.deepEqual([...dress(cls, 'same').geometry.getAttribute('weave').array], [...dress(cls, 'same').geometry.getAttribute('weave').array]);
    assert.deepEqual([...dress(cls, 'same').geometry.getAttribute('ink').array], [...dress(cls, 'same').geometry.getAttribute('ink').array]);
  }
});
test('the second colour of a pattern is not brown either', () => {
  const hue = ([r, g, b]) => { const hi = Math.max(r, g, b), lo = Math.min(r, g, b), d = hi - lo; return d < .08 ? null : (hi === r ? (g - b) / d + 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4) % 6 * 60; };
  const shares = [];
  for (const cls of Object.keys(CLASS_NAMES)) for (let i = 0; i < 12; i++) {
    const { geometry } = dress(cls, `${cls}${i}`), weave = geometry.getAttribute('weave'), ink = geometry.getAttribute('ink'); let brown = 0, all = 0;
    for (let v = 0; v < weave.count; v++) { if (weave.getZ(v) < 0) continue; const c = [ink.getX(v), ink.getY(v), ink.getZ(v)], h = hue(c); all++; if (h != null && h > 10 && h < 45 && Math.max(...c) < .62) brown++; }
    shares.push(brown / all);
  }
  assert.ok(shares.reduce((a, b) => a + b) / shares.length < .25, `average brown ink ${(shares.reduce((a, b) => a + b) / shares.length).toFixed(2)}`);
});
