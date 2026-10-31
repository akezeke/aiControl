import test from 'node:test';
import assert from 'node:assert/strict';
import { createOverlays } from '../client/office/bubbles.js';

// Just enough DOM for the overlays: elements that know their parent and children.
function element(tag) {
  const node = {
    tag, parent: null, children: [], style: {}, hidden: false, attributes: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(name, value) { node.attributes[name] = value; }, getAttribute: name => node.attributes[name],
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, select() {},
    append(...kids) { for (const kid of kids) if (typeof kid === 'object') { kid.parent = node; node.children.push(kid); } },
    appendChild(kid) { node.append(kid); return kid; },
    remove() { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
    contains: other => other === node || node.children.some(kid => kid.contains(other)),
    querySelector: () => element('path'),
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
