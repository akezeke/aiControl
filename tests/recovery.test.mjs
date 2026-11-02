import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Recovery, resumeArgs, GRACE_MS, KEEP_MS, RESUME_MS } from '../server/recovery.mjs';
import { PromptHistory } from '../server/prompt-history.mjs';

const claude = (id, extra = {}) => ({ id: `claude:${id}`, nativeId: id, provider: 'claude', title: `Task ${id}`, cwd: '/work/app', project: 'app', account: '', status: 'working', pid: 100, permissionMode: 'auto', updatedAt: 1,
  messages: [{ role: 'user', text: 'fix the  login\nbug' }, { role: 'assistant', text: 'Looking at auth.js' }, { role: 'assistant', text: 'Read · auth.js', tool: true }], ...extra });
const codex = (id, extra = {}) => ({ id: `codex:${id}`, nativeId: id, provider: 'codex', title: 'Codex task', cwd: '/work/app', project: 'app', status: 'idle', messages: [{ role: 'user', text: 'tidy the docs' }], ...extra });
const file = () => join(mkdtempSync(join(tmpdir(), 'recovery-')), 'recovery.json');

test('a session that vanishes without a goodbye is lost after the grace period, with what it was doing', () => {
  const recovery = new Recovery(null);
  recovery.update([claude('a')], { now: 0 });
  recovery.update([], { now: 4000 });
  assert.deepEqual(recovery.lost(4000), []);
  recovery.update([], { now: GRACE_MS });
  const [lost] = recovery.lost(GRACE_MS);
  assert.equal(lost.id, 'claude:a');
  assert.equal(lost.status, 'working');
  assert.equal(lost.prompt, 'fix the login bug');
  assert.equal(lost.reply, 'Looking at auth.js');
  assert.equal(lost.mode, 'auto');
  assert.equal(lost.resuming, false);
  assert.equal('pid' in lost, false);
});

test('the last prompt and mode outlast the transcript window', () => {
  const recovery = new Recovery(null);
  recovery.update([claude('a')], { now: 0 });
  recovery.update([claude('a', { permissionMode: undefined, messages: [{ role: 'assistant', text: 'Still on auth.js' }] })], { now: 4000 });
  recovery.update([claude('a', { permissionMode: undefined, messages: [] }), claude('b', { pid: 200, permissionMode: 'default' })], { now: 8000 });
  recovery.update([], { now: 8000 + GRACE_MS });
  const [a, b] = recovery.lost(8000 + GRACE_MS);
  assert.deepEqual([a.prompt, a.reply, a.mode], ['fix the login bug', 'Still on auth.js', 'auto']);
  assert.equal(b.mode, '');
});

test('a prompt buried past the window comes from the prompt history; bare commands don\'t count', () => {
  const recovery = new Recovery(null), typed = { a: 'make the map bigger' };
  recovery.update([claude('a', { messages: [{ role: 'user', text: '/usage' }, { role: 'assistant', text: 'Done.' }] })], { now: 0, typed: session => typed[session.nativeId] });
  recovery.update([], { now: GRACE_MS });
  assert.equal(recovery.lost(GRACE_MS)[0].prompt, 'make the map bigger');
});

test('the prompt history keeps each session\'s last typed prompt as the log grows', async () => {
  const path = file(), line = (sessionId, display) => `${JSON.stringify({ display, pastedContents: {}, timestamp: 1, project: '/work', sessionId })}\n`;
  writeFileSync(path, line('a', 'first') + line('b', 'other') + line('a', 'second'));
  const history = new PromptHistory([path, join(tmpdir(), 'missing-history.jsonl')]);
  await Promise.all([history.refresh(), history.refresh()]);
  assert.equal(history.get('a'), 'second');
  // A line still being written is read once it ends; a bare command leaves the last real prompt.
  appendFileSync(path, line('a', 'third').slice(0, 20));
  await history.refresh();
  assert.equal(history.get('a'), 'second');
  appendFileSync(path, line('a', 'third').slice(20) + line('a', '/compact'));
  await history.refresh();
  assert.deepEqual([history.get('a'), history.get('b'), history.get('c')], ['third', 'other', '']);
});

test('a session that ends on purpose, or clears into a new one, is not lost', () => {
  const recovery = new Recovery(null);
  recovery.update([claude('a'), claude('b', { pid: 200 }), claude('c', { pid: 300 }), claude('d', { pid: 400 }), claude('e', { pid: 500 }), claude('f', { pid: 600 })], { now: 0 });
  const endings = { a: 'prompt_input_exit', b: 'fired', d: 'other', e: 'closed', f: 'resume' };
  recovery.update([claude('c2', { pid: 300 })], { now: GRACE_MS, ended: entry => endings[entry.nativeId] });
  assert.deepEqual(recovery.lost(GRACE_MS).map(entry => entry.id), ['claude:d']);
});

