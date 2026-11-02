import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chaseSpeed } from '../client/bridge/lights.js';

test('the floor rings stand still until warp, and run faster with it', () => {
  assert.equal(chaseSpeed(0), 0);
  assert.ok(chaseSpeed(.67) > 0 && chaseSpeed(1) > chaseSpeed(.67));
  assert.ok(Math.abs(chaseSpeed(1) - 1.85) < 1e-9);
});
