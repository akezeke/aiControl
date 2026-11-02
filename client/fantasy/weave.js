// What clothes are made of: one small stack of tiling patterns, drawn once and shared by everyone. Each texel holds a light (.5 leaves the colour alone; folds, puffs and scratches go either way) and how much of the garment's second colour shows there, so a pattern takes on whoever wears it.
import * as THREE from 'three';

const SIZE = 128, TAU = Math.PI * 2;
const fract = x => x - Math.floor(x), clamp = x => Math.min(1, Math.max(0, x));
const edge = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash = (x, y, seed) => fract(Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453);
// Smooth noise that meets itself across the tile.
const noise = (x, y, cells, seed) => {
  const fx = fract(x) * cells, fy = fract(y) * cells, ix = Math.floor(fx), iy = Math.floor(fy), tx = edge(0, 1, fx - ix), ty = edge(0, 1, fy - iy), at = (a, b) => hash(a % cells, b % cells, seed);
  const low = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx, high = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
  return low * (1 - ty) + high * ty;
};
const fibre = (x, y) => .5 + Math.sin((x + y) * TAU * 32) * .025 + Math.sin((x - y) * TAU * 16) * .015 + (noise(x, y, 32, 1) - .5) * .07;
// Cloth hanging in folds: a broad swell, and darker where it creases. Runs across x only, since cloth falls straight down.
const fall = x => { const a = Math.sin(x * TAU * 2 + Math.sin(x * TAU) * 1.3), wide = Math.sin(x * TAU * 3 + 2) * .5; return a * .13 + wide * .06 - (1 - (a * .5 + .5)) ** 3 * .2; };
const line = (x, width) => 1 - edge(width * .6, width * 1.3, Math.abs(x));
const rails = y => Math.max(line(y - .06, .05), line(y - .94, .05));
const nearest = (x, c) => { const d = Math.abs(x - c); return Math.min(d, 1 - d); };
// Short strokes on a small grid: a script nobody can read.
const GLYPHS = Array.from({ length: 4 }, (_, g) => Array.from({ length: 3 }, (_, s) => [0, 1, 2, 3].map(i => hash(g + s * 7, i, 9))));
const segment = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)); return Math.hypot(px - ax - dx * t, py - ay - dy * t); };

// The nearest of a grid of jittered points and the next nearest, wrapping across the tile, for cracks and spots. Also an id for the nearest.
const cells = (x, y, count, seed) => {
  const fx = fract(x) * count, fy = fract(y) * count, ix = Math.floor(fx), iy = Math.floor(fy); let near = 9, next = 9, id = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const cx = (ix + dx + count) % count, cy = (iy + dy + count) % count, d = Math.hypot(fx - (ix + dx + .2 + hash(cx, cy, seed) * .6), fy - (iy + dy + .2 + hash(cx, cy, seed + 1) * .6));
    if (d < near) { next = near; near = d; id = hash(cx, cy, seed + 2); } else if (d < next) next = d;
  }
  return [near, next, id];
};

