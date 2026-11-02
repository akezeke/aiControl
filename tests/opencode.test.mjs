import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenCodeAdapter, OpenCodeClient, openCodeConfig } from '../server/opencode.mjs';
import { openCodeMessages, openCodeSession, usageRecords, usagePeriods } from '../server/opencode-data.mjs';
import { RequestStore, mergeSessions } from '../server/requests.mjs';
import { costPeriodView } from '../client/usage-presentation.js';
import { messagingUnavailableReason } from '../client/messaging-status.js';
import { hireChoices } from '../client/hire.js';

const now = new Date(2026, 10, 5, 12).getTime();
const tokens = { input: 100, output: 20, reasoning: 5, cache: { read: 40, write: 10 } };
const session = (id = 'ses_first', directory = '/work/first') => ({ id, directory, projectID: directory, title: 'Build a feature', version: '1.19.5', time: { created: now - 10000, updated: now } });
const assistant = (id = 'msg_reply', at = now, cost = .25) => ({ info: { id, sessionID: 'ses_first', role: 'assistant', time: { created: at }, cost, tokens, modelID: 'test-model', providerID: 'anthropic' }, parts: [
  { id: `${id}_text`, type: 'text', text: 'Done.' }, { id: `${id}_step`, type: 'step-finish', cost, tokens },
] });

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
function fixture(t) {
  const store = new RequestStore(), calls = [], state = { sessions: [session()], messages: [assistant()], status: {}, permissions: [], questions: [], offline: false, now };
  const fetcher = async (url, options) => {
    const path = url.pathname, body = options.body && JSON.parse(options.body);
    calls.push({ path, query: url.searchParams, options, body });
    assert.equal(url.origin, 'http://127.0.0.1:4096'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Basic ${Buffer.from('opencode:test-secret').toString('base64')}`);
    if (state.offline) throw new Error('test-secret must not be exposed');
    const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    if (path === '/api/info') return new Response('', { status: 404 });
    if (path === '/global/health') return json({ healthy: true, version: '1.19.5' });
    if (path === '/experimental/session') return json(state.sessions);
    if (path === '/session/status') return json(state.status);
    if (path === '/permission') return json(state.permissions);
    if (path === '/question') return json(state.questions);
    if (path.endsWith('/reply')) { state.permissions = []; state.questions = []; return json(true); }
    if (path.endsWith('/message')) { if (state.historyError) return new Response('', { status: 500 }); return json(state.messages); }
    if (path.endsWith('/prompt_async')) { if (state.sendError) throw new Error('ambiguous'); return new Response(null, { status: 204 }); }
    if (path.endsWith('/abort')) { state.status = {}; return json(true); }
    if (path === '/session' && options.method === 'POST') { const created = session('ses_created', url.searchParams.get('directory')); state.sessions.push(created); return json(created); }
    if (path.startsWith('/session/')) return json(session(path.split('/')[2]));
    throw new Error(`Unexpected endpoint: ${path}`);
  };
  const adapter = new OpenCodeAdapter(store, { url: 'http://127.0.0.1:4096', password: 'test-secret' }, { fetch: fetcher, now: () => state.now });
  t.after(() => adapter.stop());
  return { adapter, store, calls, state };
}

test('OpenCode configuration is local and never accepts embedded credentials or paths', () => {
  assert.equal(openCodeConfig(undefined), null);
  assert.deepEqual(openCodeConfig({ url: 'http://localhost:4096/' }), { url: 'http://localhost:4096', username: 'opencode', password: '' });
  for (const url of ['https://example.com', 'file:///etc/passwd', 'http://user:secret@localhost:4096', 'http://127.0.0.1:4096/api', 'http://localhost:4096/?key=secret']) assert.throws(() => openCodeConfig({ url }));
  assert.throws(() => openCodeConfig({ url: 'http://localhost:4096', username: 'user:secret' }));
});

test('OpenCode normalizes text, tools, errors, subagents and tokens without counting step costs twice', () => {
  const rows = [{ info: { id: 'msg_user', role: 'user', time: { created: now - 1 } }, parts: [{ id: 'prt_user', type: 'text', text: 'Build it' }] }, assistant()];
  rows[1].parts.push({ id: 'prt_tool', type: 'tool', tool: 'bash', state: { status: 'error', input: { command: 'npm test' } } }, { id: 'prt_reason', type: 'reasoning', text: 'hidden' });
  const normalized = openCodeSession({ ...session(), parentID: 'ses_parent' }, rows);
  assert.equal(normalized.parentId, 'opencode:ses_parent'); assert.equal(normalized.model, 'anthropic/test-model');
  assert.deepEqual(normalized.context, { used: 170 });
  assert.deepEqual(normalized.messages.map(m => m.text), ['Build it', 'Done.', 'bash · npm test']);
  assert.equal(normalized.messages.at(-1).failed, true);
  assert.equal(usagePeriods(usageRecords([...rows, rows[1]]), now)[0].usd, .25);
  assert.equal(openCodeMessages([{ info: { ...assistant().info, error: { name: 'ProviderAuthError' } }, parts: [] }])[0].error, true);
});

test('daily and monthly costs use message time, survive midnight and mark unknown costs', () => {
  const yesterday = new Date(2026, 10, 4, 20).getTime(), lastMonth = new Date(2026, 9, 31, 23).getTime();
  const records = usageRecords([assistant('msg_today', now, .2), assistant('msg_yesterday', yesterday, .3), assistant('msg_old', lastMonth, 10)]);
  assert.deepEqual(usagePeriods(records, now).map(p => p.usd), [.2, .5]);
  assert.deepEqual(usagePeriods(records, new Date(2026, 10, 6, 1).getTime()).map(p => p.usd), [0, .5]);
  const missing = assistant(); delete missing.info.cost;
  assert.equal(usagePeriods(usageRecords([missing]), now)[0].incomplete, true);
  assert.equal(costPeriodView({ usd: 0 }).cost, '≈$0.00');
  assert.equal(costPeriodView({ usd: .0023 }).cost, '≈$0.0023');
  assert.equal(costPeriodView({ usd: null }).cost, '—');
});

test('discovery scopes API reads to every project and includes archived sessions in spending only', async t => {
  const { adapter, calls, state } = fixture(t);
  state.sessions.push({ ...session('ses_second', '/work/second'), parentID: 'ses_first' }, { ...session('ses_archived'), time: { updated: now, archived: now } });
  state.status = { ses_second: { type: 'busy' } };
  await adapter.refresh();
  assert.equal(adapter.connected, true); assert.equal(adapter.list().length, 2);
  assert.equal(adapter.sessions.get('ses_second').status, 'working');
  assert.deepEqual(calls.filter(call => call.path === '/permission').map(call => call.query.get('directory')).sort(), ['/work/first', '/work/second']);
  const usage = adapter.usageSnapshot(); assert.equal(usage.periods[0].usd, .75); assert.equal(usage.status, 'ready');
  assert.doesNotMatch(JSON.stringify([adapter.list(), usage]), /test-secret|Authorization/);
  const count = calls.filter(call => call.path.endsWith('/message')).length;
  await adapter.refresh();
  assert.equal(calls.filter(call => call.path.endsWith('/message')).length, count + 1); // Only the working session.
});

test('permission replies are single-use, scoped and checked against current OpenCode requests', async t => {
  const { adapter, store, state, calls } = fixture(t);
  state.permissions = [{ id: 'per_ask', sessionID: 'ses_first', permission: 'bash', patterns: ['npm test'], metadata: { command: 'npm test' } }];
  await adapter.refresh();
  assert.equal(mergeSessions(adapter.list(), store.list())[0].status, 'permission');
  const id = store.list()[0].id;
  await store.respond(id, { decision: 'decline', message: 'Wait' });
  assert.deepEqual(calls.find(call => call.path === '/permission/per_ask/reply').body, { reply: 'reject', message: 'Wait' });
  await assert.rejects(store.respond(id, { decision: 'accept' }), /already answered/);
  state.permissions = [{ id: 'per_stale', sessionID: 'ses_first', permission: 'edit', patterns: ['file'], metadata: {} }];
  await adapter.refresh(); const stale = store.list()[0].id; state.permissions = [];
  await assert.rejects(store.respond(stale, { decision: 'accept' }), /already answered/);
  assert.equal(calls.filter(call => call.path.endsWith('/reply')).length, 1);
});

test('questions preserve ordered multi-select and custom-answer semantics', async t => {
  const { adapter, store, state, calls } = fixture(t);
  state.questions = [{ id: 'que_ask', sessionID: 'ses_first', questions: [
    { question: 'Pick', options: [{ label: 'A' }, { label: 'B' }], multiple: true, custom: false },
    { question: 'Name', options: [], custom: true },
  ] }];
  await adapter.refresh(); const request = store.list()[0];
  await assert.rejects(store.respond(request.id, { answers: { 0: ['C'], 1: ['Test'] } }), /offered/);
  await store.respond(request.id, { answers: { 0: ['A', 'B'], 1: ['Test'] } });
  assert.deepEqual(calls.find(call => call.path === '/question/que_ask/reply').body, { answers: [['A', 'B'], ['Test']] });
});

test('message submissions deduplicate success and ambiguous failures, and stop uses OpenCode abort', async t => {
  const { adapter, calls, state } = fixture(t); await adapter.refresh();
  const body = { text: 'Implement it', clientMessageId: 'unique', mode: 'send' };
  const result = await Promise.all([adapter.sendMessage('ses_first', body), adapter.sendMessage('ses_first', body)]);
  assert.equal(result[0].status, 'sent'); assert.equal(calls.filter(call => call.path.endsWith('/prompt_async')).length, 1);
  assert.deepEqual(calls.find(call => call.path.endsWith('/prompt_async')).body, { parts: [{ type: 'text', text: 'Implement it' }] });
  await assert.rejects(adapter.sendMessage('ses_first', { ...body, text: 'Different' }), /already used/);
  assert.equal(adapter.list()[0].messaging.images, true);
  const shot = { name: 'shot.png', data: png.toString('base64') };
  await adapter.sendMessage('ses_first', { ...body, clientMessageId: 'with-image', text: '', images: [shot] });
  assert.deepEqual(calls.findLast(call => call.path.endsWith('/prompt_async')).body, { parts: [{ type: 'file', mime: 'image/png', url: `data:image/png;base64,${shot.data}`, filename: 'shot.png' }] });
  await assert.rejects(adapter.sendMessage('ses_first', { ...body, clientMessageId: 'with-image', text: '', images: [{ data: Buffer.concat([png, Buffer.from([0])]).toString('base64'), name: 'shot.png' }] }), /already used/);
  state.sendError = true;
  for (let i = 0; i < 2; i++) await assert.rejects(adapter.sendMessage('ses_first', { ...body, clientMessageId: 'ambiguous' }), /did not confirm/);
  assert.equal(calls.filter(call => call.path.endsWith('/prompt_async')).length, 3);
  for (const text of ['/clear', '', 12]) await assert.rejects(adapter.sendMessage('ses_first', { ...body, text }));
  await adapter.interrupt('ses_first'); assert.ok(calls.some(call => call.path === '/session/ses_first/abort'));
  const created = await adapter.spawn('/work/new'); assert.equal(created.sessionId, 'opencode:ses_created');
  assert.ok(adapter.list().some(s => s.cwd === '/work/new'));
});

test('failed usage reads are partial and disconnects keep stale usage while disabling controls', async t => {
  const { adapter, store, state } = fixture(t);
  state.historyError = true; await adapter.refresh();
  assert.equal(adapter.usageSnapshot().status, 'partial'); assert.equal(adapter.list()[0].messagesState, 'unavailable');
  state.historyError = false; await adapter.refresh(); assert.equal(adapter.usageSnapshot().status, 'ready');
  state.permissions = [{ id: 'per_ask', sessionID: 'ses_first', permission: 'bash', metadata: {} }];
  await adapter.refresh(); assert.equal(store.list().length, 1);
  state.offline = true; await adapter.refresh();
  assert.equal(adapter.connected, false); assert.equal(adapter.list()[0].status, 'offline'); assert.equal(store.list().length, 0);
  assert.equal(adapter.usageSnapshot().status, 'stale'); assert.equal(adapter.usageSnapshot().periods[0].usd, .25);
  assert.doesNotMatch(adapter.detail, /test-secret/);
  await assert.rejects(adapter.sendMessage('ses_first', { text: 'Try', clientMessageId: 'new' }), /disconnected/);
  state.offline = false; await adapter.refresh(); assert.equal(adapter.list()[0].messaging.send, true);
});

test('deleted sessions and externally answered requests disappear on reconciliation', async t => {
  const { adapter, store, state } = fixture(t);
  state.permissions = [{ id: 'per_ask', sessionID: 'ses_first', permission: 'bash', metadata: {} }];
  await adapter.refresh(); state.permissions = []; await adapter.refresh(); assert.equal(store.list().length, 0);
  state.sessions = []; await adapter.refresh(); assert.equal(adapter.list().length, 0); assert.equal(adapter.usageSnapshot().periods[0].usd, 0);
});

test('OpenCode client sanitizes authentication errors and stops at redirects', async () => {
  const client = new OpenCodeClient({ url: 'http://localhost:4096', password: 'secret' }, { fetch: async (_url, options) => {
    assert.equal(options.redirect, 'error'); return new Response('secret provider detail', { status: 401 });
  } });
  await assert.rejects(client.request('/session'), error => /refused access/.test(error.message) && !error.message.includes('secret'));
});

test('OpenCode has independent hire and messaging capabilities', () => {
  assert.equal(hireChoices({ features: { opencode: true } }, '/work').at(-1).provider, 'opencode');
  assert.equal(hireChoices({}, '/work').some(c => c.provider === 'opencode'), false);
  assert.equal(messagingUnavailableReason({ provider: 'opencode', messaging: { send: true } }, {}), '');
  assert.match(messagingUnavailableReason({ provider: 'opencode' }, {}), /OpenCode is disconnected/);
});
