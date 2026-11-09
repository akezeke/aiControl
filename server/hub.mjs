// Office online's hub: the one place friends' AI Controls meet. Its own process (scripts/hub.mjs), on 127.0.0.1 behind
// Tailscale Funnel, with no access to any session: all it ever holds is each player's name, best scores and when they were
// last seen, keyed by a hash of their install's token. One route, POST /scores, behind the room key: merge what a player
// sends into their bests (leaderboard.js decides what's possible and what's better) and answer the whole board.
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { clean, cleanName, merge } from '../client/office/leaderboard.js';
import { dayKey } from '../client/office/daily.js';
import { checkUp, COLOURS, PROTOCOL } from '../client/office/meeting.js';

const BODY = 4096, PLAYERS = 32, PER_SECOND = 20, SAVE_MS = 1000, SEATS = 8, LIVE_BYTES = 64 * 1024;
const sha = value => createHash('sha256').update(value).digest();
const fail = (status, error) => Object.assign(new Error(error), { status });

function save(file, state) {
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 }); renameSync(temporary, file);
}
// The hub's file, made with a fresh key the first time. A file that's there but unreadable is an error, never overwritten.
export function hubState(file) {
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof state.key === 'string' && state.players && typeof state.players === 'object') {
      if (typeof state.hostKey !== 'string') { state.hostKey = randomBytes(16).toString('base64url'); save(file, state); }
      return state;
    }
    throw new Error(`${file} is not a hub file.`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const state = { key: randomBytes(16).toString('base64url'), hostKey: randomBytes(16).toString('base64url'), players: {} };
  save(file, state); return state;
}
// A new room key: every joined player is refused until they have the new code. Players and scores stay.
export function newKey(file) { const state = hubState(file); state.key = randomBytes(16).toString('base64url'); save(file, state); return state.key; }

async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'Expected JSON.');
  if (Number(req.headers['content-length']) > BODY) throw fail(413, 'Too large.');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > BODY) throw fail(413, 'Too large.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400, 'Invalid JSON.'); }
}

