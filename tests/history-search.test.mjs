import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistorySearch, openCodeHistorySource } from '../server/history-search.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-history-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, file: join(dir, 'private', 'history.json'), codexRoot: join(dir, 'codex'), projectsDir: join(dir, 'claude', 'projects') };
}
async function jsonl(path, rows) {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}
const live = (id, messages, extra = {}) => ({ id, provider: id.split(':')[0], title: 'Build API', cwd: '/work/api', project: 'api', updatedAt: 10, messages, ...extra });

test('observed history survives restart, merges streamed messages and stores only text', async t => {
  const { file } = await fixture(t), history = await new HistorySearch({ file }).load();
  await history.observe([live('opencode:one', [{ id: 'u1', role: 'user', text: 'keep the login compatible', timestamp: 1, images: [{ data: 'PRIVATE_IMAGE_BYTES' }] }, { id: 'a1', role: 'assistant', text: 'working', timestamp: 2 }], { credentials: 'PRIVATE_KEY' })]);
  await history.observe([live('opencode:one', [{ id: 'a1', role: 'assistant', text: 'Login migration complete', timestamp: 2 }])]);
  const restored = await new HistorySearch({ file }).load();
  const found = await restored.search('LOGIN');
  assert.deepEqual(found.results.map(result => result.messageId), ['a1', 'u1']);
  assert.equal(found.results[0].session.title, 'Build API');
  assert.equal(found.results[0].archived, true);
  assert.equal(found.results[0].context.some(message => message.text.includes('compatible')), true);
  const session = await restored.session('opencode:one');
  assert.equal(session.control, false);
  assert.equal(session.readOnly, true);
  assert.equal(session.messages.length, 2);
  assert.equal(session.messages[1].text, 'Login migration complete');
  assert.doesNotMatch(await readFile(file, 'utf8'), /PRIVATE_IMAGE_BYTES|PRIVATE_KEY/);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(join(file, '..'))).mode & 0o777, 0o700);
});

test('search discovers archived Codex and configured Claude accounts with message context', async t => {
  const { file, codexRoot, projectsDir } = await fixture(t);
  await jsonl(join(codexRoot, 'archived_sessions', 'rollout-old.jsonl'), [
    { type: 'session_meta', payload: { id: 'old-codex', cwd: '/work/api', timestamp: '2026-01-01T00:00:00Z' } },
    { type: 'response_item', timestamp: '2026-01-01T00:00:01Z', payload: { type: 'message', id: 'c-user', role: 'user', content: [{ type: 'input_text', text: 'Plan the database move' }] } },
    { type: 'response_item', timestamp: '2026-01-01T00:00:02Z', payload: { type: 'message', id: 'c-reply', role: 'assistant', content: [{ type: 'output_text', text: 'Use a reversible migration for the database.' }] } },
    { type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'PRIVATE_REASONING' }] } },
  ]);
  await jsonl(join(projectsDir, '-work-ui', 'old-claude.jsonl'), [
    { type: 'user', uuid: 'cl-user', sessionId: 'old-claude', cwd: '/work/ui', timestamp: '2026-02-01T00:00:01Z', message: { content: 'Plan a database migration' } },
    { type: 'assistant', uuid: 'cl-reply', sessionId: 'old-claude', timestamp: '2026-02-01T00:00:02Z', message: { id: 'cl-msg', content: [{ type: 'text', text: 'Keep a rollback path.' }, { type: 'thinking', thinking: 'PRIVATE_REASONING' }] } },
    { type: 'custom-title', sessionId: 'old-claude', customTitle: 'Data upgrade' },
  ]);
  const history = await new HistorySearch({ file, codexRoots: [codexRoot], claudeAccounts: [{ projectsDir, label: 'work' }] }).load();
  const found = await history.search('migration');
  assert.deepEqual(found.results.map(result => result.sessionId).sort(), ['claude:old-claude', 'codex:old-codex']);
  const claude = found.results.find(result => result.sessionId === 'claude:old-claude');
  assert.equal(claude.session.account, 'work');
  assert.equal(claude.session.title, 'Data upgrade');
  assert.equal(claude.context[1].text, 'Keep a rollback path.');
  assert.equal((await history.search('PRIVATE_REASONING')).results.length, 0);
  assert.equal((await history.search('migration', { provider: 'codex', project: '/work/api' })).results.length, 1);
  assert.deepEqual((await history.session('codex:old-codex')).messages.map(message => message.id), ['c-user', 'c-reply']);
  assert.equal(await history.session('../../etc/passwd'), null);
});

test('Codex event-only histories remain searchable without duplicating paired response events', async t => {
  const { file, codexRoot } = await fixture(t);
  await jsonl(join(codexRoot, 'sessions', '2026', 'rollout-event.jsonl'), [
    { type: 'session_meta', payload: { id: 'events', cwd: '/work' } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'event-only request' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'event-only answer' } },
  ]);
  await jsonl(join(codexRoot, 'sessions', 'rollout-paired.jsonl'), [
    { type: 'session_meta', payload: { id: 'paired', cwd: '/work' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'paired reply' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'paired reply' }] } },
  ]);
  const history = await new HistorySearch({ file, codexRoots: [codexRoot] }).load();
  assert.equal((await history.search('event-only')).results.length, 2);
  assert.equal((await history.search('paired reply')).results.length, 1);
});

