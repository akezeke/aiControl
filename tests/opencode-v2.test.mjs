import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenCodeAdapter, openCodeConfig } from '../server/opencode.mjs';
import { RequestStore, mergeSessions } from '../server/requests.mjs';

const now = new Date(2026, 10, 5, 12).getTime();
const tokens = { input: 100, output: 20, reasoning: 5, cache: { read: 40, write: 10 } };
const info = (id = 'ses_first', directory = '/work/first') => ({ id, projectID: 'test', title: 'V2 session', location: { directory }, time: { created: now - 10000, updated: now }, cost: .25, tokens, model: { providerID: 'anthropic', id: 'test-model' } });
const assistant = (id, cost = .25) => ({ id, type: 'assistant', model: { providerID: 'anthropic', id: 'test-model' }, time: { created: now }, cost, tokens,
  content: [{ type: 'text', text: 'Done.' }, { id: 'call_1', type: 'tool', name: 'shell', state: { status: 'completed', input: { command: 'npm test' } } }] });

function fixture(t, options = {}) {
  const store = new RequestStore(), calls = [], state = { sessions: [info()], active: {}, permissions: [], forms: [], messages: [assistant('msg_reply'), { id: 'msg_user', type: 'user', time: { created: now - 1 }, text: 'Build it' }], now };
  const fetcher = async (url, options) => {
    const path = url.pathname, body = options.body && JSON.parse(options.body);
    calls.push({ path, query: url.searchParams, body, method: options.method, auth: options.headers.Authorization, origin: url.origin });
    assert.equal(options.redirect, 'error');
    if (state.offline) throw new Error('secret');
    const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    if (path === '/api/info') return json({ version: '2.2.5' });
    if (path === '/api/model') return json({ data: [{ providerID: 'anthropic', id: 'test-model', name: 'Test', enabled: true, variants: [{ id: 'high' }, { id: 'max' }] }, { providerID: 'other', id: 'disabled', enabled: false }] });
    if (path.endsWith('/model')) { const session = state.sessions.find(session => session.id === path.split('/')[3]); session.model = body.model; return json({ data: session }); }
    if (path === '/api/session' && options.method === 'GET') return json(state.sessionPages?.[url.searchParams.get('cursor') || 'first'] || { data: state.sessions, cursor: {} });
    if (path === '/api/session/active') return json({ data: state.active });
    if (path === '/api/permission/request') return json({ data: state.permissions });
    if (path === '/api/form') return json({ data: state.forms });
    if (path.endsWith('/reply')) { state.permissions = []; state.forms = []; return new Response(null, { status: 204 }); }
    if (path.endsWith('/message')) return json(state.pages?.[url.searchParams.get('cursor') || 'first'] || { data: state.messages, cursor: {} });
    if (path.endsWith('/prompt')) { if (state.sendError) throw new Error('ambiguous'); return json({ data: { id: 'msg_input' } }); }
    if (path.endsWith('/interrupt')) { state.active = {}; return json({ interrupted: true }); }
    if (path.endsWith('/terminal')) { if (state.terminalError) return new Response('', { status: 503 }); return json({ data: state.terminals || [] }); }
    if (path.endsWith('/inbox')) return json({ data: state.inbox || [] });
    if (/^\/api\/session\/ses/.test(path) && options.method === 'PATCH') { state.sessions.find(session => session.id === path.split('/')[3]).time.archived = now; return new Response(null, { status: 204 }); }
    if (path === '/api/session' && options.method === 'POST') { const created = info('ses_created', body.location.directory); state.sessions.push(created); return json({ data: created }); }
    if (/^\/api\/session\/ses/.test(path)) return json({ data: state.sessions.find(session => session.id === path.split('/')[3]) || info(path.split('/')[3]) });
    throw new Error(`Unexpected endpoint: ${path}`);
  };
  const adapter = new OpenCodeAdapter(store, options.serviceFile ? { service: true } : { url: 'http://127.0.0.1:4096' }, { fetch: fetcher, now: () => state.now, ...options });
  t.after(() => adapter.stop()); return { adapter, state, calls, store };
}