// `per`: repeats to a unit of body, which is about a torso. `band`: stretched to fit the height of a hem or collar and run around it, as wide as `band` heights.
export const PATTERNS = {
  weave: { per: 3, draw: (x, y) => [fibre(x, y), 0] },
  folds: { per: 1, draw: (x, y) => [fibre(x, y) + fall(x), 0] },
  brocade: { per: 3.2, draw: (x, y) => {
    const d = Math.abs(x - .5) + Math.abs(y - .5), lattice = line(d - .5, .025), r = Math.hypot(x - .5, y - .5), a = Math.atan2(y - .5, x - .5), flower = 1 - edge(.13, .16, r / (.72 + .28 * Math.abs(Math.cos(a * 2)))), corner = 1 - edge(.05, .08, Math.hypot(nearest(x, 0), nearest(y, 0)));
    return [fibre(x, y) + fall(x) * .4, Math.max(lattice, flower, corner)];
  } },
  damask: { per: 2.6, draw: (x, y) => {
    let ink = 0;
    for (const [cx, cy] of [[.25, .25], [.75, .75]]) { const dx = nearest(x, cx), dy = nearest(y, cy), r = Math.hypot(dx, dy), a = Math.atan2(y - cy, x - cx), petal = .17 + .06 * Math.cos(a * 6); ink = Math.max(ink, (1 - edge(petal - .015, petal + .015, r)) * edge(.045, .07, r)); }
    return [fibre(x, y) + fall(x) * .4, ink];
  } },
  stars: { per: 2.4, draw: (x, y) => {
    let ink = 0;
    for (let i = 0; i < 7; i++) { const dx = nearest(x, hash(i, 1, 3)), dy = nearest(y, hash(i, 2, 3)), size = .2 + hash(i, 3, 3) * .17; ink = Math.max(ink, 1 - edge(size - .03, size + .03, Math.sqrt(dx) + Math.sqrt(dy))); }
    return [fibre(x, y) + fall(x) * .5, ink];
  } },
  stripes: { per: 1.5, draw: (x, y) => [fibre(x, y) + fall(x) * .5, Math.max(line(nearest(x, .25), .11), line(nearest(x, .62), .025), line(nearest(x, .88), .025))] },
  harlequin: { per: 2.4, draw: (x, y) => {
    const a = (x + y) * 2, b = (x - y + 1) * 2, fa = fract(a), fb = fract(b), solid = (Math.floor(a) + Math.floor(b)) % 2 ? 1 : 0, seam = Math.min(fa, 1 - fa, fb, 1 - fb);
    return [fibre(x, y) - (1 - edge(0, .05, seam)) * .1, solid];
  } },
  quilt: { per: 3.4, draw: (x, y) => {
    const a = fract((x + y) * 2), b = fract((x - y + 1) * 2), seam = Math.min(a, 1 - a, b, 1 - b), puff = Math.sin(a * Math.PI) * Math.sin(b * Math.PI), dash = fract((x + y * .5) * 16) < .55 ? 1 : 0;
    return [fibre(x, y) + puff * .2 - .1, line(seam, .03) * dash];
  } },
  leather: { per: 2.4, draw: (x, y) => {
    const crack = line(noise(x, y, 10, 7) - .5, .018);
    return [.5 + (noise(x, y, 8, 5) - .5) * .2 + (noise(x, y, 32, 6) - .5) * .12 - crack * .1, 0];
  } },
  scale: { per: 3.2, draw: (x, y) => {
    const rows = 4, row = Math.floor(y * rows);
    for (const k of [0, 1]) { const at = row + k, fx = fract(x * rows + (at % 2 ? .5 : 0)) - .5, fy = y * rows - at, d = Math.hypot(fx, fy); if (d < .56) return [.44 + (1 - d / .56) * .13, edge(.5, .55, d)]; }
    return [.44, 0];
  } },
  engraved: { per: 2, draw: (x, y) => {
    const wave = fract(y * 2 + Math.sin(x * TAU * 2) * .13), scroll = line(nearest(wave, .5), .012), node = 1 - edge(.035, .055, Math.hypot(nearest(x, .25), nearest(fract(y * 2), .5) / 2));
    return [.5 + (noise(x, y, 10, 4) - .5) * .05 + (noise(x, y, 40, 8) - .5) * .04, Math.max(scroll * .55, node * .7)];
  } },
  plaid: { per: 1.6, draw: (x, y) => {
    const bar = v => Math.max(line(nearest(v, .25), .1) * .6, line(nearest(v, .7), .018));
    return [fibre(x, y), clamp(bar(x) + bar(y))];
  } },
  camo: { per: 1.3, draw: (x, y) => [fibre(x, y), edge(.5, .54, noise(x, y, 4, 3) * .75 + noise(x, y, 8, 11) * .25)] },
  band: { band: 1, draw: (x, y) => [.5 + (noise(x, y, 16, 2) - .5) * .05, Math.max(rails(y), 1 - edge(.3, .34, Math.abs(x - .5) + Math.abs(y - .5) * .9))] },
  chevron: { band: 1, draw: (x, y) => { const peak = Math.abs(fract(x * 2) - .5) * 2; return [.5 + (noise(x, y, 16, 2) - .5) * .05, Math.max(rails(y), line(y - (.26 + peak * .48), .075))]; } },
  glyphs: { band: 4, draw: (x, y) => {
    const g = Math.min(3, Math.floor(x * 4)), px = x * 4 - g, py = y; let d = 1;
    for (const [a, b, c, e] of GLYPHS[g]) d = Math.min(d, segment(px, py, .22 + Math.round(a * 2) * .28, .24 + Math.round(b * 2) * .26, .22 + Math.round(c * 2) * .28, .24 + Math.round(e * 2) * .26));
    return [.5 + (noise(x, y, 16, 2) - .5) * .05, Math.max(rails(y), line(d, .05))];
  } },
  // Hides, for monsters. A monster is seen from across the field, so these are few big marks to a tile and few tiles to a body.
  hide: { per: .9, draw: (x, y) => {
    const crease = Math.max(line(noise(x, y, 5, 21) - .5, .016), line(noise(x, y, 7, 22) - .5, .012));
    return [.53 + (noise(x, y, 4, 23) - .5) * .22 - crease * .3, edge(.6, .64, noise(x, y, 5, 24))];
  } },
  fur: { per: 1.2, draw: (x, y) => {
    const at = y * 5 + Math.abs(fract(x * 5) - .5) * 1.8, row = Math.floor(at), v = at - row, col = Math.floor(x * 5), tuft = hash(col, row % 5, 25);
    return [.5 + (v - .5) * .36 + (tuft - .5) * .14, edge(.56, .78, v) * (hash(col, row % 5, 26) > .45 ? 1 : 0)];
  } },
  chitin: { per: .9, draw: (x, y) => {
    const at = y * 3 + Math.abs(fract(x * 2) - .5) * .5, v = fract(at), seam = Math.min(v, 1 - v);
    return [.38 + v * .28 + Math.cos(x * TAU * 4) * .03 - line(seam, .03) * .16, line(seam, .05)];
  } },
  cracks: { per: 1, draw: (x, y) => {
    const [near, next, id] = cells(x + (noise(x, y, 6, 31) - .5) * .09, y + (noise(x, y, 6, 32) - .5) * .09, 4, 33), crack = 1 - edge(.035, .1, next - near);
    return [.52 + (id - .5) * .2 + (noise(x, y, 16, 34) - .5) * .1 - crack * .24, crack];
  } },
  panels: { per: .8, draw: (x, y) => {
    const fx = fract(x * 2), fy = fract(y * 2), seam = Math.min(fx, 1 - fx, fy, 1 - fy), rivet = Math.max(...[.14, .86].flatMap(a => [.14, .86].map(b => 1 - edge(.04, .06, Math.hypot(fx - a, fy - b)))));
    return [.5 + (hash(Math.floor(x * 2), Math.floor(y * 2), 35) - .5) * .12 + (noise(x, y, 24, 36) - .5) * .05 - line(seam, .03) * .3 + line(seam - .07, .02) * .1 + rivet * .2, rivet];
  } },
  blotch: { per: .8, draw: (x, y) => {
    const [near, , id] = cells(x + (noise(x, y, 5, 41) - .5) * .12, y + (noise(x, y, 5, 42) - .5) * .12, 3, 43), size = .2 + id * .18;
    return [.5 + (noise(x, y, 5, 44) - .5) * .16, 1 - edge(size - .03, size + .02, near)];
  } },
  scales: { per: 1, draw: (x, y) => {
    const rows = 4, row = Math.floor(y * rows);
    for (const k of [0, 1]) { const at = row + k, fx = fract(x * rows + (at % 2 ? .5 : 0)) - .5, fy = y * rows - at, d = Math.hypot(fx, fy); if (d < .56) return [.36 + (1 - d / .56) * .32, edge(.44, .5, d)]; }
    return [.36, 1];
  } },
  rings: { per: .9, draw: (x, y) => {
    const v = fract(y * 3);
    return [.5 + Math.sin(v * TAU - Math.PI / 2) * .1 + (noise(x, y, 16, 45) - .5) * .05, 1 - edge(.26, .3, Math.abs(v - .5))];
  } },
};
export const PATTERN_NAMES = Object.keys(PATTERNS);
export const layerOf = name => PATTERN_NAMES.indexOf(name);

