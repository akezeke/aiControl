// Fake projects, sessions, subagents, requests and usage for screenshots.
// Runs beside a real server: own port, temporary login, no agent connections.
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { Auth, savePassword } from '../server/auth.mjs';
import { RequestStore } from '../server/requests.mjs';
import { createHandler } from '../server/http.mjs';
import { claudeRequest } from '../server/claude.mjs';
import { codexRequest } from '../server/codex.mjs';
import { root } from '../server/config.mjs';

const port = 47842, pin = '1234', now = Date.now(), min = 60_000, home = '/home/demo/code';
const ago = minutes => now - minutes * min;
let n = 0;
const msg = (role, text, minutes, extra = {}) => ({ id: `m${++n}`, role, text, truncated: false, timestamp: ago(minutes), ...extra });
const tool = (text, minutes, extra) => msg('assistant', text, minutes, { tool: true, ...extra });
const steps = (done, ...names) => names.map((step, i) => ({ step, status: i < done ? 'done' : i === done ? 'active' : 'pending' }));

function claude(id, project, title, status, minutes, messages, extra = {}) {
  return { id: `claude:${id}`, nativeId: id, provider: 'claude', title, cwd: `${home}/${project}`, project, status, updatedAt: ago(minutes), model: 'claude-opus-5-5', version: '2.4.1', effort: 'high', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], permissionMode: 'default', detail: '', control: true, messaging: { send: true, queue: false, via: 'tmux', interrupt: true, effort: true, fire: true }, messages, messagesState: 'ready', ...extra };
}
function codex(id, project, title, status, minutes, messages, extra = {}) {
  return { id: `codex:${id}`, nativeId: id, provider: 'codex', title, cwd: `${home}/${project}`, project, status, updatedAt: ago(minutes), model: 'gpt-5.5-codex', effort: 'medium', efforts: ['low', 'medium', 'high', 'xhigh'], detail: '', control: true, messaging: { send: true, queue: true, interrupt: true, effort: true }, messages, messagesState: 'ready', queuedMessages: [], queueAvailable: true, queueError: '', ...extra };
}
function subagent(parent, agentId, title, kind, status, minutes, messages) {
  return { ...parent, id: `${parent.id}:${agentId}`, nativeId: agentId, parentId: parent.id, title, status, updatedAt: ago(minutes), model: kind, control: false, messaging: { send: false, queue: false }, messages, branch: undefined, plan: undefined, permissionMode: undefined, context: undefined, effort: undefined, cost: undefined, lastTurnMs: undefined };
}

