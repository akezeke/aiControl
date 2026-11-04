import test from 'node:test';
import assert from 'node:assert/strict';
import { image } from '../client/bricks3d/image-cache.js';

test('an image becoming ready refreshes all and only the stickers waiting for it', () => {
  const previous = globalThis.Image;
  const created = [];
  globalThis.Image = class { constructor() { created.push(this); } set src(value) { this.url = value; } };
  try {
    const refreshed = [];
    assert.equal(image('castle-a', () => refreshed.push('first')), null);
    assert.equal(image('castle-a', () => refreshed.push('second')), null);
    assert.equal(image('castle-b', () => refreshed.push('other')), null);
    assert.equal(created.length, 2);
    created[0].onload();
    assert.deepEqual(refreshed, ['first', 'second']);
    assert.equal(image('castle-a'), created[0]);
    assert.equal(image('castle-b'), null);
    created[1].onload();
    assert.deepEqual(refreshed, ['first', 'second', 'other']);
  } finally { globalThis.Image = previous; }
});
