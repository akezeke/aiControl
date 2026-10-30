import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexImages } from '../server/codex-images.mjs';
import { imageLimit, maxImageBytes } from '../server/images.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const data = png.toString('base64'), url = `data:image/png;base64,${data}`;
const entry = (id, item, at = 1234) => ({ item: { id, ...item }, completedAtMs: at });
async function files(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-control-codex-images-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'screen.png'), png);
  return dir;
}

test('Codex view_image and local attachments are served by opaque session-scoped ids', async t => {
  const dir = await files(t), images = new CodexImages();
  images.remember('one', entry('call-1', { type: 'imageView', path: 'screen.png' }), dir);
  images.remember('one', entry('prompt', { type: 'userMessage', content: [{ type: 'text', text: 'Check this' }, { type: 'localImage', path: join(dir, 'screen.png') }] }, 1200), dir);
  const list = await images.list('one');
  assert.deepEqual(list.map(({ type, tool, at }) => ({ type, tool, at })), [{ type: 'image/png', tool: false, at: 1200 }, { type: 'image/png', tool: true, at: 1234 }]);
  assert.ok(list.every(image => /^[a-f0-9]{64}$/.test(image.id)));
  assert.ok(!JSON.stringify(list).includes(dir) && !JSON.stringify(list).includes(data));
  const id = list[1].id;
  assert.deepEqual(await images.get('one', id), { type: 'image/png', data: png });
  assert.equal(await images.get('two', id), null);
  assert.equal(await images.get('one', join(dir, 'screen.png')), null);
  assert.equal(await images.get('one', '../../screen.png'), null);
  images.remember('one', entry('call-1', { type: 'imageView', path: 'screen.png' }), dir);
  assert.deepEqual(await images.list('one'), list, 'Polling preserves IDs and does not duplicate images');
  await rm(join(dir, 'screen.png'));
  assert.deepEqual(await images.list('one'), []);
  assert.equal(await images.get('one', id), null);
});

test('Codex inline prompt, MCP, dynamic-tool and generated images share the viewer format', async () => {
  const images = new CodexImages();
  images.remember('one', entry('prompt', { type: 'userMessage', content: [{ type: 'image', url }] }, 1));
  images.remember('one', entry('mcp', { type: 'mcpToolCall', result: { content: [{ type: 'text', text: 'Screenshot' }, { type: 'image', data, mimeType: 'image/jpeg' }] } }, 2));
  images.remember('one', entry('dynamic', { type: 'dynamicToolCall', contentItems: [{ type: 'inputImage', imageUrl: url }] }, 3));
  images.remember('one', entry('generated', { type: 'imageGeneration', status: 'completed', result: data }, 4));
  const list = await images.list('one');
  assert.deepEqual(list.map(image => [image.at, image.tool, image.type]), [[1, false, 'image/png'], [2, true, 'image/png'], [3, true, 'image/png'], [4, true, 'image/png']]);
  for (const image of list) assert.deepEqual(await images.get('one', image.id), { type: 'image/png', data: png });
});

test('Codex ignores remote URLs, text paths, failed calls, non-images and oversized files or payloads', async t => {
  const dir = await files(t), images = new CodexImages();
  await writeFile(join(dir, 'not-image.png'), '<svg onload="alert(1)">');
  await writeFile(join(dir, 'large.png'), png); await truncate(join(dir, 'large.png'), maxImageBytes + 1);
  const items = [
    { type: 'userMessage', content: [{ type: 'image', url: 'https://example.com/image.png' }, { type: 'image', url: `file://${dir}/screen.png` }] },
    { type: 'dynamicToolCall', arguments: { path: join(dir, 'screen.png') }, contentItems: [{ type: 'inputText', text: join(dir, 'screen.png') }] },
    { type: 'dynamicToolCall', status: 'failed', contentItems: [{ type: 'inputImage', imageUrl: url }] },
    { type: 'dynamicToolCall', status: 'inProgress', contentItems: [{ type: 'inputImage', imageUrl: url }] },
    { type: 'mcpToolCall', result: { content: [{ type: 'image', data: 'a'.repeat(Math.ceil(maxImageBytes / 0.75) + 1) }] } },
    ...['not-image.png', 'large.png', 'missing.png', '.'].map(path => ({ type: 'imageView', path })),
  ];
  items.forEach((item, i) => images.remember('one', entry(`call-${i}`, item), dir));
  assert.deepEqual(await images.list('one'), []);
  assert.equal(images.retainedBytes, 0);
});

test('Codex retains the newest images with per-session and global inline memory limits', async t => {
  const dir = await files(t), images = new CodexImages({ maxInlineBytes: data.length * 4 });
  for (let i = imageLimit + 3; i >= 1; i--) images.remember('files', entry(`call-${i}`, { type: 'imageView', path: 'screen.png' }, i), dir);
  assert.deepEqual((await images.list('files')).map(image => image.at), Array.from({ length: imageLimit }, (_, i) => i + 4));
  const item = id => entry(id, { type: 'dynamicToolCall', contentItems: [{ type: 'inputImage', imageUrl: url }] }, Number(id));
  images.remember('a', item('1')); images.remember('b', item('2')); images.remember('c', item('3'));
  assert.deepEqual(await images.list('a'), []);
  assert.equal((await images.list('b')).length, 1); assert.equal((await images.list('c')).length, 1);
  assert.ok(images.retainedBytes <= images.maxInlineBytes);
  images.remember('c', item('3'));
  assert.equal(images.retainedBytes, data.length * 4, 'Repeated polling does not increase memory');
  images.delete('b'); assert.equal(images.retainedBytes, data.length * 2);
  images.clear(); assert.equal(images.retainedBytes, 0); assert.equal(images.threads.size, 0);
});
