import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH, randomBytes } from 'node:crypto';
import { PushNotifications } from '../server/push.mjs';

const subscription = endpoint => {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  return { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
};

test('push subscriptions survive restart, deliver transitions and can be removed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-push-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'push.json'), sent = [];
  const send = async (sub, payload) => sent.push([sub.endpoint, JSON.parse(payload)]);
  const push = await new PushNotifications(file, { send }).load();
  const sub = subscription('https://web.push.apple.com/example');
  await push.subscribe(sub);
  assert.ok((await readFile(file, 'utf8')).includes(sub.endpoint));
  const restored = await new PushNotifications(file, { send }).load();
  assert.equal(restored.publicKey, push.publicKey);
  await restored.update([{ id: 'a', status: 'working', title: 'Fix login', project: 'Dashboard' }]);
  await restored.update([{ id: 'a', status: 'permission', title: 'Fix login', project: 'Dashboard' }]);
  assert.deepEqual(sent, [[sub.endpoint, { kind: 'input', id: 'a', status: 'permission', title: 'Fix login', project: 'Dashboard' }]]);
  await restored.unsubscribe(sub.endpoint);
  await restored.update([{ id: 'a', status: 'working' }]);
  await restored.update([{ id: 'a', status: 'idle' }]);
  assert.equal(sent.length, 1);
});

test('push subscriptions reject arbitrary endpoints and malformed keys', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-push-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const push = await new PushNotifications(join(dir, 'push.json')).load();
  await assert.rejects(push.subscribe(subscription('https://127.0.0.1/private')), /subscription/i);
  await assert.rejects(push.subscribe({ endpoint: 'https://web.push.apple.com/example', keys: { p256dh: 'x', auth: 'x' } }), /subscription/i);
});

test('changing the dashboard password revokes subscriptions even when changed outside the server', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-push-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const { writeFile } = await import('node:fs/promises');
  const credentialFile = join(dir, 'auth.json');
  await writeFile(credentialFile, JSON.stringify({ hash: 'old' }));
  const sent = [], push = await new PushNotifications(join(dir, 'push.json'), { credentialFile, send: async (...args) => sent.push(args) }).load();
  await push.subscribe(subscription('https://web.push.apple.com/example'));
  await push.update([{ id: 'a', status: 'working' }]);
  await writeFile(credentialFile, JSON.stringify({ hash: 'new' }));
  await push.update([{ id: 'a', status: 'idle' }]);
  assert.equal(sent.length, 0);
});

test('push identifies the session needing permission and clicking it opens the session', async () => {
  const { runInNewContext } = await import('node:vm');
  const handlers = {}, shown = [], opened = [];
  const self = { addEventListener: (type, fn) => { handlers[type] = fn; }, registration: { showNotification: async (title, options) => shown.push({ title, options }) }, clients: { matchAll: async () => [], openWindow: async url => opened.push(url) } };
  runInNewContext(await readFile(new URL('../client/public/sw.js', import.meta.url), 'utf8'), { self, URLSearchParams });
  let pending;
  handlers.push({ data: { json: () => ({ kind: 'input', id: 'codex:abc', status: 'permission', title: 'Fix login', project: 'Dashboard' }) }, waitUntil: promise => { pending = promise; } });
  await pending;
  assert.equal(shown[0].title, 'Permission needed');
  assert.equal(shown[0].options.body, 'Dashboard · Fix login');
  handlers.notificationclick({ notification: { ...shown[0].options, close() {} }, waitUntil: promise => { pending = promise; } });
  await pending;
  assert.equal(opened[0], '/#session=codex%3Aabc');
});

test('expired push endpoints are removed and stay removed after restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-push-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'push.json');
  const push = await new PushNotifications(file, { send: async () => { throw Object.assign(new Error('Gone'), { statusCode: 410 }); } }).load();
  await push.subscribe(subscription('https://web.push.apple.com/expired'));
  await push.update([{ id: 'a', status: 'working' }]);
  await push.update([{ id: 'a', status: 'idle' }]);
  const restored = await new PushNotifications(file).load();
  assert.equal(restored.subscriptions.size, 0);
});


