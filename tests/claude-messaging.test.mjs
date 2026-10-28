import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeMessaging, spawnAgent } from '../server/claude-messaging.mjs';
import { ClaudeAdapter } from '../server/claude.mjs';
import { RequestStore } from '../server/requests.mjs';

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
  const path = join(dir, `${record.pid}.json`);
  await writeFile(path, JSON.stringify({ ...record, cwd: '/work/project', name: 'project-01', status: 'idle' }));
  const calls = [], store = new RequestStore();
  const adapter = new ClaudeAdapter(store, '/unused.sock', { sessionsDir: dir, alive: async () => true, messaging: { available: async () => true, send: async (...args) => { calls.push(args); return { status: 'submitted' }; }, stop() {} } });
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
function tmuxFixture({ lostEnters = 0, ...options } = {}) {
  const calls = [];
  let input = '';
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
  for (const status of [{ status: 'waiting' }, { status: 'shell' }, { status: 'busy', waitingFor: 'permission' }]) await assert.rejects(adapter.send({ ...paneRecord, ...status }, body), e => e.status === 409);
  assert.equal(calls.length, 0);
  const moved = tmuxFixture({ parent: async () => 1 });
  assert.equal((await moved.adapter.send(paneRecord, body)).status, 'submitted');
  assert.equal(moved.calls.length, 1);
  assert.equal(moved.frames.length, 1);
});

test('a failed Enter after pasting is unconfirmed and never retyped', async () => {
  const { adapter, calls } = tmuxFixture({ tmux: async args => { if (args[0] !== 'capture-pane') calls.push(args); if (args[0] === 'send-keys') throw new Error('gone'); return args[0] === 'display-message' ? '100' : ''; } });
  await assert.rejects(adapter.send(paneRecord, body), e => e.status === 504);
  await assert.rejects(adapter.send(paneRecord, body), e => e.status === 504);
  assert.equal(calls.filter(args => args[0] === 'paste-buffer').length, 1);
});

test('new agents open in the tmux session working in the project, never the server’s own', async () => {
  const run = panes => { const calls = []; return { calls, tmux: async args => { calls.push(args); return args[0] === 'list-panes' ? panes : '%42\n'; } }; };
  const shared = run('aiControl\t/w/aiControl\nwork\t/w/app\nwork\t/w/aiControl\n');
  assert.deepEqual(await spawnAgent('/w/aiControl', 'claude', shared.tmux), { session: 'work', pane: '%42', window: '%42' });
  assert.deepEqual(shared.calls.slice(1, 3), [['new-window', '-t', '=work:', '-d', '-c', '/w/aiControl', '-n', 'claude', '-P', '-F', '#{pane_id}'], ['send-keys', '-t', '%42', 'claude', 'Enter']]);
  const fresh = run('aiControl\t/w/aiControl\n');
  assert.equal((await spawnAgent('/w/aiControl', 'codex', fresh.tmux)).session, 'aiControl-agents');
  assert.equal(fresh.calls[1][0], 'new-session');
  assert.deepEqual(fresh.calls[2].slice(3), ['codex -c check_for_update_on_startup=false', 'Enter']);
  assert.equal((await spawnAgent('/w/my.app', 'codex', run('').tmux)).session, 'my_app');
  await assert.rejects(spawnAgent('/w/app', 'sh', run('').tmux), /Unknown agent/);
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
