// Where the camera has to stand to see every spot in a fight, from a given direction. Pure, so its promise (nobody out of frame) can be tested.
export const FOV = 34;
export const PITCH = { low: 2 * Math.PI / 180, high: 55 * Math.PI / 180 };

// The view a fight opens on: three quarters from the party's side and a little above when wide, from behind the party's shoulder when tall.
export const homeView = aspect => aspect < 1 ? { yaw: 1.3, pitch: .62 } : { yaw: .5, pitch: .27 };

// A phone's tile is small, so it's framed on the party, from the side they're facing; whatever they're fighting takes what's left. A party of three or more with a roomy picture is seen from above instead, so nobody stands behind anybody.
export const PARTY_VIEW = { yaw: -.6, pitch: .26 };

// Every way to break the tiles, in order, into rows of at most `most` cells, a cell being one tile or, beside a bigger fight, a stack of smaller ones. Fullest rows first, so a tie leaves the short row last. Past eight fights nothing stacks, and past a dozen the rows are all as full as each other.
function* rowings(ask, most) {
  const n = ask.length, singles = ids => ids.map(i => [i]);
  if (n > 12) { for (let c = most; c >= 1; c--) yield Array.from({ length: Math.ceil(n / c) }, (_, r) => singles(Array.from({ length: Math.min(c, n - r * c) }, (_, k) => r * c + k))); return; }
  function* rowsAt(start, size) {
    const ids = Array.from({ length: size }, (_, k) => start + k);
    if (size <= most) yield singles(ids);
    if (n > 8) return;
    for (let a = 0; a < size - 1; a++) for (let b = a + 2; b <= size; b++) {
      const cells = size - (b - a) + 1, stack = ids.slice(a, b), tallest = Math.max(...stack.map(i => ask[i]));
      if (cells >= 2 && cells <= most && [...ids.slice(0, a), ...ids.slice(b)].some(i => ask[i] > tallest)) yield [...singles(ids.slice(0, a)), stack, ...singles(ids.slice(b))];
    }
  }
  function* from(start) {
    if (start === n) { yield []; return; }
    for (let size = n - start; size >= 1; size--) for (const row of rowsAt(start, size)) for (const rest of from(start + size)) yield [row, ...rest];
  }
  yield* from(0);
}

// `room` shared by `wants`, none under `least`.
function share(wants, room, least) {
  const out = Array(wants.length);
  let free = wants.map((_, c) => c);
  for (;;) {
    const sum = free.reduce((s, c) => s + wants[c], 0), under = free.filter(c => room * wants[c] / sum < least);
    if (!under.length) { for (const c of free) out[c] = room * wants[c] / sum; return out; }
    for (const c of under) { out[c] = least; room -= least; }
    free = free.filter(c => !under.includes(c));
  }
}

