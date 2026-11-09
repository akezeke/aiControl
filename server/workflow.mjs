import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { fail } from './requests.mjs';
import { observedOverlaps, repositoryRoot, repositoryStatus, repositoryDiff } from './repository.mjs';

const bounded = (value, length) => typeof value === 'string' && value.length <= length && !value.includes('\0');

export class WorkflowService {
  constructor({ workspace, history, sessions, providers = [], decisionsFile, push }) {
    Object.assign(this, { workspace, history, sessions, providers, decisionsFile, push });
    this.roots = new Map(); this.retries = new Map(); this.observations = new Map(); this.signals = new Map();
    push?.setPolicy(workspace.snapshot().preferences.notifications);
  }
  snapshot() {
    const sessions = this.sessions().map(session => ({ ...session, repositoryRoot: this.roots.get(session.cwd)?.root || session.cwd }));
    return { workspace: this.workspace.snapshot(), overlaps: observedOverlaps(sessions) };
  }
  async patch(change) {
    const updated = await this.workspace.patch(change);
    this.push?.setPolicy(updated.preferences.notifications);
    return updated;
  }
  observe() {
    if (this.observing) return this.observing;
    this.observing = (async () => {
      const sessions = this.sessions(), now = Date.now();
      this.trackObservations(now);
      await this.history.observe(sessions);
      const directories = [...new Set(sessions.map(session => session.cwd).filter(cwd => typeof cwd === 'string' && cwd))].slice(0, 200);
      const missing = directories.filter(cwd => !this.roots.has(cwd) || now - this.roots.get(cwd).at > 60_000);
      for (let start = 0; start < missing.length; start += 4) await Promise.all(missing.slice(start, start + 4).map(async cwd => this.roots.set(cwd, { root: await repositoryRoot(cwd), at: now })));
      for (const cwd of this.roots.keys()) if (!directories.includes(cwd)) this.roots.delete(cwd);
    })().finally(() => { this.observing = null; });
    return this.observing;
  }
  trackObservations(now = Date.now()) {
    for (const { id, adapter } of this.providers) {
      if (!adapter.connected) continue;
      // Codex and OpenCode expose successful RPC/refresh times. Claude replaces
      // its sessions map only when registration discovery succeeds.
      const signal = adapter.lastSuccessAt || adapter.usageUpdatedAt || adapter.sessions;
      if (signal && signal !== this.signals.get(id)) {
        this.signals.set(id, signal);
        this.observations.set(id, typeof signal === 'number' ? signal : now);
      }
    }
  }
  health() {
    this.trackObservations();
    return { providers: this.providers.map(({ id, name, adapter }) => ({ id, name, connected: !!adapter.connected, detail: String(adapter.detail || '').slice(0, 1000),
      lastSuccessAt: this.observations.get(id) || null, recovery: [{ id: 'retry', label: adapter.connected ? 'Refresh' : 'Retry' }] })) };
  }
  async retry(id) {
    const provider = this.providers.find(provider => provider.id === id);
    if (!provider) throw fail('Unknown provider.', 404);
    if (!this.retries.has(id)) {
      const task = Promise.resolve().then(() => provider.retry()).then(() => {
        return this.health();
      }).finally(() => this.retries.delete(id));
      this.retries.set(id, task);
    }
    return this.retries.get(id);
  }
  async repository(id, path = null) {
    const session = this.sessions().find(session => session.id === id);
    if (!session || !session.cwd || session.readOnly) throw fail('Session is no longer available.', 404);
    const result = path === null ? await repositoryStatus(session.cwd) : await repositoryDiff(session.cwd, path);
    if (result.root) this.roots.set(session.cwd, { root: result.root, at: Date.now() });
    return result;
  }
  async decisions({ session = '', q = '' } = {}) {
    if (!bounded(session, 256) || !bounded(q, 1000)) throw fail('Invalid decision search.', 400);
    if (!this.decisionsFile) return { decisions: [], truncated: false };
    let handle;
    try {
      handle = await open(this.decisionsFile, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile()) throw fail('Decision history is unavailable.', 503);
      const size = Math.min(stat.size, 1024 * 1024), data = Buffer.alloc(size), { bytesRead } = await handle.read(data, 0, size, stat.size - size);
      let lines = data.toString('utf8', 0, bytesRead).split('\n'), truncated = stat.size > size;
      if (truncated) lines.shift();
      const decisions = [], needle = q.trim().toLocaleLowerCase();
      for (let index = lines.length - 1; index >= 0; index--) {
        if (!lines[index] || lines[index].length > 8192) continue;
        let row; try { row = JSON.parse(lines[index]); } catch { continue; }
        if (!row || typeof row !== 'object' || typeof row.sessionId !== 'string' || session && row.sessionId !== session) continue;
        const entry = Object.fromEntries(['at', 'sessionId', 'provider', 'requestId', 'kind', 'decision'].filter(key => typeof row[key] === 'string').map(key => [key, row[key].slice(0, 256)]));
        if (needle && !Object.values(entry).some(value => value.toLocaleLowerCase().includes(needle))) continue;
        if (decisions.length >= 200) { truncated = true; break; }
        decisions.push(entry);
      }
      return { decisions, truncated };
    } catch (error) { if (error.code === 'ENOENT') return { decisions: [], truncated: false }; throw error; }
    finally { await handle?.close(); }
  }
}