test('V2 discovers sessions, active status, projected messages, model and costs', async t => {
  const { adapter, state, calls } = fixture(t);
  state.active = { ses_first: { type: 'running' } };
  state.sessions.push({ ...info('ses_archived'), time: { updated: now, archived: now } });
  await adapter.refresh();
  assert.equal(adapter.connected, true); assert.equal(adapter.list().length, 1);
  const s = adapter.list()[0];
  assert.equal(s.cwd, '/work/first'); assert.equal(s.version, '2.2.5'); assert.equal(s.status, 'working');
  assert.equal(s.model, 'anthropic/test-model'); assert.equal(s.cost.usd, .25);
  assert.deepEqual(s.messages.map(m => m.text), ['Build it', 'Done.', 'shell · npm test']);
  assert.equal(new Set(s.messages.map(m => m.id)).size, 3);
  assert.equal(adapter.usageSnapshot().periods[0].usd, .5);
  assert.equal(calls.find(call => call.path === '/api/permission/request').query.get('location[directory]'), '/work/first');
  assert.equal(calls.filter(call => call.path === '/api/session/active').length, 1);
  assert.equal(calls.find(call => call.path === '/api/session').query.has('archived'), false);
});

test('V2 Fire archives the idle session tree, preserves history, and refuses running or queued work', async t => {
  const { adapter, state, calls } = fixture(t); state.now += 10000; state.sessions.push({ ...info('ses_child'), parentID: 'ses_first' });
  await adapter.refresh(); assert.equal(adapter.list().find(session => session.nativeId === 'ses_first').messaging.fire, true);
  state.active = { ses_child: { type: 'running' } }; await assert.rejects(adapter.fire('ses_first'), /working/);
  state.active = {}; state.inbox = [{}]; await assert.rejects(adapter.fire('ses_first'), /queued/);
  state.inbox = []; state.terminals = [{ status: 'running' }]; await assert.rejects(adapter.fire('ses_first'), /terminal/);
  state.terminals = []; state.terminalError = true; await assert.rejects(adapter.fire('ses_first'));
  state.terminalError = false; state.permissions = [{ id: 'perm', sessionID: 'ses_child' }]; await assert.rejects(adapter.fire('ses_first'), /answer/);
  state.permissions = []; assert.equal(calls.some(call => call.method === 'PATCH'), false);
  assert.deepEqual(await adapter.fire('ses_first'), { ok: true, archived: true });
  assert.deepEqual(calls.filter(call => call.method === 'PATCH').map(call => [call.path, call.body]), [['/api/session/ses_child', { archived: true }], ['/api/session/ses_first', { archived: true }]]);
  assert.equal(calls.some(call => call.method === 'DELETE'), false); assert.equal(adapter.list().length, 0); assert.equal(adapter.firing.size, 0);
  await adapter.refresh(); assert.equal(adapter.list().length, 0);
});

test('V2 offers connected models, applies variants and keeps defaults on creation', async t => {
  const { adapter, calls } = fixture(t); await adapter.refresh();
  const models = await adapter.modelOptions('ses_first'); assert.equal(models.length, 1);
  assert.deepEqual(models[0].efforts, ['high', 'max']);
  await assert.rejects(adapter.setModel('ses_first', 'other/disabled'), /Unknown model/);
  await assert.rejects(adapter.setEffort('ses_first', 'ultra'), /Unknown effort/);
  await adapter.setEffort('ses_first', 'max');
  assert.deepEqual(calls.find(call => call.path.endsWith('/model') && call.method === 'POST').body, { model: { providerID: 'anthropic', id: 'test-model', variant: 'max' } });
  await adapter.refresh(); assert.equal(adapter.list()[0].effort, 'max');
  await adapter.setEffort('ses_first', '');
  assert.equal(calls.filter(call => call.path.endsWith('/model') && call.method === 'POST').at(-1).body.model.variant, undefined);
  await adapter.spawn('/work/new', { model: models[0].id, effort: 'high' });
  assert.deepEqual(calls.find(call => call.path === '/api/session' && call.method === 'POST').body.model, { providerID: 'anthropic', id: 'test-model', variant: 'high' });
});

test('V2 follows session and message cursors for complete usage, keeping history chronological', async t => {
  const { adapter, state, calls } = fixture(t);
  state.sessionPages = { first: { data: [info()], cursor: { next: 'sessions_next' } }, sessions_next: { data: [info('ses_second')], cursor: { next: null } } };
  state.pages = { first: { data: [assistant('msg_new', .2)], cursor: { next: 'messages_next' } }, messages_next: { data: [assistant('msg_old', .3)], cursor: { next: null } } };
  await adapter.refresh(); assert.equal(adapter.connected, true); assert.equal(adapter.list().length, 2);
  assert.equal(adapter.usageSnapshot().periods[0].usd, 1);
  assert.deepEqual(adapter.list()[0].messages.map(m => m.id), ['msg_old:0', 'msg_old:call_1', 'msg_new:0', 'msg_new:call_1']);
  for (const call of calls.filter(call => call.query.has('cursor'))) assert.equal(call.query.has('order'), false);
  state.pages.messages_next.cursor.next = 'messages_next'; state.now += 61000; state.sessionPages.first.data[0].time.updated++;
  await adapter.refresh(); assert.equal(adapter.usageSnapshot().status, 'partial');
});

