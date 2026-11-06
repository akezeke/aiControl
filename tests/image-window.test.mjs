import test from 'node:test';
import assert from 'node:assert/strict';
import { imageWindowUrl, initImageWindow } from '../client/image-window.js';

test('a full-size image opens through a separate viewer with an escape back to the app', () => {
  const url = imageWindowUrl('codex:session/one', 'image#two');
  const image = {}, back = {};
  const document = { querySelector: selector => selector === '#image' ? image : back };
  let closes = 0, destination = '';
  const browser = { location: { search: new URL(url, 'https://control.test').search, replace: url => { destination = url; } }, close: () => { closes++; } };
  initImageWindow(document, browser);
  assert.equal(image.src, '/api/sessions/codex%3Asession%2Fone/images/image%23two');
  back.onclick();
  assert.equal(closes, 1);
  assert.equal(destination, '/');
});

test('the image viewer rejects a missing session or image', () => {
  const image = {}, back = {};
  const document = { querySelector: selector => selector === '#image' ? image : back };
  initImageWindow(document, { location: { search: '?session=test' }, close() {} });
  assert.equal(image.src, undefined);
});
