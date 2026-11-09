// Office online, this AI Control's side: the hub it joined (from a join code), its name there, and the relay for its scores.
// The page never talks to the hub itself (the CSP keeps connect-src to 'self'), so this is the one door out: a name and best
// scores, and in a meeting (the live link below) only what meeting.js lets through. What comes back is a friend's machine
// talking: capped, re-checked and rebuilt before the page sees it. One request at a time, a board kept 10 s, 5 s at most per
// request; the snapshot poll never waits on it.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { clean, cleanName } from '../client/office/leaderboard.js';
import { dayKey } from '../client/office/daily.js';
import { checkUp, checkDown, meetingFloor, COLOURS } from '../client/office/meeting.js';
import { identity } from '../client/office/status.js';
import { fail } from './requests.mjs';

const FRESH_MS = 10_000, TIMEOUT_MS = 5000, MAX_BYTES = 64 * 1024, MAX_PLAYERS = 64;
const RETRY_MAX_MS = 30_000, PER_SECOND = 20, FROM_PAGE = new Set(['look', 'where', 'pos', 'throw']);
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
    return name ? [{ name, scores: clean(p.scores, data.day), seen: Number.isFinite(p.seen) ? p.seen : 0, ...p.host === true && { host: true } }] : [];
  });
  return { day: data.day, players };
}

// The page's end of the live link: `/api/office/live`, from this dashboard's own host and origin with a valid session, as any
// POST must be; every other upgrade is refused. Pages that stop answering pings (a sleeping phone) or whose session has
// ended (locked, logged out) are dropped, so neither leaves you standing in a meeting.
export function liveUpgrade({ auth, origins, hosts, online, beatMs = 30_000 }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BYTES });
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false; ws.ping();
      auth.get({ headers: { cookie: ws.cookie } }).then(session => { if (!session) ws.close(4001); }, () => ws.terminate());
    }
  }, beatMs);
  beat.unref();
  const upgrade = async (req, socket, head) => {
    // Node takes its own error handler off an upgraded socket; one dying while the session is read mustn't crash the server.
    socket.on('error', () => socket.destroy());
    try {
      const { url, headers } = req;
      if (url !== '/api/office/live' || !hosts.includes(headers.host) || !origins.includes(headers.origin) || headers['sec-fetch-site'] === 'cross-site' || !await auth.get(req)) return socket.destroy();
      wss.handleUpgrade(req, socket, head, ws => {
        ws.alive = true; ws.cookie = headers.cookie; ws.on('pong', () => { ws.alive = true; });
        online.live(ws);
      });
    } catch { socket.destroy(); }
  };
  upgrade.close = () => { clearInterval(beat); for (const ws of wss.clients) ws.terminate(); };
  return upgrade;
}

