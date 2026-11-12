import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, draw, SANDBOX } from '../client/office/pc-player.js';
import { useDom, find, findAll } from './fixtures/pc-dom.mjs';

test('playing loads the widget at full size, titled for the cart', t => {
  useDom(t); const p = createPlayer({ online: () => true });
  p.play({ pid: 'molemole-1', title: 'Mole Mole' });
  const f = p.frame(); assert.equal(f.attributes.src, 'https://www.lexaloffle.com/bbs/widget.php?pid=molemole-1');
  assert.deepEqual([f.attributes.width, f.attributes.height, f.attributes.sandbox], ['526', '522', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox']);
  assert.equal(SANDBOX, f.attributes.sandbox);
  assert.equal(p.title(), 'Mole Mole - PICO-8');
});
test('another cart replaces the frame; stop removes it and shows ▶ Play, never autoplaying', t => {
  useDom(t); const p = createPlayer({ online: () => true });
  p.play({ pid: 'a-1', title: 'A' }); const first = p.frame(); p.play({ pid: 'b-1', title: 'B' });
  assert.notEqual(p.frame(), first); assert.equal(first.parent, null);
  p.stop(); assert.equal(p.frame(), null); assert.equal(p.playing(), false);
  const thumb = find(p.node, n => n.tag === 'img'); assert.equal(thumb.attributes.src, '/api/office/bbs/thumb/pico8_b-1.png');
  let played = null; p.onPlay(cart => { played = cart; });
  find(p.node, n => n.textContent === '▶ Play').dispatch('click'); assert.deepEqual(played, { pid: 'b-1', title: 'B' });
});
test('pause hides the same node and shows it again', t => {
  useDom(t); const p = createPlayer({ online: () => true }); p.play({ pid: 'a-1', title: 'A' }); const f = p.frame();
  p.pause(true); assert.equal(f.style.display, 'none'); p.pause(false); assert.equal(f.style.display, ''); assert.equal(p.frame(), f);
});
test('offline', t => {
  useDom(t); const p = createPlayer({ online: () => false }); p.play({ pid: 'a-1', title: 'A' });
  assert.ok(find(p.node, n => n.textContent === 'Offline: carts load from lexaloffle.com'));
  assert.deepEqual(p.cart(), { pid: 'a-1', title: 'A' }); assert.equal(p.playing(), false); assert.equal(p.frame(), null);
});

test('online, "Needs internet" sits behind the frame and the frame focuses on load', t => {
  const doc = useDom(t); const p = createPlayer({ online: () => true }); p.play({ pid: 'a-1', title: 'A' });
  const kids = p.frame().parent.children; assert.ok(kids.indexOf(find(p.node, n => n.textContent === 'Needs internet')) < kids.indexOf(p.frame()));
  assert.equal(p.frame().attributes.referrerpolicy, 'no-referrer'); assert.equal(p.frame().attributes.allow, 'fullscreen; gamepad; autoplay');
  assert.equal(p.frame().attributes.scrolling, 'no'); assert.equal(p.frame().attributes.title, 'A');
  p.frame().dispatch('load'); assert.equal(doc.activeElement, p.frame());
});
test('the client area is 526 x 522; show() with a cart keeps it for Play', t => {
  useDom(t); const p = createPlayer({ online: () => true });
  assert.equal(p.title(), 'PICO-8'); assert.equal(p.cart(), null); assert.equal(find(p.node, n => n.textContent === '▶ Play'), undefined);
  assert.deepEqual([p.node.style.width, p.node.style.height], ['526px', '522px']); assert.ok(p.node.classList.contains('pc-client'));
  p.play({ pid: '12345', title: 'N' });
  p.show({ pid: '12345', title: 'N' }); assert.equal(p.frame(), null); assert.equal(p.playing(), false);
  const img = find(p.node, n => n.tag === 'img'); assert.equal(img.attributes.src, '/api/office/bbs/thumb/pico12345.png'); assert.equal(img.style.imageRendering, 'pixelated');
  assert.equal(p.title(), 'N - PICO-8'); assert.equal(find(p.node, n => n.textContent === '▶ Play').classList.contains('pc-button'), true);
});
test('play while paused keeps the cart but loads nothing until shown', t => {
  useDom(t); const p = createPlayer({ online: () => true }); p.pause(true); p.play({ pid: 'a-1', title: 'A' });
  assert.equal(p.frame(), null); assert.equal(p.playing(), false); assert.deepEqual(p.cart(), { pid: 'a-1', title: 'A' }); assert.equal(find(p.node, n => n.tag === 'iframe'), undefined);
  p.pause(false); const f = p.frame(); assert.ok(f); assert.notEqual(f.style.display, 'none'); assert.equal(f.attributes.src, 'https://www.lexaloffle.com/bbs/widget.php?pid=a-1'); assert.equal(p.playing(), true);
  p.pause(true); p.pause(false); assert.equal(p.frame(), f, 'resuming a loaded game reloads nothing');
});
test('a stopped cart does not load when shown again', t => {
  useDom(t); const p = createPlayer({ online: () => true }); p.pause(true); p.play({ pid: 'a-1', title: 'A' }); p.stop(); p.pause(false);
  assert.equal(p.frame(), null); assert.ok(find(p.node, n => n.tag === 'img'));
});
test('draw: a loaded thumbnail is scaled into the box unsmoothed; otherwise black and the console icon', t => {
  const doc = useDom(t); const box = { x: 10, y: 20, w: 100, h: 80 }, cart = { pid: 'a-1', title: 'A' }, img = { width: 128, height: 128 };
  let asked = null; const g = doc.createElement('canvas').getContext('2d');
  draw(g, box, { cart, image: name => { asked = name; return img; } });
  assert.equal(asked, 'pico8_a-1.png');
  const call = g.calls.find(c => c.name === 'drawImage'); assert.equal(call.args[0], img); assert.deepEqual(call.args.slice(1), [10, 20, 100, 80]);
  assert.equal(call.state.imageSmoothingEnabled, false);
  const h = doc.createElement('canvas').getContext('2d'); draw(h, box, { cart, image: () => null });
  assert.equal(h.calls.some(c => c.name === 'drawImage'), false);
  assert.deepEqual(h.calls[0].args, [10, 20, 100, 80]); assert.equal(h.calls[0].state.fillStyle, '#000');
  assert.ok(h.calls.length > 1, 'the console icon');
  const n = doc.createElement('canvas').getContext('2d'); draw(n, box, { cart: null, image: () => { throw new Error('no lookup'); } });
  assert.equal(n.calls[0].name, 'fillRect');
});

test('fixture: bubbling runs to the document until stopPropagation', t => {
  const doc = useDom(t); const a = doc.createElement('div'), b = doc.createElement('div'); doc.body.append(a); a.append(b);
  const seen = []; for (const [name, n] of [['b', b], ['a', a], ['doc', doc]]) n.addEventListener('x', e => seen.push([name, e.target === b, e.currentTarget === n]));
  const e = b.dispatch('x', { key: 'k' }); assert.deepEqual(seen.map(s => s[0]), ['b', 'a', 'doc']); assert.ok(seen.every(s => s[1] && s[2])); assert.equal(e.key, 'k');
  a.addEventListener('y', e2 => e2.stopPropagation()); doc.addEventListener('y', () => seen.push('late'));
  assert.equal(b.dispatch('y').propagationStopped, true); assert.ok(!seen.includes('late'), 'a stopped it before the document');
  const p = b.dispatch('x'); assert.equal(p.defaultPrevented, false); b.addEventListener('z', e2 => e2.preventDefault()); assert.equal(b.dispatch('z').defaultPrevented, true);
});
test('fixture: several listeners per type; listenerCount over all types follows removeEventListener', t => {
  const doc = useDom(t); const n = doc.createElement('div'); let hits = 0; const f = () => hits++, g = () => hits += 10;
  n.addEventListener('a', f); n.addEventListener('a', g); n.addEventListener('b', f); assert.equal(n.listenerCount(), 3);
  n.dispatch('a'); assert.equal(hits, 11); n.removeEventListener('a', f); n.removeEventListener('a', f); assert.equal(n.listenerCount(), 2);
  n.dispatch('a'); assert.equal(hits, 21); doc.addEventListener('k', f); assert.equal(doc.listenerCount(), 1); doc.removeEventListener('k', f); assert.equal(doc.listenerCount(), 0);
});
test('fixture: tree, classList, closest and predicate queries', t => {
  const doc = useDom(t); const a = doc.createElement('div'), b = doc.createElement('span'), c = doc.createElement('b'); doc.body.append(a); a.append(b); b.append(c, 'text');
  a.className = 'x y'; assert.ok(a.classList.contains('y')); a.classList.toggle('y'); a.classList.add('z'); assert.equal(a.className, 'x z'); assert.equal(a.classList.toggle('q', false), false);
  assert.equal(c.closest(n => n.tag === 'div'), a); assert.equal(c.closest(n => n.tag === 'b'), c); assert.equal(c.closest(n => n.tag === 'nav'), null);
  assert.deepEqual(a.querySelectorAll(n => n.tag === 'b' || n.tag === 'div'), [c]); assert.equal(findAll(a, () => true).length, 4);
  assert.ok(a.contains(c)); b.replaceChildren(); assert.equal(c.parent, null); assert.equal(a.contains(c), false);
  c.focus(); assert.equal(doc.activeElement, c); a.remove(); assert.equal(doc.body.children.length, 0);
  assert.equal(doc.createElement('canvas').toDataURL(), 'data:image/png;base64,');
});
test('fixture: listener options are a browser\'s: capture is identity, once fires once, duplicates are no-ops', t => {
  const doc = useDom(t); const n = doc.createElement('div'); let hits = 0; const f = () => hits++;
  n.addEventListener('a', f); n.addEventListener('a', f); n.addEventListener('a', f, false); assert.equal(n.listenerCount(), 1);
  n.addEventListener('a', f, true); n.addEventListener('a', f, { capture: true }); assert.equal(n.listenerCount(), 2);
  n.removeEventListener('a', f, { capture: true }); assert.equal(n.listenerCount(), 1); n.removeEventListener('a', f, true); assert.equal(n.listenerCount(), 1);
  n.removeEventListener('a', f); assert.equal(n.listenerCount(), 0);
  n.addEventListener('o', f, { once: true }); n.dispatch('o'); n.dispatch('o'); assert.equal(hits, 1); assert.equal(n.listenerCount(), 0);
});
test('fixture: capture listeners on ancestors run first, top down; bubble ones after the target', t => {
  const doc = useDom(t); const a = doc.createElement('div'), b = doc.createElement('div'); doc.body.append(a); a.append(b); const seen = [];
  a.addEventListener('x', () => seen.push('a-bubble')); a.addEventListener('x', () => seen.push('a-capture'), true); b.addEventListener('x', () => seen.push('b'));
  doc.addEventListener('x', () => seen.push('doc-capture'), { capture: true });
  b.dispatch('x'); assert.deepEqual(seen, ['doc-capture', 'a-capture', 'b', 'a-bubble']);
  seen.length = 0; doc.addEventListener('y', e => e.stopPropagation(), true); b.addEventListener('y', () => seen.push('b')); b.dispatch('y'); assert.deepEqual(seen, []);
});

test('on load the frame focuses itself only while canFocus() is true', t => {
  const doc = useDom(t); let ok = false; const p = createPlayer({ online: () => true, canFocus: () => ok });
  p.play({ pid: 'a-1', title: 'A' }); p.frame().dispatch('load'); assert.notEqual(doc.activeElement, p.frame());
  ok = true; p.frame().dispatch('load'); assert.equal(doc.activeElement, p.frame());
});
