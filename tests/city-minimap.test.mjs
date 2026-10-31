import test from 'node:test';
import assert from 'node:assert/strict';
import { cityPlan, screen } from '../client/city/plan.js';
import { mapFit, mapSites, mapPicture, mapView, mapToScreen, MAP_PX } from '../client/city/minimap.js';

const layout = () => ({
  grid: { cols: 2 },
  pods: [{ key: 'a', name: 'alpha', cwd: '/a', col: 0, row: 0 }, { key: 'b', name: 'beta', cwd: '/b', col: 1, row: 0 }],
  desks: new Map([['s1', { sessionId: 's1', podKey: 'a', slot: 0, subagents: ['k1'] }], ['s2', { sessionId: 's2', podKey: 'b', slot: 1 }]]),
});
const plan = () => cityPlan(layout(), { s1: { storeys: 8 } });
const W = 100, H = 66;
const pixel = (rgba, x, y) => [...rgba.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];

test('the whole island fits the map, in every turn of the city', () => {
  const p = plan();
  for (const view of [0, 1, 2, 3]) {
    const fit = mapFit(p, view, W, H);
    for (const [x, z] of [[0, 0], [p.bounds.w, 0], [0, p.bounds.d], [p.bounds.w, p.bounds.d]]) {
      const [sx, sy] = screen(x, z, view), px = sx * fit.scale + fit.ox, py = sy * fit.scale + fit.oy;
      assert.ok(px >= 0 && px <= W && py >= 0 && py <= H, `view ${view}: ${px},${py}`);
    }
  }
});

test('a session is marked where its building stands, and a subagent beside it', () => {
  const p = plan(), fit = mapFit(p, 0, W, H), sites = mapSites(p, 0, fit), s1 = p.buildings.find(b => b.id === 's1');
  const [sx, sy] = screen(s1.x, s1.z, 0);
  assert.deepEqual(sites.get('s1'), [Math.round(sx * fit.scale + fit.ox), Math.round(sy * fit.scale + fit.oy)]);
  assert.ok(sites.has('k1'));
  assert.notDeepEqual(sites.get('k1'), sites.get('s1'));
  assert.notDeepEqual(sites.get('s2'), sites.get('s1'));
});

test('the map turns with the city', () => {
  const p = plan();
  assert.notDeepEqual(mapSites(p, 1, mapFit(p, 1, W, H)).get('s1'), mapSites(p, 0, mapFit(p, 0, W, H)).get('s1'));
});

test('the picture is the sea, and a building in its own colour at its site', () => {
  const p = plan(), fit = mapFit(p, 0, W, H), rgba = mapPicture(p, 0, W, H, fit), [x, y] = mapSites(p, 0, fit).get('s1');
  assert.equal(rgba.length, W * H * 4);
  assert.deepEqual(pixel(rgba, 0, 0), [0x0b, 0x5e, 0x65]);
  const colour = p.buildings.find(b => b.id === 's1').look.colour;
  assert.deepEqual(pixel(rgba, x - 1, y - 1), [1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16)));
});

test('a longer session stands taller on the map', () => {
  const tall = cityPlan(layout(), { s1: { storeys: 10 } }), low = cityPlan(layout(), { s1: { storeys: 2 } }), fit = mapFit(tall, 0, W, H), [x, y] = mapSites(tall, 0, fit).get('s1');
  const rise = plan => { const rgba = mapPicture(plan, 0, W, H, fit), colour = pixel(rgba, x - 1, y - 1); let n = 0; while (pixel(rgba, x - 1, y - 1 - n).join() === colour.join()) n++; return n; };
  assert.ok(rise(tall) > rise(low), `${rise(tall)} > ${rise(low)}`);
});

test('a sleeping building goes dark', () => {
  const p = plan(), fit = mapFit(p, 0, W, H), [x, y] = mapSites(p, 0, fit).get('s1');
  const sum = c => c[0] + c[1] + c[2], awake = pixel(mapPicture(p, 0, W, H, fit), x - 1, y - 1), asleep = pixel(mapPicture(p, 0, W, H, fit, { asleep: id => id === 's1' }), x - 1, y - 1);
  assert.ok(sum(asleep) < sum(awake) * .7, `${asleep} against ${awake}`);
});

test('a chosen project stays bright while the rest of the map dims', () => {
  const p = plan(), fit = mapFit(p, 0, W, H), [ax, ay] = mapSites(p, 0, fit).get('s1'), [bx, by] = mapSites(p, 0, fit).get('s2');
  const plain = mapPicture(p, 0, W, H, fit), lit = mapPicture(p, 0, W, H, fit, { lit: 'a' });
  assert.deepEqual(pixel(lit, ax - 1, ay - 1), pixel(plain, ax - 1, ay - 1));
  assert.notDeepEqual(pixel(lit, bx - 1, by - 1), pixel(plain, bx - 1, by - 1));
  assert.notDeepEqual(pixel(lit, 0, 0), pixel(plain, 0, 0));
});

test('the camera shows as a box of what it sees, on whole map pixels', () => {
  const p = plan(), fit = mapFit(p, 0, W, H), [sx, sy] = screen(p.buildings[0].x, p.buildings[0].z, 0);
  const box = mapView(fit, { cx: sx, cy: sy, r: 2 }, 800, 600);
  const size = 800 / 2 * fit.scale * MAP_PX;
  assert.ok(Math.abs(box.w - size) <= MAP_PX, `${box.w} near ${size}`);
  for (const v of [box.x, box.y, box.w, box.h]) assert.equal(v % MAP_PX, 0);
  // Zooming in shrinks it.
  assert.ok(mapView(fit, { cx: sx, cy: sy, r: 4 }, 800, 600).w < box.w);
});

test('a press on the map finds the spot it shows', () => {
  const p = plan(), fit = mapFit(p, 0, W, H), [sx, sy] = screen(p.buildings[0].x, p.buildings[0].z, 0);
  const [cx, cy] = mapToScreen(fit, (sx * fit.scale + fit.ox) * MAP_PX, (sy * fit.scale + fit.oy) * MAP_PX);
  assert.ok(Math.abs(cx - sx) < 1e-6 && Math.abs(cy - sy) < 1e-6);
});
test("the map's land is the ground the city has at this hour", () => {
  const p = plan(), fit = mapFit(p, 0, W, H), colours = time => { const rgba = mapPicture(p, 0, W, H, fit, { time }), seen = new Set(); for (let i = 0; i < rgba.length; i += 4) seen.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`); return seen; };
  assert.ok(colours('day').has('75,112,88') && !colours('day').has('50,51,83'));
  assert.ok(colours('night').has('50,51,83') && !colours('night').has('75,112,88'));
});