// How to lay out the tiles. A fight asks for room by the square root of its party, so four sessions ask twice the width and height of one. A fight is worth what a battle-shaped box in its picture (above its session list) is worth, for what it asks; the layout drawing its worst-off fight largest wins, then the one sharing the area most evenly, and having to scroll is worth less. Scrolling, a bigger party keeps a taller picture, never so tall the next tile can't show.
// `units` is the grid's columns and `tracks` its rows' heights, as shares when it all fits; each tile has its `row` and `column` lines and the least picture (`fight`) it keeps, 0 for the usual. A session list is `frame` and a `line` per row of `chip`-wide chips.
export function tileLayout(parties, width, height, { gap = 8, fight = 170, narrowest = 398, chip = 262, line = 39, frame = 14, units = 60 } = {}) {
  const n = parties.length;
  if (!n) return { units: 1, tracks: [], tiles: [], scroll: false };
  const ask = parties.map(count => Math.sqrt(Math.max(1, count))), most = Math.max(1, Math.floor((width + gap) / (narrowest + gap)));
  const list = (i, w) => frame + line * Math.ceil(Math.max(1, parties[i]) / Math.max(1, Math.floor((w - 6) / chip)));
  let best = null;
  for (const rows of rowings(ask, most)) {
    const plan = place(rows);
    if (plan && (!best || plan.worth > best.worth * 1.01 || (plan.worth > best.worth * .99 && plan.even > best.even + 1e-6))) best = plan;
  }
  return best.layout;

  function place(rows) {
    // Each cell's width follows its biggest fight; each tile's session list follows its width.
    const wide = Array(n), chips = Array(n), geo = [];
    for (const cells of rows) {
      const wants = cells.map(cell => Math.max(...cell.map(i => ask[i]))), widths = share(wants, width - (cells.length - 1) * gap, cells.length > 1 ? narrowest : 0);
      cells.forEach((cell, c) => { for (const i of cell) { wide[i] = widths[c]; chips[i] = list(i, wide[i]); } });
      geo.push({ cells, wants, widths, stack: cells.find(cell => cell.length > 1) });
    }
    // How tall a row has to be for each fight in it to keep `keep(i)` of picture; `worth(t)` keeps what makes every fight worth `t`.
    const need = (row, keep) => Math.max(...row.cells.map(cell => cell.reduce((h, i) => h + keep(i) + chips[i], (cell.length - 1) * gap)));
    const total = keep => geo.reduce((h, row) => h + need(row, keep), (geo.length - 1) * gap);
    const worth = t => i => Math.max(fight, t * ask[i] / 1.6);
    const scroll = total(worth(0)) > height;
    if (scroll && geo.some(row => row.stack)) return null;
    let keep = i => Math.min(fight * ask[i], Math.max(fight, height * .75 - chips[i]));
    if (!scroll) {
      let lo = 0, hi = Math.min(...geo.flatMap(row => row.widths.map((w, c) => w / row.wants[c])));
      if (total(worth(hi)) <= height) lo = hi;
      else for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (total(worth(mid)) > height) hi = mid; else lo = mid; }
      keep = worth(lo);
    }
    // A row is a track, or a track per tile of its stack, sharing the row's height.
    const tracks = [], lines = Array(n);
    for (const row of geo) {
      const tall = need(row, keep), first = tracks.length + 1;
      if (row.stack) { const each = row.stack.map(i => keep(i) + chips[i]), sum = each.reduce((a, b) => a + b); each.forEach(h => tracks.push(h * (tall - (row.stack.length - 1) * gap) / sum)); }
      else tracks.push(tall);
      for (const cell of row.cells) cell.forEach((i, k) => { lines[i] = cell.length > 1 ? [first + k, first + k + 1] : [first, tracks.length + 1]; });
    }
    // What fits stretches to fill, as the grid will stretch it.
    const stretch = scroll ? 1 : (height - (tracks.length - 1) * gap) / tracks.reduce((a, b) => a + b), across = geo.some(row => row.cells.length > 1) ? units : 1;
    const tallOf = ([a, b]) => tracks.slice(a - 1, b - 1).reduce((h, t) => h + t * stretch, (b - a - 1) * gap);
    const tiles = Array(n);
    for (const row of geo) {
      // Each cell's share of the columns, rounded so they add up.
      const exact = row.widths.map(w => across * (w + gap) / (width + gap)), cols = exact.map(x => Math.floor(x));
      for (const c of exact.map((x, c) => c).sort((a, b) => (exact[b] - cols[b]) - (exact[a] - cols[a])).slice(0, across - cols.reduce((a, b) => a + b))) cols[c]++;
      let at = 1;
      row.cells.forEach((cell, c) => { for (const i of cell) tiles[i] = { row: lines[i], column: [at, at + cols[c]], fight: scroll && keep(i) > fight ? keep(i) : 0 }; at += cols[c]; });
    }
    const worths = tiles.map((tile, i) => Math.min(wide[i], (tallOf(tile.row) - chips[i]) * 1.6) / ask[i]), areas = tiles.map((tile, i) => wide[i] * tallOf(tile.row) / ask[i] ** 2);
    return { worth: Math.min(...worths) * (scroll ? .8 : 1), even: Math.min(...areas) / Math.max(...areas), layout: { units: across, tracks: tracks.map(h => h * stretch), tiles, scroll } };
  }
}