const weather = claude('7f3c2a10-5b9e-4d21-a8c4-0e6f1b2d3c4a', 'weather-station', 'Add humidity alerts to the dashboard', 'working', 0.2, [
  msg('user', 'Add humidity alerts: warn above 70% for more than 10 minutes, show it on the dashboard and send a push notification.', 14),
  msg('assistant', "I'll split this up: one agent maps the sensor pipeline, another drafts the alert rules. Meanwhile I'll add the threshold config.", 13),
  msg('assistant', 'Threshold config:\n\n```ts\nexport const humidityAlert = { above: 70, forMinutes: 10 };\n```', 3),
  tool('Read · src/config/alerts.ts', 2.9), tool('Edit · src/config/alerts.ts', 2.8), tool('Bash · Type-check', 2.6, { failed: true }), tool('Edit · src/config/alerts.ts', 2.4), tool('Bash · Type-check', 2.2),
  msg('assistant', 'Config is in place. Running the sensor tests next.', 2),
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
    tool('Write · src/alerts/rules.ts', 6),
    msg('assistant', 'Done. Alerts trigger at 70% after 10 minutes and clear below 65%.', 4),
  ]),
  claude('2d4f6a8c-1e3b-4c5d-9f7a-8b6c4d2e0f1a', 'weather-station', 'Fix flaky timezone test', 'idle', 95, [
    msg('user', 'The nightly summary test fails around midnight UTC. Fix it.', 120),
    msg('assistant', 'The test used the local clock. It now freezes time at `2026-03-01T23:59:30Z` and passes in every timezone.', 95),
  ]),
  codex('019a4c2e-7b1d-7e3f-a5c6-2d8e9f0a1b2c', 'recipe-api', 'Add pagination to /recipes', 'working', 1, [
    msg('user', 'Add cursor pagination to GET /recipes, 20 per page, and update the OpenAPI spec.', 8),
    tool('Shell · pnpm test -- recipes', 3), tool('Edit · src/routes/recipes.ts, openapi.yaml', 2),
    msg('assistant', 'Pagination is implemented and the spec is updated. I need to apply the database migration for the new index.', 1),
  ], { branch: 'feat/pagination', effort: 'high', context: { used: 172_000, window: 258_000 }, plan: steps(3, 'Cursor encoding', 'Route and query', 'OpenAPI spec', 'Migration for the index') }),
  codex('019a4c2e-9c3a-7f10-b2d4-6e8f0a1c3e5b', 'recipe-api', 'Review ingredient parser', 'idle', 240, [
    msg('user', 'Review the ingredient parser for edge cases.', 260),
    msg('assistant', '| Input | Parsed | Issue |\n| --- | --- | --- |\n| `1 1/2 cups flour` | 1.5 cup flour | — |\n| `salt to taste` | salt | no quantity |\n| `2-3 eggs` | 2 eggs | range dropped |', 241),
    msg('assistant', 'Only ranges like `2-3 eggs` lose information; the other edge cases parse correctly.', 240),
  ], { branch: 'main' }),
  claude('5e7a9c1b-3d5f-4a6b-8c0d-2e4f6a8b0c1d', 'pixel-garden', 'Seasonal tile palette', 'working', 3, [
    msg('user', 'Make the garden tiles change with the seasons.', 20),
    msg('assistant', 'I drafted spring, summer, autumn and winter palettes. Which style should winter use?', 3),
  ]),
  codex('019a4c2f-1d2e-7a3b-c4d5-e6f708192a3b', 'home-lab', 'Upgrade Grafana dashboards', 'working', 0.5, [
    msg('user', 'Upgrade the Grafana dashboards to the new panel format and fix the broken disk usage panel.', 25),
    { ...msg('notice', 'stream disconnected before completion · retrying', 6), error: false },
    msg('assistant', 'Converted 9 of 12 dashboards. Fixing the disk panel query now: it summed devices twice.', 0.5),
  ], { branch: 'grafana-12', context: { used: 236_000, window: 258_000 }, goal: { objective: 'Every dashboard on the new panel format', status: 'active', tokensUsed: 1_200_000, tokenBudget: 3_000_000, timeUsedSeconds: 1500 } }),
  claude('8a0c2e4f-6b8d-4f1a-9c3e-5d7f9b1d3f5a', 'dotfiles', 'Tidy shell startup', 'idle', 600, [
    msg('user', 'Shell startup takes 1.2 s. Make it faster.', 640),
    msg('assistant', 'Startup is down to **180 ms**: `nvm` now loads lazily and completions are cached.', 600),
  ], { permissionMode: 'bypassPermissions' }),
];

