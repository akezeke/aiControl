// Office online's hub: the one place friends' AI Controls meet. Its own process (scripts/hub.mjs), on 127.0.0.1 behind
// Tailscale Funnel, with no access to any session: all it ever holds is each player's name, best scores and when they were
// last seen, keyed by a hash of their install's token. One route, POST /scores, behind the room key: merge what a player
// sends into their bests (leaderboard.js decides what's possible and what's better) and answer the whole board.
import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { clean, cleanName, merge } from '../client/office/leaderboard.js';
import { dayKey } from '../client/office/daily.js';

const BODY = 4096, PLAYERS = 32, PER_SECOND = 20, SAVE_MS = 1000;
const sha = value => createHash('sha256').update(value).digest();
const fail = (status, error) => Object.assign(new Error(error), { status });

function save(file, state) {
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 }); renameSync(temporary, file);
}
// The hub's file, made with a fresh key the first time. A file that's there but unreadable is an error, never overwritten.
export function hubState(file) {
  try { const state = JSON.parse(readFileSync(file, 'utf8')); if (typeof state.key === 'string' && state.players && typeof state.players === 'object') return state; throw new Error(`${file} is not a hub file.`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const state = { key: randomBytes(16).toString('base64url'), players: {} };
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

export async function startHub({ file, port = 47843, host = '127.0.0.1', now = Date.now }) {
  const state = hubState(file), key = sha(state.key);
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
    return { day, players: Object.values(state.players).map(({ name, scores, seen }) => ({ name, scores, seen })) };
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
  server.on('upgrade', (_req, socket) => socket.destroy());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return {
    server, flush,
    async close() { await flush(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
