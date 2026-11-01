// The Fantasy windows' PS1 pixels: 9-slice frames, the bubble's tail, a 4×4 Bayer dither tile, the bar's marks, the hand and the sidebar's world map, as tiny SVGs drawn at 2 CSS px a pixel.
// node scripts/fantasy-frames.mjs writes them into client/public/fantasy.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WORLD, SITES } from '../client/fantasy/worldmap.js';

const OUT = fileURLToPath(new URL('../client/public/fantasy/', import.meta.url));

// One path per colour, a rectangle per run of pixels in a row.
function svg(width, height, pixels) {
  const byColor = new Map();
  for (const [at, color] of pixels) { const [x, y] = at.split(',').map(Number); if (!byColor.has(color)) byColor.set(color, new Map()); const rows = byColor.get(color); if (!rows.has(y)) rows.set(y, []); rows.get(y).push(x); }
  const paths = [...byColor].map(([color, rows]) => {
    let d = '';
    for (const [y, xs] of [...rows].sort((a, b) => a[0] - b[0])) {
      xs.sort((a, b) => a - b);
      for (let i = 0; i < xs.length;) { let j = i; while (xs[j + 1] === xs[j] + 1) j++; d += `M${xs[i]} ${y}h${j - i + 1}v1h-${j - i + 1}z`; i = j + 1; }
    }
    return `<path fill="${color}" d="${d}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" shape-rendering="crispEdges">${paths.join('')}</svg>\n`;
}

// `bands` run outside in, each one colour or one a side; `cut` is how many pixels a corner steps in; `shadow` adds a row under it all.
// It's sliced at the bands' width (the shadow row too at the bottom), leaving one pixel in the middle to stretch.
function frame({ bands, cut, shadow }) {
  const t = bands.length, W = 2 * t + 1, body = W, H = body + (shadow ? 1 : 0), pixels = new Map();
  const depth = (x, y) => y < 0 || y >= body ? -1 : Math.min(x, y, W - 1 - x, body - 1 - y, x + y - cut, W - 1 - x + y - cut, x + body - 1 - y - cut, W - 1 - x + body - 1 - y - cut);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = depth(x, y);
    if (d < 0) { if (shadow && depth(x, y - 1) >= 0) pixels.set(`${x},${y}`, shadow); continue; }
    if (d >= t) continue;
    const near = { top: y, left: x, right: W - 1 - x, bottom: body - 1 - y }, side = Object.keys(near).reduce((a, k) => near[k] < near[a] ? k : a, 'top');
    pixels.set(`${x},${y}`, typeof bands[d] === 'string' ? bands[d] : bands[d][side]);
  }
  return svg(W, H, pixels);
}

const OUTLINE = '#000000c8', SHADOW = '#00000070';
const raised = (lit, dim) => [OUTLINE, lit, dim];
const files = {
  // A window: a dark outline, a bright edge, a dim one inside, lit from the top left.
  'frame.svg': frame({ bands: raised({ top: '#f4f2ea', left: '#dcdcd2', right: '#9a9c92', bottom: '#7d7f76' }, { top: '#9fa197', left: '#8f9188', right: '#62645c', bottom: '#53554e' }), cut: 2, shadow: SHADOW }),
  'frame-hi.svg': frame({ bands: raised({ top: '#ffffff', left: '#f4f4ee', right: '#c8c8c0', bottom: '#a8a8a0' }, { top: '#c4c6bc', left: '#b8bab0', right: '#86887f', bottom: '#73756d' }), cut: 2, shadow: SHADOW }),
  'frame-gold.svg': frame({ bands: raised({ top: '#fff3b0', left: '#f2d76e', right: '#b8901e', bottom: '#8a6c14' }, { top: '#d0a83a', left: '#c49a2c', right: '#7e6210', bottom: '#5e4a0c' }), cut: 2, shadow: SHADOW }),
  'frame-ember.svg': frame({ bands: raised({ top: '#ffe08a', left: '#ffe08a', right: '#b4611d', bottom: '#8a3d10' }, { top: '#d0902e', left: '#c88428', right: '#7e3a10', bottom: '#5e2a0a' }), cut: 2, shadow: SHADOW }),
  // A field set into a window: dark where the light can't reach, the lit lip under it.
  'frame-sunk.svg': frame({ bands: [{ top: '#53554e', left: '#62645c', right: '#c8c8be', bottom: '#e6e4da' }, '#000000a0'], cut: 1 }),
  // A command in the bar: a thin line with its corners knocked off.
  'frame-key.svg': frame({ bands: ['#ffffff8c'], cut: 1 }),
  'frame-key-hi.svg': frame({ bands: ['#ffffff'], cut: 1 }),
};

// The bubble's tail: its top three rows lie over the frame's bottom bands and open them onto the window's colour.
{
  const rows = ['dFFFFFd', 'bdFFFdb', 'obdFdbo', '.obdbo.', '..obo..', '...o...'], colors = { d: '#53554e', b: '#7d7f76', o: OUTLINE, F: '#104030' }, pixels = new Map();
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') pixels.set(`${x},${y}`, colors[c]); }));
  for (let y = 3; y <= rows.length; y++) for (let x = 0; x < 7; x++) if (!pixels.has(`${x},${y}`) && rows[y - 1][x] === 'o') pixels.set(`${x},${y}`, SHADOW);
  files['tail.svg'] = svg(7, rows.length + 1, pixels);
}

// The bar's marks: white, a pixel thick or more, with the text's hard shadow, big enough to read with no word beside them.
function glyph(rows) {
  const pixels = new Map(), ink = rows.flatMap((row, y) => [...row].flatMap((c, x) => c === '#' ? [[x, y]] : []));
  for (const [x, y] of ink) pixels.set(`${x},${y}`, '#ffffff');
  for (const [x, y] of ink) if (!pixels.has(`${x + 1},${y + 1}`)) pixels.set(`${x + 1},${y + 1}`, OUTLINE);
  return svg(rows[0].length + 1, rows.length + 1, pixels);
}
files['back.svg'] = glyph(['....###', '...###.', '..###..', '.###...', '###....', '.###...', '..###..', '...###.', '....###']);
files['list.svg'] = glyph(['#########', '#########', '.........', '#########', '#########', '.........', '#########', '#########']);
files['plus.svg'] = glyph(['...##...', '...##...', '...##...', '########', '########', '...##...', '...##...', '...##...']);
files['dots.svg'] = glyph(['##..##..##', '##..##..##']);
// Reset: a ring two pixels thick, turning anticlockwise into its arrowhead.
files['reset.svg'] = glyph(['..####.....', '.#####.##..', '##....####.', '##...######', '##.....##..', '##.....##..', '##.....##..', '.#######...', '..#####....']);

// The pointing glove as the old title screen had it: no outline, lit from the top left, a long finger over the curled ones going grey, a ridged cuff. The marks' hard shadow under it.
function sprite(rows, colors) {
  const pixels = new Map();
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') pixels.set(`${x},${y}`, colors[c]); }));
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.' && !pixels.has(`${x + 1},${y + 1}`)) pixels.set(`${x + 1},${y + 1}`, OUTLINE); }));
  return svg(rows[0].length + 1, rows.length + 1, pixels);
}
files['hand.svg'] = sprite([
  '......BAAB..........',
  '....BAWWWWAAAAAAAAB.',
  '..BAWWWWWWWWWWWWWWWB',
  'CWDAWWWWWWBBBBBBBBC.',
  'CWDWWWWWWDDDDDE.....',
  'CWDWWWWWABBBBBC.....',
  'CWDAWWWAAEEEEE......',
  'CWDAAAABCCCCCD......',
  'CWDBBBBCEEEEE.......',
  'CWDCCCCDDDDDE.......',
  '.D..FFFFFFFF........',
], { W: '#ffffff', A: '#e2e2e2', B: '#c0c0c0', C: '#9c9c9c', D: '#787878', E: '#585858', F: '#3c3c3c' });

// The PS1 dithered what it shaded with a 4×4 Bayer pattern: here a pixel lighter above the middle and darker below, about one of its 32 steps either way.
{
  const M = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], pixels = new Map(), hex = n => Math.round(n).toString(16).padStart(2, '0');
  M.forEach((row, y) => row.forEach((m, x) => { const v = m / 15 - .5; pixels.set(`${x},${y}`, v > 0 ? `#ffffff${hex(v * 28)}` : `#000000${hex(-v * 44)}`); }));
  files['dither.svg'] = svg(4, 4, pixels);
}

