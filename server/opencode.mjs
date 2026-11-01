import { fail, slashCommand } from './requests.mjs';
import { openCodeSession, openCodeMessages, usageRecords, usagePeriods, tokenUsage } from './opencode-data.mjs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OpenCodeAPI } from './opencode-api.mjs';

export function openCodeConfig(value) {
  if (value?.service === true) return { service: true };
  if (!value?.url) return null;
  let url;
  try { url = new URL(value.url); } catch { throw new Error('Enter a valid OpenCode server URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use a local OpenCode server URL, such as http://127.0.0.1:4096, without a path or credentials.');
  const username = value.username || 'opencode';
  if (typeof username !== 'string' || /[:\r\n]/.test(username) || (value.password != null && typeof value.password !== 'string')) throw new Error('Invalid OpenCode server credentials.');
  return { url: url.origin, username, password: value.password || '' };
}

// Fixed server origin, no redirects or browser-visible credentials. Provider keys remain in OpenCode.
export class OpenCodeClient {
  constructor(config, { fetch: fetcher = fetch, signal } = {}) { this.config = openCodeConfig(config); this.fetch = fetcher; this.signal = signal; }
  async request(path, { method = 'GET', body, directory, query = {} } = {}) {
    const url = new URL(this.config.url + path);
    for (const [key, value] of Object.entries({ ...query, directory })) if (value != null) url.searchParams.set(key, String(value));
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.config.password) headers.Authorization = `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`;
    let response;
    try {
      response = await this.fetch(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(15_000), ...this.signal ? [this.signal] : []]) });
      if (!response.ok) {
        await response.body?.cancel();
        throw Object.assign(fail([401, 403].includes(response.status) ? 'OpenCode refused access. Check its server password in npm run setup.'
          : response.status === 404 ? 'OpenCode no longer has this session or request, or its API needs updating.'
          : response.status === 409 ? 'OpenCode is busy. Stop its current turn or wait for it to finish.' : 'OpenCode could not complete this request.', [400, 404, 409].includes(response.status) ? response.status === 404 ? 409 : response.status : 503), { upstreamStatus: response.status });
      }
      if (response.status === 204) return null;
      if (!response.headers.get('content-type')?.includes('application/json')) {
        await response.body?.cancel();
        throw Object.assign(fail('OpenCode returned an unsupported response.', 503), { notJSON: true });
      }
      let raw = '', size = 0;
      const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 32 * 1024 * 1024) throw fail('OpenCode history is too large to read. Usage may be incomplete.', 503);
        raw += decoder.decode(chunk, { stream: true });
      }
      return JSON.parse(raw + decoder.decode());
    } catch (error) {
      if (error.status) throw error;
      throw fail(method === 'GET' ? 'OpenCode is unreachable. Check that its server is running.' : 'OpenCode did not confirm the action. Check the session before trying again.', 503);
    }
  }
}

const array = value => { if (!Array.isArray(value)) throw fail('OpenCode returned an unsupported response. Update OpenCode and reconnect.', 503); return value; };
const nativeId = id => { if (!/^ses[\w-]+$/.test(id)) throw fail('Invalid OpenCode session ID.'); return id; };
const maxSessions = 1000;
async function eachLimit(items, action) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => { while (cursor < items.length) await action(items[cursor++]); }));
}

