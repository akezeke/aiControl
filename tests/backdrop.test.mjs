import test from 'node:test';
import assert from 'node:assert/strict';
import { bayer, coverLayout, findDripSites, hash, maskPixels } from '../client/backdrop/pixels.js';
import { createPainter as heroes } from '../client/backdrop/heroes.js';
import { createPainter as diablo } from '../client/backdrop/diablo.js';

const solid = (w, h, [r, g, b]) => { const data = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) data.set([r, g, b, 255], i * 4); return { w, h, data }; };
const paint = (sample, x, y, w, h, [r, g, b]) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) sample.data.set([r, g, b, 255], (j * sample.w + i) * 4); };
// A context that only records what a painter asks for.
const recorder = () => {
  const calls = [];
  return { calls, ctx: { globalAlpha: 1, fillStyle: '#000', globalCompositeOperation: 'source-over', fillRect(x, y, w, h) { calls.push({ x, y, w, h, alpha: this.globalAlpha, style: this.fillStyle }); } } };
};

test('hash is stable and stays within [0, 1)', () => {
  assert.equal(hash(3, 4, 5), hash(3, 4, 5));
  assert.notEqual(hash(3, 4, 5), hash(3, 4, 6));
  for (let i = 0; i < 500; i++) { const v = hash(i, i * 7, 9); assert.ok(v >= 0 && v < 1); }
});

test('ordered dither thresholds cover the range evenly', () => {
  const seen = new Set(); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) seen.add(bayer(x, y));
  assert.equal(seen.size, 16); assert.ok(Math.min(...seen) > 0 && Math.max(...seen) < 1);
});

test('cover layout fills the view and follows the focal point', () => {
  const wide = coverLayout({ width: 1600, height: 900 }, { width: 1000, height: 1000 });
  assert.equal(wide.scale, 1.6); assert.equal(wide.width, 1600); assert.equal(wide.top, (900 - 1600) / 2);
  const tall = coverLayout({ width: 400, height: 800 }, { width: 1600, height: 900 }, [.78]);
  assert.equal(tall.height, 800); assert.ok(Math.abs(tall.left - (400 - tall.width) * .78) < 1e-9);
  assert.ok(tall.left <= 0 && tall.top === 0);
});

test('masks list only the pixels inside the area that pass the test', () => {
  const sample = solid(10, 10, [0, 0, 0]); paint(sample, 2, 2, 3, 3, [200, 0, 0]);
  assert.deepEqual(maskPixels(sample, [0, 0, 10, 10], r => r > 100).length, 9);
  assert.deepEqual(maskPixels(sample, [3, 3, 10, 10], r => r > 100).sort((a, b) => a - b), [33, 34, 43, 44]);
});

test('blood drips from the end of a strand and lands in the pool beneath', () => {
  const sample = solid(40, 80, [10, 10, 10]);
  paint(sample, 20, 5, 1, 12, [120, 10, 10]);
  paint(sample, 14, 50, 14, 6, [120, 10, 10]);
  const [site, ...rest] = findDripSites(sample, (r, g) => r > 80 && g < 40);
  assert.deepEqual([site.x, site.y, site.land], [20, 17, 50]);
  assert.ok(rest.every(other => Math.hypot(other.x - site.x, other.y - site.y) >= 9));
});

test('blood with nothing under it still drips, with nowhere to land', () => {
  const sample = solid(10, 60, [10, 10, 10]); paint(sample, 5, 2, 1, 8, [120, 10, 10]);
  const [site] = findDripSites(sample, r => r > 80);
  assert.equal(site.land, null); assert.equal(site.y, 10);
});

// Painters are functions of time over a small copy of the artwork.
for (const [name, create, width, height] of [['heroes', heroes, 418, 236], ['diablo', diablo, 512, 342]]) {
  const noise = () => { const sample = solid(width, height, [0, 0, 0]); for (let i = 0; i < width * height; i++) sample.data.set([hash(i, 1) * 255, hash(i, 2) * 255, hash(i, 3) * 255, 255], i * 4); return sample; };

  test(`${name} draws something every frame with finite, in-range values`, () => {
    const frame = create(noise());
    for (const t of [0, .5, 3.25, 40, 1234.5]) {
      const { calls, ctx } = recorder(); frame(ctx, t);
      assert.ok(calls.length > 5, `${name} at ${t}`);
      for (const c of calls) { assert.ok([c.x, c.y, c.w, c.h].every(Number.isFinite)); assert.ok(c.alpha >= 0 && c.alpha <= 1); assert.ok(c.w >= 0 && c.h >= 0); }
    }
  });

  test(`${name} is the same picture at the same time`, () => {
    const a = recorder(), b = recorder(); const sample = noise();
    create(sample)(a.ctx, 12.5); create(sample)(b.ctx, 12.5);
    assert.deepEqual(a.calls, b.calls);
  });

  test(`${name} copes with a picture that has nothing to animate`, () => {
    const { ctx } = recorder(); const frame = create(solid(width, height, [128, 128, 128]));
    assert.doesNotThrow(() => { frame(ctx, 1); frame(ctx, 2); });
  });
}
