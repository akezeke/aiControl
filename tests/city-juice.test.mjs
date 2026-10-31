import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hop, hum, sparks, HOP_MS, PHASE_MS, phaseAt, SPARK_MS, circuits, carAt, traffic, CARS_PER_BLOCK, BURSTS, burst, momentOf, jibBeat, JIB_MS } from '../client/city/juice.js';
import { buildTower, annex, crane, craneSpot, coolingPlant, stackPlant, siteCrane, JIB_BEATS } from '../client/city/generator.js';
import { renderSprite, SCREEN } from '../client/city/sprite.js';
import { ROAD } from '../client/city/plan.js';
import { tower } from '../client/city/identity.js';

const raw = stack => JSON.stringify(stack.layers.map(layer => layer ? [...layer.data] : 0));
const look = (crown, id = 'tower-a') => ({ ...tower(id), crown, mass: 'slab', windows: 'strips' });
const crownOf = (stack, storeys) => JSON.stringify(stack.layers.slice(storeys * 3 + 2).map(layer => layer ? [...layer.data] : 0));

test('a hop squashes, leaves the ground, lands squashed and comes to rest', () => {
  const at = t => hop(t);
  assert.deepEqual(at(0), { lift: 0, squash: 0 });
  assert.ok(at(HOP_MS * .1).squash > 0, 'crouches first');
  assert.equal(at(HOP_MS * .1).lift, 0);
  const air = at(HOP_MS * .4);
  assert.ok(air.lift >= 3); assert.equal(air.squash, 0);
  assert.ok(at(HOP_MS * .9).squash > 0, 'lands heavily');
  assert.equal(at(HOP_MS * .9).lift, 0);
  assert.equal(at(HOP_MS), null);
  assert.deepEqual(at(-5), { lift: 0, squash: 0 }, 'a frame stamped just before the click is not the end of the hop');
  for (let t = 0; t < HOP_MS; t += 7) { const { lift, squash } = at(t); assert.ok(Number.isInteger(lift) && Number.isInteger(squash), 'whole art pixels'); }
});
test('a working tower gives a small thump now and then, each at its own time', () => {
  let on = 0; for (let t = 0; t < 2400; t += 10) on += hum(t, 'a');
  assert.ok(on > 0 && on < 240 * .2, `${on} of 240`);
  for (let t = 0; t < 2400; t += 10) assert.ok([0, 1].includes(hum(t, 'a')));
  const times = id => { const out = []; for (let t = 0; t < 2400; t += 10) if (hum(t, id)) out.push(t); return out.join(); };
  assert.notEqual(times('a'), times('another'));
});
test('sparks rise from the roof and go out', () => {
  const seen = []; for (let t = 0; t < SPARK_MS * 40; t += SPARK_MS) seen.push(sparks(t, 'a'));
  assert.ok(seen.some(list => list.length), 'some');
  assert.ok(seen.every(list => list.length <= 3), 'not many');
  for (const list of seen) for (const s of list) { assert.ok(s.y < 0, 'above the roof'); assert.ok(Math.abs(s.x) <= 6, 'over the building'); assert.match(s.colour, /^#/); assert.ok(Number.isInteger(s.x) && Number.isInteger(s.y)); }
  assert.deepEqual(sparks(SPARK_MS * 3 + 1, 'a'), sparks(SPARK_MS * 3 + 2, 'a'), 'only changes by the step');
});
test('the phase runs through four, offset per building', () => {
  const list = []; for (let i = 0; i < 8; i++) list.push(phaseAt(i * PHASE_MS, 'a'));
  assert.deepEqual([...new Set(list)].sort(), [0, 1, 2, 3]);
  assert.ok(['b', 'c', 'd', 'e', 'f'].some(id => phaseAt(0, id) !== phaseAt(0, 'a') || phaseAt(PHASE_MS * .5, id) !== phaseAt(PHASE_MS * .5, 'a')));
});
test('lamps roll: each phase moves a few lamps, not all of them, and comes back round', () => {
  const t = look('Spire'), phases = [0, 1, 2, 3].map(p => buildTower(t, 'lit', 12, p).stack), flat = phases.map(s => s.layers.flatMap(layer => layer ? [...layer.data] : []));
  for (let p = 0; p < 4; p++) {
    const a = flat[p], b = flat[(p + 1) % 4]; let moved = 0, on = 0;
    for (let i = 0; i < a.length; i += 4) { if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) moved++; if (a[i + 3]) on++; }
    assert.ok(moved > 0, `phase ${p} to the next`);
    assert.ok(moved / on < .12, `phase ${p} moved ${moved} of ${on}`);
  }
  assert.equal(raw(buildTower(t, 'lit', 12, 4).stack), raw(phases[0]), 'wraps');
});
test('a dark tower is the same in every phase, whatever its crown', () => {
  for (const crown of ['Spire', 'Dish']) { const t = look(crown); assert.equal(raw(buildTower(t, 'dark', 8, 0).stack), raw(buildTower(t, 'dark', 8, 2).stack)); }
});
test('crowns with moving parts move', () => {
  for (const crown of ['Flag', 'Ring', 'Clock', 'Mast']) {
    const seen = new Set([0, 1, 2, 3].map(p => crownOf(buildTower(look(crown), 'dim', 8, p).stack, 8)));
    assert.ok(seen.size >= 2, crown);
  }
});
test('annexes roll their lamps too', () => {
  // A small building has few windows, so one may happen to stay as it is. Most don't.
  let moved = 0;
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) { const t = look('Spire', id); if (new Set([0, 1, 2, 3].map(p => raw(annex(t, 0, 'lit', 4, p).stack))).size >= 2) moved++; }
  assert.ok(moved >= 6, `${moved} of 8`);
  const t = look('Spire');
  assert.equal(raw(annex(t, 0, 'dark', 4, 0).stack), raw(annex(t, 0, 'dark', 4, 3).stack));
});
test('steam moves up the plumes, and stays put when there is none', () => {
  for (const make of [coolingPlant, stackPlant]) {
    assert.equal(new Set([0, 1, 2, 3].map(p => raw(make('#0eaf9b', true, true, p)))).size, 4);
    assert.equal(new Set([0, 1, 2, 3].map(p => raw(make('#0eaf9b', false, true, p)))).size, 1);
  }
});

