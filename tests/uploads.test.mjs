import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maxUploads, uploadedImages, uploadDigest } from '../server/uploads.mjs';
import { ClaudeMessaging } from '../server/claude-messaging.mjs';
import { Auth, savePassword } from '../server/auth.mjs';
import { RequestStore } from '../server/requests.mjs';
import { createHandler } from '../server/http.mjs';
import { codexMessage } from '../server/messages.mjs';
import { fitSize, imageFiles } from '../client/composer-images.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0]);
const item = (bytes, name) => ({ data: bytes.toString('base64'), name });

test('attached images are typed by their bytes, bounded, and named safely', () => {
  const [first, second] = uploadedImages([item(png, '../../etc/pass wd.png'), { data: jpeg.toString('base64'), type: 'image/png' }]);
  assert.equal(first.type, 'image/png'); assert.equal(first.name, '....etcpass wd.png');
  assert.equal(second.type, 'image/jpeg'); assert.equal(second.name, 'image-2.jpg');
  assert.equal(first.url, `data:image/png;base64,${png.toString('base64')}`);
  assert.deepEqual(uploadedImages(undefined), []);
  assert.notEqual(uploadDigest([first]), uploadDigest([second]));
  for (const bad of [[{ data: Buffer.from('<svg onload=alert(1)>').toString('base64') }], [{ data: 'not base64!' }], [{}], 'png', Array(maxUploads + 1).fill(item(png)), [{ data: Buffer.alloc(9 * 1024 * 1024, 1).toString('base64') }]])
    assert.throws(() => uploadedImages(bad), { status: 400 });
});

test('a sent image shows as a marker in Codex history', () => {
  assert.equal(codexMessage({ item: { type: 'userMessage', id: 'u', content: [{ type: 'image', url: 'x' }, { type: 'localImage', path: '/a.png' }] } }).text, '[image ×2] ');
});

test('the browser only offers images, and fits them within an edge', () => {
  assert.deepEqual(imageFiles([{ type: 'image/png' }, { type: 'text/plain' }, null]), [{ type: 'image/png' }]);
  assert.deepEqual(fitSize(4000, 2000, 2000), [2000, 1000]);
  assert.deepEqual(fitSize(300, 200, 2000), [300, 200]);
});

// Claude takes a pasted image path as [Image #n], so the fake pane shows one chip per pasted path.
function pane(t, { chips = true } = {}) {
  const calls = []; let input = '';
  const tmux = async (args, stdin) => {
    if (args[0] !== 'capture-pane') calls.push(stdin === undefined ? args : [...args, stdin]);
    if (args[0] === 'display-message') return '100\n';
    if (args[0] === 'load-buffer') input += /\.png$/.test(stdin) ? (chips ? `[Image #${(input.match(/\[Image/g) || []).length + 1}]` : stdin) : stdin;
    if (args[0] === 'send-keys') input = args.includes('C-u') ? '' : args.includes('Enter') ? '' : input;
    if (args[0] === 'capture-pane') return `history\n────\n❯ ${input}\n────\n  ⏵⏵ auto mode on`;
    return '';
  };
  return mkdtemp(join(tmpdir(), 'ai-control-uploads-')).then(dir => {
    t.after(() => rm(dir, { recursive: true, force: true }));
    return { dir, calls, adapter: new ClaudeMessaging({ tmux, alive: async () => true, parent: async pid => pid === 123 ? 100 : 1, pollMs: 1, settleMs: 40, uploadDir: join(dir, 'uploads'), keepUploadMs: 0 }) };
  });
}
const record = { pid: 123, procStart: '456', sessionId: '11111111-2222-3333-4444-555555555555', tmux: 'main.%7', status: 'idle' };
const submit = extra => ({ text: 'What is this?', mode: 'send', clientMessageId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ...extra });

test('Claude in tmux gets each image as a pasted file path, then the text', async t => {
  const { adapter, calls, dir } = await pane(t);
  const result = await adapter.send(record, submit({ images: [item(png), item(png)] }));
  assert.equal(result.status, 'sent');
  const pasted = calls.filter(call => call[0] === 'load-buffer').map(call => call[4]);
  assert.equal(pasted.length, 3);
  assert.match(pasted[0], /uploads\/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-1\.png$/); assert.match(pasted[1], /-2\.png$/);
  assert.equal(pasted[2], ' What is this?');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(await readdir(join(dir, 'uploads')), []);
  await assert.rejects(adapter.send(record, submit({ images: [] })), /already used/);
});

test('an image alone is enough, and a pane that does not take the path leaves nothing behind', async t => {
  const alone = await pane(t);
  assert.equal((await alone.adapter.send(record, submit({ text: '', images: [item(png)] }))).status, 'sent');
  const refused = await pane(t, { chips: false });
  await assert.rejects(refused.adapter.send(record, submit({ images: [item(png)] })), { status: 503 });
  assert.ok(refused.calls.some(call => call.includes('C-u')));
  assert.deepEqual(await readdir(join(refused.dir, 'uploads')), []);
});

test('Claude without tmux refuses images instead of dropping them', async () => {
  const adapter = new ClaudeMessaging({ alive: async () => true });
  adapter.inboxAvailable = async () => true;
  await assert.rejects(adapter.send({ ...record, tmux: undefined }, submit({ images: [item(png)] })), { status: 409, message: /tmux/ });
});

test('only the message route takes a large body, and gets it intact', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-control-body-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'auth.json'), password = 'correct horse testing battery'; await savePassword(file, password);
  const origin = 'https://control.test:47841', received = [];
  const handler = createHandler({ auth: new Auth(file), origin, store: new RequestStore(), snapshot: () => ({}), vite: () => {},
    messages: { send: async (id, body) => { received.push(body); return { status: 'sent' }; }, model: async () => ({}) } });
  const request = async (path, { headers = {}, body } = {}) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url: path, method: 'POST', headers: { host: 'control.test:47841', origin, 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '100.80.0.2' } });
    const res = { headers: {}, statusCode: 200, headersSent: false, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, end(raw) { this.raw = raw; this.headersSent = true; } };
    await handler(req, res); return res;
  };
  const login = await request('/api/login', { body: { password } });
  const headers = { cookie: login.headers['set-cookie'].split(';')[0], 'x-csrf-token': JSON.parse(login.raw).csrf };
  const text = 'é'.repeat(70_000), big = { text: 'Look é', images: [{ data: 'A'.repeat(3_000_000) }] };
  assert.equal((await request('/api/sessions/codex%3Aa/messages', { headers, body: big })).statusCode, 200);
  assert.deepEqual(received[0], big);
  assert.equal((await request('/api/sessions/codex%3Aa/messages', { headers, body: { text: 'x'.repeat(50 * 1024 * 1024) } })).statusCode, 413);
  assert.equal((await request('/api/sessions/codex%3Aa/model', { headers, body: { model: text } })).statusCode, 413);
});
