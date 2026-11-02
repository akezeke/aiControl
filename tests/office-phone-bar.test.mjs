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

// Quit, Copy, the waiting count, usage and the list come to about 285 px at their full 44 px; with + and the eye as well, Quit went off a phone's left edge.
test('in a level on a phone, + and the eye make room, and the bar can never run off the side', () => {
  const css = readFileSync('client/office/office.css', 'utf8'), js = readFileSync('client/office/bubbles.js', 'utf8');
  const phone = css.split('\n').find(line => line.startsWith('@media (max-width: 640px)') && line.includes('.level'));
  assert.ok(phone, 'a phone rule for a level');
  assert.match(phone, /\.office-overlay\.level \.office-new, \.office-overlay\.level \.office-eye \{ display: none; \}/);
  assert.match(phone, /max-width: calc\(100% - 24px\); flex-wrap: wrap/);
  assert.match(js, /bar\.classList\.toggle\('level', !!goal\)/);
});
