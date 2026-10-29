import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexAdapter } from '../server/codex.mjs';
import { messageLimit } from '../server/messages.mjs';
import { RequestStore } from '../server/requests.mjs';
import { mockCodexServer } from './fixtures/codex-proxy.mjs';
import { randomUUID } from 'node:crypto';

test('Codex uses a real WebSocket handshake, reads messages and delivers a confirmed answer', async t => {
  const store = new RequestStore();
  const server = mockCodexServer();
  const adapter = new CodexAdapter(store, { createSocket: server.connect });
  t.after(() => { adapter.stop(); server.close(); });
  adapter.start();
  for (let i = 0; i < 100 && (!adapter.list()[0]?.messages?.length || !store.list().length); i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(adapter.connected, true);
  assert.equal(adapter.list()[0].project, 'project');
  assert.equal(server.handshakes, 1);
  assert.deepEqual(server.messages.find(m => m.method === 'thread/resume').params, { threadId: 'live-thread', excludeTurns: true });
  assert.deepEqual(adapter.list()[0].messages.map(m => m.text), ['The earlier user message.', 'The latest reply.']);
  assert.equal(store.list()[0].questions[0].question, 'Continue?');
  await store.respond(store.list()[0].id, { answers: { choice: ['Yes'] } });
  assert.equal(store.list().length, 0);
  adapter.receive({ id: 98, method: 'item/commandExecution/requestApproval', params: { threadId: 'live-thread', command: 'npm test' } });
  const pending = store.list()[0].id;
  adapter.receive({ method: 'serverRequest/resolved', params: { threadId: 'live-thread', requestId: 98 } });
  await assert.rejects(store.respond(pending, { decision: 'accept' }), e => e.status === 409);
});

async function until(predicate, description) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(description);
}

