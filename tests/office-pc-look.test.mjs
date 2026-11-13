import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('client/office/pc.css', 'utf8');
test('the look', () => {
  for (const value of ['#008080', '#c0c0c0', '#000080', '#ffffe1', "Tahoma, 'MS Sans Serif', Arial, sans-serif", "'Courier Prime'", 'repeat(auto-fill', '::-webkit-scrollbar', 'scrollbar-color', 'attr(data-tip)', ':focus-visible', 'dotted', '@keyframes pc-start', '@keyframes pc-zoom']) assert.ok(css.includes(value), value);
  const reduced = css.slice(css.indexOf('prefers-reduced-motion'));
  for (const name of ['.pc-zoom', '.pc-start-menu', '.pc-throbber']) assert.ok(reduced.includes(name), name);
  assert.doesNotMatch(css, /@font-face/);
});
test('Courier Prime is declared once, globally', () => {
  assert.match(readFileSync('client/typography.css', 'utf8'), /font-family: 'Courier Prime'/);
  assert.doesNotMatch(readFileSync('client/nodes/list/steampunk.css', 'utf8'), /@font-face \{ font-family: 'Courier Prime'/);
  assert.match(readFileSync('client/office/office.js', 'utf8'), /import '\.\/pc\.css'/);
  assert.doesNotMatch(readFileSync('client/office/office.css', 'utf8'), /\.office-desktop \{/);
});
test('tooltips, focus and scrollbars stay inside the desktop', () => {
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.split('{')[0].trim()).filter(Boolean);
  for (const s of selectors) for (const part of s.split(',')) assert.doesNotMatch(part.trim(), /^\[data-tip\]/, part);
  const focus = css.match(/^\.office-desktop :focus-visible \{[^}]*\}/gm);
  assert.deepEqual(focus, ['.office-desktop :focus-visible { outline: 1px dotted #000; outline-offset: -4px; }']);
  const at = css.indexOf('@supports not selector(::-webkit-scrollbar)');
  assert.ok(at >= 0);
  const block = css.slice(at, css.indexOf('\n}', at));
  assert.equal(css.split('scrollbar-color').length, 2);
  assert.ok(block.includes('scrollbar-color'));
});
test('title, throbber and taskbar values', () => {
  assert.match(css, /\.pc-window\.front \.pc-title[^}]*#1084d0/);
  assert.match(css, /\.pc-throbber\.loading[^}]*steps\(8\)/);
  assert.match(css, /\.pc-taskbar \{[^}]*height: 44px/);
});
// The 90s pointers (desktop.js sets the variables at the first sit-down): the arrow throughout, buttons too (Windows had no hand
// on a button), the hand on links and cards, the I-beam in text, and the hourglass all over a page that is loading.
test('the pointers', () => {
  const cursors = {};
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const [selectors, body = ''] = rule.split('{'), value = body.match(/(?:^|;)\s*cursor: ([^;]+)/)?.[1].trim();
    if (value) for (const s of selectors.split(',')) cursors[s.trim()] = value;
  }
  const arrow = 'var(--pc-arrow, default)', hand = 'var(--pc-hand, pointer)', text = 'var(--pc-text, text)', wait = 'var(--pc-wait, wait)';
  assert.deepEqual(cursors, {
    '.office-desktop': arrow, '.office-desktop button': arrow, '.office-desktop button:disabled': arrow,
    '.pc-field': text, '.pc-notepad': text, '.pc-page a': hand, '.pc-card': hand, '.pc-page.busy': wait, '.pc-page.busy *': wait,
  });
});
