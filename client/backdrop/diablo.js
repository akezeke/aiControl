import { findDripSites, glow, hash, maskPixels, painter, sparkle } from './pixels.js';

// Sanctuary: the crypt flickers. Candles gutter, braziers burn, embers climb, blood gathers on the
// banners and altars and drips into the pools. Coordinates are in the wallpaper's own pixels (1536 x 1024).
const G = 3, q = v => Math.round(v / G);

// [x, top of the wax]; the flame sits on the wick above it.
const CANDLES = [
  [89, 496], [111, 485], [132, 500], [25, 525], [283, 533], [268, 548], [301, 550], [249, 745], [232, 765], [270, 762], [400, 757],
  [1413, 497], [1438, 480], [1461, 497], [1260, 540], [1241, 564], [1276, 565], [1526, 526], [1510, 527], [1170, 745], [1154, 758],
  [612, 213], [632, 213], [645, 213], [665, 213], [678, 213], [697, 213], [884, 212], [920, 205], [958, 212],
].map(([x, y]) => [q(x), q(y)]);
const BRAZIERS = [[45, 400], [1487, 400]].map(([x, y]) => [q(x), q(y)]);
const EMBER_SOURCES = [...BRAZIERS, ...CANDLES.slice(0, 21).filter((_, i) => i % 3 === 0)];

const FIRE_W = 14, FIRE_H = 19, STEPS_PER_SECOND = 12;
const FIRE = [[.12, '#4a0a06', .55], [.28, '#9c1a0c', .75], [.46, '#d9480f', .85], [.64, '#ff8a1f', .9], [.82, '#ffc84a', .95], [.94, '#fff0a8', 1]];

function newFire() { return { heat: new Float32Array(FIRE_W * FIRE_H), step: 0 }; }
function stepFire(fire, salt) {
  const { heat } = fire; fire.step++;
  for (let x = 0; x < FIRE_W; x++) {
    const d = Math.abs(x - (FIRE_W - 1) / 2) / (FIRE_W / 2), taper = 1 - d * d;
    heat[(FIRE_H - 1) * FIRE_W + x] = taper * (.7 + .3 * hash(x, fire.step, salt));
  }
  for (let y = 0; y < FIRE_H - 1; y++) for (let x = 0; x < FIRE_W; x++) {
    const below = (y + 1) * FIRE_W, l = heat[below + Math.max(0, x - 1)], c = heat[below + x], r = heat[below + Math.min(FIRE_W - 1, x + 1)];
    heat[y * FIRE_W + x] = Math.max(0, (l + c * 2 + r) / 4 * (.83 + .06 * hash(x, y + fire.step, salt + 1)) - .012);
  }
}
function drawFire(rect, fire, left, base) {
  for (let y = 0; y < FIRE_H; y++) for (let x = 0; x < FIRE_W; x++) {
    const h = fire.heat[y * FIRE_W + x];
    if (h < FIRE[0][0]) continue;
    let tone = FIRE[0]; for (const entry of FIRE) if (h >= entry[0]) tone = entry;
    rect(left + x, base - FIRE_H + 1 + y, 1, 1, tone[1], tone[2]);
  }
}

function drawCandle(rect, ctx, [x, y], k, t) {
  const f = Math.floor(t * 11 + hash(k, 1) * 9), lean = hash(f, k, 2), tall = 3 + (hash(f, k, 3) > .55 ? 1 : 0) + (hash(f, k, 4) > .85 ? 1 : 0);
  const sway = lean < .25 ? -1 : lean > .75 ? 1 : 0;
  rect(x - 1, y - 1, 3, 1, '#d8641e', .8);
  rect(x, y - 1, 1, 2, '#fff0b0');
  for (let r = 2; r < tall; r++) rect(x + (r === tall - 1 ? sway : 0), y - r, 1, 1, r < tall - 1 ? '#ffc24a' : '#ff8a28');
  glow(ctx, x, y - 3, 6 + (hash(f, k, 5) > .5 ? 1 : 0), '#ff9030', .1);
  glow(ctx, x, y - 3, 14, '#c04010', .05 + .015 * Math.sin(t * 2.1 + k));
}

