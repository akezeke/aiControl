// Pure helpers for the pixel backdrops. Painters are functions of time over a low-resolution
// copy of the artwork, so everything here runs (and is tested) without a canvas.

// Integer hash to [0, 1): stateless randomness, so a frame depends only on its time.
export function hash(a, b = 0, c = 0) {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
// Ordered-dither threshold in (0, 1) for a pixel; `bayer(x, y) < amount` fades with the look of old hardware.
export const bayer = (x, y) => (BAYER[(y & 3) * 4 + (x & 3)] + .5) / 16;

// Where a `cover`-sized image lands in a viewport, given its focal point (0..1 on each axis).
// Returns the rectangle the image fills in CSS pixels; `scale` is CSS pixels per image pixel.
export function coverLayout(view, image, [px = .5, py = .5] = []) {
  const scale = Math.max(view.width / image.width, view.height / image.height);
  const width = image.width * scale, height = image.height * scale;
  return { scale, width, height, left: (view.width - width) * px, top: (view.height - height) * py };
}

export const pixelAt = (sample, x, y) => {
  const i = (Math.min(sample.h - 1, Math.max(0, y)) * sample.w + Math.min(sample.w - 1, Math.max(0, x))) * 4, d = sample.data;
  return [d[i], d[i + 1], d[i + 2]];
};

// Packed pixel indexes (y * width + x) inside `area` [x0, y0, x1, y1] whose colour passes `test`.
export function maskPixels(sample, area, test) {
  const out = [];
  const [x0, y0, x1, y1] = area.map(Math.round);
  for (let y = Math.max(0, y0); y < Math.min(sample.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(sample.w, x1); x++) {
    const i = (y * sample.w + x) * 4;
    if (test(sample.data[i], sample.data[i + 1], sample.data[i + 2], x, y)) out.push(y * sample.w + x);
  }
  return out;
}

// Blood hanging off an edge: a vertical run of blood that ends over darkness. Each site records
// the first pixel under the tip and, when there is more blood a little further down, where a drop would land.
export function findDripSites(sample, isBlood, { minRun = 3, maxFall = 70, spacing = 9 } = {}) {
  const { w, h } = sample, blood = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = pixelAt(sample, x, y); blood[y * w + x] = isBlood(r, g, b) ? 1 : 0; }
  const found = [];
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y < h - 2; y++) {
      if (blood[y * w + x]) { run++; continue; }
      if (run >= minRun && !blood[(y + 1) * w + x]) {
        let land = null;
        for (let d = 3; d < maxFall && y + d < h; d++) if (blood[(y + d) * w + x] && blood[(y + d) * w + Math.min(w - 1, x + 1)]) { land = y + d; break; }
        found.push({ x, y, land, run });
      }
      run = 0;
    }
  }
  // Longest strands first, never two drops side by side.
  found.sort((a, b) => b.run - a.run || hash(a.x, a.y) - hash(b.x, b.y));
  const sites = [];
  for (const site of found) if (sites.every(other => Math.hypot(other.x - site.x, other.y - site.y) >= spacing)) sites.push(site);
  return sites;
}

// Filled disc in whole pixels; `rect` is any (x, y, w, h) painter.
export function disc(rect, cx, cy, r) {
  for (let dy = -r; dy <= r; dy++) { const half = Math.floor(Math.sqrt(r * r + .5 - dy * dy)); rect(cx - half, cy + dy, half * 2 + 1, 1); }
}

// Drawing context wrapper: fills with a colour and alpha in one call.
export function painter(ctx) {
  return (x, y, w, h, color, alpha = 1) => { ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
}

// Stepped glow made of three nested discs, drawn additively so it reads as banded light.
export function glow(ctx, x, y, r, color, alpha) {
  ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = color; ctx.globalAlpha = alpha / 3;
  for (const k of [1, .66, .33]) disc((px, py, w, h) => ctx.fillRect(px, py, w, h), x, y, Math.max(1, Math.round(r * k)));
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
}

// Sparks on a set of packed pixel indexes: each of `count` slots lights a random member for a moment, then moves on.
export function sparkle(rect, pixels, width, t, count, period, color, salt) {
  if (!pixels.length) return;
  for (let k = 0; k < count; k++) {
    const p = period * (.7 + hash(k, salt) * 1.1), u = t / p + hash(k, salt + 1), cycle = Math.floor(u), phase = u - cycle;
    if (phase > .5) continue;
    const index = pixels[Math.floor(hash(k, cycle, salt + 2) * pixels.length)], x = index % width, y = Math.floor(index / width);
    rect(x, y, 1, 1, color);
    if (phase > .1 && phase < .35) { rect(x - 1, y, 1, 1, color, .55); rect(x + 1, y, 1, 1, color, .55); }
  }
}
