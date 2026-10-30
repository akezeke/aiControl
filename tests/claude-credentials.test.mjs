import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeCredentials } from '../server/claude-credentials.mjs';
import { claudeUsageReader } from '../server/usage.mjs';

const login = { claudeAiOauth: { accessToken: 'test-only-token' } };
const home = '/Users/test';
const file = `${home}/.claude/.credentials.json`;
const options = { platform: 'darwin', home, user: 'test', configuredDir: '' };

test('macOS reads the existing Claude Keychain login, scoped to the OS account', async () => {
  assert.deepEqual(await claudeCredentials(file, { ...options, exec: async (command, args) => {
    assert.equal(command, '/usr/bin/security');
    assert.deepEqual(args, ['find-generic-password', '-a', 'test', '-w', '-s', 'Claude Code-credentials']);
    return { stdout: JSON.stringify(login) };
  }, read: () => assert.fail('file should not be read') }), login);
});

test('macOS keeps separate account Keychain entries and never borrows the default login', async () => {
  const services = [];
  const exec = async (_command, args) => { services.push(args.at(-1)); return { stdout: JSON.stringify(login) }; };
  await claudeCredentials(`${home}/.claude-work/.credentials.json`, { ...options, exec });
  await claudeCredentials(`${home}/.claude-personal/.credentials.json`, { ...options, exec });
  await claudeCredentials(file, { ...options, configuredDir: `${home}/.claude`, exec });
  assert.equal(new Set(services).size, 3);
  for (const service of services) assert.match(service, /^Claude Code-credentials-[a-f0-9]{8}$/);
  let calls = 0;
  assert.deepEqual(await claudeCredentials(`${home}/.claude-work/.credentials.json`, { ...options, exec: async (_command, args) => {
    calls++; assert.notEqual(args.at(-1), 'Claude Code-credentials'); throw new Error('missing');
  }, read: async () => JSON.stringify(login) }), login);
  assert.equal(calls, 1);
});

test('file logins remain available on Linux and when the Mac Keychain is unavailable', async () => {
  const read = async path => { assert.equal(path, file); return JSON.stringify(login); };
  assert.deepEqual(await claudeCredentials(file, { platform: 'linux', read, exec: () => assert.fail('Keychain on Linux') }), login);
  for (const exec of [async () => { throw new Error('denied'); }, async () => ({ stdout: 'invalid JSON' }), async () => ({ stdout: '{}' })]) {
    assert.deepEqual(await claudeCredentials(file, { ...options, exec, read }), login);
  }
});

test('usage rereads Keychain credentials after rotation and never exposes Keychain errors', async () => {
  let token = 'first', calls = 0;
  const readCredentials = path => claudeCredentials(path, { ...options, exec: async () => ({ stdout: JSON.stringify({ claudeAiOauth: { accessToken: token } }) }) });
  const read = claudeUsageReader({ credentialsFile: file, readCredentials, fetchUsage: async (url, options) => {
    calls++; assert.equal(url, 'https://api.anthropic.com/api/oauth/usage');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    return { ok: true, json: async () => ({ five_hour: { utilization: 12 } }) };
  } });
  await read(new AbortController().signal); token = 'second'; await read(new AbortController().signal);
  assert.equal(calls, 2);
  const unavailable = claudeUsageReader({ readCredentials: async () => { throw new Error('secret command output'); }, fetchUsage: () => assert.fail('no credentials') });
  await assert.rejects(unavailable(new AbortController().signal), error => /Sign in/.test(error.message) && !error.message.includes('secret'));
});
