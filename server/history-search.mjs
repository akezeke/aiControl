import { constants } from 'node:fs';
import { mkdir, open, opendir, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { claudeMessages, claudeTitles, textContent } from './messages.mjs';
import { fail } from './requests.mjs';

// The adapter's history() requires a live session. Its protocol API can read archives too,
// and already normalizes both supported OpenCode versions into the same text messages.
export function openCodeHistorySource(api, { maxSessions = 50, messageLimit = 200 } = {}) {
  maxSessions = Math.max(1, Math.min(100, Math.floor(maxSessions)));
  messageLimit = Math.max(1, Math.min(500, Math.floor(messageLimit)));
  return async () => {
    const rows = await api.sessions(maxSessions), sessions = [];
    let next = 0, partial = false, truncated = rows.length >= maxSessions;
    const deadline = Date.now() + 8000;
    const worker = async () => {
      while (next < Math.min(rows.length, maxSessions)) {
        if (Date.now() >= deadline) { partial = true; truncated = true; return; }
        const row = rows[next++];
        if (typeof row?.id !== 'string' || !/^[\w-]+$/.test(row.id)) { partial = true; continue; }
        try {
          const history = await api.history(row.id, row.directory, messageLimit);
          truncated ||= history.more === true;
          sessions.push({ id: `opencode:${row.id}`, provider: 'opencode', title: row.title, cwd: row.directory, updatedAt: row.time?.updated,
            messages: history.messages, historyMore: history.more === true });
        } catch { partial = true; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, worker));
    return { sessions, partial, truncated };
  };
}

const maxMessageText = 12_000, maxMessages = 1000, maxSessionBytes = 512 * 1024;
const idOK = id => typeof id === 'string' && /^(codex|claude|opencode):[\w:.-]{1,240}$/.test(id);
const text = (value, limit = 240) => typeof value === 'string' ? value.replaceAll('\0', '').slice(0, limit) : '';
const time = value => Number.isFinite(value) ? value : typeof value === 'string' ? Date.parse(value) || 0 : 0;
const within = (root, path) => { const rel = relative(root, path); return rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep); };

function safeSession(session) {
  if (!idOK(session?.id)) return null;
  const messages = [];
  for (const raw of (Array.isArray(session.messages) ? session.messages : []).slice(-maxMessages)) {
    if (!raw || !['user', 'assistant', 'notice'].includes(raw.role) || typeof raw.id !== 'string' || !raw.id || typeof raw.text !== 'string' || !raw.text.trim()) continue;
    messages.push({ id: text(raw.id, 500), role: raw.role, text: text(raw.text, maxMessageText), timestamp: time(raw.timestamp) || null,
      truncated: raw.truncated === true || raw.text.length > maxMessageText, ...(raw.tool === true ? { tool: true } : {}), ...(raw.error === true ? { error: true } : {}) });
  }
  const provider = session.id.split(':')[0], cwd = text(session.cwd, 8192);
  const result = { id: session.id, nativeId: session.id.slice(provider.length + 1), provider, title: text(session.title) || `${provider} session`, cwd,
    project: text(session.project) || basename(cwd), account: text(session.account), updatedAt: time(session.updatedAt), messages, historyMore: session.historyMore === true || session.messages?.length > maxMessages };
  let bytes = 0, start = messages.length;
  while (start > 0 && bytes + Buffer.byteLength(JSON.stringify(messages[start - 1])) <= maxSessionBytes) bytes += Buffer.byteLength(JSON.stringify(messages[--start]));
  if (start) { result.messages = messages.slice(start); result.historyMore = true; }
  return result;
}

function merge(previous, next) {
  if (!previous) return next;
  const messages = new Map(previous.messages.map(message => [message.id, message]));
  for (const message of next.messages) messages.set(message.id, message);
  return safeSession({ ...previous, ...next, updatedAt: Math.max(previous.updatedAt, next.updatedAt), historyMore: previous.historyMore || next.historyMore,
    messages: [...messages.values()].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)) });
}

