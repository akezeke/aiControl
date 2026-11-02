import { bayer, hash } from './pixels.js';

// Metropolis by night, going up: the wallpaper behind the list. It is drawn in code so that the painter (city.js)
// knows where every crane, lamp and weld is; scripts/city-art.mjs renders it to client/public/city-bg.png, which is
// all that reduced-motion users see. Coordinates are in the wallpaper's own pixels.
export const W = 480, H = 270, GROUND = 240, FLOOR = 10, FENCE = 252;

// Tower cranes: mast, jib height, the jib's reach and the counter-jib's end, and their paint.
export const CRANES = [
  { x: 70, y: 34, reach: 214, back: 46, paint: '#f4b81a', shade: '#a86a10' },
  { x: 398, y: 50, reach: 280, back: 424, paint: '#fb6b1d', shade: '#9e4539' },
];
// Towers going up: left edge, width, floors poured in concrete, and floors framed in steel above them.
export const SITES = [
  { x: 136, w: 66, poured: 6, framed: 4 },
  { x: 292, w: 54, poured: 9, framed: 4 },
  { x: 410, w: 46, poured: 4, framed: 3 },
];
const topOf = site => GROUND - (site.poured + site.framed) * FLOOR;
// Where the steel is being welded: two joints high on each frame.
export const WELDS = SITES.flatMap((s, i) => [[s.x + 8 + (i * 16) % (s.w - 24), topOf(s) + FLOOR], [s.x + s.w - 9, topOf(s) + FLOOR * 2]]);
// Floodlights' heads, and the lamps along the top of the hoarding.
export const FLOODS = [[238, 150], [468, 166]];
export const LAMPS = Array.from({ length: 8 }, (_, i) => [28 + i * 62, FENCE - 6]);
export const MOON = [436, 30, 9];

const SKY = ['#14161b', '#191c22', '#1f232b', '#262a33', '#2e303b', '#38363f', '#433b3f', '#4f4240'];
const STAR = (x, y) => y < 150 && hash(x, y, 7) < .004;
export const stars = () => { const out = []; for (let y = 0; y < 150; y++) for (let x = 0; x < W; x++) if (STAR(x, y)) out.push([x, y]); return out; };
// The two rows of towers behind the site: the far one paler and plainer, the near one darker, taller and lit.
const ROWS = [{ salt: 1, colour: '#2b2b33', low: 22, high: 70, lit: .1, wide: 22 }, { salt: 2, colour: '#1d1f26', low: 34, high: 118, lit: .24, wide: 34 }];
export function skyline() {
  const out = [];
  for (const row of ROWS) for (let x = -4, k = 0; x < W; k++) {
    const w = 10 + Math.floor(hash(k, row.salt, 1) * row.wide), h = row.low + Math.floor(hash(k, row.salt, 2) ** 1.6 * (row.high - row.low));
    out.push({ ...row, x, w, h, top: GROUND - h });
    x += w + (hash(k, row.salt, 4) < .3 ? 3 : 0);
  }
  return out;
}
// The tallest near towers carry a red light on a mast; the painter blinks them.
export const towerLights = skyline().filter(tower => tower.salt === 2 && tower.h > 80).map(tower => [tower.x + Math.floor(tower.w / 2), tower.top - 8]);

const rgb = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

