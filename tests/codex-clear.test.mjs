import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CodexAdapter } from '../server/codex.mjs';
import { RequestStore } from '../server/requests.mjs';
import { mockCodexServer } from './fixtures/codex-proxy.mjs';

const submission = (text = '/clear', mode = 'send') => ({ text, mode, clientMessageId: randomUUID() });
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('Timed out waiting for Codex');
}
async function connected(t, status = 'idle', options = {}) {
  const store = new RequestStore(), server = mockCodexServer({ status, question: false });
  const adapter = new CodexAdapter(store, { createSocket: server.connect, log: () => {}, ...options });
  t.after(() => { adapter.stop(); server.close(); }); adapter.start();
  await until(() => adapter.list()[0]?.queueAvailable && !adapter.refreshing);
  return { adapter, server, store };
}

test('/clear starts one fresh Codex chat, preserves settings and leaves the original history intact', async t => {
  const { adapter, server } = await connected(t);
  const before = adapter.sessions.get('live-thread').messages;
  server.settings.activePermissionProfile = { id: 'project-safe' };
  server.settings.runtimeWorkspaceRoots = ['/work/project', '/work/shared'];
  server.settings.serviceTier = 'priority';
  adapter.sessions.get('live-thread').nextEffort = 'high';
  const body = submission(' /clear\n');
  const [first, duplicate] = await Promise.all([adapter.sendMessage('live-thread', body), adapter.sendMessage('live-thread', body)]);
  assert.deepEqual(first, duplicate);
  assert.equal(first.status, 'cleared'); assert.equal(first.sessionId, 'codex:new-thread-1');
  assert.equal(first.session.messages.length, 0); assert.equal(first.session.messagesState, 'empty');
  assert.equal(first.session.messaging.send, true);
  assert.deepEqual(server.messages.find(m => m.method === 'thread/start').params, {
    cwd: '/work/project', model: 'test-model', modelProvider: 'openai', approvalPolicy: 'on-request', approvalsReviewer: 'user',
    permissions: 'project-safe', config: { model_reasoning_effort: 'high' }, runtimeWorkspaceRoots: ['/work/project', '/work/shared'],
    serviceTier: 'priority', ephemeral: false, historyMode: 'paginated', sessionStartSource: 'clear',
  });
  assert.deepEqual(adapter.sessions.get('live-thread').messages, before);
  assert.equal(server.startedThreads.length, 1);
  assert.ok(!server.messages.some(m => ['turn/start', 'turn/steer', 'thread/revert', 'thread/archive', 'thread/delete'].includes(m.method)));
  await adapter.sendMessage('live-thread', body);
  assert.equal(server.startedThreads.length, 1);
  await assert.rejects(adapter.sendMessage('live-thread', { ...body, text: '/clear extra' }), /by itself/);
  await adapter.sendMessage('new-thread-1', submission('Start the new task'));
  assert.equal(server.messages.find(m => m.method === 'turn/start').params.threadId, 'new-thread-1');
  assert.equal(server.turns[0].input[0].text, 'Start the new task');
});

test('/clear carries legacy workspace restrictions forward without widening them', async t => {
  const { adapter, server } = await connected(t);
  server.settings.sandbox = { type: 'workspaceWrite', writableRoots: ['/work/extra'], networkAccess: false, excludeSlashTmp: true, excludeTmpdirEnvVar: true };
  await adapter.sendMessage('live-thread', submission());
  const params = server.messages.find(m => m.method === 'thread/start').params;
  assert.equal(params.sandbox, 'workspace-write');
  assert.deepEqual(params.config.sandbox_workspace_write, { writable_roots: ['/work/extra'], network_access: false, exclude_slash_tmp: true, exclude_tmpdir_env_var: true });
});

test('/clear refuses busy sessions, pending queues, arguments and subagents without sending prompt text', async t => {
  const { adapter, server } = await connected(t, 'active');
  await assert.rejects(adapter.sendMessage('live-thread', submission()), /Stop the current work/);
  server.finishTurn(); await adapter.refresh();
  await assert.rejects(adapter.sendMessage('live-thread', submission('/clear', 'queue')), /cannot be queued/);
  await assert.rejects(adapter.sendMessage('live-thread', submission('/clear then do this')), /by itself/);
  server.queue.push({ id: 'pending', input: [{ type: 'text', text: 'Keep my queued task' }] });
  await assert.rejects(adapter.sendMessage('live-thread', submission()), /queued messages/);
  assert.equal(server.queue.length, 1); server.queue.length = 0;
  server.thread.parentThreadId = 'parent';
  await assert.rejects(adapter.sendMessage('live-thread', submission()), /parent session/);
  assert.equal(server.startedThreads.length, 0);
  assert.equal(server.turns.length, 0); assert.equal(server.steers.length, 0);
});

test('/clear rejects unsupported permission settings before creating a chat', async t => {
  const { adapter, server } = await connected(t);
  server.settings.sandbox = { type: 'externalSandbox' };
  await assert.rejects(adapter.sendMessage('live-thread', submission()), /permissions cannot be carried over/);
  assert.equal(server.startedThreads.length, 0);
});

test('a lost /clear acknowledgement never creates another chat on retry', async t => {
  const { adapter, server } = await connected(t, 'idle', { retryDelayMs: 20, rpcTimeoutMs: 200 });
  server.beforeThreadStartReply = () => { server.beforeThreadStartReply = null; server.disconnect(); };
  const body = submission();
  await assert.rejects(adapter.sendMessage('live-thread', body), { status: 504 });
  await until(() => adapter.connected && adapter.joined.has('live-thread'));
  await assert.rejects(adapter.sendMessage('live-thread', body), { status: 504 });
  assert.equal(server.startedThreads.length, 1);
});

test('an explicit /clear rejection can be retried without losing the original chat', async t => {
  const { adapter, server } = await connected(t);
  server.startError = { code: -32601, message: 'Unsupported' };
  const body = submission();
  await assert.rejects(adapter.sendMessage('live-thread', body), /Unsupported/);
  assert.equal(server.startedThreads.length, 0);
  server.startError = null;
  assert.equal((await adapter.sendMessage('live-thread', body)).status, 'cleared');
  assert.equal(server.startedThreads.length, 1);
});