export class OpenCodeAdapter {
  constructor(store, config, { fetch: fetcher, now = Date.now, intervalMs = 3000, serviceFile = join(process.env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'opencode/service.json') } = {}) {
    this.store = store; this.config = openCodeConfig(config); this.now = now; this.intervalMs = intervalMs;
    this.sessions = new Map(); this.usage = new Map(); this.requestKeys = new Set(); this.submissions = new Map();
    this.controller = new AbortController(); this.fetch = fetcher; this.serviceFile = serviceFile;
    if (this.config && !this.config.service) this.connect(this.config);
    this.connected = false; this.detail = this.config ? 'Connecting to OpenCode…' : ''; this.usageUpdatedAt = null;
  }
  connect(config) {
    this.client = new OpenCodeClient(config, { fetch: this.fetch, signal: this.controller.signal });
    this.api = new OpenCodeAPI(this.client);
  }
  start() {
    if (!this.config || this.timer) return;
    this.refresh(); this.timer = setInterval(() => this.refresh(), this.intervalMs); this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); this.timer = null; this.controller.abort(); this.disconnect('OpenCode disconnected.'); }
  disconnect(detail) {
    this.connected = false; this.detail = detail;
    for (const key of this.requestKeys) this.store.removeSource(key);
    this.requestKeys.clear();
    for (const session of this.sessions.values()) { session.status = 'offline'; session.control = false; session.messaging = { send: false, interrupt: false }; }
  }
  list() { return [...this.sessions.values()]; }
  refresh() {
    if (!this.config || this.controller.signal.aborted) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.sync().catch(error => { this.disconnect(error.status ? error.message : 'OpenCode could not refresh sessions.'); }).finally(() => { this.pending = null; });
    return this.pending;
  }
  async sync() {
    if (this.config.service) {
      let registration;
      try { registration = JSON.parse(await readFile(this.serviceFile, 'utf8')); }
      catch { throw fail('OpenCode service is unavailable. Start OpenCode or run opencode service start.', 503); }
      const config = openCodeConfig({ url: registration.url, password: registration.password });
      if (!config) throw fail('OpenCode service has no local address. Restart OpenCode.', 503);
      if (JSON.stringify(config) !== JSON.stringify(this.client?.config)) {
        this.disconnect('Reconnecting to OpenCode…'); this.connect(config);
      }
    }
    const rows = await this.api.sessions(maxSessions);
    const infos = rows.filter(info => /^ses[\w-]+$/.test(info.id) && typeof info.directory === 'string');
    const directories = [...new Set(infos.filter(info => !info.time?.archived).map(info => info.directory))];
    const states = new Map(), requests = [], active = this.api.v2 ? await this.api.status() : null;
    await eachLimit(directories, async directory => {
      const [status, permissions, questions] = await Promise.all([
        active || this.api.status(directory), this.api.requests('permission', directory), this.api.requests('question', directory),
      ]);
      if (!status || typeof status !== 'object' || Array.isArray(status)) throw fail('OpenCode returned invalid session status.', 503);
      for (const [id, value] of Object.entries(status)) states.set(id, value);
      requests.push(...array(permissions).map(request => ({ request, kind: 'permission', directory })), ...array(questions).map(request => ({ request, kind: 'question', directory })));
    });
    // A request can belong to an older session outside the listing window.
    for (const { request, directory } of requests) if (!infos.some(info => info.id === request.sessionID)) {
      infos.push(await this.api.session(nativeId(request.sessionID), directory));
    }
    this.controller.signal.throwIfAborted();
    const live = new Set(infos.filter(info => !info.time?.archived).map(info => info.id));
    for (const [id, session] of this.sessions) if (!live.has(id)) { this.sessions.delete(id); this.store.removeSession(session.id); }
    const all = new Set(infos.map(info => info.id));
    for (const id of this.usage.keys()) if (!all.has(id)) this.usage.delete(id);
    const month = usagePeriods([], this.now())[1].from;
    let incomplete = rows.length >= maxSessions;
    await eachLimit(infos, async info => {
      const prior = this.sessions.get(info.id), status = states.get(info.id)?.type;
      const working = status === 'busy' || status === 'retry';
      const stored = this.usage.get(info.id), monthly = info.time?.updated >= month;
      const readUsage = monthly && (!stored || stored.updated !== info.time?.updated || working || prior?.status === 'working') && (!stored || this.now() - stored.at >= 60_000 || (prior?.status === 'working' && !working));
      const changed = !prior || prior.updatedAt !== info.time?.updated || working || prior.status === 'working' || prior.messagesState === 'stale' || prior.messagesState === 'unavailable';
      let session = prior;
      try {
        if (readUsage || (!info.time?.archived && changed)) {
          const messages = await this.api.messages(nativeId(info.id), info.directory, readUsage ? undefined : 30);
          this.controller.signal.throwIfAborted();
          session = openCodeSession(info, messages, prior);
          if (readUsage) {
            const records = usageRecords(messages); this.usage.set(info.id, { records, updated: info.time?.updated, at: this.now() });
            if (!Number.isFinite(info.cost)) {
              const total = records.reduce((sum, r) => sum + (r.usd || 0), 0);
              if (records.every(r => r.usd !== null)) session.cost = { usd: total, estimated: true, added: info.summary?.additions || 0, removed: info.summary?.deletions || 0 };
            }
            if (!info.tokens) session.tokens = records.reduce((sum, record) => { for (const key of Object.keys(sum)) sum[key] += record[key] || 0; return sum; }, tokenUsage());
          } else if (stored) {
            // Refresh streamed costs from the recent page without reloading the full history each poll.
            stored.records = [...new Map([...stored.records, ...usageRecords(messages)].map(record => [record.id, record])).values()];
          }
        }
      } catch {
        incomplete ||= monthly;
        session = { ...(prior || openCodeSession(info)), messagesState: prior?.messages?.length ? 'stale' : 'unavailable' };
      }
      if (monthly && !this.usage.has(info.id)) incomplete = true;
      if (!info.time?.archived) {
        session ||= openCodeSession(info);
        Object.assign(session, { status: working ? 'working' : 'idle', control: true, messaging: { send: true, interrupt: true },
          detail: status === 'retry' ? 'OpenCode is retrying the request' : '', updatedAt: info.time?.updated || 0 });
        this.sessions.set(info.id, session);
      }
    });
    this.controller.signal.throwIfAborted();
    this.connected = true; this.detail = rows.length >= maxSessions ? `Showing the latest ${maxSessions} OpenCode sessions.` : '';
    this.usageIncomplete = incomplete; this.usageUpdatedAt = this.now();
    this.syncRequests(requests);
  }
  syncRequests(requests) {
    const keys = new Set();
    for (const { request, kind, directory } of requests) {
      if (typeof request.id !== 'string' || !/^[\w-]+$/.test(request.id)) continue;
      const key = `opencode:${kind}:${request.id}`, sessionId = `opencode:${request.sessionID}`; keys.add(key);
      const questions = kind === 'question' ? (request.questions || []).map((q, i) => ({ id: String(i), question: q.question, options: q.options, multiSelect: !!q.multiple, allowOther: q.custom !== false })) : undefined;
      const view = kind === 'question' ? { questions, title: request.title || 'A question for you', ...(request.unsupported ? { unsupported: 'Answer this form in OpenCode.' } : {}) } : {
        title: request.permission || 'Permission request', command: request.metadata?.command,
        details: { patterns: request.patterns, ...request.metadata }, denyMessage: true,
        actions: [{ value: 'accept', label: 'Allow once' }, { value: 'decline', label: 'Deny' }],
      };
      this.store.add({ provider: 'opencode', sessionId, kind, ...view }, async answer => {
        this.require(request.sessionID);
        const pending = await this.api.requests(kind, directory);
        if (!pending.some(item => item.id === request.id && item.sessionID === request.sessionID)) throw fail('This OpenCode request was already answered.', 409);
        await this.api.reply(kind, request, directory, answer, questions);
      }, key);
    }
    for (const key of this.requestKeys) if (!keys.has(key)) this.store.removeSource(key);
    this.requestKeys = keys;
  }
  usageSnapshot() {
    const periods = usagePeriods([...this.usage.values()].flatMap(value => value.records), this.now());
    const incomplete = this.usageIncomplete || periods.some(period => period.incomplete);
    const missing = [...this.usage].flatMap(([id, value]) => value.records.filter(record => record.usd === null && record.at >= periods[1].from && record.at <= this.now()).map(record => ({ ...record, working: this.sessions.get(id)?.status === 'working' })));
    const updating = !this.usageIncomplete && missing.length > 0 && missing.every(record => record.pending && record.working);
    return { provider: 'opencode', name: 'OpenCode', windows: [], periods: this.usageUpdatedAt ? periods : [], updatedAt: this.usageUpdatedAt,
      status: !this.connected ? this.usageUpdatedAt ? 'stale' : 'unavailable' : updating ? 'updating' : incomplete ? 'partial' : 'ready',
      detail: !this.connected ? this.detail : `${updating ? 'A turn is still running; its final cost is not reported yet. ' : incomplete ? 'Some history or costs are unavailable; totals are incomplete. ' : ''}OpenCode estimates for recorded sessions, using this computer’s calendar. Free, subscription or unpriced models may report $0.`, estimated: true };
  }
  require(id) {
    nativeId(id);
    if (!this.connected) throw fail('OpenCode is disconnected. Reconnecting…', 503);
    const session = this.sessions.get(id);
    if (!session) throw fail('This OpenCode session is no longer available.', 409);
    return session;
  }
  async history(id, limit = 40) {
    const session = this.require(id), rows = await this.api.messages(id, session.cwd, limit + 1);
    return { messages: openCodeMessages(rows, limit), more: rows.length > limit };
  }
  async sendMessage(id, body) {
    const session = this.require(id), text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (typeof text !== 'string' || !text || text.length > 12_000) throw fail('Enter a message of up to 12,000 characters.');
    if (slashCommand(text)) throw fail('Use OpenCode’s terminal for slash commands.');
    if (typeof body.clientMessageId !== 'string' || !/^[\w:-]{1,120}$/.test(body.clientMessageId)) throw fail('Invalid message ID.');
    const key = `${id}:${body.clientMessageId}`, existing = this.submissions.get(key);
    if (existing) { if (existing.text !== text) throw fail('This message ID was already used.'); return existing.promise; }
    // Retain ambiguous failures as well as successes: a timed-out POST must never be resent automatically.
    const promise = this.api.send(id, session.cwd, text)
      .then(() => { session.status = 'working'; return { status: 'sent' }; });
    this.submissions.set(key, { text, promise });
    if (this.submissions.size > 1000) this.submissions.delete(this.submissions.keys().next().value);
    return promise;
  }
  async interrupt(id) {
    const session = this.require(id);
    await this.api.interrupt(id, session.cwd);
    await this.refresh(); return { status: 'interrupted' };
  }
  async spawn(cwd) {
    if (!this.connected) throw fail('OpenCode is disconnected. Start its server first.', 503);
    const info = await this.api.create(cwd);
    nativeId(info.id); this.sessions.set(info.id, openCodeSession(info));
    return { sessionId: `opencode:${info.id}` };
  }
}
