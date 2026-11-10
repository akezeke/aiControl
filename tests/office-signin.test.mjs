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

test('signed out by the hub, or refused a colour: the slip says why', () => {
  assert.deepEqual(slipMode({ joined: false, name: 'Anna', out: 'away' }), { form: true, signOut: false, said: 'Away 2 days', code: '' });
  assert.equal(slipMode({ joined: false, name: 'Anna', out: 'removed' }).said, 'Removed by the host');
  assert.equal(slipMode({ joined: true, name: 'A', host: 'h', refused: 'colour', taken: [COLOURS[1]] }).said, 'That colour is taken.');
  assert.equal(slipMode({ joined: true, name: 'A', host: 'h', refused: 'colour', taken: COLOURS }).said, 'All colours are taken.');
});
test('swatches grey what others hold: roster, signed-in board players, the last refusal; the host gets a chip per player', async t => {
  const was = globalThis.document; t.after(() => { if (was === undefined) delete globalThis.document; else globalThis.document = was; });
  const { container, all } = fakeDom(); const { createSignIn, COLOUR_NAMES } = await import('../client/office/signin.js');
  const players = [{ name: 'Bo', scores: {}, seen: 2, in: true, colour: COLOURS[2] }, { name: 'Cy', scores: {}, seen: 1, colour: COLOURS[3] }, { name: 'Anna', scores: {}, seen: 3, in: true, colour: COLOURS[0] }];
  let state = { joined: true, name: 'Anna', host: 'h', hosting: true, code: 'h/abc', board: { day: '2026-11-10', players }, refused: 'colour', taken: [COLOURS[4]], look: { fruit: 'apple', colour: COLOURS[0] } };
  const on = {}, sent = [], live = { roster: () => [{ id: 'me', name: 'Anna', fruit: 'apple', colour: COLOURS[0], at: 'home' }, { id: 'x', name: 'Di', fruit: 'kiwi', colour: COLOURS[1], at: 'home' }], id: () => 'me', on: (type, fn) => { on[type] = fn; }, send: m => sent.push(m) };
  const slip = createSignIn(container, { state: () => state, setLook: async () => {}, signIn: async () => {}, signOut: async () => {} }, live); slip.open();
  const swatch = i => all(container).find(n => n.title === COLOUR_NAMES[i]);
  assert.deepEqual([0, 1, 2, 3, 4].map(i => swatch(i).disabled), [false, true, true, false, true]);
  const chips = () => all(container).filter(n => n.title?.startsWith('Remove '));
  assert.deepEqual(chips().map(n => [n.textContent, n.title]), [['Bo ✕', 'Remove Bo']]);
  chips()[0].onclick(); assert.deepEqual(sent, [{ type: 'remove', name: 'Bo' }]); assert.ok(chips().every(n => n.hidden));
  state = { ...state, hosting: false, code: undefined }; slip.refresh(); assert.equal(chips().length, 0, 'only the host');
  state = { ...state, hosting: true, code: 'h/abc', board: { day: '2026-11-10', players: players.map(({ in: _, ...p }) => p) } }; slip.refresh(); assert.equal(chips().length, 0, 'an older hub: no chips');
});
test('the live link refusing a colour: said, drawn on the colour you hold, until the next pick; signed out, the name is kept', async t => {
  const was = globalThis.document; t.after(() => { if (was === undefined) delete globalThis.document; else globalThis.document = was; });
  const { container, all } = fakeDom(); const { createSignIn, COLOUR_NAMES } = await import('../client/office/signin.js');
  let state = { joined: true, name: 'Anna', host: 'h', look: { fruit: 'apple', colour: COLOURS[5] } };
  const on = {}, live = { roster: () => [{ id: 'me', name: 'Anna', fruit: 'apple', colour: COLOURS[1], at: 'home' }], id: () => 'me', on: (type, fn) => { on[type] = fn; }, send() {} };
  const slip = createSignIn(container, { state: () => state, setLook: async () => {}, signIn: async () => {}, signOut: async () => {} }, live); slip.open();
  on.refused({ type: 'refused', why: 'colour' });
  const said = () => all(container).find(n => n.className === 'office-signin-error')?.textContent;
  const pressed = () => all(container).find(n => n.className === 'office-signin-swatch on')?.title;
  assert.equal(said(), 'That colour is taken.'); assert.equal(pressed(), COLOUR_NAMES[1]);
  await all(container).find(n => n.title === COLOUR_NAMES[6]).onclick(); await new Promise(r => setTimeout(r));
  assert.equal(said(), undefined);
  state = { joined: false, name: 'Anna', out: 'removed' }; slip.refresh();
  assert.equal(all(container).filter(n => n.tagName === 'INPUT')[1].value, 'Anna'); assert.equal(said(), 'Removed by the host');
});
test('a Join refused a colour greys what it says is taken', async t => {
  const was = globalThis.document; t.after(() => { if (was === undefined) delete globalThis.document; else globalThis.document = was; });
  const { container, all } = fakeDom(); const { createSignIn, COLOUR_NAMES } = await import('../client/office/signin.js');
  const refuse = async () => { throw Object.assign(new Error('That colour is taken.'), { taken: [COLOURS[5]] }); };
  const slip = createSignIn(container, { state: () => null, setLook: async () => {}, signIn: refuse, signOut: async () => {} }, { roster: () => [], id: () => null }); slip.open();
  await all(container).find(n => n.tagName === 'FORM').onsubmit({ preventDefault() {} });
  assert.equal(all(container).find(n => n.title === COLOUR_NAMES[5] && /swatch/.test(n.className)).disabled, true);
});
