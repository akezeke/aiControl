import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Auth, savePassword, idleMs } from '../server/auth.mjs';
import { RequestStore } from '../server/requests.mjs';
import { createHandler } from '../server/http.mjs';
import { codexRequest, codexStatus } from '../server/codex.mjs';
import { claudeRequest, ClaudeAdapter } from '../server/claude.mjs';
import { mergeHooks, hookCommand } from '../scripts/install-hooks.mjs';
import { isTailscaleIP, claudeDirs, claudeAccounts } from '../server/config.mjs';

const password = 'correct horse testing battery';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-control-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'auth.json'); await savePassword(file, password);
  return { dir, file };
}
async function request(handler, path, { method = 'GET', headers = {}, body, ip = '100.80.0.2' } = {}) {
  const req = Readable.from(body === undefined ? [] : [typeof body === 'string' ? body : JSON.stringify(body)]);
  Object.assign(req, { url: path, method, headers: { host: 'control.test:47841', ...headers }, socket: { remoteAddress: ip } });
  const res = { headers: {}, statusCode: 200, headersSent: false, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, end(raw) { this.raw = raw; this.headersSent = true; } };
  await handler(req, res); return { status: res.statusCode, headers: res.headers, body: res.raw ? JSON.parse(res.raw) : null };
}

test('password hashing, private permissions, invalidation and rate limits', async t => {
  const { file } = await fixture(t);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await readFile(file, 'utf8')).includes(password), false);
  let now = 100_000;
  const auth = new Auth(file, { now: () => now });
  const login = await auth.login(password, 'phone');
  const req = { headers: { cookie: auth.cookie(login.token).split(';')[0] } };
  assert.ok(await auth.get(req));
  assert.match(auth.cookie(login.token), /HttpOnly; SameSite=Strict.*Secure/);
  now += idleMs + 1;
  assert.equal(await auth.get(req), null);
  const next = await auth.login(password, 'phone');
  await savePassword(file, 'a newly changed password');
  assert.equal(await auth.get({ headers: { cookie: auth.cookie(next.token).split(';')[0] } }), null);
  for (let i = 0; i < 5; i++) await assert.rejects(auth.login('wrong', 'attacker'), e => e.status === 401);
  await assert.rejects(auth.login(password, 'attacker'), e => e.status === 429);
  await assert.rejects(savePassword(file, 'short'), /12/);
});

