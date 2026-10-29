import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeMessaging, spawnAgent, updateCodex } from '../server/claude-messaging.mjs';
import { ClaudeAdapter } from '../server/claude.mjs';
import { RequestStore, slashCommand } from '../server/requests.mjs';

const record = { pid: 123, procStart: '456', sessionId: '11111111-2222-3333-4444-555555555555', peerProtocol: 1, messagingSocketPath: '/run/user/1000/cc-socks/123.sock' };
const body = { text: 'Continue with **this**.\nKeep the settings.', mode: 'send', clientMessageId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' };

function fixture(options = {}) {
  const frames = [], sockets = [];
  class Socket extends EventEmitter {
    end(frame, callback) { frames.push(frame); queueMicrotask(callback); }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } }
  }
  const adapter = new ClaudeMessaging({
    uid: 1000, timeoutMs: 25, alive: async () => true, canonical: async path => path,
    stat: async path => ({ uid: 1000, mode: path.endsWith('.sock') ? 0o600 : 0o700, isSocket: () => path.endsWith('.sock'), isDirectory: () => !path.endsWith('.sock') }),
    openSocket() { const socket = new Socket(); sockets.push(socket); queueMicrotask(() => socket.emit('connect')); return socket; },
    ...options,
  });
  return { adapter, frames, sockets };
}

test('Claude inbox gets a session-targeted user frame without permission or command overrides', async () => {
  const { adapter, frames } = fixture();
  const result = await adapter.send(record, body);
  assert.equal(result.status, 'submitted');
  assert.equal(frames.length, 1);
  assert.ok(frames[0].endsWith('\n'));
  assert.deepEqual(JSON.parse(frames[0]), {
    type: 'user', session_id: record.sessionId, uuid: body.clientMessageId, msgV: 1,
    msg_id: `cc-msg-${body.clientMessageId.replaceAll('-', '')}`, priority: 'next',
    message: { role: 'user', content: body.text },
  });
  assert.equal(adapter.sockets.size, 0);
});

