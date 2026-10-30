import test from 'node:test';
import assert from 'node:assert/strict';
import { course, roll, speedFor, height, GREEN, BALL } from '../client/office/golf.js';

test('a hole is the same every time, and every hole is makeable', () => {
  assert.deepEqual(course(7), course(7));
  for (let n = 1; n <= 14; n++) {
    const c = course(n);
    assert.ok([2, 3].includes(c.par), `hole ${n} par ${c.par}`);
    assert.ok(Math.abs(height(c, c.cup.x, c.cup.z)) < 1e-12); // the cup sits on the flat
  }
});

test('on the flat a putt stops where it was aimed; it never leaves the green', () => {
  const flat = { ...course(1), bumps: [], tilt: { x: 0, z: 0 }, things: [], cup: { x: -9, z: -9 } };
  const from = { x: GREEN.x0 + 0.3, z: 1.9 }, end = roll(flat, from, speedFor(2), 0);
  assert.ok(end.rest && Math.abs(end.x - from.x - 2) < 0.03, `stopped at ${end.x - from.x}`);
  const hard = roll(course(9), from, 3.8, 1.2);
  assert.ok(hard.x >= GREEN.x0 + BALL - 1e-9 && hard.x <= GREEN.x1 - BALL + 1e-9 && hard.z >= GREEN.z0 + BALL - 1e-9 && hard.z <= GREEN.z1 - BALL + 1e-9);
  assert.ok(hard.rest || hard.sunk);
});
