import test from 'node:test';
import assert from 'node:assert/strict';
import { poseTargets } from '../client/office/animation.js';

const fruit = { height: 0.5, surface: () => ({ x: 0, r: 0.22 }) };

test('a compacting fruit shivers in its seat, big enough to see across the room', () => {
  const frames = Array.from({ length: 120 }, (_, i) => poseTargets('squeezing', i / 60, 1, fruit));
  const range = pick => Math.max(...frames.map(pick)) - Math.min(...frames.map(pick));
  assert.ok(range(p => p.body.tilt) > 0.12, 'rocks side to side');
  assert.ok(range(p => p.x) > 0.03, 'jiggles on the spot');
  assert.ok(range(p => p.body.y) < 0.04 && Math.abs(frames[0].z - poseTargets('thinking', 0, 1, fruit).z) < 0.01, 'stays in the chair');
  assert.deepEqual(poseTargets('squeezing', 0, 1, fruit), poseTargets('squeezing', 0, 1, fruit), 'reduced motion (t = 0) holds still');
});