function excerpt(value, query = '') {
  const found = query ? value.toLocaleLowerCase().indexOf(query) : 0, start = Math.max(0, found - 180), end = Math.min(value.length, start + 600);
  return `${start ? '…' : ''}${value.slice(start, end)}${end < value.length ? '…' : ''}`;
}

// A head window retains session metadata; a tail window supplies recent conversation when a
// transcript exceeds its budget. Offsets make synthetic message IDs stable as the file grows.
async function readTranscript(file, root, budget) {
  let handle;
  try {
    const path = await realpath(file);
    if (!within(root, path)) return null;
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile()) return null;
    const cap = Math.min(info.size, budget), head = info.size > cap ? Math.min(32 * 1024, Math.floor(cap / 4)) : cap;
    const windows = [[0, head], ...(info.size > cap ? [[info.size - (cap - head), cap - head]] : [])];
    const lines = [];
    for (const [offset, length] of windows) {
      const buffer = Buffer.alloc(length), { bytesRead } = await handle.read(buffer, 0, length, offset);
      let start = offset > 0 ? buffer.indexOf(10) + 1 : 0;
      if (offset > 0 && start === 0) continue;
      while (start < bytesRead) {
        let end = buffer.indexOf(10, start);
        if (end < 0 || end >= bytesRead) { if (offset + bytesRead < info.size) break; end = bytesRead; }
        lines.push({ offset: offset + start, text: buffer.toString('utf8', start, end) });
        start = end + 1;
      }
    }
    return { lines, bytes: cap, truncated: info.size > cap, modifiedAt: info.mtimeMs };
  } catch (error) { if (['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES'].includes(error.code)) return null; throw error; }
  finally { await handle?.close(); }
}

function parseTranscript(source, transcript) {
  const rows = transcript.lines.flatMap(line => { try { return [{ ...line, row: JSON.parse(line.text) }]; } catch { return []; } });
  if (source.provider === 'claude') {
    const nativeId = basename(source.path, '.jsonl'), matching = rows.filter(({ row }) => !row.sessionId || row.sessionId === nativeId);
    const titles = claudeTitles(matching.map(line => line.text), nativeId), cwd = matching.find(({ row }) => typeof row.cwd === 'string')?.row.cwd || '';
    const messages = claudeMessages(matching.map(line => line.text), nativeId, new Set(), { all: true });
    return safeSession({ id: `claude:${nativeId}`, provider: 'claude', cwd, title: titles.customTitle || titles.aiTitle || messages.find(message => message.role === 'user')?.text,
      account: source.account, updatedAt: transcript.modifiedAt, messages, historyMore: transcript.truncated });
  }
  const meta = rows.find(({ row }) => row.type === 'session_meta')?.row.payload;
  if (!meta?.id || typeof meta.id !== 'string') return null;
  const responses = rows.filter(({ row }) => row.type === 'response_item' && row.payload?.type === 'message' && ['user', 'assistant'].includes(row.payload.role));
  const paired = new Set(responses.map(({ row }) => `${row.payload.role}\0${textContent(row.payload.content)}`));
  const messages = [];
  for (const { row, offset } of rows) {
    const payload = row.payload;
    if (row.type === 'response_item' && payload?.type === 'message' && ['user', 'assistant'].includes(payload.role)) {
      messages.push({ id: payload.id || `archive:${offset}`, role: payload.role, text: textContent(payload.content), timestamp: time(row.timestamp) });
    } else if (row.type === 'event_msg' && ['user_message', 'agent_message'].includes(payload?.type) && typeof payload.message === 'string') {
      const role = payload.type === 'user_message' ? 'user' : 'assistant';
      if (!paired.has(`${role}\0${payload.message}`)) messages.push({ id: payload.id || `archive:${offset}`, role, text: payload.message, timestamp: time(row.timestamp) });
    }
  }
  return safeSession({ id: `codex:${meta.id}`, provider: 'codex', cwd: meta.cwd, title: meta.title || messages.find(message => message.role === 'user')?.text,
    updatedAt: transcript.modifiedAt, messages, historyMore: transcript.truncated });
}

