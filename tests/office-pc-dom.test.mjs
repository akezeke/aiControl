import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { useDom } from './fixtures/pc-dom.mjs';

test('fixture elements carry an upper-case tagName like real ones', t => {
  const doc = useDom(t); assert.equal(doc.createElement('input').tagName, 'INPUT'); assert.equal(doc.createElement('a').tagName, 'A');
});
test('production code never reads the fixture-only .tag property', () => {
  const dir = new URL('../client/office/', import.meta.url);
  for (const name of readdirSync(dir).filter(n => n.endsWith('.js'))) assert.doesNotMatch(readFileSync(new URL(name, dir), 'utf8'), /\.tag\b/, name);
});
test('fixture focus moves like a browser: events on a move, the body when the focused node leaves the page', t => {
  const doc = useDom(t), box = doc.createElement('div'), a = doc.createElement('button'), b = doc.createElement('button'), seen = [];
  box.append(a, b); doc.body.append(box);
  for (const type of ['focus', 'blur', 'focusin', 'focusout']) box.addEventListener(type, e => seen.push(`${type}:${e.target === a ? 'a' : 'b'}`), true);
  doc.body.addEventListener('focusin', e => seen.push('body-focusin')); doc.body.addEventListener('blur', () => seen.push('bubbled-blur'));
  a.focus(); a.focus(); b.focus();
  assert.deepEqual(seen, ['focus:a', 'focusin:a', 'body-focusin', 'blur:a', 'focusout:a', 'focus:b', 'focusin:b', 'body-focusin']);
  seen.length = 0; box.append(b); assert.equal(doc.activeElement, doc.body, 'an append that moves it'); assert.deepEqual(seen, ['blur:b', 'focusout:b']);
  b.focus(); box.replaceChildren(a); assert.equal(doc.activeElement, doc.body, 'replaceChildren');
  a.focus(); box.remove(); assert.equal(doc.activeElement, doc.body, 'an ancestor removed');
  doc.body.append(box); a.focus(); a.blur(); assert.equal(doc.activeElement, doc.body, 'blur()');
  const gone = doc.createElement('button'); gone.focus(); assert.equal(doc.activeElement, gone, 'out of the page: no events, still allowed');
});
