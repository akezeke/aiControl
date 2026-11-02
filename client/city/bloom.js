// A soft glow over the sharp image: only what is lit, shrunk and grown with smoothing, so the art underneath keeps its hard pixels. A colour can't tell a lamp from a wall of the same gold, so the sprite says what is lit. Each shrink halves the last because one big step skips pixels. No ctx.filter, which Safari doesn't have.
export function glowPixels(rgba, width, height, lit) {
  const glow = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < lit.length; i++) if (lit[i]) glow.set(rgba.subarray(i * 4, i * 4 + 4), i * 4);
  return glow;
}

// Tight and bright to wide and faint.
const LEVELS = [{ shrink: 2, alpha: .55 }, { shrink: 4, alpha: .7 }, { shrink: 8, alpha: .7 }];

// Shrinking averages over a grid of squares. Were that grid fixed to the screen, a lamp's light would be shared out differently each time the
// camera moved it a pixel, and the glow would flicker: so the lamps are drawn shifted to keep the city's origin on the coarsest grid.
export const BLOOM_GRID = LEVELS.at(-1).shrink;
// Lamps just off the canvas still glow onto it.
const PAD = 24;
export const lampOffset = origin => PAD + ((-(origin + PAD) % BLOOM_GRID) + BLOOM_GRID) % BLOOM_GRID;
export const lampSize = art => Math.ceil((art + PAD * 2 + BLOOM_GRID) / BLOOM_GRID) * BLOOM_GRID;

export class Bloom {
  #buffers = LEVELS.map(() => { const canvas = document.createElement('canvas'); return { canvas, ctx: canvas.getContext('2d') }; });

  // The whole of `source` lands on the rectangle (x, y, width, height), which may run past the edges of `ctx`.
  draw(ctx, source, x, y, width, height) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.globalCompositeOperation = 'lighter'; ctx.imageSmoothingEnabled = true;
    let from = source;
    LEVELS.forEach(({ shrink, alpha }, i) => {
      const { canvas, ctx: buffer } = this.#buffers[i], w = Math.max(1, Math.ceil(source.width / shrink)), h = Math.max(1, Math.ceil(source.height / shrink));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } else buffer.clearRect(0, 0, w, h);
      buffer.imageSmoothingEnabled = true; buffer.drawImage(from, 0, 0, w, h);
      ctx.globalAlpha = alpha; ctx.drawImage(canvas, x, y, w * shrink / source.width * width, h * shrink / source.height * height);
      from = canvas;
    });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
}
