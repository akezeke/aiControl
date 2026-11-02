import test from 'node:test';
import assert from 'node:assert/strict';
import { CROWNS, lookOf, tower } from '../client/city/identity.js';

test('same id gives the same look; lookOf restores it', () => {
  assert.deepEqual(tower('abc'), tower('abc'));
  const t = tower('abc', new Set(['Red Spire'])); assert.deepEqual(lookOf('abc', t.name), t);
});
test('ten live sessions all differ in colour and in crown', () => {
  const taken = new Set(), looks = [...Array(10).keys()].map(i => tower(`s${i}`, taken));
  assert.equal(new Set(looks.map(l => l.colour)).size, 10);
  assert.equal(new Set(looks.map(l => l.crown)).size, 10);
});
test('past a hundred live sessions it still returns a valid look', () => {
  const taken = new Set(); for (let i = 0; i < 150; i++) { const t = tower(`s${i}`, taken); assert.ok(CROWNS.includes(t.crown)); assert.ok([14, 16, 18].includes(t.w)); }
});
test('an unknown persisted name falls back to the hashed look', () => assert.deepEqual(lookOf('abc', 'Plaid Moat'), tower('abc')));