test('HTTP protects session data, rejects CSRF, and logs out', async t => {
  const { file } = await fixture(t);
  const auth = new Auth(file), store = new RequestStore();
  const origin = 'https://control.test:47841';
  const handler = createHandler({ auth, store, origin, snapshot: () => ({ sessions: [{ title: 'private work' }] }), vite: (_req, res) => res.end('null') });
  assert.equal((await request(handler, '/api/snapshot')).status, 401);
  assert.equal((await request(handler, '/api/auth')).body.authenticated, false);
  assert.equal((await request(handler, '/api/login', { method: 'POST', body: { password }, headers: { 'content-type': 'application/json' } })).status, 403);
  assert.equal((await request(handler, '/api/auth', { headers: { host: 'attacker.test' } })).status, 403);
  const login = await request(handler, '/api/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: { password } });
  assert.equal(login.status, 200);
  const headers = { origin, cookie: login.headers['set-cookie'].split(';')[0], 'content-type': 'application/json', 'x-csrf-token': login.body.csrf };
  const snapshot = await request(handler, '/api/snapshot', { headers });
  assert.equal(snapshot.body.sessions[0].title, 'private work');
  assert.equal(snapshot.headers['cache-control'], 'no-store');
  assert.equal((await request(handler, '/api/activity', { method: 'POST', headers: { ...headers, 'x-csrf-token': 'bad' }, body: {} })).status, 403);
  assert.equal((await request(handler, '/api/activity', { method: 'POST', headers: { ...headers, origin: 'https://evil.test' }, body: {} })).status, 403);
  assert.equal((await request(handler, '/api/snapshot', { headers: { ...headers, 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await request(handler, '/api/login', { method: 'POST', headers, body: 'x'.repeat(70_000) })).status, 413);
  assert.equal((await request(handler, '/api/login', { method: 'POST', headers, body: '{broken' })).status, 400);
  assert.equal((await request(handler, '/api/logout', { method: 'POST', headers, body: {} })).status, 200);
  assert.equal((await request(handler, '/api/snapshot', { headers })).status, 401);
  const again = await request(handler, '/api/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: { password } });
  const freshHeaders = { cookie: again.headers['set-cookie'].split(';')[0] };
  assert.equal((await request(handler, '/api/snapshot', { headers: freshHeaders })).status, 200);
  await request(handler, '/', { headers: freshHeaders });
  assert.equal((await request(handler, '/api/snapshot', { headers: freshHeaders })).status, 200);
});

test('refresh and polling preserve login but only interaction renews the ten-minute idle window', async t => {
  const { file } = await fixture(t);
  let now = 100_000;
  const auth = new Auth(file, { now: () => now }), origin = 'https://control.test:47841';
  const handler = createHandler({ auth, origin, store: new RequestStore(), snapshot: () => ({ sessions: [] }), vite: (_req, res) => res.end('null') });
  const login = await request(handler, '/api/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: { password } });
  const headers = { origin, 'content-type': 'application/json', cookie: login.headers['set-cookie'].split(';')[0], 'x-csrf-token': login.body.csrf };
  now += 9 * 60_000;
  assert.equal((await request(handler, '/api/snapshot', { headers })).status, 200);
  const restored = await request(handler, '/api/auth', { headers });
  assert.equal(restored.body.authenticated, true);
  assert.equal(restored.body.idleRemainingMs, 60_000);
  assert.equal(restored.body.token, undefined);
  const page = await request(handler, '/', { headers });
  assert.equal(page.headers['set-cookie'], undefined);
  assert.equal((await request(handler, '/api/auth', { headers })).body.idleRemainingMs, 60_000);
  // Real interaction, including scrolling/typing on the client, keeps login alive.
  const activity = await request(handler, '/api/activity', { method: 'POST', headers, body: {} });
  assert.equal(activity.status, 200);
  assert.ok(activity.headers['set-cookie']);
  now += 9 * 60_000;
  assert.equal((await request(handler, '/api/snapshot', { headers })).status, 200);
  now += 60_000;
  assert.equal((await request(handler, '/api/auth', { headers })).body.authenticated, false);
  assert.equal((await request(handler, '/api/snapshot', { headers })).status, 401);
  assert.equal((await request(handler, '/api/activity', { method: 'POST', headers, body: {} })).status, 401);
});

test('requests cannot be replayed, changed, or submitted concurrently', async () => {
  const audit = []; const store = new RequestStore(async e => audit.push(e));
  let finish, sends = 0;
  const id = store.add({ sessionId: 's', provider: 'codex', kind: 'permission', actions: [{ value: 'accept' }] }, async () => { sends++; await new Promise(resolve => { finish = resolve; }); }, 'source');
  await assert.rejects(store.respond(id, { decision: 'acceptForSession' }), e => e.status === 400);
  const first = store.respond(id, { decision: 'accept' });
  await assert.rejects(store.respond(id, { decision: 'accept' }), e => e.status === 409);
  finish(); await first;
  await assert.rejects(store.respond(id, { decision: 'accept' }), e => e.status === 409);
  assert.equal(sends, 1); assert.equal(audit.length, 1);
  const other = store.add({ sessionId: 's', kind: 'permission', actions: [{ value: 'accept' }] }, async () => {}, 'source2');
  store.removeSource('source2');
  await assert.rejects(store.respond(other, { decision: 'accept' }), e => e.status === 409);
});

test('message and queue endpoints require login, same origin and CSRF', async t => {
  const { file } = await fixture(t);
  const auth = new Auth(file), origin = 'https://control.test:47841', calls = [];
  const handler = createHandler({ auth, origin, store: new RequestStore(), snapshot: () => ({}), vite: () => {}, messages: {
    send: async (id, data) => { calls.push(['send', id, data]); return { status: 'queued' }; },
    cancel: async (id, queuedId) => { calls.push(['cancel', id, queuedId]); return { ok: true }; },
  } });
  const path = '/api/sessions/codex%3Alive-thread/messages';
  const body = { text: 'Follow up', mode: 'queue', clientMessageId: '12345678-1234-1234-1234-123456789012' };
  assert.equal((await request(handler, path, { method: 'POST', headers: { origin }, body })).status, 401);
  const login = await request(handler, '/api/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: { password } });
  const headers = { origin, 'content-type': 'application/json', cookie: login.headers['set-cookie'].split(';')[0], 'x-csrf-token': login.body.csrf };
  assert.equal((await request(handler, path, { method: 'POST', headers: { ...headers, 'x-csrf-token': 'bad' }, body })).status, 403);
  assert.equal((await request(handler, path, { method: 'POST', headers: { ...headers, origin: 'https://evil.test' }, body })).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await request(handler, path, { method: 'POST', headers, body })).body.status, 'queued');
  assert.deepEqual(calls[0], ['send', 'codex:live-thread', body]);
  assert.equal((await request(handler, '/api/sessions/codex%3Alive-thread/queue/queued-1/cancel', { method: 'POST', headers, body: {} })).status, 200);
  assert.deepEqual(calls[1], ['cancel', 'codex:live-thread', 'queued-1']);
});

test('questions require complete valid answers and preserve protocol IDs', async () => {
  const store = new RequestStore(); let response;
  const adapted = codexRequest({ method: 'item/tool/requestUserInput', params: { threadId: 'thread', questions: [{ id: 'format', question: 'Which format?', isOther: false, options: [{ label: 'JSON' }, { label: 'CSV' }] }] } });
  const id = store.add(adapted.view, async answer => { response = adapted.encode(answer); }, 'question');
  await assert.rejects(store.respond(id, { answers: {} }), /Answer/);
  await assert.rejects(store.respond(id, { answers: { format: ['YAML'] } }), /offered/);
  await assert.rejects(store.respond(id, { answers: { format: ['JSON', 'CSV'] } }), /one/);
  await store.respond(id, { answers: { format: ['CSV'] } });
  assert.deepEqual(response, { answers: { format: { answers: ['CSV'] } } });
});

test('Codex permissions and statuses use documented responses', () => {
  const command = codexRequest({ method: 'item/commandExecution/requestApproval', params: { threadId: 't', command: 'npm test', availableDecisions: ['accept', 'cancel'] } });
  assert.deepEqual(command.view.actions.map(a => a.value), ['accept', 'cancel']);
  assert.deepEqual(command.encode({ decision: 'cancel' }), { decision: 'cancel' });
  const permission = codexRequest({ method: 'item/permissions/requestApproval', params: { threadId: 't', permissions: { network: { enabled: true } } } });
  assert.deepEqual(permission.encode({ decision: 'decline' }), { permissions: {}, scope: 'turn' });
  assert.deepEqual(permission.encode({ decision: 'accept' }), { permissions: { network: { enabled: true } }, scope: 'turn' });
  assert.equal(codexStatus({ type: 'active', activeFlags: ['waitingOnApproval'] }), 'permission');
  assert.equal(codexStatus({ type: 'active', activeFlags: ['waitingOnUserInput'] }), 'question');
  assert.equal(codexStatus({ type: 'idle' }), 'idle');
  assert.equal(codexStatus({ type: 'notLoaded' }), 'offline');
});

test('Codex offers session-wide and policy approvals when the server leaves the choice open', () => {
  const command = codexRequest({ method: 'item/commandExecution/requestApproval', params: { threadId: 't', command: 'npm test', proposedExecpolicyAmendment: ['npm', 'test'] } });
  assert.deepEqual(command.view.actions.map(a => [a.value, a.label]), [['accept', 'Allow once'], ['acceptForSession', 'Allow for session'], ['acceptWithExecpolicyAmendment', 'Always allow npm test'], ['decline', 'Deny'], ['cancel', 'Cancel turn']]);
  assert.deepEqual(command.encode({ decision: 'acceptWithExecpolicyAmendment' }), { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['npm', 'test'] } } });
  const files = codexRequest({ method: 'item/fileChange/requestApproval', params: { threadId: 't' } });
  assert.deepEqual(files.view.actions.map(a => a.value), ['accept', 'acceptForSession', 'decline', 'cancel']);
});

test('Claude hook responses keep the original questions and never approve by default', () => {
  const questions = [{ question: 'Where?', header: 'Place', options: [{ label: 'Here' }], multiSelect: false }];
  const question = claudeRequest({ session_id: 's', hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions } });
  assert.equal(question.view.kind, 'question');
  assert.deepEqual(question.encode({ answers: { 0: ['Elsewhere'] } }), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: { questions, answers: { 'Where?': 'Elsewhere' } } } } });
  const permission = claudeRequest({ session_id: 's', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.deepEqual(permission.encode({ decision: 'accept' }), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: { command: 'npm test' } } } });
  assert.equal(permission.encode({ decision: 'decline' }).hookSpecificOutput.decision.behavior, 'deny');
  // Claude's suggested rules become one "always" button; a denial can carry the user's reason.
  const suggestions = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }];
  const always = claudeRequest({ session_id: 's', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test' }, permission_suggestions: suggestions });
  assert.deepEqual(always.view.actions.map(a => a.label), ['Allow once', 'Always allow Bash(npm test:*)', 'Deny']);
  assert.deepEqual(always.encode({ decision: 'always' }).hookSpecificOutput.decision, { behavior: 'allow', updatedInput: { command: 'npm test' }, updatedPermissions: suggestions });
  assert.deepEqual(always.encode({ decision: 'decline', message: 'Use pnpm' }).hookSpecificOutput.decision, { behavior: 'deny', message: 'Use pnpm' });
  const plan = claudeRequest({ session_id: 's', hook_event_name: 'PermissionRequest', tool_name: 'ExitPlanMode', tool_input: { plan: '# Plan\n1. Do it' } });
  assert.equal(plan.view.plan, '# Plan\n1. Do it');
  assert.deepEqual(plan.view.actions.map(a => a.label), ['Approve', 'Keep planning']);
  // Old PreToolUse hooks get an immediate empty reply, so they never block the terminal.
  assert.equal(claudeRequest({ session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions } }), null);
});

