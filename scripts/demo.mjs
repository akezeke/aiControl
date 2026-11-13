// Fake projects, sessions, subagents, requests and usage for screenshots.
// Runs beside a real server: own port, temporary login, no agent connections.
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { Auth, savePassword } from '../server/auth.mjs';
import { Passkeys } from '../server/passkeys.mjs';
import { RequestStore, fail } from '../server/requests.mjs';
import { createHandler } from '../server/http.mjs';
import { folderPath } from '../server/folders.mjs';
import { OfficeSeats } from '../server/seats.mjs';
import { CityTowers } from '../server/towers.mjs';
import { Battlefields } from '../server/battlefields.mjs';
import { WorkspaceStore } from '../server/workspace.mjs';
import { HistorySearch } from '../server/history-search.mjs';
import { observedOverlaps } from '../server/repository.mjs';
import { claudeRequest } from '../server/claude.mjs';
import { codexRequest } from '../server/codex.mjs';
import { root } from '../server/config.mjs';
import { createOfficeOnline, liveUpgrade } from '../server/office-online.mjs';

export async function createDemoServices({ calm = false, withLost = false } = {}) {
const pin = '1234', now = Date.now(), min = 60_000, home = '/home/demo/code';
const dataDir = await mkdtemp(join(tmpdir(), 'ai-control-demo-')), authFile = join(dataDir, 'auth.json');
const workspace = await new WorkspaceStore(join(dataDir, 'workspace.json')).load();
const history = await new HistorySearch({ file: join(dataDir, 'history.json') }).load();
const timers = new Set();
const later = (action, delay) => { const timer = setTimeout(() => { timers.delete(timer); action(); }, delay); timers.add(timer); };
const ago = minutes => now - minutes * min;
let n = 0;
const msg = (role, text, minutes, extra = {}) => ({ id: `m${++n}`, role, text, truncated: false, timestamp: ago(minutes), ...extra });
const tool = (text, minutes, extra) => msg('assistant', text, minutes, { tool: true, ...extra });
const steps = (done, ...names) => names.map((step, i) => ({ step, status: i < done ? 'done' : i === done ? 'active' : 'pending' }));

function claude(id, project, title, status, minutes, messages, extra = {}) {
  return { id: `claude:${id}`, nativeId: id, provider: 'claude', title, cwd: `${home}/${project}`, project, status, updatedAt: ago(minutes), model: 'claude-opus-5-5', version: '2.4.1', effort: 'high', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], permissionMode: 'default', detail: '', control: true, messaging: { send: true, queue: false, via: 'tmux', images: true, interrupt: true, effort: true, fire: true, clear: true }, messages, messagesState: 'ready', ...extra };
}
function codex(id, project, title, status, minutes, messages, extra = {}) {
  return { id: `codex:${id}`, nativeId: id, provider: 'codex', title, cwd: `${home}/${project}`, project, status, updatedAt: ago(minutes), model: 'gpt-5.5-codex', effort: 'medium', efforts: ['low', 'medium', 'high', 'xhigh'], detail: '', control: true, messaging: { send: true, queue: true, images: true, interrupt: true, effort: true }, messages, messagesState: 'ready', queuedMessages: [], queueAvailable: true, queueError: '', ...extra };
}
function opencode(id, project, title, status, minutes, messages, extra = {}) {
  return { id: `opencode:${id}`, nativeId: id, provider: 'opencode', title, cwd: `${home}/${project}`, project, status, updatedAt: ago(minutes), model: 'anthropic/claude-sonnet-5', version: '2.2.5', effort: 'medium', efforts: ['low', 'medium', 'high'], detail: '', control: true, messaging: { send: true, interrupt: true, images: true, model: true, effort: true, fire: true }, messages, messagesState: 'ready', ...extra };
}
function subagent(parent, agentId, title, kind, status, minutes, messages) {
  return { ...parent, id: `${parent.id}:${agentId}`, nativeId: agentId, parentId: parent.id, title, status, updatedAt: ago(minutes), model: kind, control: false, messaging: { send: false, queue: false }, messages, branch: undefined, plan: undefined, permissionMode: undefined, context: undefined, effort: undefined, cost: undefined, lastTurnMs: undefined };
}

