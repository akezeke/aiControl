import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsagePoller, usageRefreshMs, codexUsageWindows, claudeUsageWindows, claudeUsageReader } from '../server/usage.mjs';
import { usageWindowView, usageUpdatedText } from '../client/usage-presentation.js';

const now = Date.parse('2026-10-27T12:00:00Z');
const window = { id: 'primary', label: '5-hour', scope: '', usedPercent: 25, resetsAt: now + 2 * 60 * 60_000 };

test('Codex prefers all metered buckets over the duplicate legacy bucket, with real window lengths', () => {
  const windows = codexUsageWindows({ rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: {
    codex: { primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: now / 1000 + 3600 }, secondary: { usedPercent: 42, windowDurationMins: 10080, resetsAt: null } },
    other: { limitName: 'Another model', primary: { usedPercent: 81.5, windowDurationMins: 60, resetsAt: now / 1000 + 300 }, secondary: null },
  } });
  assert.deepEqual(windows.map(w => [w.label, w.scope, w.usedPercent]), [['5-hour', '', 0], ['Weekly', '', 42], ['1-hour', 'Another model', 81.5]]);
  assert.equal(windows[0].resetsAt, now + 3600_000);
  assert.equal(windows[1].resetsAt, null);
  assert.deepEqual(codexUsageWindows({ rateLimits: { primary: { usedPercent: null }, secondary: { usedPercent: -1 } } }), []);
  assert.equal(codexUsageWindows({ rateLimits: { primary: { usedPercent: 10, windowDurationMins: null } } })[0].label, 'Primary window');
  assert.throws(() => codexUsageWindows({}), /did not return/);
});

test('Claude percentages are not multiplied again, and absent windows are not presented as zero', () => {
  const windows = claudeUsageWindows({ five_hour: { utilization: 23.5, resets_at: '2026-10-27T14:00:00Z' }, seven_day: null, seven_day_sonnet: { utilization: 0, resets_at: null }, seven_day_opus: { utilization: '22' }, extra_usage: { utilization: 80 } });
  assert.deepEqual(windows.map(w => [w.label, w.scope, w.usedPercent]), [['5-hour', '', 23.5], ['Weekly', 'Sonnet', 0]]);
  assert.equal(windows[0].resetsAt, now + 2 * 3600_000);
  assert.equal(windows[1].resetsAt, null);
  assert.deepEqual(claudeUsageWindows({ five_hour: null, seven_day: null }), []);
  assert.throws(() => claudeUsageWindows({ error: 'bad response' }), /did not return/);
});

test('usage polls on startup and every five minutes; dashboard snapshots never make provider requests', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now });
  let reads = 0;
  const poller = new UsagePoller('codex', 'Codex', async () => { reads++; return [window]; });
  t.after(() => poller.stop());
  poller.start(); poller.start(); await poller.pending.promise;
  assert.equal(reads, 1);
  for (let i = 0; i < 100; i++) poller.snapshot();
  t.mock.timers.tick(usageRefreshMs - 1); await Promise.resolve(); assert.equal(reads, 1);
  t.mock.timers.tick(1); await poller.pending.promise; assert.equal(reads, 2);
  assert.equal(poller.snapshot().updatedAt, now + usageRefreshMs);
  poller.stop(); t.mock.timers.tick(usageRefreshMs * 2); await Promise.resolve(); assert.equal(reads, 2);
});

test('slow requests are deduplicated and failures retain timestamped data without exposing raw errors', async () => {
  let resolve, reads = 0, failure = false, time = now;
  const poller = new UsagePoller('claude', 'Claude Code', async () => {
    reads++; if (failure) throw new Error('secret-token upstream error');
    return new Promise(done => { resolve = done; });
  }, { now: () => time });
  const pending = poller.refresh(); assert.equal(poller.refresh(), pending);
  await Promise.resolve(); assert.equal(reads, 1);
  resolve([window]); await pending; failure = true; time += usageRefreshMs;
  await poller.refresh();
  const snapshot = poller.snapshot();
  assert.equal(snapshot.status, 'stale'); assert.equal(snapshot.updatedAt, now);
  assert.deepEqual(snapshot.windows, [window]); assert.doesNotMatch(JSON.stringify(snapshot), /secret-token/);
  const unavailable = new UsagePoller('claude', 'Claude Code', async () => { throw new Error('failure'); });
  await unavailable.refresh(); assert.equal(unavailable.snapshot().status, 'unavailable');
  assert.equal(unavailable.snapshot().updatedAt, null);
});

test('disconnect and account changes discard late responses and old account data', async () => {
  let resolve, signal;
  const poller = new UsagePoller('codex', 'Codex', async value => { signal = value; return new Promise(done => { resolve = done; }); });
  poller.update([window]);
  const pending = poller.refresh(); await Promise.resolve();
  poller.reset(); assert.equal(signal.aborted, true);
  resolve([{ ...window, usedPercent: 99 }]); await pending;
  assert.deepEqual(poller.snapshot().windows, []); assert.equal(poller.snapshot().updatedAt, null);
  assert.equal(poller.snapshot().status, 'loading');
  // Stopping before the read's microtask also prevents a new outbound request.
  let reads = 0;
  const stopping = new UsagePoller('claude', 'Claude Code', async () => { reads++; return []; });
  const stopped = stopping.refresh(); stopping.stop(); await stopped; assert.equal(reads, 0);
});

