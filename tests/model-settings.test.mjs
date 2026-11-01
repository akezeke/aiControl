import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { AgentDefaults } from '../server/agent-defaults.mjs';
import { claudeModels, claudeModelOptions } from '../server/claude-models.mjs';
import { ClaudeAdapter } from '../server/claude.mjs';
import { OpenCodeAPI } from '../server/opencode-api.mjs';
import { RequestStore } from '../server/requests.mjs';
import { terminalLaunch } from '../scripts/opencode-terminal.mjs';

test('model defaults survive restarts and isolate providers and Claude accounts', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-defaults-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'models.json'), defaults = new AgentDefaults(file);
  assert.deepEqual(await defaults.read('opencode'), {});
  await Promise.all([defaults.save('claude', 'work', { model: 'opus', effort: 'high' }), defaults.save('claude', '', { model: 'sonnet' }), defaults.save('opencode', '', { model: 'anthropic/opus', effort: 'max' })]);
  const restarted = new AgentDefaults(file);
  assert.deepEqual(await restarted.read('claude', 'work'), { model: 'opus', effort: 'high' });
  assert.deepEqual(await restarted.read('claude'), { model: 'sonnet', effort: '' });
  assert.deepEqual(await restarted.read('opencode'), { model: 'anthropic/opus', effort: 'max' });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('Claude discovery initializes without inference, strips secrets and closes its child', async () => {
  const child = new EventEmitter(); Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: signal => { child.killed = signal; } });
  let launchArgs, request;
  child.stdin.on('data', data => { request = JSON.parse(data); queueMicrotask(() => child.stdout.write(JSON.stringify({ type: 'control_response', response: { request_id: request.request_id, response: { models: [{ value: 'opus', resolvedModel: 'claude-opus-test', displayName: 'Opus', supportsEffort: true, supportedEffortLevels: ['high', 'max'], apiKey: 'do-not-return' }] } } }) + '\n')); });
  const models = await claudeModels('/work/discovery-test', '/accounts/work', { launch: (...args) => { launchArgs = args; return child; } });
  assert.equal(request.request.subtype, 'initialize'); assert.equal(request.type, 'control_request');
  assert.ok(launchArgs[1].includes('--bare')); assert.ok(launchArgs[1].includes('--no-session-persistence'));
  assert.equal(launchArgs[2].env.CLAUDE_CONFIG_DIR, '/accounts/work'); assert.equal(child.killed, 'SIGTERM');
  assert.deepEqual(models, [{ id: 'opus', resolvedModel: 'claude-opus-test', name: 'Opus', efforts: ['high', 'max'] }]);
  assert.deepEqual(claudeModelOptions([{ value: 'basic', supportedEffortLevels: ['high'] }])[0].efforts, []);
});

test('Claude applies validated terminal controls and allows later transcript settings to supersede them', async () => {
  const calls = [], adapter = new ClaudeAdapter(new RequestStore(), '/unused', { messaging: { setModel: async (_, value) => calls.push(['model', value]), setEffort: async (_, value) => calls.push(['effort', value]) } });
  adapter.record = async () => ({ sessionId: 'test', cwd: '/work' });
  adapter.modelOptions = async () => [{ id: 'opus', resolvedModel: 'claude-opus-test', efforts: ['high'] }];
  adapter.sessions.set('test', { nativeId: 'test', model: 'old', messaging: { effort: true } });
  await assert.rejects(adapter.setModel('test', 'bad'), /Unknown model/);
  await adapter.setModel('test', 'opus'); await adapter.setEffort('test', 'high');
  assert.equal(adapter.list()[0].model, 'opus'); assert.equal(adapter.list()[0].effort, 'high');
  await assert.rejects(adapter.setEffort('test', 'max'), /does not support/);
  assert.deepEqual(calls, [['model', 'opus'], ['effort', 'high']]);
  adapter.sessions.get('test').model = 'claude-sonnet-test';
  assert.equal(adapter.list()[0].model, 'claude-sonnet-test');
});

test('OpenCode V1 only lists connected providers and carries model and variant on the next prompt', async () => {
  const calls = [], api = new OpenCodeAPI({ request: async (path, options) => { calls.push({ path, options }); return { connected: ['anthropic'], all: [{ id: 'anthropic', models: { test: { id: 'test', name: 'Test', variants: { high: {}, max: {} } } } }, { id: 'offline', models: { secret: { id: 'secret' } } }] }; } });
  api.v2 = false;
  assert.equal((await api.models('/work')).length, 1);
  assert.deepEqual(await api.selectModel('ses_test', 'anthropic/test', 'max'), { pending: true });
  await api.send('ses_test', '/work', 'Hello', { model: 'anthropic/test', effort: 'max' });
  assert.deepEqual(calls.at(-1).options.body, { parts: [{ type: 'text', text: 'Hello' }], model: { providerID: 'anthropic', modelID: 'test' }, variant: 'max' });
});

test('OpenCode terminals attach the exact session, with credentials only in the environment', () => {
  const config = { url: 'http://127.0.0.1:4096', username: 'local', password: 'private-test' };
  const launch = terminalLaunch(config, 'ses_test', true, '/work', { PATH: '/bin' });
  assert.deepEqual(launch.args, ['--server', config.url, '--session', 'ses_test']);
  assert.equal(launch.env.OPENCODE_PASSWORD, config.password); assert.equal(launch.args.join(' ').includes(config.password), false);
  assert.deepEqual(terminalLaunch(config, 'ses_test', false, '/work', {}).args, ['attach', config.url, '--session', 'ses_test', '--dir', '/work']);
  assert.deepEqual(terminalLaunch({ service: true }, 'ses_test', true, '/work', {}).args, ['--session', 'ses_test']);
  assert.throws(() => terminalLaunch(config, 'ses_test; bad'), /Invalid/);
});
