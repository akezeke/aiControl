import { fail } from './requests.mjs';

// Archive shuts down just this thread tree, preserving resumable history. Never signal the shared daemon.
export async function fireCodex(adapter, threadId) {
  adapter.requireMessaging(threadId);
  const threads = [], locked = [];
  try {
    let cursor;
    do {
      const page = await adapter.rpc('thread/loaded/list', { limit: 100, ...(cursor ? { cursor } : {}) });
      for (let i = 0; i < page.data.length; i += 8) threads.push(...await Promise.all(page.data.slice(i, i + 8).map(async id => (await adapter.rpc('thread/read', { threadId: id, includeTurns: false })).thread)));
      cursor = page.nextCursor;
    } while (cursor);
    const root = threads.find(thread => thread.id === threadId);
    if (!root || root.parentThreadId) throw fail('Fire the main session instead.', 409);
    const ids = new Set([threadId]);
    for (let previous = 0; previous !== ids.size;) {
      previous = ids.size;
      for (const thread of threads) if (ids.has(thread.parentThreadId)) ids.add(thread.id);
    }
    for (const id of ids) {
      if (adapter.sendingMessages.has(id) || adapter.startingQueue.has(id)) throw fail('A message is being sent. Wait for it to finish.', 409);
      adapter.sendingMessages.add(id); locked.push(id);
    }
    const quiet = thread => {
      if (thread.status?.type !== 'idle' || adapter.store.list().some(request => request.sessionId === `codex:${thread.id}`)) throw fail('This session or a subagent is still working.', 409);
      // Read/resume can update thread recency even while idle; observe the local status instead.
      if (Date.now() - (adapter.sessions.get(thread.id)?.idleSince ?? thread.updatedAt * 1000) < 5000) throw fail('This session just finished. Wait a few seconds.', 409);
      if (adapter.sessions.get(thread.id)?.goal?.status === 'active') throw fail('A goal is still active. Finish it before firing this session.', 409);
    };
    for (const thread of threads.filter(thread => ids.has(thread.id))) {
      quiet(thread);
      // Fail closed on older servers that cannot report queues or background commands.
      const queue = await adapter.rpc('thread/queue/list', { threadId: thread.id, limit: 1 });
      if (!Array.isArray(queue.data) || queue.data.length || queue.nextCursor) throw fail('Clear queued messages before firing this session.', 409);
      const terminals = await adapter.rpc('thread/backgroundTerminals/list', { threadId: thread.id, limit: 1 });
      if (!Array.isArray(terminals.data) || terminals.data.length || terminals.nextCursor) throw fail('A background command is still running. Stop it first.', 409);
    }
    for (const id of ids) quiet((await adapter.rpc('thread/read', { threadId: id, includeTurns: false })).thread);
    await adapter.rpc('thread/archive', { threadId });
    for (const id of ids) adapter.forgetArchived(id);
    return { ok: true, archived: true };
  } finally { for (const id of locked) adapter.sendingMessages.delete(id); }
}
