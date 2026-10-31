// A soft glow over the sharp image: only what is lit, shrunk and grown with smoothing, so the art underneath keeps its hard pixels. A colour can't tell a lamp from a wall of the same gold, so the sprite says what is lit. Each shrink halves the last because one big step skips pixels. No ctx.filter, which Safari doesn't have.
export function glowPixels(rgba, width, height, lit) {
  const glow = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < lit.length; i++) if (lit[i]) glow.set(rgba.subarray(i * 4, i * 4 + 4), i * 4);
  return glow;
}

// Tight and bright to wide and faint.
const LEVELS = [{ shrink: 2, alpha: .55 }, { shrink: 4, alpha: .7 }, { shrink: 8, alpha: .7 }];

export class Bloom {
  #buffers = LEVELS.map(() => { const canvas = document.createElement('canvas'); return { canvas, ctx: canvas.getContext('2d') }; });

  draw(ctx, source, width, height) {
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter'; ctx.imageSmoothingEnabled = true;
    let from = source;
    LEVELS.forEach(({ shrink, alpha }, i) => {
      const { canvas, ctx: buffer } = this.#buffers[i], w = Math.max(1, Math.ceil(source.width / shrink)), h = Math.max(1, Math.ceil(source.height / shrink));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } else buffer.clearRect(0, 0, w, h);
      buffer.imageSmoothingEnabled = true; buffer.drawImage(from, 0, 0, w, h);
      ctx.globalAlpha = alpha; ctx.drawImage(canvas, 0, 0, w * shrink / source.width * width, h * shrink / source.height * height);
      from = canvas;
    });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
}
