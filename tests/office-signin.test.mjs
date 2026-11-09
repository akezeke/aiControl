import test from 'node:test';
import assert from 'node:assert/strict';
import { slipMode, slipLook } from '../client/office/signin.js';
import { FRUITS, COLOURS } from '../client/office/meeting.js';

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

test("the pickers show what you just picked, else what the meeting gave you, else what's saved", () => {
  const saved = { fruit: 'kiwi', colour: COLOURS[0] }, mine = { fruit: 'kiwi', colour: COLOURS[3] }, none = { fruit: null, colour: null };
  // Your saved colour was taken when you came in: the hub gave you another, and that's what you wear.
  assert.deepEqual(slipLook(null, mine, saved), { fruit: 'kiwi', colour: COLOURS[3] });
  assert.deepEqual(slipLook({ fruit: 'pear', colour: COLOURS[5] }, mine, saved), { fruit: 'pear', colour: COLOURS[5] });
  assert.deepEqual(slipLook(null, none, saved), saved, 'not in the room (yet): what you saved');
  assert.deepEqual(slipLook(null, none, undefined), { fruit: FRUITS[0][0], colour: COLOURS[0] });
});

// A DOM just big enough for the slip: elements keep their children, and inputs and buttons their handlers.
function fakeDom() {
  const el = tag => ({ tagName: tag.toUpperCase(), children: [], style: {}, value: '', hidden: false, attrs: {},
    append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = c; }, remove() {},
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; }, addEventListener() {}, focus() { globalThis.document.activeElement = this; }, blur() {},
    contains(node) { return all(this).includes(node); }, querySelector() { return null }, querySelectorAll(tag) { return all(this).filter(n => n.tagName === tag.toUpperCase()); } });
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

test('the slip follows the room while it is up: the colour the hub gave you, the ones others took, and focus kept', async t => {
  const was = globalThis.document; t.after(() => { if (was === undefined) delete globalThis.document; else globalThis.document = was; });
  const { container, all } = fakeDom();
  const { createSignIn } = await import('../client/office/signin.js');
  let state = { joined: true, name: 'Anna', host: 'h', board: null, look: { fruit: 'kiwi', colour: COLOURS[0] } };
  let roster = [{ id: 'me', name: 'Anna', fruit: 'kiwi', colour: COLOURS[3], at: 'home' }];
  const slip = createSignIn(container, { state: () => state, setLook: async () => {}, signIn: async () => {}, signOut: async () => {} }, { roster: () => roster, id: () => 'me' });
  slip.open();
  const button = title => all(container).find(n => n.tagName === 'BUTTON' && n.title === title);
  assert.equal(button('mint').getAttribute('aria-pressed'), 'true', 'the colour the hub gave you, not the saved pink');
  button('kiwi').focus();
  roster = [...roster, { id: 'bo', name: 'Bo', fruit: 'apple', colour: COLOURS[1], at: 'home' }];
  slip.refresh();
  assert.equal(button('blue').disabled, true, "Bo's colour, taken");
  assert.equal(globalThis.document.activeElement, button('kiwi'), 'the focused button is still focused');
  // Something being typed isn't drawn over.
  state = { joined: false }; slip.refresh();
  const [code] = all(container).filter(n => n.tagName === 'INPUT'); code.focus();
  roster = roster.slice(0, 1); slip.refresh();
  assert.equal(all(container).filter(n => n.tagName === 'INPUT')[0], code);
  assert.equal(button('blue').disabled, true);
});
