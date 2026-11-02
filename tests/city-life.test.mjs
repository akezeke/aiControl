import test from 'node:test';
import assert from 'node:assert/strict';
import { birdsAt, BIRD_EVERY, cloudsAt, cloudBlob, CLOUDS } from '../client/city/surroundings.js';
import { groundCells } from '../client/city/ground.js';
import { cityPlan } from '../client/city/plan.js';
import { lamp, fountain } from '../client/city/generator.js';

const bounds = { w: 600, d: 500 };

test('birds cross now and then, in a flock, and most of the time there are none', () => {
  let flying = 0, seen = 0;
  for (let now = 0; now < BIRD_EVERY * 4; now += 500) { seen++; if (birdsAt(bounds, now).length) flying++; }
  assert.ok(flying > 0, 'they come');
  assert.ok(flying < seen * .6, `${flying} of ${seen}`);
  assert.equal(birdsAt(bounds, 2000).length, 5);
});
test('a flock goes right across the city, in a new place each time', () => {
  const lines = new Set();
  for (let pass = 0; pass < 8; pass++) {
    const start = birdsAt(bounds, pass * BIRD_EVERY + 1)[0];
    let end = start;
    for (let now = pass * BIRD_EVERY; now < (pass + 1) * BIRD_EVERY; now += 200) end = birdsAt(bounds, now)[0] ?? end;
    assert.ok(Math.hypot(end.x - start.x, end.z - start.z) > Math.min(bounds.w, bounds.d), `pass ${pass}`);
    lines.add(`${start.x},${start.z}`);
  }
  assert.ok(lines.size >= 4, `${lines.size} routes`);
});
test('wings beat, and a flock holds together', () => {
  const a = birdsAt(bounds, 2000), wings = new Set();
  for (let now = 2000; now < 3000; now += 60) wings.add(birdsAt(bounds, now)[0].wings);
  assert.deepEqual([...wings].sort(), [0, 1]);
  for (const bird of a) assert.ok(Math.hypot(bird.x - a[0].x, bird.z - a[0].z) < 30);
});

test('a few cloud shadows drift smoothly, and come round again', () => {
  const a = cloudsAt(bounds, 100000);
  assert.equal(a.length, CLOUDS);
  assert.ok(CLOUDS <= 3);
  const moved = new Set();
  for (let now = 0; now < 2000000; now += 400) {
    const here = cloudsAt(bounds, now), next = cloudsAt(bounds, now + 400);
    here.forEach((cloud, i) => { const step = Math.hypot(next[i].x - cloud.x, next[i].z - cloud.z); if (step < 100) assert.ok(step <= 3, `${step} in a tick`); else moved.add(i); });
  }
  assert.equal(moved.size, CLOUDS, 'each wraps round');
});
test('clouds keep to the air over the island, and differ', () => {
  const margin = 400;
  for (let now = 0; now < 900000; now += 5000) for (const { x, z } of cloudsAt(bounds, now)) assert.ok(x > -margin && x < bounds.w + margin && z > -margin && z < bounds.d + margin, `${x},${z}`);
  assert.ok(new Set(cloudsAt(bounds, 0).map(({ shape }) => shape)).size > 1);
});
test('a cloud is a chunky blob, narrower at top and bottom', () => {
  const { w, h, rows } = cloudBlob(1);
  assert.equal(rows.length, h);
  assert.ok(w > 120 && w <= 280 && h > 50 && h <= 140, `${w}x${h}`);
  for (const [from, length] of rows) assert.ok(from >= 0 && from + length <= w && length >= 0);
  const widest = Math.max(...rows.map(([, length]) => length));
  assert.ok(rows[0][1] < widest && rows.at(-1)[1] < widest);
  assert.deepEqual(cloudBlob(1), cloudBlob(1));
  assert.notDeepEqual(cloudBlob(1), cloudBlob(2));
});

// Empty grid cells become big parks, and plenty of neighbourhoods give plenty of small ones.
const pods = Array.from({ length: 12 }, (_, i) => ({ key: `p${i}`, name: `project-${i}`, cwd: `/p${i}`, col: i % 4, row: (i * 2) % 12 }));
const plan = cityPlan({ pods, desks: new Map(), grid: { cols: 4 } }, {}, null, [], [], ['']);
const cells = groundCells(plan);
const colourAt = (x, z) => { const i = (Math.floor(x) - cells.x0 + (Math.floor(z) - cells.z0) * cells.w) * 3; return `${cells.rgb[i]},${cells.rgb[i + 1]},${cells.rgb[i + 2]}`; };
const within = (place, inset = 0) => ({ x, z }) => x >= place.x + inset && z >= place.z + inset && x < place.x + place.w - inset && z < place.z + place.d - inset;
const tally = place => { const seen = new Map(); for (let b = 0; b < place.d; b++) for (let a = 0; a < place.w; a++) { const c = colourAt(place.x + a, place.z + b); seen.set(c, (seen.get(c) || 0) + 1); } return seen; };
const WATER = '11,94,101', TRAIL = '171,148,122', FLOWER = '251,185,84';
const fountainSize = fountain().h, isLamp = ({ stack }) => stack === lamp(), isFountain = ({ stack }) => stack !== lamp() && stack.h === fountainSize, isTree = prop => !isLamp(prop) && !isFountain(prop);

test('big parks come in several kinds, each with lamps, and trees clear of them', () => {
  assert.ok(plan.parks.length >= 12, `${plan.parks.length} parks`);
  const kinds = new Set();
  for (const park of plan.parks) {
    const inside = cells.props.filter(within(park)), seen = tally(park), lamps = inside.filter(isLamp), trees = inside.filter(isTree);
    assert.ok(lamps.length >= 4, `${lamps.length} lamps`);
    for (const a of lamps) for (const b of trees) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 2.5, 'a tree on a lamp');
    kinds.add((seen.get(WATER) ?? 0) > 400 ? 'pond' : inside.some(isFountain) ? 'garden' : trees.length >= 20 ? 'grove' : 'other');
  }
  assert.deepEqual([...kinds].sort(), ['garden', 'grove', 'pond']);
});
test('small parks come in several kinds, each with a lamp and nothing tall but trees', () => {
  const parks = plan.parcels.filter(({ kind }) => kind === 'park');
  assert.ok(parks.length > 15, `${parks.length} small parks`);
  const kinds = new Set();
  for (const park of parks) {
    const inside = cells.props.filter(within(park)), seen = tally(park), trees = inside.filter(isTree);
    assert.ok(inside.some(isLamp), 'a lamp');
    kinds.add((seen.get(FLOWER) ?? 0) > 10 ? 'beds' : (seen.get(TRAIL) ?? 0) > 10 ? 'trail' : trees.length >= 4 ? 'orchard' : 'other');
  }
  assert.deepEqual([...kinds].sort(), ['beds', 'orchard', 'trail']);
});
test('a cloud is round at its ends, not cut off square by the edge of its picture', () => {
  for (let shape = 0; shape < 12; shape++) {
    const { w, h, rows } = cloudBlob(shape), touching = rows.filter(([from, length]) => length && (from <= 0 || from + length >= w)).length;
    assert.ok(touching < h * .2, `shape ${shape}: ${touching} of ${h} rows run into the edge`);
  }
});
