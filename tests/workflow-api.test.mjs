import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Auth, savePassword } from '../server/auth.mjs';
import { RequestStore } from '../server/requests.mjs';
import { WorkspaceStore } from '../server/workspace.mjs';
import { HistorySearch } from '../server/history-search.mjs';
import { WorkflowService } from '../server/workflow.mjs';
import { launchPreset } from '../server/workflow-launch.mjs';
import { createHandler } from '../server/http.mjs';
import { CodexAdapter } from '../server/codex.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'aicontrol-workflow-api-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const workspace = await new WorkspaceStore(join(dir, 'workspace.json')).load();
  const history = await new HistorySearch({ file: join(dir, 'history.json') }).load();
  const sessions = [{ id: 'codex:live', provider: 'codex', cwd: dir, title: 'Current', updatedAt: 10, messages: [{ id: 'm', role: 'assistant', text: 'Searchable workflow message', timestamp: 10 }] }];
  const adapter = { connected: true, detail: 'Ready' }; let retries = 0, release;
  const workflow = new WorkflowService({ workspace, history, sessions: () => sessions, decisionsFile: join(dir, 'decisions.jsonl'), providers: [{ id: 'codex', name: 'Codex', adapter, retry: () => { retries++; return new Promise(resolve => { release = resolve; }); } }] });
  const password = 'workflow testing password', origin = 'https://control.test:47841', auth = new Auth(join(dir, 'auth.json'));
  await savePassword(join(dir, 'auth.json'), password);
  const handler = createHandler({ auth, origin, store: new RequestStore(), snapshot: () => ({ sessions, ...workflow.snapshot() }), vite: () => {}, workflow });
  const request = async (path, { method = 'GET', headers = {}, body } = {}) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    Object.assign(req, { url: path, method, headers: { host: 'control.test:47841', ...headers }, socket: { remoteAddress: '100.80.0.2' } });
    const res = { headers: {}, statusCode: 200, headersSent: false, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, end(raw) { this.raw = raw; this.headersSent = true; } };
    await handler(req, res); return { status: res.statusCode, body: res.raw && JSON.parse(res.raw), headers: res.headers };
  };
  const login = await request('/api/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: { password } });
  const headers = { origin, 'content-type': 'application/json', cookie: login.headers['set-cookie'].split(';')[0], 'x-csrf-token': login.body.csrf };
  return { dir, workspace, history, workflow, sessions, adapter, request, headers, retries: () => retries, release: () => release() };
}

test('workflow endpoints require authentication and mutations require CSRF', async t => {
  const { request, headers, workspace } = await fixture(t);
  for (const path of ['/api/workspace', '/api/history/search?q=workflow', '/api/history/session?id=codex:live', '/api/decisions', '/api/providers/health', '/api/sessions/codex%3Alive/repository']) assert.equal((await request(path)).status, 401, path);
  const patch = { section: 'sessions', key: 'codex:live', value: { alias: 'Alias', pinned: true } };
  assert.equal((await request('/api/workspace', { method: 'POST', headers: { ...headers, 'x-csrf-token': '' }, body: patch })).status, 403);
  assert.equal((await request('/api/providers/codex/retry', { method: 'POST', headers: { ...headers, 'x-csrf-token': '' }, body: {} })).status, 403);
  assert.equal((await request('/api/workspace', { method: 'POST', headers, body: patch })).status, 200);
  assert.equal(workspace.snapshot().sessions['codex:live'].alias, 'Alias');
  assert.equal((await request('/api/snapshot', { headers })).body.workspace.sessions['codex:live'].pinned, true);
  assert.equal((await request('/api/workspace', { method: 'POST', headers, body: { section: 'drafts', key: 'codex:live', value: { text: 'draft' }, baseRevision: 0 } })).status, 200);
  assert.equal((await request('/api/workspace', { method: 'POST', headers, body: { section: 'drafts', key: 'codex:live', value: { text: 'overwrite' }, baseRevision: 0 } })).status, 409);
});

