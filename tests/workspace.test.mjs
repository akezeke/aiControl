import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../server/workspace.mjs';

async function fixture(t, options) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-workspace-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'private', 'workspace.json');
  return { file, store: await new WorkspaceStore(file, options).load() };
}

test('workspace preserves unrelated device patches, persists privately and returns detached snapshots', async t => {
  const { file, store } = await fixture(t);
  await Promise.all([
    store.patch({ section: 'sessions', key: 'codex:one', value: { alias: 'API', pinned: true } }),
    store.patch({ section: 'sessions', key: 'claude:two', value: { pinned: true } }),
    store.patch({ section: 'views', key: 'work', value: { name: 'Work', project: '/work', filter: 'attention' } }),
    store.patch({ section: 'preferences', key: 'quiet', value: { start: '22:00', end: '07:00' } }),
  ]);
  await store.patch({ section: 'sessions', key: 'codex:one', value: { reviewedThrough: 9000 } });
  const restarted = await new WorkspaceStore(file).load();
  assert.deepEqual(restarted.snapshot().sessions['codex:one'], { alias: 'API', pinned: true, reviewedThrough: 9000 });
  assert.equal(restarted.snapshot().sessions['claude:two'].pinned, true);
  assert.equal(restarted.snapshot().views.work.project, '/work');
  assert.equal(restarted.snapshot().version, 5);
  const detached = store.snapshot();
  detached.sessions['codex:one'].alias = 'changed outside';
  assert.equal(store.snapshot().sessions['codex:one'].alias, 'API');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(join(file, '..'))).mode & 0o777, 0o700);
});

test('draft revisions prevent competing devices and delayed saves from reviving a sent draft after restart', async t => {
  const { file, store } = await fixture(t);
  await store.patch({ section: 'drafts', key: 'codex:one', value: { text: 'ship it' }, baseRevision: 0 });
  const races = await Promise.allSettled([
    store.patch({ section: 'drafts', key: 'codex:one', value: null, baseRevision: 1 }),
    store.patch({ section: 'drafts', key: 'codex:one', value: { text: 'stale typing' }, baseRevision: 1 }),
  ]);
  assert.equal(races.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(races[1].reason.status, 409);
  const restarted = await new WorkspaceStore(file).load();
  assert.deepEqual(restarted.snapshot().drafts['codex:one'], { text: '', revision: 2 });
  await assert.rejects(restarted.patch({ section: 'drafts', key: 'codex:one', value: { text: 'ship it' }, baseRevision: 1 }), { status: 409 });
  await restarted.patch({ section: 'drafts', key: 'codex:two', value: { text: 'separate composer' }, baseRevision: 0 });
  assert.equal(restarted.snapshot().drafts['codex:two'].revision, 1);
  await assert.rejects(restarted.patch({ section: 'drafts', key: 'codex:one', value: { text: 'missing revision' } }), { status: 400 });
});

test('stale review patches cannot move a session backwards while unrelated fields still update', async t => {
  const { file, store } = await fixture(t);
  await store.patch({ section: 'sessions', key: 'codex:one', value: { reviewedThrough: 9000, pinned: true } });
  await store.patch({ section: 'sessions', key: 'codex:one', value: { reviewedThrough: 4000, alias: 'API' } });
  assert.deepEqual(store.snapshot().sessions['codex:one'], { reviewedThrough: 9000, pinned: true, alias: 'API' });
  const restarted = await new WorkspaceStore(file).load();
  await restarted.patch({ section: 'sessions', key: 'codex:one', value: { reviewedThrough: 0, pinned: false } });
  assert.deepEqual(restarted.snapshot().sessions['codex:one'], { reviewedThrough: 9000, pinned: false, alias: 'API' });
  await restarted.patch({ section: 'sessions', key: 'codex:one', value: { reviewedThrough: 12_000 } });
  assert.equal(restarted.snapshot().sessions['codex:one'].reviewedThrough, 12_000);
});

test('workspace rejects malformed and prototype-bearing patches without altering durable data', async t => {
  const { file, store } = await fixture(t);
  await store.patch({ section: 'snippets', key: 'review', value: { name: 'Review', text: 'Review changes' } });
  const before = await readFile(file, 'utf8');
  for (const change of [
    { section: '__proto__', key: 'polluted', value: true },
    { section: 'sessions', key: '__proto__', value: { alias: 'bad' } },
    { section: 'sessions', key: 'ok', value: { pinned: 'yes' } },
    { section: 'sessions', key: 'ok', value: { reviewedThrough: '9000' } },
    { section: 'sessions', key: 'ok', value: { unknown: true } },
    { section: 'snippets', key: 'huge', value: { text: 'x'.repeat(60_000) } },
    { section: 'presets', key: 'bad', value: { provider: 'shell' } },
    { section: 'preferences', key: 'bad', value: JSON.parse('{"nested":{"__proto__":{"polluted":true}}}') },
    { section: 'views', key: 'bad\u0000key', value: {} },
    { section: 'sessions', key: 'ok', value: { pinned: true }, extra: true },
  ]) await assert.rejects(store.patch(change), { status: 400 });
  assert.equal({}.polluted, undefined);
  assert.equal(await readFile(file, 'utf8'), before);
  await store.patch({ section: 'snippets', key: 'review', value: null });
  assert.deepEqual(store.snapshot().snippets, {});
});

test('workspace bounds storage without dropping existing records', async t => {
  const { file, store } = await fixture(t, { maxBytes: 400 });
  await store.patch({ section: 'sessions', key: 'one', value: { pinned: true } });
  const before = await readFile(file, 'utf8');
  await assert.rejects(store.patch({ section: 'snippets', key: 'large', value: { text: 'x'.repeat(500) } }), { status: 413 });
  assert.equal(await readFile(file, 'utf8'), before);
  assert.deepEqual(store.snapshot().snippets, {});
});
