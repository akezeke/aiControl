import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { appendFile, writeFile, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { hostname as machineName } from 'node:os';
import { createServer as createViteServer } from 'vite';
import { Auth } from './auth.mjs';
import { RequestStore } from './requests.mjs';
import { CodexAdapter } from './codex.mjs';
import { ClaudeAdapter } from './claude.mjs';
import { UsagePoller, claudeUsageReader } from './usage.mjs';
import { createHandler } from './http.mjs';
import { fail } from './requests.mjs';
import { spawnAgent } from './claude-messaging.mjs';
import { root, authFile, dataDir, hookSocket, port, claudeDirs } from './config.mjs';

export async function startServer({ host, hostname, tls = null }) {
  const origin = `${tls ? 'https' : 'http'}://${hostname}:${port}`;
  const origins = host === '127.0.0.1' ? [origin, `http://localhost:${port}`] : [origin];
  const auth = new Auth(authFile, { secure: !!tls });
  const loginsFile = join(dataDir, 'logins.json');
  auth.restore(loginsFile);
  const store = new RequestStore(async entry => { await appendFile(join(dataDir, 'decisions.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 }); });
  const codex = new CodexAdapter(store);
  const configDirs = claudeDirs();
  const claude = new ClaudeAdapter(store, hookSocket, { configDirs });
  // One usage row per account: ~/.claude-personal is "Claude Code · personal".
  const claudeUsage = configDirs.map(dir => new UsagePoller('claude', ['Claude Code', basename(dir).replace(/^\.?claude-?/, '')].filter(Boolean).join(' · '), claudeUsageReader({ credentialsFile: join(dir, '.credentials.json') })));
  const vite = await createViteServer({ configFile: join(root, 'vite.config.mjs'), server: { middlewareMode: true, hmr: false, allowedHosts: origins.map(o => new URL(o).hostname) } });
  const snapshot = () => {
    const requests = store.list();
    const sessions = [...codex.list(), ...claude.list()].map(session => {
      const pending = requests.filter(r => r.sessionId === session.id);
      return { ...session, ...(pending.length ? { status: pending[0].kind === 'question' ? 'question' : 'permission' } : {}), requests: pending };
    });
    // A request may arrive just before session metadata; keep it visible.
    for (const request of requests) if (!sessions.some(s => s.id === request.sessionId)) sessions.push({ id: request.sessionId, provider: request.provider, title: 'Session connecting', project: 'Connecting', cwd: '', status: request.kind === 'question' ? 'question' : 'permission', updatedAt: request.createdAt, requests: requests.filter(r => r.sessionId === request.sessionId), control: true });
    return { sessions, usage: [codex.usage.snapshot(), ...claudeUsage.map(poller => poller.snapshot())], features: { messaging: true, steering: true, claudeMessaging: true }, updatedAt: Date.now(), machine: machineName(), providers: [{ name: 'Codex', connected: codex.connected, detail: codex.detail }, { name: 'Claude Code', connected: claude.connected, detail: claude.detail }] };
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
    effort: (id, body) => claudeId(id) ? claude.setEffort(claudeId(id), body?.effort) : codex.setEffort(messageTarget(id), body?.effort),
    history: (id, limit) => claudeId(id) ? claude.history(id, limit) : codex.history(messageTarget(id), limit),
  };
  // Only directories a live session already runs in.
  const spawn = ({ cwd, provider } = {}) => [...codex.list(), ...claude.list()].some(s => s.cwd && s.cwd === cwd) ? spawnAgent(cwd, provider) : Promise.reject(fail('Unknown project.', 404));
  const handler = createHandler({ auth, store, snapshot, origin: origins, vite: vite.middlewares, messages, spawn });
  const server = tls ? createHttpsServer(tls, handler) : createHttpServer(handler);
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  server.on('upgrade', (_req, socket) => socket.destroy());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  try { await claude.start(); } catch (e) { server.close(); await vite.close(); throw e; }
  codex.start();
  for (const poller of claudeUsage) poller.start();
  await writeFile(join(dataDir, 'server.json'), JSON.stringify({ pid: process.pid, url: origin, host, port, startedAt: new Date().toISOString() }), { mode: 0o600 });
  console.log(`AI Control: ${origin}`);
  let closing = false;
  async function close() {
    if (closing) return; closing = true;
    auth.persist(loginsFile);
    codex.stop(); for (const poller of claudeUsage) poller.stop(); await claude.stop(); await vite.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await unlink(join(dataDir, 'server.json')).catch(() => {});
  }
  return { close, origin };
}
