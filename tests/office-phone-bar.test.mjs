import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// In 390 px: ✕, Copy, the waiting count, + ☰ and the eye. "✕ Quit game" in words wraps, and pushes Copy out of its own button.
test('on a phone the top bar stays on one line, with Quit as its cross', () => {
  const phone = readFileSync('client/office/office.css', 'utf8').split('\n').find(line => line.startsWith('@media (max-width: 640px)') && line.includes('.office-leave'));
  assert.ok(phone, 'a phone rule for the leave button');
  assert.match(phone, /\.office-overlay button \{[^}]*white-space: nowrap/);
  assert.match(phone, /\.office-leave \{ font-size: 0; \}/);
  assert.match(phone, /\.office-leave::before \{ content: '✕'; font-size: 16px; \}/);
});
