// Office online, this AI Control's side: the hub it joined (from a join code), its name there, and the relay for its scores.
// The page never talks to the hub itself (the CSP keeps connect-src to 'self'), so this is the one door out, and only a
// name and best scores go through it. What comes back is a friend's machine talking: capped, re-checked and rebuilt before
// the page sees it. One request at a time, a board kept 10 s, 5 s at most per request; the snapshot poll never waits on it.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { clean, cleanName } from '../client/office/leaderboard.js';
import { fail } from './requests.mjs';

const FRESH_MS = 10_000, TIMEOUT_MS = 5000, MAX_BYTES = 64 * 1024, MAX_PLAYERS = 64;
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);

// `host.tailnet.ts.net/<key>`, or with its own http(s):// in front; the key is the last part of the path.
export function parseCode(code) {
  let text = typeof code === 'string' ? code.trim().replace(/\/+$/, '') : '';
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text), parts = url.pathname.split('/'), key = parts.pop();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !/^[A-Za-z0-9_-]{22}$/.test(key)) throw new Error();
    return { url: url.origin + parts.join('/'), key };
  } catch { throw fail("That code doesn't look right.", 400); }
}

// A body, cut off past `MAX_BYTES` (a reply that big is no board).
async function capped(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('too large');
  const reader = response.body?.getReader(), chunks = []; let size = 0;
  for (;;) {
    const { done, value } = reader ? await reader.read() : { done: true };
    if (done) break;
    size += value.length; if (size > MAX_BYTES) { reader.cancel().catch(() => {}); throw new Error('too large'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
// The board rebuilt from scratch: only names and scores that pass, every player's own; null if it isn't a board at all.
function board(data) {
  if (!object(data) || typeof data.day !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(data.day) || !Array.isArray(data.players) || data.players.length > MAX_PLAYERS) return null;
  const players = data.players.flatMap(p => {
    const name = object(p) && cleanName(p.name);
    return name ? [{ name, scores: clean(p.scores, data.day), seen: Number.isFinite(p.seen) ? p.seen : 0 }] : [];
  });
  return { day: data.day, players };
}

export function createOfficeOnline({ file, fetch = globalThis.fetch, now = Date.now }) {
  let saved = {};
  try { const read = JSON.parse(readFileSync(file, 'utf8')); if (object(read)) saved = read; } catch { /* not joined yet */ }
  const save = next => {
    const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(temporary, JSON.stringify(next) + '\n', { mode: 0o600 }); renameSync(temporary, file); saved = next;
  };
  const joined = () => !!(saved.url && saved.key && saved.name);
  const host = () => new URL(saved.url).hostname;
  // The last good board, the scores it was sent with and when; the request in flight.
  let last = null, sent = '', at = -Infinity, inflight = null;

  // { status, board } for a 200 with a board, { status } otherwise; throws only when the hub can't be reached.
  // A kept-alive connection to a hub that has since restarted dies on first use; scores are safe to send twice (the hub
  // keeps the better), so that one gets a second try on a fresh connection.
  async function ask(url, key, name, scores) {
    const send = () => fetch(`${url}/scores`, {
      method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ token: saved.token, name, scores }),
    });
    let response;
    try { response = await send(); } catch (error) { if (error.cause?.code !== 'UND_ERR_SOCKET') throw error; response = await send(); }
    if (response.status !== 200) { response.body?.cancel().catch(() => {}); return { status: response.status }; }
    let data = null; try { data = JSON.parse(await capped(response)); } catch { /* not JSON, or too big */ }
    return { status: 200, board: board(data) };
  }
  const result = extra => ({ joined: true, name: saved.name, host: host(), board: last?.board ?? null, ...extra });

  const online = {
    status: () => joined() ? { joined: true, name: saved.name, host: host() } : { joined: false },

    async join({ code, name } = {}) {
      const { url, key } = parseCode(code), clean = cleanName(name);
      if (!clean) throw fail('Use 1–16 letters or numbers.', 400);
      if (!saved.token) save({ ...saved, token: randomBytes(18).toString('base64url') });
      let reply;
      try { reply = await ask(url, key, clean, {}); } catch { throw fail('The hub is not answering.', 502); }
      if (reply.status === 409) throw fail('That name is taken on this hub.', 409);
      if (reply.status === 401) throw fail('That code is wrong or has been replaced.', 401);
      if (reply.status === 429) throw fail('The hub is full or busy.', 429);
      if (reply.status !== 200 || !reply.board) throw fail('The hub is not answering.', 502);
      save({ token: saved.token, url, key, name: clean });
      last = { board: reply.board }; sent = ''; at = -Infinity;
      return result();
    },

    async leave() { save({ token: saved.token }); last = null; sent = ''; at = -Infinity; return { joined: false }; },

    async sync(scores = {}) {
      if (!joined()) return { joined: false };
      const text = JSON.stringify(scores);
      if (inflight) { await inflight.catch(() => {}); return online.sync(scores); }
      if (text === sent && last && now() - at < FRESH_MS) return result();
      inflight = (async () => {
        try {
          const reply = await ask(saved.url, saved.key, saved.name, scores);
          if (reply.status === 401) return result({ error: 'code' });
          if (reply.status !== 200 || !reply.board) return result({ offline: true });
          last = { board: reply.board }; sent = text; at = now();
          return result();
        } catch { return result({ offline: true }); }
      })();
      try { return await inflight; } finally { inflight = null; }
    },
  };
  return online;
}