const roads = { xs: [2, 200, 400], zs: [2, 180] };
const lap = c => 2 * (c.x1 - c.x0 + c.z1 - c.z0);

test('each block has one circuit, in the lane nearest it, on the roads around it', () => {
  const loops = circuits(roads);
  assert.equal(loops.length, 2);
  for (const c of loops) for (const [x, z] of [[c.x0, c.z0], [c.x1, c.z1]]) {
    assert.ok(roads.xs.some(r => x >= r && x <= r + ROAD), `x ${x}`);
    assert.ok(roads.zs.some(r => z >= r && z <= r + ROAD), `z ${z}`);
  }
  // A road between two blocks carries both: their lanes don't touch, so nothing ever drives through anything.
  assert.ok(loops[0].x1 < loops[1].x0);
});

test('a car goes all the way round its circuit at one speed, facing the way it goes, and ends where it began', () => {
  const c = circuits(roads)[0], steps = 2000;
  let last = carAt(c, 0);
  for (let i = 1; i <= steps; i++) {
    const at = carAt(c, (i % steps) / steps), dx = Math.abs(at.x - last.x), dz = Math.abs(at.z - last.z);
    assert.ok(Math.abs(dx + dz - lap(c) / steps) < 1e-6, `jump at ${i}`);
    assert.ok(at.x === c.x0 || at.x === c.x1 || at.z === c.z0 || at.z === c.z1, 'stays on the circuit');
    if (!(dx && dz)) assert.equal(last.along, dx > 0, `facing at ${i}`); // Unless the step went round a corner.
    last = at;
  }
  assert.equal(carAt(c, .1).along, true);
  assert.equal(carAt(c, 0).x, c.x0);
});

