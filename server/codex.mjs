import WebSocket from 'ws';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { fail } from './requests.mjs';
import { codexMessage, messageLimit, recentMessages, textContent, planSteps } from './messages.mjs';
import { UsagePoller, codexUsageWindows } from './usage.mjs';

export const codexSocketPath = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'app-server-control', 'app-server-control.sock');
export function connectCodexSocket(path, connectionOptions = {}) {
  // History and live tool results can contain base64 images, even though the
  // dashboard only displays text. A 32 MiB cap caused endless reconnect loops.
  return new WebSocket(`ws+unix:${path}:/`, { ...connectionOptions, handshakeTimeout: 10_000, perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
}

export function codexStatus(status) {
  if (status?.activeFlags?.includes('waitingOnApproval')) return 'permission';
  if (status?.activeFlags?.includes('waitingOnUserInput')) return 'question';
  return { active: 'working', idle: 'idle', systemError: 'error', notLoaded: 'offline' }[status?.type] ?? 'unknown';
}

export function codexRequest(message, items = new Map()) {
  const p = message.params, method = message.method;
  const base = { provider: 'codex', sessionId: `codex:${p.threadId}`, kind: 'permission', title: p.reason || 'Permission requested', details: '', actions: [] };
  if (method === 'item/tool/requestUserInput' || method === 'tool/requestUserInput') {
    return {
      view: { ...base, kind: 'question', title: 'A question for you', questions: p.questions.map(q => ({ ...q, allowOther: q.isOther !== false, multiSelect: false })) },
      encode: answer => ({ answers: Object.fromEntries(Object.entries(answer.answers).map(([id, values]) => [id, { answers: values }])) }),
    };
  }
  if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(method)) {
    const item = items.get(`${p.threadId}:${p.itemId}`);
    const amendment = Array.isArray(p.proposedExecpolicyAmendment) && p.proposedExecpolicyAmendment.length ? p.proposedExecpolicyAmendment : null;
    // Older servers list the decisions; current ones accept all of these (the amendment only when proposed).
    const decisions = (p.availableDecisions ?? ['accept', 'acceptForSession', ...(amendment ? ['acceptWithExecpolicyAmendment'] : []), 'decline', 'cancel']).map(d => typeof d === 'string' ? d : Object.keys(d ?? {})[0]);
    return {
      view: { ...base, title: method.includes('fileChange') ? 'Allow file changes?' : 'Allow this command?',
        details: JSON.stringify({ ...p, ...(item ? { item } : {}) }, null, 2),
        actions: [{ value: 'accept', label: 'Allow once' }, { value: 'acceptForSession', label: 'Allow for session' }, { value: 'acceptWithExecpolicyAmendment', label: `Always allow ${(amendment ?? []).join(' ')}`.slice(0, 80) }, { value: 'decline', label: 'Deny' }, { value: 'cancel', label: 'Cancel turn' }].filter(x => decisions.includes(x.value)),
      }, encode: answer => ({ decision: answer.decision === 'acceptWithExecpolicyAmendment' ? { acceptWithExecpolicyAmendment: { execpolicy_amendment: amendment } } : answer.decision }),
    };
  }
  if (method === 'item/permissions/requestApproval') return {
    view: { ...base, title: 'Grant these permissions for this turn?', details: JSON.stringify(p, null, 2), actions: [{ value: 'accept', label: 'Allow for this turn' }, { value: 'decline', label: 'Deny' }] },
    encode: answer => ({ permissions: answer.decision === 'accept' ? Object.fromEntries(Object.entries(p.permissions).filter(([, value]) => value != null)) : {}, scope: 'turn' }),
  };
  if (method === 'mcpServer/elicitation/request') {
    const schema = p.requestedSchema;
    // Render simple MCP forms. Complex schemas remain in the owning client.
    if (p.mode === 'form' && schema?.type === 'object' && Object.values(schema.properties ?? {}).every(v => ['string', 'boolean', 'integer', 'number'].includes(v.type) && !v.anyOf && !v.oneOf && !v.$ref)) {
      const questions = Object.entries(schema.properties ?? {}).map(([id, v]) => ({ id, question: v.title || id, description: v.description, allowOther: !v.enum && v.type !== 'boolean', options: (v.enum ?? (v.type === 'boolean' ? ['true', 'false'] : [])).map(x => ({ label: String(x) })), multiSelect: false }));
      return { view: { ...base, kind: 'question', title: p.message, questions }, encode: answer => {
        const content = {};
        for (const [key, values] of Object.entries(answer.answers)) {
          const spec = schema.properties[key], raw = values[0];
          let value = spec.type === 'boolean' ? raw === 'true' : ['integer', 'number'].includes(spec.type) ? Number(raw) : raw;
          if (typeof value === 'number' && (!Number.isFinite(value) || (spec.type === 'integer' && !Number.isInteger(value)) || (spec.minimum != null && value < spec.minimum) || (spec.maximum != null && value > spec.maximum))) throw fail(`Invalid number for ${key}.`);
          if (spec.enum && !spec.enum.includes(value)) throw fail(`Invalid choice for ${key}.`);
          if (typeof value === 'string' && ((spec.minLength && value.length < spec.minLength) || (spec.maxLength && value.length > spec.maxLength))) throw fail(`Invalid length for ${key}.`);
          content[key] = value;
        }
        return { action: 'accept', content };
      } };
    }
    return { view: { ...base, title: p.message || 'Input requested by an app', details: JSON.stringify(p, null, 2), kind: 'unsupported', note: 'Complete this request in the original Codex client.' }, encode: null };
  }
  return null;
}

const codexGoal = goal => goal && { objective: String(goal.objective || '').slice(0, 500), status: goal.status, tokensUsed: goal.tokensUsed, tokenBudget: goal.tokenBudget ?? null, timeUsedSeconds: goal.timeUsedSeconds };

export class CodexAdapter {
  sessions = new Map();
  calls = new Map();
  resolutions = new Map();
  joined = new Set();
  // Loaded threads with no rollout until their first turn: resume fails, but turn/start works.
  fresh = new Set();
  items = new Map();
  submissions = new Map();
  models = new Map();
  startingQueue = new Set();
  queueAttempts = new Set();
  sendingMessages = new Set();
  connected = false;
  detail = 'Connecting to the local Codex app-server…';
  serial = 0;
  constructor(store, { socketPath = codexSocketPath(), createSocket = connectCodexSocket, log = console.warn, retryDelayMs = 5000, rpcTimeoutMs = 10_000 } = {}) {
    this.store = store; this.socketPath = socketPath; this.createSocket = createSocket; this.log = log;
    this.retryDelayMs = retryDelayMs; this.rpcTimeoutMs = rpcTimeoutMs;
    this.usage = new UsagePoller('codex', 'Codex', async () => codexUsageWindows(await this.rpc('account/rateLimits/read', undefined, { closeOnTimeout: false })));
  }
  start() { if (this.stopped === false) return; this.stopped = false; this.connect(); }
  async connect() {
    if (this.stopped || this.connection) return;
    clearTimeout(this.retry);
    const connection = this.connection = {};
    const current = () => this.connection === connection;
    let socket;
    const close = error => {
      if (!current()) return;
      this.connection = null; this.socket = null; this.refreshing = false;
      const reason = error?.message || 'The local socket closed.';
      this.connected = false; this.detail = `Codex disconnected: ${reason.slice(0, 250)} Retrying…`;
      this.usage.stop('Codex is disconnected. Usage will refresh when it reconnects.');
      if (!this.stopped && this.lastError !== reason) { this.lastError = reason; this.log(`[Codex connection] ${reason.slice(0, 250)}`); }
      this.joined.clear(); this.fresh.clear(); this.items.clear();
      for (const session of this.sessions.values()) { session.status = 'offline'; session.control = false; this.store.removeSession(session.id); }
      for (const request of this.store.list()) if (request.provider === 'codex') this.store.removeSession(request.sessionId);
      for (const pending of [...this.calls.values(), ...this.resolutions.values()]) pending.reject(fail('Codex disconnected. Verify the request in the original client.', 503));
      this.calls.clear(); this.resolutions.clear();
      clearInterval(this.timer);
      socket?.terminate();
      if (!this.stopped) this.retry = setTimeout(() => this.connect(), this.retryDelayMs);
    };
    connection.close = close;
    try {
      socket = this.socket = this.createSocket(this.socketPath);
      socket.on('error', close); socket.on('close', () => close());
      socket.on('message', data => { if (!current()) return; try { this.receive(JSON.parse(data.toString())); } catch { /* malformed messages cannot become actions */ } });
      await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); socket.once('close', () => reject(fail('Codex socket closed before connecting.', 503))); });
      if (!current()) return;
      await this.rpc('initialize', { clientInfo: { name: 'ai_control', title: 'AI Control', version: '0.1.0' }, capabilities: {
        experimentalApi: true, requestAttestation: false,
        optOutNotificationMethods: ['thread/started', 'turn/started', 'turn/diff/updated', 'item/agentMessage/delta', 'item/reasoning/textDelta', 'item/reasoning/summaryTextDelta', 'item/reasoning/summaryPartAdded', 'item/commandExecution/outputDelta', 'item/fileChange/outputDelta'],
      } });
      if (!current()) return;
      this.write({ method: 'initialized' });
      this.connected = true; this.detail = 'Connected to the local Codex app-server';
      this.usage.start();
      this.loadModels();
      await this.refresh();
      if (!current()) return;
      this.lastError = null;
      this.timer = setInterval(() => this.refresh().catch(error => { if (current()) this.detail = `Could not refresh Codex sessions: ${error.message.slice(0, 200)}`; }), 4000);
    } catch (error) { close(error); }
  }
  write(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw fail('Codex is disconnected.', 503);
    this.socket.send(JSON.stringify(message));
  }
  rpc(method, params, { closeOnTimeout = true } = {}) {
    const id = `aicontrol:${++this.serial}`;
    const connection = this.connection;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        const error = fail(`Codex did not respond to ${method}.`, 503);
        reject(error);
        // Session polling is also a liveness check. Optional account usage
        // reads can time out without interrupting otherwise usable sessions.
        // Submitted messages remain unconfirmed, never replayed.
        if (closeOnTimeout) connection?.close(error);
      }, this.rpcTimeoutMs);
      this.calls.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      try { this.write({ id, method, params }); } catch (error) { this.calls.get(id)?.reject(error); this.calls.delete(id); }
    });
  }
  // Live fields (plan, context, goal, effort) arrive as notifications and survive the periodic re-read.
  upsert(thread) {
    const previous = this.sessions.get(thread.id);
    this.sessions.set(thread.id, { detail: '', messages: [], messagesState: 'loading', queuedMessages: [], queueAvailable: false, queueError: '', ...previous, id: `codex:${thread.id}`, nativeId: thread.id, provider: 'codex', title: thread.name || thread.preview?.slice(0, 130) || 'Codex session', cwd: thread.cwd, project: basename(thread.cwd || 'Unknown'), status: codexStatus(thread.status), updatedAt: Math.max(previous?.updatedAt || 0, thread.updatedAt * 1000 || 0), model: thread.model, effort: previous?.nextEffort || thread.reasoningEffort || previous?.effort || '', efforts: this.models.get(thread.model) || [], branch: thread.gitInfo?.branch, parentId: thread.parentThreadId, control: this.joined.has(thread.id) });
  }
  async refresh() {
    if (this.refreshing || !this.connected) return;
    const connection = this.connection;
    const current = () => this.connection === connection && this.connected;
    this.refreshing = true;
    try {
      const loaded = []; let cursor;
      do {
        const page = await this.rpc('thread/loaded/list', { limit: 100, ...(cursor ? { cursor } : {}) });
        if (!current()) return;
        loaded.push(...page.data); cursor = page.nextCursor;
      } while (cursor);
      for (const id of this.sessions.keys()) if (!loaded.includes(id)) { this.store.removeSession(`codex:${id}`); this.sessions.delete(id); this.joined.delete(id); this.fresh.delete(id); }
      // Only join already-loaded threads; never resume a saved conversation from disk.
      for (let start = 0; start < loaded.length; start += 8) await Promise.all(loaded.slice(start, start + 8).map(async id => {
        try {
          if (!current()) return;
          const result = await this.rpc('thread/read', { threadId: id, includeTurns: false });
          if (!current()) return;
          this.upsert(result.thread);
          if (!this.joined.has(id)) {
            try { await this.rpc('thread/resume', { threadId: id, excludeTurns: true }); }
            catch (error) { if (error.rpcCode === -32600 && /no rollout found/.test(error.message)) { this.fresh.add(id); this.sessions.get(id).messagesState = 'ready'; return; } throw error; }
            if (!current()) return;
            this.joined.add(id); this.fresh.delete(id); this.sessions.get(id).control = true;
            this.rpc('thread/goal/get', { threadId: id }, { closeOnTimeout: false }).then(({ goal }) => { if (goal && this.sessions.has(id)) this.sessions.get(id).goal = codexGoal(goal); }, () => {});
          }
          await this.refreshMessages(id);
          if (!current()) return;
          await this.refreshQueue(id);
          if (!current()) return;
          await this.startNextQueued(id);
        } catch (error) { if (current()) this.detail = `Some Codex sessions could not be read: ${error.message.slice(0, 200)} Retrying…`; }
      }));
    } finally { if (this.connection === connection) this.refreshing = false; }
  }
  // Effort levels per model, for the effort picker. Optional: older servers lack model/list.
  async loadModels() {
    try {
      let cursor;
      do {
        const page = await this.rpc('model/list', { includeHidden: true, ...(cursor ? { cursor } : {}) }, { closeOnTimeout: false });
        for (const model of page.data ?? []) { const efforts = (model.supportedReasoningEfforts ?? []).map(option => option.reasoningEffort).filter(Boolean); this.models.set(model.id, efforts); this.models.set(model.model, efforts); }
        cursor = page.nextCursor;
      } while (cursor && this.models.size < 500);
    } catch { /* no effort picker */ }
  }
  // Newest first, ten items a page, so fifty full tool results (potentially many images) never share
  // one WebSocket message. Stops after `limit` text messages or 20 pages per 20 messages.
  async readMessages(threadId, limit = messageLimit) {
    const connection = this.connection, messages = []; let cursor, more = false;
    for (let pageNumber = 0, texts = 0; pageNumber < limit && texts < limit; pageNumber++) {
      const page = await this.rpc('thread/items/list', { threadId, limit: 10, sortDirection: 'desc', ...(cursor ? { cursor } : {}) });
      if (this.connection !== connection) return null;
      for (const entry of page.data) { const value = codexMessage(entry); if (value) { messages.push(value); if (!value.tool) texts++; } }
      cursor = page.nextCursor; more = !!cursor; if (!cursor) break;
    }
    return { messages: recentMessages(messages.reverse(), limit), more };
  }
  async refreshMessages(threadId) {
    const session = this.sessions.get(threadId);
    if (!session) return;
    try {
      const result = await this.readMessages(threadId);
      if (!result) return;
      session.messages = result.messages; session.messagesState = result.messages.length ? 'ready' : 'empty';
    } catch { session.messagesState = session.messages.length ? 'stale' : 'unavailable'; }
  }
  async history(threadId, limit) {
    this.requireMessaging(threadId);
    return await this.readMessages(threadId, limit) ?? { messages: [], more: false };
  }
  queueView(entry) {
    return { id: entry.id, text: textContent(entry.input).slice(0, 12_000), clientMessageId: entry.clientUserMessageId, hasAttachments: entry.input?.some(item => item.type !== 'text') || false };
  }
  async refreshQueue(threadId) {
    const connection = this.connection;
    try {
      const entries = []; let cursor;
      do {
        const page = await this.rpc('thread/queue/list', { threadId, limit: 100, ...(cursor ? { cursor } : {}) });
        if (this.connection !== connection) return;
        entries.push(...page.data.map(entry => this.queueView(entry))); cursor = page.nextCursor;
      } while (cursor && entries.length < 500);
      const session = this.sessions.get(threadId);
      if (session) { session.queuedMessages = entries; session.queueAvailable = true; if (!entries.length || !session.queueError?.startsWith('Could not confirm')) session.queueError = ''; }
    } catch (error) {
      if (this.connection !== connection) return;
      const session = this.sessions.get(threadId);
      if (session) { session.queueAvailable = false; session.queueError = error.rpcCode === -32601 ? 'This Codex version does not support queued messages.' : 'Could not refresh queued messages.'; }
    }
  }
  requireMessaging(threadId) {
    const session = this.sessions.get(threadId);
    if (!session || !(this.joined.has(threadId) || this.fresh.has(threadId))) throw fail('This session is no longer connected.', 409);
    if (!this.connected) throw fail('Codex is disconnected. Reconnect before sending.', 503);
    return session;
  }
  async sendMessage(threadId, body) {
    this.requireMessaging(threadId);
    if (typeof body?.text !== 'string' || !body.text.trim() || body.text.length > 12_000) throw fail('Enter a message of 1–12,000 characters.');
    if (!['send', 'queue'].includes(body.mode) || !/^[a-f0-9-]{36}$/i.test(body.clientMessageId || '')) throw fail('Invalid message submission.');
    const key = `${threadId}:${body.clientMessageId}`, fingerprint = JSON.stringify([body.mode, body.text]);
    const previous = this.submissions.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw fail('This message ID was already used.', 409);
      return previous.promise;
    }
    const promise = this.deliverMessage(threadId, body);
    this.submissions.set(key, { fingerprint, promise });
    promise.catch(error => { if (error.status !== 504) this.submissions.delete(key); });
    if (this.submissions.size > 1000) this.submissions.delete(this.submissions.keys().next().value);
    return promise;
  }
  async deliverMessage(threadId, body) {
    const input = [{ type: 'text', text: body.text, text_elements: [] }];
    const clientUserMessageId = `ai-control:${body.clientMessageId}`;
    let submitted = false, locked = false;
    try {
      const session = this.requireMessaging(threadId);
      if (body.mode === 'queue') {
        if (!session.queueAvailable) throw fail('Queue is unavailable. Wait for the session to become idle, then send.', 409);
        submitted = true;
        const result = await this.rpc('thread/queue/add', { threadId, input, clientUserMessageId });
        if (!result.queuedSubmission?.id) throw fail('Codex did not confirm the queued message.', 502);
        await this.refreshQueue(threadId);
        return { status: 'queued', id: result.queuedSubmission.id };
      }
      if (this.sendingMessages.has(threadId) || this.startingQueue.has(threadId)) throw fail('Another message is being sent. Wait for it to finish.', 409);
      this.sendingMessages.add(threadId); locked = true;
      // Match CLI Enter: append to the active turn, or start one if idle.
      // Only retry explicit turn-state rejections, never a lost acknowledgment.
      for (let attempt = 0; attempt < 3; attempt++) {
        const { thread } = await this.rpc('thread/read', { threadId, includeTurns: false });
        this.requireMessaging(threadId);
        if (thread.canAcceptDirectInput === false) throw fail('This session does not accept direct messages. Send to its parent session instead.', 409);
        const active = thread.status?.type === 'active';
        let turnId;
        if (active) {
          const page = await this.rpc('thread/turns/list', { threadId, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' });
          turnId = page.data.find(turn => turn.status === 'inProgress')?.id;
          if (!turnId) continue; // The turn may have finished between the two reads.
        } else if (codexStatus(thread.status) !== 'idle' || this.store.list().some(r => r.sessionId === session.id)) {
          throw fail('This session cannot accept a message right now. Check its questions or permissions above.', 409);
        }
        try {
          submitted = true;
          // A chosen effort can only ride along with a new turn; a steer keeps the current one.
          const effort = !active && this.sessions.get(threadId)?.nextEffort;
          const result = await this.rpc(active ? 'turn/steer' : 'turn/start', {
            threadId, input, clientUserMessageId, ...(active ? { expectedTurnId: turnId } : {}), ...(effort ? { effort } : {}),
          });
          if (effort) { const current = this.sessions.get(threadId); if (current?.nextEffort === effort) { current.effort = effort; delete current.nextEffort; } }
          const confirmedTurnId = active ? result.turnId : result.turn?.id;
          if (!confirmedTurnId) throw fail('Codex did not confirm the message.', 502);
          const current = this.sessions.get(threadId);
          if (current) {
            current.status = active ? codexStatus(thread.status) : result.turn.status === 'inProgress' ? 'working' : 'idle';
            current.updatedAt = Date.now();
          }
          return { status: active ? 'steered' : 'sent', turnId: confirmedTurnId };
        } catch (error) {
          const turnChanged = error.rpcCode === -32600 && /no active turn to steer|expected active turn|active turn id .*does not match|turn (?:is )?already active|already.*(?:running|active)/i.test(error.message);
          if (!turnChanged) throw error;
          submitted = false;
        }
      }
      throw fail('The active turn changed while sending. Your message was not sent; try again.', 409);
    } catch (error) {
      if (submitted && error.rpcCode == null) throw fail('Delivery could not be confirmed. Check the conversation or queue before sending again.', 504);
      throw error;
    } finally { if (locked) this.sendingMessages.delete(threadId); }
  }
  async interrupt(threadId) {
    this.requireMessaging(threadId);
    const page = await this.rpc('thread/turns/list', { threadId, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' });
    const turnId = page.data.find(turn => turn.status === 'inProgress')?.id;
    if (!turnId) throw fail('Codex is not working right now.', 409);
    await this.rpc('turn/interrupt', { threadId, turnId });
    return { ok: true };
  }
  // The app-server changes effort only with turn/start, so it applies from the next message sent here.
  setEffort(threadId, effort) {
    const session = this.requireMessaging(threadId);
    if (!session.efforts?.includes(effort)) throw fail('Unknown effort level.');
    if (effort === session.effort && !session.nextEffort) return { ok: true };
    session.nextEffort = effort; session.effort = effort;
    return { ok: true, pending: true };
  }
  async cancelQueuedMessage(threadId, id) {
    this.requireMessaging(threadId);
    const result = await this.rpc('thread/queue/delete', { threadId, queuedSubmissionId: id });
    if (!result.deleted) throw fail('This queued message has already started or was removed.', 409);
    const session = this.sessions.get(threadId);
    if (session) session.queuedMessages = session.queuedMessages.filter(message => message.id !== id);
    return { ok: true };
  }
  async startNextQueued(threadId) {
    const session = this.sessions.get(threadId), next = session?.queuedMessages?.[0];
    if (!this.connected || !this.joined.has(threadId) || session?.status !== 'idle' || !session.queueAvailable || !next?.clientMessageId?.startsWith('ai-control:') || this.startingQueue.has(threadId) || this.sendingMessages.has(threadId) || this.queueAttempts.has(next.id) || this.store.list().some(r => r.sessionId === session.id)) return;
    this.startingQueue.add(threadId); this.queueAttempts.add(next.id);
    if (this.queueAttempts.size > 1000) this.queueAttempts.delete(this.queueAttempts.values().next().value);
    try {
      const result = await this.rpc('thread/queue/start', { threadId, queuedSubmissionId: next.id });
      const current = this.sessions.get(threadId);
      if (current && result.turn?.id) { current.status = 'working'; current.updatedAt = Date.now(); current.queueError = ''; current.queuedMessages = current.queuedMessages.filter(message => message.id !== next.id); }
    } catch (error) {
      // A lost acknowledgment must not submit the same instruction twice.
      const current = this.sessions.get(threadId);
      if (current) current.queueError = 'Could not confirm starting the queued message. Check it in Codex.';
      if (error.rpcCode != null && /active turn|already.*(?:running|active)|declined.*start/i.test(error.message)) this.queueAttempts.delete(next.id);
      await this.refreshQueue(threadId);
    } finally { this.startingQueue.delete(threadId); }
  }
  receive(message) {
    if (message.id != null && !message.method) {
      const call = this.calls.get(message.id);
      if (call) { this.calls.delete(message.id); message.error ? call.reject(Object.assign(fail(message.error.message, 502), { rpcCode: message.error.code })) : call.resolve(message.result); }
      return;
    }
    const p = message.params ?? {};
    if (message.method === 'account/updated') { this.usage.reset(); if (this.connected) this.usage.start(); }
    if (message.method === 'serverRequest/resolved') {
      const key = `codex:${JSON.stringify(p.requestId)}`;
      this.store.removeSource(key); this.resolutions.get(key)?.resolve(); this.resolutions.delete(key); return;
    }
    const live = this.sessions.get(p.threadId);
    if (message.method === 'thread/status/changed' && live) live.status = codexStatus(p.status);
    if (live) {
      if (message.method === 'thread/tokenUsage/updated') live.context = { used: p.tokenUsage?.last?.totalTokens || 0, window: p.tokenUsage?.modelContextWindow || null };
      if (message.method === 'turn/plan/updated') live.plan = planSteps(p.plan);
      if (message.method === 'thread/goal/updated') live.goal = codexGoal(p.goal);
      if (message.method === 'thread/goal/cleared') live.goal = null;
      if (message.method === 'thread/settings/updated' && p.threadSettings) { live.model = p.threadSettings.model || live.model; if (!live.nextEffort) live.effort = p.threadSettings.effort || live.effort; }
      // Errors and reroutes have no item; they join the history as notices.
      const note = message.method === 'error' ? { text: `${p.error?.message || 'Error'}${p.willRetry ? ' · retrying' : ''}`, error: !p.willRetry }
        : message.method === 'model/rerouted' ? { text: `Model rerouted: ${p.fromModel} → ${p.toModel}` } : null;
      if (note) { live.messages = recentMessages([...live.messages, { id: `${message.method}:${p.turnId}:${Date.now()}`, role: 'notice', text: note.text.slice(0, 300), truncated: false, timestamp: Date.now(), ...(note.error ? { error: true } : {}) }]); live.updatedAt = Date.now(); }
    }
    if (['turn/completed', 'thread/closed', 'thread/archived'].includes(message.method)) this.store.removeSession(`codex:${p.threadId}`);
    if (message.method === 'item/started') {
      // Only approvals need cached full items; don't retain image/tool results.
      if (['commandExecution', 'fileChange'].includes(p.item.type)) this.items.set(`${p.threadId}:${p.item.id}`, p.item);
      if (this.items.size > 200) this.items.delete(this.items.keys().next().value);
      const session = this.sessions.get(p.threadId);
      if (session) { session.detail = p.item.command || p.item.text?.slice(0, 300) || p.item.type; session.updatedAt = Date.now(); }
    }
    if (message.method === 'item/completed') {
      const session = this.sessions.get(p.threadId), value = p.item && codexMessage(p.item);
      if (session && value) { session.messages = recentMessages([...session.messages.filter(m => m.id !== value.id), value]); session.messagesState = 'ready'; session.updatedAt = Date.now(); }
    }
    if (message.id != null && message.method && p.threadId) {
      const request = codexRequest(message, this.items);
      if (!request) return;
      const sourceKey = `codex:${JSON.stringify(message.id)}`;
      this.store.add(request.view, async answer => {
        if (!request.encode) throw fail('Answer in the original client.');
        const result = request.encode(answer);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { this.resolutions.delete(sourceKey); reject(fail('Response sent, but Codex did not confirm it. Check the original client before retrying.', 504)); }, 10_000);
          this.resolutions.set(sourceKey, { resolve: () => { clearTimeout(timer); resolve(); }, reject: e => { clearTimeout(timer); reject(e); } });
          try { this.write({ id: message.id, result }); } catch (error) { clearTimeout(timer); this.resolutions.delete(sourceKey); reject(error); }
        });
      }, sourceKey);
    }
  }
  list() {
    return [...this.sessions.values()].map(({ nextEffort, ...session }) => {
      const send = this.connected && (this.joined.has(session.nativeId) || this.fresh.has(session.nativeId));
      return { ...session, ...(nextEffort ? { effortPending: true } : {}), messaging: { send, queue: send && this.joined.has(session.nativeId) && session.queueAvailable, interrupt: send && this.joined.has(session.nativeId), effort: send && session.efforts.length > 0 } };
    });
  }
  stop() { this.stopped = true; clearTimeout(this.retry); clearInterval(this.timer); this.connection?.close(); }
}
