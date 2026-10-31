// A baked stack drawn from one of the four views: opaque pixels only, an outline round the silhouette, and a shadow for the ground. Pure.
import { OUTLINE, hex, nearest } from './palette.js';
import { LIT } from './stack.js';

// World x, z to screen for yaw 45 + 90·view, and back. One layer is one pixel up the screen.
export const SCREEN = [(x, z) => [x - z, (x + z) / 2], (x, z) => [-x - z, (x - z) / 2], (x, z) => [z - x, -(x + z) / 2], (x, z) => [x + z, (z - x) / 2]];
const WORLD = [(a, b) => [b + a, b - a], (a, b) => [b - a, -a - b], (a, b) => [-a - b, a - b], (a, b) => [a - b, a + b]]; // a = screen x / 2, b = screen y.
// The sun stays put in the world, so a shadow swings round as the city turns.
export const SHADOW = { x: .5, z: -.72 };
// A depth jump this big inside a sprite draws a line, which is what picks a ledge out of the wall behind it.
const GAP = 4, PLANE = 1.2247, RISE = .4082, DIM_TO = hex('#323353'), INK = hex(OUTLINE), SHADE = hex('#2e222f');

const bounds = (view, corners) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, z, up] of corners) { const [sx, sy] = SCREEN[view](x, z); x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy - up); y1 = Math.max(y1, sy - up); }
  return [Math.floor(x0), Math.ceil(x1), Math.floor(y0), Math.ceil(y1)];
};
const box = (x0, x1, z0, z1, up = 0) => [[x0, z0, up], [x1, z0, up], [x0, z1, up], [x1, z1, up]];

// Where each voxel's shadow lands on the ground, then that patch of ground drawn from the view.
function renderShadow(stack, view) {
  const { w, d, h, layers } = stack;
  let gx0 = Infinity, gx1 = -Infinity, gz0 = Infinity, gz1 = -Infinity;
  for (let y = 0; y < h; y++) {
    const L = layers[y]; if (!L) continue;
    gx0 = Math.min(gx0, Math.floor(L.x0 - w / 2 + SHADOW.x * y)); gx1 = Math.max(gx1, Math.floor(L.x1 - w / 2 + SHADOW.x * y));
    gz0 = Math.min(gz0, Math.floor(L.z0 - d / 2 + SHADOW.z * y)); gz1 = Math.max(gz1, Math.floor(L.z1 - d / 2 + SHADOW.z * y));
  }
  if (gx1 < gx0) return { width: 0, height: 0, rgba: new Uint8ClampedArray(0), originX: 0, originY: 0 };
  const gw = gx1 - gx0 + 1, gd = gz1 - gz0 + 1, grid = new Uint8Array(gw * gd);
  for (let y = 0; y < h; y++) {
    const L = layers[y]; if (!L) continue;
    for (let z = L.z0; z <= L.z1; z++) for (let x = L.x0; x <= L.x1; x++) {
      if (!L.data[(x + z * w) * 4 + 3]) continue;
      grid[Math.floor(x - w / 2 + SHADOW.x * y) - gx0 + (Math.floor(z - d / 2 + SHADOW.z * y) - gz0) * gw] = 1;
    }
  }
  const [x0, x1, y0, y1] = bounds(view, box(gx0, gx1 + 1, gz0, gz1 + 1)), width = x1 - x0, height = y1 - y0, rgba = new Uint8ClampedArray(width * height * 4), world = WORLD[view];
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const [x, z] = world((px + x0 + .5) / 2, py + y0 + .5), a = Math.floor(x) - gx0, b = Math.floor(z) - gz0;
    if (a < 0 || b < 0 || a >= gw || b >= gd || !grid[a + b * gw]) continue;
    const o = (px + py * width) * 4; rgba[o] = SHADE[0]; rgba[o + 1] = SHADE[1]; rgba[o + 2] = SHADE[2]; rgba[o + 3] = 255;
  }
  return { width, height, rgba, originX: -x0, originY: -y0 };
}

