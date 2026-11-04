import test from 'node:test';
import assert from 'node:assert/strict';
import { populateOnOpen } from '../client/lazy-details.js';

function details(open = false) {
  let listener;
  return {
    open, children: ['summary'],
    addEventListener(type, callback) { if (type === 'toggle') listener = callback; },
    removeEventListener(type, callback) { if (type === 'toggle' && listener === callback) listener = null; },
    append(...nodes) { this.children.push(...nodes); },
    toggle(value) { this.open = value; listener?.(); },
  };
}

test('collapsed tool details build their rows only when opened, and only once', () => {
  const box = details(); let builds = 0;
  populateOnOpen(box, () => { builds++; return ['first call', 'second call']; });
  assert.deepEqual(box.children, ['summary']);
  box.toggle(true);
  assert.deepEqual(box.children, ['summary', 'first call', 'second call']);
  box.toggle(false); box.toggle(true);
  assert.equal(builds, 1);
  assert.deepEqual(box.children, ['summary', 'first call', 'second call']);
});

test('previously expanded tool details build their rows immediately', () => {
  const box = details(true);
  populateOnOpen(box, () => ['restored call']);
  assert.deepEqual(box.children, ['summary', 'restored call']);
});
