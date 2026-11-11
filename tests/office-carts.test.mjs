import test from 'node:test';
import assert from 'node:assert/strict';
import { BROWSE_URL, STARTERS, cartPid, widgetUrl, bbsUrl, recentCarts, rememberCart, CARTS_KEY } from '../client/office/carts.js';

const memory = (init = {}) => { const data = { ...init }; return { getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, data }; };

test('cartPid takes pid links, the Embed snippet, numbers and cart ids', () => {
  assert.equal(cartPid('https://www.lexaloffle.com/bbs/?pid=porklike-2#p'), 'porklike-2');
  assert.equal(cartPid('https://lexaloffle.com/bbs/widget.php?pid=12345'), '12345');
  assert.equal(cartPid('<iframe src="https://www.lexaloffle.com/bbs/widget.php?pid=dank_tomb-8" allowfullscreen width="621" height="513"></iframe>'), 'dank_tomb-8');
  assert.equal(cartPid('  12345 '), '12345');
  assert.equal(cartPid('porklike-2'), 'porklike-2');
});

test('cartPid refuses threads, other hosts and junk', () => {
  for (const text of ['https://www.lexaloffle.com/bbs/?tid=12345', 'https://evil.example/bbs/?pid=1', 'https://www.lexaloffle.com.evil.example/bbs/?pid=1',
    'https://www.lexaloffle.com/bbs/?pid=a/b', `https://www.lexaloffle.com/bbs/?pid=${'a'.repeat(65)}`, '', 'hello world', 'javascript:alert(1)', 'porklike'])
    assert.equal(cartPid(text), null, text);
});

test('urls', () => {
  assert.equal(widgetUrl('porklike-2'), 'https://www.lexaloffle.com/bbs/widget.php?pid=porklike-2');
  assert.equal(bbsUrl('porklike-2'), 'https://www.lexaloffle.com/bbs/?pid=porklike-2#p');
  assert.equal(BROWSE_URL, 'https://www.lexaloffle.com/bbs/?cat=7');
});

test('pasted carts are kept newest first, without repeats, at most 8', () => {
  const s = memory();
  for (let i = 1; i <= 10; i++) rememberCart(s, String(i));
  rememberCart(s, '5');
  assert.deepEqual(recentCarts(s), ['5', '10', '9', '8', '7', '6', '4', '3']);
});

test('the kept list survives broken JSON, wrong shapes, no storage and a storage that throws', () => {
  assert.deepEqual(recentCarts(memory({ [CARTS_KEY]: '{nope' })), []);
  assert.deepEqual(recentCarts(memory({ [CARTS_KEY]: '[1,"x/y","12"]' })), ['12']);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(recentCarts(broken), []); assert.doesNotThrow(() => rememberCart(broken, '12'));
  assert.deepEqual(recentCarts(null), []);
});

test('starter carts are well formed', () => {
  assert.ok(STARTERS.length >= 4 && STARTERS.length <= 8);
  for (const cart of STARTERS) { assert.equal(cartPid(cart.pid), cart.pid); assert.ok(cart.title && cart.author); }
});
