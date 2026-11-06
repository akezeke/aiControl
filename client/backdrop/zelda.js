import { hash, maskPixels, painter } from './pixels.js';

// The image is 1672 × 941; the backdrop samples it at one canvas pixel per four art pixels.
// Only blue water and the two white falls are repainted, leaving the rest of the art intact.
const G = 4, q = value => Math.round(value / G);
const FALLS = [[390, 65, 555, 365], [1290, 665, 1490, 941]];

export function createPainter(sample) {
  const water = maskPixels(sample, [0, q(200), sample.w, sample.h], (r, g, b, x) =>
    x > 0 && x < sample.w - 1 && b > 100 && b > r * 1.35 && b > g * 1.08);
  const falls = FALLS.map(box => maskPixels(sample, box.map(q), (r, g, b) => b > 145 && g > 145 && b > r + 4));
  return (ctx, t) => {
    const rect = painter(ctx);
    // Sparse white glints travel across the river and pool without painting over the banks.
    for (let k = 0; k < 55 && water.length; k++) {
      const u = t / (1.3 + hash(k, 8)) + hash(k, 9), phase = u - Math.floor(u);
      if (phase > .45) continue;
      const i = water[Math.floor(hash(k, Math.floor(u), 10) * water.length)];
      rect(i % sample.w, Math.floor(i / sample.w), 1, 1, '#d8f6ff', phase < .2 ? .8 : .4);
    }
    // Bands slide down bright parts of the painted waterfalls.
    for (let k = 0; k < falls.length; k++) for (const i of falls[k]) {
      const x = i % sample.w, y = Math.floor(i / sample.w);
      const phase = ((y - t * 9 + hash(x, k) * 7) % 15 + 15) % 15;
      if (phase < 1.5) rect(x, y, 1, 1, '#f6ffff', .7);
      else if (phase > 7 && phase < 8) rect(x, y, 1, 1, '#548ddc', .35);
    }
  };
}
