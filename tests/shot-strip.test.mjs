import test from 'node:test';
import assert from 'node:assert/strict';
import { shotStrip, takeShotContainer } from '../client/shot-strip.js';
import { feedGroups } from '../client/feed.js';

function element(tag) {
  return {
    tagName: tag.toUpperCase(), children: [], dataset: {}, sourceWrites: 0, moves: 0,
    setAttribute(name, value) { this[name] = value; },
    get firstChild() { return this.children[0]; },
    querySelectorAll() { return this.children.flatMap(child => [...(child.dataset.imageId ? [child] : []), ...child.querySelectorAll()]); },
    set src(value) { this.source = value; this.sourceWrites++; },
    get src() { return this.source; },
    append(node) { this.insertBefore(node, null); },
    insertBefore(node, before) {
      node.remove(); node.parent = this; node.moves++;
      this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node);
    },
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; },
  };
}

test('adding an image preserves mounted thumbnails and their loaded image elements', t => {
  const was = globalThis.document; globalThis.document = { createElement: element };
  t.after(() => { if (was === undefined) delete globalThis.document; else globalThis.document = was; });
  const opened = [], open = (...args) => opened.push(args), id = 'codex:one';
  const first = { id: 'first', at: 1 }, second = { id: 'second', at: 2 };
  const strip = shotStrip(id, { shots: [first, second] }, null, open);
  const [a, b] = strip.children, img = a.firstChild;
  const updated = shotStrip(id, { shots: [first, second, { id: 'third', at: 3 }] }, strip, open);
  assert.equal(updated, strip);
  assert.equal(updated.children[0], a); assert.equal(updated.children[1], b);
  assert.equal(a.firstChild, img); assert.equal(img.sourceWrites, 1);
  assert.equal(a.moves, 1); assert.equal(b.moves, 1);
  assert.equal(updated.children.length, 3);
  updated.children[2].onclick();
  assert.deepEqual(opened, [[id, 'third']]);
});

test('rolling past 40 screenshots reuses the strip and every retained image even when its key changes', t => {
  const was = globalThis.document; globalThis.document = { createElement: element };
  t.after(() => { if (was === undefined) delete globalThis.document; else globalThis.document = was; });
  const images = Array.from({ length: 41 }, (_, i) => ({ id: `shot-${i}`, at: i + 1 }));
  const strip = shotStrip('codex:one', { shots: images.slice(0, 40) }, null, () => {});
  const retained = strip.children.slice(1), next = images.slice(1), available = new Set([strip]);
  const previous = takeShotContainer(available, next);
  const updated = shotStrip('codex:one', { shots: next }, previous, () => {});
  assert.ok(updated === strip, 'the surviving screenshots must keep their original strip');
  assert.deepEqual(updated.children.slice(0, 39), retained);
  assert.ok(retained.every(node => node.firstChild.sourceWrites === 1 && node.moves === 1));
  assert.equal(available.size, 0, 'a strip can only be reused once in a render');
});

test('a screenshot-led feed group survives eviction and cannot borrow another session’s thumbnails', t => {
  const was = globalThis.document; globalThis.document = { createElement: element };
  t.after(() => { if (was === undefined) delete globalThis.document; else globalThis.document = was; });
  const session = { id: 'codex:one' }, images = [{ id: 'first', at: 1 }, { id: 'second', at: 2 }];
  const before = feedGroups([session], () => images)[0];
  const node = element('section'), other = element('section');
  node.dataset.sessionId = session.id; node.dataset.messageId = before.key;
  other.dataset.sessionId = 'codex:other';
  node.append(shotStrip(session.id, before.entries[0], null, () => {}));
  other.append(shotStrip('codex:other', before.entries[0], null, () => {}));
  const after = feedGroups([session], () => [images[1], { id: 'third', at: 3 }])[0];
  assert.notEqual(before.key, after.key);
  const available = new Set([other, node]);
  assert.ok(takeShotContainer(available, after.entries.flatMap(entry => entry.shots || []), session.id) === node, 'the feed group must survive a new leading image ID');
  assert.equal(takeShotContainer(available, images, session.id), undefined);
  assert.equal(available.has(other), true);
});

test('removing, reordering and updating screenshot metadata reuses the surviving images', t => {
  const was = globalThis.document; globalThis.document = { createElement: element };
  t.after(() => { if (was === undefined) delete globalThis.document; else globalThis.document = was; });
  const first = { id: 'first' }, second = { id: 'second' }, third = { id: 'third' };
  const strip = shotStrip('claude:one', { shots: [first, second, third] }, null, () => {});
  const [a, b, c] = strip.children;
  const updated = shotStrip('claude:one', { shots: [third, { ...second, agent: 'Reviewer' }], user: true }, strip, () => {});
  assert.equal(updated, strip);
  assert.deepEqual(updated.children, [c, b]);
  assert.equal(a.parent, null); assert.equal(b.title, 'Reviewer');
  assert.equal(updated.className, 'history-shots user');
  assert.equal(b.firstChild.sourceWrites, 1); assert.equal(c.firstChild.sourceWrites, 1);
});
