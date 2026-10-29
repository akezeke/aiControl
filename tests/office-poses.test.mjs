import test from 'node:test';
import assert from 'node:assert/strict';
import { poseTargets, waitingPose } from '../client/office/animation.js';

const fruit = { height: 0.5, surface: () => ({ x: 0, r: 0.22 }) };

test('a compacting fruit shivers in its seat, big enough to see across the room', () => {
  const frames = Array.from({ length: 120 }, (_, i) => poseTargets('squeezing', i / 60, 1, fruit));
  const range = pick => Math.max(...frames.map(pick)) - Math.min(...frames.map(pick));
  assert.ok(range(p => p.body.tilt) > 0.12, 'rocks side to side');
  assert.ok(range(p => p.x) > 0.03, 'jiggles on the spot');
  assert.ok(range(p => p.body.y) < 0.04 && Math.abs(frames[0].z - poseTargets('thinking', 0, 1, fruit).z) < 0.01, 'stays in the chair');
  assert.deepEqual(poseTargets('squeezing', 0, 1, fruit), poseTargets('squeezing', 0, 1, fruit), 'reduced motion (t = 0) holds still');
});

test('waiting on you gets louder: a raised hand, waving after two minutes, a tapping foot after ten', () => {
  const now = 1_000_000_000, ago = minutes => now - minutes * 60_000;
  assert.deepEqual([0.5, 3, 12].map(m => waitingPose(ago(m), now)), ['raising', 'waving', 'impatient']);
  const frames = Array.from({ length: 60 }, (_, i) => poseTargets('impatient', i / 6, 1, fruit));
  assert.ok(Math.max(...frames.map(p => p.limbs.rightFoot.y)) > 0.06, 'taps a foot');
  assert.ok(frames.every(p => p.z < -0.5), 'stands behind the chair');
  assert.ok(frames.every(p => p.elbows > 0 && p.limbs.rightHand.x < -fruit.surface(fruit.height * 0.32).r), 'a hand on the hip, outside the body');
  assert.ok(frames.some(p => p.glance) && frames.some(p => !p.glance), 'looks at the watch now and then');
});
