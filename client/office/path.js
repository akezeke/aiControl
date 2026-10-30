// Ways round the furniture for whoever walks the floor (fruit coming and going, the goose): a grid of the spots a body as
// wide as you can stand on (player.js's free), A* across it, then straight lines wherever one is clear.
// Pure, so it runs under node --test.
import * as THREE from 'three';
import { free } from './player.js';

export const CELL = 0.25;
const STEPS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
const p = new THREE.Vector3();

// A cell is open when all four of its corners are free: the boxes (grown by the body's width) are wider than a cell, so then
// all of it is. ponytail: every corner against every box; the caller keeps the grid until the boxes change (gridKey).
export function walkGrid(colliders, room) {
  const cols = Math.ceil(room.width / CELL), rows = Math.ceil(room.depth / CELL), open = new Uint8Array(cols * rows), corners = new Uint8Array((cols + 1) * (rows + 1));
  for (let k = 0; k < corners.length; k++) corners[k] = free(p.set(k % (cols + 1) * CELL, 0, Math.floor(k / (cols + 1)) * CELL), colliders, room) ? 1 : 0;
  for (let k = 0; k < open.length; k++) { const c = k + Math.floor(k / cols); open[k] = corners[c] & corners[c + 1] & corners[c + cols + 1] & corners[c + cols + 2]; }
  return { cols, rows, open, key: gridKey(colliders, room) };
}
// Changes when a box or the room does (the room hands over a new list of the same boxes with every snapshot).
export const gridKey = (colliders, room) => `${room.width}x${room.depth}:${colliders.map(b => [b.min.x, b.min.z, b.max.x, b.max.z].map(v => v.toFixed(2)).join()).join(';')}`;

const index = (grid, at) => { const i = Math.floor(at.x / CELL), j = Math.floor(at.z / CELL); return i >= 0 && j >= 0 && i < grid.cols && j < grid.rows ? j * grid.cols + i : -1; };
const centre = (grid, k) => new THREE.Vector3((k % grid.cols + 0.5) * CELL, 0, (Math.floor(k / grid.cols) + 0.5) * CELL);
const clear = (grid, a, b) => {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (CELL / 3)));
  for (let t = 0; t <= n; t++) if (grid.open[index(grid, p.lerpVectors(a, b, t / n))] !== 1) return false;
  return true;
};

// The middle of the open cell nearest a point, ring by ring outwards; null if there's nowhere to stand.
export function nearestOpen(grid, at) {
  const { cols, rows, open } = grid, i = THREE.MathUtils.clamp(Math.floor(at.x / CELL), 0, cols - 1), j = THREE.MathUtils.clamp(Math.floor(at.z / CELL), 0, rows - 1);
  for (let r = 0; r < Math.max(cols, rows); r++) {
    let best = -1, bestD = Infinity;
    for (let b = Math.max(0, j - r); b <= Math.min(rows - 1, j + r); b++) for (let a = Math.max(0, i - r); a <= Math.min(cols - 1, i + r); a++) {
      const d = (a - i) ** 2 + (b - j) ** 2;
      if (Math.max(Math.abs(a - i), Math.abs(b - j)) === r && open[b * cols + a] && d < bestD) { best = b * cols + a; bestD = d; }
    }
    if (best >= 0) return centre(grid, best);
  }
  return null;
}

// Waypoints (y = 0) from `from` to `to`, ending exactly at `to`; either end may be inside something (a seat in its chair), which
// is left or reached through the nearest open cell. Null if there's no way through.
export function findPath(grid, from, to) {
  const start = nearestOpen(grid, from), end = nearestOpen(grid, to); if (!start || !end) return null;
  const { cols, rows, open } = grid, s = index(grid, start), e = index(grid, end), ei = e % cols, ej = (e - ei) / cols;
  const cost = new Float32Array(open.length).fill(Infinity), came = new Int32Array(open.length).fill(-1), done = new Uint8Array(open.length);
  const guess = k => { const dx = Math.abs(k % cols - ei), dz = Math.abs(Math.floor(k / cols) - ej); return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz); };
  // A binary heap of [estimate, cell]; a cell may be in it more than once, and only its first time out counts.
  const heap = [];
  const push = (k, f) => { heap.push([f, k]); for (let i = heap.length - 1, up; i && heap[up = (i - 1) >> 1][0] > heap[i][0]; i = up) [heap[up], heap[i]] = [heap[i], heap[up]]; };
  const pop = () => {
    const top = heap[0][1], last = heap.pop();
    if (heap.length) { heap[0] = last; for (let i = 0, m; ; i = m) { m = i; for (const c of [2 * i + 1, 2 * i + 2]) if (c < heap.length && heap[c][0] < heap[m][0]) m = c; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; } }
    return top;
  };
  cost[s] = 0; push(s, guess(s));
  while (heap.length) {
    const k = pop(); if (k === e) break; if (done[k]) continue; done[k] = 1;
    const i = k % cols, j = (k - i) / cols;
    for (const [di, dj, step] of STEPS) {
      const a = i + di, b = j + dj, n = b * cols + a;
      // A diagonal only between two open sides, so it never clips a corner.
      if (a < 0 || b < 0 || a >= cols || b >= rows || !open[n] || (di && dj && !(open[j * cols + a] && open[b * cols + i]))) continue;
      if (cost[k] + step < cost[n]) { cost[n] = cost[k] + step; came[n] = k; push(n, cost[n] + guess(n)); }
    }
  }
  if (cost[e] === Infinity) return null;
  const points = [to]; for (let k = e; k !== -1; k = came[k]) points.unshift(centre(grid, k));
  points.unshift(from);
  // Straight on to the furthest point in clear sight, rather than cell by cell.
  const path = [];
  for (let i = 0; i < points.length - 1;) {
    let j = i + 1; while (j + 1 < points.length && clear(grid, points[i], points[j + 1])) j++;
    path.push(points[j].clone().setY(0)); i = j;
  }
  return path;
}
