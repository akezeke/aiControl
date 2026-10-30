import { gzipSync } from 'node:zlib';
import { fail } from './requests.mjs';

function json(res, status, value, req) {
  res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const text = JSON.stringify(value);
  // The 3-second snapshot carries every session's history and compresses about tenfold. It holds no
  // tokens, so compression cannot leak one (BREACH); other responses stay uncompressed.
  if (!req || !/\bgzip\b/.test(req.headers['accept-encoding'] || '')) { res.end(text); return; }
  res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding'); res.end(gzipSync(text));
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail('Expected JSON.', 415);
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 64 * 1024) throw fail('Request is too large.', 413); }
  try { return JSON.parse(raw); } catch { throw fail('Invalid JSON.'); }
}

export function createHandler({ auth, store, snapshot, origin, vite, messages, spawn }) {
  const origins = [origin].flat(), hosts = origins.map(o => new URL(o).host);
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
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
        res.setHeader('Set-Cookie', auth.cookie('', 0)); json(res, 200, { ok: true }); return;
      }
      if (path === '/api/snapshot' && req.method === 'GET') { json(res, 200, snapshot(), req); return; }
      if (path === '/api/spawn' && req.method === 'POST') {
        if (!spawn) throw fail('Starting agents is not available.', 503);
        const result = await spawn(await body(req)); auth.touch(session); json(res, 200, result); return;
      }
      // A session's images: the list as JSON, or one image's bytes (its type checked from the bytes).
      const imageRoute = /^\/api\/sessions\/([^/]+)\/images(?:\/([^/]+))?$/.exec(path);
      if (imageRoute && req.method === 'GET') {
        if (!messages?.images) throw fail('Images are not available.', 503);
        let id, imageId;
        try { id = decodeURIComponent(imageRoute[1]); imageId = imageRoute[2] && decodeURIComponent(imageRoute[2]); } catch { throw fail('Invalid session ID.'); }
        if (!imageId) { json(res, 200, await messages.images(id)); return; }
        const { type, data } = await messages.image(id, imageId);
        res.statusCode = 200; res.setHeader('Content-Type', type); res.setHeader('Content-Length', data.length); res.setHeader('Content-Security-Policy', "default-src 'none'"); res.end(data); return;
      }
      const sessionRoute = /^\/api\/sessions\/([^/]+)\/(messages|interrupt|fire|effort|history|queue\/([^/]+)\/cancel)$/.exec(path);
      if (sessionRoute && req.method === (sessionRoute[2] === 'history' ? 'GET' : 'POST')) {
        if (!messages) throw fail('Messaging is not available.', 503);
        let id, queuedId;
        try { id = decodeURIComponent(sessionRoute[1]); queuedId = sessionRoute[3] && decodeURIComponent(sessionRoute[3]); } catch { throw fail('Invalid session ID.'); }
        const action = sessionRoute[2];
        if (action === 'history') {
          // Reading older messages is not activity; the 3-second poll isn't either.
          const limit = Math.min(200, Math.max(20, Number(new URL(req.url, origins[0]).searchParams.get('limit')) || 40));
          json(res, 200, await messages.history(id, limit), req); return;
        }
        const result = action === 'messages' ? await messages.send(id, await body(req)) : action === 'interrupt' ? await messages.interrupt(id) : action === 'fire' ? await messages.fire(id) : action === 'effort' ? await messages.effort(id, await body(req)) : await messages.cancel(id, queuedId);
        auth.touch(session); json(res, 200, result); return;
      }
      const match = /^\/api\/requests\/([a-f0-9-]{36})\/respond$/.exec(path);
      if (match && req.method === 'POST') { await store.respond(match[1], await body(req)); auth.touch(session); json(res, 200, { ok: true }); return; }
      throw fail('Not found.', 404);
    } catch (error) { if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'The server could not complete this request.' }); else res.end(); }
  };
}