async function connected(t, options, adapterOptions = {}) {
  const store = new RequestStore(), server = mockCodexServer({ question: false, ...options });
  const adapter = new CodexAdapter(store, { createSocket: server.connect, log: () => {}, ...adapterOptions });
  t.after(() => { adapter.stop(); server.close(); }); adapter.start();
  for (let i = 0; i < 100 && (!adapter.list()[0]?.queueAvailable || adapter.refreshing); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(adapter.list()[0]?.messaging?.queue, true);
  return { store, server, adapter };
}
const message = (text, mode = 'send') => ({ text, mode, clientMessageId: randomUUID() });

test('Codex reads account usage on connect, keeps sessions usable on failure and refreshes after reconnect', async t => {
  const { adapter, server } = await connected(t, {}, { retryDelayMs: 20, rpcTimeoutMs: 100 });
  await until(() => adapter.usage.snapshot().status === 'ready', 'Account usage did not load.');
  assert.deepEqual(adapter.usage.snapshot().windows.map(window => window.usedPercent), [25, 40]);
  const reads = () => server.messages.filter(message => message.method === 'account/rateLimits/read').length;
  assert.equal(reads(), 1); await adapter.refresh(); assert.equal(reads(), 1);
  server.usageError = { code: -32601, message: 'Unsupported' };
  await adapter.usage.refresh();
  assert.equal(adapter.usage.snapshot().status, 'stale'); assert.equal(adapter.connected, true);
  server.usageError = null; server.ignoreMethod = 'account/rateLimits/read';
  await adapter.usage.refresh(); assert.equal(adapter.connected, true);
  assert.equal(adapter.usage.snapshot().status, 'stale');
  server.ignoreMethod = null; server.disconnect();
  await until(() => server.handshakes === 2 && adapter.usage.snapshot().status === 'ready', 'Usage did not recover on reconnect.');
  server.rateLimits = { rateLimits: { primary: null, secondary: null } };
  adapter.receive({ method: 'account/updated', params: { authMode: 'apikey' } });
  assert.deepEqual(adapter.usage.snapshot().windows, []);
  await adapter.usage.pending.promise;
  assert.equal(adapter.usage.snapshot().status, 'ready'); assert.deepEqual(adapter.usage.snapshot().windows, []);
});

test('large Codex tool results do not disconnect the dashboard or leak into its messages', async t => {
  const { adapter, server } = await connected(t, { items: [
    { item: { type: 'agentMessage', id: 'reply', text: 'Image processed.' } },
    { item: { type: 'mcpToolCall', id: 'image-tool', result: { content: [{ type: 'image', data: 'a'.repeat(33 * 1024 * 1024) }] } } },
    { item: { type: 'userMessage', id: 'prompt', content: [{ type: 'text', text: 'Check the image.' }] } },
  ] });
  await adapter.refresh();
  assert.equal(adapter.connected, true);
  assert.equal(server.handshakes, 1);
  assert.deepEqual(adapter.list()[0].messages.map(m => m.text), ['Check the image.', 'MCP tool', 'Image processed.']);
  assert.ok(JSON.stringify(adapter.list()).length < 2000);
});

test('smaller history pages still find the most recent messages across tool results', async t => {
  const items = Array.from({ length: 100 }, (_, index) => ({ item: index % 4 === 0
    ? { type: 'agentMessage', id: `reply-${index}`, text: `Reply ${index}` }
    : { type: 'commandExecution', id: `tool-${index}`, aggregatedOutput: 'Tool output' } }));
  const { adapter, server } = await connected(t, { items });
  assert.deepEqual(adapter.list()[0].messages.filter(m => !m.tool).map(m => m.text), Array.from({ length: messageLimit }, (_, i) => `Reply ${4 * (messageLimit - 1 - i)}`));
  const pages = server.messages.filter(m => m.method === 'thread/items/list');
  assert.equal(pages.length, Math.ceil((4 * (messageLimit - 1) + 1) / 10));
  assert.ok(pages.every(m => m.params.limit === 10));
});

test('a dropped connection rejoins loaded sessions and restores pending questions', async t => {
  const { adapter, server, store } = await connected(t, { question: true }, { retryDelayMs: 20 });
  const oldQuestion = store.list()[0].id;
  const oldSocket = adapter.socket;
  server.disconnect();
  await until(() => !adapter.connected, 'The dropped connection was not detected.');
  assert.equal(adapter.list()[0].messaging.send, false);
  assert.equal(adapter.list()[0].status, 'offline');
  assert.equal(store.list().length, 0);
  await assert.rejects(store.respond(oldQuestion, { answers: { choice: ['Yes'] } }), error => error.status === 409);
  await until(() => server.handshakes === 2 && adapter.list()[0]?.messaging.queue && !adapter.refreshing, 'Codex did not reconnect.');
  assert.equal(adapter.list()[0].status, 'working');
  assert.equal(store.list().length, 1);
  oldSocket.emit('message', Buffer.from(JSON.stringify({ method: 'thread/status/changed', params: { threadId: 'live-thread', status: { type: 'systemError' } } })));
  oldSocket.emit('close');
  assert.equal(adapter.connected, true);
  assert.equal(adapter.list()[0].status, 'working', 'late events from the old socket must be ignored');
  await store.respond(store.list()[0].id, { answers: { choice: ['Yes'] } });
  assert.equal(store.list().length, 0);
});

test('an open socket that stops answering is replaced and sessions become usable again', async t => {
  const { adapter, server } = await connected(t, {}, { retryDelayMs: 20, rpcTimeoutMs: 60 });
  server.ignoreMethod = 'thread/loaded/list';
  await assert.rejects(adapter.refresh(), /did not respond/);
  assert.equal(adapter.connected, false);
  server.ignoreMethod = null;
  await until(() => server.handshakes === 2 && adapter.list()[0]?.messaging.queue && !adapter.refreshing, 'The unresponsive socket was not replaced.');
  assert.equal(adapter.connected, true);
  assert.match(adapter.detail, /^Connected/);
});

test('stopping during a reconnect delay prevents further connection attempts', async t => {
  const { adapter, server } = await connected(t, {}, { retryDelayMs: 40 });
  server.disconnect();
  await until(() => !adapter.connected, 'The dropped connection was not detected.');
  adapter.stop();
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(server.handshakes, 1);
  assert.equal(adapter.connected, false);
});

test('a failed socket creation retries and repeated start calls do not open duplicate connections', async t => {
  const store = new RequestStore(), server = mockCodexServer({ question: false });
  let attempts = 0;
  const adapter = new CodexAdapter(store, { retryDelayMs: 20, log: () => {}, createSocket: path => {
    if (++attempts === 1) throw new Error('Socket temporarily unavailable');
    return server.connect(path);
  } });
  t.after(() => { adapter.stop(); server.close(); });
  adapter.start(); adapter.start();
  await until(() => adapter.list()[0]?.messaging.queue && !adapter.refreshing, 'Codex did not retry the failed connection.');
  assert.equal(attempts, 2);
  assert.equal(server.handshakes, 1);
});

test('a lost message acknowledgment is not replayed after reconnecting', async t => {
  const { adapter, server } = await connected(t, { status: 'active' }, { retryDelayMs: 20 });
  server.beforeSteer = () => { server.beforeSteer = null; server.disconnect(); };
  const body = message('Deliver this once.');
  await assert.rejects(adapter.sendMessage('live-thread', body), error => error.status === 504);
  await until(() => server.handshakes === 2 && adapter.list()[0]?.messaging.queue && !adapter.refreshing, 'Codex did not reconnect.');
  await assert.rejects(adapter.sendMessage('live-thread', body), error => error.status === 504);
  assert.equal(server.steers.length, 1);
  assert.equal(server.turns.length, 0);
});

test('sending to idle Codex preserves settings, deduplicates retries and refuses unknown targets', async t => {
  const { adapter, server } = await connected(t, { status: 'idle' });
  const body = message('Please run the tests.');
  const [first, duplicate] = await Promise.all([adapter.sendMessage('live-thread', body), adapter.sendMessage('live-thread', body)]);
  assert.deepEqual(first, duplicate); assert.equal(first.status, 'sent'); assert.equal(server.turns.length, 1);
  const sent = server.messages.find(entry => entry.method === 'turn/start');
  assert.deepEqual(sent.params, { threadId: 'live-thread', input: [{ type: 'text', text: body.text, text_elements: [] }], clientUserMessageId: `ai-control:${body.clientMessageId}` });
  await adapter.sendMessage('live-thread', body); assert.equal(server.turns.length, 1);
  await assert.rejects(adapter.sendMessage('live-thread', { ...body, text: 'Different task' }), error => error.status === 409);
  await assert.rejects(adapter.sendMessage('unloaded-thread', message('Hi')), error => error.status === 409);
  await assert.rejects(adapter.sendMessage('live-thread', message('   ')), /Enter a message/);
  await assert.rejects(adapter.sendMessage('live-thread', message('/clear')), /only works in Codex’s own terminal/);
  assert.equal(server.turns.length, 1);
  await assert.rejects(adapter.sendMessage('live-thread', message('x'.repeat(12_001))), /12,000/);
});

test('busy Codex queues in order, starts after idle, and supports removing queued messages', async t => {
  const { adapter, server } = await connected(t, { status: 'active' });
  const first = message('Do this next', 'queue');
  const result = await adapter.sendMessage('live-thread', first);
  await adapter.sendMessage('live-thread', first);
  const removed = await adapter.sendMessage('live-thread', message('Cancel this one', 'queue'));
  await adapter.sendMessage('live-thread', message('Then this', 'queue'));
  assert.equal(server.queue.length, 3); assert.equal(server.turns.length, 0);
  assert.equal(result.status, 'queued');
  await adapter.cancelQueuedMessage('live-thread', removed.id);
  assert.equal(server.queue.length, 2);
  server.finishTurn(); await adapter.refresh();
  assert.equal(server.turns.length, 1); assert.equal(server.turns[0].input[0].text, first.text);
  await adapter.refresh(); assert.equal(server.turns.length, 1);
  server.finishTurn(); await adapter.refresh();
  assert.equal(server.turns.length, 2); assert.equal(server.turns[1].input[0].text, 'Then this');
  await assert.rejects(adapter.cancelQueuedMessage('live-thread', result.id), error => error.status === 409);
});

test('Send joins the current Codex turn without queuing, preserves settings, and deduplicates clicks', async t => {
  const { adapter, server, store } = await connected(t, { status: 'active' });
  adapter.sessions.get('live-thread').queueAvailable = false;
  const pending = store.add({ sessionId: 'codex:live-thread', kind: 'permission' }, () => {}, 'approval');
  const body = message('Also check the small screen layout.');
  const [first, duplicate] = await Promise.all([adapter.sendMessage('live-thread', body), adapter.sendMessage('live-thread', body)]);
  assert.deepEqual(first, { status: 'steered', turnId: 'original' });
  assert.deepEqual(duplicate, first);
  assert.equal(server.turns.length, 0); assert.equal(server.queue.length, 0);
  assert.deepEqual(server.steers, [{ threadId: 'live-thread', expectedTurnId: 'original', input: [{ type: 'text', text: body.text, text_elements: [] }], clientUserMessageId: `ai-control:${body.clientMessageId}` }]);
  assert.equal(store.list()[0].id, pending, 'sending a message must not resolve an approval');
  assert.deepEqual(server.messages.find(entry => entry.method === 'thread/turns/list').params, { threadId: 'live-thread', limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' });
});

test('a turn finishing during Send starts the message once as a new turn', async t => {
  const { adapter, server } = await connected(t, { status: 'active' });
  server.beforeSteer = () => { server.beforeSteer = null; server.finishTurn(); };
  const body = message('Continue with this.');
  const result = await adapter.sendMessage('live-thread', body);
  assert.equal(result.status, 'sent'); assert.equal(server.turns.length, 1);
  assert.equal(server.turns[0].input[0].text, body.text); assert.equal(server.steers.length, 0);
  assert.equal(server.queue.length, 0);
});

test('CLI starting a turn during Send redirects the message into that active turn', async t => {
  const { adapter, server } = await connected(t, { status: 'idle' });
  server.beforeStart = () => { server.beforeStart = null; server.thread.status = { type: 'active', activeFlags: [] }; server.currentTurnId = 'cli-turn'; };
  const result = await adapter.sendMessage('live-thread', message('This should join CLI work.'));
  assert.deepEqual(result, { status: 'steered', turnId: 'cli-turn' });
  assert.equal(server.turns.length, 0); assert.equal(server.steers.length, 1);
});

test('steering rechecks a changed active turn instead of sending to a stale turn id', async t => {
  const { adapter, server } = await connected(t, { status: 'active' });
  server.beforeSteer = () => { server.beforeSteer = null; server.currentTurnId = 'replacement'; };
  const result = await adapter.sendMessage('live-thread', message('New guidance.'));
  assert.deepEqual(result, { status: 'steered', turnId: 'replacement' });
  assert.equal(server.turns.length, 0); assert.equal(server.steers.length, 1);
});

test('messages cannot bypass a session that refuses direct input', async t => {
  const { adapter, server } = await connected(t, { status: 'active' });
  server.thread.canAcceptDirectInput = false;
  await assert.rejects(adapter.sendMessage('live-thread', message('Hello')), /parent session/);
  assert.equal(server.steers.length, 0); assert.equal(server.turns.length, 0);
});

test('an unconfirmed steer is not retried or converted into another turn', async t => {
  const { adapter, server } = await connected(t, { status: 'active' });
  const rpc = adapter.rpc.bind(adapter); let steers = 0;
  adapter.rpc = async (method, params) => {
    if (method !== 'turn/steer') return rpc(method, params);
    steers++; throw Object.assign(new Error('Connection lost after sending'), { status: 503 });
  };
  const body = message('Only once.');
  await assert.rejects(adapter.sendMessage('live-thread', body), error => error.status === 504);
  await assert.rejects(adapter.sendMessage('live-thread', body), error => error.status === 504);
  assert.equal(steers, 1); assert.equal(server.turns.length, 0); assert.equal(server.queue.length, 0);
});

test('a non-steerable active turn stays an error instead of being silently queued or restarted', async t => {
  const { adapter, server } = await connected(t, { status: 'active' });
  const rpc = adapter.rpc.bind(adapter); let steers = 0;
  adapter.rpc = async (method, params) => {
    if (method !== 'turn/steer') return rpc(method, params);
    steers++; throw Object.assign(new Error('cannot steer a review turn'), { rpcCode: -32600, status: 502 });
  };
  await assert.rejects(adapter.sendMessage('live-thread', message('More work')), /cannot steer a review turn/);
  assert.equal(steers, 1); assert.equal(server.turns.length, 0); assert.equal(server.queue.length, 0);
});

test('pending permissions block queue execution and messages from other clients are not auto-started', async t => {
  const { adapter, server, store } = await connected(t, { status: 'idle' });
  const pending = store.add({ sessionId: 'codex:live-thread', kind: 'permission' }, () => {}, 'approval');
  await adapter.sendMessage('live-thread', message('After approval', 'queue'));
  await adapter.refresh(); assert.equal(server.turns.length, 0);
  store.entries.delete(pending); await adapter.refresh(); assert.equal(server.turns.length, 1);
  server.finishTurn();
  server.queue.push({ id: 'other-client', input: [{ type: 'text', text: 'Held elsewhere' }], clientUserMessageId: 'terminal-message' });
  await adapter.refresh(); assert.equal(server.turns.length, 1);
});

test('ambiguous delivery failures are retained and never automatically resubmitted', async () => {
  const adapter = new CodexAdapter(new RequestStore());
  adapter.connected = true; adapter.joined.add('thread'); adapter.sessions.set('thread', { id: 'codex:thread', nativeId: 'thread', status: 'idle' });
  let sends = 0;
  adapter.rpc = async method => {
    if (method === 'thread/read') return { thread: { status: { type: 'idle' } } };
    sends++; throw Object.assign(new Error('Connection lost after sending'), { status: 503 });
  };
  const body = message('Do not duplicate');
  await assert.rejects(adapter.sendMessage('thread', body), error => error.status === 504);
  await assert.rejects(adapter.sendMessage('thread', body), error => error.status === 504);
  assert.equal(sends, 1);
});

test('a new Codex thread takes its first message before it can be joined, then joins', async t => {
  const store = new RequestStore(), server = mockCodexServer({ status: 'idle', question: false });
  server.noRollout = true;
  const adapter = new CodexAdapter(store, { createSocket: server.connect, log: () => {} });
  t.after(() => { adapter.stop(); server.close(); }); adapter.start();
  await until(() => adapter.list()[0]?.messaging.send, 'fresh thread never became sendable');
  assert.deepEqual([adapter.list()[0].control, adapter.list()[0].messaging.queue, adapter.list()[0].messagesState], [false, false, 'ready']);
  assert.equal((await adapter.sendMessage('live-thread', message('Start the game.'))).status, 'sent');
  await adapter.refresh();
  assert.equal(adapter.list()[0].control, true);
});

test('a thread compacting its context shows that until the compaction item completes', async t => {
  const { adapter } = await connected(t, {});
  const emit = (method, item) => adapter.socket.emit('message', Buffer.from(JSON.stringify({ method, params: { threadId: 'live-thread', turnId: 't', item } })));
  emit('item/started', { type: 'contextCompaction', id: 'squeeze' });
  assert.deepEqual([adapter.list()[0].activity, adapter.list()[0].detail], ['compacting', 'Compacting context']);
  emit('item/completed', { type: 'contextCompaction', id: 'squeeze' });
  assert.equal(adapter.list()[0].activity, '');
  assert.equal(adapter.list()[0].messages.at(-1).text, 'Context compacted');
});
