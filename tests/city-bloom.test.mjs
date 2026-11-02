import test from 'node:test';
import assert from 'node:assert/strict';
import { glowPixels, lampOffset, lampSize, BLOOM_GRID } from '../client/city/bloom.js';
import { buildTower, coolingPlant, stackPlant } from '../client/city/generator.js';
import { lookOf } from '../client/city/identity.js';
import { renderSprite } from '../client/city/sprite.js';

const litCount = sprite => sprite.lit.reduce((sum, on) => sum + on, 0);
const look = crown => lookOf('bloom', `Blue ${crown}`);
const tower = (t, windows) => { const made = buildTower(t, windows, 8, 0); return made.stack ?? made; };

test('glowPixels keeps a lit pixel, clears a wall pixel, and stays the same size', () => {
  const rgba = new Uint8ClampedArray([251, 255, 134, 255, 251, 255, 134, 255]), glow = glowPixels(rgba, 2, 1, new Uint8Array([1, 0]));
  assert.equal(glow.length, rgba.length);
  assert.deepEqual([...glow.slice(0, 4)], [251, 255, 134, 255]);
  assert.deepEqual([...glow.slice(4)], [0, 0, 0, 0]);
});
test('a tower lights its windows and no wall, even a wall in a lamp colour', () => {
  const gold = lookOf('bloom', 'Gold Spire');
  const dark = renderSprite(tower(gold, 'dark'), 0), lit = renderSprite(tower(gold, 'lit'), 0);
  assert.equal(litCount(dark), 0);
  assert.ok(litCount(lit) > 0);
  for (let i = 0; i < lit.lit.length; i++) if (lit.lit[i]) assert.deepEqual([...lit.rgba.slice(i * 4, i * 4 + 3)], [251, 255, 134]);
});
test('a crown lamp stays lit only on a tower that is on', () => {
  assert.ok(litCount(renderSprite(tower(look('Clock'), 'lit'), 0)) > litCount(renderSprite(tower(look('Clock'), 'dark'), 0)));
});
test('a dimmed sprite has nothing lit', () => assert.equal(litCount(renderSprite(tower(look('Spire'), 'lit'), 0, { dim: true })), 0));
test('the outline is never lit', () => {
  const sprite = renderSprite(tower(look('Spire'), 'lit'), 0);
  for (let i = 0; i < sprite.lit.length; i++) if (sprite.lit[i]) assert.notDeepEqual([...sprite.rgba.slice(i * 4, i * 4 + 3)], [46, 34, 47]);
});
test('a plant lights its stripes while connected, whether or not it steams', () => {
  for (const [make, stripe] of [[coolingPlant, '#e83b3b'], [stackPlant, '#0eaf9b']]) {
    assert.ok(litCount(renderSprite(make(stripe, false, true), 0)) > 0);
    assert.equal(litCount(renderSprite(make(stripe, false, false), 0)), 0);
  }
});

test('the lamps are laid out so that the city, not the screen, decides how they shrink', () => {
  for (const origin of [0, 1, 3, 7, 8, 13, -1, -5, -8, -1234, 987]) {
    const shift = lampOffset(origin);
    assert.equal(((origin + shift) % BLOOM_GRID + BLOOM_GRID) % BLOOM_GRID, 0, `origin ${origin}`);
    assert.ok(shift >= 0 && shift < lampSize(0), `origin ${origin} shifts ${shift}`);
  }
});
test('the lamps canvas halves cleanly all the way down, and holds the canvas wherever it is shifted', () => {
  for (const art of [1, 7, 8, 333, 750, 1501]) {
    const size = lampSize(art);
    assert.equal(size % BLOOM_GRID, 0);
    for (const origin of [0, 1, 2, 3, 4, 5, 6, 7]) assert.ok(lampOffset(origin) + art <= size, `${art} at ${origin}`);
  }
});
