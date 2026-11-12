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
test("error() gives the last failure's reason", async () => {
  let fail = true;
  const store = createPcStore({ api: async () => { if (fail) throw new Error('Server says no.'); return desk(); }, storage: memory(), onChange() {}, onError() {} });
  assert.equal(store.error(), 'Desktop unavailable.');
  assert.equal(await store.load(), false); assert.equal(store.error(), 'Server says no.');
  fail = false; assert.equal(await store.load(), true);
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

test('a throwing onChange or onError neither drops another preview nor wedges the chain', async () => {
  const sent = [], gates = [];
  let boom = true;
  const api = (p, b) => b ? new Promise(done => { sent.push(b.op); gates.push(() => done(desk({ last: b.op }))); }) : Promise.resolve(desk());
  const store = createPcStore({ api, storage: memory(), onChange() { if (boom && sent.length === 1 && gates.length === 1 && store.desktop().last === 'move') { boom = false; throw new Error('ui'); } }, onError() {} });
  await store.load();
  const a = store.apply({ op: 'move', id: 'i1', spot: [5, 0] }), b = store.apply({ op: 'rename', id: 'i1', name: 'Z' });
  await tick(); gates[0]();
  assert.ok(await a, 'a succeeded despite onChange throwing');
  assert.equal(store.desktop().icons[0].name, 'Z', "b's preview survives"); await tick(); assert.deepEqual(sent, ['move', 'rename']);
  gates[1](); assert.ok(await b);
  const bad = createPcStore({ api: async (p, b) => { if (b) throw new Error('no'); return desk(); }, storage: memory(), onChange() {}, onError() { throw new Error('ui'); } });
  await bad.load(); assert.equal(await bad.apply({ op: 'arrange' }), null); assert.equal(await bad.apply({ op: 'arrange' }), null);
});
test('an op waits for the import to settle', async () => {
  const sent = []; let release;
  const api = (p, b) => b ? new Promise(done => { sent.push(b.op); if (b.op === 'import') release = () => done(desk({ imported: true })); else done(desk({ last: b.op })); }) : Promise.resolve(desk({ imported: false }));
  const store = createPcStore({ api, storage: memory({ [CARTS_KEY]: '["a-1"]' }), onChange() {}, onError() {} });
  const l = store.load(); await tick(); assert.equal(store.loaded(), false);
  const a = store.apply({ op: 'arrange' }); await tick(); assert.deepEqual(sent, ['import']);
  release(); await l; await a; assert.deepEqual(sent, ['import', 'arrange']); assert.equal(store.loaded(), true);
});
test('preview never throws', () => {
  assert.deepEqual(preview(desk(), { op: 'rename', id: 'nope', name: 'x' }), desk());
  assert.doesNotThrow(() => preview({}, { op: 'move', id: 'x', spot: [1, 1] }));
  assert.doesNotThrow(() => preview({}, { op: 'remove', id: 'x' }));
  assert.doesNotThrow(() => preview(null, { op: 'arrange' }));
});
test('a failed import leaves the old list; a failed move leaves the rename; a failed pre-load apply leaves nothing; loads share a GET', async () => {
  const st = memory({ [CARTS_KEY]: '["a-1"]' });
  await createPcStore({ api: async (p, b) => { if (b) throw new Error('x'); return desk({ imported: false }); }, storage: st, onChange() {}, onError() {} }).load();
  assert.equal(st.getItem(CARTS_KEY), '["a-1"]');
  const gates = [], errors = [];
  const s2 = createPcStore({ api: (p, b) => b ? new Promise((ok, no) => gates.push({ ok, no, op: b.op })) : Promise.resolve(desk()), storage: memory(), onChange() {}, onError: m => errors.push(m) });
  await s2.load();
  const m = s2.apply({ op: 'move', id: 'i1', spot: [0, 1] }), r = s2.apply({ op: 'rename', id: 'i1', name: 'Q' });
  await tick(); gates[0].no(new Error('taken')); assert.equal(await m, null); await tick();
  assert.equal(s2.desktop().icons[0].name, 'Q'); assert.deepEqual(s2.desktop().spots.i1, [0, 2]); assert.deepEqual(errors, ['taken']);
  gates[1].ok(desk()); await r;
  const s3 = createPcStore({ api: async () => { throw new Error('down'); }, storage: memory(), onChange() {}, onError() {} });
  await s3.apply({ op: 'rename', id: 'i1', name: 'Q' }); assert.deepEqual(s3.desktop(), EMPTY_DESKTOP);
  let gets = 0; const s4 = createPcStore({ api: async () => { gets++; return desk(); }, storage: memory(), onChange() {}, onError() {} });
  await Promise.all([s4.load(), s4.load()]); assert.equal(gets, 1);
});