const weather = claude('7f3c2a10-5b9e-4d21-a8c4-0e6f1b2d3c4a', 'weather-station', 'Add humidity alerts to the dashboard', 'working', 0.2, [
  msg('user', 'Add humidity alerts: warn above 70% for more than 10 minutes, show it on the dashboard and send a push notification.', 14),
  msg('assistant', "I'll split this up: one agent maps the sensor pipeline, another drafts the alert rules. Meanwhile I'll add the threshold config.", 13),
  msg('assistant', 'Threshold config:\n\n```ts\nexport const humidityAlert = { above: 70, forMinutes: 10 };\n```', 3),
  tool('Read · src/config/alerts.ts', 2.9), tool('Edit · src/config/alerts.ts', 2.8, { editPaths: ['src/config/alerts.ts'] }), tool('Bash · Type-check', 2.6, { failed: true }), tool('Edit · src/config/alerts.ts', 2.4, { editPaths: ['src/config/alerts.ts'] }), tool('Bash · Type-check', 2.2),
  msg('assistant', 'Config is in place, and the plan is written up in `docs/humidity-alerts-plan.md`. Running the sensor tests next.', 2),
], { branch: 'feat/humidity-alerts', effort: 'xhigh', permissionMode: 'acceptEdits', context: { used: 207_000 }, lastTurnMs: 324_000, cost: { usd: 1.84, added: 96, removed: 12 },
  plan: steps(2, 'Map the sensor pipeline', 'Add threshold config', 'Run the sensor tests', 'Push notification', 'Dashboard banner') });
