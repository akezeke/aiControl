import test from 'node:test';
import assert from 'node:assert/strict';
import { fireCodex } from '../server/codex-fire.mjs';
import { CodexAdapter } from '../server/codex.mjs';
import { RequestStore } from '../server/requests.mjs';

function fixture() {
  const threads = ['root', 'child', 'other'].map(id => ({ id, parentThreadId: id === 'child' ? 'root' : null, status: { type: 'idle' }, updatedAt: (Date.now() - 10000) / 1000 }));
  const calls = [], forgotten = [], adapter = { sessions: new Map(), sendingMessages: new Set(), startingQueue: new Set(), store: { list: () => [] }, requireMessaging: () => {}, forgetArchived: id => forgotten.push(id), rpc: async (method, params) => {
    calls.push({ method, params });
    if (method === 'thread/loaded/list') return { data: threads.map(thread => thread.id) };
    if (method === 'thread/read') return { thread: threads.find(thread => thread.id === params.threadId) };
    if (method === 'thread/queue/list') return { data: adapter.queue || [] };
    if (method === 'thread/backgroundTerminals/list') { if (adapter.failTerminals) throw new Error('Unsupported'); return adapter.terminalResponse || { data: adapter.terminals || [] }; }
    if (method === 'thread/archive') { if (adapter.failArchive) throw new Error('Archive failed'); return {}; }
    throw new Error(method);
  } };
  return { adapter, calls, forgotten, threads };
}
test('Codex fire archives only the selected tree and preserves other agents', async () => {
  const { adapter, calls, forgotten } = fixture();
  assert.deepEqual(await fireCodex(adapter, 'root'), { ok: true, archived: true });
  assert.deepEqual(calls.filter(call => call.method === 'thread/archive'), [{ method: 'thread/archive', params: { threadId: 'root' } }]);
  assert.deepEqual(forgotten, ['root', 'child']); assert.equal(adapter.sendingMessages.size, 0);
});

const terminal = { itemId: 'old-demo', processId: '5904', command: 'node scripts/demo.mjs --calm', cwd: '/work/project', osPid: null, cpuPercent: null, rssKb: null };

test('a reported Codex background command offers the existing force-close confirmation', async () => {
  for (const options of [undefined, {}, { force: false }, { force: 'true' }]) {
    const { adapter, calls, forgotten } = fixture(); adapter.terminals = [terminal];
    await assert.rejects(fireCodex(adapter, 'root', options), { status: 409, code: 'force_available' });
    assert.equal(calls.some(call => call.method === 'thread/archive'), false);
    assert.deepEqual(forgotten, []); assert.equal(adapter.sendingMessages.size, 0);
  }
});

test('Codex adapter force-closes an idle tree with reported terminals without signalling shared processes', async () => {
  const { adapter, calls, forgotten } = fixture(); adapter.terminals = [terminal];
  const codex = Object.assign(new CodexAdapter(new RequestStore()), adapter);
  assert.deepEqual(await codex.fire('root', { force: true }), { ok: true, archived: true });
  assert.deepEqual(calls.filter(call => call.method === 'thread/archive'), [{ method: 'thread/archive', params: { threadId: 'root' } }]);
  assert.deepEqual(forgotten, ['root', 'child']); assert.equal(adapter.sendingMessages.size, 0);
  assert.deepEqual(calls.filter(call => call.method === 'thread/backgroundTerminals/list').map(call => call.params.threadId), ['root', 'child']);
});

test('force only bypasses reported commands; active work, queues and unavailable checks still block Codex Fire', async () => {
  for (const problem of ['child', 'approval', 'fresh', 'queue', 'failTerminals', 'malformedTerminals', 'sending', 'goal', 'becameBusy', 'failArchive']) {
    const { adapter, calls, forgotten, threads } = fixture(); adapter.terminals = [terminal];
    if (problem === 'child') threads[1].status.type = 'active';
    if (problem === 'approval') adapter.store.list = () => [{ sessionId: 'codex:child' }];
    if (problem === 'fresh') threads[0].updatedAt = Date.now() / 1000;
    if (problem === 'queue') adapter.queue = [{}];
    if (problem === 'failTerminals') adapter.failTerminals = true;
    if (problem === 'malformedTerminals') adapter.terminalResponse = {};
    if (problem === 'sending') adapter.sendingMessages.add('root');
    if (problem === 'goal') adapter.sessions.set('root', { goal: { status: 'active' } });
    if (problem === 'failArchive') adapter.failArchive = true;
    if (problem === 'becameBusy') {
      const rpc = adapter.rpc; let reads = 0;
      adapter.rpc = async (method, params) => {
        if (method === 'thread/read' && params.threadId === 'root' && ++reads === 2) threads[0].status.type = 'active';
        return rpc(method, params);
      };
    }
    await assert.rejects(fireCodex(adapter, 'root', { force: true }), error => error.code !== 'force_available', problem);
    assert.deepEqual(forgotten, []); assert.equal(calls.some(call => call.method === 'thread/archive'), problem === 'failArchive');
    assert.equal(adapter.sendingMessages.size, problem === 'sending' ? 1 : 0);
  }
});
test('Codex fire refuses busy children, fresh activity, queued work, running commands and failed safety checks', async () => {
  for (const problem of ['child', 'fresh', 'queue', 'terminals', 'failTerminals', 'sending', 'goal', 'failArchive']) {
    const { adapter, calls, forgotten, threads } = fixture();
    if (problem === 'child') threads[1].status.type = 'active';
    if (problem === 'fresh') threads[0].updatedAt = Date.now() / 1000;
    if (problem === 'queue') adapter.queue = [{}];
    if (problem === 'terminals') adapter.terminals = [{}];
    if (problem === 'failTerminals') adapter.failTerminals = true;
    if (problem === 'failArchive') adapter.failArchive = true;
    if (problem === 'sending') adapter.sendingMessages.add('root');
    if (problem === 'goal') adapter.sessions.set('root', { goal: { status: 'active' } });
    await assert.rejects(fireCodex(adapter, 'root'), undefined, problem);
    assert.deepEqual(forgotten, []); assert.equal(calls.some(call => call.method === 'thread/archive'), problem === 'failArchive');
    assert.equal(adapter.sendingMessages.size, problem === 'sending' ? 1 : 0);
  }
});