test('dashboard framing permits its own split pane while excluding foreign origins', async t => {
  const { request, headers } = await fixture(t);
  const response = await request('/api/auth', { headers });
  assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN');
  assert.match(response.headers['content-security-policy'], /frame-ancestors 'self'/);
  assert.doesNotMatch(response.headers['content-security-policy'], /frame-ancestors \*/);
});

test('workflow search and decisions are bounded and archived session inspection stays read only', async t => {
  const { dir, request, headers, workflow, sessions } = await fixture(t);
  await workflow.observe(); sessions.length = 0; await workflow.observe();
  const result = await request('/api/history/search?q=workflow&provider=codex', { headers });
  assert.equal(result.status, 200); assert.equal(result.body.results.length, 1);
  const archived = await request('/api/history/session?id=codex:live', { headers });
  assert.equal(archived.body.readOnly, true); assert.equal(archived.body.control, false);
  assert.equal((await request('/api/history/search?q=' + 'a'.repeat(1001), { headers })).status, 400);
  await writeFile(join(dir, 'decisions.jsonl'), 'bad line\n' + Array.from({ length: 300 }, (_, i) => JSON.stringify({ at: new Date(i * 1000).toISOString(), sessionId: 'codex:live', provider: 'codex', kind: 'permission', decision: 'accept', requestId: `r${i}`, unexpected: 'not returned' })).join('\n'));
  const decisions = await request('/api/decisions?session=codex:live&q=accept', { headers });
  assert.equal(decisions.body.decisions.length, 200); assert.equal(decisions.body.truncated, true);
  assert.equal(decisions.body.decisions[0].requestId, 'r299'); assert.equal('unexpected' in decisions.body.decisions[0], false);
  assert.equal((await request('/api/sessions/codex:missing/repository?path=../secret', { headers })).status, 404);
});

test('provider retries coalesce and notification preferences reach background push', async t => {
  const { workflow, retries, release } = await fixture(t); let policy;
  workflow.push = { setPolicy: value => { policy = value; } };
  await workflow.patch({ section: 'preferences', key: 'notifications', value: { enabled: false } });
  assert.deepEqual(policy, { enabled: false });
  const first = workflow.retry('codex'), second = workflow.retry('codex');
  await Promise.resolve(); assert.equal(retries(), 1); release(); await Promise.all([first, second]);
  assert.equal(workflow.health().providers[0].connected, true);
  await assert.rejects(workflow.retry('unknown'), { status: 404 });
});

test('health preserves the last real provider observation while a connected adapter fails to refresh', async t => {
  const { workflow, adapter } = await fixture(t);
  adapter.lastSuccessAt = 100;
  await workflow.observe(); assert.equal(workflow.health().providers[0].lastSuccessAt, 100);
  adapter.detail = 'Could not refresh';
  await workflow.observe(); assert.equal(workflow.health().providers[0].lastSuccessAt, 100);
  adapter.connected = false;
  await workflow.observe(); assert.equal(workflow.health().providers[0].lastSuccessAt, 100);
  delete adapter.lastSuccessAt; adapter.connected = true; adapter.sessions = new Map();
  await workflow.observe(); const first = workflow.health().providers[0].lastSuccessAt;
  await new Promise(resolve => setTimeout(resolve, 5));
  await workflow.observe(); assert.equal(workflow.health().providers[0].lastSuccessAt, first);
});

