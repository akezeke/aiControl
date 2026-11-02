import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { appendFile, writeFile, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hostname as machineName } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import { Auth } from './auth.mjs';
import { RequestStore, mergeSessions } from './requests.mjs';
import { CodexAdapter } from './codex.mjs';
import { ClaudeAdapter } from './claude.mjs';
import { OpenCodeAdapter } from './opencode.mjs';
import { UsagePoller, claudeUsageReader } from './usage.mjs';
import { createHandler } from './http.mjs';
import { fail } from './requests.mjs';
import { spawnAgent } from './claude-messaging.mjs';
import { Launches } from './launches.mjs';
import { AgentDefaults } from './agent-defaults.mjs';
import { SpendBudget } from './spend-budget.mjs';
import { agentFolder, folderState } from './folders.mjs';
import { OfficeSeats } from './seats.mjs';
import { CityTowers } from './towers.mjs';
import { Battlefields } from './battlefields.mjs';
import { Recovery, resumeArgs } from './recovery.mjs';
import { PromptHistory } from './prompt-history.mjs';
import { root, authFile, dataDir, hookSocket, port, claudeAccounts, readSettings } from './config.mjs';

export async function startServer({ host, hostname, tls = null }) {
  const origin = `${tls ? 'https' : 'http'}://${hostname}:${port}`;
  // On the tailnet it also listens on loopback (plain HTTP), so this machine's browser can use localhost; WSL forwards Windows' localhost there too.
  const loopback = host !== '127.0.0.1', origins = [...new Set([origin, `http://127.0.0.1:${port}`, `http://localhost:${port}`])];
  const auth = new Auth(authFile, { secure: !!tls });
  const loginsFile = join(dataDir, 'logins.json');
  auth.restore(loginsFile);
  const store = new RequestStore(async entry => { await appendFile(join(dataDir, 'decisions.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 }); });
  const codex = new CodexAdapter(store);
  const accounts = claudeAccounts();
  const claude = new ClaudeAdapter(store, hookSocket, { accounts });
  const launches = new Launches(store, { registered: id => claude.list().some(session => session.id === id) });
  const opencode = new OpenCodeAdapter(store, readSettings().opencode);
  const defaults = new AgentDefaults();
  const spendBudget = await new SpendBudget().load();
  opencode.budget = spendBudget.value;
  // One usage row per Claude account, each with its own credentials.
  const claudeUsage = accounts.map(({ dir, label }) => ({ label, poller: new UsagePoller('claude', label ? `Claude Code · ${label}` : 'Claude Code', claudeUsageReader({ credentialsFile: join(dir, '.credentials.json') })) }));
  // Loading the .mjs directly avoids temporary bundled configs triggering Node 22's imported-module watcher.
  const vite = await createViteServer({ configFile: join(root, 'vite.config.mjs'), configLoader: 'native', server: { middlewareMode: true, hmr: false, allowedHosts: origins.map(o => new URL(o).hostname) } });
  const seats = new OfficeSeats(join(dataDir, 'office-seats.json'));
  const towers = new CityTowers(join(dataDir, 'city-towers.json'));
  const battlefields = new Battlefields(join(dataDir, 'fantasy-battlefields.json'));
  // Kept up whether or not anyone's looking, so a crash leaves the file as it was seconds before.
  const recovery = new Recovery(join(dataDir, 'recovery.json'));
  const prompts = new PromptHistory(accounts.map(({ dir }) => join(dir, 'history.jsonl')));
  const recover = async () => {
    await prompts.refresh();
    recovery.update([...codex.list(), ...claude.list()], { ended: entry => entry.provider === 'claude' ? claude.ending(entry.nativeId) : '', typed: session => session.provider === 'claude' ? prompts.get(session.nativeId) : '' });
  };
  const snapshot = () => {
    const live = [...codex.list(), ...claude.list(), ...opencode.list()];
    const sessions = mergeSessions([...live, ...launches.list().filter(launch => !live.some(session => session.id === launch.id))], store.list());
    return { sessions, office: seats.update(sessions), towers: towers.update(sessions), battlefields: battlefields.update(sessions), lost: recovery.lost(), usage: [codex.usage.snapshot(), ...claudeUsage.map(({ label, poller }) => ({ ...poller.snapshot(), label })), ...opencode.config ? [opencode.usageSnapshot()] : []], features: { messaging: true, steering: true, claudeMessaging: true, opencode: !!opencode.config }, updatedAt: Date.now(), machine: machineName(), claudeAccounts: accounts.map(({ label }) => label), providers: [{ name: 'Codex', connected: codex.connected, detail: codex.detail }, { name: 'Claude Code', connected: claude.connected, detail: claude.detail }, ...opencode.config ? [{ name: 'OpenCode', connected: opencode.connected, detail: opencode.detail }] : []] };
  };
  const messageTarget = id => {
    const session = codex.list().find(session => session.id === id);
    if (!session) throw fail(id.startsWith('claude:') ? 'Claude’s queue can only be changed in its terminal.' : 'Session is no longer available.', 409);
    return session.nativeId;
  };
  const claudeId = id => id.startsWith('claude:') && id.slice(7);
  const openCodeId = id => id.startsWith('opencode:') && id.slice(9);
  const settingTarget = id => openCodeId(id) ? [opencode, openCodeId(id), 'opencode'] : claudeId(id) ? [claude, claudeId(id), 'claude'] : [codex, messageTarget(id), 'codex'];
  const setAgentSetting = async (id, kind, value) => {
    const [adapter, nativeId, provider] = settingTarget(id);
    const result = await adapter[kind === 'model' ? 'setModel' : 'setEffort'](nativeId, value);
    const session = adapter.list().find(session => session.nativeId === nativeId) || {};
    const settings = { model: result.model || session.model, effort: result.effort ?? session.effort ?? '' };
    try {
      await defaults.save(provider, session.account, settings);
      if (provider === 'codex') await codex.saveDefaults(settings);
    } catch { return { ...result, ...settings, warning: 'Setting changed, but the default for new sessions could not be saved.' }; }
    return { ...result, ...settings };
  };
  const unsupportedOpenCode = () => { throw fail('This control is not available for OpenCode.', 409); };
  const messages = {
    send: (id, body) => openCodeId(id) ? opencode.sendMessage(openCodeId(id), body) : claudeId(id) ? claude.sendMessage(claudeId(id), body) : codex.sendMessage(messageTarget(id), body),
    cancel: (id, queuedId) => openCodeId(id) ? unsupportedOpenCode() : codex.cancelQueuedMessage(messageTarget(id), queuedId),
    interrupt: id => openCodeId(id) ? opencode.interrupt(openCodeId(id)) : claudeId(id) ? claude.interrupt(claudeId(id)) : codex.interrupt(messageTarget(id)),
    fire: id => openCodeId(id) ? opencode.fire(openCodeId(id)) : claudeId(id) ? claude.fire(claudeId(id)) : codex.fire(messageTarget(id)),
    clear: id => claudeId(id) ? claude.clear(claudeId(id)) : Promise.reject(fail('Only Claude sessions can be cleared for now.', 409)),
    models: id => { const [adapter, nativeId] = settingTarget(id); return adapter.modelOptions(nativeId); },
    model: (id, body) => setAgentSetting(id, 'model', body?.model),
    effort: (id, body) => setAgentSetting(id, 'effort', body?.effort),
    history: (id, limit) => openCodeId(id) ? opencode.history(openCodeId(id), limit) : claudeId(id) ? claude.history(id, limit) : codex.history(messageTarget(id), limit),
    images: id => openCodeId(id) ? opencode.imageList(openCodeId(id)) : claudeId(id) ? claude.imageList(id) : codex.imageList(messageTarget(id)),
    image: (id, imageId) => openCodeId(id) ? opencode.image(openCodeId(id), imageId) : claudeId(id) ? claude.image(id, imageId) : codex.image(messageTarget(id), imageId),
    documents: id => openCodeId(id) ? { documents: [] } : claudeId(id) ? claude.documentList(id) : codex.documentList(messageTarget(id)),
    document: (id, documentId) => openCodeId(id) ? unsupportedOpenCode() : claudeId(id) ? claude.document(id, documentId) : codex.document(messageTarget(id), documentId),
  };
  // Any existing directory (~ expands), or with `create` a new one in an existing directory. Claude starts under the account
  // asked for, or the one the project last used. `slot` is the desk or lot the agent was asked for, if any.
  const spawn = async ({ cwd: typed, provider, account: label, slot, create } = {}) => {
    const cwd = agentFolder(typed, { create: create === true });
    if (provider === 'opencode') {
      const created = await opencode.spawn(cwd, await defaults.read(provider));
      seats.reserve(cwd, slot);
      try { return { ...created, ...await spawnAgent(cwd, provider, { sessionId: created.sessionId.slice(9) }) }; }
      catch { return { ...created, warning: 'Session created, but its tmux terminal could not open.' }; }
    }
    const account = provider === 'claude' ? claude.accountFor(cwd, label) : null, sessionId = provider === 'claude' ? randomUUID() : undefined;
    seats.reserve(cwd, slot);
    const started = await spawnAgent(cwd, provider, { configDir: account?.label ? account.dir : '', ...await defaults.read(provider, account?.label), sessionId }).catch(e => { seats.release(cwd, slot); throw e; });
    launches.watch({ ...started, provider, cwd, account: account?.label || '', sessionId });
    return started;
  };
  // One at a time, so two in a new folder don't both make its tmux session. Each in its own account and permission mode.
  const lost = {
    async resume(ids) {
      const resumed = [], failed = [];
      for (const id of ids) {
        const entry = recovery.get(id);
        if (!entry) continue;
        try {
          if (!existsSync(entry.cwd)) throw fail('Its folder is gone.', 409);
          const account = entry.provider === 'claude' ? claude.accountFor(entry.cwd, entry.account) : null;
          const started = await spawnAgent(entry.cwd, entry.provider, { configDir: account?.label ? account.dir : '', args: resumeArgs(entry) });
          launches.watch({ ...started, provider: entry.provider, cwd: entry.cwd, account: account?.label || '' });
          recovery.resumed(id); resumed.push(id);
        } catch (e) { failed.push({ id, error: e.status ? e.message : 'Could not open a tmux window.' }); }
      }
      return { resumed, failed };
    },
    dismiss: ids => { recovery.dismiss(ids); return { ok: true }; },
  };
  const handler = createHandler({ auth, store, snapshot, origin: origins, vite: vite.middlewares, messages, spawn, folder: folderState, lost, budget: async value => opencode.budget = await spendBudget.save(value) });
  const servers = [[tls ? createHttpsServer(tls, handler) : createHttpServer(handler), host], ...loopback ? [[createHttpServer(handler), '127.0.0.1']] : []];
  const closeServers = () => Promise.all(servers.map(([server]) => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); }));
  for (const [server, address] of servers) {
    server.requestTimeout = 20_000;
    server.headersTimeout = 10_000;
    server.on('upgrade', (_req, socket) => socket.destroy());
    try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, address, resolve); }); } catch (e) { await closeServers(); await vite.close(); throw e; }
  }
  try { await claude.start(); } catch (e) { await closeServers(); await vite.close(); throw e; }
  codex.start();
  opencode.start();
  for (const { poller } of claudeUsage) poller.start();
  const recovering = setInterval(() => recover().catch(error => console.error('[Recovery]', error.message)), 4000);
  // npm start polls for this file; write then rename so it never reads a partial file.
  await writeFile(join(dataDir, 'server.json.tmp'), JSON.stringify({ pid: process.pid, url: origin, host, port, startedAt: new Date().toISOString() }), { mode: 0o600 });
  await rename(join(dataDir, 'server.json.tmp'), join(dataDir, 'server.json'));
  console.log(`AI Control: ${origin}${loopback ? `, and http://localhost:${port} on this machine` : ''}`);
  let closing = false;
  async function close() {
    if (closing) return; closing = true;
    auth.persist(loginsFile);
    clearInterval(recovering); launches.stop(); codex.stop(); opencode.stop(); for (const { poller } of claudeUsage) poller.stop(); await claude.stop(); await vite.close();
    await closeServers();
    await unlink(join(dataDir, 'server.json')).catch(() => {});
  }
  return { close, origin };
}