test('double clicks share a submission, but reusing its ID with other text is rejected', async () => {
  const { adapter, frames } = fixture();
  const results = await Promise.all([adapter.send(record, body), adapter.send(record, body)]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(frames.length, 1);
  await assert.rejects(adapter.send(record, { ...body, text: 'Other' }), e => e.status === 409);
});

test('slash commands that a path would only look like are told apart, and the inbox refuses real ones', async () => {
  assert.deepEqual(['/clear', ' /model gpt-x', '/compact\n', '/home/me/app is broken', 'fix /clear later', '/'].map(slashCommand), ['/clear', '/model', '/compact', '', '', '']);
  const { adapter, frames } = fixture();
  await assert.rejects(adapter.send(record, { ...body, text: '/clear' }), e => e.status === 409 && /terminal/.test(e.message));
  assert.equal(frames.length, 0);
  assert.equal((await adapter.send(record, { ...body, text: '/home/me/app is broken' })).status, 'submitted');
});

test('Claude rejects unsafe inbox paths, wrong owners, open permissions and stale processes', async () => {
  const { adapter, frames } = fixture();
  for (const path of ['/tmp/other/123.sock', '/run/user/1000/cc-socks/other.sock', '/run/user/1000/cc-socks/../123.sock']) assert.equal(await adapter.available({ ...record, messagingSocketPath: path }), '');
  assert.equal(await adapter.available({ ...record, peerProtocol: 2 }), '');
  assert.equal(await adapter.available({ ...record, procStart: undefined }), '');
  assert.equal(await fixture({ canonical: async () => '/tmp/elsewhere.sock' }).adapter.available(record), '');
  assert.equal(await fixture({ stat: async () => ({ uid: 999, mode: 0o600, isSocket: () => true, isDirectory: () => true }) }).adapter.available(record), '');
  assert.equal(await fixture({ stat: async () => ({ uid: 1000, mode: 0o777, isSocket: () => true, isDirectory: () => true }) }).adapter.available(record), '');
  await assert.rejects(fixture({ alive: async () => false }).adapter.send(record, body), e => e.status === 409);
  assert.equal(frames.length, 0);
});

test('a process that exits while connecting cannot receive the message', async () => {
  let checks = 0;
  const { adapter, frames } = fixture({ alive: async () => ++checks === 1 });
  await assert.rejects(adapter.send(record, body), e => e.status === 503);
  assert.equal(frames.length, 0);
});

test('delivery failures after writing remain unconfirmed and cannot be automatically replayed', async () => {
  let writes = 0;
  const { adapter } = fixture({ openSocket() {
    const socket = new EventEmitter();
    socket.destroy = () => socket.emit('close');
    socket.end = () => { writes++; queueMicrotask(() => socket.emit('error', new Error('lost'))); };
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  } });
  await assert.rejects(adapter.send(record, body), e => e.status === 504 && /unconfirmed/.test(e.message));
  await assert.rejects(adapter.send(record, body), e => e.status === 504);
  assert.equal(writes, 1);
});

test('connection failures before writing can retry, and a silent socket times out', async () => {
  let attempts = 0;
  const { adapter } = fixture({ openSocket() { attempts++; throw new Error('refused'); } });
  await assert.rejects(adapter.send(record, body), e => e.status === 503);
  await assert.rejects(adapter.send(record, body), e => e.status === 503);
  assert.equal(attempts, 2);
  const silent = fixture({ openSocket() { const socket = new EventEmitter(); socket.destroy = () => socket.emit('close'); return socket; } });
  await assert.rejects(silent.adapter.send(record, body), e => e.status === 503);
  assert.equal(silent.adapter.sockets.size, 0);
});

test('shutdown cancels pending connections and invalid bodies never open a socket', async () => {
  const silent = fixture({ openSocket() { const socket = new EventEmitter(); socket.destroy = () => socket.emit('close'); return socket; } });
  const pending = silent.adapter.send(record, body);
  await new Promise(resolve => setImmediate(resolve));
  silent.adapter.stop();
  await assert.rejects(pending, e => e.status === 503);
  const { adapter, sockets } = fixture();
  for (const invalid of [{ ...body, text: '' }, { ...body, text: 'x'.repeat(12001) }, { ...body, mode: 'queue' }, { ...body, clientMessageId: 'bad' }]) await assert.rejects(adapter.send(record, invalid), e => e.status === 400);
  assert.equal(sockets.length, 0);
});

test('Claude adapter checks the live registration and leaves waiting permissions untouched', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'aicontrol-claude-send-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'sessions'));
  const path = join(dir, 'sessions', `${record.pid}.json`);
  await writeFile(path, JSON.stringify({ ...record, cwd: '/work/project', name: 'project-01', status: 'idle' }));
  const calls = [], store = new RequestStore();
  const adapter = new ClaudeAdapter(store, '/unused.sock', { sessionsDir: join(dir, 'sessions'), alive: async () => true, messaging: { available: async () => true, send: async (...args) => { calls.push(args); return { status: 'submitted' }; }, stop() {} } });
  await adapter.refresh();
  assert.equal(adapter.list()[0].messaging.send, true);
  assert.equal(await adapter.sendMessage(record.sessionId, body).then(r => r.status), 'submitted');
  const requestId = store.add({ sessionId: `claude:${record.sessionId}`, provider: 'claude', kind: 'permission', actions: [{ value: 'accept' }] }, () => {}, 'pending');
  await assert.rejects(adapter.sendMessage(record.sessionId, body), e => e.status === 409);
  assert.equal(store.list()[0].id, requestId);
  store.removeSource('pending');
  await writeFile(path, JSON.stringify({ ...record, sessionId: 'other-session' }));
  await assert.rejects(adapter.sendMessage(record.sessionId, body), e => e.status === 409);
  assert.equal(calls.length, 1);
  assert.ok(adapter.transcripts.visibleIds.get(record.sessionId).has(body.clientMessageId));
});

const paneRecord = { ...record, status: 'idle', tmux: 'work:@2.%7' };
// A fake pane: the paste lands in Claude's input line, and each Enter submits it unless `lostEnters` swallow it.
function tmuxFixture({ lostEnters = 0, typed = '', ...options } = {}) {
  const calls = [];
  let input = typed;
  const tmux = async (args, stdin) => {
    if (args[0] !== 'capture-pane') calls.push(stdin === undefined ? args : [...args, stdin]);
    if (args[0] === 'display-message') return '100\n';
    if (args[0] === 'load-buffer') input = stdin;
    if (args[0] === 'send-keys' && lostEnters-- <= 0) input = '';
    if (args[0] === 'capture-pane') return `history\n────\n❯ ${input.replace(/\n/g, ' ')}\n────\n  ⏵⏵ auto mode on`;
    return '';
  };
  return { calls, ...fixture({ tmux, parent: async pid => pid === 123 ? 100 : 1, pollMs: 1, settleMs: 40, ...options }) };
}

