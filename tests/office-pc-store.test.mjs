import test from 'node:test';
import assert from 'node:assert/strict';
import { createPcStore, EMPTY_DESKTOP, preview } from '../client/office/pc-store.js';
import { CARTS_KEY } from '../client/office/carts.js';

const tick = () => new Promise(setImmediate);
const desk = extra => ({ ...structuredClone(EMPTY_DESKTOP), icons: [{ id: 'i1', kind: 'cart', pid: 'a-1', name: 'A', author: '', embed: true }], spots: { browser: [0, 0], salaries: [0, 1], i1: [0, 2] }, ...extra });
const memory = (init = {}) => { const m = { ...init }; return { getItem: k => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, m }; };

test('GET only on the first sit-down, again only after a failure', async () => {
  const calls = []; let fail = true;
  const store = createPcStore({ api: async (path, body) => { calls.push([path, body]); if (fail) throw new Error('down'); return desk(); }, storage: memory(), onChange() {}, onError() {} });
  assert.equal(await store.load(), false); fail = false;
  assert.equal(await store.load(), true); await store.load();
  assert.deepEqual(calls.map(c => c[0]), ['office/pc', 'office/pc']);
});
test('ops go out one at a time, in order', async () => {
  const sent = [], gates = [];
  const api = (path, body) => body ? new Promise(done => { sent.push(body.op); gates.push(() => done(desk({ last: body.op }))); }) : Promise.resolve(desk());
  const store = createPcStore({ api, storage: memory(), onChange() {}, onError() {} }); await store.load();
  const a = store.apply({ op: 'move', id: 'i1', spot: [5, 0] }), b = store.apply({ op: 'rename', id: 'i1', name: 'Z' });
  await tick(); assert.deepEqual(sent, ['move']);
  assert.deepEqual(store.desktop().spots.i1, [5, 0]); assert.equal(store.desktop().icons[0].name, 'Z', 'both previews show');
  gates[0](); await a; await tick(); assert.deepEqual(sent, ['move', 'rename']);
  gates[1](); await b; assert.equal(store.desktop().last, 'rename');
});
test("a failed op goes back to the server's desktop and says why", async () => {
  const errors = [], reply = desk();
  const api = async (path, body) => { if (body) throw new Error('Names are 1–40 characters.'); return reply; };
  const store = createPcStore({ api, storage: memory(), onChange() {}, onError: m => errors.push(m) }); await store.load();
  assert.equal(await store.apply({ op: 'rename', id: 'i1', name: '' }), null);
  assert.deepEqual(errors, ['Names are 1–40 characters.']); assert.deepEqual(store.desktop(), reply);
});
test('an op before load loads first', async () => {
  let errors = 0; const calls = [];
  const bad = createPcStore({ api: async () => { throw new Error('down'); }, storage: memory(), onChange() {}, onError: () => errors++ });
  assert.equal(await bad.apply({ op: 'arrange' }), null); assert.equal(errors, 1);
  const good = createPcStore({ api: async (p, b) => { calls.push(b?.op ?? 'GET'); return desk(); }, storage: memory(), onChange() {}, onError() {} });
  assert.ok(await good.apply({ op: 'arrange' })); assert.deepEqual(calls, ['GET', 'arrange']);
});
test('the old recent list is imported once and its key removed', async () => {
  const sent = [], st = memory({ [CARTS_KEY]: JSON.stringify(['b-1', 'a-1']) });
  const store = createPcStore({ api: async (p, b) => { if (b) sent.push(b); return desk({ imported: !!b }); }, storage: st, onChange() {}, onError() {} });
  await store.load();
  assert.deepEqual(sent, [{ op: 'import', pids: ['a-1', 'b-1'] }]); assert.equal(st.getItem(CARTS_KEY), null);
  const sent2 = [], st2 = memory({ [CARTS_KEY]: JSON.stringify(['b-1']) });
  await createPcStore({ api: async (p, b) => { if (b) sent2.push(b); return desk({ imported: true }); }, storage: st2, onChange() {}, onError() {} }).load();
  const sent3 = [];
  await createPcStore({ api: async (p, b) => { if (b) sent3.push(b); return desk(); }, storage: memory(), onChange() {}, onError() {} }).load();
  assert.deepEqual([sent2, sent3], [[], []]);
});
test('preview: remove, arrange, windows', () => {
  const d = desk();
  assert.deepEqual(preview(d, { op: 'remove', id: 'i1' }).icons, []);
  assert.deepEqual(preview(d, { op: 'remove', id: 'browser' }), d);
  assert.deepEqual(preview({ ...d, spots: { browser: [3, 3], salaries: [1, 1], i1: [9, 4] } }, { op: 'arrange' }).spots, { browser: [0, 0], salaries: [0, 1], i1: [0, 2] });
  const w = desk().windows, order = ['browser', 'notepad', 'pico8'];
  assert.deepEqual(preview(d, { op: 'windows', windows: w, order }).order, order);
  assert.deepEqual(preview(d, { op: 'add', kind: 'link' }), d);
});