// A layer's texels, red the light and green the ink, its bottom row first so a pattern stands the right way up on a body.
export function drawPattern(name) {
  const data = new Uint8Array(SIZE * SIZE * 2), { draw } = PATTERNS[name];
  for (let row = 0; row < SIZE; row++) for (let col = 0; col < SIZE; col++) {
    const [light, ink] = draw((col + .5) / SIZE, (row + .5) / SIZE), at = (row * SIZE + col) * 2;
    data[at] = clamp(light) * 255; data[at + 1] = clamp(ink) * 255;
  }
  return data;
}

let STACK = null;
export function weaveTexture() {
  if (STACK) return STACK;
  const data = new Uint8Array(SIZE * SIZE * 2 * PATTERN_NAMES.length);
  PATTERN_NAMES.forEach((name, i) => data.set(drawPattern(name), i * SIZE * SIZE * 2));
  STACK = new THREE.DataArrayTexture(data, SIZE, SIZE, PATTERN_NAMES.length);
  STACK.format = THREE.RGFormat; STACK.type = THREE.UnsignedByteType; STACK.wrapS = STACK.wrapT = THREE.RepeatWrapping; STACK.magFilter = THREE.LinearFilter; STACK.minFilter = THREE.LinearMipmapLinearFilter; STACK.generateMipmaps = true; STACK.colorSpace = THREE.NoColorSpace; STACK.needsUpdate = true;
  return STACK;
}