test('tmux sessions get the message typed as the user, as one bracketed paste and Enter', async () => {
  const { adapter, calls, frames } = tmuxFixture();
  assert.equal(await adapter.available(paneRecord), 'tmux');
  const result = await adapter.send(paneRecord, { ...body, text: 'Line one\r\nLine two\x1b[201~' });
  assert.equal(result.status, 'sent');
  const buffer = `ai-control-${body.clientMessageId}`;
  assert.deepEqual(calls, [
    ['display-message', '-p', '-t', '%7', '#{pane_pid}'],
    ['copy-mode', '-q', '-t', '%7'],
    ['load-buffer', '-b', buffer, '-', 'Line one\nLine two[201~'],
    ['paste-buffer', '-d', '-p', '-r', '-b', buffer, '-t', '%7'],
    ['send-keys', '-t', '%7', 'Enter'],
  ]);
  assert.equal(frames.length, 0);
});

test('an Enter that a slow session misses is pressed again only while the text is still in the input', async () => {
  const retried = tmuxFixture({ lostEnters: 1 });
  assert.equal((await retried.adapter.send(paneRecord, body)).status, 'sent');
  assert.equal(retried.calls.filter(args => args[0] === 'send-keys').length, 2);
  const stuck = tmuxFixture({ lostEnters: 99 });
  await assert.rejects(stuck.adapter.send(paneRecord, body), e => e.status === 504 && /not submitted/.test(e.message));
  assert.equal(stuck.calls.filter(args => args[0] === 'send-keys').length, 3);
  assert.equal(stuck.calls.filter(args => args[0] === 'paste-buffer').length, 1);
});

test('tmux typing refuses open dialogs and falls back to the inbox when the pane moved', async () => {
  const { adapter, calls } = tmuxFixture();
  for (const status of [{ status: 'waiting' }, { status: 'busy', waitingFor: 'permission' }]) await assert.rejects(adapter.send({ ...paneRecord, ...status }, body), e => e.status === 409);
  assert.equal(calls.length, 0);
  const moved = tmuxFixture({ parent: async () => 1 });
  assert.equal((await moved.adapter.send(paneRecord, body)).status, 'submitted');
  assert.equal(moved.calls.length, 1);
  assert.equal(moved.frames.length, 1);
});

test('an unknown status such as shell types only while Claude’s prompt box shows, not the agent picker below it', async () => {
  // The first Enter is lost: the text is still in the prompt, so it must be pressed again.
  const picker = tmuxFixture({ lostEnters: 1 });
  const tmux = picker.adapter.tmux;
  picker.adapter.tmux = async (args, stdin) => { const out = await tmux(args, stdin); return args[0] === 'capture-pane' ? `${out}\n  ↑/↓ to select\n❯ ● main\n  ◯ general-purpose` : out; };
  assert.equal((await picker.adapter.send({ ...paneRecord, status: 'shell' }, body)).status, 'sent');
  assert.equal(picker.calls.filter(args => args[0] === 'send-keys').length, 2);
  const dialog = tmuxFixture({ tmux: async args => args[0] === 'display-message' ? '100\n' : args[0] === 'capture-pane' ? 'Allow Bash?\n❯ 1. Yes\n  2. No' : '' });
  await assert.rejects(dialog.adapter.send({ ...paneRecord, status: 'shell' }, body), e => e.status === 409);
});

test('a failed Enter after pasting is unconfirmed and never retyped', async () => {
  const { adapter, calls } = tmuxFixture({ tmux: async args => { if (args[0] !== 'capture-pane') calls.push(args); if (args[0] === 'send-keys') throw new Error('gone'); return args[0] === 'display-message' ? '100' : ''; } });
  await assert.rejects(adapter.send(paneRecord, body), e => e.status === 504);
  await assert.rejects(adapter.send(paneRecord, body), e => e.status === 504);
  assert.equal(calls.filter(args => args[0] === 'paste-buffer').length, 1);
});

