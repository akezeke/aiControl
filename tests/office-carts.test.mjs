import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTERS, cartPid, isPid, threadId, listLink, thumbName, listUrl, widgetUrl, bbsUrl, recentCarts, CARTS_KEY, TOP_URL } from '../client/office/carts.js';

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
  assert.equal(bbsUrl('porklike-2'), 'https://www.lexaloffle.com/bbs/?pid=porklike-2');
});

test('pasted carts are read as kept, at most 8', () => {
  const s = memory({ [CARTS_KEY]: JSON.stringify(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']) });
  assert.deepEqual(recentCarts(s), ['1', '2', '3', '4', '5', '6', '7', '8']);
});

test('the kept list survives broken JSON, wrong shapes, no storage and a storage that throws', () => {
  assert.deepEqual(recentCarts(memory({ [CARTS_KEY]: '{nope' })), []);
  assert.deepEqual(recentCarts(memory({ [CARTS_KEY]: '[1,"x/y","12"]' })), ['12']);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(recentCarts(broken), []);
  assert.deepEqual(recentCarts(null), []);
});

test('starter carts are well formed', () => {
  assert.ok(STARTERS.length >= 4 && STARTERS.length <= 8);
  for (const cart of STARTERS) { assert.equal(cartPid(cart.pid), cart.pid); assert.ok(cart.title && cart.author); }
});

test('cart ids may hold hyphens', () => {
  assert.equal(cartPid('pico-man-3'), 'pico-man-3');
  assert.equal(cartPid('-bad-3'), null);
});
test('isPid takes a bare pid only', () => {
  assert.equal(isPid('a-1'), true); assert.equal(isPid('165759'), true);
  assert.equal(isPid('https://www.lexaloffle.com/bbs/?pid=a-1'), false); assert.equal(isPid(' a-1'), false); assert.equal(isPid(5), false);
});
test('threadId', () => {
  assert.equal(threadId('https://www.lexaloffle.com/bbs/?tid=148484'), '148484');
  assert.equal(threadId('https://evil.test/bbs/?tid=1'), null);
  assert.equal(threadId('148484'), null);
});
test('listLink', () => {
  const at = 'https://www.lexaloffle.com/bbs/';
  assert.deepEqual(listLink(`${at}?cat=7#sub=2&mode=carts&orderby=featured&page=3`), { tab: 'featured', page: 3, q: '' });
  assert.deepEqual(listLink(`${at}?cat=7&carts_tab=1&#sub=2&mode=carts`), { tab: 'new', page: 1, q: '' });
  assert.deepEqual(listLink(`${at}lister.php?cat=7&mode=carts&search=snake&page=99`), { tab: 'new', page: 50, q: 'snake' });
  assert.equal(listLink(`${at}?cat=6#mode=carts`), null);
  assert.equal(listLink(`${at}?pid=porklike-2`), null);
  // NerdyTeachers' Top 200, the Info Highway's third tab
  for (const top of [TOP_URL, 'https://nerdyteachers.com/PICO-8/Games/Top200', 'https://www.nerdyteachers.com/PICO-8/Games/Top200/#x'])
    assert.deepEqual(listLink(top), { tab: 'top', page: 1, q: '' }, top);
  for (const other of ['https://nerdyteachers.com/PICO-8/Games/', 'http://nerdyteachers.com/PICO-8/Games/Top200/', 'https://nerdyteachers.com.evil/PICO-8/Games/Top200/'])
    assert.equal(listLink(other), null, other);
});
test('thumbName and listUrl', () => {
  assert.equal(thumbName('molemole-1'), 'pico8_molemole-1.png');
  assert.equal(thumbName('23208'), 'pico23208.png');
  assert.equal(listUrl({ tab: 'featured', page: 2, q: '' }), 'https://www.lexaloffle.com/bbs/?cat=7#sub=2&mode=carts&orderby=featured&page=2');
  assert.equal(listUrl({ tab: 'new', page: 1, q: '' }), 'https://www.lexaloffle.com/bbs/?cat=7#sub=2&mode=carts&page=1');
  assert.equal(TOP_URL, 'https://nerdyteachers.com/PICO-8/Games/Top200/');
  assert.equal(listUrl({ tab: 'top', page: 3, q: '' }), TOP_URL);
  assert.equal(listUrl({ tab: 'top', page: 1, q: 'snake' }), 'https://www.lexaloffle.com/bbs/?cat=7#sub=2&mode=carts&search=snake&page=1');
  assert.equal(listUrl({ tab: 'featured', page: 1, q: 'sn ake' }), 'https://www.lexaloffle.com/bbs/?cat=7#sub=2&mode=carts&search=sn%20ake&page=1');
  assert.equal(bbsUrl('porklike-2'), 'https://www.lexaloffle.com/bbs/?pid=porklike-2');
});