// `hostToken()`: the token of whoever hosts (this machine's AI Control, read by scripts/hub.mjs), marked on the board.
export async function startHub({ file, port = 47843, host = '127.0.0.1', now = Date.now, helloMs = 5000, heartbeatMs = 30_000, hostToken = () => null }) {
  const state = hubState(file), key = sha(state.key), hostKey = sha(state.hostKey);
  // ponytail: one window for everyone. Per-player limits if a hub ever has more than a handful of friends.
  let second = -1, count = 0, timer = null, writing = Promise.resolve();
  const write = () => (writing = writing.then(async () => {
    const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 }); await rename(temporary, file);
  }).catch(error => console.error('Could not save the hub:', error.message)));
  const later = () => { if (!timer) { timer = setTimeout(() => { timer = null; write(); }, SAVE_MS); timer.unref(); } };
  const flush = () => { if (!timer) return writing; clearTimeout(timer); timer = null; return write(); };

  async function scores(req, at) {
    const given = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
    if (!given || !timingSafeEqual(sha(given), key)) throw fail(401, 'Wrong code.');
    const body = await readBody(req), name = cleanName(body?.name);
    if (typeof body?.token !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(body.token) || !name) throw fail(400, 'Bad player.');
    const id = sha(body.token).toString('hex'), lower = name.toLowerCase();
    if (Object.entries(state.players).some(([other, p]) => other !== id && p.name.toLowerCase() === lower)) throw fail(409, 'That name is taken.');
    if (!state.players[id] && Object.keys(state.players).length >= PLAYERS) throw fail(429, 'The hub is full.');
    const day = dayKey(new Date(at)), player = state.players[id] ??= { name, scores: {}, seen: 0 };
    player.name = name; player.scores = merge(player.scores, clean(body.scores, day)); player.seen = at;
    later();
    const hostId = (token => typeof token === 'string' ? sha(token).toString('hex') : null)(hostToken());
    return { day, players: Object.entries(state.players).map(([id, { name, scores, seen }]) => ({ name, scores, seen, ...id === hostId && { host: true } })) };
  }


  // The live room, in memory only: one connection per token. Each joined connection carries `p`: its look, where it is
  // ('home' or 'meeting') and its message window. What a peer says is cleaned by checkUp before anything is relayed.
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIVE_BYTES });
  const byToken = new Map(), joined = new Set();
  let floor = null, hostSocket = null;
  // A reader that lets a megabyte pile up is cut off rather than buffered for. `put` takes a message or, sent to many, its text.
  const put = (ws, m) => { if (ws.readyState !== 1) return; if (ws.bufferedAmount > 1 << 20) return ws.terminate(); ws.send(typeof m === 'string' ? m : JSON.stringify(m)); };
  const roster = () => { const text = JSON.stringify({ type: 'roster', players: [...joined].map(({ p }) => ({ id: p.id, name: p.name, fruit: p.fruit, colour: p.colour, at: p.at })) }); for (const ws of joined) put(ws, text); };
  const at = place => [...joined].filter(ws => ws.p.at === place);
  const free = asked => { const taken = new Set([...joined].map(ws => ws.p.colour)); return taken.has(asked) ? COLOURS.find(c => !taken.has(c)) ?? asked : asked; };
  const drop = ws => {
    if (byToken.get(ws.p.token) === ws) byToken.delete(ws.p.token);
    const was = joined.delete(ws);
    if (ws === hostSocket) { hostSocket = null; floor = null; const text = JSON.stringify({ type: 'floor', floor: null }); for (const v of at('meeting')) put(v, text); }
    if (was) roster();
  };
  const relay = (ws, m) => {
    if (!ws.p.id || (ws.p.at !== 'meeting' && ws !== hostSocket)) return;
    const text = JSON.stringify({ ...m, id: ws.p.id });
    for (const other of joined) if (other !== ws && (other.p.at === 'meeting' || other === hostSocket)) put(other, text);
  };
  function heard(ws, m) {
    const p = ws.p;
    if (m.type === 'hello') {
      if (p.id) return;
      // Another protocol is told why (its AI Control says to update) and let go, rather than misread.
      if (m.v !== PROTOCOL) { put(ws, { type: 'refused', why: 'version' }); return ws.close(4002); }
      p.id = Array.from(randomBytes(8), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
      Object.assign(p, { name: state.players[p.token].name, fruit: m.fruit, colour: free(m.colour), at: 'home' }); joined.add(ws);
      put(ws, { type: 'welcome', id: p.id, colour: p.colour, at: p.at }); roster(); return;
    }
    if (!p.id) return;
    if (m.type === 'look') { p.fruit = m.fruit; p.colour = COLOURS.includes(p.colour) && p.colour === m.colour ? p.colour : (joined.delete(ws), free(m.colour)); joined.add(ws); roster(); }
    else if (m.type === 'where') {
      if (m.at === p.at) return;
      if (m.at === 'meeting' && at('meeting').length >= SEATS) return put(ws, { type: 'refused', why: 'full' });
      p.at = m.at; roster(); if (m.at === 'meeting' && floor) put(ws, { type: 'floor', floor });
    }
    else if (m.type === 'pos' || m.type === 'throw') relay(ws, m);
    else if (m.type === 'floor' && ws === hostSocket) { floor = m.floor; const text = JSON.stringify(m); for (const v of at('meeting')) put(v, text); }
  }
  wss.on('connection', (ws, _req, mine) => {
    ws.p = { token: mine.token, windowStart: -Infinity, count: 0, alive: true };
    ws.on('pong', () => { ws.p.alive = true; });
    const late = setTimeout(() => { if (!ws.p.id) ws.terminate(); }, helloMs); late.unref(); ws.on('close', () => clearTimeout(late));
    const old = byToken.get(mine.token); byToken.set(mine.token, ws);
    if (mine.host) hostSocket = ws;
    if (old) { drop(old); old.close(4000); if (mine.host) hostSocket = ws; }
    ws.on('message', (data, binary) => {
      if (ws.readyState !== 1) return; // closing (replaced, refused): it says nothing more to anyone
      const t = now();
      if (t - ws.p.windowStart >= 1000) { ws.p.windowStart = t; ws.p.count = 0; }
      if (++ws.p.count > 2 * PER_SECOND) return ws.terminate(); // not close(): a flooder needn't answer it, and would keep sending
      if (ws.p.count > PER_SECOND || binary) return;
      let m; try { m = checkUp(JSON.parse(data.toString('utf8'))); } catch { return; }
      if (m) heard(ws, m);
    });
    ws.on('close', () => drop(ws)); ws.on('error', () => ws.terminate());
  });
  // Silent peers (a sleeping phone, a dead network) are dropped: no pong since the last ping.
  const beat = setInterval(() => { for (const ws of wss.clients) { if (!ws.p.alive) ws.terminate(); else { ws.p.alive = false; ws.ping(); } } }, heartbeatMs); beat.unref();
  function upgrade(req, socket, head) {
    const refuse = () => { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); };
    if (req.url !== '/live') return socket.destroy();
    const given = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1], tok = req.headers['x-player'], asked = req.headers['x-host'];
    if (!given || !timingSafeEqual(sha(given), key) || typeof tok !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(tok)) return refuse();
    const id = sha(tok).toString('hex');
    if (!state.players[id]) return refuse();
    const host = typeof asked === 'string' && timingSafeEqual(sha(asked), hostKey);
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req, { token: id, host }));
  }

  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    try {
      const at = now(), s = Math.floor(at / 1000);
      if (s !== second) { second = s; count = 0; }
      if (++count > PER_SECOND) throw fail(429, 'Too many requests.');
      if (req.method !== 'POST' || req.url !== '/scores') throw fail(404, 'Not found.');
      const board = await scores(req, at);
      res.end(JSON.stringify(board));
    } catch (error) {
      res.statusCode = error.status || 500; res.end(JSON.stringify({ error: error.status ? error.message : 'Hub error.' }));
      if (!error.status) console.error(error);
    }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 5_000;
  server.on('upgrade', upgrade);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return {
    server, flush,
    async close() { await flush(); clearInterval(beat); for (const ws of wss.clients) ws.terminate(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
