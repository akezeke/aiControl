import { createServer } from 'node:net';
import { readFile, readdir, chmod, unlink, lstat, stat, open } from 'node:fs/promises';
import { join, basename, sep } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fail } from './requests.mjs';
import { TranscriptReader, claudeSessionTitle, claudeActivity, claudeWaitingOn, turnTool } from './messages.mjs';
import { TranscriptImages, imageLimit } from './images.mjs';
import { TranscriptDocuments, readableDocuments, readDocument } from './documents.mjs';
import { ClaudeMessaging, claudeEfforts } from './claude-messaging.mjs';
import { claudeModels } from './claude-models.mjs';
import { processMatches } from './processes.mjs';
export { processMatches } from './processes.mjs';

// Must match the PermissionRequest hook timeout in scripts/install-hooks.mjs.
export const hookTimeoutMs = 24 * 3600_000;
// How long a session must have been idle before it can be fired.
const QUIET_MS = 5000;

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
  chosenSettings = new Map();
  hooks = new Map();
  endings = new Map();
  sockets = new Set();
  registrations = new Map();
  owners = new Map();
  workflowNames = new Map();
  paths = new Map();
  stoppedAgents = new Set();
  clearMs = 8000;
  clearPollMs = 200;
  connected = false;
  detail = 'Discovering local Claude Code sessions…';
  constructor(store, socketPath, { sessionsDir = join(homedir(), '.claude/sessions'), projectsDir = join(homedir(), '.claude/projects'), accounts = [{ label: '', sessionsDir, projectsDir }], alive = processMatches, messaging } = {}) { this.store = store; this.socketPath = socketPath; this.accounts = accounts; this.transcripts = new TranscriptReader(accounts.map(account => account.projectsDir)); this.images = new TranscriptImages();
  this.documents = new TranscriptDocuments(); this.agentTitles = new Map(); this.alive = alive; this.messaging = messaging || new ClaudeMessaging({ alive }); }
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
      const sessions = new Map(), registrations = new Map(), paths = new Map(), owners = new Map();
      const files = (await Promise.all(this.accounts.map(async account => (await readdir(account.sessionsDir).catch(e => { if (e.code === 'ENOENT') return []; throw e; })).map(file => ({ account, file }))))).flat();
      await Promise.all(files.filter(({ file }) => /^\d+\.json$/.test(file)).map(async ({ account, file }) => {
        try {
          const record = JSON.parse(await readFile(join(account.sessionsDir, file), 'utf8'));
          if (!await this.alive(record.pid, record.procStart) || !record.sessionId) return;
          // A parked session (handed off to a background job) keeps the last status of its registration and hooks, so it can say busy for days.
          const hook = record.parkedJobId ? null : this.hooks.get(record.sessionId);
          const states = { idle: 'idle', shell: 'idle', busy: 'working', running: 'working', working: 'working', waiting: 'question', waiting_for_permission: 'permission', needs_permission: 'permission' };
          const transcript = hook?.transcriptPath || join(account.projectsDir, (record.cwd || '').replace(/[^a-zA-Z0-9-]/g, '-'), `${record.sessionId}.jsonl`);
          const { step, modifiedAt, ...history } = await this.transcripts.read(transcript, record.sessionId);
          const via = await this.messaging.available(record), canSend = !!via;
          registrations.set(record.sessionId, { record, account }); owners.set(record.sessionId, account);
          paths.set(`claude:${record.sessionId}`, transcript);
          const status = hook?.status || (record.parkedJobId ? 'idle' : states[record.status]) || 'unknown', tmux = via === 'tmux', agents = await this.subagents(record, transcript, paths);
          sessions.set(record.sessionId, { id: `claude:${record.sessionId}`, nativeId: record.sessionId, provider: 'claude', title: claudeSessionTitle(record, history), cwd: record.cwd, project: basename(record.cwd || 'Unknown'), account: account.label, status, waitingOn: claudeWaitingOn(status, record, agents), parked: !!record.parkedJobId, updatedAt: Math.max(hook?.updatedAt || 0, record.updatedAt || 0), version: record.version || '', detail: status === 'working' && !hook?.compacting && turnTool(history.messages) || hook?.detail || '', activity: hook?.compacting ? 'compacting' : claudeActivity(status, step, modifiedAt), control: !!hook || canSend, messaging: { send: canSend, queue: false, via, images: tmux, interrupt: tmux, effort: tmux, fire: tmux || record.kind === 'interactive', clear: tmux && !record.parkedJobId }, efforts: claudeEfforts, pid: record.pid, ...history, queuedMessages: status === 'working' ? history.queuedMessages : [] });
          for (const agent of agents) sessions.set(agent.id, agent);
        } catch { /* ignore partially written and stale registration files */ }
      }));
      for (const [id, hook] of this.hooks) {
        if (sessions.has(id)) continue;
        if (await this.alive(hook.pid, hook.procStart) || this.store.list().some(r => r.sessionId === `claude:${id}`)) {
          const { step, modifiedAt, ...history } = await this.transcripts.read(hook.transcriptPath, id);
          const account = this.accounts.find(account => hook.transcriptPath?.startsWith(account.projectsDir + sep));
          if (account) owners.set(id, account);
          paths.set(`claude:${id}`, hook.transcriptPath);
          sessions.set(id, { id: `claude:${id}`, nativeId: id, provider: 'claude', title: claudeSessionTitle({}, history), cwd: hook.cwd, project: basename(hook.cwd || 'Unknown'), account: account?.label || '', status: hook.status, updatedAt: hook.updatedAt, detail: hook.status === 'working' && !hook.compacting && turnTool(history.messages) || hook.detail, activity: hook.compacting ? 'compacting' : claudeActivity(hook.status, step, modifiedAt), control: true, messaging: { send: false, queue: false }, ...history });
        }
        else { this.hooks.delete(id); this.store.removeSession(`claude:${id}`); }
      }
      this.sessions = sessions;
      this.registrations = registrations;
      this.owners = owners;
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
      return { id: `claude:${record.sessionId}:${agentId}`, nativeId: agentId, parentId: `claude:${record.sessionId}`, agentKind: workflow ? 'workflow' : 'subagent', provider: 'claude', title: meta.description || meta.agentType || 'Subagent', cwd: record.cwd, project: basename(record.cwd || 'Unknown'), status: working ? 'working' : 'idle', updatedAt: mtime, model: kind, detail: working ? turnTool(messages.messages) : '', control: false, messaging: { send: false, queue: false }, ...messages };
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
        // Compacting lasts until the session starts again on the summary. A new, resumed or cleared session waits at its
        // prompt, and so does one compacted by /compact; auto-compacting happens mid-turn, which carries on.
        if (e.hook_event_name === 'PreCompact') { state.compacting = e.trigger === 'manual' ? 'manual' : 'auto'; state.detail = 'Compacting context'; }
        if (e.hook_event_name === 'SessionStart') state.status = e.source !== 'compact' || previous?.compacting === 'manual' ? 'idle' : previous?.compacting ? 'working' : previous?.status || 'working';
        if (e.hook_event_name === 'Notification') { state.status = { permission_prompt: 'permission', idle_prompt: 'idle', elicitation_dialog: 'question' }[e.notification_type] || previous?.status || 'unknown'; state.detail = e.message || ''; }
        if (e.hook_event_name === 'SessionEnd') { this.ended(e.session_id, e.reason); this.hooks.delete(e.session_id); this.store.removeSession(`claude:${e.session_id}`); socket.end('{}\n'); return; }
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
  list() { return [...this.sessions.values()].map(session => {
    const chosen = this.chosenSettings.get(session.nativeId);
    // A new transcript setting supersedes the immediate terminal-command result.
    if (chosen && (chosen.observedModel !== session.model || chosen.observedEffort !== session.effort)) this.chosenSettings.delete(session.nativeId);
    const settings = this.chosenSettings.get(session.nativeId)?.settings;
    return { ...session, ...settings, messaging: { ...session.messaging, model: !!session.messaging?.effort } };
  }); }
  rememberSettings(sessionId, settings) {
    const observed = this.sessions.get(sessionId);
    this.chosenSettings.set(sessionId, { settings, observedModel: observed?.model, observedEffort: observed?.effort });
    return { ok: true, ...settings };
  }
  // New sessions in a project use the account of its latest Claude session.
  accountFor(cwd, label) {
    if (label !== undefined) { const account = this.accounts.find(account => account.label === label); if (!account) throw fail('Unknown Claude account.', 400); return account; }
    const latest = this.list().filter(session => session.cwd === cwd && !session.parentId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return this.owners.get(latest?.nativeId) || this.accounts[0];
  }
  // The live registration, re-read so keys never reach a pane that changed hands.
  async record(sessionId) {
    const { record: previous, account } = this.registrations.get(sessionId) || {};
    if (!previous) throw fail('This Claude session is no longer available.', 409);
    const record = JSON.parse(await readFile(join(account.sessionsDir, `${previous.pid}.json`), 'utf8').catch(() => '{}'));
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
  async modelOptions(sessionId) {
    const record = await this.record(sessionId), account = this.owners.get(sessionId);
    return claudeModels(record.cwd, account?.dir);
  }
  async setModel(sessionId, model) {
    const options = await this.modelOptions(sessionId), selected = options.find(option => option.id === model);
    if (!selected) throw fail('Unknown model. Refresh the model list.');
    await this.messaging.setModel(await this.record(sessionId), model);
    // /model restores Claude's preference for the selected model; the next transcript reports its effort.
    const settings = { model, effort: '', efforts: selected.efforts };
    return this.rememberSettings(sessionId, settings);
  }
  async setEffort(sessionId, effort) {
    const session = this.list().find(session => session.nativeId === sessionId), options = await this.modelOptions(sessionId);
    const selected = options.find(option => option.id === session?.model) || options.find(option => option.resolvedModel === session?.model);
    if (!selected?.efforts.includes(effort)) throw fail('This model does not support that effort level.');
    await this.messaging.setEffort(await this.record(sessionId), effort);
    const settings = { model: selected.id, effort, efforts: selected.efforts };
    return this.rememberSettings(sessionId, settings);
  }
  // Firing ends the session (/exit in tmux, else SIGTERM), so it has to be quiet: idle by its registration and its hooks for a few seconds, not
  // compacting, no subagent or workflow working and nothing left running from its Bash tool, background ones included.
  // A parked session's status is stale, so only what it still runs counts; its job carries on without it.
  // All of it is checked again just before Enter (with /exit typed) or the signal.
  async quiet(sessionId) {
    const record = await this.record(sessionId), parked = !!record.parkedJobId, hook = parked ? null : this.hooks.get(sessionId), transcript = this.paths.get(`claude:${sessionId}`);
    if (!parked && record.status === 'shell') throw fail('Background shells are still running. Stop them first.', 409);
    if ((!parked && record.status !== 'idle') || (hook && hook.status !== 'idle') || hook?.compacting) throw fail('Claude is working. Stop it first.', 409);
    if (Date.now() - Math.max(record.statusUpdatedAt || record.updatedAt || 0, hook?.updatedAt || 0) < QUIET_MS) throw fail('Claude only just finished. Try again in a moment.', 409);
    if (transcript && (await this.subagents(record, transcript, new Map())).some(agent => agent.status === 'working')) throw fail('A subagent is still working.', 409);
    const commands = await this.messaging.commands(record.pid);
    if (commands.length) throw fail(`Still running: ${commands[0].slice(0, 60)}${commands.length > 1 ? ` (+${commands.length - 1})` : ''}. Stop it first.`, 409);
    return record;
  }
  async fire(sessionId) {
    const result = await this.messaging.fire(await this.quiet(sessionId), () => this.quiet(sessionId));
    this.ended(sessionId, 'fired');
    return result;
  }
  // How a session said it ended (SessionEnd's reason, or 'fired'), for recovery.mjs to tell a goodbye from a crash. Kept a while.
  ended(sessionId, reason) {
    const now = Date.now();
    for (const [id, { at }] of this.endings) if (now - at > 600_000) this.endings.delete(id);
    if (sessionId) this.endings.set(sessionId, { reason: String(reason || 'other'), at: now });
  }
  ending(sessionId) { return this.endings.get(sessionId)?.reason || ''; }
  // /clear starts a new session in the same process, whose registration takes on the new id a second or so later.
  // The panel moves to that id, so it comes back only once it's listed.
  async clear(sessionId) {
    const record = await this.quiet(sessionId), { pid } = record, id = `claude:${sessionId}`;
    await this.messaging.clear(record, () => this.quiet(sessionId));
    for (const end = Date.now() + this.clearMs; Date.now() < end; await new Promise(resolve => setTimeout(resolve, this.clearPollMs))) {
      await this.refresh();
      const fresh = this.list().find(session => session.pid === pid && session.id !== id && !session.parentId);
      if (fresh) return { ok: true, id: fresh.id };
    }
    throw fail('/clear was sent but no new session showed up. Check its terminal.', 504);
  }
  async history(id, limit) {
    const [sessionId, agentId] = id.slice(7).split(':');
    if (!this.paths.has(id)) throw fail('Session is no longer available.', 409);
    return this.transcripts.read(this.paths.get(id), sessionId, agentId, limit);
  }
  // Images seen in a session's transcript, by id; never by path. A session's list takes in its subagents' too, finished or
  // not (they're often the ones checking screenshots); those ids start with the agent's, and `agent` is what it was doing.
  async imageList(id) {
    const { sessionId, agentId, path } = await this.transcript(id), own = await this.images.list(path, sessionId);
    if (agentId !== undefined) return { images: own };
    const agents = await Promise.all((await this.agentTranscripts(path)).map(async agent => (await this.images.list(agent.path, sessionId).catch(() => []))
      .map(image => ({ ...image, id: `${agent.agentId}.${image.id}`, agent: agent.title }))));
    return { images: [...own, ...agents.flat()].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).slice(-imageLimit) };
  }
  async image(id, imageId) {
    const [, agentId, own] = /^(?:([a-z0-9]{1,64})\.)?([a-f0-9-]{36}:\d{1,3})$/i.exec(imageId) || [];
    const transcript = own && await this.transcript(id);
    const path = agentId ? transcript && !transcript.agentId && (await this.agentTranscripts(transcript.path)).find(agent => agent.agentId === agentId)?.path : transcript?.path;
    const image = path && await this.images.get(path, transcript.sessionId, own);
    if (!image) throw fail('Image not found.', 404);
    return image;
  }
  // Markdown files a session wrote or named, and those its subagents wrote (what a subagent only mentions isn't for you).
  async documentList(id) {
    const { sessionId, agentId, path } = await this.transcript(id), own = await this.documents.list(path, sessionId);
    const agents = agentId !== undefined ? [] : await Promise.all((await this.agentTranscripts(path)).map(async agent => (await this.documents.list(agent.path, sessionId).catch(() => []))
      .filter(document => document.written).map(document => ({ ...document, agent: agent.title }))));
    return { documents: await readableDocuments([...own, ...agents.flat()]) };
  }
  async document(id, documentId) {
    const found = (await this.documentList(id)).documents.find(document => document.id === documentId);
    const document = found && await readDocument(found);
    if (!document) throw fail('Document not found.', 404);
    return document;
  }
  async transcript(id) {
    const [sessionId, agentId] = id.slice(7).split(':');
    const path = this.paths.has(id) && await this.transcripts.locate(this.paths.get(id), sessionId, agentId).catch(() => null);
    if (!path) throw fail('Session is no longer available.', 409);
    return { sessionId, agentId, path };
  }
  // A session's subagents' transcripts, the 50 written to last: subagents/agent-<id>.jsonl and workflow workers' in
  // subagents/workflows/<run>/, each with its .meta.json's description.
  async agentTranscripts(transcript) {
    const dir = join(transcript.replace(/\.jsonl$/, ''), 'subagents');
    const runs = (await readdir(join(dir, 'workflows')).catch(() => [])).filter(name => /^wf_[\w-]{1,64}$/.test(name));
    const files = (await Promise.all([dir, ...runs.map(run => join(dir, 'workflows', run))].map(async folder => (await readdir(folder).catch(() => []))
      .map(name => /^agent-([a-z0-9]{1,64})\.jsonl$/i.exec(name)?.[1]).filter(Boolean)
      .map(async agentId => ({ agentId, path: join(folder, `agent-${agentId}.jsonl`), mtime: (await stat(join(folder, `agent-${agentId}.jsonl`)).catch(() => null))?.mtimeMs ?? 0 }))))).flat();
    const recent = (await Promise.all(files)).sort((a, b) => b.mtime - a.mtime).slice(0, 50);
    return Promise.all(recent.map(async agent => {
      if (!this.agentTitles.has(agent.path)) {
        const meta = JSON.parse(await readFile(agent.path.replace(/\.jsonl$/, '.meta.json'), 'utf8').catch(() => '{}'));
        this.agentTitles.set(agent.path, String(meta.description || meta.agentType || 'Subagent').slice(0, 120));
      }
      return { ...agent, title: this.agentTitles.get(agent.path) };
    }));
  }
  async stop() {
    clearInterval(this.timer);
    this.messaging.stop();
    for (const socket of this.sockets) socket.end('{}\n');
    await new Promise(resolve => this.server ? this.server.close(resolve) : resolve());
    await unlink(this.socketPath).catch(() => {});
  }
}
