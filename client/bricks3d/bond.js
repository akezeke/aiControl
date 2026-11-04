// How real bricks are laid: pure arithmetic, no three.js, so the layout rules can be tested.
// Units are CSS pixels at the theme's one scale: a stud pitch is 20, a brick is 24 high and a plate 8 (real LEGO: 8, 9.6 and 3.2 mm).
export const STUD = 20, BRICK = 24, PLATE = 8;
// 1 x n bricks that exist; walls use only the common ones.
export const LENGTHS = [1, 2, 3, 4, 6, 8];
const WALL_LENGTHS = [4, 3, 2, 1];
// Smooth tiles for a face are laid long, so a line of text rarely crosses a joint.
export const FACE_LENGTHS = [8, 6, 4, 3, 2, 1];

export function rng(seed) {
  let a = seed | 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// One course of a wall n studs wide as brick lengths. `avoid` is the set of seams (stud positions) of the course below,
// which running bond keeps clear of wherever it can; the ends are always seams.
export function layCourse(n, random, avoid = new Set(), pool0 = WALL_LENGTHS) {
  let best;
  for (let attempt = 0; attempt < 24; attempt++) {
    const lengths = []; let at = 0;
    while (at < n) {
      const room = n - at, fits = pool0.filter(length => length <= room);
      const clear = fits.filter(length => at + length === n || !avoid.has(at + length));
      const pool = clear.length ? clear : fits, weights = pool.map(length => pool0 === WALL_LENGTHS ? (length === 2 ? 3 : length === 4 ? 2.5 : length === 3 ? 1.5 : .6) : length * length);
      let pick = random() * weights.reduce((a, b) => a + b, 0), chosen = pool[pool.length - 1];
      for (let i = 0; i < pool.length; i++) { pick -= weights[i]; if (pick <= 0) { chosen = pool[i]; break; } }
      lengths.push(chosen); at += chosen;
    }
    let seams = 0, at2 = 0; for (const length of lengths.slice(0, -1)) { at2 += length; if (avoid.has(at2)) seams++; }
    if (!best || seams < best.seams) best = { lengths, seams };
    if (!seams) break;
  }
  return best.lengths;
}

export const seamsOf = lengths => { const seams = new Set(); let at = 0; for (const length of lengths.slice(0, -1)) { at += length; seams.add(at); } return seams; };

// A wall of `rows` courses, each `cols` studs wide: [{ at, length }] per course, bottom course first.
export function layWall(cols, rows, seed = 1, pool = WALL_LENGTHS) {
  const random = rng(seed), wall = []; let below = new Set();
  for (let r = 0; r < rows; r++) {
    const lengths = layCourse(cols, random, below, pool); let at = 0;
    wall.push(lengths.map(length => { const brick = { at, length }; at += length; return brick; })); below = seamsOf(lengths);
  }
  return wall;
}

// A run of n studs as the fewest real bricks, longest first: 6 = 6, 5 = 3 + 2, 7 = 6 + 1 ...
export function runOf(n) {
  const out = []; let left = n;
  for (const length of [8, 6, 4, 3, 2, 1]) while (left >= length) { out.push(length); left -= length; }
  return out;
}

// A height as bricks (24) and plates (8) stacked: 56 = 2 bricks + 1 plate. Heights are whole plates.
export function stackOf(height) {
  const units = Math.max(1, Math.round(height / PLATE)), bricks = Math.floor(units / 3), plates = units - bricks * 3;
  return { bricks, plates, height: units * PLATE };
}

// A button's width in whole bricks: the smallest real brick that holds the label (1, 2, 3, 4, 6 or 8 studs).
export function buttonStuds(width) {
  const need = Math.max(1, Math.ceil((width - 1e-6) / STUD));
  return LENGTHS.find(length => length >= need) || 8;
}

export const snap = (value, unit = STUD) => Math.round(value / unit) * unit;
export const snapUp = (value, unit = STUD) => Math.ceil((value - 1e-6) / unit) * unit;

// Fill a rectangular surface without crossing its openings. Partly covered courses
// become plate courses, and openings round outward to the stud/plate grid.
export function masonry(width, height, openings = [], seed = 1) {
  const cols = Math.floor(width / STUD), rows = Math.floor(height / PLATE), random = rng(seed), pieces = [];
  const blocked = (c, r) => openings.some(h => c * STUD < h.x + h.w && (c + 1) * STUD > h.x && r * PLATE < h.y + h.h && (r + 1) * PLATE > h.y);
  let row = 0, below = new Set();
  while (row < rows) {
    const whole = row + 3 <= rows && Array.from({ length: cols }, (_, c) => blocked(c, row) === blocked(c, row + 1) && blocked(c, row) === blocked(c, row + 2)).every(Boolean);
    const count = whole ? 3 : 1, seams = new Set(); let col = 0;
    while (col < cols) {
      if (blocked(col, row)) { col++; continue; }
      const start = col; while (col < cols && !blocked(col, row)) col++;
      const avoid = new Set([...below].map(n => n - start)); let at = start;
      for (const length of layCourse(col - start, random, avoid)) {
        pieces.push({ x: at * STUD, y: row * PLATE, length, height: count * PLATE });
        at += length; if (at < col) seams.add(at);
      }
    }
    below = seams; row += count;
  }
  return pieces;
}

// A small movement keeps the rear of a button inside its opening on hover.
export const buttonHover = 3;
// At full pressure the brick is flush with the back regardless of hover.
export const buttonDepth = (hover, pressure) => (-10 + hover) * (1 - pressure) - 20 * pressure;
// Stable, restrained misalignment, bounded even on wide labels.
export function stickerPlacement(seed, width, height) {
  const random = rng(seed), limit = Math.min(.012, 2 / Math.max(width, height, 1));
  return { x: (random() - .5) * 1.4, y: (random() - .5) * 1.4, angle: (random() * 2 - 1) * limit };
}

// Meters use two-stud cells, rounded to the nearest visible coin.
export function meterCells(width, fill) {
  const count = Math.max(0, Math.floor(width / (2 * STUD))), used = Math.round(count * Math.max(0, Math.min(1, fill)));
  return Array.from({ length: count }, (_, i) => i < used);
}

// Children are mounted on their immediate tray's face, even through several levels.
export const surfaceBase = (lift, parentFace) => parentFace ?? lift;