test('history discovery rejects symlink escapes and skips malformed JSON without hiding readable sessions', async t => {
  const { dir, file, codexRoot, projectsDir } = await fixture(t);
  const outside = join(dir, 'outside.jsonl');
  await jsonl(outside, [{ type: 'session_meta', payload: { id: 'outside' } }, { type: 'event_msg', payload: { type: 'agent_message', message: 'outside-secret' } }]);
  await mkdir(join(codexRoot, 'sessions'), { recursive: true });
  await symlink(outside, join(codexRoot, 'sessions', 'linked.jsonl'));
  await mkdir(projectsDir, { recursive: true });
  await symlink(dir, join(projectsDir, 'escape'));
  await writeFile(join(codexRoot, 'sessions', 'broken.jsonl'), '{not-json}\n');
  const history = await new HistorySearch({ file, codexRoots: [codexRoot], claudeAccounts: [{ projectsDir }] }).load();
  assert.equal((await history.search('outside-secret')).results.length, 0);
  await history.observe([live('codex:observed', [{ id: 'ok', role: 'user', text: 'readable request' }])]);
  assert.equal((await history.search('readable')).results.length, 1);
});

test('history reports bounded archive reads and result limits while preserving matching context', async t => {
  const { file, codexRoot } = await fixture(t);
  await jsonl(join(codexRoot, 'sessions', 'large.jsonl'), [
    { type: 'session_meta', payload: { id: 'large', cwd: '/work' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'x'.repeat(20_000) } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'tail needle' } },
  ]);
  const history = await new HistorySearch({ file, codexRoots: [codexRoot], maxFileBytes: 2048 }).load();
  const found = await history.search('needle');
  assert.equal(found.results[0]?.sessionId, 'codex:large');
  assert.equal(found.truncated, true);
  await history.observe([live('codex:many', Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, role: 'user', text: `needle ${i}`, timestamp: i })))]);
  const limited = await history.search('needle', { limit: 2 });
  assert.equal(limited.results.length, 2);
  assert.equal(limited.truncated, true);
  await assert.rejects(history.search('a'.repeat(1001)), { status: 400 });
});

test('injected history sources add absent providers and failures leave observed results available', async t => {
  const { file } = await fixture(t);
  const history = await new HistorySearch({ file, sources: [async () => [live('opencode:old', [{ id: 'old-message', role: 'assistant', text: 'searchable remote archive' }])], async () => { throw new Error('disconnected'); }] }).load();
  const result = await history.search('remote archive');
  assert.equal(result.results[0].sessionId, 'opencode:old');
  assert.equal(result.results[0].archived, true);
  assert.equal(result.partial, true);
});

test('OpenCode archive source normalizes known sessions, bounds reads and reports unavailable history', async t => {
  const { file } = await fixture(t);
  // The protocol boundary includes an unreadable session; the source must preserve the other archive.
  const api = {
    async sessions(limit) {
      assert.equal(limit, 2);
      return [
        { id: 'ses_old', title: 'API retirement', directory: '/work/api', time: { updated: 123, archived: 124 } },
        { id: 'ses_unavailable', directory: '/work/api', time: { updated: 100, archived: 101 } },
      ];
    },
    async history(id, directory, limit) {
      assert.equal(directory, '/work/api'); assert.equal(limit, 20);
      if (id === 'ses_unavailable') throw new Error('missing');
      assert.equal(id, 'ses_old');
      return { messages: [{ id: 'archive-reply', role: 'assistant', text: 'Retire the legacy endpoint', timestamp: 120 }], more: true };
    },
  };
  const source = openCodeHistorySource(api, { maxSessions: 2, messageLimit: 20 });
  const history = await new HistorySearch({ file, sources: [source] }).load();
  const found = await history.search('legacy endpoint');
  assert.equal(found.results[0]?.sessionId, 'opencode:ses_old');
  assert.equal(found.results[0]?.session.title, 'API retirement');
  assert.equal(found.results[0]?.session.cwd, '/work/api');
  assert.equal(found.truncated, true);
  assert.equal(found.partial, true);
  assert.equal((await history.session('opencode:ses_old')).historyMore, true);
});

test('an absent session uses its completed archive instead of replaying an older observed stream', async t => {
  const { file, codexRoot } = await fixture(t);
  await jsonl(join(codexRoot, 'archived_sessions', 'finished.jsonl'), [
    { type: 'session_meta', payload: { id: 'finished', cwd: '/work' } },
    { type: 'response_item', payload: { type: 'message', id: 'answer', role: 'assistant', content: [{ type: 'output_text', text: 'The migration is complete.' }] } },
  ]);
  const history = await new HistorySearch({ file, codexRoots: [codexRoot] }).load();
  await history.observe([live('codex:finished', [{ id: 'answer', role: 'assistant', text: 'The migration' }])]);
  await history.observe([]);
  assert.equal((await history.search('is complete')).results[0]?.messageId, 'answer');
  assert.equal((await history.session('codex:finished')).messages[0].text, 'The migration is complete.');
});

test('retention limits stay visible after restart and newest matches survive small result limits', async t => {
  const { file } = await fixture(t);
  const history = await new HistorySearch({ file, maxSessions: 1 }).load();
  await history.observe([live('codex:old', [{ id: 'old', role: 'user', text: 'needle old' }])]);
  await history.observe([live('codex:new', [{ id: 'new', role: 'user', text: 'needle new', timestamp: 20 }], { updatedAt: 20 })]);
  const restarted = await new HistorySearch({ file, maxSessions: 1 }).load();
  const found = await restarted.search('needle', { limit: 1 });
  assert.equal(found.results[0].messageId, 'new');
  assert.equal(found.truncated, true);
});
