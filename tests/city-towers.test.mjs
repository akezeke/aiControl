import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CityTowers, PRUNE_MS, SHOWN_MS } from '../server/towers.mjs';

const file = () => join(mkdtempSync(join(tmpdir(), 'towers-')), 'city-towers.json');
const s = (id, used, extra = {}) => ({ id, status: 'working', ...(used === undefined ? {} : { context: { used, window: 200_000 } }), ...extra });
const storeys = (t, id, sessions, now = 1) => t.update(sessions, now)[id].storeys;
test('starts at the first value seen and grows', () => {
  const t = new CityTowers();
  assert.equal(storeys(t, 'a', [s('a', 100_000)]), 6);
  assert.equal(storeys(t, 'a', [s('a', 140_000)]), 7);
});
test('base and cap', () => {
  const t = new CityTowers();
  assert.equal(storeys(t, 'a', [s('a', 0)]), 4); assert.equal(storeys(t, 'b', [s('b', 9_000_000)]), 12);
  assert.equal(storeys(t, 'k', [s('k', 9_000_000, { parentId: 'b' })]), 4); assert.equal(storeys(t, 'j', [s('j', 0, { parentId: 'b' })]), 2);
});
test('a session without context stays at base and has a look', () => { const r = new CityTowers().update([s('a')], 1).a; assert.equal(r.storeys, 4); assert.ok(r.look); });
test('a compaction takes 2 storeys, and is counted once', () => {
  const t = new CityTowers();
  assert.equal(storeys(t, 'a', [s('a', 200_000)]), 9);
  assert.equal(storeys(t, 'a', [s('a', 200_000, { activity: 'compacting' })]), 7);
  assert.equal(storeys(t, 'a', [s('a', 200_000, { activity: 'compacting' })]), 7);
  assert.equal(storeys(t, 'a', [s('a', 60_000)]), 7);
});
test('a drop without a seen compaction costs the same', () => { const t = new CityTowers(); storeys(t, 'a', [s('a', 200_000)]); assert.equal(storeys(t, 'a', [s('a', 60_000)]), 7); });
test('a compaction at the cap takes 2 visible storeys', () => { const t = new CityTowers(); storeys(t, 'a', [s('a', 900_000)]); assert.equal(storeys(t, 'a', [s('a', 900_000, { activity: 'compacting' })]), 10); });
test('compaction floors at base', () => { const t = new CityTowers(); storeys(t, 'a', [s('a', 40_000)]); assert.equal(storeys(t, 'a', [s('a', 40_000, { activity: 'compacting' })]), 4); });
test('context dropping out of a poll costs nothing', () => {
  const t = new CityTowers(); storeys(t, 'a', [s('a', 200_000)]);
  assert.equal(storeys(t, 'a', [s('a')]), 9); assert.equal(storeys(t, 'a', [s('a', 0)]), 9); assert.equal(storeys(t, 'a', [s('a', 200_000)]), 9);
  assert.equal(storeys(t, 'a', [{ ...s('a'), context: { used: 'x' } }]), 9);
});
test('live looks differ and a look never changes', () => {
  const t = new CityTowers(), first = t.update([s('a'), s('b')], 1);
  assert.notEqual(first.a.look, first.b.look);
  assert.equal(t.update([s('a'), s('b'), s('c')], 2).a.look, first.a.look);
  assert.equal('look' in t.update([s('k', 0, { parentId: 'a' }), s('a')], 3).k, false);
});
test('a restart keeps storeys and look', () => {
  const f = file(), a = new CityTowers(f), before = a.update([s('a', 200_000)], 1).a;
  assert.deepEqual(new CityTowers(f).update([s('a', 200_000)], 2).a, before);
});
test('an ended session stays listed briefly; a stale one is pruned', () => {
  const t = new CityTowers(file()); t.update([s('a', 200_000)], 0);
  assert.equal(t.update([], SHOWN_MS - 1).a.storeys, 9);
  assert.equal(t.update([], SHOWN_MS).a, undefined);
  t.update([], PRUNE_MS); assert.equal(t.update([s('a')], PRUNE_MS + 1).a.storeys, 4);
});
test('a restart during a compaction does not count it twice', () => {
  const f = file(), a = new CityTowers(f); a.update([s('a', 200_000)], 1); assert.equal(a.update([s('a', 200_000, { activity: 'compacting' })], 2).a.storeys, 7);
  const b = new CityTowers(f); assert.equal(b.update([s('a', 200_000, { activity: 'compacting' })], 3).a.storeys, 7); assert.equal(b.update([s('a', 60_000)], 4).a.storeys, 7);
});
test('growth inside a storey leaves the file alone, and a restart still counts it', () => {
  const f = file(), a = new CityTowers(f); a.update([s('a', 200_000)], 1);
  const before = readFileSync(f, 'utf8');
  a.update([s('a', 215_000)], 2);
  assert.equal(readFileSync(f, 'utf8'), before);
  assert.equal(new CityTowers(f).update([s('a', 250_000)], 3).a.storeys, 10);
  const restarted = readFileSync(f, 'utf8');
  a.update([s('a', 240_000)], 4);
  assert.notEqual(readFileSync(f, 'utf8'), restarted);
});
test('a write failure keeps memory', () => { const t = new CityTowers('/nonexistent/dir/towers.json'); assert.equal(t.update([s('a', 200_000)], 1).a.storeys, 9); });
test('a corrupt file starts fresh', () => { const f = file(); writeFileSync(f, '{nope'); assert.equal(new CityTowers(f).update([s('a')], 1).a.storeys, 4); });
