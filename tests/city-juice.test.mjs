import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hop, hum, sparks, HOP_MS, PHASE_MS, phaseAt, SPARK_MS } from '../client/city/juice.js';
import { buildTower, annex, coolingPlant, stackPlant } from '../client/city/generator.js';
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
