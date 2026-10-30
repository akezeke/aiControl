import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { appendFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { statSync } from 'node:fs';
import { hostname as machineName, homedir } from 'node:os';
import { createServer as createViteServer } from 'vite';
import { Auth } from './auth.mjs';
import { RequestStore, mergeSessions } from './requests.mjs';
import { CodexAdapter } from './codex.mjs';
import { ClaudeAdapter } from './claude.mjs';
import { UsagePoller, claudeUsageReader } from './usage.mjs';
import { createHandler } from './http.mjs';
import { fail } from './requests.mjs';
import { spawnAgent } from './claude-messaging.mjs';
import { root, authFile, dataDir, hookSocket, port, claudeAccounts } from './config.mjs';

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
  // One usage row per Claude account, each with its own credentials.
  const claudeUsage = accounts.map(({ dir, label }) => ({ label, poller: new UsagePoller('claude', label ? `Claude Code · ${label}` : 'Claude Code', claudeUsageReader({ credentialsFile: join(dir, '.credentials.json') })) }));
  const vite = await createViteServer({ configFile: join(root, 'vite.config.mjs'), server: { middlewareMode: true, hmr: false, allowedHosts: origins.map(o => new URL(o).hostname) } });
  const snapshot = () => {
    const sessions = mergeSessions([...codex.list(), ...claude.list()], store.list());
    return { sessions, usage: [codex.usage.snapshot(), ...claudeUsage.map(({ label, poller }) => ({ ...poller.snapshot(), label }))], features: { messaging: true, steering: true, claudeMessaging: true }, updatedAt: Date.now(), machine: machineName(), claudeAccounts: accounts.map(({ label }) => label), providers: [{ name: 'Codex', connected: codex.connected, detail: codex.detail }, { name: 'Claude Code', connected: claude.connected, detail: claude.detail }] };
  };
  const messageTarget = id => {
    const session = codex.list().find(session => session.id === id);
    if (!session) throw fail(id.startsWith('claude:') ? 'Claude’s queue can only be changed in its terminal.' : 'Session is no longer available.', 409);
    return session.nativeId;
  };
  const claudeId = id => id.startsWith('claude:') && id.slice(7);
  const messages = {
    send: (id, body) => claudeId(id) ? claude.sendMessage(claudeId(id), body) : codex.sendMessage(messageTarget(id), body),
    cancel: (id, queuedId) => codex.cancelQueuedMessage(messageTarget(id), queuedId),
    interrupt: id => claudeId(id) ? claude.interrupt(claudeId(id)) : codex.interrupt(messageTarget(id)),
    fire: id => claudeId(id) ? claude.fire(claudeId(id)) : Promise.reject(fail('Only Claude sessions can be fired for now.', 409)),
    effort: (id, body) => claudeId(id) ? claude.setEffort(claudeId(id), body?.effort) : codex.setEffort(messageTarget(id), body?.effort),
    history: (id, limit) => claudeId(id) ? claude.history(id, limit) : codex.history(messageTarget(id), limit),
    images: id => claudeId(id) ? claude.imageList(id) : codex.imageList(messageTarget(id)),
    image: (id, imageId) => claudeId(id) ? claude.image(id, imageId) : codex.image(messageTarget(id), imageId),
  };
  // Any existing directory (~ expands). Claude starts under the account asked for, or the one the project last used.
  const spawn = ({ cwd, provider, account: label } = {}) => {
    if (typeof cwd === 'string') cwd = cwd.trim().replace(/^~(?=\/|$)/, homedir()).replace(/(.)\/+$/, '$1');
    if (typeof cwd !== 'string' || !isAbsolute(cwd) || !statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) return Promise.reject(fail('No such folder.', 404));
    const account = provider === 'claude' ? claude.accountFor(cwd, label) : null;
    return spawnAgent(cwd, provider, { configDir: account?.label ? account.dir : '' });
  };
  const handler = createHandler({ auth, store, snapshot, origin: origins, vite: vite.middlewares, messages, spawn });
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
  for (const { poller } of claudeUsage) poller.start();
  // npm start polls for this file; write then rename so it never reads a partial file.
  await writeFile(join(dataDir, 'server.json.tmp'), JSON.stringify({ pid: process.pid, url: origin, host, port, startedAt: new Date().toISOString() }), { mode: 0o600 });
  await rename(join(dataDir, 'server.json.tmp'), join(dataDir, 'server.json'));
  console.log(`AI Control: ${origin}${loopback ? `, and http://localhost:${port} on this machine` : ''}`);
  let closing = false;
  async function close() {
    if (closing) return; closing = true;
    auth.persist(loginsFile);
    codex.stop(); for (const { poller } of claudeUsage) poller.stop(); await claude.stop(); await vite.close();
    await closeServers();
    await unlink(join(dataDir, 'server.json')).catch(() => {});
  }
  return { close, origin };
}
