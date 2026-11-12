// Office boss PC, the server's side: what the Info Highway shows of the PICO-8 BBS. Only https://www.lexaloffle.com is ever
// fetched (lister.php, /bbs/ post pages and /bbs/thumbs/), only because the player did something (opened a list, a game page,
// a thumbnail), and every reply is capped. There are no timers: caches are checked and evicted when they're used.
// `dir` (.local) holds the saved desktop (office-pc.json) and the thumbnails of installed carts (office-pc-thumbs/).
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STARTERS, isPid, thumbName } from '../client/office/carts.js';
import { GRID, defaults, normalizeWindows } from '../client/office/pc-windows.js';
import { fail } from './requests.mjs';

const HOST = 'https://www.lexaloffle.com', TIMEOUT_MS = 8000, MAX_BYTES = 1 << 20, THUMB_BYTES = 100 * 1024;
const LIST_MS = 600_000, LISTS = 200, DAY = 86_400_000, CARTS = 500, THUMBS = 300;
const THUMB = /^pico8_[a-z0-9_-]{1,60}-\d{1,4}\.png$|^pico\d{1,7}\.png$/;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const OWN = 48, BUILTINS = ['browser', 'salaries'], isBuiltin = id => BUILTINS.includes(id);
const down = () => fail('Lexaloffle is not answering.', 502);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = text => text.replace(/&(?:#x([\da-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (all, hex, dec, name) => {
  if (name) return ENTITIES[name.toLowerCase()];
  const code = hex ? parseInt(hex, 16) : Number(dec);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
});
const unescape = text => text.replace(/\\(.)/g, '$1');
// The pid inside a thumb name: pico8_<pid>.png, or pico<N>.png for an old numeric cart.
const pidOf = name => /^pico8_([a-z0-9_-]+)\.png$/.exec(name)?.[1] ?? /^pico(\d+)\.png$/.exec(name)?.[1] ?? null;

