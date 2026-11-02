import { glow, hash, maskPixels, painter, pixelAt, sparkle } from './pixels.js';

// Heroes: the sunset valley comes alive the way a 1990s town screen did. Flags wave on the castle,
// the river glitters, waterfalls run, the sunset's colours cycle and a few birds cross.
// Coordinates are in the wallpaper's own pixels (1672 x 941) and are divided down to the canvas grid; painters never touch the interface.
const G = 4, q = v => Math.round(v / G);
const rgb = ([r, g, b]) => `rgb(${r},${g},${b})`;

// Each flag: the box its cloth sweeps, where to copy the surrounding sky from to cover the painted cloth, and how far it waves.
const FLAGS = [
  { box: [1418, 34, 1492, 78], from: 'right', amp: 1.6 },
  { box: [1480, 145, 1530, 186], from: 'right', amp: 1.3 },
  { box: [1252, 222, 1298, 258], from: 'up', amp: 1.3 },
  { box: [1146, 391, 1180, 418], from: 'right', amp: 1.1 },
  { box: [1018, 464, 1055, 496], from: 'right', amp: 1.1 },
  { box: [1631, 294, 1667, 324], from: 'up', amp: 1.1 },
];
// Falls: search box, and where the water meets the river below.
const FALLS = [
  { box: [340, 525, 425, 622], foot: [388, 612] },
  { box: [1050, 590, 1146, 795], foot: [1092, 790] },
  { box: [345, 262, 380, 376], foot: [362, 372] },
];
const LANES = 16;
const SUN = [q(1073), q(290)];
const CLOTH = { edge: '#0a1752', body: '#1c40d8', light: '#5b86ff', shade: '#1230a8' };

function prepareFlag({ box, from, amp }, sample) {
  const x0 = q(box[0]), y0 = q(box[1]), x1 = q(box[2]), y1 = q(box[3]), w = x1 - x0, h = y1 - y0;
  const dx = from === 'right' ? w + 1 : 0, dy = from === 'up' ? -h - 1 : 0;
  const rows = [];
  for (let y = 0; y < h; y++) {
    let run = null;
    for (let x = 0; x <= w; x++) {
      const color = x < w ? rgb(pixelAt(sample, x0 + x + dx, y0 + y + dy)) : null;
      if (run && run.color === color) { run.w++; continue; }
      if (run) rows.push(run);
      run = color ? { x: x0 + x, y: y0 + y, w: 1, color } : null;
    }
  }
  return { x: x0, y: y0 + 1, w, h, amp, rows };
}

function drawFlag(rect, flag, t, k) {
  for (const run of flag.rows) rect(run.x, run.y, run.w, 1, run.color);
  const gust = .8 + .2 * Math.sin(t * .5 + k * 2), length = flag.w;
  for (let i = 0; i < length; i++) {
    const phase = i * .4 - t * 4.2 + k * 1.7, reach = Math.min(1, i / 4);
    let top = flag.y + Math.round(Math.sin(phase) * flag.amp * gust * reach + i * .1), rows = 5;
    if (i >= length - 2) { rows = 4; top += 1; }
    rect(flag.x + i, top, 1, 1, CLOTH.edge);
    rect(flag.x + i, top + rows - 1, 1, 1, CLOTH.edge);
    const lit = Math.cos(phase) > .45;
    for (let r = 1; r < rows - 1; r++) rect(flag.x + i, top + r, 1, 1, lit ? CLOTH.light : r === rows - 2 ? CLOTH.shade : CLOTH.body);
    if (i === 0 || i === length - 1) rect(flag.x + i, top + 1, 1, rows - 2, CLOTH.edge);
  }
}

const BIRDS = [[44, 6.5, 0], [52, 5, 130], [66, 4, 40], [38, 7.5, 260]];
const BIRD_SHAPES = [[[0, 0], [2, 0], [1, 1]], [[0, 1], [1, 1], [2, 1]], [[1, 0], [0, 1], [2, 1]], [[0, 1], [1, 1], [2, 1]]];