const sessions = [
  weather,
  subagent(weather, 'a1b2c3', 'Map the sensor pipeline', 'Explore', 'working', 0.1, [
    msg('user', 'Find where humidity readings enter the system and how they reach the dashboard.', 12),
    tool('Grep · humidity', 11), tool('Read · src/sensors/bme280.ts', 10), tool('Read · src/pipeline/aggregate.ts', 9),
    msg('assistant', 'Readings arrive every 30 s via `bme280.ts`, are averaged per minute in `aggregate.ts`, then pushed over the `/live` WebSocket.', 1),
  ]),
  subagent(weather, 'd4e5f6', 'Draft alert rules', 'general-purpose', 'idle', 4, [
    msg('user', 'Draft alert rules with hysteresis so alerts do not flap.', 12),
    tool('Write · src/alerts/rules.ts', 6, { editPaths: ['src/alerts/rules.ts'] }), tool('Edit · src/config/alerts.ts', 5, { editPaths: ['src/config/alerts.ts'] }),
    msg('assistant', 'Done. Alerts trigger at 70% after 10 minutes and clear below 65%.', 4),
  ]),
  claude('2d4f6a8c-1e3b-4c5d-9f7a-8b6c4d2e0f1a', 'weather-station', 'Fix flaky timezone test', 'idle', 95, [
    msg('user', 'The nightly summary test fails around midnight UTC. Fix it.', 120),
    msg('assistant', 'The test used the local clock. It now freezes time at `2026-03-01T23:59:30Z` and passes in every timezone. The full nightly suite is running in the background.', 95),
  ], { waitingOn: 'shell', context: { used: 60_000 }, account: 'work' }),
  codex('019a4c2e-7b1d-7e3f-a5c6-2d8e9f0a1b2c', 'recipe-api', 'Add pagination to /recipes', 'working', 1, [
    msg('user', 'Add cursor pagination to GET /recipes, 20 per page, and update the OpenAPI spec.', 8),
    tool('Shell · pnpm test -- recipes', 3), tool('Edit · src/routes/recipes.ts, openapi.yaml', 2),
    msg('assistant', 'Pagination is implemented and the spec is updated. I need to apply the database migration for the new index.', 1),
  ], { branch: 'feat/pagination', effort: 'high', context: { used: 172_000, window: 258_000 }, plan: steps(3, 'Cursor encoding', 'Route and query', 'OpenAPI spec', 'Migration for the index') }),
  codex('019a4c2e-9c3a-7f10-b2d4-6e8f0a1c3e5b', 'recipe-api', 'Review ingredient parser', 'idle', 240, [
    msg('user', 'Review the ingredient parser for edge cases.', 260),
    msg('assistant', '| Input | Parsed | Issue |\n| --- | --- | --- |\n| `1 1/2 cups flour` | 1.5 cup flour | — |\n| `salt to taste` | salt | no quantity |\n| `2-3 eggs` | 2 eggs | range dropped |', 241),
    msg('assistant', 'Only ranges like `2-3 eggs` lose information; the other edge cases parse correctly.', 240),
  ], { branch: 'main', context: { used: 20_000 } }),
  claude('5e7a9c1b-3d5f-4a6b-8c0d-2e4f6a8b0c1d', 'pixel-garden', 'Seasonal tile palette', 'working', 3, [
    msg('user', 'Make the garden tiles change with the seasons.', 20),
    msg('assistant', 'I drafted spring, summer, autumn and winter palettes. Which style should winter use?', 3),
  ], { context: { used: 90_000 }, account: 'work' }),
  codex('019a4c2f-1d2e-7a3b-c4d5-e6f708192a3b', 'home-lab', 'Upgrade Grafana dashboards', 'working', 0.5, [
    msg('user', 'Upgrade the Grafana dashboards to the new panel format and fix the broken disk usage panel.', 25),
    { ...msg('notice', 'stream disconnected before completion · retrying', 6), error: false },
    msg('assistant', 'Converted 9 of 12 dashboards. Fixing the disk panel query now: it summed devices twice.', 0.5),
  ], { branch: 'grafana-12', context: { used: 236_000, window: 258_000 }, goal: { objective: 'Every dashboard on the new panel format', status: 'active', tokensUsed: 1_200_000, tokenBudget: 3_000_000, timeUsedSeconds: 1500 } }),
  claude('8a0c2e4f-6b8d-4f1a-9c3e-5d7f9b1d3f5a', 'dotfiles', 'Tidy shell startup', 'idle', 600, [
    msg('user', 'Shell startup takes 1.2 s. Make it faster.', 640),
    msg('assistant', 'Startup is down to **180 ms**: `nvm` now loads lazily and completions are cached.', 600),
  ], { permissionMode: 'bypassPermissions', context: { used: 40_000 } }),
  opencode('ses_0a1b2c3d4e5f6a7b8c9d0e1f', 'recipe-api', 'Cache the ingredient lookups', 'working', 1, [
    msg('user', 'Cache the ingredient lookups in memory for ten minutes.', 9),
    tool('Edit · src/lookup.ts', 2),
    msg('assistant', 'Lookups are cached with a ten-minute TTL; running the tests now.', 1),
  ], { branch: 'cache-lookups', context: { used: 88_000 }, cost: { usd: 0.84, estimated: true, added: 41, removed: 9 }, plan: steps(1, 'Add a cache', 'Expire entries', 'Tests') }),
  opencode('ses_1b2c3d4e5f6a7b8c9d0e1f2a', 'home-lab', 'Draft the backup script', 'idle', 55, [
    msg('user', 'Write a restic backup script for the NAS.', 70),
    msg('assistant', 'The script backs up `/srv` nightly and prunes to 7 daily, 4 weekly snapshots.', 55),
  ], { context: { used: 31_000 }, cost: { usd: 0.37, estimated: true, added: 64, removed: 0 } }),
];