test('preset launches validate settings and preserve the prompt as a draft without sending it', async t => {
  const { dir, workspace } = await fixture(t); const calls = [];
  await workspace.patch({ section: 'presets', key: 'test', value: { name: 'Test', cwd: dir, provider: 'codex', model: 'model-a', effort: 'high', prompt: 'Do this after I review it' } });
  const codex = new CodexAdapter(new RequestStore()); codex.connected = true;
  codex.modelCatalog.set('model-a', { id: 'model-a', efforts: ['high'] });
  codex.rpc = async (method, params) => { calls.push({ method, params }); assert.equal(method, 'thread/start'); return { thread: { id: 'new-thread', cwd: params.cwd, model: params.model, status: { type: 'idle' } } }; };
  const terminals = [], seats = { reserve() {}, release() {} };
  const deps = { workspace, codex, defaults: { read: async () => ({}) }, seats, launches: { watch() {} }, spawnAgent: async (...args) => { terminals.push(args); return { pane: '%1' }; } };
  const result = await launchPreset({ presetId: 'test', cwd: '/ignored', prompt: 'ignored' }, deps);
  assert.equal(result.sessionId, 'codex:new-thread'); assert.equal(workspace.snapshot().drafts[result.sessionId].text, 'Do this after I review it');
  assert.deepEqual(calls, [{ method: 'thread/start', params: { cwd: dir, model: 'model-a', config: { model_reasoning_effort: 'high' }, historyMode: 'paginated' } }]);
  assert.deepEqual(terminals[0][2].args, ['resume', 'new-thread']); assert.equal(codex.fresh.has('new-thread'), true);
  await workspace.patch({ section: 'presets', key: 'test', value: { effort: 'invalid' } });
  await assert.rejects(launchPreset({ presetId: 'test' }, deps), { status: 400 }); assert.equal(calls.length, 1);
  await workspace.patch({ section: 'presets', key: 'test', value: { effort: 'high' } });
  codex.rpc = async () => ({ thread: { id: 'second-thread', cwd: dir, status: { type: 'idle' } } });
  const partial = await launchPreset({ presetId: 'test' }, { ...deps, spawnAgent: async () => { throw Error('terminal'); } });
  assert.match(partial.warning, /terminal/i); assert.equal(partial.sessionId, 'codex:second-thread');
  assert.equal(workspace.snapshot().drafts[partial.sessionId].text, 'Do this after I review it');
});

test('Claude and OpenCode preset launches validate catalogs and keep account-specific drafts unsent', async t => {
  const { dir, workspace } = await fixture(t), terminals = [], launches = [], created = [];
  const deps = { workspace, defaults: { read: async () => ({}) }, seats: { reserve() {}, release() {} }, launches: { watch: value => launches.push(value) },
    spawnAgent: async (...args) => { terminals.push(args); return { pane: '%2' }; },
    claude: { accountFor: (cwd, label) => { assert.equal(cwd, dir); assert.equal(label, 'work'); return { label, dir: '/accounts/work' }; } },
    modelsForClaude: async () => [{ id: 'claude-model', efforts: ['high'] }],
    opencode: { modelsFor: async () => [{ id: 'open-model', efforts: ['low'] }], spawn: async (cwd, settings) => { created.push([cwd, settings]); return { sessionId: 'opencode:ses_created' }; } } };
  await workspace.patch({ section: 'presets', key: 'claude', value: { cwd: dir, provider: 'claude', account: 'work', model: 'claude-model', effort: 'high', prompt: 'Claude draft' } });
  const claude = await launchPreset({ presetId: 'claude' }, deps);
  assert.match(claude.sessionId, /^claude:[0-9a-f-]{36}$/); assert.equal(workspace.snapshot().drafts[claude.sessionId].text, 'Claude draft');
  assert.equal(terminals[0][2].configDir, '/accounts/work'); assert.equal(terminals[0][2].model, 'claude-model');
  assert.equal(launches[0].sessionId, claude.sessionId.slice(7));
  await workspace.patch({ section: 'presets', key: 'open', value: { cwd: dir, provider: 'opencode', model: 'open-model', effort: 'invalid', prompt: 'Open draft' } });
  await assert.rejects(launchPreset({ presetId: 'open' }, deps), { status: 400 }); assert.equal(created.length, 0);
  await workspace.patch({ section: 'presets', key: 'open', value: { effort: 'low' } });
  const open = await launchPreset({ presetId: 'open' }, deps);
  assert.equal(workspace.snapshot().drafts[open.sessionId].text, 'Open draft');
  assert.equal(terminals[1][2].sessionId, 'ses_created');
});
