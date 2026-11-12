// Office boss PC, the server's side: what the Info Highway shows of the PICO-8 BBS. Only https://www.lexaloffle.com is ever
// fetched (lister.php, /bbs/ post pages and /bbs/thumbs/), only because the player did something (opened a list, a game page,
// a thumbnail), and every reply is capped. There are no timers: caches are checked and evicted when they're used.
// `dir` (.local) is where the desktop and installed thumbnails are saved; this file doesn't touch it yet.
import { isPid, thumbName } from '../client/office/carts.js';
import { fail } from './requests.mjs';

const HOST = 'https://www.lexaloffle.com', TIMEOUT_MS = 8000, MAX_BYTES = 1 << 20, THUMB_BYTES = 100 * 1024;
const LIST_MS = 600_000, LISTS = 200, DAY = 86_400_000, CARTS = 500, THUMBS = 300;
const THUMB = /^pico8_[a-z0-9_-]{1,60}-\d{1,4}\.png$|^pico\d{1,7}\.png$/;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
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

  async function thumb(name) {
    if (typeof name !== 'string' || !THUMB.test(name)) throw fail('Bad thumbnail name.', 400);
    const hit = thumbs.get(name);
    if (hit && now() - hit.at < DAY) { keep(thumbs, name, hit, THUMBS); return hit.png; }
    let png;
    try { png = await get(`/bbs/thumbs/${name}`, THUMB_BYTES); } catch { throw down(); }
    if (png.length < PNG.length || !png.subarray(0, PNG.length).equals(PNG)) throw down();
    keep(thumbs, name, { at: now(), png }, THUMBS);
    return png;
  }

  return { dir, list, cart, thumb };
}
