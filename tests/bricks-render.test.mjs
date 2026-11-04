import test from 'node:test';
import assert from 'node:assert/strict';
import { BrickLayer } from '../client/bricks3d/layer.js';

test('unclipped groups share a render pass while scrolling groups retain their clip', () => {
  const groups = { page: { visible: true }, fixed: { visible: true }, history: { visible: true } };
  const draws = []; let scissor = false, bounds;
  const renderer = {
    setScissorTest(value) { scissor = value; },
    setScissor(...value) { bounds = value; },
    clear() {},
    render() { draws.push({ visible: Object.keys(groups).filter(name => groups[name].visible), scissor, bounds }); },
  };
  const layer = { renderer, scene: {}, camera: {}, groups, clips: { history: { x: 10, y: 20, w: 100, h: 60 } }, size: { height: 200 }, shadowDirty: false, tweens: new Set() };
  BrickLayer.prototype.draw.call(layer, 0);
  assert.deepEqual(draws, [
    { visible: ['page', 'fixed'], scissor: false, bounds: undefined },
    { visible: ['history'], scissor: true, bounds: [10, 120, 100, 60] },
  ]);
  assert.ok(Object.values(groups).every(group => group.visible));
});
