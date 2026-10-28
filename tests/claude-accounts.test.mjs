import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeAccounts } from '../server/config.mjs';
import { ClaudeAdapter } from '../server/claude.mjs';
import { RequestStore } from '../server/requests.mjs';
import { TranscriptReader } from '../server/messages.mjs';
import { installHooks, hookCommand } from '../scripts/install-hooks.mjs';
import { claudeDirs } from '../scripts/setup.mjs';

async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'aicontrol-accounts-')); t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('Claude accounts accept any folder name, expand ~ and drop duplicates', () => {
  const dirs = ['~/.claude', '~/.claude-personal', '~/accounts/work/', '~/.cc_side', '~/.config/claude', '~/.claude-personal'];
  assert.deepEqual(claudeAccounts({ claudeDirs: dirs }, '/home/u').map(a => [a.dir, a.label]), [
    ['/home/u/.claude', ''], ['/home/u/.claude-personal', 'personal'], ['/home/u/accounts/work', 'work'], ['/home/u/.cc_side', 'cc_side'], ['/home/u/.config/claude', 'config'],
  ]);
  assert.equal(claudeAccounts({ claudeDirs: ['~/.claude-personal'] }, '/home/u')[0].sessionsDir, '/home/u/.claude-personal/sessions');
  const saved = process.env.CLAUDE_CONFIG_DIR; delete process.env.CLAUDE_CONFIG_DIR;
  try { assert.deepEqual(claudeAccounts({ claudeDirs: [] }, '/home/u').map(a => a.dir), ['/home/u/.claude']); } finally { if (saved !== undefined) process.env.CLAUDE_CONFIG_DIR = saved; }
});

test('setup finds Claude folders by their contents, not their names', async t => {
  const home = await temporary(t);
  for (const dir of ['.claude/sessions', '.claude/projects', 'personal', '.codex/sessions', 'notes']) await mkdir(join(home, dir), { recursive: true });
  await writeFile(join(home, 'personal/.credentials.json'), '{}');
  const saved = process.env.CLAUDE_CONFIG_DIR; delete process.env.CLAUDE_CONFIG_DIR;
  try {
    assert.deepEqual(claudeDirs(home, {}), ['~/.claude', '~/personal']);
    assert.deepEqual(claudeDirs(home, { claudeDirs: ['/elsewhere/claude-work'] }), ['/elsewhere/claude-work', '~/.claude', '~/personal']);
  } finally { if (saved !== undefined) process.env.CLAUDE_CONFIG_DIR = saved; }
});

test('Claude sessions from every account are listed, labelled and messaged through their own registration', async t => {
  const root = await temporary(t);
  const accounts = claudeAccounts({ claudeDirs: [join(root, 'work'), join(root, '.claude-personal')] }, root);
  for (const account of accounts) await mkdir(account.sessionsDir, { recursive: true });
  const record = (pid, sessionId, updatedAt) => ({ pid, procStart: 'live', sessionId, cwd: '/w/app', status: 'idle', updatedAt });
  await writeFile(join(accounts[0].sessionsDir, '1.json'), JSON.stringify(record(1, 'work-session', 1)));
  await writeFile(join(accounts[1].sessionsDir, '2.json'), JSON.stringify(record(2, 'personal-session', 2)));
  const sent = [];
  const adapter = new ClaudeAdapter(new RequestStore(), '/unused.sock', { accounts, alive: async () => true, messaging: { available: async () => true, send: async record => { sent.push(record.sessionId); return { status: 'submitted' }; }, stop() {} } });
  await adapter.refresh();
  assert.deepEqual(adapter.list().map(s => [s.nativeId, s.account]).sort(), [['personal-session', 'personal'], ['work-session', 'work']]);
  assert.equal(adapter.accountFor('/w/app').dir, accounts[1].dir);
  assert.equal(adapter.accountFor('/w/other').dir, accounts[0].dir);
  await adapter.sendMessage('personal-session', { text: 'Hi', mode: 'send', clientMessageId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
  assert.deepEqual(sent, ['personal-session']);
});

test('transcripts are readable from every account, and only from them', async t => {
  const root = await temporary(t);
  const sessionId = '11111111-2222-3333-4444-555555555555';
  const row = JSON.stringify({ type: 'user', uuid: 'one', sessionId, timestamp: '2026-10-28T12:00:00Z', message: { role: 'user', content: 'Hello' } }) + '\n';
  for (const dir of ['a/projects', 'b/projects', 'c']) { await mkdir(join(root, dir), { recursive: true }); await writeFile(join(root, dir, `${sessionId}.jsonl`), row); }
  const reader = new TranscriptReader([join(root, 'a/projects'), join(root, 'b/projects')]);
  assert.deepEqual((await reader.read(join(root, 'b/projects', `${sessionId}.jsonl`), sessionId)).messages.map(m => m.text), ['Hello']);
  assert.equal((await reader.read(join(root, 'c', `${sessionId}.jsonl`), sessionId)).messagesState, 'unavailable');
});

// New files only: changing an existing one leaves a backup in .local.
test('hooks are installed into every account settings file, creating its folder', async t => {
  const root = await temporary(t);
  const files = [join(root, '.claude/settings.json'), join(root, 'accounts/personal/settings.json')];
  const log = t.mock.method(console, 'log', () => {});
  await installHooks(false, files);
  for (const file of files) assert.equal(JSON.parse(await readFile(file, 'utf8')).hooks.Stop[0].hooks[0].command, hookCommand);
  await installHooks(false, files);
  assert.equal(log.mock.callCount(), 2);
});
