import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { createRange: () => ({}) };
const { BrickUi, PAGE, plain } = await import('../client/bricks3d/ui.js');
delete globalThis.document;

test('the sidebar and its contents use their own scrolling group', () => {
  assert.ok(PAGE.scrollers.includes('.sidebar'));
  const sidebar = { closest: s => s === '.sidebar' ? sidebar : null };
  const child = { closest: s => s === '.sidebar' ? sidebar : null };
  const topbar = { closest: s => s === PAGE.fixed ? {} : null };
  const ui = { config: PAGE };
  assert.equal(BrickUi.prototype.groupOf.call(ui, sidebar), '.sidebar');
  assert.equal(BrickUi.prototype.groupOf.call(ui, child), '.sidebar');
  assert.equal(BrickUi.prototype.groupOf.call(ui, topbar), 'fixed');
});

test('the sidebar wall spans the scrollable content, not just the viewport', () => {
  const el = { parentElement: null, scrollHeight: 960, clientHeight: 400, clientWidth: 200, matches: s => s === '.sidebar', closest: () => null, dataset: {} };
  const ui = { config: PAGE, groupOf: () => '.sidebar', box: () => ({ left: 0, top: 0, width: 200, height: 400 }) };
  const [wall] = BrickUi.prototype.measure.call(ui, [{ el, kind: 'wall' }]);
  assert.equal(wall.h, 960);
});

test('the chat background belongs to history and covers its full scroll height', () => {
  assert.equal(typeof plain, 'function');
  const pieces = [], layer = { size: { height: 400 }, add: (...args) => { pieces.push(args); return {}; } };
  const el = { clientHeight: 400, matches: selector => selector === '.history-viewport' };
  plain(layer, { group: '.history-viewport', x: 20, y: 48, w: 200, h: 960, el }, [], 1);
  assert.ok(pieces.length);
  assert.ok(pieces.every(p => p[0] === '.history-viewport'));
  assert.ok(Math.max(...pieces.map(p => p[3])) >= 48 + 936);
});