test('tool-heavy V2 history fetches older conversation and exposes earlier messages', async t => {
  const { adapter, state, calls } = fixture(t);
  const tool = id => ({ id, type: 'assistant', time: { created: now }, content: [{ id: `tool_${id}`, type: 'tool', name: 'shell', state: { status: 'completed', input: { command: 'test' } } }] });
  state.now += 40 * 86400000; // History polling without a full monthly usage refresh.
  state.pages = {
    first: { data: Array.from({ length: 100 }, (_, i) => tool(`new_${i}`)), cursor: { next: 'older' } },
    older: { data: [...Array.from({ length: 120 }, (_, i) => tool(`old_${i}`)), { id: 'prompt', type: 'user', time: { created: now - 1 }, text: 'Original request' }], cursor: {} },
  };
  await adapter.refresh();
  assert.equal(adapter.list()[0].historyMore, true);
  assert.equal(adapter.list()[0].messages.length, 200);
  const older = await adapter.history('ses_first', 60);
  assert.equal(older.messages[0].text, 'Original request');
  assert.equal(older.messages.filter(message => message.tool).length, 220);
  assert.equal(older.more, false);
  assert.ok(calls.filter(call => call.path.endsWith('/message') && call.query.get('cursor') === 'older').length >= 2);
});

test('V2 permissions are checked before replying once or rejecting, with the original scope', async t => {
  const { adapter, state, store, calls } = fixture(t);
  state.permissions = [{ id: 'perm_ask', sessionID: 'ses_first', action: 'shell', resources: ['npm test'], metadata: { command: 'npm test' } }];
  await adapter.refresh();
  assert.equal(mergeSessions(adapter.list(), store.list())[0].status, 'permission');
  assert.deepEqual(store.list()[0].actions.map(a => a.value), ['accept', 'decline']);
  await store.respond(store.list()[0].id, { decision: 'accept' });
  assert.deepEqual(calls.find(call => call.path.endsWith('/reply')).body, { decision: 'once' });
  assert.equal(calls.find(call => call.path.endsWith('/reply')).path, '/api/session/ses_first/permission/perm_ask/reply');
  state.permissions = [{ id: 'perm_stale', sessionID: 'ses_first', action: 'edit', resources: ['file'] }];
  await adapter.refresh(); const id = store.list()[0].id; state.permissions = [];
  await assert.rejects(store.respond(id, { decision: 'accept' }), /already answered/);
  assert.equal(calls.filter(call => call.path.endsWith('/reply')).length, 1);
});

test('V2 forms map labels to values and preserve scalar, boolean and multiselect answers', async t => {
  const { adapter, state, store, calls } = fixture(t);
  state.forms = [{ id: 'form_ask', sessionID: 'ses_first', title: 'Choose', fields: [
    { key: 'features', type: 'multiselect', options: [{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }] },
    { key: 'name', type: 'string' }, { key: 'enabled', type: 'boolean' }, { key: 'count', type: 'integer' },
  ] }];
  await adapter.refresh(); const id = store.list()[0].id;
  await assert.rejects(store.respond(id, { answers: { 0: ['Unknown'], 1: ['Test'], 2: ['Yes'], 3: ['2'] } }), /offered/);
  await assert.rejects(store.respond(id, { answers: { 0: ['Alpha'], 1: ['Test'], 2: ['Yes'], 3: ['oops'] } }), /integer/);
  await store.respond(id, { answers: { 0: ['Alpha', 'Beta'], 1: ['Test'], 2: ['Yes'], 3: ['2'] } });
  const reply = calls.find(call => call.path.endsWith('/reply'));
  assert.equal(reply.path, '/api/session/ses_first/form/form_ask/reply');
  assert.deepEqual(reply.body, { answer: { features: ['a', 'b'], name: 'Test', enabled: true, count: 2 } });
  state.forms = [{ id: 'form_external', sessionID: 'ses_first', title: 'External', fields: [{ type: 'external', key: 'auth' }] }];
  await adapter.refresh(); assert.match(store.list()[0].unsupported, /OpenCode/);
  await assert.rejects(store.respond(store.list()[0].id, { answers: {} }), /OpenCode/);
  assert.equal(calls.filter(call => call.path.endsWith('/reply')).length, 1);
});

