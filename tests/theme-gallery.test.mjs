import test from 'node:test';
import assert from 'node:assert/strict';
import { groupThemes, createThemeFavourites } from '../client/theme-gallery-model.js';

const themes = [
  { id: 'modern', name: 'Orbit auto' }, { id: 'modern-light', name: 'Orbit light' }, { id: 'modern-dark', name: 'Orbit dark' },
  { id: 'alien', name: 'MU/TH/UR' }, { id: 'office', name: 'Office' },
  { id: 'nodes', name: 'Nodes', node: 'Clean' }, { id: 'nodes-neurons', name: 'Nodes · Neurons', node: 'Neurons' },
];

test('gallery groups Orbit and Nodes variants without losing the current choice', () => {
  const groups = groupThemes(themes, 'nodes-neurons');
  assert.equal(groups.length, 4);
  assert.deepEqual(groups.map(group => group.id), ['modern', 'alien', 'office', 'nodes']);
  assert.deepEqual(groups[0].variants.map(variant => variant.id), ['modern', 'modern-light', 'modern-dark']);
  assert.equal(groups[3].choice.id, 'nodes-neurons');
  assert.equal(groups[3].selected, true);
  assert.equal(groups[0].selected, false);
  assert.equal(groupThemes(themes, 'modern-dark')[0].choice.id, 'modern-dark');
});

test('favourites move whole theme groups first while preserving variant selection', () => {
  const groups = groupThemes(themes, 'modern-dark', ['nodes', 'office']);
  assert.deepEqual(groups.map(group => group.id), ['office', 'nodes', 'modern', 'alien']);
  assert.equal(groups[2].choice.id, 'modern-dark');
});

test('favourites survive reload, deduplicate groups and tolerate blocked storage', () => {
  let raw = '["nodes", "nodes", "missing"]';
  const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
  const first = createThemeFavourites(themes, storage);
  assert.ok(first, 'Favourite preferences are available');
  assert.deepEqual(first.list(), ['nodes']);
  first.toggle('modern-dark'); first.toggle('office');
  assert.deepEqual(createThemeFavourites(themes, storage).list(), ['nodes', 'modern', 'office']);
  first.toggle('nodes-neurons'); assert.deepEqual(first.list(), ['modern', 'office']);
  const blocked = createThemeFavourites(themes, { getItem() { throw Error(); }, setItem() { throw Error(); } });
  blocked.toggle('alien'); assert.deepEqual(blocked.list(), ['alien']);
});
