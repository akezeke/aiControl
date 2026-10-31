// Resurrect 64 by Kerrie Lake (lospec.com/palette-list/resurrect-64). Every pixel ends up as one of these.
export const RESURRECT_64 = ['2e222f', '3e3546', '625565', '966c6c', 'ab947a', '694f62', '7f708a', '9babb2', 'c7dcd0', 'ffffff', '6e2727', 'b33831', 'ea4f36', 'f57d4a', 'ae2334', 'e83b3b', 'fb6b1d', 'f79617', 'f9c22b', '7a3045', '9e4539', 'cd683d', 'e6904e', 'fbb954', '4c3e24', '676633', 'a2a947', 'd5e04b', 'fbff86', '165a4c', '239063', '1ebc73', '91db69', 'cddf6c', '313638', '374e4a', '547e64', '92a984', 'b2ba90', '0b5e65', '0b8a8f', '0eaf9b', '30e1b9', '8ff8e2', '323353', '484a77', '4d65b4', '4d9be6', '8fd3ff', '45293f', '6b3e75', '905ea9', 'a884f3', 'eaaded', '753c54', 'a24b6f', 'cf657f', 'ed8099', '831c5d', 'c32454', 'f04f78', 'f68181', 'fca790', 'fdcbb0'].map(c => `#${c}`);
// Colours added where nothing above works: the palette has no quiet step between its ramps, and the ground has to stay quiet for a building to stand out on it.
export const EXTRAS = [
  '#4c4a2a', '#565430', // meadow, between the brown and the olive
  '#1a6a55', // mown lawn's lighter stripe
  '#553350', // plum lot's lighter ring
  '#7f5f5a', '#8a6a62', '#c9a98e', // a paved lot, and its path
  '#0a525a', // panelled lot
];
export const OUTLINE = '#2e222f';

export const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const PALETTE = [...RESURRECT_64, ...EXTRAS].map(hex), members = new Set(PALETTE.map(c => c.join()));
export const inPalette = (r, g, b) => members.has(`${r},${g},${b}`);

const lin = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
const oklab = ([r, g, b]) => { const R = lin(r), G = lin(g), B = lin(b), l = Math.cbrt(.4122 * R + .5363 * G + .0514 * B), m = Math.cbrt(.2119 * R + .6807 * G + .1074 * B), s = Math.cbrt(.0883 * R + .2817 * G + .6300 * B); return [.2104 * l + .7936 * m - .0040 * s, 1.9779 * l - 2.4285 * m + .4506 * s, .0259 * l + .7827 * m - .8086 * s]; };
const labs = PALETTE.map(oklab), cache = new Map();
export function nearest(c) {
  const [r, g, b] = c.map(v => Math.max(0, Math.min(255, Math.round(v)))), key = (r << 16) | (g << 8) | b;
  let hit = cache.get(key); if (hit) return hit;
  const a = oklab([r, g, b]); let best = 0, d = Infinity;
  labs.forEach((q, i) => { const e = (a[0] - q[0]) ** 2 + (a[1] - q[1]) ** 2 * 1.4 + (a[2] - q[2]) ** 2 * 1.4; if (e < d) { d = e; best = i; } });
  hit = PALETTE[best]; cache.set(key, hit); return hit;
}

// Each wall's own ramp, picked by hand: lit top, left face (the wall), shaded right face.
export const RAMPS = new Map(Object.entries({
  '#e83b3b': ['#f68181', '#e83b3b', '#ae2334'], '#0eaf9b': ['#30e1b9', '#0eaf9b', '#0b8a8f'], '#f9c22b': ['#fbff86', '#f9c22b', '#f79617'],
  '#ed8099': ['#fca790', '#ed8099', '#cf657f'], '#fdcbb0': ['#ffffff', '#fdcbb0', '#e6904e'], '#4d9be6': ['#8fd3ff', '#4d9be6', '#4d65b4'],
  '#8ff8e2': ['#ffffff', '#8ff8e2', '#30e1b9'], '#a884f3': ['#eaaded', '#a884f3', '#905ea9'], '#cd683d': ['#fbb954', '#cd683d', '#9e4539'], '#c7dcd0': ['#ffffff', '#c7dcd0', '#9babb2'],
}).map(([k, v]) => [hex(k).join(), v.map(hex)]));
