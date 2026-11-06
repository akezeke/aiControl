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
  for (const data of [{ kind: 'input', status: 'question', title: 'Investigate' }, { kind: 'ready', title: 'Review', project: 'App' }, { kind: 'input' }]) {
    let pending; handlers.push({ data: { json: () => data }, waitUntil: promise => { pending = promise; } }); await pending;
  }
  assert.deepEqual(shown, [{ title: 'Question for you', body: 'Investigate' }, { title: 'Done', body: 'App · Review' }, { title: 'Needs you', body: 'Open AI Control' }]);
});