test('a new Codex takes its update prompt’s Update now and starts again; a started Codex or a trust question is left alone', async () => {
  const run = screens => {
    const calls = []; let at = 0;
    return { calls, tmux: async args => { if (args[0] === 'capture-pane') return screens[at]; calls.push(args.slice(3)); at++; return ''; } };
  };
  const update = run(['Update available · 0.164.0 → 0.165.0\n› 1. Update now (runs `npm install -g @openai/codex`)\n  2. Skip', 'Updating Codex…\n🎉 Update ran successfully! Please restart Codex.\n$ ', '› Ask Codex to do anything']);
  assert.equal(await updateCodex('%9', { tmux: update.tmux, pollMs: 1 }), true);
  assert.deepEqual(update.calls, [['Enter'], ['codex', 'Enter']]);
  for (const screen of ['› Ask Codex to do anything', '› 1. Trust and continue\n  2. Quit', 'Update available\n  1. Update now\n› 2. Skip']) {
    const other = run([screen]);
    assert.equal(await updateCodex('%9', { tmux: other.tmux, pollMs: 1, startMs: 20 }), false);
    assert.deepEqual(other.calls, []);
  }
});

test('new agents open in the tmux session working in the project, never the server’s own', async () => {
  const run = panes => { const calls = []; return { calls, tmux: async args => { calls.push(args); return args[0] === 'list-panes' ? panes : '%42\n'; } }; };
  const shared = run('aiControl\t/w/aiControl\nwork\t/w/app\nwork\t/w/aiControl\n');
  assert.deepEqual(await spawnAgent('/w/aiControl', 'claude', { tmux: shared.tmux }), { session: 'work', pane: '%42', window: '%42' });
  assert.deepEqual(shared.calls.slice(1, 3), [['new-window', '-t', '=work:', '-d', '-c', '/w/aiControl', '-n', 'claude', '-P', '-F', '#{pane_id}'], ['send-keys', '-t', '%42', 'claude', 'Enter']]);
  const fresh = run('aiControl\t/w/aiControl\n');
  assert.equal((await spawnAgent('/w/aiControl', 'codex', { tmux: fresh.tmux, update: async () => {} })).session, 'aiControl-agents');
  assert.equal(fresh.calls[1][0], 'new-session');
  assert.deepEqual(fresh.calls[2].slice(3), ['codex', 'Enter']);
  assert.equal((await spawnAgent('/w/my.app', 'codex', { tmux: run('').tmux, update: async () => {} })).session, 'my_app');
  await assert.rejects(spawnAgent('/w/app', 'sh', { tmux: run('').tmux }), /Unknown agent/);
  const personal = run('');
  await spawnAgent('/w/app', 'claude', { tmux: personal.tmux, configDir: "/home/u/.claude-it's" });
  assert.deepEqual(personal.calls[2].slice(3), ["CLAUDE_CONFIG_DIR='/home/u/.claude-it'\\''s' claude", 'Enter']);
});

test('Stop sends Escape only to a busy, verified pane; effort is typed as /effort', async () => {
  const idle = tmuxFixture();
  await assert.rejects(idle.adapter.interrupt(paneRecord), /not working/);
  assert.equal(idle.calls.some(args => args.includes('Escape')), false);
  const busy = tmuxFixture();
  await busy.adapter.interrupt({ ...paneRecord, status: 'busy' });
  assert.deepEqual(busy.calls.at(-1), ['send-keys', '-t', '%7', 'Escape']);
  await assert.rejects(busy.adapter.interrupt({ ...paneRecord, status: 'busy', waitingFor: 'permission' }), /waiting on a prompt/);
  const effort = tmuxFixture();
  await effort.adapter.setEffort(paneRecord, 'high');
  assert.equal(effort.calls.find(args => args[0] === 'load-buffer').at(-1), '/effort high');
  await assert.rejects(effort.adapter.setEffort(paneRecord, 'turbo; rm -rf'), /Unknown effort/);
});

