import test from 'node:test';
import assert from 'node:assert/strict';
import { createOverlays } from '../client/office/bubbles.js';
import { officeHasKeys } from '../client/scene-keys.js';

// Just enough DOM for the overlays: elements that know their parent and children.
function element(tag) {
  const node = {
    tag, parent: null, children: [], style: {}, hidden: false, attributes: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(name, value) { node.attributes[name] = value; }, getAttribute: name => node.attributes[name],
    listeners: {}, addEventListener(type, fn) { node.listeners[type] = fn; }, removeEventListener() {}, focus() {}, blur() {}, select() {},
    append(...kids) { for (const kid of kids) if (typeof kid === 'object') { kid.parent = node; node.children.push(kid); } },
    appendChild(kid) { node.append(kid); return kid; },
    remove() { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
    contains: other => other === node || node.children.some(kid => kid.contains(other)),
    querySelector: () => element('path'),
    replaceChildren() { node.children = []; },
    set innerHTML(_) {},
  };
  return node;
}

test('the overlays go without a trace when the office is closed', t => {
  const was = globalThis.document;
  globalThis.document = { createElement: element, createElementNS: (_, tag) => element(tag) };
  t.after(() => { globalThis.document = was; });
  const container = element('div'), noop = () => {};
  const overlays = createOverlays(container, { onNext: noop, onList: noop, onOverview: noop, onNew: noop, onLeave: noop, onCopy: noop, onThrow: { press: () => true, release: noop, cancel: noop } });
  assert.ok(container.children.length > 0);
  // A throw here stops the unmount after the drawing has stopped: switching theme left the office frozen on screen.
  overlays.dispose();
  assert.deepEqual(container.children.map(kid => kid.tag), []);
});

test('the throw button goes with the hand empty, whose holding is null', t => {
  const was = globalThis.document;
  globalThis.document = { createElement: element, createElementNS: (_, tag) => element(tag) };
  t.after(() => { globalThis.document = was; });
  const container = element('div'), noop = () => {}, overlays = createOverlays(container, { onNext: noop, onList: noop, onOverview: noop, onNew: noop, onLeave: noop, onCopy: noop, onThrow: { press: () => true, release: noop, cancel: noop } });
  const button = container.children.find(kid => kid.className === 'office-throw');
  assert.equal(button.hidden, true);
  overlays.showThrow(true); assert.equal(button.hidden, false);
  overlays.showThrow(null); assert.equal(button.hidden, true);
  overlays.showThrow({}); assert.equal(button.hidden, false);
  overlays.showThrow(undefined); assert.equal(button.hidden, true);
});

test('while the copy line shows the office has no keys, whichever way focus went', t => {
  const was = globalThis.document, body = { tagName: 'BODY', classList: { contains: () => false } };
  let line = null;
  globalThis.document = { createElement: element, createElementNS: (_, tag) => element(tag), body, activeElement: body, querySelector: selector => selector.split(', ').includes('.office-copyline:not([hidden])') && !line.hidden ? line : null };
  t.after(() => { globalThis.document = was; });
  const container = element('div'), noop = () => {}, overlays = createOverlays(container, { onNext: noop, onList: noop, onOverview: noop, onNew: noop, onLeave: noop, onCopy: noop, onThrow: { press: () => true, release: noop, cancel: noop } });
  line = container.children.find(kid => kid.className === 'office-copyline');
  const key = { target: body };
  assert.equal(officeHasKeys(key), true);
  overlays.showCopy('scores');
  assert.equal(document.activeElement, body, 'focus on the page, as a click on its padding or a Tab past its close leaves it');
  assert.equal(officeHasKeys(key), false, 'keys are dead');
  assert.equal(overlays.closeCopy(line), false, 'clicks inside it leave it up');
  assert.equal(overlays.closeCopy(), true, 'Esc closes it');
  assert.equal(officeHasKeys(key), true, 'and they\'re back');
});

test('with the item away the throw button is another go, and a throw again once it\'s back', t => {
  const was = globalThis.document;
  globalThis.document = { createElement: element, createElementNS: (_, tag) => element(tag) };
  t.after(() => { globalThis.document = was; });
  const container = element('div'), noop = () => {}, overlays = createOverlays(container, { onNext: noop, onList: noop, onOverview: noop, onNew: noop, onLeave: noop, onCopy: noop, onThrow: { press: () => true, release: noop, cancel: noop } });
  const button = container.children.find(kid => kid.className === 'office-throw'), classes = new Set();
  button.classList = { contains: name => classes.has(name), toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); } };
  overlays.showThrow(true); assert.equal(button.textContent, 'Throw');
  overlays.showThrow(true, true); assert.equal(button.textContent, '↻'); assert.equal(button.getAttribute('aria-label'), 'Try again'); assert.equal(button.hidden, false);
  overlays.showThrow(true, false); assert.equal(button.textContent, 'Throw'); assert.equal(button.getAttribute('aria-label'), 'Throw');
});

test('a chip in the score bar is a button whose press picks, and stops the press at the bar', t => {
  const was = globalThis.document;
  globalThis.document = { createElement: element, createElementNS: (_, tag) => element(tag) };
  t.after(() => { globalThis.document = was; });
  const container = element('div'), noop = () => {}, overlays = createOverlays(container, { onNext: noop, onList: noop, onOverview: noop, onNew: noop, onLeave: noop, onCopy: noop, onThrow: { press: () => true, release: noop, cancel: noop } });
  const score = container.children.find(kid => kid.className === 'office-score');
  let picked = 0; overlays.setScore([{ text: 'Best 3' }, { text: '↔ Swipe', on: true, pick: () => { picked++; } }, { text: '👆 Tap', on: false, pick: noop }], null, false);
  const chips = score.children[0].children.filter(kid => kid.tag === 'button');
  assert.deepEqual(chips.map(c => [c.textContent, c.attributes['aria-pressed']]), [['↔ Swipe', 'true'], ['👆 Tap', 'false']]);
  let stopped = 0; chips[0].listeners.pointerdown({ stopPropagation() { stopped++; } });
  chips[0].listeners.click({ stopPropagation() { stopped++; } });
  assert.equal(picked, 1); assert.equal(stopped, 2);
});
