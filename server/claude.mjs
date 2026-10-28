import { createServer } from 'node:net';
import { readFile, readdir, chmod, unlink, lstat, stat, open } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fail } from './requests.mjs';
import { TranscriptReader, claudeSessionTitle } from './messages.mjs';
import { ClaudeMessaging, claudeEfforts } from './claude-messaging.mjs';

// Must match the PermissionRequest hook timeout in scripts/install-hooks.mjs.
export const hookTimeoutMs = 24 * 3600_000;

export async function processMatches(pid, start) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return fields[0] !== 'Z' && (!start || fields[19] === String(start));
  } catch { return false; }
}

// Claude's own "don't ask again" option: one button applying every suggested permission update.
function suggestionLabel(suggestions) {
  const first = suggestions[0];
  if (first.type === 'setMode') return { acceptEdits: 'Allow, auto-accept edits', bypassPermissions: 'Allow, skip all prompts', default: 'Allow, ask each time', plan: 'Allow, keep planning' }[first.mode] || `Allow, ${first.mode} mode`;
  if (first.type === 'addDirectories') return 'Always allow this folder';
  const rules = suggestions.flatMap(update => update.rules ?? []).map(rule => rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName);
  return rules.length ? `Always allow ${rules.join(', ')}` : 'Always allow';
}
// PermissionRequest hooks run alongside Claude's own dialog and the first answer
// wins, so the terminal stays usable while a request waits here. Questions are
// answered the same way, with the answers added to the tool input.
export function claudeRequest(event) {
  if (event.hook_event_name !== 'PermissionRequest') return null;
  const input = event.tool_input ?? {};
  const base = { provider: 'claude', sessionId: `claude:${event.session_id}`, title: event.tool_name || 'Permission requested', kind: 'permission', details: JSON.stringify(input, null, 2) };
  const suggestions = Array.isArray(event.permission_suggestions) ? event.permission_suggestions.filter(update => update && typeof update.type === 'string') : [];
  const reply = decision => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });
  if (event.tool_name === 'AskUserQuestion') return {
    view: { ...base, kind: 'question', title: 'A question for you', questions: (input.questions ?? []).map((q, i) => ({ ...q, id: String(i), allowOther: true })) },
    encode: answer => reply({ behavior: 'allow', updatedInput: { ...input, answers: Object.fromEntries(input.questions.map((q, i) => [q.question, answer.answers[String(i)].join(', ')])) } }),
  };
  const plan = event.tool_name === 'ExitPlanMode' && typeof input.plan === 'string' ? input.plan.slice(0, 50_000) : undefined;
  const always = suggestions.length ? [{ value: 'always', label: suggestionLabel(suggestions).slice(0, 80) }] : [];
  return {
    view: { ...base, title: plan ? 'Approve this plan?' : `Allow ${event.tool_name}?`, ...(plan ? { plan, details: '' } : {}), denyMessage: true, actions: [{ value: 'accept', label: plan ? 'Approve' : 'Allow once' }, ...always, { value: 'decline', label: plan ? 'Keep planning' : 'Deny' }] },
    // Tools that need the user (e.g. ExitPlanMode) ignore an allow without updatedInput.
    encode: answer => reply(answer.decision === 'decline' ? { behavior: 'deny', message: answer.message || 'Denied by the user in AI Control.' }
      : { behavior: 'allow', updatedInput: input, ...(answer.decision === 'always' ? { updatedPermissions: suggestions } : {}) }),
  };
}
// The tool's final input may gain fields, such as the answers to a question.
const sameCall = (pending, done) => Object.entries(pending ?? {}).every(([key, value]) => JSON.stringify(value) === JSON.stringify(done?.[key]));