// Draws the still into an RGBA buffer of W x H.
export function drawStill(data) {
  const put = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; data.set([...(typeof c === 'string' ? rgb(c) : c), 255], (y * W + x) * 4); };
  const get = (x, y) => [...data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];
  const rect = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) put(i, j, c); };
  const line = (x0, y0, x1, y1, c) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let k = 0; k <= n; k++) put(Math.round(x0 + (x1 - x0) * k / n), Math.round(y0 + (y1 - y0) * k / n), c); };

  // Sky, dithered down to the glow the city puts on the haze; stars; the moon.
  for (let y = 0; y < GROUND; y++) for (let x = 0; x < W; x++) {
    const at = y / GROUND * (SKY.length - 1), band = Math.floor(at);
    put(x, y, STAR(x, y) ? (hash(x, y, 8) < .3 ? '#c7dcd0' : '#7d8494') : SKY[Math.min(SKY.length - 1, band + (bayer(x, y) < at - band ? 1 : 0))]);
  }
  const [mx, my, mr] = MOON;
  for (let y = -mr - 3; y <= mr + 3; y++) for (let x = -mr - 3; x <= mr + 3; x++) {
    const d = Math.hypot(x, y);
    if (d <= mr) put(mx + x, my + y, x + y > mr * .6 ? '#b9b39f' : hash(mx + x, my + y, 9) < .08 ? '#a7a08b' : '#d9d4c3');
    else if (d <= mr + 3 && bayer(mx + x, my + y) < .35 * (mr + 3 - d) / 3) put(mx + x, my + y, '#2c3038');
  }

  for (const { salt, colour, lit, x, w, h, top } of skyline()) {
    rect(x, top, w, h, colour);
    for (let wy = top + 3; wy < GROUND - 2; wy += 3) for (let wx = x + 2; wx < x + w - 1; wx += salt === 1 ? 3 : 2) {
      const on = hash(wx, wy, salt + 3) < lit;
      if (salt === 1) { if (on) put(wx, wy, '#6f6450'); continue; }
      put(wx, wy, on ? ['#e0b45a', '#c99a48', '#9fb6c4'][Math.floor(hash(wx, wy, 6) * 3)] : '#262930');
    }
    if (salt === 2 && h > 80) { const ax = x + Math.floor(w / 2); rect(ax, top - 7, 1, 7, colour); put(ax, top - 8, '#5a2020'); }
  }

  // Cranes: lattice mast on a concrete base, cab, jib and counter-jib with its weights, the A-frame and its ties.
  for (const c of CRANES) {
    const dir = Math.sign(c.reach - c.x), [j0, j1] = [Math.min(c.x, c.reach), Math.max(c.x + 5, c.reach)], [b0, b1] = [Math.min(c.x, c.back), Math.max(c.x + 5, c.back)];
    rect(c.x - 3, GROUND - 4, 12, 4, '#5d5b56');
    for (let y = c.y + 4; y < GROUND - 4; y++) {
      put(c.x, y, c.paint); put(c.x + 5, y, c.paint);
      const d = (y - c.y) % 10; if (d === 0) rect(c.x + 1, y, 4, 1, c.paint); else put(c.x + 1 + Math.min(3, d < 5 ? d - 1 : 9 - d), y, c.shade);
    }
    for (let x = j0; x <= j1; x++) { put(x, c.y, c.paint); put(x, c.y + 3, c.paint); const d = ((x - j0) % 6 + 6) % 6; put(x, c.y + 1 + (d < 3 ? Math.min(1, d) : d > 4 ? 0 : 1), c.shade); }
    for (let x = b0; x <= b1; x++) { put(x, c.y + 1, c.paint); put(x, c.y + 3, c.paint); if (x % 3 === 0) put(x, c.y + 2, c.shade); }
    const wx = dir > 0 ? b0 : b1 - 6; rect(wx, c.y + 4, 7, 7, '#5d5b56'); rect(wx, c.y + 9, 7, 2, '#47453f'); rect(wx, c.y + 6, 7, 1, '#47453f');
    rect(c.x - 2, c.y + 4, 10, 2, c.shade);
    const cab = dir > 0 ? c.x + 6 : c.x - 6; rect(cab, c.y + 5, 6, 5, '#d9d4c3'); rect(cab + 1, c.y + 6, 4, 2, '#e0b45a'); rect(cab, c.y + 9, 6, 1, '#9b968a');
    line(c.x, c.y, c.x + 2, c.y - 11, c.paint); line(c.x + 5, c.y, c.x + 3, c.y - 11, c.paint); rect(c.x + 2, c.y - 12, 2, 1, c.paint);
    line(c.x + 2, c.y - 12, Math.round(c.x + (c.reach - c.x) * .62), c.y, '#6b6f70'); line(c.x + 3, c.y - 12, c.back, c.y + 1, '#6b6f70');
    put(c.x + 2, c.y - 13, '#5a2020'); put(c.reach, c.y - 1, '#5a2020');
  }

  // Towers going up: concrete floors with their openings and scaffold, then bare steel, the top floor unfinished.
  for (const [i, s] of SITES.entries()) {
    const poured = GROUND - s.poured * FLOOR, top = topOf(s);
    rect(s.x, poured, s.w, GROUND - poured, '#5d5b56'); rect(s.x + s.w - 4, poured, 4, GROUND - poured, '#4c4a45');
    for (let y = poured; y < GROUND; y += FLOOR) {
      rect(s.x, y, s.w, 1, '#77746c'); rect(s.x, y + 1, s.w, 1, '#47453f');
      for (let x = s.x + 2; x < s.x + s.w - 6; x += 8) {
        rect(x + 1, y + 3, 6, 5, '#25231f');
        if (hash(x, y, 11) < .18) { rect(x + 2, y + 6, 4, 2, '#4a3b22'); put(x + 3 + Math.floor(hash(x, y, 12) * 2), y + 4, '#e8c77a'); }
      }
    }
    for (let f = 0; f < s.framed; f++) {
      const y = poured - (f + 1) * FLOOR, last = f === s.framed - 1, end = last ? s.x + Math.floor(s.w * (.45 + hash(i, 3) * .25)) : s.x + s.w;
      for (let x = s.x; x < (last ? end + 1 : s.x + s.w); x += 8) { rect(x, y, 1, FLOOR, '#b4563f'); rect(x + 1, y, 1, FLOOR, '#8a3d30'); }
      rect(s.x, y, end - s.x, 2, '#8a3d30'); rect(s.x, y + 2, end - s.x, 1, '#5a2a24');
      const bay = s.x + 8 * Math.floor(hash(i, f, 5) * (s.w / 8 - 1));
      if (!last) { line(bay + 2, y + 3, bay + 7, y + FLOOR - 1, '#6e3029'); line(bay + 7, y + 3, bay + 2, y + FLOOR - 1, '#6e3029'); }
    }
    rect(s.x, poured - 1, s.w, 1, '#8a3d30');
    const sx = s.x + s.w;
    for (let y = poured - FLOOR; y < GROUND; y++) {
      put(sx + 1, y, '#8d9497'); put(sx + 6, y, '#8d9497');
      if ((y - poured) % 5 === 0) rect(sx + 1, y, 6, 1, '#8d9497'); else for (let x = sx + 2; x < sx + 6; x++) if (bayer(x, y) < .35) put(x, y, '#33493c');
      if ((y - poured) % FLOOR === 0) rect(sx, y, 8, 2, '#a07a4a');
    }
  }

  // The ground, floodlit; a stack of beams and cones; the site cabin.
  for (let y = GROUND; y < H; y++) for (let x = 0; x < W; x++) { const n = hash(x, y, 13); put(x, y, n < .08 ? '#2e2b27' : n > .94 ? '#1c1a18' : '#24221f'); }
  for (let k = 0; k < 3; k++) { rect(196 + k * 2, GROUND - 2 - k * 3, 40 - k * 4, 2, '#8a3d30'); rect(196 + k * 2, GROUND - 3 - k * 3, 40 - k * 4, 1, '#b4563f'); rect(196 + k * 2, GROUND - 2 - k * 3, 1, 2, '#5a2a24'); }
  for (const cx of [252, 262, 286]) { rect(cx, GROUND - 5, 3, 5, '#fb6b1d'); rect(cx, GROUND - 3, 3, 1, '#e3e6dc'); rect(cx - 1, GROUND - 1, 5, 1, '#9e4539'); }
  rect(420, 226, 50, 26, '#6b6f70'); rect(420, 224, 50, 2, '#3d4143'); rect(420, 246, 50, 6, '#4f5354');
  rect(428, 231, 12, 6, '#3d4143'); rect(429, 232, 10, 4, '#fbb954'); rect(452, 231, 7, 15, '#4f5354'); rect(457, 238, 1, 2, '#9b968a');
  for (const [fx, fy] of FLOODS) {
    rect(fx, fy + 3, 2, GROUND - fy - 3, '#47453f'); rect(fx - 2, fy, 6, 3, '#d9d4c3'); rect(fx - 2, fy + 2, 6, 1, '#fbff86');
    for (let y = fy + 4; y < H; y++) {
      const reach = y - fy, half = Math.round(reach * .55);
      for (let x = fx + 1 - half; x <= fx + 1 + half; x++) {
        const fade = (1 - reach / (H - fy)) * (1 - Math.abs(x - fx - 1) / (half + 1));
        if (x < 0 || x >= W || bayer(x, y) >= fade * .7) continue;
        const [r, g, b] = get(x, y); put(x, y, [Math.min(255, r * 1.16 + 22), Math.min(255, g * 1.14 + 18), Math.min(255, b * 1.08 + 8)]);
      }
    }
  }

  // The hoarding: poured panels with their tie holes, a hazard band and a lamp every few panels.
  for (let y = FENCE; y < H; y++) for (let x = 0; x < W; x++) put(x, y, x % 32 === 0 ? '#3d3b36' : x % 32 === 1 ? '#57534c' : (y - FENCE) % 7 === 4 && x % 8 === 4 ? '#2e2c28' : '#4d4a44');
  rect(0, FENCE - 1, W, 1, '#2c3032');
  for (let y = FENCE - 4; y < FENCE - 1; y++) for (let x = 0; x < W; x++) put(x, y, (x + y) % 8 < 4 ? '#f4b81a' : '#1d1f20');
  for (const [lx, ly] of LAMPS) { rect(lx, ly + 2, 1, 2, '#2c3032'); rect(lx - 1, ly, 3, 2, '#7a4b10'); }
}
