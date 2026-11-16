import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneFor, sceneAction } from '../client/scenes.js';
import { frameTime, refreshEvery } from '../client/scene-ui.js';

test('both looks resolve', () => {
  assert.equal(sceneFor('office').name, 'Office');
  assert.equal(sceneFor('bridge').name, 'Bridge');
  assert.equal(sceneFor('modern'), null);
  assert.equal(sceneFor(undefined), null);
});
test('fantasy resolves', () => { assert.equal(sceneFor('fantasy').name, 'Fantasy Battle'); });
test('nodes resolves', () => { assert.equal(sceneFor('nodes').name, 'Nodes'); });
test('city resolves and says what it needs', () => { assert.equal(sceneFor('city').name, 'Metropolis'); assert.equal(sceneFor('city').needs, 'Canvas'); assert.equal(sceneFor('bridge').needs, undefined); });
test('scene actions', () => {
  assert.equal(sceneAction(null, 'bridge', false), 'mount');
  assert.equal(sceneAction('bridge', 'bridge', false), 'keep'); // A colour switch: no remount.
  assert.equal(sceneAction('office', 'bridge', false), 'swap');
  assert.equal(sceneAction('bridge', 'office', false), 'swap');
  assert.equal(sceneAction('bridge', 'bridge', true), 'unmount'); // The list view.
  assert.equal(sceneAction('bridge', null, false), 'unmount'); // A theme with no scene.
  assert.equal(sceneAction(null, null, false), 'none');
  assert.equal(sceneAction(null, 'bridge', true), 'none');
});

// Going from the Office to the Bridge: a frame stamped before the Bridge finished mounting, 17 s back in software GL, took its camera's close-up with it.
test('a frame stamped before the scene was up takes no time, and a long one only so long', () => {
  assert.equal(frameTime(1000, 18000, 0.05), 0);
  assert.equal(frameTime(1016, 1000, 0.05), 0.016);
  assert.equal(frameTime(5000, 1000, 0.05), 0.05);
});

// The Office draws at ~60 fps, games at up to 144: on a 144 Hz screen the office every other refresh, a game every one.
test('how many refreshes go by for each frame drawn, whole so the pace never wobbles', () => {
  assert.equal(refreshEvery(1000 / 144, 60), 2);
  assert.equal(refreshEvery(1000 / 120, 60), 2);
  assert.equal(refreshEvery(1000 / 60, 60), 1);
  assert.equal(refreshEvery(1000 / 144, 144), 1);
  assert.equal(refreshEvery(1000 / 165, 144), 1);
  assert.equal(refreshEvery(1000 / 240, 144), 2);
  assert.equal(refreshEvery(1000 / 30, 144), 1);
});