test('V2 creates sessions in the chosen folder, deduplicates prompts and interrupts', async t => {
  const { adapter, state, calls } = fixture(t); await adapter.refresh();
  assert.deepEqual(await adapter.spawn('/work/new'), { sessionId: 'opencode:ses_created' });
  assert.equal(adapter.sessions.get('ses_created').cwd, '/work/new');
  const body = { text: 'Build it', clientMessageId: 'test:1' };
  await Promise.all([adapter.sendMessage('ses_created', body), adapter.sendMessage('ses_created', body)]);
  assert.deepEqual(calls.find(call => call.path.endsWith('/prompt')).body, { text: 'Build it' });
  assert.equal(calls.filter(call => call.path.endsWith('/prompt')).length, 1);
  state.sendError = true;
  await assert.rejects(adapter.sendMessage('ses_created', { ...body, clientMessageId: 'test:2' }));
  await assert.rejects(adapter.sendMessage('ses_created', { ...body, clientMessageId: 'test:2' }));
  assert.equal(calls.filter(call => call.path.endsWith('/prompt')).length, 2);
  await adapter.interrupt('ses_created'); assert.ok(calls.some(call => call.path === '/api/session/ses_created/interrupt'));
});

test('running turns show updating and settle their costs on the next poll, while missing final costs remain partial', async t => {
  const { adapter, state, calls } = fixture(t);
  state.active = { ses_first: { type: 'running' } };
  delete state.messages[0].cost;
  await adapter.refresh(); assert.equal(adapter.usageSnapshot().status, 'updating');
  assert.match(adapter.usageSnapshot().detail, /still running/);
  state.messages[0].cost = .4; state.messages[0].time.completed = now; state.now += 3000;
  await adapter.refresh(); assert.equal(adapter.usageSnapshot().status, 'ready'); assert.equal(adapter.usageSnapshot().periods[0].usd, .4);
  state.active = {}; await adapter.refresh();
  assert.equal(calls.filter(call => call.path.endsWith('/message') && !call.query.has('cursor')).at(-1).query.get('limit'), '200');
  delete state.messages[0].cost; state.sessions[0].time.updated++; state.now += 61000;
  await adapter.refresh(); assert.equal(adapter.usageSnapshot().status, 'partial'); assert.match(adapter.usageSnapshot().detail, /unavailable/);
});

test('V2 shell and compaction notices do not create phantom missing usage', async t => {
  const { adapter, state } = fixture(t);
  state.messages.unshift({ id: 'msg_compact', type: 'compaction', time: { created: now }, status: 'completed' }, { id: 'msg_shell', type: 'shell', time: { created: now }, command: 'pwd', status: 'exited', exit: 0 });
  await adapter.refresh(); assert.equal(adapter.usageSnapshot().status, 'ready'); assert.equal(adapter.usageSnapshot().periods[0].usd, .25);
});

test('service discovery follows port and credential changes and fails closed on remote URLs', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'aicontrol-opencode-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const serviceFile = join(dir, 'service.json');
  const { adapter, calls, state } = fixture(t, { serviceFile });
  await adapter.refresh(); assert.equal(adapter.connected, false);
  await writeFile(serviceFile, JSON.stringify({ url: 'http://127.0.0.1:4001', password: 'first-secret' }));
  await adapter.refresh(); assert.equal(adapter.connected, true);
  assert.equal(calls[0].auth, `Basic ${Buffer.from('opencode:first-secret').toString('base64')}`);
  state.offline = true; await adapter.refresh(); assert.equal(adapter.list()[0].messaging.send, false);
  state.offline = false;
  await writeFile(serviceFile, JSON.stringify({ url: 'http://127.0.0.1:4002', password: 'second-secret' }));
  await adapter.refresh(); assert.equal(adapter.connected, true);
  assert.equal(calls.at(-1).origin, 'http://127.0.0.1:4002');
  assert.equal(calls.at(-1).auth, `Basic ${Buffer.from('opencode:second-secret').toString('base64')}`);
  assert.doesNotMatch(JSON.stringify([adapter.list(), adapter.usageSnapshot(), adapter.config]), /first-secret|second-secret/);
  const count = calls.length;
  await writeFile(serviceFile, JSON.stringify({ url: 'https://example.com', password: 'second-secret' }));
  await adapter.refresh(); assert.equal(adapter.connected, false); assert.equal(calls.length, count);
  assert.deepEqual(openCodeConfig({ service: true }), { service: true });
});