test('a session that never got a prompt has nothing to lose', () => {
  const path = file();
  writeFileSync(path, JSON.stringify([{ id: 'claude:old', nativeId: 'old', provider: 'claude', title: '', cwd: '/work/app', prompt: '', reply: '', seenAt: 0, lostAt: 1 }]));
  const recovery = new Recovery(path);
  recovery.update([claude('a', { messages: [] }), codex('t', { messages: [] })], { now: 0 });
  recovery.update([], { now: GRACE_MS });
  assert.deepEqual(recovery.lost(GRACE_MS), []);
});

test('subagents and offline-only sessions are not tracked', () => {
  const recovery = new Recovery(null);
  recovery.update([claude('a', { parentId: 'claude:x' }), codex('t', { status: 'offline' })], { now: 0 });
  recovery.update([], { now: GRACE_MS });
  assert.deepEqual(recovery.lost(GRACE_MS), []);
});

test('codex threads closing while the app server stays up are closed; going down with it, lost', () => {
  const recovery = new Recovery(null);
  recovery.update([codex('t1'), codex('t2')], { now: 0 });
  recovery.update([codex('t2')], { now: 4000 });
  recovery.update([codex('t2', { status: 'offline' })], { now: 8000 });
  recovery.update([], { now: 8000 + GRACE_MS });
  assert.deepEqual(recovery.lost(8000 + GRACE_MS).map(entry => entry.id), ['codex:t2']);
});

test('a restart offers whoever was live before and has not come back', () => {
  const path = file();
  const before = new Recovery(path);
  before.update([claude('a'), claude('b', { pid: 200 }), codex('t')], { now: 0 });
  const after = new Recovery(path);
  after.update([claude('b', { pid: 201 })], { now: 100_000 });
  assert.deepEqual(after.lost(100_000), []);
  after.update([claude('b', { pid: 201 })], { now: 100_000 + GRACE_MS });
  assert.deepEqual(after.lost(100_000 + GRACE_MS).map(entry => entry.id).sort(), ['claude:a', 'codex:t']);
  // Lost stays lost across another restart.
  const again = new Recovery(path);
  assert.deepEqual(again.lost(200_000).map(entry => entry.id).sort(), ['claude:a', 'codex:t']);
});

test('resuming hides a session until it is live again or the resume has had its time', () => {
  const recovery = new Recovery(null);
  recovery.update([claude('a')], { now: 0 });
  recovery.update([], { now: GRACE_MS });
  assert.ok(recovery.get('claude:a', GRACE_MS));
  recovery.resumed('claude:a', GRACE_MS);
  assert.equal(recovery.get('claude:a', GRACE_MS + 1), null);
  assert.equal(recovery.lost(GRACE_MS + 1)[0].resuming, true);
  assert.ok(recovery.get('claude:a', GRACE_MS + RESUME_MS));
  recovery.update([claude('a', { status: 'idle' })], { now: GRACE_MS + 10_000 });
  assert.deepEqual(recovery.lost(GRACE_MS + 10_000), []);
});

test('dismissed and old lost sessions are forgotten', () => {
  const path = file(), recovery = new Recovery(path);
  recovery.update([claude('a'), claude('b', { pid: 200 })], { now: 0 });
  recovery.update([], { now: GRACE_MS });
  recovery.dismiss(['claude:a'], GRACE_MS);
  assert.deepEqual(recovery.lost(GRACE_MS).map(entry => entry.id), ['claude:b']);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')).map(entry => entry.id), ['claude:b']);
  recovery.update([], { now: KEEP_MS + 1 });
  assert.deepEqual(recovery.lost(KEEP_MS + 1), []);
});

test('resume arguments keep the session and its permission mode, and nothing else', () => {
  assert.deepEqual(resumeArgs({ provider: 'claude', nativeId: 'abc-123', mode: 'auto' }), ['--resume', 'abc-123', '--permission-mode', 'auto']);
  assert.deepEqual(resumeArgs({ provider: 'claude', nativeId: 'abc-123', mode: 'default' }), ['--resume', 'abc-123']);
  assert.deepEqual(resumeArgs({ provider: 'codex', nativeId: 'abc-123' }), ['resume', 'abc-123']);
  assert.throws(() => resumeArgs({ provider: 'claude', nativeId: 'x; rm -rf ~' }));
});