test('no towers awake, no cars; a car for each one that is, in its block', () => {
  assert.deepEqual(traffic(roads, [], 5000), []);
  const cars = traffic(roads, [{ id: 'a', x: 90, z: 90 }, { id: 'b', x: 300, z: 90 }], 5000), loops = circuits(roads);
  assert.equal(cars.length, 2);
  const inside = (car, c) => car.x >= c.x0 && car.x <= c.x1 && car.z >= c.z0 && car.z <= c.z1;
  assert.ok(inside(cars.find(car => car.id === 'a'), loops[0]));
  assert.ok(inside(cars.find(car => car.id === 'b'), loops[1]));
});

test('a block holds only so many cars, and they keep their distance', () => {
  const busy = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, x: 90, z: 90 })), c = circuits(roads)[0];
  const cars = traffic(roads, busy, 7000);
  assert.equal(cars.length, CARS_PER_BLOCK);
  for (const a of cars) for (const b of cars) if (a !== b) assert.ok(Math.abs(a.x - b.x) + Math.abs(a.z - b.z) > 20 || lap(c) < 60, 'bumper to bumper');
});

test('a car keeps its place when another joins or leaves the block', () => {
  const busy = ['a', 'b', 'c'].map(id => ({ id, x: 90, z: 90 }));
  const all = traffic(roads, busy, 9000), one = traffic(roads, busy.slice(0, 1), 9000);
  const pick = (cars, id) => { const { x, z, colour } = cars.find(car => car.id === id); return { x, z, colour }; };
  assert.deepEqual(pick(one, 'a'), pick(all, 'a'));
});

test('traffic moves with time and repeats exactly', () => {
  const busy = [{ id: 'a', x: 90, z: 90 }], a = traffic(roads, busy, 1000)[0], b = traffic(roads, busy, 2000)[0];
  assert.deepEqual(traffic(roads, busy, 1000)[0], a);
  assert.notDeepEqual([a.x, a.z], [b.x, b.z]);
  assert.ok(a.colour.startsWith('#'));
});

