import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneFor, sceneAction } from '../client/scenes.js';
import { frameTime } from '../client/scene-ui.js';

test('both looks resolve', () => {
  assert.equal(sceneFor('office').name, 'Office');
  assert.equal(sceneFor('bridge').name, 'Bridge');
  assert.equal(sceneFor('modern'), null);
  assert.equal(sceneFor(undefined), null);
});
test('city resolves and says what it needs', () => { assert.equal(sceneFor('city').name, 'City'); assert.equal(sceneFor('city').needs, 'Canvas'); assert.equal(sceneFor('bridge').needs, undefined); });
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
