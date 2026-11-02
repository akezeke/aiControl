import test from 'node:test';
import assert from 'node:assert/strict';
import { groundCells, lakesOf, soilOf } from '../client/city/ground.js';
import { lakeOf } from '../client/city/lake.js';
import { cityPlan } from '../client/city/plan.js';
import { hex } from '../client/city/palette.js';
import { fnv } from '../client/city/identity.js';
import { ducksAt, seaFrame, SEA_FRAMES } from '../client/city/surroundings.js';
import { duck, lamp, reeds, rowboat } from '../client/city/generator.js';
import { screen } from '../client/city/plan.js';

const pods = Array.from({ length: 12 }, (_, i) => ({ key: `p${i}`, name: `project-${i}`, cwd: `/p${i}`, col: i % 4, row: (i * 2) % 12 }));
const plan = cityPlan({ pods, desks: new Map(), grid: { cols: 4 } }, {}, null, [], [], ['']), cells = groundCells(plan), lakes = lakesOf(plan);
const big = lakes.filter(lake => lake.big), small = lakes.filter(lake => !lake.big);
const colourAt = (x, z) => { const i = (Math.floor(x) - cells.x0 + (Math.floor(z) - cells.z0) * cells.w) * 3; return `${cells.rgb[i]},${cells.rgb[i + 1]},${cells.rgb[i + 2]}`; };
const named = (...colours) => new Set(colours.map(c => hex(c).join()));
const WATERS = named('#0b5e65', '#0b8a8f', '#0eaf9b'), DEEP = hex('#0b5e65').join(), SHALLOW = hex('#0eaf9b').join(), PLANKS = named('#966c6c', '#7f5f5a'), PLANK_IN_SHADE = hex('#3e3546').join(), TRAIL_IN_SHADE = hex('#4c3e24').join(), LILIES = named('#239063', '#1ebc73', '#ed8099'), SOIL = named('#4b7058', '#547e64');
const each = (lake, visit) => { for (let z = lake.z; z < lake.z + lake.d; z++) for (let x = lake.x; x < lake.x + lake.w; x++) visit(x, z); };
const propsIn = lake => cells.props.filter(({ x, z }) => x >= lake.x && z >= lake.z && x < lake.x + lake.w && z < lake.z + lake.d);
const seeded = seed => n => fnv(`${seed}:${n}`);

