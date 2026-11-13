import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { appendFile, writeFile, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hostname as machineName, homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import { Auth } from './auth.mjs';
import { Passkeys } from './passkeys.mjs';
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
import { createOfficeOnline, liveUpgrade } from './office-online.mjs';
import { CityTowers } from './towers.mjs';
import { Battlefields } from './battlefields.mjs';
import { Recovery, resumeArgs } from './recovery.mjs';
import { PromptHistory } from './prompt-history.mjs';
import { PushNotifications } from './push.mjs';
import { WorkspaceStore } from './workspace.mjs';
import { HistorySearch, openCodeHistorySource } from './history-search.mjs';
import { WorkflowService } from './workflow.mjs';
import { launchPreset } from './workflow-launch.mjs';
import { root, authFile, dataDir, hookSocket, port, claudeAccounts, readSettings, location } from './config.mjs';

export async function startServer({ host, hostname, tls = null }) {
  const origin = `${tls ? 'https' : 'http'}://${hostname}:${port}`;
  // On the tailnet it also listens on loopback (plain HTTP), so this machine's browser can use localhost; WSL forwards Windows' localhost there too.
  const loopback = host !== '127.0.0.1', origins = [...new Set([origin, `http://127.0.0.1:${port}`, `http://localhost:${port}`])];
  const auth = new Auth(authFile, { secure: !!tls });
  const loginsFile = join(dataDir, 'logins.json');
  auth.restore(loginsFile);
  const push = await new PushNotifications(join(dataDir, 'push.json'), { credentialFile: authFile }).load();
  const store = new RequestStore(async entry => { await appendFile(join(dataDir, 'decisions.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 }); });
  const codex = new CodexAdapter(store);
  const accounts = claudeAccounts();
  const claude = new ClaudeAdapter(store, hookSocket, { accounts });
  const launches = new Launches(store, { registered: id => claude.list().some(session => session.id === id) });
  const opencode = new OpenCodeAdapter(store, readSettings().opencode);
  const defaults = new AgentDefaults();
  const spendBudget = await new SpendBudget().load();
  opencode.budget = spendBudget.value;
  const workspace = await new WorkspaceStore(join(dataDir, 'workspace.json')).load();
  const history = await new HistorySearch({ file: join(dataDir, 'history-search.json'), codexRoots: [process.env.CODEX_HOME || join(homedir(), '.codex')], claudeAccounts: accounts,
    sources: opencode.config ? [() => opencode.api ? openCodeHistorySource(opencode.api)() : { sessions: [], partial: true, truncated: false }] : [] }).load();
  // One usage row per Claude account, each with its own credentials.
  const claudeUsage = accounts.map(({ dir, label }) => ({ label, poller: new UsagePoller('claude', label ? `Claude Code · ${label}` : 'Claude Code', claudeUsageReader({ credentialsFile: join(dir, '.credentials.json') })) }));
  // Loading the .mjs directly avoids temporary bundled configs triggering Node 22's imported-module watcher.
  const vite = await createViteServer({ configFile: join(root, 'vite.config.mjs'), configLoader: 'native', server: { middlewareMode: true, hmr: false, allowedHosts: origins.map(o => new URL(o).hostname) } });
  const seats = new OfficeSeats(join(dataDir, 'office-seats.json'));
  const online = createOfficeOnline({ file: join(dataDir, 'office-online.json') });
  const towers = new CityTowers(join(dataDir, 'city-towers.json'));
  const battlefields = new Battlefields(join(dataDir, 'fantasy-battlefields.json'));
  // Kept up whether or not anyone's looking, so a crash leaves the file as it was seconds before.
  const recovery = new Recovery(join(dataDir, 'recovery.json'));
  const prompts = new PromptHistory(accounts.map(({ dir }) => join(dir, 'history.jsonl')));
  const recover = async () => {
    await prompts.refresh();
    recovery.update([...codex.list(), ...claude.list()], { ended: entry => entry.provider === 'claude' ? claude.ending(entry.nativeId) : '', typed: session => session.provider === 'claude' ? prompts.get(session.nativeId) : '', alive: pid => claude.running(pid) });
  };
  const currentSessions = () => {
    const live = [...codex.list(), ...claude.list(), ...opencode.list()];
    const sessions = mergeSessions([...live, ...launches.list().filter(launch => !live.some(session => session.id === launch.id))], store.list());
    return sessions;
  };
  const workflow = new WorkflowService({ workspace, history, sessions: currentSessions, decisionsFile: join(dataDir, 'decisions.jsonl'), push,
    providers: [{ id: 'codex', name: 'Codex', adapter: codex, retry: () => codex.connected ? codex.refresh() : codex.connect() },
      { id: 'claude', name: 'Claude Code', adapter: claude, retry: () => claude.refresh() },
      ...opencode.config ? [{ id: 'opencode', name: 'OpenCode', adapter: opencode, retry: () => opencode.refresh() }] : []] });
  const place = location();
  const snapshot = () => {
    const sessions = currentSessions();
    return { sessions, ...workflow.snapshot(), office: seats.update(sessions), towers: towers.update(sessions), battlefields: battlefields.update(sessions), lost: recovery.lost(), lostChecking: recovery.checking(), usage: [codex.usage.snapshot(), ...claudeUsage.map(({ label, poller }) => ({ ...poller.snapshot(), label })), ...opencode.config ? [opencode.usageSnapshot()] : []], features: { messaging: true, steering: true, claudeMessaging: true, workflow: true, opencode: !!opencode.config }, updatedAt: Date.now(), machine: machineName(), claudeAccounts: accounts.map(({ label }) => label), providers: workflow.health().providers, location: place };
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
    fire: (id, options) => openCodeId(id) ? opencode.fire(openCodeId(id)) : claudeId(id) ? claude.fire(claudeId(id), options) : codex.fire(messageTarget(id), options),
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
  const spawn = async (body = {}) => {
    if (body?.presetId !== undefined) return launchPreset(body, { workspace, codex, claude, opencode, defaults, seats, launches, spawnAgent });
    const { cwd: typed, provider, account: label, slot, create } = body || {};
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
          if (account && !await claude.kept(entry.nativeId, account)) { recovery.dismiss([id]); throw fail('Nothing was saved to resume.', 410); }
          const started = await spawnAgent(entry.cwd, entry.provider, { configDir: account?.label ? account.dir : '', args: resumeArgs(entry) });
          // Claude resumes under the same id, so the session shows as starting at once, and a trust question reaches the dashboard.
          launches.watch({ ...started, provider: entry.provider, cwd: entry.cwd, account: account?.label || '', sessionId: account ? entry.nativeId : undefined });
          recovery.resumed(id); resumed.push(id);
        } catch (e) { failed.push({ id, error: e.status ? e.message : 'Could not open a tmux window.' }); }
      }
      return { resumed, failed };
    },
    dismiss: ids => { recovery.dismiss(ids); return { ok: true }; },
  };
  const handler = createHandler({ auth, passkeys: new Passkeys(auth), store, snapshot, push, workflow, online, origin: origins, vite: vite.middlewares, messages, spawn, folder: folderState, lost, budget: async value => opencode.budget = await spendBudget.save(value) });
  // Office meetings: pages connect at /api/office/live, checked as any POST is (office-online.mjs); every other upgrade is refused.
  const live = liveUpgrade({ auth, origins, hosts: origins.map(o => new URL(o).host), online });
  const servers = [[tls ? createHttpsServer(tls, handler) : createHttpServer(handler), host], ...loopback ? [[createHttpServer(handler), '127.0.0.1']] : []];
  const closeServers = () => Promise.all(servers.map(([server]) => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); }));
  for (const [server, address] of servers) {
    server.requestTimeout = 20_000;
    server.headersTimeout = 10_000;
    server.on('upgrade', live);
    try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, address, resolve); }); } catch (e) { await closeServers(); await vite.close(); throw e; }
  }
  try { await claude.start(); } catch (e) { await closeServers(); await vite.close(); throw e; }
  codex.start();
  opencode.start();
  for (const { poller } of claudeUsage) poller.start();
  const observe = () => {
    push.update(currentSessions()).catch(error => console.error('[Push]', error.message));
    workflow.observe().catch(error => console.error('[Workflow]', error.message));
  };
  observe(); const pushing = setInterval(observe, 3000);
  // Keeps the hub link as it should be, and while this machine hosts the meeting it's in, sends its floor when it changed
  // (office-online.mjs). The floor needs only the sessions and their seats, read as nobody watching (seats.mjs).
  const meeting = setInterval(() => online.floor(() => { const sessions = currentSessions(); return { sessions, office: seats.update(sessions, Date.now(), { watched: false }) }; }), 2000);
  // At once, so sessions a reboot took show up as lost without waiting for the first tick.
  const recoverNow = () => recover().catch(error => console.error('[Recovery]', error.message));
  recoverNow(); const recovering = setInterval(recoverNow, 4000);
  // npm start polls for this file; write then rename so it never reads a partial file.
  await writeFile(join(dataDir, 'server.json.tmp'), JSON.stringify({ pid: process.pid, url: origin, host, port, startedAt: new Date().toISOString() }), { mode: 0o600 });
  await rename(join(dataDir, 'server.json.tmp'), join(dataDir, 'server.json'));
  console.log(`AI Control: ${origin}${loopback ? `, and http://localhost:${port} on this machine` : ''}`);
  let closing = false;
  async function close() {
    if (closing) return; closing = true;
    auth.persist(loginsFile);
    clearInterval(recovering); clearInterval(pushing); clearInterval(meeting); live.close(); online.close(); launches.stop(); codex.stop(); opencode.stop(); for (const { poller } of claudeUsage) poller.stop(); await claude.stop(); await vite.close();
    await workflow.observing?.catch(() => {});
    await closeServers();
    await unlink(join(dataDir, 'server.json')).catch(() => {});
  }
  return { close, origin };
}
