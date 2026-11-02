import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_TOP, boardLayout } from '../client/bridge/board.js';
import { clickAction, keyAction } from '../client/bridge/seat.js';

const inView = (cards, W, H) => {
  for (const { x, y, width, height } of cards) {
    assert.ok(Math.abs(x) + width / 2 <= W / 2 + 1e-9, 'across');
    assert.ok(y - height / 2 >= -H / 2 - 1e-9, 'bottom');
    assert.ok(y + height / 2 <= H / 2 - BOARD_TOP + 1e-9, 'under the buttons');
  }
};
const noOverlap = cards => cards.forEach((a, i) => cards.slice(i + 1).forEach(b => {
  assert.ok(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2, 'overlap');
}));

for (const [name, W, H] of [['phone', 390, 844], ['phone on its side', 844, 390], ['desktop', 1280, 720]]) {
  for (const count of [1, 2, 3, 5, 6, 10]) {
    test(`${name}, ${count} sessions: every screen is in view, none on another`, () => {
      const cards = boardLayout(count, W, H);
      assert.equal(cards.length, count);
      inView(cards, W, H); noOverlap(cards);
    });
  }
}
test('a full phone gets two columns, with left stations left and right stations right', () => {
  const cards = boardLayout(10, 390, 844);
  assert.equal(new Set(cards.map(({ x }) => x)).size, 2);
  assert.ok(cards[0].x < 0 && cards[1].x > 0);
  assert.ok(cards[0].y > cards[2].y);
});
test('screens are big enough to read', () => {
  assert.ok(boardLayout(10, 390, 844)[0].width >= 140);
  assert.ok(boardLayout(10, 1280, 720)[0].width >= 230);
  assert.ok(boardLayout(1, 1280, 720)[0].width >= 500);
});
test('a short last row is centred', () => {
  const cards = boardLayout(3, 390, 844);
  assert.equal(cards.at(-1).x, 0);
});
test('nobody on board, nothing to lay out', () => assert.deepEqual(boardLayout(0, 1280, 720), []));

test('in the overview a click off every screen closes it, and E does not', () => {
  const overview = { seated: true, zoomed: false, overview: true, locked: false, mouse: true };
  assert.equal(clickAction(null, overview), 'close');
  assert.equal(clickAction({ kind: 'character', id: 'a' }, overview), 'talk');
  assert.equal(keyAction(null, overview), null);
});