const BLOOD = (r, g, b) => r > 75 && r < 185 && g < 48 && b < 48 && r > g * 2.4;
const WET = (r, g, b, x, y) => r > 105 && g < 60 && b < 60 && r > g * 2.2 && y > q(760);

function drip(rect, site, i, t) {
  const period = 4.5 + hash(i, 1) * 7, u = (t + hash(i, 2) * period) % period;
  const { x, y } = site, dist = site.land ? site.land - y : 24, gravity = 150, fall = Math.sqrt(2 * dist / gravity), form = 1.3;
  if (u < form) {
    const grow = u / form;
    rect(x, y, 1, 1, '#701014');
    if (grow > .4) rect(x, y + 1, 1, 1, '#9a1419');
    if (grow > .75) rect(x, y + 2, 1, 2, '#c2181d');
    return;
  }
  const a = u - form;
  if (a < fall) {
    const fy = Math.round(y + 2 + .5 * gravity * a * a), trail = Math.min(4, Math.floor(gravity * a / 28));
    rect(x, fy, 1, 2, '#d02024', site.land ? 1 : 1 - a / fall);
    for (let k = 1; k <= trail; k++) rect(x, fy - k, 1, 1, '#80121a', (1 - k * .22) * (site.land ? 1 : 1 - a / fall));
    return;
  }
  if (!site.land) return;
  const s = a - fall, land = site.land;
  if (s < .12) rect(x - 1, land, 3, 1, '#d42a2a');
  else if (s < .26) { rect(x - 2, land - 1, 1, 1, '#c82222'); rect(x + 2, land - 1, 1, 1, '#c82222'); rect(x, land - 2, 1, 1, '#e03a30'); }
  else if (s < .42) { rect(x - 3, land, 1, 1, '#a81c1c', .7); rect(x + 3, land, 1, 1, '#a81c1c', .7); }
}

export function createPainter(sample) {
  const fires = BRAZIERS.map((_, i) => ({ ...newFire(), salt: 40 + i * 9 }));
  const wet = maskPixels(sample, [0, q(760), sample.w, sample.h], WET);
  // Only blood on the side walls and altars: the nave is behind the interface, and fire is not blood.
  const sites = findDripSites(sample, BLOOD).filter(site => site.y < q(740) && (site.x < q(420) || site.x > q(1120))
    && !BRAZIERS.some(([bx, by]) => Math.abs(site.x - bx) < 14 && site.y > by - 46 && site.y < by + 10)).slice(0, 30);

  return function frame(ctx, t) {
    const rect = painter(ctx), want = Math.floor(t * STEPS_PER_SECOND);
    for (const fire of fires) {
      if (!fire.last || want - fire.last > 6) fire.last = want - 1;
      while (fire.last < want) { stepFire(fire, fire.salt); fire.last++; }
    }

    glow(ctx, q(870), q(440), 34, '#a01008', .07 + .03 * Math.sin(t * .8));
    sites.forEach((site, i) => drip(rect, site, i, t));
    sparkle(rect, wet, sample.w, t, 22, 1.2, '#ff6a4a', 51);

    BRAZIERS.forEach(([x, y], i) => {
      drawFire(rect, fires[i], x - FIRE_W / 2, y);
      const flick = .9 + .1 * Math.sin(t * 9 + i) + .06 * hash(Math.floor(t * 12), i);
      glow(ctx, x, y - 8, 20, '#ff6a20', .17 * flick);
      glow(ctx, x, y - 8, 46, '#a02808', .09 * flick);
    });
    CANDLES.forEach((candle, k) => drawCandle(rect, ctx, candle, k, t));

    for (let k = 0; k < 26; k++) {
      const [sx, sy] = EMBER_SOURCES[Math.floor(hash(k, 1) * EMBER_SOURCES.length)], life = 3 + hash(k, 2) * 3;
      const age = ((t + hash(k, 3) * life) % life) / life, cycle = Math.floor((t + hash(k, 3) * life) / life);
      const x = Math.round(sx + (hash(k, cycle, 4) - .5) * 8 + Math.sin(t * 1.3 + k) * 3 * age), y = Math.round(sy - 4 - age * (28 + hash(k, cycle, 5) * 30));
      rect(x, y, 1, 1, age < .3 ? '#ffd060' : age < .65 ? '#f07020' : '#8a1c10', 1 - age);
    }
  };
}