export class HistorySearch {
  #observed = new Map(); #archives = new Map(); #live = new Set(); #queue = Promise.resolve(); #refreshing = null; #refreshed = 0; #partial = false; #truncated = false; #retainedTruncated = false; #encoded = '';
  constructor({ file, codexRoots = [], claudeAccounts = [], sources = [], maxFileBytes = 2 * 1024 * 1024, maxScanBytes = 32 * 1024 * 1024, maxFiles = 1000, maxSessions = 500, maxBytes = 12 * 1024 * 1024, refreshMs = 30_000 } = {}) {
    Object.assign(this, { file, sources, maxFileBytes, maxScanBytes, maxFiles, maxSessions, maxBytes, refreshMs });
    this.roots = [...codexRoots.flatMap(root => ['sessions', 'archived_sessions'].map(folder => ({ path: join(root, folder), provider: 'codex' }))),
      ...claudeAccounts.map(account => ({ path: account.projectsDir, provider: 'claude', account: account.label || '' }))].filter(root => typeof root.path === 'string');
  }
  async load() {
    if (!this.file) return this;
    let handle;
    try {
      handle = await open(this.file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile() || info.size > this.maxBytes) throw fail('History index is too large or is not a regular file.', 413);
      const buffer = Buffer.alloc(info.size), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const saved = JSON.parse(buffer.toString('utf8', 0, bytesRead));
      if (!Array.isArray(saved.sessions)) throw fail('Invalid history index.', 400);
      for (const raw of saved.sessions.slice(-this.maxSessions)) { const session = safeSession(raw); if (session) this.#observed.set(session.id, session); }
      this.#retainedTruncated = saved.truncated === true || saved.sessions.length > this.maxSessions;
      this.#encoded = JSON.stringify({ sessions: [...this.#observed.values()], truncated: this.#retainedTruncated });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally { await handle?.close(); }
    return this;
  }
  observe(sessions = []) {
    const safe = sessions.slice(0, this.maxSessions).map(safeSession).filter(Boolean);
    const run = this.#queue.then(async () => {
      this.#live = new Set(safe.map(session => session.id));
      for (const session of safe) this.#observed.set(session.id, merge(this.#observed.get(session.id), session));
      this.#retainedTruncated ||= sessions.length > this.maxSessions || this.#observed.size > this.maxSessions;
      const records = [...this.#observed.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, this.maxSessions);
      let remaining = this.maxBytes - 64;
      this.#observed = new Map(records.filter(session => { remaining -= Buffer.byteLength(JSON.stringify(session)) + 1; if (remaining < 0) this.#retainedTruncated = true; return remaining >= 0; }).map(session => [session.id, session]));
      const encoded = JSON.stringify({ sessions: [...this.#observed.values()], truncated: this.#retainedTruncated });
      if (!this.file || encoded === this.#encoded) return;
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${randomUUID()}.tmp`; let handle;
      try {
        handle = await open(temporary, 'wx', 0o600); await handle.writeFile(encoded); await handle.sync(); await handle.close(); handle = null;
        await rename(temporary, this.file); this.#encoded = encoded;
      } finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    });
    this.#queue = run.catch(() => {}); return run;
  }
  async #refresh() {
    if (this.#refreshed && Date.now() - this.#refreshed < this.refreshMs) return;
    return this.#refreshing ??= this.#discover().finally(() => { this.#refreshing = null; this.#refreshed = Date.now(); });
  }
  async #discover() {
    const archived = new Map(); let bytes = 0, files = 0, entries = 0, partial = false, truncated = false;
    const retain = raw => {
      const session = safeSession(raw);
      if (!session) return;
      if (!archived.has(session.id) && archived.size >= this.maxSessions) { truncated = true; return; }
      archived.set(session.id, merge(archived.get(session.id), session));
    };
    for (const source of this.roots) {
      let root;
      try { root = await realpath(source.path); } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) partial = true; continue; }
      const folders = [{ path: root, depth: 0 }];
      while (folders.length && files < this.maxFiles && bytes < this.maxScanBytes && entries < this.maxFiles * 20) {
        const folder = folders.shift();
        try {
          const directory = await opendir(folder.path);
          for await (const entry of directory) {
            if (++entries > this.maxFiles * 20 || files >= this.maxFiles || bytes >= this.maxScanBytes) { truncated = true; break; }
            const path = join(folder.path, entry.name);
            if (entry.isDirectory() && folder.depth < 7 && entry.name !== 'subagents') folders.push({ path, depth: folder.depth + 1 });
            if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
            files++;
            const transcript = await readTranscript(path, root, Math.min(this.maxFileBytes, this.maxScanBytes - bytes));
            if (!transcript) continue;
            bytes += transcript.bytes; truncated ||= transcript.truncated;
            retain(parseTranscript({ ...source, path }, transcript));
          }
        } catch { partial = true; }
      }
      if (folders.length) truncated = true;
    }
    for (const source of this.sources.slice(0, 8)) {
      let timer;
      try {
        const result = await Promise.race([source(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('History source timed out')), 10_000); })]);
        const sessions = Array.isArray(result) ? result : result?.sessions;
        if (!Array.isArray(sessions)) { partial = true; continue; }
        truncated ||= sessions.length > this.maxSessions || result.truncated === true; partial ||= result.partial === true;
        for (const session of sessions.slice(0, this.maxSessions)) retain(session);
      } catch { partial = true; }
      finally { clearTimeout(timer); }
    }
    let remaining = this.maxBytes;
    this.#archives = new Map([...archived.values()].sort((a, b) => b.updatedAt - a.updatedAt).filter(session => {
      remaining -= Buffer.byteLength(JSON.stringify(session)); if (remaining < 0) { truncated = true; return false; } return true;
    }).map(session => [session.id, session]));
    this.#partial = partial; this.#truncated = truncated;
  }
  #sessions() {
    const sessions = new Map(this.#archives);
    for (const session of this.#observed.values()) {
      const archived = sessions.get(session.id);
      // The last observed message may have been an unfinished stream. Once its session is
      // absent, the native archive owns duplicate message IDs; retained older messages remain.
      sessions.set(session.id, archived && !this.#live.has(session.id) ? merge(session, archived) : merge(archived, session));
    }
    return [...sessions.values()];
  }
  async search(query, { provider = '', project = '', limit = 50 } = {}) {
    if (typeof query !== 'string' || query.length > 1000 || !Number.isInteger(limit) || limit < 1 || limit > 100 || typeof provider !== 'string' || typeof project !== 'string') throw fail('Invalid history search.', 400);
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return { results: [], truncated: false, partial: false };
    await this.#queue; await this.#refresh();
    const matches = []; let count = 0, truncated = this.#truncated || this.#retainedTruncated;
    const newest = (a, b) => (b.timestamp || b.session.updatedAt) - (a.timestamp || a.session.updatedAt);
    for (const session of this.#sessions()) {
      if (provider && provider !== 'all' && session.provider !== provider || project && project !== 'all' && session.project !== project && session.cwd !== project) continue;
      truncated ||= session.historyMore;
      for (let index = 0; index < session.messages.length; index++) {
        const message = session.messages[index];
        if (!message.text.toLocaleLowerCase().includes(needle)) continue;
        count++;
        const { messages, historyMore, ...metadata } = session;
        matches.push({ sessionId: session.id, messageId: message.id, role: message.role, timestamp: message.timestamp, text: excerpt(message.text, needle), session: metadata,
          archived: !this.#live.has(session.id), context: messages.slice(Math.max(0, index - 1), index + 2).map(item => ({ id: item.id, role: item.role, text: excerpt(item.text, needle) })) });
        matches.sort(newest);
        if (matches.length > limit) matches.pop();
      }
    }
    return { results: matches, truncated: truncated || count > limit, partial: this.#partial };
  }
  async session(id) {
    if (!idOK(id)) return null;
    await this.#queue; await this.#refresh();
    const session = this.#sessions().find(session => session.id === id);
    return session ? structuredClone({ ...session, archived: !this.#live.has(id), readOnly: true, control: false, messaging: {}, status: 'archived', messagesState: session.messages.length ? 'ready' : 'empty' }) : null;
  }
}
