import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fail } from './requests.mjs';
import { uploadBodyLimit } from './uploads.mjs';

function json(res, status, value, req) {
  res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const text = JSON.stringify(value);
  // The 3-second snapshot carries every session's history and compresses about tenfold. It holds no
  // tokens, so compression cannot leak one (BREACH); other responses stay uncompressed.
  if (!req || !/\bgzip\b/.test(req.headers['accept-encoding'] || '')) { res.end(text); return; }
  res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding'); res.end(gzipSync(text));
}
async function body(req, limit = 64 * 1024) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail('Expected JSON.', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) { const part = Buffer.from(chunk); size += part.length; if (size > limit) throw fail('Request is too large.', 413); chunks.push(part); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('Invalid JSON.'); }
}

export function createHandler({ auth, store, snapshot, origin, vite, messages, spawn, folder, lost, budget, push, workflow, online }) {
  const origins = [origin].flat(), hosts = origins.map(o => new URL(o).host);
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The second session pane is the same authenticated app in a same-origin frame.
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'");
    if (origins[0].startsWith('https:')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      if (!hosts.includes(req.headers.host)) throw fail('Unrecognized host.', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw fail('Cross-site requests are blocked.', 403);
      const path = new URL(req.url, origins[0]).pathname;
      if (!path.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) throw fail('Method not allowed.', 405);
        vite(req, res, () => json(res, 404, { error: 'Not found.' })); return;
      }
      if (!['GET', 'POST'].includes(req.method)) throw fail('Method not allowed.', 405);
      if (req.method === 'POST' && !origins.includes(req.headers.origin)) throw fail('Invalid request origin.', 403);
      if (path === '/api/login' && req.method === 'POST') {
        const data = await body(req);
        const { token, session } = await auth.login(data.password, req.socket.remoteAddress);
        // Invalidate an existing browser session on re-authentication.
        auth.logout(await auth.get(req));
        res.setHeader('Set-Cookie', auth.cookie(token));
        json(res, 200, { authenticated: true, csrf: session.csrf }); return;
      }
      const session = await auth.get(req);
      if (path === '/api/auth' && req.method === 'GET') { json(res, 200, { authenticated: !!session, kind: await auth.kind(), ...(session ? { csrf: session.csrf, idleRemainingMs: session.idleRemainingMs } : {}) }); return; }
      if (!session) throw fail('Unlock AI Control to continue.', 401);
      if (req.method === 'POST' && req.headers['x-csrf-token'] !== session.csrf) throw fail('Invalid request token.', 403);
      if (path === '/api/logout' && req.method === 'POST') {
        auth.logout(session); res.setHeader('Set-Cookie', auth.cookie('', 0)); json(res, 200, { ok: true }); return;
      }
      if (path === '/api/activity' && req.method === 'POST') { auth.touch(session); res.setHeader('Set-Cookie', auth.cookie(session.token)); json(res, 200, { ok: true }); return; }
      if (path === '/api/password' && req.method === 'POST') {
        const data = await body(req);
        try { await auth.change(data.current, data.next, req.socket.remoteAddress); } catch (error) { throw fail(error.message, error.status === 401 ? 400 : error.status || 400); }
        if (push) await push.syncCredential();
        res.setHeader('Set-Cookie', auth.cookie('', 0)); json(res, 200, { ok: true }); return;
      }
      if (path === '/api/push/key' && req.method === 'GET') { if (!push) throw fail('Push notifications are unavailable.', 503); json(res, 200, { publicKey: push.publicKey }); return; }
      if (path === '/api/push/subscribe' && req.method === 'POST') { if (!push) throw fail('Push notifications are unavailable.', 503); await push.subscribe(await body(req)); json(res, 200, { ok: true }); return; }
      if (path === '/api/push/unsubscribe' && req.method === 'POST') { if (!push) throw fail('Push notifications are unavailable.', 503); const data = await body(req); await push.unsubscribe(data.endpoint); json(res, 200, { ok: true }); return; }
      if (path === '/api/snapshot' && req.method === 'GET') { json(res, 200, snapshot(), req); return; }
      if (path === '/api/workspace' && workflow) {
        const result = req.method === 'GET' ? workflow.workspace.snapshot() : await workflow.patch(await body(req, 256 * 1024));
        if (req.method === 'POST') auth.touch(session);
        json(res, 200, result); return;
      }
      if (path === '/api/history/search' && req.method === 'GET' && workflow) {
        const query = new URL(req.url, origins[0]).searchParams, provider = query.get('provider') || '', project = query.get('project') || '';
        if (provider.length > 80 || project.length > 8192) throw fail('Invalid history search.', 400);
        json(res, 200, await workflow.history.search(query.get('q') || '', { provider, project })); return;
      }
      if (path === '/api/history/session' && req.method === 'GET' && workflow) {
        const archived = await workflow.history.session(new URL(req.url, origins[0]).searchParams.get('id'));
        if (!archived) throw fail('History is unavailable for this session.', 404);
        json(res, 200, archived); return;
      }
      if (path === '/api/decisions' && req.method === 'GET' && workflow) {
        const query = new URL(req.url, origins[0]).searchParams;
        json(res, 200, await workflow.decisions({ session: query.get('session') || '', q: query.get('q') || '' })); return;
      }
      if (path === '/api/providers/health' && req.method === 'GET' && workflow) { json(res, 200, workflow.health()); return; }
      const providerRetry = /^\/api\/providers\/([a-z]+)\/retry$/.exec(path);
      if (providerRetry && req.method === 'POST' && workflow) { const result = await workflow.retry(providerRetry[1]); auth.touch(session); json(res, 200, result); return; }
      const repositoryRoute = /^\/api\/sessions\/([^/]+)\/repository$/.exec(path);
      if (repositoryRoute && req.method === 'GET' && workflow) {
        let id; try { id = decodeURIComponent(repositoryRoute[1]); } catch { throw fail('Invalid session ID.'); }
        const query = new URL(req.url, origins[0]).searchParams;
        json(res, 200, await workflow.repository(id, query.has('path') ? query.get('path') : null)); return;
      }
      if (path === '/api/usage/opencode/budget' && req.method === 'POST') {
        if (!budget) throw fail('Spend budgets are unavailable.', 503);
        const result = await budget(await body(req)); auth.touch(session); json(res, 200, result); return;
      }
      // Whether a typed folder is there, could be made (see folders.mjs), or neither: for the new agent menu as you type.
      if (path === '/api/folder' && req.method === 'GET') {
        if (!folder) throw fail('Starting agents is not available.', 503);
        json(res, 200, { state: folder(new URL(req.url, origins[0]).searchParams.get('path') || '') }); return;
      }
      if (path === '/api/spawn' && req.method === 'POST') {
        if (!spawn) throw fail('Starting agents is not available.', 503);
        const result = await spawn(await body(req)); auth.touch(session); json(res, 200, result); return;
      }
      // Office online (office-online.mjs): joining a hub or leaving it, this browser's bests out with the board back, and
      // your fruit and colour for meetings. A sync runs by itself, so it isn't activity; joining, leaving and a look are.
      if (path === '/api/office/online' || path === '/api/office/scores' || path === '/api/office/look') {
        if (!online) throw fail('Office online is not available.', 503);
        if (path === '/api/office/online' && req.method === 'GET') { json(res, 200, online.status()); return; }
        if (req.method === 'POST') {
          const data = await body(req, 4096);
          if (path === '/api/office/scores') { json(res, 200, await online.sync(data?.scores)); return; }
          if (path === '/api/office/look') { const result = online.look(data); auth.touch(session); json(res, 200, result); return; }
          const result = data?.leave ? await online.leave() : await online.join(data ?? {});
          auth.touch(session); json(res, 200, result); return;
        }
      }
      // Lost sessions (recovery.mjs): resumed in tmux, or let go.
      const lostAction = /^\/api\/lost\/(resume|dismiss)$/.exec(path);
      if (lostAction && req.method === 'POST') {
        if (!lost) throw fail('Recovery is not available.', 503);
        const { ids } = await body(req);
        if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || id.length > 200)) throw fail('Choose sessions to resume.', 400);
        const result = await lost[lostAction[1]]([...new Set(ids)]); auth.touch(session); json(res, 200, result); return;
      }
      // A session's images: the list as JSON, or one image's bytes (its type checked from the bytes).
      const imageRoute = /^\/api\/sessions\/([^/]+)\/images(?:\/([^/]+))?$/.exec(path);
      if (imageRoute && req.method === 'GET') {
        if (!messages?.images) throw fail('Images are not available.', 503);
        let id, imageId;
        try { id = decodeURIComponent(imageRoute[1]); imageId = imageRoute[2] && decodeURIComponent(imageRoute[2]); } catch { throw fail('Invalid session ID.'); }
        if (!imageId) { json(res, 200, await messages.images(id)); return; }
        const { type, data } = await messages.image(id, imageId);
        // Revalidate after authentication: local files can change under the same image ID.
        // Browsers may reuse the bytes, but shared caches and logged-out requests cannot.
        const etag = `"${createHash('sha256').update(type).update(data).digest('hex')}"`;
        res.setHeader('Cache-Control', 'private, no-cache'); res.setHeader('Vary', 'Cookie'); res.setHeader('ETag', etag);
        if (req.headers['if-none-match']?.split(',').some(value => ['*', etag].includes(value.trim().replace(/^W\//, '')))) { res.statusCode = 304; res.end(); return; }
        res.statusCode = 200; res.setHeader('Content-Type', type); res.setHeader('Content-Length', data.length); res.setHeader('Content-Security-Policy', "default-src 'none'"); res.end(data); return;
      }
      // A session's Markdown files: the list, or one file's text.
      const documentRoute = /^\/api\/sessions\/([^/]+)\/documents(?:\/([^/]+))?$/.exec(path);
      if (documentRoute && req.method === 'GET') {
        if (!messages?.documents) throw fail('Documents are not available.', 503);
        let id, documentId;
        try { id = decodeURIComponent(documentRoute[1]); documentId = documentRoute[2] && decodeURIComponent(documentRoute[2]); } catch { throw fail('Invalid session ID.'); }
        json(res, 200, await (documentId ? messages.document(id, documentId) : messages.documents(id))); return;
      }
      const sessionRoute = /^\/api\/sessions\/([^/]+)\/(messages|interrupt|fire|clear|model|models|effort|history|queue\/([^/]+)\/cancel)$/.exec(path);
      if (sessionRoute && req.method === (['history', 'models'].includes(sessionRoute[2]) ? 'GET' : 'POST')) {
        if (!messages) throw fail('Messaging is not available.', 503);
        let id, queuedId;
        try { id = decodeURIComponent(sessionRoute[1]); queuedId = sessionRoute[3] && decodeURIComponent(sessionRoute[3]); } catch { throw fail('Invalid session ID.'); }
        const action = sessionRoute[2];
        if (action === 'models') { if (!messages.models) throw fail('Model selection is unavailable.', 503); json(res, 200, { models: await messages.models(id) }, req); return; }
        if (action === 'history') {
          // Reading older messages is not activity; the 3-second poll isn't either.
          const limit = Math.min(1000, Math.max(20, Number(new URL(req.url, origins[0]).searchParams.get('limit')) || 40));
          json(res, 200, await messages.history(id, limit), req); return;
        }
        const result = action === 'messages' ? await messages.send(id, await body(req, uploadBodyLimit)) : action === 'interrupt' ? await messages.interrupt(id) : action === 'fire' ? await messages.fire(id, await body(req)) : action === 'clear' ? await messages.clear(id) : action === 'model' ? await messages.model(id, await body(req)) : action === 'effort' ? await messages.effort(id, await body(req)) : await messages.cancel(id, queuedId);
        auth.touch(session); json(res, 200, result); return;
      }
      const match = /^\/api\/requests\/([a-f0-9-]{36})\/respond$/.exec(path);
      if (match && req.method === 'POST') { await store.respond(match[1], await body(req)); auth.touch(session); json(res, 200, { ok: true }); return; }
      throw fail('Not found.', 404);
    } catch (error) { if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'The server could not complete this request.', ...(error.code === 'force_available' ? { code: error.code } : {}) }); else res.end(); }
  };
}