const store = new RequestStore();
const pending = view => store.add(view, async () => {}, view.sessionId);
pending(claudeRequest({ hook_event_name: 'PermissionRequest', session_id: weather.nativeId, tool_name: 'Bash', tool_input: { command: 'npm test -- sensors', description: 'Run the sensor tests' } }).view);
pending(codexRequest({ method: 'item/commandExecution/requestApproval', params: { threadId: sessions[4].nativeId, itemId: 'i1', reason: 'Apply the migration that adds the pagination index', command: 'pnpm prisma migrate dev --name recipes_cursor_index', cwd: sessions[4].cwd } }).view);
pending(claudeRequest({ hook_event_name: 'PermissionRequest', session_id: sessions[6].nativeId, tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which style should winter use?', header: 'Winter', multiSelect: false, options: [{ label: 'Frosted pastels', description: 'Soft blue and lilac with white highlights' }, { label: 'Deep evergreen', description: 'Dark greens with snow caps' }, { label: 'Monochrome', description: 'Greys only, like a snowy photo' }] }] } }).view);

pending(claudeRequest({ hook_event_name: 'PermissionRequest', session_id: sessions[8].nativeId, tool_name: 'Edit', tool_input: { file_path: `${home}/dotfiles/.zshrc`, old_string: 'source $NVM_DIR/nvm.sh\ncompinit', new_string: 'nvm() { unset -f nvm; source $NVM_DIR/nvm.sh; nvm "$@"; }\ncompinit -C' },
  permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Edit', ruleContent: '~/code/dotfiles/**' }], behavior: 'allow', destination: 'session' }] }).view);
const usageWindow = (id, label, usedPercent, resetMinutes, scope = '') => ({ id, label, scope, usedPercent, resetsAt: now + resetMinutes * min });
const usage = [
  { provider: 'codex', name: 'Codex', windows: [usageWindow('codex:primary', '5-hour', 38, 134), usageWindow('codex:secondary', 'Weekly', 21, 4 * 1440)], updatedAt: now, status: 'ready', detail: '' },
  { provider: 'claude', name: 'Claude Code', windows: [usageWindow('five_hour', '5-hour', 64, 71), usageWindow('seven_day', 'Weekly', 47, 2 * 1440)], updatedAt: now, status: 'ready', detail: '' },
];
// Same merge as server/main.mjs: a pending request sets the session status.
const snapshot = () => {
  const requests = store.list();
  return {
    sessions: sessions.map(s => { const own = requests.filter(r => r.sessionId === s.id); return { ...s, ...(own.length ? { status: own[0].kind === 'question' ? 'question' : 'permission' } : {}), requests: own }; }),
    usage, features: { messaging: true, steering: true, claudeMessaging: true }, updatedAt: Date.now(), machine: 'demo',
    providers: [{ name: 'Codex', connected: true, detail: 'Demo data' }, { name: 'Claude Code', connected: true, detail: 'Demo data' }],
  };
};
const messages = {
  send: async (id, body) => { sessions.find(s => s.id === id)?.messages.push(msg('user', body.text, 0)); return { status: 'sent', clientMessageId: body.clientMessageId }; },
  cancel: async () => ({ ok: true }),
  interrupt: async id => { const s = sessions.find(s => s.id === id); if (s) s.status = 'idle'; return { ok: true }; },
  fire: async id => { const at = sessions.findIndex(s => s.id === id); if (at >= 0) sessions.splice(at, 1); return { ok: true }; },
  effort: async (id, body) => { const s = sessions.find(s => s.id === id); if (s) s.effort = body.effort; return { ok: true }; },
  history: async id => ({ messages: [msg('user', 'An older request from earlier today.', 400), msg('assistant', 'Older reply.', 399), ...(sessions.find(s => s.id === id)?.messages || [])], more: false }),
};

const authFile = join(await mkdtemp(join(tmpdir(), 'ai-control-demo-')), 'auth.json');
await savePassword(authFile, pin);
const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
const vite = await createViteServer({ configFile: join(root, 'vite.config.mjs'), server: { middlewareMode: true, hmr: false, allowedHosts: ['127.0.0.1', 'localhost'] } });
const server = createServer(createHandler({ auth: new Auth(authFile, { secure: false }), store, snapshot, origin: origins, vite: vite.middlewares, messages }));
server.listen(port, '127.0.0.1', () => console.log(`AI Control demo: ${origins[0]}  PIN ${pin}  (Ctrl-C stops)`));
process.once('SIGINT', () => { server.closeAllConnections(); server.close(); vite.close().finally(() => process.exit(0)); });