export function createPainter(sample) {
  const flags = FLAGS.map(flag => prepareFlag(flag, sample));
  // River: blue pixels below the far bank and left of the castle, and the sun's gold road across it.
  const water = maskPixels(sample, [0, q(585), q(1000), sample.h], (r, g, b) => b > 100 && b > r * 1.5 && b >= g * 1.1);
  const road = maskPixels(sample, [q(780), q(600), q(890), sample.h], (r, g, b) => r > 190 && g > 120 && b < 160);
  const bands = new Map();
  for (const index of water) { const y = Math.floor(index / sample.w), x = index % sample.w; (bands.get(y) || bands.set(y, []).get(y)).push(x); }
  const spans = [...bands].map(([y, xs]) => {
    const out = []; let start = xs[0], prev = xs[0];
    for (const x of [...xs.slice(1), Infinity]) { if (x !== prev + 1) { if (prev - start >= 3) out.push([start, prev - start + 1]); start = x; } prev = x; }
    return [y, out];
  });
  // Sunset colour cycling: warm sky pixels brighten as a slow diagonal band passes, as palette-cycled art once did.
  const sky = maskPixels(sample, [0, 0, sample.w, q(420)], (r, g, b, x, y) => r > 205 && g > 105 && r - b > 95 && (x < q(1225) || (x > q(1560) && y < q(130))));
  const lanes = Array.from({ length: LANES }, () => []);
  for (const index of sky) { const x = index % sample.w, y = Math.floor(index / sample.w); lanes[Math.floor((x * .7 + y * 1.3) % LANES + LANES) % LANES].push(index); }
  const falls = FALLS.map(({ box, foot }) => ({
    foot: [q(foot[0]), q(foot[1])],
    pixels: maskPixels(sample, box.map(q), (r, g, b) => Math.min(r, g, b) > 130 && b > r + 8),
  }));

  return function frame(ctx, t) {
    const rect = painter(ctx), head = (t * 2.4) % LANES;
    lanes.forEach((lane, i) => {
      const behind = (head - i + LANES) % LANES;
      if (behind >= 2.5) return;
      const color = behind < 1.2 ? '#fff4c0' : '#8a3d2c', alpha = behind < 1.2 ? .34 : .16;
      for (const index of lane) rect(index % sample.w, Math.floor(index / sample.w), 1, 1, color, alpha);
    });

    glow(ctx, SUN[0], SUN[1], 15, '#ffb050', .2 + .05 * Math.sin(t * 1.3));
    const beam = (t % 5) / 5;
    if (beam < .16) { const a = beam < .08 ? 1 : .5, n = beam < .08 ? 5 : 3; rect(SUN[0] - n, SUN[1], n * 2 + 1, 1, '#fff6cc', a); rect(SUN[0], SUN[1] - n, 1, n * 2 + 1, '#fff6cc', a); }

    flags.forEach((flag, k) => drawFlag(rect, flag, t, k));

    for (const [y, row] of spans) {
      const slow = Math.floor(t * 1.5), fast = Math.floor(t * 1);
      if ((y + slow) % 11 === 0) for (const [x, w] of row) rect(x, y, w, 1, '#9fc4ff', .14);
      else if ((y * 2 - fast) % 13 === 0) for (const [x, w] of row) rect(x, y, w, 1, '#0a2a6a', .18);
    }
    sparkle(rect, water, sample.w, t, 40, 1.3, '#dff0ff', 11);
    sparkle(rect, road, sample.w, t, 36, .9, '#fff2b8', 29);

    falls.forEach((fall, k) => drawFall(rect, fall, sample.w, t, k));

    BIRDS.forEach(([y, speed, offset], k) => {
      const x = ((t * speed + offset) % (sample.w + 30)) - 15, frameIndex = [0, 1, 2, 1][Math.floor(t * 5 + k) & 3], by = y + Math.round(Math.sin(t * .8 + k * 2) * 2);
      for (const [dx, dy] of BIRD_SHAPES[frameIndex]) rect(Math.round(x) + dx, by + dy, 1, 1, '#2a1f45');
    });
  };
}

function drawFall(rect, { pixels, foot }, width, t, k) {
  const phase = i => ((Math.floor(i / width) * 1 - t * 15 + hash(i % width, k) * 9) % 8 + 8) % 8;
  for (const i of pixels) if (phase(i) < 1.6) rect(i % width, Math.floor(i / width), 1, 1, '#ffffff', .85);
  for (const i of pixels) if (phase(i) >= 4.2 && phase(i) < 6) rect(i % width, Math.floor(i / width), 1, 1, '#4a86d2', .5);
  const [fx, fy] = foot;
  for (let s = 0; s < 9; s++) {
    const p = .55 + hash(s, k, 3) * .6, u = (t / p + hash(s, k, 4)) % 1, spread = (hash(s, k, 5) - .5) * 14;
    rect(Math.round(fx + spread * u), Math.round(fy - Math.sin(u * Math.PI) * (3 + hash(s, k, 6) * 4)), 1, 1, '#f2fbff', 1 - u * .6);
  }
  for (let x = -5; x <= 5; x++) if (hash(x + 9, Math.floor(t * 6), k) > .55) rect(fx + x, fy + 1, 1, 1, '#e8f6ff', .8);
}
