import test from 'node:test';
import assert from 'node:assert/strict';
import { officeStatus, identity, isTypingTarget, FRUITS } from '../client/office/status.js';

test('every status maps to a pose', () => {
  const want = { working: 'typing', permission: 'waving', question: 'raising', idle: 'sleeping', error: 'slumped', offline: 'still', unknown: 'still' };
  for (const [status, pose] of Object.entries(want)) assert.equal(officeStatus({ status, requests: [] }).pose, pose);
});
test('waiting sessions get highlighted bubbles from their request', () => {
  const b = officeStatus({ status: 'permission', requests: [{ title: 'Run npm test' }] }).bubble;
  assert.deepEqual(b, { icon: '✋', text: 'Run npm test', highlight: true });
});
test('bubble text is one line, max 48 chars', () => {
  const b = officeStatus({ status: 'question', requests: [{ title: `${'x'.repeat(60)}\nsecond line` }] }).bubble;
  assert.equal(b.text.length, 48);
  assert.ok(b.text.endsWith('…') && !b.text.includes('\n'));
});
test('subagents only talk while working', () => {
  assert.equal(officeStatus({ status: 'idle', parentId: 'p', requests: [] }).bubble, null);
  assert.ok(officeStatus({ status: 'working', parentId: 'p', requests: [] }).bubble);
});
test('identity is deterministic and varied', () => {
  assert.deepEqual(identity('claude:abc'), identity('claude:abc'));
  const fruits = new Set(Array.from({ length: 50 }, (_, i) => identity(`s${i}`).fruit));
  assert.ok(fruits.size >= 5 && [...fruits].every(f => FRUITS.includes(f)));
});
test('typing targets are recognized', () => {
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA', closest: () => null }), true);
  assert.equal(isTypingTarget({ tagName: 'CANVAS', isContentEditable: false, closest: () => null }), false);
});