for (const kind of Object.keys(BURSTS)) test(`a ${kind} burst has whole pixels while it lasts, the same every time, and then it's over`, () => {
  const { ms } = BURSTS[kind];
  assert.equal(burst(kind, ms, 'x'), null);
  assert.equal(burst(kind, ms + 500, 'x'), null);
  for (const t of [.1, .3, .5, .7, .9]) {
    const pixels = burst(kind, ms * t, 'x');
    assert.deepEqual(burst(kind, ms * t, 'x'), pixels);
    assert.ok(pixels.length > 0 && pixels.length < 200, `${kind} at ${t}: ${pixels.length}`);
    for (const { x, y, colour } of pixels) { assert.ok(Number.isInteger(x) && Number.isInteger(y)); assert.match(colour, /^#[0-9a-f]{6}$/); }
  }
});

const reach = pixels => Math.max(...pixels.map(({ x }) => Math.abs(x)));
test('fireworks go up, and spread as they burst', () => {
  const { ms } = BURSTS.finish, early = burst('finish', ms * .15, 's'), late = burst('finish', ms * .6, 's');
  assert.ok(early.every(({ y }) => y <= 0));
  assert.ok(reach(late) > reach(early));
  assert.ok(Math.min(...late.map(({ y }) => y)) < -12, 'clears the roof');
});
test('a call for help spreads out over the ground; a tap closes in on where you pressed', () => {
  assert.ok(reach(burst('ask', BURSTS.ask.ms * .7, 's')) > reach(burst('ask', BURSTS.ask.ms * .1, 's')));
  assert.ok(reach(burst('tap', BURSTS.tap.ms * .8, 's')) < reach(burst('tap', BURSTS.tap.ms * .1, 's')));
});
test('rubble stays above the ground it falls on', () => {
  for (const t of [.1, .5, .9]) assert.ok(burst('fall', BURSTS.fall.ms * t, 's').every(({ y }) => y <= 0));
});
test('rings lie on the ground under the buildings, and what flies is in front of them', () => {
  assert.ok(BURSTS.ask.ground && BURSTS.fail.ground && BURSTS.tap.ground && BURSTS.spawn.ground);
  assert.ok(!BURSTS.finish.ground && !BURSTS.grow.ground && !BURSTS.fall.ground);
  assert.ok(BURSTS.finish.crown && BURSTS.grow.crown);
});

const was = { twinkle: true, beacon: false, smoke: false, asleep: false, storeys: 5 };
test('what a change in a building is worth celebrating', () => {
  assert.equal(momentOf(was, { ...was, twinkle: false }), 'finish');
  assert.equal(momentOf(was, { ...was, twinkle: false, beacon: true }), 'ask');
  assert.equal(momentOf({ ...was, twinkle: false }, { ...was, twinkle: false, beacon: true }), 'ask');
  assert.equal(momentOf(was, { ...was, twinkle: false, smoke: true }), 'fail');
  assert.equal(momentOf(was, { ...was, storeys: 6 }), 'grow');
  assert.equal(momentOf(was, was), null);
  assert.equal(momentOf(was, { ...was, storeys: 4 }), null, 'a compaction has its own dust');
  assert.equal(momentOf(was, { ...was, twinkle: false, asleep: true }), 'finish', 'done, and off to sleep');
  assert.equal(momentOf(was, { ...was, twinkle: false, asleep: true, offline: true }), null, 'going offline is no triumph');
  assert.equal(momentOf({ ...was, twinkle: false }, was), null, 'nor is starting work');
  assert.equal(momentOf(null, was), null);
});

// One silhouette, hook and load included. The renderer samples each screen pixel at a single point, which can miss a part one voxel thick altogether.
const pieces = ({ mask, width, height }) => {
  const seen = new Uint8Array(mask.length); let count = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    count++; seen[start] = 1;
    for (const stack = [start]; stack.length;) {
      const at = stack.pop(), x = at % width, y = (at - x) / width;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy, next = X + Y * width;
        if (X >= 0 && Y >= 0 && X < width && Y < height && mask[next] && !seen[next]) { seen[next] = 1; stack.push(next); }
      }
    }
  }
  return count;
};
test('a crane stays in one piece in every view, however its jib is turned', () => {
  for (let view = 0; view < 4; view++) {
    for (const mast of [28, 36, 52]) for (let beat = 0; beat < JIB_BEATS; beat++) assert.equal(pieces(renderSprite(siteCrane(beat, mast, view).stack, view)), 1, `site crane, view ${view}, mast ${mast}, beat ${beat}`);
    assert.equal(pieces(renderSprite(crane(true), view)), 1, `rising crane, view ${view}`);
  }
});
test('in every view a crane stands to the right of its tower and reaches back over it, so it never hides the tower', () => {
  for (let view = 0; view < 4; view++) {
    const [sx, sy] = SCREEN[view](...craneSpot(view));
    assert.ok(sx > 0 && sy === 0, `view ${view}`);
    for (let beat = 0; beat < JIB_BEATS; beat++) { const { originX, width } = renderSprite(siteCrane(beat, 36, view).stack, view); assert.ok(originX > 20 && width - originX < originX, `view ${view}, beat ${beat}`); }
  }
});
test("a site crane's jib swings, and its mast stays where it is", () => {
  const frames = Array.from({ length: JIB_BEATS }, (_, beat) => siteCrane(beat, 30).stack);
  assert.ok(new Set(frames.map(raw)).size > 3);
  const mast = stack => JSON.stringify(stack.layers.slice(0, 20).map(layer => layer ? [...layer.data] : 0));
  assert.equal(new Set(frames.map(mast)).size, 1);
  assert.equal(raw(frames[1]), raw(siteCrane(1, 30).stack));
  assert.notEqual(raw(siteCrane(0, 30).stack), raw(siteCrane(0, 42).stack));
});
test('each crane keeps time on its own, one beat after another', () => {
  const beats = Array.from({ length: 9 }, (_, i) => jibBeat(1000 + i * JIB_MS, 'a', JIB_BEATS));
  for (let i = 1; i < beats.length; i++) assert.equal(beats[i], (beats[i - 1] + 1) % JIB_BEATS);
  assert.notEqual(new Set(['a', 'b', 'c', 'd', 'e'].map(id => jibBeat(0, id, JIB_BEATS))).size, 1);
});
