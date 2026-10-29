import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { TranscriptImages, imageType, imageLimit } from '../server/images.mjs';
import { ClaudeAdapter } from '../server/claude.mjs';
import { Auth, savePassword } from '../server/auth.mjs';
import { RequestStore } from '../server/requests.mjs';
import { createHandler } from '../server/http.mjs';

const sessionId = '11111111-2222-3333-4444-555555555555';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0]);
const image = (bytes, media_type = 'image/png') => ({ type: 'image', source: { type: 'base64', media_type, data: bytes.toString('base64') } });
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n, content, extra = {}) => JSON.stringify({ uuid: uuid(n), sessionId, type: 'user', timestamp: '2026-10-28T12:00:00Z', message: { role: 'user', content }, ...extra }) + '\n';

async function transcript(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-control-images-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const projects = join(dir, 'projects'); await mkdir(join(projects, 'repo'), { recursive: true });
  return { dir, projects, path: join(projects, 'repo', `${sessionId}.jsonl`) };
}

test('image types come from the bytes', () => {
  assert.equal(imageType(png), 'image/png');
  assert.equal(imageType(jpeg), 'image/jpeg');
  assert.equal(imageType(Buffer.from('<svg onload="alert(1)">')), null);
  assert.equal(imageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
});

test('pasted and tool-result images are listed in order and served by id, nothing else', async t => {
  const { path } = await transcript(t), reader = new TranscriptImages();
  await writeFile(path, [
    row(1, [{ type: 'text', text: 'Look' }, image(png)]),
    row(2, [{ type: 'tool_result', tool_use_id: 'a', content: [image(jpeg, 'image/png')] }, { type: 'tool_result', tool_use_id: 'b', content: 'text only' }]),
    row(3, [image(Buffer.from('<svg onload="alert(1)">'))]),
    row(4, [image(png)], { sessionId: 'another' }),
    row(5, [image(png)], { type: 'assistant' }),
    row(6, [{ type: 'image', source: { type: 'url', url: 'file:///etc/passwd' } }, image(png)]),
  ].join(''));
  const list = await reader.list(path, sessionId);
  assert.deepEqual(list.map(({ id, type, tool }) => [id, type, tool]), [[`${uuid(1)}:0`, 'image/png', false], [`${uuid(2)}:0`, 'image/jpeg', true], [`${uuid(6)}:1`, 'image/png', false]]);
  assert.equal(list[0].at, Date.parse('2026-10-28T12:00:00Z'));
  assert.ok(!('data' in list[0]) && !('offset' in list[0]));
  assert.deepEqual(await reader.get(path, sessionId, `${uuid(2)}:0`), { type: 'image/jpeg', data: jpeg });
  assert.equal(await reader.get(path, sessionId, `${uuid(3)}:0`), null);
  assert.equal(await reader.get(path, sessionId, `${uuid(6)}:0`), null);
});

test('only what was appended is scanned, a half-written line waits, and a long transcript is read from its tail', async t => {
  const { path } = await transcript(t), reader = new TranscriptImages({ scanBytes: 4096 });
  await writeFile(path, row(1, [image(png)]));
  assert.equal((await reader.list(path, sessionId)).length, 1);
  const next = row(2, [image(jpeg)]);
  await appendFile(path, next.slice(0, 40));
  assert.equal((await reader.list(path, sessionId)).length, 1);
  await appendFile(path, next.slice(40));
  assert.deepEqual((await reader.list(path, sessionId)).map(i => i.type), ['image/png', 'image/jpeg']);
  assert.deepEqual((await reader.get(path, sessionId, `${uuid(2)}:0`)).data, jpeg);
  // Fresh reader: the first image is beyond the tail.
  await appendFile(path, row(3, [{ type: 'text', text: 'x'.repeat(5000) }]) + row(4, [image(png)]));
  assert.deepEqual((await new TranscriptImages({ scanBytes: 4096 }).list(path, sessionId)).map(i => i.id), [`${uuid(4)}:0`]);
  await writeFile(path, Array.from({ length: imageLimit + 5 }, (_, i) => row(i, [image(png)])).join(''));
  const list = await new TranscriptImages().list(path, sessionId);
  assert.equal(list.length, imageLimit);
  assert.equal(list.at(-1).id, `${uuid(imageLimit + 4)}:0`);
});

test('the Claude adapter serves images only for known sessions with transcripts in a projects folder', async t => {
  const { dir, projects, path } = await transcript(t);
  await writeFile(path, row(1, [image(png)]));
  const claude = new ClaudeAdapter(new RequestStore(), join(dir, 'hook.sock'), { accounts: [{ label: '', sessionsDir: join(dir, 'sessions'), projectsDir: projects }] });
  await assert.rejects(claude.imageList(`claude:${sessionId}`), { status: 409 });
  claude.paths.set(`claude:${sessionId}`, path);
  assert.deepEqual((await claude.imageList(`claude:${sessionId}`)).images.map(i => i.id), [`${uuid(1)}:0`]);
  assert.deepEqual((await claude.image(`claude:${sessionId}`, `${uuid(1)}:0`)).data, png);
  await assert.rejects(claude.image(`claude:${sessionId}`, '../../etc/passwd'), { status: 404 });
  const outside = join(dir, `${sessionId}.jsonl`); await writeFile(outside, row(1, [image(png)]));
  claude.paths.set(`claude:${sessionId}`, outside);
  await assert.rejects(claude.imageList(`claude:${sessionId}`), { status: 409 });
});

test('image endpoints need a login and send only the image', async t => {
  const { dir } = await transcript(t), file = join(dir, 'auth.json'), password = 'correct horse testing battery';
  await savePassword(file, password);
  const origin = 'https://control.test:47841', calls = [];
  const handler = createHandler({ auth: new Auth(file), origin, store: new RequestStore(), snapshot: () => ({}), vite: () => {}, messages: {
    images: async id => { calls.push(id); return { images: [{ id: `${uuid(1)}:0`, type: 'image/png' }] }; },
    image: async (id, imageId) => { calls.push([id, imageId]); return { type: 'image/png', data: png }; },
  } });
  const request = async (path, { method = 'GET', headers = {}, body } = {}) => {
    const req = Readable.from(body ? [JSON.stringify(body)] : []);
    Object.assign(req, { url: path, method, headers: { host: 'control.test:47841', ...headers }, socket: { remoteAddress: '100.80.0.2' } });
    const res = { headers: {}, statusCode: 200, headersSent: false, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, end(raw) { this.raw = raw; this.headersSent = true; } };
    await handler(req, res); return res;
  };
  const path = `/api/sessions/claude%3A${sessionId}/images`;
  assert.equal((await request(path)).statusCode, 401);
  assert.equal((await request(`${path}/${uuid(1)}%3A0`)).statusCode, 401);
  assert.equal(calls.length, 0);
  const login = await request('/api/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: { password } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  assert.equal(JSON.parse((await request(path, { headers: { cookie } })).raw).images.length, 1);
  const res = await request(`${path}/${uuid(1)}%3A0`, { headers: { cookie } });
  assert.equal(res.headers['content-type'], 'image/png');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['content-security-policy'], "default-src 'none'");
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(res.raw, png);
  assert.deepEqual(calls, [`claude:${sessionId}`, [`claude:${sessionId}`, `${uuid(1)}:0`]]);
  assert.equal((await request(path, { method: 'POST', headers: { cookie, origin } })).statusCode, 403);
});