test('push displays questions, completed work, and missing session details clearly', async () => {
  const { runInNewContext } = await import('node:vm');
  const handlers = {}, shown = [];
  const self = { addEventListener: (type, fn) => { handlers[type] = fn; }, registration: { showNotification: async (title, options) => shown.push({ title, body: options.body }) } };
  runInNewContext(await readFile(new URL('../client/public/sw.js', import.meta.url), 'utf8'), { self, URLSearchParams });
  for (const data of [{ kind: 'input', status: 'question', title: 'Investigate' }, { kind: 'ready', title: 'Review', project: 'App' }, { kind: 'error', status: 'error', title: 'Failed build', project: 'App' }, { kind: 'input' }]) {
    let pending; handlers.push({ data: { json: () => data }, waitUntil: promise => { pending = promise; } }); await pending;
  }
  assert.deepEqual(shown, [{ title: 'Question for you', body: 'Investigate' }, { title: 'Done', body: 'App · Review' }, { title: 'Error', body: 'App · Failed build' }, { title: 'Needs you', body: 'Open AI Control' }]);
});

test('background push uses category and project policy without replaying suppressed transitions', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-push-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const sent = [];
  const push = await new PushNotifications(join(dir, 'push.json'), { send: async (_, payload) => sent.push(JSON.parse(payload)) }).load();
  await push.subscribe(subscription('https://web.push.apple.com/policy'));
  push.setPolicy({ categories: { permissions: false, completions: false }, mutedProjects: ['/work/muted'] });
  const sessions = statuses => statuses.map((status, index) => ({ id: String(index), status, cwd: index === 3 ? '/work/muted' : '/work/app' }));
  await push.update(sessions(['working', 'working', 'working', 'working', 'working']));
  await push.update(sessions(['permission', 'question', 'idle', 'error', 'error']));
  assert.deepEqual(sent.map(event => [event.id, event.kind]), [['1', 'input'], ['4', 'error']]);
  push.setPolicy({});
  await push.update(sessions(['permission', 'question', 'idle', 'error', 'error']));
  assert.equal(sent.length, 2);
  push.setPolicy({ categories: { questions: false, errors: false } });
  await push.update(sessions(['working', 'working', 'working', 'working', 'working']));
  await push.update(sessions(['permission', 'question', 'idle', 'error', 'error']));
  assert.deepEqual(sent.slice(2).map(event => [event.id, event.kind]), [['0', 'input'], ['2', 'ready']]);
});

test('background push observes overnight quiet hours in the configured time zone', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-push-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const sent = [];
  let now = Date.parse('2026-11-09T21:00:00Z'); // 22:00 in Stockholm.
  const push = await new PushNotifications(join(dir, 'push.json'), { send: async (_, payload) => sent.push(JSON.parse(payload)), now: () => now }).load();
  await push.subscribe(subscription('https://web.push.apple.com/quiet'));
  push.setPolicy({ quietHours: { enabled: true, start: '22:00', end: '07:00', timeZone: 'Europe/Stockholm' } });
  await push.update([{ id: 'a', status: 'working' }]);
  await push.update([{ id: 'a', status: 'permission' }]);
  now = Date.parse('2026-11-10T05:59:00Z'); // 06:59 in Stockholm.
  await push.update([{ id: 'a', status: 'working' }]);
  await push.update([{ id: 'a', status: 'error' }]);
  assert.equal(sent.length, 0);
  now = Date.parse('2026-11-10T06:00:00Z');
  await push.update([{ id: 'a', status: 'error' }]);
  assert.equal(sent.length, 0, 'quiet events are consumed rather than queued for later');
  await push.update([{ id: 'a', status: 'working' }]);
  await push.update([{ id: 'a', status: 'idle' }]);
  assert.deepEqual(sent.map(event => event.kind), ['ready']);
});
