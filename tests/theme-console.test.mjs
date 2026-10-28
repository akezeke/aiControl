import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionMapPoints } from '../client/theme-console.js';

test('radar contacts close in on the centre the longer they wait for you', () => {
  const now = 1_000_000_000, session = (id, status, waited) => ({ id, status, requests: waited == null ? [] : [{ createdAt: now - waited }] });
  const points = sessionMapPoints([session('a', 'working'), session('b', 'question', 0), session('c', 'permission', 10 * 60_000)], now);
  const distance = id => { const p = points.find(point => point.session.id === id); return Math.hypot(p.x - 50, p.y - 50); };
  const fresh = sessionMapPoints([session('a', 'working'), session('b', 'working'), session('c', 'working')], now);
  const home = id => { const p = fresh.find(point => point.session.id === id); return Math.hypot(p.x - 50, p.y - 50); };
  assert.equal(distance('a'), home('a'));
  assert.equal(distance('b'), home('b'));
  assert.ok(Math.abs(distance('c') - home('c') * .2) < 1e-9);
});
