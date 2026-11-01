// What the city's intro draws that the city doesn't: a tower half way out of the ground, the dark, and the title card.
import { blockGone, columnRuns } from './boot.js';

const CUT = '#fbff86', INK = [46, 34, 47], DARK = 150, CELL = 3;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(n => (n + .5) / 16);
const NAME = 'METROPOLIS', NAME_INK = '#f9c22b', NAME_SHADE = '#fb6b1d', CARD_BACK = '#2e222f', STRIPE = ['#f9c22b', '#2e222f'], BLOCK = 8;

// Cut along the sprite's own foot, so that it comes up out of its lot as a plane through the building rather than a slice across it, with a bright edge where the work has got to.
const runsOf = new WeakMap();
export function drawRising(ctx, sprite, left, top, rise) {
  if (rise <= 0) return;
  let runs = runsOf.get(sprite);
  if (!runs) { runs = columnRuns(sprite); runs.tall = runs.reduce((most, run) => Math.max(most, run.foot - run.top + 1), 0); runsOf.set(sprite, runs); }
  const height = Math.ceil(rise * runs.tall);
  ctx.fillStyle = CUT;
  for (const { x, n, foot, top: head } of runs) {
    const from = Math.max(head, foot - height + 1), rows = foot - from + 1;
    ctx.drawImage(sprite.image, x, from, n, rows, left + x, top + from, n, rows);
    if (from > head) ctx.fillRect(left + x, top + from, n, 1);
  }
}

// Flat until the power comes on, then a coarse dithered grid on a small canvas, so the edge of the dark stays cheap and looks like the rest of the art.
export function createBootShade() {
  const canvas = document.createElement('canvas'), c = canvas.getContext('2d');
  let image = null, cells = null;
  const on = (INK[0] | INK[1] << 8 | INK[2] << 16 | DARK << 24) >>> 0;
  return {
    paint(target, width, height, boot, world) {
      if (boot.wave < 0) { target.fillStyle = `rgba(${INK}, ${DARK / 255})`; target.fillRect(0, 0, width, height); return; }
      const w = Math.ceil(width / CELL), h = Math.ceil(height / CELL);
      if (canvas.width !== w || canvas.height !== h || !image) { canvas.width = w; canvas.height = h; image = c.createImageData(w, h); cells = new Uint32Array(image.data.buffer); }
      const [x0, z0] = world(0, 0), [x1, z1] = world(CELL, 0), [x2, z2] = world(0, CELL), xc = x1 - x0, zc = z1 - z0, xr = x2 - x0, zr = z2 - z0;
      for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) cells[col + row * w] = boot.dark(x0 + xc * col + xr * row, z0 + zc * col + zr * row) > BAYER[(col & 3) + (row & 3) * 4] ? on : 0;
      c.putImageData(image, 0, 0);
      target.drawImage(canvas, 0, 0, w * CELL, h * CELL);
    },
  };
}

const stripes = scale => {
  const tile = document.createElement('canvas'); tile.width = 16 * scale; tile.height = 8 * scale;
  const c = tile.getContext('2d');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) { c.fillStyle = STRIPE[(x + y) % 16 < 8 ? 0 : 1]; c.fillRect(x * scale, y * scale, scale, scale); }
  return tile;
};
// Words on the same hard pixels as everything else: drawn small, no greys left, scaled up whole.
const lettering = (text, font, colour) => {
  const measure = document.createElement('canvas').getContext('2d'); measure.font = font;
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(measure.measureText(text).width) + 1; canvas.height = 9;
  const c = canvas.getContext('2d'); c.font = font; c.textBaseline = 'alphabetic'; c.fillStyle = colour; c.fillText(text, 0, 7);
  const image = c.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = image.data[i] >= 128 ? 255 : 0;
  c.putImageData(image, 0, 0);
  return canvas;
};

// A canvas over the box, on whole device pixels. It takes no clicks: what's under it works, and pressing anything just ends the intro.
export function createBootCard(box) {
  const canvas = document.createElement('canvas'), c = canvas.getContext('2d');
  canvas.className = 'city-boot-card'; canvas.setAttribute('aria-hidden', 'true');
  box.append(canvas);
  const mark = new Image(), font = `8px ${getComputedStyle(box).getPropertyValue('--display').trim() || 'monospace'}`;
  let name = null, shade = null, boxW = 0, boxH = 0, tile = null, band = 0, scale = 0, unit = 1, loaded = 0;
  const arrived = () => { loaded++; card.ready = loaded === 2; };
  mark.src = '/city-mark.svg';
  mark.decode().catch(() => {}).then(arrived);
  document.fonts.load(font, NAME).catch(() => {}).then(() => { name = lettering(NAME, font, NAME_INK); shade = lettering(NAME, font, NAME_SHADE); arrived(); });
  const measure = () => {
    const rect = box.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (rect.width === boxW && rect.height === boxH) return;
    boxW = rect.width; boxH = rect.height;
    scale = Math.max(1, Math.round((boxW < 600 ? 2 : 3) * dpr));
    canvas.width = Math.ceil(boxW * dpr / scale); canvas.height = Math.ceil(boxH * dpr / scale);
    canvas.style.width = `${canvas.width * scale / dpr}px`; canvas.style.height = `${canvas.height * scale / dpr}px`;
    unit = Math.max(1, Math.min(3, Math.floor(canvas.width * .8 / (name?.width || 60))));
    band = Math.max(1, unit); tile = stripes(band);
    c.imageSmoothingEnabled = false;
  };
  const card = {
    ready: false,
    draw({ bands, mark: dropped, stamp, shake, broken }) {
      measure();
      const W = canvas.width, H = canvas.height, markSize = 32 * Math.max(1, unit - (unit > 2 ? 1 : 0)), nameH = 9 * unit, stripe = 8 * band, gap = 4 * unit, total = stripe * 2 + markSize + nameH + gap * 3, jolt = Math.round(shake / scale);
      let y = Math.floor((H - total) / 2) + jolt;
      c.fillStyle = CARD_BACK; c.fillRect(0, 0, W, H);
      const strip = (at, x, width) => { c.save(); c.beginPath(); c.rect(x, at, width, stripe); c.clip(); c.fillStyle = c.createPattern(tile, 'repeat'); c.translate(0, at); c.fillRect(x, 0, width, stripe); c.restore(); };
      const slam = t => Math.round(W * (1 - (1 - t) ** 3)), top = slam(bands[0]), bottom = slam(bands[1]);
      if (top) strip(y, 0, top);
      if (bottom) strip(y + total - stripe, W - bottom, bottom);
      y += stripe + gap;
      if (dropped > 0 && mark.naturalWidth) c.drawImage(mark, Math.floor((W - markSize) / 2), y - Math.round((1 - dropped) ** 2 * (y + markSize)), markSize, markSize);
      y += markSize + gap;
      if (stamp > 0 && name) {
        const k = unit + Math.round((1 - stamp) * 2), width = name.width * k, height = name.height * k, x = Math.floor((W - width) / 2), at = y - Math.floor((height - nameH) / 2);
        c.drawImage(shade, x + k, at + k, width, height); c.drawImage(name, x, at, width, height);
      }
      if (broken > 0) for (let row = 0; row * BLOCK < H; row++) for (let col = 0; col * BLOCK < W; col++) if (blockGone(col, row, broken)) c.clearRect(col * BLOCK, row * BLOCK, BLOCK, BLOCK);
    },
    dispose() { canvas.remove(); },
  };
  measure(); card.draw({ bands: [0, 0], mark: 0, stamp: 0, shake: 0, broken: 0 });
  return card;
}
