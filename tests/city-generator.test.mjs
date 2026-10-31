import test from 'node:test';
import assert from 'node:assert/strict';
import { CROWNS, MASSES, tower } from '../client/city/identity.js';
import { STOREY, annex, buildTower } from '../client/city/generator.js';

const footprint = stack => { const l = stack.layers.find(Boolean); return [l.x0, l.x1, l.z0, l.z1]; };
const raw = stack => stack.layers.flatMap(l => l ? [...l.data] : []);
const colours = stack => { const s = new Set(); for (const l of stack.layers) if (l) for (let i = 0; i < l.data.length; i += 4) if (l.data[i + 3]) s.add([l.data[i], l.data[i + 1], l.data[i + 2]].join()); return s; };
test('storeys N and N+1 keep the same footprint, crown and wall colours', () => {
  const look = tower('steady');
  for (let n = 4; n < 12; n++) {
    const a = buildTower(look, 'dark', n), b = buildTower(look, 'dark', n + 1);
    assert.deepEqual(footprint(a.stack), footprint(b.stack)); assert.equal(b.top - a.top, STOREY); assert.deepEqual(colours(a.stack), colours(b.stack));
    for (let y = a.top + 1; y < a.stack.layers.length; y++) assert.deepEqual(a.stack.layers[y]?.data, b.stack.layers[y + STOREY]?.data);
  }
});
test('every crown and mass builds at 4 and at 12', () => {
  for (const crown of CROWNS) for (const mass of MASSES) for (const n of [4, 12]) {
    const b = buildTower({ ...tower('x'), crown, mass }, 'dark', n); assert.ok(b.top >= n * STOREY); assert.ok(b.stack.layers.some(Boolean));
  }
});
test('window state changes no wall colour and phase only moves lamps', () => {
  const look = { ...tower('lamps'), crown: 'Spire' }, dark = colours(buildTower(look, 'dark', 8).stack), lit = colours(buildTower(look, 'lit', 8).stack);
  for (const c of dark) assert.ok(lit.has(c), c);
  assert.notDeepEqual(raw(buildTower(look, 'lit', 8, 0).stack), raw(buildTower(look, 'lit', 8, 1).stack));
});
test('annexes build for all three spots at 2 and 4 storeys', () => { for (const i of [0, 1, 2]) for (const n of [2, 4]) assert.ok(annex(tower('kid'), i, 'lit', n).top >= n * STOREY); });
