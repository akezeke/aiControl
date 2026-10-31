import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneFor, sceneAction } from '../client/scenes.js';

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