test('hook installation is idempotent and preserves unrelated settings/hooks', () => {
  const settings = { theme: 'dark', permissions: { allow: ['Read'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'something-else' }] }] } };
  const merged = mergeHooks(settings);
  assert.deepEqual(mergeHooks(merged), merged);
  assert.deepEqual(merged.permissions, settings.permissions);
  assert.equal(merged.hooks.Stop.length, 2);
  assert.equal(merged.hooks.PreToolUse, undefined);
  const legacy = { hooks: { PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: hookCommand }] }] } };
  assert.equal(mergeHooks(legacy).hooks.PreToolUse, undefined);
  assert.equal(merged.hooks.PermissionRequest[0].hooks[0].command, hookCommand);
  assert.deepEqual(mergeHooks(merged, true), settings);
});

test('Claude discovery reads every config folder, excludes stale PIDs and uses full paths to distinguish projects', async t => {
  const { dir } = await fixture(t);
  const { writeFile, mkdir } = await import('node:fs/promises');
  const work = join(dir, '.claude'), personal = join(dir, '.claude-personal');
  await mkdir(join(work, 'sessions'), { recursive: true }); await mkdir(join(personal, 'sessions'), { recursive: true });
  await writeFile(join(work, 'sessions/123.json'), JSON.stringify({ pid: 123, procStart: 'old', sessionId: 'stale', cwd: '/home/a/project', status: 'idle' }));
  await writeFile(join(personal, 'sessions/456.json'), JSON.stringify({ pid: 456, procStart: 'live', sessionId: 'current', cwd: '/home/b/project', name: 'Current work', status: 'busy' }));
  await mkdir(join(dir, '.claude-code-router'));
  assert.deepEqual(claudeDirs(dir, undefined), [work, personal]);
  assert.deepEqual(claudeDirs(join(dir, '.claude-code-router'), '/custom/'), ['/custom']);
  const adapter = new ClaudeAdapter(new RequestStore(), join(dir, 'unused.sock'), { accounts: claudeAccounts({ claudeDirs: [work, personal] }, dir), alive: async (pid, start) => pid === 456 && start === 'live' });
  await adapter.refresh();
  assert.equal(adapter.list().length, 1);
  assert.equal(adapter.list()[0].title, 'Current work');
  assert.equal(adapter.list()[0].cwd, '/home/b/project');
  assert.equal(adapter.list()[0].status, 'working');
  assert.equal(adapter.list()[0].control, false);
});