// A row of the lister's `pdat=[`: ['post', tid, `title`,"/bbs/thumbs/x.png", w, h, "created", uid, "author", "updated", n, "", likes, ...
// Matched by regex, never evaluated: the page is someone else's script.
const ROW = /^\s*\[\s*'(\d+)',\s*(\d+),\s*`((?:[^`\\]|\\.)*)`,\s*"\/bbs\/thumbs\/([^"\\\/]+)",[^,]*,[^,]*,"(?:[^"\\]|\\.)*",\s*\d+,\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)",[^,]*,\s*"(?:[^"\\]|\\.)*",\s*(\d+),/gm;
export function parseList(html) {
  const at = String(html).indexOf('pdat=[');
  if (at < 0) return [];
  const carts = [];
  for (const m of html.slice(at).matchAll(ROW)) {
    const pid = pidOf(m[4]);
    if (pid) carts.push({ pid, tid: Number(m[2]), title: decode(unescape(m[3])), author: decode(unescape(m[5])), thumb: m[4], likes: Number(m[7]), updated: unescape(m[6]) });
  }
  return carts;
}

export function parseCart(html) {
  const title = decode(/<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '').trim();
  const author = decode(/uid=\d+">([^<@\s][^<]*)</.exec(html)?.[1] ?? '').trim();
  const name = /pico8_[a-z0-9_-]+\.png|pico\d+\.png/.exec(html)?.[0] ?? null;
  const pid = /cart_id=([\w-]+)/.exec(html)?.[1] ?? (name && pidOf(name));
  return { pid: pid ?? null, title, author, thumb: name ?? (pid ? thumbName(pid) : null), embed: !html.includes('do not allow embedded playback') };
}

// A body as bytes, cut off past `limit`.
async function read(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('too large');
  const reader = response.body?.getReader(), chunks = []; let size = 0;
  for (;;) {
    const { done, value } = reader ? await reader.read() : { done: true };
    if (done) break;
    size += value.length; if (size > limit) { reader.cancel().catch(() => {}); throw new Error('too large'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
// Oldest out first: re-setting a key moves it to the end.
const keep = (map, key, value, max) => { map.delete(key); map.set(key, value); if (map.size > max) map.delete(map.keys().next().value); };

// Names: trimmed, control characters stripped, 1-40 characters. `loose` (a title off a page) is cut to fit instead of refused.
const tidy = text => String(text ?? '').replace(/\p{Cc}/gu, '').trim();
function nameOf(value, loose) {
  const name = tidy(value);
  if (loose) return name.slice(0, 40);
  if (typeof value !== 'string' || !name || name.length > 40) throw fail('Names are 1–40 characters.');
  return name;
}
const linkOf = value => {
  try { const url = new URL(value); if (url.protocol === 'https:' && value.length <= 500) return value; } catch {}
  throw fail('Links are https addresses of up to 500 characters.');
};
const gridSpot = v => Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && Number.isInteger(v[1]) && v[0] >= 0 && v[0] < GRID.cols && v[1] >= 0 && v[1] < GRID.rows;
// The first cell column by column from the top left that no spot holds.
function freeSpot(spots) {
  const used = new Set(Object.values(spots).map(String));
  for (let c = 0; c < GRID.cols; c++) for (let r = 0; r < GRID.rows; r++) if (!used.has(`${c},${r}`)) return [c, r];
  return null;
}
const nextId = icons => `i${1 + Math.max(0, ...icons.map(i => Number(i.id.slice(1))))}`;

function fresh() {
  const icons = STARTERS.map((c, n) => ({ id: `i${n + 1}`, kind: 'cart', pid: c.pid, name: c.title, author: c.author, embed: true }));
  const spots = {};
  for (const id of [...BUILTINS, ...icons.map(i => i.id)]) spots[id] = freeSpot(spots);
  return { version: 1, icons, spots, ...defaults(), imported: false };
}

// A saved file is never trusted: bad icons go, spots are made valid and unique, windows are normalized.
function repair(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 1) return fresh();
  const seen = new Set(), icons = [];
  for (const i of Array.isArray(raw.icons) ? raw.icons : []) {
    if (!i || typeof i !== 'object' || typeof i.id !== 'string' || !/^i\d{1,6}$/.test(i.id) || seen.has(i.id) || icons.length >= OWN) continue;
    try {
      const name = nameOf(i.name);
      if (i.kind === 'cart' && isPid(i.pid)) icons.push({ id: i.id, kind: 'cart', pid: i.pid, name, author: tidy(i.author).slice(0, 80), embed: i.embed !== false });
      else if (i.kind === 'link') icons.push({ id: i.id, kind: 'link', url: linkOf(i.url), name });
      else continue;
      seen.add(i.id);
    } catch {}
  }
  const ids = [...BUILTINS, ...icons.map(i => i.id)], spots = {}, taken = new Set();
  for (const id of ids) { const s = raw.spots?.[id]; if (gridSpot(s) && !taken.has(String(s))) { spots[id] = [...s]; taken.add(String(s)); } }
  for (const id of ids) if (!spots[id]) spots[id] = freeSpot(spots);
  return { version: 1, icons, spots, ...normalizeWindows(raw), imported: raw.imported === true };
}

export function createOfficePc({ dir, fetch = globalThis.fetch, now = Date.now } = {}) {
  const lists = new Map(), carts = new Map(), thumbs = new Map();
  const get = async (path, limit) => {
    const response = await fetch(`${HOST}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return read(response, limit);
  };

  async function list(params) {
    const q = (params.get('q') ?? '').trim(), tab = params.get('tab') ?? 'featured', pageText = params.get('page') ?? '1', page = /^\d{1,2}$/.test(pageText) ? Number(pageText) : 0;
    if (q.length > 60 || !q && tab !== 'featured' && tab !== 'new' || page < 1 || page > 50) throw fail('Bad list request.', 400);
    const key = `${q ? '' : tab}|${page}|${q}`, hit = lists.get(key);
    if (hit && now() - hit.at < LIST_MS) return hit.reply;
    try {
      const path = `/bbs/lister.php?use_hurl=1&cat=7&sub=2&mode=carts&page=${page}${q ? `&search=${encodeURIComponent(q)}` : tab === 'featured' ? '&orderby=featured' : ''}`;
      const html = (await get(path, MAX_BYTES)).toString('utf8');
      if (!html.includes('pdat=[')) throw new Error('not a list'); // a captcha or a changed layout is no empty list
      const rows = parseList(html);
      const reply = { carts: rows, page, more: rows.length >= 30 };
      keep(lists, key, { at: now(), reply }, LISTS);
      return reply;
    } catch {
      if (hit) return { ...hit.reply, stale: true };
      throw down();
    }
  }

  async function cart(params) {
    const pid = params.get('pid'), tid = params.get('tid');
    if (pid !== null ? !isPid(pid) || tid !== null : tid === null || !/^\d{1,9}$/.test(tid)) throw fail('Bad cart request.', 400);
    const key = pid !== null ? `pid:${pid}` : `tid:${tid}`, hit = carts.get(key);
    if (hit && now() - hit.at < DAY) return hit.reply;
    let parsed;
    try { parsed = parseCart((await get(`/bbs/?${pid !== null ? `pid=${pid}` : `tid=${tid}`}`, MAX_BYTES)).toString('utf8')); } catch { throw down(); }
    // Ids and names read off a page are checked: Task 4 installs this pid.
    const id = isPid(parsed.pid) ? parsed.pid : pid;
    if (!id) throw down();
    const reply = { pid: id, title: parsed.title, author: parsed.author, thumb: THUMB.test(parsed.thumb ?? '') && pidOf(parsed.thumb) === id ? parsed.thumb : thumbName(id), embed: parsed.embed };
    keep(carts, key, { at: now(), reply }, CARTS);
    return reply;
  }

  const file = join(dir, 'office-pc.json'), thumbDir = join(dir, 'office-pc-thumbs');
  const isPng = png => png.length >= PNG.length && png.subarray(0, PNG.length).equals(PNG);
  // Temp file then rename, so a crash never leaves half a file.
  const write = (to, data) => { mkdirSync(join(to, '..'), { recursive: true }); const tmp = `${to}.tmp`; try { writeFileSync(tmp, data, { mode: 0o600 }); renameSync(tmp, to); } catch (error) { rmSync(tmp, { force: true }); throw error; } };
  let state;
  try { state = repair(JSON.parse(readFileSync(file, 'utf8'))); } catch { state = fresh(); }

  async function thumb(name) {
    if (typeof name !== 'string' || !THUMB.test(name)) throw fail('Bad thumbnail name.', 400);
    try { const saved = readFileSync(join(thumbDir, name)); if (isPng(saved)) return saved; } catch {}
    // Only an installed cart's thumbnail is kept on disk (lazily, never fetched for it); it goes when its last icon does.
    const store = png => { if (state.icons.some(i => i.kind === 'cart' && thumbName(i.pid) === name)) try { write(join(thumbDir, name), png); } catch {} };
    const hit = thumbs.get(name);
    if (hit && now() - hit.at < DAY) { keep(thumbs, name, hit, THUMBS); store(hit.png); return hit.png; }
    let png;
    try { png = await get(`/bbs/thumbs/${name}`, THUMB_BYTES); } catch { throw down(); }
    if (!isPng(png)) throw down();
    keep(thumbs, name, { at: now(), png }, THUMBS);
    store(png);
    return png;
  }

  const installed = (d, pid) => d.icons.some(i => i.kind === 'cart' && i.pid === pid);
  const room = d => { if (d.icons.length >= OWN) throw fail('Not enough desktop space.'); };
  const find = (d, id) => { const i = d.icons.find(x => x.id === id); if (!i) throw fail('No such icon.'); return i; };
  const place = (d, icon) => { d.spots[icon.id] = freeSpot(d.spots); d.icons.push(icon); };
  // Cart info for a new icon; an installed pid is a 409, before and after the page names its canonical pid.
  async function info(d, pid) {
    if (!isPid(pid)) throw fail('Not a cart id.');
    if (installed(d, pid)) throw fail('Already on the desktop.', 409);
    const c = await cart(new URLSearchParams({ pid }));
    if (installed(d, c.pid)) throw fail('Already on the desktop.', 409);
    return c;
  }
  const cartIcon = (d, c, name) => ({ id: nextId(d.icons), kind: 'cart', pid: c.pid, name: name ?? (nameOf(c.title, true) || c.pid), author: tidy(c.author).slice(0, 80), embed: c.embed });

  let gone = null; // a thumbnail to delete once the desktop that dropped its cart is saved
  const ops = {
    async add(d, { kind, pid, url, name }) {
      room(d);
      if (kind === 'link') return place(d, { id: nextId(d.icons), kind: 'link', url: linkOf(url), name: nameOf(name) });
      if (kind !== 'cart') throw fail('Add a cart or a link.');
      const given = name === undefined ? undefined : nameOf(name);
      place(d, cartIcon(d, await info(d, pid), given));
    },
    async remove(d, { id }) {
      if (isBuiltin(id)) throw fail('Built-in icons stay.');
      const icon = find(d, id);
      d.icons = d.icons.filter(i => i !== icon); delete d.spots[id];
      if (icon.kind === 'cart' && !installed(d, icon.pid)) gone = thumbName(icon.pid);
    },
    async rename(d, { id, name }) { if (isBuiltin(id)) throw fail('Built-in icons stay.'); const icon = find(d, id); icon.name = nameOf(name); },
    async move(d, { id, spot }) {
      if (!isBuiltin(id)) find(d, id);
      if (!gridSpot(spot)) throw fail('That spot is off the desktop.');
      if (Object.entries(d.spots).some(([other, s]) => other !== id && String(s) === String(spot))) throw fail('That spot is taken.', 409);
      d.spots[id] = [...spot];
    },
    async arrange(d) {
      d.spots = {};
      for (const id of [...BUILTINS, ...d.icons.map(i => i.id)]) d.spots[id] = freeSpot(d.spots);
    },
    async windows(d, { windows, order }) { Object.assign(d, normalizeWindows({ windows, order })); },
    async import(d, { pids }) {
      if (!Array.isArray(pids) || pids.length > 8 || !pids.every(isPid)) throw fail('Bad cart list.');
      if (d.imported) return;
      for (const pid of pids) {
        if (d.icons.length >= OWN) break;
        if (installed(d, pid)) continue;
        let c; try { c = await cart(new URLSearchParams({ pid })); } catch { c = { pid, title: pid, author: '', embed: true }; }
        if (!installed(d, c.pid)) place(d, cartIcon(d, c));
      }
      d.imported = true;
    },
  };

  // One op at a time (an add awaits the network), each on a copy that replaces the desktop only once it succeeded.
  let queue = Promise.resolve();
  const apply = op => {
    const go = async () => {
      const step = Object.hasOwn(ops, op?.op) ? ops[op.op] : null;
      if (!step) throw fail('Unknown operation.');
      const next = structuredClone(state), before = JSON.stringify(state);
      gone = null;
      await step(next, op);
      if (JSON.stringify(next) !== before) { write(file, JSON.stringify(next)); state = next; }
      if (gone) rmSync(join(thumbDir, gone), { force: true });
      return structuredClone(state);
    };
    const result = queue.then(go);
    queue = result.catch(() => {});
    return result;
  };

  return { dir, list, cart, thumb, desktop: () => structuredClone(state), apply };
}
