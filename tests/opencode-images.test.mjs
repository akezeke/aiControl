import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { OpenCodeImages } from '../server/opencode-images.mjs';
import { messagesV2 } from '../server/opencode-api.mjs';
import { maxImageBytes } from '../server/images.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const uri = `data:image/png;base64,${png.toString('base64')}`;
const file = (uri, mime = 'image/png') => ({ type: 'file', uri, mime });
const read = (id, status, path, content) => ({ type: 'tool', id, name: 'read', state: { status, input: { path }, ...(content ? { content } : {}) } });

test('OpenCode previews the exact inline image returned by a successful read and images attached by the user', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'opencode-images-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'screen.png'); await writeFile(path, png);
  const images = new OpenCodeImages(), rows = messagesV2([
    { id: 'prompt', type: 'user', time: { created: 1 }, text: 'Look', files: [file(uri)] },
    { id: 'reply', type: 'assistant', time: { created: 2 }, content: [read('failed', 'error', path), read('success', 'completed', path, [file(uri)])] },
  ]);
  images.rememberRows('one', rows, dir); images.rememberRows('one', rows, dir);
  const list = await images.list('one'); assert.equal(list.length, 2); assert.deepEqual(list.map(image => image.tool), [false, true]);
  await rm(path); // Inline bytes still show what OpenCode actually saw.
  for (const image of list) assert.deepEqual(await images.get('one', image.id), { type: 'image/png', data: png });
  assert.deepEqual(await images.list('other'), []); assert.equal(await images.get('other', list[0].id), null);
});

test('OpenCode previews an image sent from the dashboard, which V2 stores as inline base64', async () => {
  const images = new OpenCodeImages(), rows = messagesV2([{ id: 'prompt', type: 'user', time: { created: 1 }, text: 'Look', files: [{ data: png.toString('base64'), mime: 'image/png', source: { type: 'inline' }, name: 'image.png' }] }]);
  images.rememberRows('one', rows, '/work');
  const [image] = await images.list('one'); assert.equal(image.tool, false);
  assert.deepEqual(await images.get('one', image.id), { type: 'image/png', data: png });
});

test('OpenCode uses safe local read fallbacks and ignores untrusted text, URLs, failures and non-images', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'opencode-images-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'screen.png'); await writeFile(path, png); await writeFile(join(dir, 'bad.png'), '<svg/>');
  await writeFile(join(dir, 'huge.png'), png); await truncate(join(dir, 'huge.png'), maxImageBytes + 1);
  const images = new OpenCodeImages(), rows = messagesV2([{ id: 'a', type: 'assistant', time: { created: 1 }, content: [
    read('relative', 'completed', 'screen.png'), read('failed', 'error', path), read('working', 'running', path),
    read('bad', 'completed', 'bad.png'), read('huge', 'completed', 'huge.png'),
    { type: 'tool', id: 'shell', name: 'shell', state: { status: 'completed', input: { command: path } } },
    { type: 'tool', id: 'web', name: 'web', state: { status: 'completed', content: [file('https://example.com/secret.png')] } },
    { type: 'tool', id: 'attachment', name: 'other', state: { status: 'completed', content: [file(pathToFileURL(path).href)] } },
  ] }]);
  images.rememberRows('one', rows, dir); const list = await images.list('one'); assert.equal(list.length, 2);
  for (const image of list) assert.deepEqual(await images.get('one', image.id), { type: 'image/png', data: png });
  assert.equal(await images.get('one', path), null); images.delete('one'); assert.deepEqual(await images.list('one'), []);
});