test('a parked Claude session is idle, whatever its registration last said', async t => {
  const { dir } = await fixture(t);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(dir, '789.json'), JSON.stringify({ pid: 789, procStart: 'live', sessionId: 'parked', cwd: '/home/c/project', status: 'busy', parkedJobId: 'job' }));
  const adapter = new ClaudeAdapter(new RequestStore(), join(dir, 'unused.sock'), { sessionsDir: dir, alive: async () => true });
  await adapter.refresh();
  assert.equal(adapter.list()[0].status, 'idle');
});

test('Tailscale address validation refuses public, LAN and wildcard interfaces', () => {
  for (const valid of ['100.64.0.1', '100.127.255.254']) assert.ok(isTailscaleIP(valid));
  for (const invalid of ['0.0.0.0', '127.0.0.1', '192.168.1.4', '100.63.0.1', '100.128.0.1', '100.80.0.999', '::', 'example.com']) assert.equal(isTailscaleIP(invalid), false);
});

test('a short PIN keeps leading zeroes, hashing and login limits', async t => {
  const { file } = await fixture(t);
  const auth = new Auth(file);
  await auth.change(password, '0042', 'phone');
  assert.equal(await auth.kind(), 'pin');
  const record = JSON.parse(await readFile(file, 'utf8'));
  // Four digits can occur by chance inside a random hexadecimal salt or hash.
  assert.deepEqual(Object.keys(record).sort(), ['hash', 'kind', 'salt']);
  assert.match(record.salt, /^[a-f0-9]{64}$/);
  assert.match(record.hash, /^[a-f0-9]{128}$/);
  await assert.rejects(auth.login('42', 'phone'), e => e.status === 401);
  await auth.login('0042', 'phone');
  await assert.rejects(auth.change('wrong', '7890', 'phone'), e => e.status === 401);
  await assert.rejects(savePassword(file, '123'), /4–8/);
  await assert.rejects(savePassword(file, 'abcd'), /4–8/);
  for (let i = 0; i < 5; i++) await assert.rejects(auth.login('1111', 'attacker'), e => e.status === 401);
  await assert.rejects(auth.login('0042', 'attacker'), e => e.status === 429);
});