async function credentials(t, auth = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-control-usage-'));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const file = join(dir, '.credentials.json');
  await writeFile(file, JSON.stringify({ claudeAiOauth: { accessToken: 'private-test-token', scopes: ['user:profile'], expiresAt: now + 3600_000, ...auth } }));
  return file;
}

test('Claude reads current credentials on each poll and only sends them to the fixed provider endpoint', async t => {
  const file = await credentials(t); const seen = [];
  const read = claudeUsageReader({ credentialsFile: file, now: () => now, fetchUsage: async (url, options) => {
    seen.push(options.headers.Authorization);
    assert.equal(url, 'https://api.anthropic.com/api/oauth/usage');
    assert.equal(options.redirect, 'error'); assert.equal(options.headers['anthropic-beta'], 'oauth-2025-04-20');
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ five_hour: { utilization: 12, resets_at: '2026-10-27T14:00:00Z' } }) };
  } });
  const result = await read(new AbortController().signal);
  await writeFile(file, JSON.stringify({ claudeAiOauth: { accessToken: 'rotated-test-token' } }));
  await read(new AbortController().signal);
  assert.deepEqual(seen, ['Bearer private-test-token', 'Bearer rotated-test-token']);
  assert.equal(result[0].usedPercent, 12); assert.doesNotMatch(JSON.stringify(result), /token|Bearer/);
});

test('Claude missing, expired and insufficient credentials do not make requests', async t => {
  const file = await credentials(t, { expiresAt: now - 1 }); let calls = 0;
  const read = claudeUsageReader({ credentialsFile: file, now: () => now, fetchUsage: async () => { calls++; } });
  await assert.rejects(read(new AbortController().signal), /expired/);
  await writeFile(file, JSON.stringify({ claudeAiOauth: { accessToken: 'test', scopes: ['user:inference'] } }));
  await assert.rejects(read(new AbortController().signal), /does not provide/);
  await rm(file); await assert.rejects(read(new AbortController().signal), /Sign in/);
  assert.equal(calls, 0);
});

test('Claude handles access errors, throttling and malformed responses as unavailable', async t => {
  const file = await credentials(t);
  for (const status of [401, 403, 429, 503, 200]) {
    const read = claudeUsageReader({ credentialsFile: file, now: () => now, fetchUsage: async () => ({ status, ok: status === 200, json: async () => ({ unexpected: true }) }) });
    const poller = new UsagePoller('claude', 'Claude Code', read);
    await poller.refresh(); assert.equal(poller.snapshot().status, 'unavailable');
    assert.deepEqual(poller.snapshot().windows, []);
    assert.doesNotMatch(JSON.stringify(poller.snapshot()), /private-test-token/);
  }
});

test('usage presentation labels expired data without inventing a reset or hiding over-limit percentages', () => {
  assert.equal(usageWindowView(window, now).resetText, 'Resets in 2h 0m');
  assert.equal(usageWindowView(window, now).shortLabel, '5h');
  assert.equal(usageWindowView(window, now).resetShortText, new Date(window.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  const weekly = usageWindowView({ ...window, label: 'Weekly', resetsAt: now + 2.5 * 86_400_000 }, now);
  assert.equal(weekly.shortLabel, 'w'); assert.equal(weekly.resetShortText, '2.5d');
  assert.equal(usageWindowView({ ...window, label: 'Weekly', resetsAt: now + 60_000 }, now).resetShortText, '<0.01d');
  const expired = usageWindowView({ ...window, usedPercent: 101.5, resetsAt: now }, now);
  assert.equal(expired.percentText, '101.5%'); assert.equal(expired.barPercent, 100);
  assert.equal(expired.expired, true); assert.match(expired.resetText, /awaiting refresh/);
  assert.equal(expired.resetShortText, 'due');
  assert.equal(usageWindowView({ ...window, resetsAt: null }, now).resetText, 'Reset time unavailable');
  assert.equal(usageWindowView({ ...window, resetsAt: null }, now).resetShortText, '—');
  assert.equal(usageWindowView({ ...window, usedPercent: 0 }, now).percentText, '0%');
  assert.match(usageUpdatedText({ updatedAt: now - usageRefreshMs }, now, true), /5m ago · stale/);
  assert.equal(usageUpdatedText({ updatedAt: null, status: 'unavailable' }, now), 'Unavailable');
});

test('usage pace projects the current rate to the reset, once the window is under way', () => {
  const now = Date.parse('2026-10-28T12:00:00Z'), hour = 3_600_000;
  assert.equal(usageWindowView({ label: '5-hour', usedPercent: 40, resetsAt: now + 3 * hour }, now).pace, 100);
  assert.equal(usageWindowView({ label: 'Weekly', usedPercent: 50, resetsAt: now + 3.5 * 24 * hour }, now).paceText, 'On pace for 100% by reset');
  assert.equal(usageWindowView({ label: '5-hour', usedPercent: 5, resetsAt: now + 4.9 * hour }, now).pace, null);
});
