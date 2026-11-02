import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summary } from '../client/theme-console.js';
import { readFileSync } from 'node:fs';
import { PALETTES, paletteFor, savedColour, saveColour, shipColours, wearColours } from '../client/bridge/palettes.js';

const rgb = hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255);
function hue(hex) {
  const [r, g, b] = rgb(hex), max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? (g - b) / d % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
function saturation(hex) {
  const [r, g, b] = rgb(hex), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
}
const hueDistance = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
const linear = c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
const maxLinear = hex => Math.max(...rgb(hex).map(linear));
const SIGNAL_HUES = ['#ff4a33', '#39e0c8', '#ff8426'].map(hue);
const nearSignal = c => saturation(c) >= .15 && SIGNAL_HUES.some(signal => hueDistance(hue(c), signal) < 20);
// What catches the eye, as against what fills the room behind it.
const bright = p => [p.trim, p.rail, p.neon, p.lamp, ...p.tones];
const surfaces = p => ['wall', 'ceiling', 'bay', 'console', 'mount', 'door', 'pit', 'deck'].map(key => p[key]);
const allColours = p => [...bright(p), ...surfaces(p), p.chair, p.seat, ...p.space];

for (const [id, p] of Object.entries(PALETTES)) {
  test(`${id}: what catches the eye keeps clear of the signals`, () => {
    for (const c of bright(p)) assert.ok(!nearSignal(c), c);
  });
  test(`${id}: a surface on a signal's hue is too dark to compete with it`, () => {
    for (const c of surfaces(p)) if (nearSignal(c)) assert.ok(maxLinear(c) <= .2, c);
  });
  test(`${id}: no gold`, () => {
    for (const c of allColours(p)) assert.ok(saturation(c) < .15 || hue(c) < 35 || hue(c) > 65, c);
  });
  test(`${id}: chairs are muted`, () => {
    for (const c of [p.chair, p.seat]) {
      assert.ok(saturation(c) <= .4, `${c} saturation`);
      assert.ok(maxLinear(c) <= .3, `${c} brightness`);
    }
  });
  test(`${id}: has every colour`, () => {
    assert.equal(p.tones.length, 3);
    assert.equal(p.space.length, 6);
    for (const c of allColours(p)) assert.match(c, /^#[0-9a-f]{6}$/);
    assert.equal(typeof p.ambient, 'number');
  });
}
test('the Lospec colours have their own view outside, and walls that are not purple or pink', () => {
  const lospec = Object.entries(PALETTES).filter(([id]) => !['neon', 'violet', 'arctic'].includes(id));
  assert.equal(lospec.length, 5);
  for (const [id, p] of lospec) {
    assert.notDeepEqual(p.space, PALETTES.neon.space, id);
    assert.ok(hue(p.wall) < 260 || hue(p.wall) > 345, `${id} ${p.wall}`);
  }
});
test('the menu has one Bridge theme; colours are chosen inside it', () => {
  const source = readFileSync('client/themes.js', 'utf8');
  assert.ok(source.includes("id: 'bridge', scheme: 'dark'"));
  assert.ok(!source.includes('bridge-'));
});
test('every colour has a name to show', () => {
  for (const p of Object.values(PALETTES)) assert.match(p.name, /^[A-Z][a-z]+$/);
});
test('unknown colours get the first palette', () => assert.equal(paletteFor('nope'), PALETTES.neon));
function withStorage(storage, run) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  try { run(); } finally { if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage; }
}
test('the chosen colour is remembered', () => {
  const kept = new Map();
  withStorage({ getItem: key => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, value) }, () => {
    assert.equal(savedColour(), 'neon');
    saveColour('arctic');
    assert.equal(savedColour(), 'arctic');
  });
});
test('a stale or unreadable saved colour falls back', () => {
  withStorage({ getItem: () => 'bridge-violet' }, () => assert.equal(savedColour(), 'neon'));
  withStorage({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, () => {
    assert.equal(savedColour(), 'neon');
    saveColour('violet');
  });
});
test('the chrome knows the bridge', () => {
  assert.match(readFileSync('client/theme-console.js', 'utf8'), /bridge:/);
  assert.match(readFileSync('client/alerts.js', 'utf8'), /bridge:/);
  assert.match(readFileSync('client/themes.css', 'utf8'), /\[data-theme=['"]?bridge/);
  assert.match(readFileSync('client/style.css', 'utf8'), /\.status-text\.bridge/);
});
test('the status line says what the bridge says: ALL STOP is the rate limit, not a quiet ship', () => {
  const line = (...statuses) => summary(statuses.map(status => ({ status }))).bridge;
  assert.equal(line(), 'ORBIT');
  assert.equal(line('idle'), 'ORBIT');
  assert.equal(line('working'), 'WARP 1');
  assert.equal(line('working', 'question'), '1 WAITING · WARP 1');
});
test('chrome tokens use no gold', () => {
  const block = readFileSync('client/themes.css', 'utf8').match(/\[data-theme=['"]?bridge[^{]*\{[^}]*\}/)[0];
  for (const c of block.match(/#[0-9a-f]{6}/gi)) assert.ok(saturation(c) < .15 || hue(c) < 35 || hue(c) > 65, c);
});

const ratio = (a, b) => {
  const lum = hex => { const [r, g, b] = rgb(hex).map(linear); return .2126 * r + .7152 * g + .0722 * b; };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + .05) / (lo + .05);
};
for (const [id, p] of Object.entries(PALETTES)) {
  const ship = shipColours(p);
  test(`${id}: the list wears the room's colours and stays readable`, () => {
    for (const c of Object.values(ship)) assert.match(c, /^#[0-9a-f]{6}$/);
    for (const ground of [ship.hull, ship.plate, ship.raised, ship.sunk]) {
      assert.ok(ratio(ship.text, ground) >= 7, `text on ${ground}`);
      assert.ok(ratio(ship.quiet, ground) >= 4.5, `quiet text on ${ground}`);
    }
    assert.ok(ratio(ship.ink, ship.light) >= 4.5, `ink on ${ship.light}`);
    assert.ok(ratio(ship.light, ship.sunk) >= 3, `${ship.light} on sunk`);
    assert.ok(ratio(ship.light, ship.soft) >= 3, `${ship.light} on its own tint ${ship.soft}`);
    assert.ok(ratio(ship.text, ship.soft) >= 7, `text on ${ship.soft}`);
  });
  test(`${id}: the list has no gold, and nothing bright on a signal's hue`, () => {
    for (const c of Object.values(ship)) assert.ok(saturation(c) < .15 || hue(c) < 35 || hue(c) > 65, c);
    assert.ok(!nearSignal(ship.light) && !nearSignal(ship.trim), 'lights');
  });
  test(`${id}: the hull is coloured, not grey`, () => assert.ok(saturation(ship.hull) >= .15, ship.hull));
  test(`${id}: the ship's lights are a colour, not white`, () => assert.ok(saturation(ship.light) >= .3, ship.light));
}
test('each colour gives the list its own hull', () => {
  assert.equal(new Set(Object.values(PALETTES).map(p => shipColours(p).hull)).size, Object.keys(PALETTES).length);
});
test('the colours go on the page as --ship-*, which only the Bridge reads', () => {
  const set = new Map();
  wearColours(PALETTES.rust, { style: { setProperty: (name, value) => set.set(name, value) } });
  assert.equal(set.get('--ship-hull'), shipColours(PALETTES.rust).hull);
  for (const name of set.keys()) assert.match(name, /^--ship-/);
});
test('the list has its own look: starship chrome, motion only if allowed, and its own name', () => {
  const css = readFileSync('client/bridge-list.css', 'utf8'), main = readFileSync('client/main.js', 'utf8');
  assert.match(main, /import '\.\/bridge-list\.css'/);
  assert.match(main, /bridge: '[A-Z]/);
  for (const c of css.match(/#[0-9a-f]{6}/gi) || []) assert.ok(saturation(c) < .15 || hue(c) < 35 || hue(c) > 65, c);
  const still = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, '').replace(/@keyframes[^\n]*/g, '');
  assert.doesNotMatch(still, /animation:/);
});
test('going to warp or dropping out never flashes the view', () => {
  for (const file of ['bridge', 'lights', 'post', 'space']) assert.doesNotMatch(readFileSync(`client/bridge/${file}.js`, 'utf8'), /flash/i, file);
});