// `clear` is the share of the view's height taken from the bottom by windows.
export function fit({ spots, aspect, yaw, pitch, clear = 0, fov = FOV, margin = 1.04 }) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const right = [cy, 0, -sy], back = [sy * cp, sp, cy * cp], up = [back[1] * right[2] - back[2] * right[1], back[2] * right[0] - back[0] * right[2], back[0] * right[1] - back[1] * right[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let loX = Infinity, hiX = -Infinity, loY = Infinity, hiY = -Infinity, loZ = Infinity, hiZ = -Infinity;
  for (const spot of spots) {
    const x = dot(spot, right), y = dot(spot, up), z = dot(spot, back);
    loX = Math.min(loX, x); hiX = Math.max(hiX, x); loY = Math.min(loY, y); hiY = Math.max(hiY, y); loZ = Math.min(loZ, z); hiZ = Math.max(hiZ, z);
  }
  const midX = (loX + hiX) / 2, midY = (loY + hiY) / 2, midZ = (loZ + hiZ) / 2, tanV = Math.tan(fov * Math.PI / 360) * Math.max(.2, 1 - clear), tanH = Math.tan(fov * Math.PI / 360) * aspect;
  // The nearest spots are the tightest, so each is held to the frame at its own depth.
  let distance = 1;
  for (const spot of spots) distance = Math.max(distance, Math.abs(dot(spot, right) - midX) / tanH + dot(spot, back) - midZ, Math.abs(dot(spot, up) - midY) / tanV + dot(spot, back) - midZ);
  distance *= margin;
  const target = [0, 1, 2].map(i => right[i] * midX + up[i] * midY + back[i] * midZ);
  return { target, back, up, right, distance, position: target.map((v, i) => v + back[i] * distance) };
}

// Everyone's corners: where they stand and how far they reach, as a stable set that doesn't move with whatever's alive this second.
export function spotsFor({ party, enemies, widths = [], tall = 3.1 }) {
  const spots = [], add = ([x, , z], wide, deep, tall) => { for (const dx of [-wide, wide]) for (const dz of [-deep, deep]) for (const y of [0, tall]) spots.push([x + dx, y, z + dz]); };
  for (const at of party) add(at, 1.3, 1.2, tall);
  // Nobody across from them takes no room, so a rank at rest doesn't hold the camera back for an empty stretch of field.
  enemies.forEach((at, i) => { const half = (widths[i] ?? 3.6) / 2; if (half > 0) add(at, half * .6 + 1.2, half * .8 + .6, 4.3); });
  return spots.length ? spots : [[-3, 0, 0], [3, 3, 0]];
}

// Where a sprite lands in a `w` by `h` frame, counted from its top left: three's own sums for a sprite, so another layer can draw it in the same place. Null behind the camera.
export function spriteBox(sprite, camera, w, h) {
  const { x, y, z } = sprite.position, v = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements;
  const vx = v[0] * x + v[4] * y + v[8] * z + v[12], vy = v[1] * x + v[5] * y + v[9] * z + v[13], depth = -(v[2] * x + v[6] * y + v[10] * z + v[14]);
  if (depth <= 0) return null;
  // The two matrix terms beyond the plain scale are the view offset.
  const ax = (p[0] * vx - p[8] * depth) / depth, ay = (p[5] * vy - p[9] * depth) / depth, wide = sprite.scale.x * p[0] / depth * w / 2, tall = sprite.scale.y * p[5] / depth * h / 2;
  return { left: (ax + 1) / 2 * w - sprite.center.x * wide, top: (1 - ay) / 2 * h - (1 - sprite.center.y) * tall, wide, tall };
}