const decisionLog = [
  { at: new Date(ago(8)).toISOString(), sessionId: weather.id, provider: 'claude', requestId: randomUUID(), kind: 'permission', decision: 'allow' },
  { at: new Date(ago(18)).toISOString(), sessionId: sessions[4].id, provider: 'codex', requestId: randomUUID(), kind: 'permission', decision: 'decline' },
  { at: new Date(ago(30)).toISOString(), sessionId: sessions[6].id, provider: 'claude', requestId: randomUUID(), kind: 'question', decision: 'answered' },
];
const store = new RequestStore(async entry => { decisionLog.unshift(entry); });
// With --calm nobody is waiting on an answer, for screenshots of a quiet day.
const pending = view => { if (!calm) store.add(view, async () => {}, view.sessionId); };
pending(claudeRequest({ hook_event_name: 'PermissionRequest', session_id: weather.nativeId, tool_name: 'Bash', tool_input: { command: 'npm test -- sensors', description: 'Run the sensor tests' } }).view);
pending(codexRequest({ method: 'item/commandExecution/requestApproval', params: { threadId: sessions[4].nativeId, itemId: 'i1', reason: 'Apply the migration that adds the pagination index', command: 'pnpm prisma migrate dev --name recipes_cursor_index', cwd: sessions[4].cwd } }).view);
pending(claudeRequest({ hook_event_name: 'PermissionRequest', session_id: sessions[6].nativeId, tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which style should winter use?', header: 'Winter', multiSelect: false, options: [{ label: 'Frosted pastels', description: 'Soft blue and lilac with white highlights' }, { label: 'Deep evergreen', description: 'Dark greens with snow caps' }, { label: 'Monochrome', description: 'Greys only, like a snowy photo' }] }] } }).view);

pending(claudeRequest({ hook_event_name: 'PermissionRequest', session_id: sessions[8].nativeId, tool_name: 'Edit', tool_input: { file_path: `${home}/dotfiles/.zshrc`, old_string: 'source $NVM_DIR/nvm.sh\ncompinit', new_string: 'nvm() { unset -f nvm; source $NVM_DIR/nvm.sh; nvm "$@"; }\ncompinit -C' },
  permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Edit', ruleContent: '~/code/dotfiles/**' }], behavior: 'allow', destination: 'session' }] }).view);
// A budget week that began four days ago, so the chart has days in it whichever day the demo runs.
const weekStart = (() => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 4).getTime(); })();
const usageWindow = (id, label, usedPercent, resetMinutes, scope = '') => ({ id, label, scope, usedPercent, resetsAt: now + resetMinutes * min });
const usage = [
  { provider: 'codex', name: 'Codex', windows: [usageWindow('codex:primary', '5-hour', 38, 134), usageWindow('codex:secondary', 'Weekly', 21, 4 * 1440)], updatedAt: now, status: 'ready', detail: '' },
  { provider: 'claude', name: 'Claude Code', windows: [usageWindow('five_hour', '5-hour', 64, 71), usageWindow('seven_day', 'Weekly', 47, 2 * 1440)], updatedAt: now, status: 'ready', detail: '' },
  { provider: 'claude', label: 'work', name: 'Claude Code · work', windows: [usageWindow('five_hour', '5-hour', 22, 188), usageWindow('seven_day', 'Weekly', 31, 5 * 1440)], updatedAt: now, status: 'ready', detail: '' },
  {
    provider: 'opencode', name: 'OpenCode', windows: [], updatedAt: now, status: 'ready', detail: 'OpenCode estimates for recorded sessions.', estimated: true,
    periods: [{ id: 'today', label: 'Today', usd: 2.41, input: 412_000, output: 61_000, cacheRead: 1_900_000, cacheWrite: 180_000 }, { id: 'month', label: 'Month', usd: 38.7, input: 6_100_000, output: 902_000, cacheRead: 31_000_000, cacheWrite: 2_800_000 }],
    week: { usd: 17.42, input: 2_900_000, output: 410_000, cacheRead: 14_000_000, cacheWrite: 1_300_000, from: weekStart, resetsAt: weekStart + 7 * 1440 * min,
      days: [3.1, 4.6, 2.9, 4.41, 2.41, 0, 0].map((usd, i) => ({ at: weekStart + i * 1440 * min, usd, input: usd * 160_000, output: usd * 24_000, cacheRead: usd * 800_000, cacheWrite: usd * 70_000, incomplete: false })) },
    budget: { mode: 'weekly', usd: 25, day: 7, from: weekStart, resetsAt: weekStart + 7 * 1440 * min, spent: 17.42 },
  },
];
// Same merge as server/main.mjs: a pending request sets the session status.
const seats = new OfficeSeats(), towers = new CityTowers(), battlefields = new Battlefields();
const snapshot = () => {
  const requests = store.list();
  return {
    ...workflow.snapshot(),
    sessions: sessions.map(s => { const own = requests.filter(r => r.sessionId === s.id); return { ...s, ...(own.length ? { status: own[0].kind === 'question' ? 'question' : 'permission' } : {}), requests: own }; }),
    office: seats.update(sessions),
    towers: towers.update(sessions),
    battlefields: battlefields.update(sessions),
    lost,
    usage, features: { messaging: true, steering: true, claudeMessaging: true, opencode: true, workflow: true }, updatedAt: Date.now(), machine: 'demo', claudeAccounts: ['', 'work'],
    providers: workflow.health().providers,
  };
};
// Screenshots the sessions "looked at": the weather app and the garden's tiles (scripts/demo-shots), two from subagents.
const shots = {
  'claude:7f3c2a10-5b9e-4d21-a8c4-0e6f1b2d3c4a': [['weather-before', 12, 'Map the sensor pipeline'], ['weather-settings', 10, 'Draft alert rules'], ['weather-phone', 6], ['weather-alert', 2.5], ['weather-push', 1]],
  'claude:5e7a9c1b-3d5f-4a6b-8c0d-2e4f6a8b0c1d': [['garden-seasons', 15], ['garden-winter', 2]],
};
const plan = `# Humidity alerts

Warn when humidity stays above **70%** for more than 10 minutes.

## Steps

1. Map the sensor pipeline
2. Add the threshold config in \`src/config/alerts.ts\`
3. Run the sensor tests
4. Send a push notification
5. Show a banner on the dashboard

## Decisions

| Question | Answer |
| --- | --- |
| Where does it run? | Per-minute averages, in \`aggregate.ts\` |
| What clears it? | Below 65% for 5 minutes |

\`\`\`ts
export const humidityAlert = { above: 70, forMinutes: 10 };
\`\`\`

Rules are drafted in docs/alert-rules.md.
`;
const rules = '# Alert rules\n\n- Warn above 70% for 10 minutes\n- Clear below 65% for 5 minutes\n\nBack to the plan: docs/humidity-alerts-plan.md\n';
const docs = {
  'claude:7f3c2a10-5b9e-4d21-a8c4-0e6f1b2d3c4a': [['humidity-alerts-plan.md', 2.2, plan], ['alert-rules.md', 2.1, rules, 'Draft alert rules']],
};
const messages = {
  send: async (id, body) => { sessions.find(s => s.id === id)?.messages.push({ ...msg('user', body.text, 0), timestamp: Date.now() }); await history.observe(sessions); return { status: 'sent', clientMessageId: body.clientMessageId }; },
  cancel: async () => ({ ok: true }),
  interrupt: async id => { const s = sessions.find(s => s.id === id); if (s) s.status = 'idle'; return { ok: true }; },
  fire: async id => { const at = sessions.findIndex(s => s.id === id); if (at >= 0) sessions.splice(at, 1); await history.observe(sessions); return { ok: true }; },
  models: async id => { const s = sessions.find(s => s.id === id); return s ? [{ id: s.model || 'demo-model', name: s.model || 'Demo model', efforts: s.efforts || ['low', 'medium', 'high'] }] : []; },
  model: async (id, body) => { const s = sessions.find(s => s.id === id); if (s) s.model = body.model; return { ok: true, model: s?.model, effort: s?.effort }; },
  clear: async id => { const s = sessions.find(s => s.id === id); if (!s) return { ok: true }; s.nativeId = randomUUID(); s.id = `${s.provider}:${s.nativeId}`; s.messages = []; s.context = undefined; await history.observe(sessions); return { ok: true, id: s.id }; },
  effort: async (id, body) => { const s = sessions.find(s => s.id === id); if (s) s.effort = body.effort; return { ok: true }; },
  history: async id => ({ messages: [msg('user', 'An older request from earlier today.', 400), msg('assistant', 'Older reply.', 399), ...(sessions.find(s => s.id === id)?.messages || [])], more: false }),
  images: async id => ({ images: (shots[id] || []).map(([, minutes, agent], n) => ({ id: `${agent ? 'a1b2c3.' : ''}0000000${n}-0000-4000-8000-000000000000:0`, type: 'image/webp', at: ago(minutes), tool: true, ...(agent && { agent }) })) }),
  documents: async id => ({ documents: (docs[id] || []).map(([name, minutes, , agent], n) => ({ id: `doc${n}`, name, path: `${home}/weather-station/docs/${name}`, at: ago(minutes), written: true, ...(agent && { agent }) })) }),
  document: async (id, documentId) => {
    const found = (docs[id] || [])[Number(documentId.slice(3))];
    if (!found) throw fail('Document not found.', 404);
    return { name: found[0], path: `${home}/weather-station/docs/${found[0]}`, text: found[2] };
  },
  image: async (id, imageId) => {
    const shot = (shots[id] || [])[Number(/0000000(\d)/.exec(imageId)?.[1])];
    if (!shot) throw fail('Image not found.', 404);
    return { type: 'image/webp', data: await readFile(join(root, 'scripts/demo-shots', `${shot[0]}.webp`)) };
  },
};

// With --lost, sessions a crash took, as server/recovery.mjs offers them. Resuming brings one back after a moment.
const lost = !withLost ? [] : [
  { id: 'claude:9a1b2c3d-0000-4000-8000-000000000001', provider: 'claude', nativeId: '9a1b2c3d-0000-4000-8000-000000000001', account: '', cwd: `${home}/garden-planner`, project: 'garden-planner', title: 'Frost dates per postcode', status: 'working', detail: 'Bash · npm test -- frost', mode: 'auto',
    prompt: 'Use the Met Office station data to work out the last frost date for each postcode, and show it on the planting calendar.', reply: 'The station lookup works; 41 of 43 tests pass. The two failures are postcodes on islands with no station inside 50 km, so I am adding a fallback to the nearest coastal one.', activeAt: ago(6), seenAt: ago(5), lostAt: ago(4), resuming: false },
  { id: 'codex:5e6f7a8b-0000-4000-8000-000000000002', provider: 'codex', nativeId: '5e6f7a8b-0000-4000-8000-000000000002', account: '', cwd: `${home}/weather-station`, project: 'weather-station', title: 'Battery voltage on the status page', status: 'idle', detail: '', mode: '',
    prompt: 'Show the sensor battery voltage on the status page, red under 3.3 V.', reply: 'Done: the status page shows voltage per sensor with a red dot under 3.3 V. Want me to add a low-battery push too?', activeAt: ago(30), seenAt: ago(5), lostAt: ago(4), resuming: false },
];
const recovery = {
  resume: async ids => { for (const entry of lost.filter(entry => ids.includes(entry.id))) { entry.resuming = true; later(() => { lost.splice(lost.indexOf(entry), 1); sessions.push({ ...sessions[0], id: entry.id, nativeId: entry.nativeId, provider: entry.provider, title: entry.title, cwd: entry.cwd, project: entry.project, status: 'idle', updatedAt: Date.now(), messages: [] }); }, 1500); } return { resumed: ids, failed: [] }; },
  dismiss: async ids => { for (const id of ids) { const i = lost.findIndex(entry => entry.id === id); if (i >= 0) lost.splice(i, 1); } return { ok: true }; },
};

// Enough of a spawn to try by hand: the agent turns up a moment later, where it was asked for.
let spawned = 0;
const spawn = async (body = {}) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Invalid launch settings.', 400);
  const presets = workspace.snapshot().presets;
  const preset = body.presetId ? Object.hasOwn(presets, body.presetId) ? presets[body.presetId] : null : {};
  if (!preset) throw fail('Launch preset not found.', 404);
  const { cwd: typed, slot, provider = 'claude', account = '', model, effort, prompt = '', create = false } = { ...preset, ...body };
  const makeSession = { claude, codex, opencode }[provider], cwd = folderPath(typed, '/home/demo');
  if (!['claude', 'codex', 'opencode'].includes(provider) || !cwd || typeof account !== 'string' || typeof prompt !== 'string' || prompt.length > 50_000 || model !== undefined && typeof model !== 'string' || effort !== undefined && typeof effort !== 'string') throw fail('Invalid launch settings.', 400);
  if (folder(cwd) === 'none' || folder(cwd) === 'new' && !create) throw fail('No such folder.', 404);
  const id = `demo-${++spawned}`, sessionId = `${provider}:${id}`, project = sessions.find(s => s.cwd === cwd)?.project || cwd.split('/').pop();
  const next = makeSession(id, project, `Agent ${spawned}`, 'idle', 0, [], { cwd, account, ...(model ? { model } : {}), ...(effort ? { effort } : {}) });
  if (prompt) await workspace.patch({ section: 'drafts', key: sessionId, value: { text: prompt }, baseRevision: 0 });
  seats.reserve(cwd, slot);
  later(() => {
    next.updatedAt = Date.now(); sessions.push(next);
    history.observe(sessions).catch(error => console.error('[Demo history]', error.message));
  }, 800);
  return { session: 'demo', sessionId };
};

// The new agent menu's folder check, over the made-up folders: a project's is there, one more inside ~/code or a project can be made.
const folder = typed => {
  const path = folderPath(typed, '/home/demo'), there = new Set(['/home/demo', home, ...sessions.map(s => s.cwd)]);
  return !path ? 'none' : there.has(path) ? 'folder' : there.has(dirname(path)) ? 'new' : 'none';
};

const providers = [
  { id: 'codex', name: 'Codex', connected: true, detail: 'Demo connection', lastSuccessAt: ago(0.1), recovery: [{ id: 'retry', label: 'Refresh' }] },
  { id: 'claude', name: 'Claude Code', connected: true, detail: 'Demo hooks · 2 accounts', lastSuccessAt: ago(0.2), recovery: [{ id: 'retry', label: 'Refresh' }] },
  { id: 'opencode', name: 'OpenCode', connected: true, detail: 'Demo connection', lastSuccessAt: ago(0.1), recovery: [{ id: 'retry', label: 'Refresh' }] },
];
// Every session in a project reads the same fixture; no demo path is inspected on disk.
const repositories = new Map([...new Set(sessions.map(session => session.cwd))].map(cwd => {
  const path = cwd === weather.cwd ? 'src/config/alerts.ts' : 'src/index.ts';
  return [cwd, { available: true, root: cwd, branch: 'main', files: [
    { path, status: ' M', staged: false, unstaged: true, added: 3, removed: 1, binary: false },
    { path: 'docs/review.md', status: '??', staged: false, unstaged: true, added: 4, removed: 0, binary: false },
  ], total: 2, truncated: false, incomplete: false }];
}));
const workflow = {
  workspace, history,
  snapshot: () => ({ workspace: workspace.snapshot(), overlaps: observedOverlaps(sessions) }),
  observe: () => history.observe(sessions),
  patch: change => workspace.patch(change),
  health: () => ({ providers: structuredClone(providers) }),
  retry: async id => { const provider = providers.find(provider => provider.id === id); if (!provider) throw fail('Provider not found.', 404); provider.connected = true; provider.lastSuccessAt = Date.now(); return workflow.health(); },
  decisions: async ({ session = '', q = '' } = {}) => ({ decisions: decisionLog.filter(entry => (!session || entry.sessionId === session) && (!q || Object.values(entry).some(value => String(value).toLowerCase().includes(q.toLowerCase())))).map(entry => ({ ...entry })), truncated: false }),
  repository: async (id, path = null) => {
    const session = sessions.find(session => session.id === id);
    if (!session) throw fail('Session not found.', 404);
    const status = repositories.get(session.cwd) || { available: false, root: session.cwd, branch: null, files: [], error: 'Repository unavailable' };
    if (path === null) return structuredClone(status);
    const file = status.files.find(file => file.path === path);
    if (!file) return { available: false, root: status.root, path, text: '', binary: false, truncated: false, error: 'File unavailable' };
    const text = file.status === '??'
      ? `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,4 @@\n+# Review\n+\n+- Verify the changes\n+- Run the tests\n`
      : `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1,3 @@\n-export const enabled = false;\n+export const enabled = true;\n+// Demo change awaiting review.\n+export const checked = true;\n`;
    return { available: true, root: status.root, path, text, binary: false, truncated: false };
  },
};
await workspace.patch({ section: 'snippets', key: 'review', value: { name: 'Review', text: 'Review the changes for correctness and missing tests.' } });
await workspace.patch({ section: 'presets', key: 'weather-review', value: { name: 'Weather review', cwd: weather.cwd, provider: 'claude', account: 'work', model: weather.model, effort: 'high', prompt: 'Review the humidity alerts and summarize any remaining risks.' } });
await workspace.patch({ section: 'views', key: 'weather', value: { name: 'Weather', project: weather.cwd, provider: 'all', filter: 'all', search: '' } });
await history.observe([codex('archived-humidity', 'weather-station', 'Humidity sensor calibration', 'idle', 1440, [
  msg('user', 'Record the humidity sensor calibration procedure.', 1450), msg('assistant', 'Humidity sensors are calibrated against a reference reading before installation.', 1440),
])]);
await workflow.observe();
await savePassword(authFile, pin);
return { auth: new Auth(authFile, { secure: false }), store, snapshot, messages, spawn, folder, lost: recovery, workflow, online: createOfficeOnline({ file: join(dataDir, 'office-online.json') }),
  budget: async value => { const { budget } = usage.find(account => account.provider === 'opencode'); Object.assign(budget, value); return budget; },
  close: async () => { for (const timer of timers) clearTimeout(timer); timers.clear(); await history.observe(sessions); await rm(dataDir, { recursive: true, force: true }); },
};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
const port = Number(process.env.DEMO_PORT) || 47842;
const demo = await createDemoServices({ calm: process.argv.includes('--calm'), withLost: process.argv.includes('--lost') });
const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
const vite = await createViteServer({ configFile: join(root, 'vite.config.mjs'), server: { middlewareMode: true, hmr: false, allowedHosts: ['127.0.0.1', 'localhost'] } });
const server = createServer(createHandler({ ...demo, passkeys: new Passkeys(demo.auth), origin: origins, vite: vite.middlewares }));
// Office meetings, as server/main.mjs: pages' live links, and the floor's 2 s tick (it goes up only while this demo hosts).
const live = liveUpgrade({ auth: demo.auth, origins, hosts: origins.map(o => new URL(o).host), online: demo.online }); server.on('upgrade', live);
const meeting = setInterval(() => demo.online.floor(() => { const { sessions, office } = demo.snapshot(); return { sessions, office }; }), 2000);
server.listen(port, '127.0.0.1', () => console.log(`AI Control demo: ${origins[0]}  PIN 1234  (Ctrl-C stops)`));
const stop = () => { clearInterval(meeting); live.close(); demo.online.close(); server.closeAllConnections(); server.close(); Promise.allSettled([vite.close(), demo.close()]).finally(() => process.exit(0)); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
