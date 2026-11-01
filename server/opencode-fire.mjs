import { fail } from './requests.mjs';

// V2 archives without deleting history. V1 lacks the inbox/terminal checks used here.
export async function fireOpenCode(adapter, id) {
  const root = adapter.require(id);
  if (!adapter.api.v2) throw fail('Fire requires OpenCode 2.', 409);
  if (root.parentId) throw fail('Fire the main session instead.', 409);
  const rows = await adapter.api.sessions(1000);
  if (rows.length >= 1000) throw fail('Too many sessions to verify every subagent. Archive this session in OpenCode.', 409);
  const ids = new Set([id]);
  for (let previous = 0; previous !== ids.size;) {
    previous = ids.size;
    for (const info of rows) if (ids.has(info.parentID) && !info.time?.archived) ids.add(info.id);
  }
  const locked = [];
  try {
    for (const member of ids) {
      if (adapter.firing.has(member) || adapter.sending.has(member)) throw fail('Another action is in progress. Wait for it to finish.', 409);
      adapter.firing.add(member); locked.push(member);
    }
    const quiet = async () => {
      const active = await adapter.api.status();
      for (const member of ids) {
        if (active[member] || adapter.store.list().some(request => request.sessionId === `opencode:${member}`)) throw fail('This session or a subagent is still working.', 409);
        const info = await adapter.api.session(member);
        if (adapter.now() - (info.time?.updated || 0) < 5000) throw fail('This session just finished. Wait a few seconds.', 409);
        const [queue, terminals, permissions, questions] = await Promise.all([adapter.api.inbox(member), adapter.api.terminals(member), adapter.api.requests('permission', info.directory), adapter.api.requests('question', info.directory)]);
        if (queue.length) throw fail('Clear queued messages before firing this session.', 409);
        if (terminals.some(terminal => terminal.status !== 'exited')) throw fail('A background terminal is still running. Stop it first.', 409);
        if ([...permissions, ...questions].some(request => request.sessionID === member)) throw fail('This session is waiting for an answer.', 409);
      }
    };
    await quiet();
    const active = await adapter.api.status();
    if ([...ids].some(member => active[member])) throw fail('This session or a subagent started working. Stop it first.', 409);
    let archived = 0;
    try {
      // Children first; the parent's archive event does not archive its descendants.
      for (const member of [...ids].reverse()) {
        await adapter.api.archive(member); archived++;
        adapter.archived.add(member); adapter.sessions.delete(member); adapter.chosenSettings.delete(member); adapter.store.removeSession(`opencode:${member}`);
      }
    } catch (error) {
      if (archived) throw fail('Some subagents were archived, but the session could not finish archiving. Refresh and try again.', 502);
      throw error;
    }
    return { ok: true, archived: true };
  } finally { for (const member of locked) adapter.firing.delete(member); }
}