test('the prompt reads empty under Claude’s dim placeholder, and only a prompt between two rules counts', async () => {
  const read = rows => new ClaudeMessaging({ tmux: async args => args[0] === 'capture-pane' ? rows.join('\n') : '' }).inputText('%7');
  // As captured: attributes run on into the next row, and the prompt is followed by a no-break space.
  assert.equal(await read(['> an earlier prompt', '\x1b[38;5;244m────', '\x1b[39m❯\u00a0\x1b[2mTry "write a test"', '\x1b[0m\x1b[38;5;244m────', '\x1b[39m  ⏵⏵ auto mode on']), '');
  assert.equal(await read(['────', '❯\u00a0\x1b[38;5;2mfix the \x1b[1;38;2;2;2;2mtests\x1b[22m', '────']), 'fix the tests');
  assert.equal(await read(['────', '❯ /exit', '────']), '/exit');
  assert.equal(await read(['────', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No']), null);
  assert.equal(await read(['user@host:~$ ']), null);
});

test('only commands Claude’s Bash tool started count as running, named by what they run', async () => {
  const processes = async () => [
    { pid: 123, ppid: 1, args: 'claude' },
    { pid: 200, ppid: 123, args: '/bin/bash -c source /home/u/.claude/shell-snapshots/snapshot-bash-1.sh && eval npm run dev' },
    { pid: 201, ppid: 200, args: 'npm run dev' },
    { pid: 300, ppid: 123, args: 'node mcp-server.js' },
    { pid: 400, ppid: 999, args: '/bin/bash -c source /home/u/.claude/shell-snapshots/snapshot-bash-2.sh && eval sleep 9' },
  ];
  assert.deepEqual(await new ClaudeMessaging({ processes }).commands(123), ['npm run dev']);
});

test('Fire types /exit only into an empty prompt, rechecks before Enter and waits for Claude to go', async () => {
  let calls;
  const fired = tmuxFixture({ alive: async () => !calls.some(args => args.at(-1) === 'Enter') });
  calls = fired.calls;
  assert.deepEqual(await fired.adapter.fire(paneRecord, async () => { calls.push(['recheck']); }), { ok: true });
  assert.deepEqual(calls.map(args => args[0]), ['display-message', 'copy-mode', 'load-buffer', 'paste-buffer', 'recheck', 'send-keys']);
  assert.equal(calls[2].at(-1), '/exit');

  const draft = tmuxFixture({ typed: 'half a thought' });
  await assert.rejects(draft.adapter.fire(paneRecord, async () => {}), /draft/);
  assert.equal(draft.calls.some(args => args[0] === 'paste-buffer'), false);
  await assert.rejects(tmuxFixture().adapter.fire({ ...paneRecord, status: 'busy' }, async () => {}), /working/);

  // Something started meanwhile: /exit is wiped and Enter never pressed.
  const busy = tmuxFixture();
  await assert.rejects(busy.adapter.fire(paneRecord, async () => { throw new Error('busy now'); }), /busy now/);
  assert.deepEqual(busy.calls.filter(args => args[0] === 'send-keys').map(args => args.slice(3)), [Array(5).fill('BSpace')]);

  const stays = tmuxFixture({ exitMs: 20 });
  await assert.rejects(stays.adapter.fire(paneRecord, async () => {}), e => e.status === 504 && /still running/.test(e.message));
});

test('Claude adapter fires only a session that is quiet: idle a while, no subagent, no command running', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'aicontrol-claude-fire-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, `${record.pid}.json`), register = extra => writeFile(path, JSON.stringify({ ...record, cwd: '/work/project', status: 'idle', statusUpdatedAt: Date.now() - 60_000, ...extra }));
  await register();
  let running = [];
  const fired = [];
  const adapter = new ClaudeAdapter(new RequestStore(), '/unused.sock', { sessionsDir: dir, projectsDir: dir, alive: async () => true, messaging: {
    available: async () => 'tmux', commands: async () => running, stop() {},
    fire: async (live, recheck) => { await recheck(); fired.push(live.pid); return { ok: true }; },
  } });
  await adapter.refresh();
  assert.equal(adapter.list()[0].messaging.fire, true);

  running = ['npm run dev'];
  await assert.rejects(adapter.fire(record.sessionId), /npm run dev/);
  running = [];
  await register({ status: 'busy' });
  await assert.rejects(adapter.fire(record.sessionId), /working/);
  await register({ statusUpdatedAt: Date.now() });
  await assert.rejects(adapter.fire(record.sessionId), /just finished/);
  await register();
  adapter.hooks.set(record.sessionId, { status: 'idle', compacting: 'auto', updatedAt: 0 });
  await assert.rejects(adapter.fire(record.sessionId), /working/);
  adapter.hooks.delete(record.sessionId);

  const subagents = join(dir, '-work-project', record.sessionId, 'subagents');
  await mkdir(subagents, { recursive: true });
  await writeFile(join(subagents, 'agent-abc123.jsonl'), '{"type":"user","message":{"role":"user","content":"Look around"}}\n');
  await assert.rejects(adapter.fire(record.sessionId), /subagent/);
  await rm(subagents, { recursive: true });

  assert.deepEqual(await adapter.fire(record.sessionId), { ok: true });
  assert.deepEqual(fired, [record.pid]);
});
