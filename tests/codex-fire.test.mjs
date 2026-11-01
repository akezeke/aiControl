import test from 'node:test';
import assert from 'node:assert/strict';
import { fireCodex } from '../server/codex-fire.mjs';

function fixture() {
  const threads = ['root', 'child', 'other'].map(id => ({ id, parentThreadId: id === 'child' ? 'root' : null, status: { type: 'idle' }, updatedAt: (Date.now() - 10000) / 1000 }));
  const calls = [], forgotten = [], adapter = { sessions: new Map(), sendingMessages: new Set(), startingQueue: new Set(), store: { list: () => [] }, requireMessaging: () => {}, forgetArchived: id => forgotten.push(id), rpc: async (method, params) => {
    calls.push({ method, params });
    if (method === 'thread/loaded/list') return { data: threads.map(thread => thread.id) };
    if (method === 'thread/read') return { thread: threads.find(thread => thread.id === params.threadId) };
    if (method === 'thread/queue/list') return { data: adapter.queue || [] };
    if (method === 'thread/backgroundTerminals/list') { if (adapter.failTerminals) throw new Error('Unsupported'); return { data: adapter.terminals || [] }; }
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
