import { CRANES, LAMPS, W, WELDS, stars, towerLights } from './city-still.js';
import { glow, hash, painter, pixelAt } from './pixels.js';

// Metropolis: the site works through the night. Trolleys run out along the jibs and the hooks bring up steel,
// welders' arcs flash on the frames, red lights blink on the cranes and the tallest towers, the hoarding's
// lamps chase along it, stars come and go, and now and then a plane crosses. Coordinates are the wallpaper's (city-still.js).
const STEEL = '#8a3d30', STEEL_LIT = '#b4563f', CABLE = '#8d9497';

export function createPainter(sample) {
  const twinkling = stars().filter((_, i) => i % 3 === 0);

  return function frame(ctx, t) {
    const rect = painter(ctx), blink = (phase, period = 1.6) => (t + phase) % period < .45;
    const beacon = (x, y, phase) => { if (!blink(phase)) return; rect(x, y, 1, 1, '#ff4a3a'); glow(ctx, x, y, 3, '#e83b3b', .35); };

    twinkling.forEach(([x, y], k) => { if (hash(k, Math.floor(t * 1.5), 21) < .12) rect(x, y, 1, 1, `rgb(${pixelAt(sample, x + 1, y).join()})`); });

    CRANES.forEach((c, i) => {
      // Out along the jib and back, the hook down and up, a beam hanging off it on two slings.
      const dir = Math.sign(c.reach - c.x), near = dir > 0 ? c.x + 14 : c.x - 10, far = c.reach - dir * 6;
      const x = Math.round(near + (far - near) * (.5 - .5 * Math.cos(t * (.09 + i * .025) + i * 2.4)));
      const drop = Math.round(18 + 46 * (.5 - .5 * Math.cos(t * (.13 + i * .03) + i * 1.3))), top = c.y + 4, hook = top + 2 + drop;
      const sway = Math.round(Math.sin(t * 1.1 + i * 2));
      rect(x - 2, top, 5, 2, '#2c3032'); rect(x - 1, top + 2, 1, drop, CABLE); rect(x + 1, top + 2, 1, drop, CABLE);
      rect(x - 1, hook, 3, 2, c.paint);
      rect(x - 3 + sway, hook + 3, 1, 1, CABLE); rect(x + 3 + sway, hook + 3, 1, 1, CABLE); rect(x - 2 + sway, hook + 2, 1, 1, CABLE); rect(x + 2 + sway, hook + 2, 1, 1, CABLE);
      rect(x - 7 + sway, hook + 4, 15, 1, STEEL_LIT); rect(x - 7 + sway, hook + 5, 15, 1, STEEL);
      beacon(c.x + 2, c.y - 13, i * .7); beacon(c.reach, c.y - 1, i * .7 + .8);
    });
    towerLights.forEach(([x, y], k) => beacon(x, y, k * .37 + hash(k, 22)));

    // Arcs flash in bursts, throwing sparks that fall and cool.
    WELDS.forEach(([x, y], k) => {
      const period = 3.5 + hash(k, 1) * 4, u = (t + hash(k, 2) * period) % period;
      if (u > 1.6) return;
      const f = Math.floor(t * 12);
      if (hash(f, k, 3) < .7) { rect(x, y, 1, 1, '#ffffff'); glow(ctx, x, y, 4 + (hash(f, k, 4) > .5 ? 1 : 0), '#8fd3ff', .55); }
      for (let s = 0; s < 7; s++) {
        const life = .7 + hash(k, s, 5) * .4, v = u + s * .17, age = (v % life) / life, n = Math.floor(v / life);
        const sx = x + Math.round((hash(k, s, n) - .5) * 12 * age), sy = y + 1 + Math.round(age * age * 20);
        rect(sx, sy, 1, 1, age < .35 ? '#fbff86' : age < .7 ? '#f79617' : '#9e4539', 1 - age * .8);
      }
    });

    // The hoarding's lamps chase along it, two at a time.
    LAMPS.forEach(([x, y], k) => { if ((Math.floor(t * 4) - k + LAMPS.length * 99) % LAMPS.length < 2) { rect(x - 1, y, 3, 2, '#f79617'); glow(ctx, x, y, 5, '#fb6b1d', .3); } });

    // A plane every minute or so, high over the site.
    const period = 61, u = (t % period) / period;
    if (u < .3) {
      const px = Math.round(-6 + (W + 12) * u / .3), py = 14 + Math.round(u * 16);
      rect(px, py, 3, 1, '#7d8494');
      if (Math.floor(t * 2) % 2) rect(px - 1, py, 1, 1, '#e83b3b'); else rect(px + 3, py, 1, 1, '#ffffff');
    }
  };
}
