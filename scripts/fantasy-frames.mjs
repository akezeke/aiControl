// The Fantasy windows' PS1 pixels: 9-slice frames, the bubble's tail and a 4×4 Bayer dither tile, as tiny SVGs drawn at 2 CSS px a pixel.
// node scripts/fantasy-frames.mjs writes them into client/public/fantasy.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

// The PS1 dithered what it shaded with a 4×4 Bayer pattern: here a pixel lighter above the middle and darker below, about one of its 32 steps either way.
{
  const M = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], pixels = new Map(), hex = n => Math.round(n).toString(16).padStart(2, '0');
  M.forEach((row, y) => row.forEach((m, x) => { const v = m / 15 - .5; pixels.set(`${x},${y}`, v > 0 ? `#ffffff${hex(v * 28)}` : `#000000${hex(-v * 44)}`); }));
  files['dither.svg'] = svg(4, 4, pixels);
}

for (const [name, text] of Object.entries(files)) writeFileSync(OUT + name, text);
console.log(`${Object.keys(files).length} files in ${OUT}`);
