import test from 'node:test';
import assert from 'node:assert/strict';
import { observesChange, observesFocus } from '../client/bricks3d/watch.js';

const scope = { contains: node => node.inside };
const skip = node => !!node.panel;
const page = { inside: true, closest: () => null };
const button = { inside: true, closest: () => ({}) };
const panel = { inside: true, panel: true, closest: () => ({}) };
const outside = { inside: false, closest: () => ({}) };

test('page changes rebuild the page but changes inside the separate chat panel do not', () => {
  assert.equal(observesChange({ type: 'childList', target: page }, scope, '.watched', skip), true);
  assert.equal(observesChange({ type: 'attributes', target: button }, scope, '.watched', skip), true);
  assert.equal(observesChange({ type: 'childList', target: panel }, scope, '.watched', skip), false);
  assert.equal(observesChange({ type: 'attributes', target: panel }, scope, '.watched', skip), false);
});

test('only focus changes within a build schedule its repaint', () => {
  assert.equal(observesFocus(button, scope, skip), true);
  assert.equal(observesFocus(panel, scope, skip), false);
  assert.equal(observesFocus(outside, scope, skip), false);
});
