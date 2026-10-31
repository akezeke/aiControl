import test from 'node:test';
import assert from 'node:assert/strict';
import { OUTLINE, hex } from '../client/city/palette.js';
import { Stack } from '../client/city/stack.js';
import { SpriteCache, renderSprite } from '../client/city/sprite.js';

const box = () => { const s = new Stack(12, 12, 12); s.box(0, 0, 0, 8, 8, 8, hex('#4d9be6')); return s.bake(); };
test('a sprite has its size, mask and whole-number origin in every view', () => {
  for (const view of [0, 1, 2, 3]) { const p = renderSprite(box(), view); assert.equal(p.rgba.length, p.width * p.height * 4); assert.equal(p.mask.length, p.width * p.height); assert.ok(Number.isInteger(p.originX) && Number.isInteger(p.originY)); assert.ok(p.mask.some(Boolean)); }
});
test('the mask matches the opaque pixels and every pixel is fully opaque or clear', () => {
  const p = renderSprite(box(), 0);
  for (let i = 0; i < p.mask.length; i++) { assert.ok([0, 255].includes(p.rgba[i * 4 + 3])); assert.equal(p.mask[i], p.rgba[i * 4 + 3] ? 1 : 0); }
});
test('the silhouette is outlined', () => {
  const p = renderSprite(box(), 0), [r, g, b] = hex(OUTLINE); let edge = 0;
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if (p.mask[x + y * p.width] && (x === 0 || !p.mask[x - 1 + y * p.width])) { const i = (x + y * p.width) * 4; assert.deepEqual([p.rgba[i], p.rgba[i + 1], p.rgba[i + 2]], [r, g, b]); edge++; }
  assert.ok(edge > 0);
});
test('opposite views of a square stack are the same size', () => { const a = renderSprite(box(), 0), b = renderSprite(box(), 2); assert.equal(a.width, b.width); assert.equal(a.height, b.height); });
test('the cache evicts the least recently used past its limit', () => {
  const c = new SpriteCache(2); c.set('a', 1); c.set('b', 2); c.get('a'); c.set('c', 3);
  assert.equal(c.get('a'), 1); assert.equal(c.get('b'), undefined); assert.equal(c.size, 2);
});
test('the shadow is solid and leaves the sprite the same way in the world', () => {
  const p = renderSprite(box(), 0), s = p.shadow;
  assert.equal(s.rgba.length, s.width * s.height * 4);
  for (let i = 0; i < s.rgba.length; i += 4) if (s.rgba[i + 3]) { assert.equal(s.rgba[i + 3], 255); assert.deepEqual([s.rgba[i], s.rgba[i + 1], s.rgba[i + 2]], hex('#2e222f')); }
  assert.ok(s.rgba.some(Boolean));
});
test('a sleeping building loses most of its colour and light, and keeps its shape', () => {
  const awake = renderSprite(box(), 0), asleep = renderSprite(box(), 0, { asleep: true });
  assert.equal(asleep.width, awake.width); assert.deepEqual([...asleep.mask], [...awake.mask]);
  const measure = ({ rgba, mask }) => { let light = 0, spread = 0, n = 0; mask.forEach((on, i) => { if (!on) return; const c = [...rgba.subarray(i * 4, i * 4 + 3)]; if (c.join() === '46,34,47') return; light += c[0] + c[1] + c[2]; spread += Math.max(...c) - Math.min(...c); n++; }); return { light: light / n, spread: spread / n }; };
  const was = measure(awake), now = measure(asleep);
  assert.ok(now.light < was.light * .7, `light ${now.light} of ${was.light}`); assert.ok(now.spread < was.spread * .6, `colour ${now.spread} of ${was.spread}`);
});