export class ClaudeAdapter {
  sessions = new Map();
  hooks = new Map();
  sockets = new Set();
  registrations = new Map();
  workflowNames = new Map();
  paths = new Map();
  stoppedAgents = new Set();
  connected = false;
  detail = 'Discovering local Claude Code sessions…';
  constructor(store, socketPath, { sessionsDir = join(homedir(), '.claude/sessions'), projectsDir = join(homedir(), '.claude/projects'), alive = processMatches, messaging } = {}) { this.store = store; this.socketPath = socketPath; this.sessionsDir = sessionsDir; this.projectsDir = projectsDir; this.transcripts = new TranscriptReader(projectsDir); this.alive = alive; this.messaging = messaging || new ClaudeMessaging({ alive }); }
  async start() {
    // The tmux/start guard prevents duplicate servers; only remove our stale socket.
    try { if ((await lstat(this.socketPath)).isSocket()) await unlink(this.socketPath); else throw new Error('Hook socket path is occupied by a file.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    this.server = createServer(socket => this.accept(socket));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.socketPath, resolve); });
    await chmod(this.socketPath, 0o600);
    this.connected = true;
    await this.refresh();
    this.timer = setInterval(() => this.refresh().catch(() => {}), 4000);
  }
  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const sessions = new Map(), registrations = new Map(), paths = new Map();
      const files = await readdir(this.sessionsDir).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
      await Promise.all(files.filter(f => /^\d+\.json$/.test(f)).map(async file => {
        try {
          const record = JSON.parse(await readFile(join(this.sessionsDir, file), 'utf8'));
          if (!await this.alive(record.pid, record.procStart) || !record.sessionId) return;
          const hook = this.hooks.get(record.sessionId);
          const states = { idle: 'idle', busy: 'working', running: 'working', working: 'working', waiting: 'question', waiting_for_permission: 'permission', needs_permission: 'permission' };
          const transcript = hook?.transcriptPath || join(this.projectsDir, (record.cwd || '').replace(/[^a-zA-Z0-9-]/g, '-'), `${record.sessionId}.jsonl`);
          const history = await this.transcripts.read(transcript, record.sessionId);
          const via = await this.messaging.available(record), canSend = !!via;
          registrations.set(record.sessionId, record);
          paths.set(`claude:${record.sessionId}`, transcript);
          const status = hook?.status || states[record.status] || 'unknown', tmux = via === 'tmux';
          sessions.set(record.sessionId, { id: `claude:${record.sessionId}`, nativeId: record.sessionId, provider: 'claude', title: claudeSessionTitle(record, history), cwd: record.cwd, project: basename(record.cwd || 'Unknown'), status, updatedAt: Math.max(hook?.updatedAt || 0, record.updatedAt || 0), version: record.version || '', detail: hook?.detail || '', control: !!hook || canSend, messaging: { send: canSend, queue: false, via, interrupt: tmux, effort: tmux }, efforts: claudeEfforts, pid: record.pid, ...history, queuedMessages: status === 'working' ? history.queuedMessages : [] });
          for (const agent of await this.subagents(record, transcript, paths)) sessions.set(agent.id, agent);
        } catch { /* ignore partially written and stale registration files */ }
      }));
      for (const [id, hook] of this.hooks) {
        if (sessions.has(id)) continue;
        if (await this.alive(hook.pid, hook.procStart) || this.store.list().some(r => r.sessionId === `claude:${id}`)) {
          const history = await this.transcripts.read(hook.transcriptPath, id);
          paths.set(`claude:${id}`, hook.transcriptPath);
          sessions.set(id, { id: `claude:${id}`, nativeId: id, provider: 'claude', title: claudeSessionTitle({}, history), cwd: hook.cwd, project: basename(hook.cwd || 'Unknown'), status: hook.status, updatedAt: hook.updatedAt, detail: hook.detail, control: true, messaging: { send: false, queue: false }, ...history });
        }
        else { this.hooks.delete(id); this.store.removeSession(`claude:${id}`); }
      }
      this.sessions = sessions;
      this.registrations = registrations;
      this.paths = paths;
      this.detail = 'Local messaging active. Permission and question answers use AI Control hooks.';
    } catch { this.detail = 'Could not read Claude Code session registrations.'; }
    finally { this.refreshing = false; }
  }
  // Subagents of a live session: <transcript>/subagents/agent-<id>.jsonl (+ .meta.json), and workflow
  // workers in subagents/workflows/<run>/, whose run state is in <transcript>/workflows/<run>.json.
  async subagents(record, transcript, paths) {
    const base = transcript.replace(/\.jsonl$/, ''), dir = join(base, 'subagents'), now = Date.now();
    const runs = (await readdir(join(dir, 'workflows')).catch(() => [])).filter(name => /^wf_[\w-]{1,64}$/.test(name));
    const folders = [{ dir }, ...await Promise.all(runs.map(async run => {
      const state = JSON.parse(await readFile(join(base, 'workflows', `${run}.json`), 'utf8').catch(() => '{}'));
      return { dir: join(dir, 'workflows', run), name: state.workflowName || await this.workflowName(transcript, run), ended: ['completed', 'failed', 'killed', 'stopped', 'error'].includes(state.status) };
    }))];
    const files = (await Promise.all(folders.map(async folder => (await readdir(folder.dir).catch(() => []))
      .map(name => /^agent-([a-z0-9]{1,64})\.jsonl$/i.exec(name)?.[1]).filter(Boolean)
      .map(async agentId => ({ folder, agentId, mtime: (await stat(join(folder.dir, `agent-${agentId}.jsonl`)).catch(() => null))?.mtimeMs ?? 0 }))))).flat();
    const recent = (await Promise.all(files)).filter(file => now - file.mtime < 2 * 3600_000).sort((a, b) => b.mtime - a.mtime).slice(0, 16);
    const agents = await Promise.all(recent.map(async ({ folder, agentId, mtime }) => {
      const history = await this.transcripts.read(join(folder.dir, `agent-${agentId}.jsonl`), record.sessionId, agentId);
      const meta = JSON.parse(await readFile(join(folder.dir, `agent-${agentId}.meta.json`), 'utf8').catch(() => '{}'));
      // SubagentStop ends it; without that hook a pending tool call counts as working for 30 minutes, a reply for one.
      const working = !folder.ended && !this.stoppedAgents.has(agentId) && now - mtime < (history.activity === 'tool' ? 30 * 60_000 : 60_000);
      if (!working && now - mtime > 30 * 60_000) return null;
      const { activity, modifiedAt, ...messages } = history;
      paths.set(`claude:${record.sessionId}:${agentId}`, join(folder.dir, `agent-${agentId}.jsonl`));
      const workflow = folder.dir !== dir, kind = workflow ? [folder.name || 'Workflow', meta.workflowPhase].filter(Boolean).join(' · ') : meta.agentType || 'subagent';
      return { id: `claude:${record.sessionId}:${agentId}`, nativeId: agentId, parentId: `claude:${record.sessionId}`, agentKind: workflow ? 'workflow' : 'subagent', provider: 'claude', title: meta.description || meta.agentType || 'Subagent', cwd: record.cwd, project: basename(record.cwd || 'Unknown'), status: working ? 'working' : 'idle', updatedAt: mtime, model: kind, detail: '', control: false, messaging: { send: false, queue: false }, ...messages };
    }));
    return agents.filter(Boolean);
  }
  // A running workflow's state file is written only when it ends; its launch result in the
  // session transcript names it. Read the transcript tail once per run.
  async workflowName(transcript, run) {
    if (this.workflowNames.has(run)) return this.workflowNames.get(run);
    let name;
    try {
      const handle = await open(transcript, 'r');
      try {
        const { size } = await handle.stat(), length = Math.min(size, 8 * 1024 * 1024), buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, size - length);
        name = new RegExp(`"workflowName":"([^"\\\\]{1,100})","runId":"${run}"`).exec(buffer.toString())?.[1];
      } finally { await handle.close(); }
    } catch { /* unreadable transcript: show a generic label */ }
    // ponytail: a miss is cached too; the state file supplies the name once the run ends.
    this.workflowNames.set(run, name);
    return name;
  }
  accept(socket) {
    this.sockets.add(socket);
    socket.on('error', () => {});
    socket.setTimeout(hookTimeoutMs + 60_000, () => socket.destroy());
    let data = '', handled = false, sourceKey;
    socket.on('data', chunk => {
      if (handled) return;
      data += chunk.toString();
      if (Buffer.byteLength(data) > 1024 * 1024) { socket.destroy(); return; }
      if (!data.includes('\n')) return;
      handled = true;
      try {
        const envelope = JSON.parse(data.slice(0, data.indexOf('\n')));
        const e = envelope.event;
        if (!e || typeof e.session_id !== 'string' || typeof e.cwd !== 'string') throw new Error('Invalid event');
        // Subagent hooks only mark the subagent; the parent's state is unchanged.
        if (['SubagentStart', 'SubagentStop'].includes(e.hook_event_name)) {
          if (typeof e.agent_id === 'string') { this.stoppedAgents[e.hook_event_name === 'SubagentStop' ? 'add' : 'delete'](e.agent_id); if (this.stoppedAgents.size > 500) this.stoppedAgents.delete(this.stoppedAgents.values().next().value); }
          socket.end('{}\n'); this.refresh().catch(() => {}); return;
        }
        if (['SessionEnd', 'UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure', 'Stop'].includes(e.hook_event_name)) {
          for (const active of this.sockets) {
            const pending = active.pendingEvent;
            if (!pending || pending.session_id !== e.session_id) continue;
            const completedTool = ['PostToolUse', 'PostToolUseFailure'].includes(e.hook_event_name);
            const matchesTool = pending.tool_use_id && e.tool_use_id
              ? pending.tool_use_id === e.tool_use_id
              : pending.tool_name === e.tool_name && sameCall(pending.tool_input, e.tool_input);
            if (!completedTool || matchesTool) active.end('{}\n');
          }
        }
        const previous = this.hooks.get(e.session_id);
        const state = { cwd: e.cwd, pid: envelope.pid, procStart: envelope.procStart, transcriptPath: e.transcript_path || previous?.transcriptPath, updatedAt: Date.now(), status: 'working', detail: e.tool_name || '' };
        if (e.hook_event_name === 'Stop') state.status = 'idle';
        if (e.hook_event_name === 'Notification') { state.status = { permission_prompt: 'permission', idle_prompt: 'idle', elicitation_dialog: 'question' }[e.notification_type] || previous?.status || 'unknown'; state.detail = e.message || ''; }
        if (e.hook_event_name === 'SessionEnd') { this.hooks.delete(e.session_id); this.store.removeSession(`claude:${e.session_id}`); socket.end('{}\n'); return; }
        const request = claudeRequest(e);
        if (request) state.status = request.view.kind;
        this.hooks.set(e.session_id, state);
        if (!request) { socket.end('{}\n'); this.refresh().catch(() => {}); return; }
        sourceKey = `claude:${randomUUID()}`;
        socket.pendingEvent = e;
        this.store.add(request.view, async answer => {
          if (socket.destroyed) throw fail('Claude is no longer waiting for this answer.', 409);
          const response = request.encode(answer);
          await new Promise((resolve, reject) => socket.write(JSON.stringify(response) + '\n', error => error ? reject(fail('Could not deliver the answer to Claude.', 503)) : resolve()));
          socket.end(); state.status = 'working'; state.updatedAt = Date.now();
          this.refresh().catch(() => {});
        }, sourceKey);
        socket.once('close', () => { this.store.removeSource(sourceKey); if (state.status === request.view.kind) state.status = 'working'; });
        this.refresh().catch(() => {});
      } catch { socket.end('{}\n'); }
    });
    socket.on('close', () => { this.sockets.delete(socket); if (sourceKey) this.store.removeSource(sourceKey); });
  }
  list() { return [...this.sessions.values()]; }
  // The live registration, re-read so keys never reach a pane that changed hands.
  async record(sessionId) {
    const previous = this.registrations.get(sessionId);
    if (!previous) throw fail('This Claude session is no longer available.', 409);
    const record = JSON.parse(await readFile(join(this.sessionsDir, `${previous.pid}.json`), 'utf8').catch(() => '{}'));
    if (record.sessionId !== sessionId || record.procStart !== previous.procStart) throw fail('This Claude session changed. Refresh before sending.', 409);
    if (this.store.list().some(request => request.sessionId === `claude:${sessionId}`)) throw fail('Answer the pending question or permission first.', 409);
    return record;
  }
  async sendMessage(sessionId, body) {
    const result = await this.messaging.send(await this.record(sessionId), body);
    this.transcripts.includeMessage(sessionId, body.clientMessageId);
    return result;
  }
  async interrupt(sessionId) { return this.messaging.interrupt(await this.record(sessionId)); }
  async setEffort(sessionId, effort) { return this.messaging.setEffort(await this.record(sessionId), effort); }
  async history(id, limit) {
    const [sessionId, agentId] = id.slice(7).split(':');
    if (!this.paths.has(id)) throw fail('Session is no longer available.', 409);
    return this.transcripts.read(this.paths.get(id), sessionId, agentId, limit);
  }
  async stop() {
    clearInterval(this.timer);
    this.messaging.stop();
    for (const socket of this.sockets) socket.end('{}\n');
    await new Promise(resolve => this.server ? this.server.close(resolve) : resolve());
    await unlink(this.socketPath).catch(() => {});
  }
}
