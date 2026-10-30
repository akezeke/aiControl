import { homedir } from 'node:os';
import { join } from 'node:path';
import { claudeCredentials } from './claude-credentials.mjs';

export const usageRefreshMs = 5 * 60_000;
const unavailable = detail => Object.assign(new Error(detail), { usageDetail: detail });
const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const timestamp = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 8.64e15 ? value : null;

function windowLabel(minutes, fallback) {
  if (minutes === 10080) return 'Weekly';
  if (minutes > 0 && minutes % 1440 === 0) return `${minutes / 1440}-day`;
  if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60}-hour`;
  return minutes > 0 ? `${minutes}-minute` : fallback;
}

export function codexUsageWindows(data) {
  if (!data || (!data.rateLimits && !data.rateLimitsByLimitId)) throw unavailable('Codex did not return usage limits.');
  const buckets = data.rateLimitsByLimitId && Object.keys(data.rateLimitsByLimitId).length
    ? Object.entries(data.rateLimitsByLimitId) : [[data.rateLimits?.limitId || 'codex', data.rateLimits]];
  return buckets.flatMap(([id, bucket]) => ['primary', 'secondary'].flatMap(key => {
    const window = bucket?.[key];
    if (!percent(window?.usedPercent)) return [];
    const scope = id === 'codex' ? '' : bucket.limitName || id;
    return [{ id: `${id}:${key}`, label: windowLabel(window.windowDurationMins, key === 'primary' ? 'Primary window' : 'Secondary window'), scope, usedPercent: window.usedPercent, resetsAt: timestamp(window.resetsAt * 1000) }];
  }));
}

export function claudeUsageWindows(data) {
  if (!data || typeof data !== 'object' || !Object.keys(data).some(key => /^(five_hour|seven_day(?:_[a-z0-9_]+)?)$/.test(key))) throw unavailable('Claude did not return usage limits.');
  return Object.entries(data).flatMap(([id, window]) => {
    if (!/^(five_hour|seven_day(?:_[a-z0-9_]+)?)$/.test(id) || !percent(window?.utilization)) return [];
    const scope = { seven_day_opus: 'Opus', seven_day_sonnet: 'Sonnet', seven_day_oauth_apps: 'OAuth apps', seven_day_overage_included: 'Included extra usage' }[id]
      || (id.startsWith('seven_day_') ? id.slice(10).replaceAll('_', ' ') : '');
    return [{ id, label: id === 'five_hour' ? '5-hour' : 'Weekly', scope, usedPercent: window.utilization, resetsAt: timestamp(typeof window.resets_at === 'string' ? Date.parse(window.resets_at) : null) }];
  });
}

// Credentials stay on the server. Read the current CLI token on every refresh;
// let Claude Code own token renewal so we never race its refresh-token rotation.
export function claudeUsageReader({ credentialsFile = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), '.credentials.json'), readCredentials = claudeCredentials, fetchUsage = fetch, now = Date.now } = {}) {
  return async signal => {
    let auth;
    try { auth = (await readCredentials(credentialsFile)).claudeAiOauth; }
    catch { throw unavailable('Sign in to Claude Code on this computer to see usage.'); }
    if (typeof auth?.accessToken !== 'string' || !auth.accessToken) throw unavailable('Sign in to Claude Code on this computer to see usage.');
    if (typeof auth.expiresAt === 'number' && auth.expiresAt <= now()) throw unavailable('Claude login expired. Open Claude Code to renew it.');
    if (Array.isArray(auth.scopes) && !auth.scopes.includes('user:profile')) throw unavailable('This Claude login does not provide account usage.');
    const response = await fetchUsage('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${auth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
      redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (response.status === 401 || response.status === 403) throw unavailable('Claude usage access was refused. Check your login in Claude Code.');
    if (response.status === 429) throw unavailable('Claude usage is temporarily rate limited. Retrying in five minutes.');
    if (!response.ok) throw unavailable('Claude usage is unavailable. Retrying in five minutes.');
    return claudeUsageWindows(await response.json());
  };
}

// One server-side poll per provider, shared by every dashboard tab. Failed
// requests retain the last successful values and timestamp, explicitly stale.
export class UsagePoller {
  constructor(provider, name, read, { now = Date.now, intervalMs = usageRefreshMs } = {}) {
    this.provider = provider; this.name = name; this.read = read; this.now = now; this.intervalMs = intervalMs;
    this.windows = []; this.updatedAt = null; this.status = 'loading'; this.detail = 'Loading usage…'; this.revision = 0;
  }
  start() {
    if (this.timer) return;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), this.intervalMs);
    this.timer.unref?.();
  }
  update(windows) {
    this.revision++;
    this.windows = windows; this.updatedAt = this.now(); this.status = 'ready';
    this.detail = windows.length ? '' : 'No usage windows reported for this account.';
  }
  refresh() {
    if (this.pending) return this.pending.promise;
    const request = { controller: new AbortController(), revision: this.revision };
    this.pending = request;
    request.promise = Promise.resolve().then(() => {
      if (this.pending === request) return this.read(request.controller.signal);
    }).then(windows => {
      if (this.pending === request && this.revision === request.revision) this.update(windows);
    }).catch(error => {
      if (this.pending !== request || this.revision !== request.revision) return;
      this.status = this.updatedAt !== null ? 'stale' : 'unavailable';
      this.detail = error.usageDetail || `${this.name} usage could not be refreshed. Retrying in five minutes.`;
    }).finally(() => { if (this.pending === request) this.pending = null; });
    return request.promise;
  }
  stop(detail = 'Usage updates are disconnected.') {
    clearInterval(this.timer); this.timer = null;
    this.pending?.controller.abort(); this.pending = null;
    this.status = this.updatedAt !== null ? 'stale' : 'unavailable'; this.detail = detail;
  }
  reset() {
    this.stop(); this.windows = []; this.updatedAt = null; this.status = 'loading'; this.detail = 'Loading usage…'; this.revision++;
  }
  snapshot() {
    const overdue = this.updatedAt !== null && this.now() - this.updatedAt > this.intervalMs * 2;
    return { provider: this.provider, name: this.name, windows: this.windows, updatedAt: this.updatedAt, status: overdue && this.status === 'ready' ? 'stale' : this.status, detail: overdue && this.status === 'ready' ? 'Waiting for fresh usage data.' : this.detail };
  }
}
