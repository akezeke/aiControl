import test from 'node:test';
import assert from 'node:assert/strict';
import { recentCarts } from '../client/office/carts.js';
import { createDesktop, fakeCart, fitTransform } from '../client/office/desktop.js';

// The fake DOM of office-overlays.test.mjs, with what the desktop's own nodes use.
function element(tag) {
  const node = {
    tag, parent: null, children: [], style: {}, hidden: false, attributes: {}, textContent: '', value: '', dataset: {}, type: '', className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(name, value) { node.attributes[name] = value; }, getAttribute: name => node.attributes[name],
    listeners: {}, addEventListener(type, fn) { node.listeners[type] = fn; }, removeEventListener() {}, focus() {}, blur() {}, select() {},
    append(...kids) { for (const kid of kids) if (typeof kid === 'object') { kid.remove?.(); kid.parent = node; node.children.push(kid); } },
    appendChild(kid) { node.append(kid); return kid; },
    remove() { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
    contains: other => other === node || node.children.some(kid => kid.contains(other)),
    querySelector: () => element('path'),
    replaceChildren(...kids) { for (const kid of node.children) kid.parent = null; node.children = []; node.append(...kids); },
    set innerHTML(_) {},
  };
  return node;
}
const memory = (init = {}) => { const data = { ...init }; return { getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, data }; };
const find = (node, test) => test(node) ? node : node.children.map(kid => find(kid, test)).find(Boolean);
const iframeOf = root => find(root, n => n.tag === 'iframe');
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
// Each test's own document, gone again after it: the suite runs every file in one process.
const desktop = (t, options) => {
  const was = globalThis.document; globalThis.document = { createElement: element, createElementNS: (_, tag) => element(tag) };
  t.after(() => { if (was) globalThis.document = was; else delete globalThis.document; });
  return createDesktop(element('div'), { onShutDown() {}, storage: memory(), online: () => true, ...options });
};

test('fitTransform maps the layout onto the projected screen', () => {
  assert.deepEqual(fitTransform([{ x: 100, y: 50 }, { x: 640, y: 50 }, { x: 640, y: 370 }, { x: 100, y: 370 }], 1080, 640), { a: 0.5, b: 0, c: 0, d: 0.5, e: 100, f: 50 });
});
test('keys stay in the desktop, but Esc goes on unless it closes the Start menu', t => {
  const d = desktop(t); let stopped = 0; const key = k => d.root.listeners.keydown({ key: k, stopPropagation() { stopped++; } });
  key('w'); key('Tab'); assert.equal(stopped, 2);
  key('Escape'); assert.equal(stopped, 2, 'Esc stands you up');
  d.openStart(); key('Escape'); assert.equal(stopped, 3); assert.equal(d.state().start, false);
});
test('opening a cart makes exactly the widget frame; leaving takes it away', t => {
  const d = desktop(t); d.openPico(); d.openCart('porklike-2');
  const frame = iframeOf(d.root);
  assert.equal(frame.attributes.src, 'https://www.lexaloffle.com/bbs/widget.php?pid=porklike-2');
  assert.equal(frame.attributes.referrerpolicy, 'no-referrer');
  assert.equal(frame.attributes.allow, 'fullscreen; gamepad; autoplay');
  assert.equal(frame.attributes.sandbox, 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  assert.equal(frame.attributes.width, '621'); assert.equal(frame.attributes.height, '513');
  assert.ok(find(d.root, n => n.textContent === 'Needs internet'), 'behind the frame, for a failed load');
  d.hide(); assert.equal(iframeOf(d.root), undefined); assert.equal(d.state().cart, null);
});
test('offline, a cart says so instead of a blank frame', t => {
  const d = desktop(t, { online: () => false }); d.openPico(); d.openCart('porklike-2');
  assert.equal(iframeOf(d.root), undefined); assert.ok(find(d.root, n => n.textContent === 'Offline: carts load from lexaloffle.com'));
});
test('pasting: a good link opens and is kept; junk is refused', t => {
  const storage = memory(), d = desktop(t, { storage }); d.openPico();
  d.paste('nonsense'); assert.ok(find(d.root, n => n.textContent === "Paste the cart's Embed link")); assert.equal(iframeOf(d.root), undefined);
  d.paste('https://www.lexaloffle.com/bbs/?pid=12345#p'); assert.equal(d.state().cart, '12345'); assert.deepEqual(recentCarts(storage), ['12345']);
});
test('place follows the screen as it moves (a resize)', t => {
  const d = desktop(t); d.place(rect(100, 50, 540, 320)); d.place(rect(10, 20, 1080, 640));
  assert.equal(d.root.style.transform, 'matrix(1, 0, 0, 1, 10, 20)'); assert.equal(d.root.hidden, false);
  d.hide(); assert.equal(d.root.hidden, true);
});
test('the made-up carts are the same picture for the same seed and time, and move', () => {
  assert.deepEqual(fakeCart(3, 1.5), fakeCart(3, 1.5)); assert.notDeepEqual(fakeCart(3, 1.5), fakeCart(3, 2)); assert.notDeepEqual(fakeCart(2, 1.5), fakeCart(3, 1.5));
  assert.ok(fakeCart(2, 0).every(i => i < 16));
});