test('this city has lakes of both sizes', () => { assert.ok(big.length >= 2, `${big.length} big`); assert.ok(small.length >= 2, `${small.length} small`); });
test('a shoreline wanders, and no two lakes share one', () => {
  const shape = seed => { const lake = lakeOf(seeded(seed), 0, 0, 164, 164, true); return Array.from({ length: 48 }, (_, i) => { const a = i / 48 * 2 * Math.PI, [x, z] = lake.at(a, 0); return Math.hypot(x - lake.cx, z - lake.cz); }); };
  const a = shape('one'), b = shape('two');
  assert.ok(Math.max(...a) / Math.min(...a) > 1.25, `${Math.max(...a) / Math.min(...a)}`);
  assert.ok(a.some((r, i) => Math.abs(r - b[i]) > 6));
});
test('how far past the shore is measured the same way as a point at that distance', () => {
  const lake = lakeOf(seeded('one'), 0, 0, 164, 164, true);
  for (const a of [.3, 1.7, 3.1, 4.4, 5.9]) for (const p of [-9, -3, 0, 4, 11]) { const [x, z] = lake.at(a, p); assert.ok(Math.abs(lake.past(x, z) - p) < .01, `${a} ${p}: ${lake.past(x, z)}`); }
  assert.ok(lake.past(lake.cx, lake.cz) < -20);
});
test('every lake stays inside its ground with its bank, whatever the seed', () => {
  for (let seed = 0; seed < 60; seed++) for (const [w, d, isBig] of [[164, 164, true], [234, 164, true], [24, 24, false], [24, 68, false], [68, 24, false]]) {
    const lake = lakeOf(seeded(seed), 100, 200, w, d, isBig), reach = isBig ? lake.trail + 3 : 3;
    for (let i = 0; i < 64; i++) { const [x, z] = lake.at(i / 64 * 2 * Math.PI, reach); assert.ok(x >= 100 && z >= 200 && x <= 100 + w && z <= 200 + d, `${seed} ${w}x${d} ${x},${z}`); }
  }
});
test('water never meets the grass: there is always a bank between them', () => {
  for (const lake of lakes) each(lake, (x, z) => {
    if (!WATERS.has(colourAt(x, z))) return;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.ok(!SOIL.has(colourAt(x + a, z + b)), `grass by water at ${x},${z}`);
  });
});
test('a big lake is shallow at its edge and deep in the middle', () => {
  for (const lake of big) {
    let edge = 0, edgeShallow = 0, middle = 0, middleDeep = 0;
    each(lake, (x, z) => {
      const p = lake.land(x, z), c = colourAt(x, z); if (!WATERS.has(c)) return;
      if (p > -1) { edge++; if (c === SHALLOW) edgeShallow++; }
      if (p < -12) { middle++; if (c === DEEP) middleDeep++; }
    });
    assert.ok(edgeShallow / edge > .95, `edge ${edgeShallow}/${edge}`);
    assert.ok(middleDeep / middle > .85, `middle ${middleDeep}/${middle}`);
  }
});
test('a small pond still goes from shallow to deeper', () => {
  for (const lake of small) { const seen = new Set(); each(lake, (x, z) => seen.add(colourAt(x, z))); assert.ok(seen.has(SHALLOW) && seen.has(hex('#0b8a8f').join()), `${lake.w}x${lake.d}`); }
});
test('a pond is not a rectangle: its corners are grass', () => {
  for (const lake of small) for (const [x, z] of [[lake.x, lake.z + lake.d - 1], [lake.x + lake.w - 1, lake.z]]) assert.ok(SOIL.has(colourAt(x, z)), `${x},${z}`);
});
test('reeds grow at the water\'s edge, lilies lie out on it, and neither is everywhere', () => {
  for (const lake of big) {
    const standing = propsIn(lake).filter(({ stack }) => [0, 1, 2].some(n => stack === reeds(n)));
    assert.ok(standing.length >= 6, `${standing.length} reeds`);
    for (const { x, z } of standing) assert.ok(Math.abs(lake.past(x, z)) < 3, `reeds ${lake.past(x, z)} from the shore`);
    let lilies = 0; each(lake, (x, z) => { if (lake.land(x, z) < 0 && LILIES.has(colourAt(x, z))) lilies++; });
    assert.ok(lilies >= 12 && lilies < 400, `${lilies} lily cells`);
  }
  assert.ok(small.some(lake => propsIn(lake).some(({ stack }) => [0, 1, 2].some(n => stack === reeds(n)))), 'reeds by a pond');
});
test('a big lake has a path right round it, joined to the street, and lamps along it', () => {
  const TRAIL = hex('#ab947a').join();
  for (const lake of big) {
    // Only the shadows of the path's own lamps may fall on it.
    let shaded = 0;
    for (let i = 0; i < 90; i++) { const [x, z] = lake.at(i / 90 * 2 * Math.PI, lake.trail + 1), colour = colourAt(x, z); if (colour === TRAIL_IN_SHADE) shaded++; else assert.equal(colour, TRAIL, `off the path at ${x},${z}`); }
    assert.ok(shaded <= 9, `${shaded} of the path in shadow`);
    let edges = 0;
    for (let x = lake.x; x < lake.x + lake.w; x++) { if (colourAt(x, lake.z) === TRAIL) edges++; if (colourAt(x, lake.z + lake.d - 1) === TRAIL) edges++; }
    for (let z = lake.z; z < lake.z + lake.d; z++) { if (colourAt(lake.x, z) === TRAIL) edges++; if (colourAt(lake.x + lake.w - 1, z) === TRAIL) edges++; }
    assert.ok(edges >= 6, `${edges} path cells at the edge`);
    const lamps = propsIn(lake).filter(({ stack }) => stack === lamp()).filter(({ x, z }) => Math.abs(lake.past(x, z) - lake.trail - 1) < 3);
    assert.ok(lamps.length >= 5, `${lamps.length} lamps on the path`);
  }
});
test('a jetty runs out over the water from the path, with a boat tied up and a lamp at its end', () => {
  for (const lake of big) {
    const { jetty } = lake;
    let wet = 0, shaded = 0;
    // Its lamp's shadow falls along the planks, in the dark that planks go in a shadow.
    for (const [x, z] of jetty.cells) if (lake.past(x, z) < 0) { wet++; if (colourAt(x, z) === PLANK_IN_SHADE) shaded++; else assert.ok(PLANKS.has(colourAt(x, z)), `no plank at ${x},${z}: ${colourAt(x, z)}`); }
    assert.ok(wet >= 30, `${wet} cells out over the water`);
    assert.ok(shaded <= 16, `${shaded} of the planks in shadow`);
    const [ex, ez] = jetty.end;
    assert.ok(lake.past(ex, ez) < -8, `ends ${lake.past(ex, ez)} out`);
    assert.ok(propsIn(lake).some(({ stack, x, z }) => stack === lamp() && Math.hypot(x - ex, z - ez) < 4), 'no lamp at the end');
    const boats = propsIn(lake).filter(({ stack }) => stack === rowboat(true) || stack === rowboat(false));
    assert.equal(boats.length, 1);
    assert.ok(lake.past(boats[0].x, boats[0].z) < -2, 'the boat is afloat');
  }
});
test('nothing but a lake\'s own things stands in it, and trees keep back from the path', () => {
  for (const lake of big) for (const { x, z, stack } of propsIn(lake)) {
    if (stack.h <= 9 || lake.islet && Math.hypot(x - lake.islet.x, z - lake.islet.z) < lake.islet.r) continue;
    assert.ok(lake.past(x, z) > lake.trail + 3, `a tree ${lake.past(x, z)} from the shore`);
  }
});
test('some big lakes have an islet with a tree on it, and the water goes round it', () => {
  const many = Array.from({ length: 24 }, (_, i) => lakeOf(seeded(`isle${i}`), 0, 0, 164, 164, true)), isles = many.filter(lake => lake.islet);
  assert.ok(isles.length > 4 && isles.length < 20, `${isles.length}`);
  for (const lake of isles) {
    const { x, z, r } = lake.islet;
    assert.ok(lake.land(x, z) > 0, 'land in the middle');
    assert.ok(lake.past(x, z) < -r - 6, 'with water all round');
    assert.ok(lake.land(x + r + 2, z) < 0);
    for (const [jx, jz] of lake.jetty.cells) assert.ok(Math.hypot(jx - x, jz - z) > r + 3, 'clear of the jetty');
  }
  assert.ok(many.some(lake => !lake.islet));
});
test('lakes shimmer: their water moves frame by frame, and only their water', () => {
  const inLake = (x, z) => big.some(lake => lake.past(x, z) < 0 && x >= lake.x && z >= lake.z && x < lake.x + lake.w && z < lake.z + lake.d);
  let shore = 0; for (let i = 0; i < cells.water.shore.length; i += 2) if (inLake(cells.water.shore[i], cells.water.shore[i + 1])) shore++;
  let glint = 0; for (let i = 0; i < cells.water.glint.length; i += 2) if (inLake(cells.water.glint[i], cells.water.glint[i + 1])) glint++;
  assert.ok(shore > 200 * big.length, `${shore} shore cells`);
  assert.ok(glint > 10 * big.length, `${glint} glints`);
  for (let i = 0; i < cells.water.shore.length; i += 2) {
    const x = cells.water.shore[i], z = cells.water.shore[i + 1];
    if (inLake(x, z)) assert.ok(WATERS.has(colourAt(x, z)), `moving cell on ${colourAt(x, z)} at ${x},${z}`);
  }
  const lake = big[0], on = frame => { const list = seaFrame(cells.water, frame, 0), out = []; const [left] = screen(lake.x, lake.z + lake.d, 0), [right] = screen(lake.x + lake.w, lake.z, 0), [, top] = screen(lake.x, lake.z, 0), [, bottom] = screen(lake.x + lake.w, lake.z + lake.d, 0); for (let i = 0; i < list.length; i += 3) if (list[i] > left && list[i] < right && list[i + 1] > top && list[i + 1] < bottom) out.push(`${list[i]},${list[i + 1]},${list[i + 2]}`); return out.join(); };
  assert.notEqual(on(0), on(3 % SEA_FRAMES));
  assert.ok(on(0).length > 0);
});
test('ducks swim round on open water, never through the jetty or the reeds', () => {
  for (let now = 0; now < 600000; now += 1700) for (const { x, z, lake } of ducksAt(big, now)) {
    assert.ok(lake.land(x, z) < -3, `${lake.land(x, z)} at ${x},${z}`);
    assert.ok(lake.jetty.cells.every(([a, b]) => Math.hypot(a - x, b - z) > 3), 'on the jetty');
  }
});
test('ducks keep together, move slowly and turn back', () => {
  assert.deepEqual(ducksAt([], 1000), []);
  const one = big.slice(0, 1), first = ducksAt(one, 5000);
  assert.ok(first.length >= 3 && first.length <= 4, `${first.length}`);
  for (const a of first) assert.ok(Math.hypot(a.x - first[0].x, a.z - first[0].z) < 22, 'a family');
  assert.equal(first.filter(({ young }) => !young).length, 1);
  const ways = new Set();
  for (let now = 0; now < 800000; now += 400) {
    const here = ducksAt(one, now), next = ducksAt(one, now + 400);
    here.forEach((d, i) => assert.ok(Math.hypot(next[i].x - d.x, next[i].z - d.z) <= 3, 'a duck does not jump'));
    ways.add(`${here[0].along}${here[0].dir}`);
  }
  assert.equal(ways.size, 4, [...ways].join());
});
test('reeds, ducks and rowing boats are low, so they hide nothing', () => {
  for (const stack of [reeds(0), reeds(1), reeds(2), duck(true, 1, false), duck(false, -1, true), rowboat(true), rowboat(false)]) assert.ok(stack.h <= 8, `${stack.h}`);
  assert.equal(reeds(1), reeds(1));
  assert.equal(rowboat(true), rowboat(true));
  assert.equal(duck(true, 1, true), duck(true, 1, true));
  assert.notEqual(duck(true, 1, true), duck(true, -1, true));
});
test('lakes are the same at night, on night soil', () => {
  const night = groundCells(plan, 'night'), lake = big[0], [x, z] = lake.at(1, -1), i = (Math.floor(x) - night.x0 + (Math.floor(z) - night.z0) * night.w) * 3;
  assert.ok(WATERS.has(`${night.rgb[i]},${night.rgb[i + 1]},${night.rgb[i + 2]}`));
  assert.notDeepEqual(soilOf('night').land, soilOf('day').land);
});