export function renderSprite(stack, view, { dim = false, asleep = false } = {}) {
  const { w, d, h, layers } = stack, world = WORLD[view], used = [];
  for (let y = 0; y < h; y++) { const L = layers[y]; if (L) used.push(...box(L.x0 - w / 2, L.x1 + 1 - w / 2, L.z0 - d / 2, L.z1 + 1 - d / 2, y)); }
  if (!used.length) return { width: 0, height: 0, rgba: new Uint8ClampedArray(0), originX: 0, originY: 0, mask: new Uint8Array(0), lit: new Uint8Array(0), shadow: renderShadow(stack, view) };
  // One clear pixel all round for the outline.
  const [bx0, bx1, by0, by1] = bounds(view, used), x0 = bx0 - 1, y0 = by0 - 1, width = bx1 - bx0 + 2, height = by1 - by0 + 2, n = width * height;
  const rgba = new Uint8ClampedArray(n * 4), mask = new Uint8Array(n), lit = new Uint8Array(n), depth = new Float32Array(n).fill(-Infinity);
  for (let y = 0; y < h; y++) {
    const L = layers[y]; if (!L) continue;
    const [lx0, lx1, ly0, ly1] = bounds(view, box(L.x0 - w / 2, L.x1 + 1 - w / 2, L.z0 - d / 2, L.z1 + 1 - d / 2, y));
    for (let sy = ly0; sy < ly1; sy++) {
      const b = sy + .5 + y, near = b * PLANE + y * RISE;
      for (let sx = lx0; sx < lx1; sx++) {
        const [wx, wz] = world((sx + .5) / 2, b), X = Math.floor(wx + w / 2), Z = Math.floor(wz + d / 2);
        if (X < L.x0 || X > L.x1 || Z < L.z0 || Z > L.z1) continue;
        const i = (X + Z * w) * 4; if (!L.data[i + 3]) continue;
        const px = sx - x0 + (sy - y0) * width;
        if (near < depth[px]) continue;
        depth[px] = near; mask[px] = 1; lit[px] = L.data[i + 3] === LIT ? 1 : 0;
        rgba[px * 4] = L.data[i]; rgba[px * 4 + 1] = L.data[i + 1]; rgba[px * 4 + 2] = L.data[i + 2]; rgba[px * 4 + 3] = 255;
      }
    }
  }
  // Lights out: most of its colour goes and what's left falls towards night, so it can be told from a working tower across the city. Enough stays to know which one it is.
  if (asleep) { lit.fill(0); for (let i = 0; i < n; i++) if (mask[i]) {
    const grey = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3;
    const P = nearest([0, 1, 2].map(k => { const faded = rgba[i * 4 + k] + (grey - rgba[i * 4 + k]) * .7; return faded * .55 + DIM_TO[k] * .25; }));
    rgba[i * 4] = P[0]; rgba[i * 4 + 1] = P[1]; rgba[i * 4 + 2] = P[2];
  } }
  if (dim) lit.fill(0);
  if (dim) for (let i = 0; i < n; i++) if (mask[i]) {
    const P = nearest([0, 1, 2].map(k => rgba[i * 4 + k] + (DIM_TO[k] - rgba[i * 4 + k]) * .6));
    rgba[i * 4] = P[0]; rgba[i * 4 + 1] = P[1]; rgba[i * 4 + 2] = P[2];
  }
  // Wherever something stands in front of what's next to it, including clear space: that's the outline and the inner edges together.
  const lines = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = x + y * width;
    if ((x + 1 < width && mask[o + 1] && (!mask[o] || depth[o + 1] - depth[o] > GAP)) || (x > 0 && mask[o - 1] && (!mask[o] || depth[o - 1] - depth[o] > GAP)) || (y + 1 < height && mask[o + width] && (!mask[o] || depth[o + width] - depth[o] > GAP)) || (y > 0 && mask[o - width] && (!mask[o] || depth[o - width] - depth[o] > GAP))) lines.push(o);
  }
  for (const o of lines) { mask[o] = 1; lit[o] = 0; rgba[o * 4] = INK[0]; rgba[o * 4 + 1] = INK[1]; rgba[o * 4 + 2] = INK[2]; rgba[o * 4 + 3] = 255; }
  return { width, height, rgba, originX: -x0, originY: -y0, mask, lit, shadow: renderShadow(stack, view) };
}

// Recently used sprites stay; the rest get rebuilt when they're next on screen.
export class SpriteCache {
  #items = new Map();
  constructor(max = 256) { this.max = max; }
  get(key) { const hit = this.#items.get(key); if (hit !== undefined) { this.#items.delete(key); this.#items.set(key, hit); } return hit; }
  set(key, sprite) { this.#items.delete(key); this.#items.set(key, sprite); if (this.#items.size > this.max) this.#items.delete(this.#items.keys().next().value); }
  get size() { return this.#items.size; }
  clear() { this.#items.clear(); }
}
