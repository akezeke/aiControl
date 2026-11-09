import test from 'node:test';
import assert from 'node:assert/strict';
import { slipMode } from '../client/office/signin.js';

test('the slip: a form to join, Leave whenever you are in a meeting', () => {
  assert.deepEqual(slipMode(null), { form: true, signOut: false, said: '', code: '' });
  assert.deepEqual(slipMode({ joined: false }), { form: true, signOut: false, said: '', code: '' });
  assert.deepEqual(slipMode({ joined: true, name: 'Anna', host: 'h' }), { form: false, signOut: true, said: '', code: '' });
  assert.deepEqual(slipMode({ joined: true, name: 'Anna', host: 'h', offline: true }), { form: false, signOut: true, said: 'Off for now', code: '' });
  assert.equal(slipMode({ joined: true, name: 'Anna', host: 'h', offline: true, outdated: true }).said, 'Update AI Control');
  // A replaced code: join again with the new one, or leave this meeting for good.
  assert.deepEqual(slipMode({ joined: true, name: 'Anna', host: 'h', error: 'code' }), { form: true, signOut: true, said: 'The code was changed', code: '' });
});

test('the meeting code shows only for a host that has one', () => {
  assert.equal(slipMode({ joined: true, name: 'A', host: 'h', hosting: true, code: 'h/abc' }).code, 'h/abc');
  assert.equal(slipMode({ joined: true, name: 'A', host: 'h', hosting: false, code: 'h/abc' }).code, '');
  assert.equal(slipMode({ joined: true, name: 'A', host: 'h', hosting: true }).code, '');
  assert.equal(slipMode(null).code, '');
});

// A DOM just big enough for the slip: elements keep their children, and inputs and buttons their handlers.
function fakeDom() {
  const el = tag => ({ tagName: tag.toUpperCase(), children: [], style: {}, value: '', hidden: false,
    append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = c; }, remove() {},
    setAttribute() {}, addEventListener() {}, focus() {}, blur() {}, contains() { return false }, querySelector() { return null } });
  globalThis.document = { createElement: el, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const all = (node, out = []) => { out.push(node); for (const c of node.children || []) all(c, out); return out; };
  return { container: el('div'), all };
}

test('picking a fruit or colour keeps what you typed in the join form', async t => {
  const was = globalThis.document; t.after(() => { if (was === undefined) delete globalThis.document; else globalThis.document = was; });
  const { container, all } = fakeDom();
  const { createSignIn } = await import('../client/office/signin.js');
  const online = { state: () => null, setLook: async () => {}, signIn: async () => {}, signOut: async () => {} };
  const slip = createSignIn(container, online, { roster: () => [], id: () => null });
  slip.open();
  const inputs = () => all(container).filter(n => n.tagName === 'INPUT');
  const [code, name] = inputs();
  code.value = 'pc.ts.net/abc'; code.oninput?.(); name.value = 'Anna'; name.oninput?.();
  all(container).find(n => n.tagName === 'BUTTON' && n.title === 'pear').onclick();
  assert.deepEqual(inputs().map(i => i.value), ['pc.ts.net/abc', 'Anna']);
  all(container).find(n => n.tagName === 'BUTTON' && /swatch/.test(n.className || '') && !n.disabled).onclick();
  assert.deepEqual(inputs().map(i => i.value), ['pc.ts.net/abc', 'Anna']);
});