test('changing to a PIN in the dashboard requires current credential and CSRF, and locks every session', async t => {
  const { file } = await fixture(t);
  const auth = new Auth(file), origin = 'https://control.test:47841';
  const handler = createHandler({ auth, origin, store: new RequestStore(), snapshot: () => ({ sessions: [] }), vite: () => {} });
  const other = await auth.login(password, 'other-phone');
  const login = await request(handler, '/api/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: { password } });
  const headers = { origin, 'content-type': 'application/json', cookie: login.headers['set-cookie'].split(';')[0], 'x-csrf-token': login.body.csrf };
  assert.equal((await request(handler, '/api/password', { method: 'POST', headers: { ...headers, 'x-csrf-token': 'wrong' }, body: { current: password, next: '0042' } })).status, 403);
  assert.equal((await request(handler, '/api/password', { method: 'POST', headers, body: { current: 'wrong', next: '0042' } })).status, 400);
  assert.equal((await request(handler, '/api/password', { method: 'POST', headers, body: { current: password, next: '0042' } })).status, 200);
  assert.equal((await request(handler, '/api/snapshot', { headers })).status, 401);
  assert.equal(await auth.get({ headers: { cookie: auth.cookie(other.token).split(';')[0] } }), null);
  assert.equal((await request(handler, '/api/auth')).body.kind, 'pin');
  await auth.login('0042', 'phone');
});

test('HTTP accepts every configured origin, such as localhost aliases', async t => {
  const { file } = await fixture(t);
  const origin = ['http://127.0.0.1:47841', 'http://localhost:47841'];
  const handler = createHandler({ auth: new Auth(file, { secure: false }), origin, store: new RequestStore(), snapshot: () => ({}), vite: (_req, res) => res.end('null') });
  for (const host of ['127.0.0.1:47841', 'localhost:47841']) assert.equal((await request(handler, '/api/auth', { headers: { host } })).status, 200);
  assert.equal((await request(handler, '/api/auth')).status, 403);
  const login = await request(handler, '/api/login', { method: 'POST', headers: { host: 'localhost:47841', origin: origin[1], 'content-type': 'application/json' }, body: { password } });
  assert.equal(login.status, 200);
  assert.doesNotMatch(login.headers['set-cookie'], /Secure/);
});