// The world map, as the old game's corner map had it: lands in pale greys, ragged at the coast and specked off it, the sea left out so the window shows through.
// Room kept round every place for a party at each of its hours, the reactor's city a dark plate, and a few towns, dark specks so none is taken for a party.
{
  const hash = (x, y, s = 0) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s + 1, 1440662683) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const smooth = t => t * t * (3 - 2 * t);
  const noise = (x, y, scale, s) => { const gx = x / scale, gy = y / scale, x0 = Math.floor(gx), y0 = Math.floor(gy), u = smooth(gx - x0), v = smooth(gy - y0), a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  const W = WORLD, H = WORLD, at = (x, y) => y * W + x, spots = Object.entries(SITES).flatMap(([place, hours]) => Object.values(hours).map(spot => [place, ...spot]));
  // Two continents and two islands, each a crooked spine of land thick in places and thin in others: the wrecks, the meadow and the wood down the west, the reactor and the mesa round the east, the embers' volcano off the south-west, and an empty isle in the south-east.
  // Each spine names the places its land can belong to, the empty isle taking the meadow's green.
  const spines = [
    ['wrecks meadow wood', [[3, 19, 2.5], [6, 15, 5], [12, 10, 7], [20, 6, 5.5], [27, 5, 3]]],
    ['wrecks meadow wood', [[12, 11, 5], [16, 19, 5], [20, 27, 7], [23, 35, 5.5], [23, 42, 6], [29, 49, 7], [34, 56, 4.5], [36, 60, 2]]],
    ['wrecks meadow wood', [[18, 28, 4.5], [11, 24, 5], [6, 30, 3], [5, 36, 2]]],
    ['wrecks meadow wood', [[22, 20, 3], [28, 17, 3.5]]],
    ['reactor mesa', [[35, 19, 2.5], [40, 15, 5.5], [47, 11, 7], [55, 8, 6], [61, 4, 3]]],
    ['reactor mesa', [[50, 13, 5], [52, 21, 4.5], [50, 30, 7], [54, 39, 6], [56, 44, 2.5]]],
    ['reactor mesa', [[48, 29, 4], [42, 34, 3.5], [39, 39, 2]]],
    ['reactor mesa', [[55, 20, 3], [61, 24, 2]]],
    ['ember', [[7, 47, 2.5], [11, 52, 6.5], [16, 57, 5], [10, 59, 4]]],
    ['meadow', [[44, 51, 3.5], [50, 54, 6], [57, 57, 4], [60, 51, 2]]],
  ];
  // Sea cut through after: the channel round the embers' isle, and the one under the mesa's cape.
  const seas = [[[2, 43, 1.5], [16, 45, 2], [22, 52, 1.8], [25, 62, 1.5]], [[40, 46, 1.5], [62, 47, 1.5]]];
  const segment = (x, y, [ax, ay, ar], [bx, by, br]) => { const vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy))); return 1 - Math.hypot(x - ax - vx * t, y - ay - vy * t) / (ar + (br - ar) * t); };
  const field = (lines, x, y) => Math.max(...lines.flatMap(line => line.slice(1).map((b, i) => segment(x, y, line[i], b))));
  const strongest = (x, y) => spines.reduce((best, [places, line]) => { const f = field([line], x, y); return f > best[0] ? [f, places] : best; }, [-Infinity, '']);
  const nearest = (x, y, places = '') => spots.filter(([place]) => !places || places.includes(place)).reduce((best, [place, sx, sy]) => { const d = Math.hypot(x - sx, y - sy); return d < best[0] ? [d, place] : best; }, [Infinity, ''])[1];
  const land = new Array(W * H).fill(false), region = new Array(W * H).fill('');
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const [f, places] = strongest(x + (noise(x, y, 7, 21) - .5) * 6, y + (noise(x, y, 7, 22) - .5) * 5), n = (noise(x, y, 5, 1) - .5) * .9 + (noise(x, y, 2.5, 2) - .5) * .6 + (hash(x, y, 3) - .5) * .25;
    if (f + n > 0 && !(noise(x, y, 4, 5) < .12 && f < .6) && field(seas, x, y) + (noise(x, y, 3, 6) - .5) * .6 < 0) { land[at(x, y)] = true; region[at(x, y)] = nearest(x + (noise(x, y, 4, 7) - .5) * 8, y + (noise(x, y, 4, 8) - .5) * 8, places); }
  }
  for (const [place, sx, sy] of spots) for (let dy = -3; dy <= 3; dy++) for (let dx = -4; dx <= 4; dx++) if ((dx / 4.5) ** 2 + (dy / 3.5) ** 2 <= 1) { land[at(sx + dx, sy + dy)] = true; region[at(sx + dx, sy + dy)] ||= place; }
  const isLand = (x, y) => x >= 0 && y >= 0 && x < W && y < H && land[at(x, y)];
  const fleck = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const by = land[at(x, y)] ? null : [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, 1], [1, -1], [-1, -1]].find(([dx, dy]) => isLand(x + dx, y + dy)); if (by && hash(x, y, 33) < .08) fleck.push([x, y, region[at(x + by[0], y + by[1])]]); }
  for (const [x, y, place] of fleck) { land[at(x, y)] = true; region[at(x, y)] = place; }
  const coast = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !isLand(x + dx, y + dy));
  // Muted the way the old map was, each land in its own ramp: the wrecks' snow, the meadow's grass, the wood's pines, the reactor's grey, the mesa's sand and the embers' ash.
  const RAMPS = {
    wrecks: ['#56636c', '#6d7b84', '#86949b', '#a1adb2', '#bec8cb', '#dce3e4'],
    meadow: ['#435e38', '#557244', '#688751', '#7d9b60', '#95b073', '#aec58b'],
    wood: ['#2a422c', '#355136', '#416142', '#4f724d', '#60835b', '#74956c'],
    reactor: ['#555f58', '#6c776e', '#848f86', '#9ea89e', '#b8c0b6', '#d2d8ce'],
    mesa: ['#6c5236', '#836441', '#98774d', '#ab8b5c', '#bea172', '#cfb88c'],
    ember: ['#4e302a', '#623b32', '#78493c', '#8c5a49', '#a06d5a', '#b4836f'],
  }, pixels = new Map();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!isLand(x, y)) continue;
    const ramp = RAMPS[region[at(x, y)]] ?? RAMPS.reactor, t = 2.6 + (noise(x, y, 4, 11) - .5) * 3 + (hash(x, y, 12) - .5) * .8 - (coast(x, y) ? 1.4 : 0);
    pixels.set(`${x},${y}`, ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(t)))]);
  }
  { const [cx, cy] = SITES.reactor.day; for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 5; x <= cx + 5; x++) { const r = Math.hypot((x - cx) / 1.2, y - cy); if (r <= 3.4 && isLand(x, y)) pixels.set(`${x},${y}`, r > 2.5 ? '#4e5c52' : '#5f6e62'); } }
  const crowded = (x, y) => spots.some(([, sx, sy]) => Math.abs(sx - x) < 5 && Math.abs(sy - y) < 4);
  for (let i = 0, towns = 0; i < 500 && towns < 5; i++) { const x = 2 + Math.floor(hash(i, 7, 50) * (W - 4)), y = 2 + Math.floor(hash(i, 8, 50) * (H - 4)); if (isLand(x, y) && !coast(x, y) && !crowded(x, y)) { pixels.set(`${x},${y}`, '#262e29'); towns++; } }
  files['world.svg'] = svg(W, H, pixels);
}

for (const [name, text] of Object.entries(files)) writeFileSync(OUT + name, text);
console.log(`${Object.keys(files).length} files in ${OUT}`);
