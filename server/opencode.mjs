import { fail, slashCommand } from './requests.mjs';
import { openCodeSession, usageRecords, usagePeriods, weeklyUsage, budgetCycle, budgetUsage, tokenUsage } from './opencode-data.mjs';
import { messageLimit } from './messages.mjs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OpenCodeAPI } from './opencode-api.mjs';
import { fireOpenCode } from './opencode-fire.mjs';
import { OpenCodeImages } from './opencode-images.mjs';
import { uploadedImages, uploadDigest } from './uploads.mjs';

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
        if (size > 32 * 1024 * 1024) throw Object.assign(fail('OpenCode history is too large to read. Usage may be incomplete.', 503), { tooLarge: true });
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
    this.budget = { mode: 'weekly', usd: null, day: 7 };
    this.sessions = new Map(); this.usage = new Map(); this.requestKeys = new Set(); this.submissions = new Map();
    this.modelCatalogs = new Map(); this.chosenSettings = new Map();
    this.images = new OpenCodeImages();
    this.firing = new Set(); this.sending = new Set(); this.archived = new Set();
    this.controller = new AbortController(); this.fetch = fetcher; this.serviceFile = serviceFile;
    if (this.config && !this.config.service) this.connect(this.config);
    this.connected = false; this.detail = this.config ? 'Connecting to OpenCode…' : ''; this.usageUpdatedAt = null;
  }
  connect(config) {
    this.modelCatalogs.clear();
    this.client = new OpenCodeClient(config, { fetch: this.fetch, signal: this.controller.signal });
    this.api = new OpenCodeAPI(this.client);
  }
  start() {
    if (!this.config || this.timer) return;
    this.refresh(); this.timer = setInterval(() => this.refresh(), this.intervalMs); this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); this.timer = null; this.controller.abort(); this.images.clear(); this.disconnect('OpenCode disconnected.'); }
  disconnect(detail) {
    this.connected = false; this.detail = detail;
    for (const key of this.requestKeys) this.store.removeSource(key);
    this.requestKeys.clear();
    for (const session of this.sessions.values()) { session.status = 'offline'; session.control = false; session.messaging = { send: false, interrupt: false }; }
  }
  list() { return [...this.sessions.values()].map(session => ({ ...session, ...this.chosenSettings.get(session.nativeId), messaging: { ...session.messaging, images: this.connected, model: this.connected, effort: this.connected, fire: this.connected && this.api.v2 && !session.parentId } })); }
  fire(id) { return fireOpenCode(this, id); }
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
    for (const id of this.archived) if (!infos.some(info => info.id === id && !info.time?.archived)) this.archived.delete(id);
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
    for (const [id, session] of this.sessions) if (!live.has(id)) { this.sessions.delete(id); this.images.delete(id); this.store.removeSession(session.id); }
    const all = new Set(infos.map(info => info.id));
    for (const id of this.usage.keys()) if (!all.has(id)) this.usage.delete(id);
    const month = this.usageSince();
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
          // If the full read fails, the transcript must still update; usage stays incomplete.
          let complete = null;
          if (readUsage) try { complete = await this.api.messages(nativeId(info.id), info.directory); } catch { incomplete ||= monthly; }
          const history = complete ? { rows: complete } : await this.api.history(nativeId(info.id), info.directory, messageLimit);
          const messages = history.rows;
          this.controller.signal.throwIfAborted();
          if (!info.time?.archived) this.images.rememberRows(info.id, messages, info.directory);
          session = openCodeSession(info, messages, prior, history.more);
          if (complete) {
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
      if (!info.time?.archived && !this.archived.has(info.id)) {
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
  // Oldest timestamp any usage view needs.
  usageSince() { return Math.min(usagePeriods([], this.now())[1].from, weeklyUsage([], this.now()).from, budgetCycle(this.budget, this.now()).from); }
  usageSnapshot() {
    const records = [...this.usage.values()].flatMap(value => value.records), periods = usagePeriods(records, this.now()), week = weeklyUsage(records, this.now());
    const cycle = budgetCycle(this.budget, this.now()), spent = budgetUsage(records, cycle, this.now());
    const incomplete = this.usageIncomplete || week.incomplete || spent.incomplete || periods.some(period => period.incomplete);
    const since = this.usageSince();
    const missing = [...this.usage].flatMap(([id, value]) => value.records.filter(record => record.usd === null && record.at >= since && record.at <= this.now()).map(record => ({ ...record, working: this.sessions.get(id)?.status === 'working' })));
    const updating = !this.usageIncomplete && missing.length > 0 && missing.every(record => record.pending && record.working);
    return { provider: 'opencode', name: 'OpenCode', windows: [], periods: this.usageUpdatedAt ? periods : [], week: this.usageUpdatedAt ? week : null, budget: { ...this.budget, ...cycle, spent: spent.usd }, updatedAt: this.usageUpdatedAt,
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
    const session = this.require(id), history = await this.api.history(id, session.cwd, limit);
    this.images.rememberRows(id, history.rows, session.cwd);
    return { messages: history.messages, more: history.more };
  }
  async imageList(id) { this.require(id); return { images: await this.images.list(id) }; }
  async image(id, imageId) {
    this.require(id);
    const image = await this.images.get(id, imageId);
    if (!image) throw fail('Image not found.', 404);
    return image;
  }
  async modelsFor(cwd) {
    const cached = this.modelCatalogs.get(cwd);
    if (cached && this.now() - cached.at < 60_000) return cached.models;
    const models = await this.api.models(cwd); this.modelCatalogs.set(cwd, { at: this.now(), models });
    if (this.modelCatalogs.size > 100) this.modelCatalogs.delete(this.modelCatalogs.keys().next().value);
    return models;
  }
  async modelOptions(id) { return this.modelsFor(this.require(id).cwd); }
  async setModel(id, model, effort) {
    const session = this.require(id), selected = (await this.modelOptions(id)).find(option => option.id === model);
    if (!selected) throw fail('Unknown model. Refresh the model list.');
    const current = effort ?? this.chosenSettings.get(id)?.effort ?? session.effort;
    const settings = { model, effort: selected.efforts.includes(current) ? current : '', efforts: selected.efforts };
    const result = await this.api.selectModel(id, settings.model, settings.effort);
    Object.assign(session, settings);
    if (!this.api.v2) this.chosenSettings.set(id, settings);
    return { ok: true, ...result, ...settings };
  }
  async setEffort(id, effort) {
    const session = this.require(id), model = this.chosenSettings.get(id)?.model || session.model;
    const selected = (await this.modelOptions(id)).find(option => option.id === model);
    if (typeof effort !== 'string' || (effort && !selected?.efforts.includes(effort))) throw fail('Unknown effort level.');
    return this.setModel(id, model, effort);
  }
  async sendMessage(id, body) {
    if (this.firing.has(id)) throw fail('This session is being archived.', 409);
    const session = this.require(id), text = typeof body?.text === 'string' ? body.text.trim() : '', images = uploadedImages(body?.images);
    if (typeof text !== 'string' || !(text || images.length) || text.length > 12_000) throw fail('Enter a message of up to 12,000 characters.');
    if (slashCommand(text)) throw fail('Use OpenCode’s terminal for slash commands.');
    if (typeof body.clientMessageId !== 'string' || !/^[\w:-]{1,120}$/.test(body.clientMessageId)) throw fail('Invalid message ID.');
    const key = `${id}:${body.clientMessageId}`, existing = this.submissions.get(key), digest = uploadDigest(images);
    if (existing) { if (existing.text !== text || existing.digest !== digest) throw fail('This message ID was already used.'); return existing.promise; }
    if (this.sending.has(id)) throw fail('A message is being sent. Wait for it to finish.', 409);
    // Retain ambiguous failures as well as successes: a timed-out POST must never be resent automatically.
    this.sending.add(id);
    const promise = this.api.send(id, session.cwd, text, this.chosenSettings.get(id), images)
      .then(() => { session.status = 'working'; return { status: 'sent' }; }).finally(() => this.sending.delete(id));
    this.submissions.set(key, { text, digest, promise });
    if (this.submissions.size > 1000) this.submissions.delete(this.submissions.keys().next().value);
    return promise;
  }
  async interrupt(id) {
    const session = this.require(id);
    await this.api.interrupt(id, session.cwd);
    await this.refresh(); return { status: 'interrupted' };
  }
  async spawn(cwd, settings = {}) {
    if (!this.connected) throw fail('OpenCode is disconnected. Start its server first.', 503);
    if (settings.model) {
      const model = (await this.modelsFor(cwd)).find(model => model.id === settings.model);
      if (!model) throw fail('The saved OpenCode model is unavailable. Choose another model in an existing session.');
      if (settings.effort && !model.efforts.includes(settings.effort)) settings = { ...settings, effort: '' };
    }
    const info = await this.api.create(cwd, settings);
    nativeId(info.id); this.sessions.set(info.id, openCodeSession(info));
    if (settings.model) { Object.assign(this.sessions.get(info.id), settings); if (!this.api.v2) this.chosenSettings.set(info.id, settings); }
    return { sessionId: `opencode:${info.id}` };
  }
}