// `hubFile`: the hub's own file (scripts/hub.mjs), there only on the hub's machine; its hostKey makes this AI Control the host.
export function createOfficeOnline({ file, hubFile = join(dirname(file), 'hub.json'), fetch = globalThis.fetch, now = Date.now, lingerMs = 5000, retryMs = 1000 }) {
  // The file as last read or written; the last good board, the scores it was sent with and when; the request in flight.
  let saved = {}, text = null, last = null, sent = '', at = -Infinity, inflight = null;
  // Re-read on every call: `npm run hub` signs in by writing this file while the server runs (and the token must stay one
  // player's). A file that changed under us drops the board kept for the old one. It's tiny and read only on a request.
  const load = () => {
    let current = ''; try { current = readFileSync(file, 'utf8'); } catch { /* not joined yet */ }
    if (current === text) return;
    text = current; last = null; sent = ''; at = -Infinity;
    try { const read = JSON.parse(current); saved = object(read) ? read : {}; } catch { saved = {}; }
  };
  const save = next => {
    const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    text = JSON.stringify(next) + '\n'; writeFileSync(temporary, text, { mode: 0o600 }); renameSync(temporary, file); saved = next;
  };
  load();
  const joined = () => !!(saved.url && saved.key && saved.name);
  const host = () => new URL(saved.url).hostname;
  // Your fruit and colour in a meeting: as last picked, or your name's fruit and the first colour.
  const look = () => {
    const m = checkUp({ type: 'look', fruit: saved.fruit, colour: saved.colour });
    return m ? { fruit: m.fruit, colour: m.colour } : { fruit: identity(`player:${(saved.name || '').toLowerCase()}`).fruit, colour: COLOURS[0] };
  };
  const kept = () => ({ token: saved.token, ...saved.fruit && { fruit: saved.fruit, colour: saved.colour } });
  // The hub's hostKey when this machine runs the hub you joined, else null.
  const hostKey = () => {
    if (!joined()) return null;
    try { const hub = JSON.parse(readFileSync(hubFile, 'utf8')); return hub?.key === saved.key && typeof hub.hostKey === 'string' ? hub.hostKey : null; }
    catch { return null; }
  };

  // { status, board } for a 200 with a board, { status } otherwise; throws only when the hub can't be reached.
  // A kept-alive connection to a hub that has since restarted dies on first use; scores are safe to send twice (the hub
  // keeps the better), so that one gets a second try on a fresh connection.
  async function ask(url, key, name, scores) {
    const send = () => fetch(`${url}/scores`, {
      // A hub never redirects: following one would send a player's token wherever it pointed.
      method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ token: saved.token, name, scores }),
    });
    let response;
    try { response = await send(); } catch (error) { if (error.cause?.code !== 'UND_ERR_SOCKET') throw error; response = await send(); }
    if (response.status !== 200) { response.body?.cancel().catch(() => {}); return { status: response.status }; }
    let data = null; try { data = JSON.parse(await capped(response)); } catch { /* not JSON, or too big */ }
    return { status: 200, board: board(data) };
  }
  // `hosting`: this machine runs the hub of the meeting you're in, so your office is the meeting (its door goes nowhere).
  // `code`, the meeting's code as `npm run hub` prints it (https:// left off), only for the host's own page: it's the room's key.
  const codeOf = () => `${saved.url.replace(/^https:\/\//, '')}/${saved.key}`;
  const result = extra => ({ joined: true, name: saved.name, host: host(), hosting: !!hostKey(), ...hostKey() && { code: codeOf() }, board: last?.board ?? null, look: look(), ...extra });

  // The live link: one socket to the hub's live room, shared by every page of yours, open while a page is (and 5 s after the
  // last goes, so a reload doesn't leave and come back), or all the time while hosting. Up goes only what checkUp passes and
  // a page may say (look, where, pos, throw); down, only what checkDown passes. The hello is the server's, from the file.
  // `link`: { who (what it's signed in as), hostKey, ws, retry, delay, me (welcome, kept current), roster, floor, asked
  // (where it last asked to be), floorText (the floor last sent), places (id → the last pos heard of each friend at the
  // meeting, as sent on, for a page that opens later: the hub only relays) }. `pages`: page socket → { where, start, count }, in the
  // order they last connected or said where they are. One page speaks for you (its where, pos and throws): the newest at the
  // meeting, else the newest to say where it is, so a tab coming back at home (live.js says where on every connect) doesn't
  // take you out of the meeting another is in. `spoke`: the page that spoke for you last.
  let link = null, linger = null, spoke = null;
  const pages = new Map();
  const put = (socket, text) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 1 << 20) return socket.terminate(); // a tab that stopped reading
    socket.send(text);
  };
  const toPages = m => { const text = JSON.stringify(m); for (const socket of pages.keys()) put(socket, text); return text; };
  const up = m => { if (link?.ws?.readyState === WebSocket.OPEN) link.ws.send(JSON.stringify(m)); };
  const speaker = () => { const said = [...pages].filter(([, page]) => page.where); return (said.findLast(([, page]) => page.where === 'meeting') ?? said.at(-1))?.[0]; };
  // Pages hear the room's gone: nobody's there, and no floor (a visitor's page walks home).
  const gone = l => { if (!l.me) return; l.me = l.roster = l.floor = null; l.floorText = ''; l.places.clear(); toPages({ type: 'roster', players: [] }); toPages({ type: 'floor', floor: null }); };
  function shut() {
    const l = link; if (!l) return;
    link = null; clearTimeout(l.retry); gone(l);
    if (l.ws) { const ws = l.ws; l.ws = null; if (ws.readyState === WebSocket.OPEN) ws.close(1000); else ws.terminate(); }
  }
  function connect(l) {
    const ws = new WebSocket(`${l.url.replace(/^http/, 'ws')}/live`, {
      headers: { authorization: `Bearer ${l.key}`, 'x-player': l.token, ...l.hostKey && { 'x-host': l.hostKey } },
      maxPayload: MAX_BYTES, handshakeTimeout: TIMEOUT_MS, followRedirects: false,
    });
    l.ws = ws;
    ws.on('open', () => { const hello = checkUp({ type: 'hello', name: l.name, ...look() }); if (hello) ws.send(JSON.stringify(hello)); });
    ws.on('message', (data, binary) => {
      if (l.ws !== ws || binary) return;
      let m; try { m = checkDown(JSON.parse(data.toString('utf8'))); } catch { return; }
      if (m) heard(l, m);
    });
    ws.on('error', () => {}); // 'close' follows
    ws.on('close', () => {
      if (l.ws !== ws) return;
      l.ws = null; gone(l);
      if (link !== l) return;
      l.retry = setTimeout(() => { l.retry = null; if (link === l) connect(l); }, l.delay); l.retry.unref();
      l.delay = Math.min(l.delay * 2, RETRY_MAX_MS);
    });
  }
  function heard(l, m) {
    if (m.type === 'welcome') { l.me = { id: m.id, colour: m.colour, at: m.at }; l.asked = m.at; l.delay = retryMs; toPages(m); place(); return; }
    if (!l.me) return;
    if (m.type === 'roster') {
      l.roster = m;
      const mine = m.players.find(p => p.id === l.me.id); if (mine) Object.assign(l.me, { colour: mine.colour, at: mine.at });
      for (const id of l.places.keys()) if (!m.players.some(p => p.id === id && p.at === 'meeting')) l.places.delete(id);
    } else if (m.type === 'floor') l.floor = m.floor;
    else if (m.type === 'refused') l.asked = l.me.at; // still where it was; a page saying where again asks again
    const text = toPages(m);
    if (m.type === 'pos') l.places.set(m.id, text);
  }
  // The link as it should be: signed in as the file says, open while a page is live (or lingering) or while hosting.
  // Only the server's tick (floor) or a page opens one: `npm run hub` signs the host in from its own process with the same
  // token, and a link of its own there would keep it running and push the server's off the hub.
  const resettle = () => { if (link || pages.size) settle(); };
  function settle() {
    load();
    const key = hostKey(), who = joined() ? JSON.stringify([saved.url, saved.key, saved.token, saved.name, key]) : '';
    if (link && link.who !== who) shut(); // signed out, or another meeting, name or host
    if (!who || !(pages.size || linger || key)) return shut();
    if (link) return;
    link = { who, hostKey: key, url: saved.url, key: saved.key, token: saved.token, name: saved.name, ws: null, retry: null, delay: retryMs, me: null, roster: null, floor: null, asked: null, floorText: '', places: new Map() };
    connect(link);
  }
  // Where the hub should have you: a host is at their own meeting while a page of theirs is open (or lingering); anyone
  // else wherever the page that speaks for them last said, and stays put if no page has said.
  function place() {
    // A page at the meeting that no longer speaks for you (a newer one went too) hears the floor's gone, so it walks home.
    const voice = speaker();
    if (spoke && spoke !== voice && pages.get(spoke)?.where === 'meeting') put(spoke, JSON.stringify({ type: 'floor', floor: null }));
    spoke = voice;
    const l = link; if (!l?.me) return;
    const at = l.hostKey ? (pages.size || linger ? 'meeting' : 'home') : (pages.get(voice)?.where ?? l.asked);
    if (at === l.asked) return;
    l.asked = at; if (at === 'home') { l.floor = null; l.places.clear(); }
    up({ type: 'where', at });
  }

  const online = {
    status: () => { load(); return joined() ? { joined: true, name: saved.name, host: host(), ...hostKey() && { code: codeOf() } } : { joined: false }; },

    async join({ code, name } = {}) {
      load();
      const { url, key } = parseCode(code), clean = cleanName(name);
      if (!clean) throw fail('Use 1–16 letters or numbers.', 400);
      if (!saved.token) save({ ...saved, token: randomBytes(18).toString('base64url') });
      let reply;
      try { reply = await ask(url, key, clean, {}); } catch { throw fail("The meeting can't be reached.", 502); }
      if (reply.status === 409) throw fail('That name is taken in this meeting.', 409);
      // Not 401: from this server, the page reads a 401 as locked and shows the PIN screen.
      if (reply.status === 401) throw fail('That code is wrong or has been replaced.', 403);
      if (reply.status === 429) throw fail('The meeting is full or busy.', 429);
      if (reply.status !== 200 || !reply.board) throw fail("The meeting can't be reached.", 502);
      save({ ...kept(), url, key, name: clean });
      last = { board: reply.board }; sent = ''; at = -Infinity;
      resettle();
      return result();
    },

    async leave() { load(); save(kept()); last = null; sent = ''; at = -Infinity; resettle(); return { joined: false, look: look() }; },

    async sync(given = {}) {
      load();
      if (!joined()) return { joined: false };
      // The allowlist is kept here, not by the page: known games, possible scores, nothing else.
      const scores = clean(given, dayKey(new Date(now()))), text = JSON.stringify(scores);
      if (inflight) { await inflight.catch(() => {}); return online.sync(given); }
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

    // Your fruit and colour, kept in the file (joined or not) and sent to the room at once when you're in it.
    look(given) {
      load();
      const m = checkUp({ type: 'look', fruit: given?.fruit, colour: given?.colour });
      if (!m) throw fail('Pick a fruit and a colour.', 400);
      // An open link has said hello first, so the hub takes it; a link not open yet says hello with this look.
      if (m.fruit !== saved.fruit || m.colour !== saved.colour) { save({ ...saved, fruit: m.fruit, colour: m.colour }); up(m); }
      return joined() ? result() : { joined: false, look: look() };
    },

    hosting: () => { load(); return !!hostKey(); },

    // main.mjs's 2 s tick, given its snapshot function: keeps the link as it should be (a host's stays open with no page),
    // and while hosting with the link up, sends the stripped floor when it changed. The snapshot is read only then.
    floor(snapshot) {
      try {
        settle();
        const l = link;
        if (!l?.hostKey || !l.me || l.ws?.readyState !== WebSocket.OPEN) return;
        const m = checkUp({ type: 'floor', floor: meetingFloor(snapshot()) }), text = m && JSON.stringify(m);
        if (!m || text === l.floorText || Buffer.byteLength(text) > MAX_BYTES) return;
        l.floorText = text; l.ws.send(text);
      } catch (error) { console.error('[Office online]', error.message); }
    },

    // A page's live socket (ws, from liveUpgrade). At most 20 messages a second; anything else is dropped.
    live(socket) {
      const page = { where: null, start: -Infinity, count: 0 };
      pages.set(socket, page); clearTimeout(linger); linger = null;
      socket.on('message', (data, binary) => {
        const t = now();
        if (t - page.start >= 1000) { page.start = t; page.count = 0; }
        if (++page.count > PER_SECOND || binary) return;
        let m; try { m = checkUp(JSON.parse(data.toString('utf8'))); } catch { return; }
        if (!m || !FROM_PAGE.has(m.type)) return;
        if (m.type === 'look') { try { online.look(m); } catch (error) { console.error('[Office online]', error.message); } return; }
        if (m.type === 'where') {
          const already = link?.asked === 'meeting';
          page.where = m.at; pages.delete(socket); pages.set(socket, page); place();
          // Already there for another page: the hub won't send the floor again, so this page gets the one it sent.
          if (m.at === 'meeting' && already && link.floor) put(socket, JSON.stringify({ type: 'floor', floor: link.floor }));
          return;
        }
        if (socket === speaker() && link?.me) up(m);
      });
      socket.on('error', () => socket.terminate?.());
      socket.on('close', () => {
        if (!pages.delete(socket)) return;
        if (!pages.size) { linger = setTimeout(() => { linger = null; settle(); place(); }, lingerMs); linger.unref(); }
        place();
      });
      settle(); place();
      if (link?.me) { put(socket, JSON.stringify({ type: 'welcome', ...link.me })); if (link.roster) put(socket, JSON.stringify(link.roster)); for (const text of link.places.values()) put(socket, text); }
    },

    close() { clearTimeout(linger); linger = null; pages.clear(); spoke = null; shut(); },
  };
  return online;
}
