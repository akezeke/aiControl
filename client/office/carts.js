// PICO-8 carts for the boss desk: Lexaloffle's own BBS widget plays them, in the viewer's browser. The pids pasted in v1 are
// only read now, for the one-time import into the server desktop (pc-store.js).
export const CARTS_KEY = 'ai-control-office-carts';
const KEEP = 8, PID = /^[\w-]{1,64}$/, BBS = /https?:\/\/(?:www\.)?lexaloffle\.com\/bbs\/[^\s"'<>]*/i;

// Only carts checked by hand: an author can turn embedding off (Celeste, Porklike and Dank Tomb have), and the widget then
// shows a "play at lexaloffle" page instead of the cart.
export const STARTERS = [
  { pid: 'celeste_classic_2-5', title: 'Celeste Classic 2', author: 'noel' },
  { pid: 'mot_grandprix2-0', title: "Mot's Grand Prix", author: 'Mot' },
  { pid: 'pico_ball-5', title: 'PICO-BALL', author: 'Munchkin' },
  { pid: 'mot_pool-23', title: "Mot's 8-Ball Pool", author: 'Mot' },
];

// The first lexaloffle.com BBS link in the text, parsed; null for other hosts or no link.
function bbsLink(text) {
  const link = String(text ?? '').trim().match(BBS)?.[0];
  if (!link) return null;
  try {
    const url = new URL(link);
    return ['lexaloffle.com', 'www.lexaloffle.com'].includes(url.hostname) ? url : null;
  } catch { return null; }
}

// A `pid=` link on lexaloffle.com (a post's link or the BBS Embed snippet), a bare post number or a cart id such as
// porklike-2. Thread (`tid=`) links name no cart; threadId reads them and the server asks the BBS which cart they mean.
export function cartPid(text) {
  text = String(text ?? '').trim();
  if (BBS.test(text)) { const pid = bbsLink(text)?.searchParams.get('pid'); return PID.test(pid ?? '') ? pid : null; }
  return /^\d{1,64}$/.test(text) || /^[a-z0-9_][a-z0-9_-]{0,55}-\d{1,6}$/i.test(text) ? text : null;
}

// Whether a value is already a bare pid (what the server and stored windows hold), not a link.
export const isPid = value => typeof value === 'string' && cartPid(value) === value;

export const threadId = text => bbsLink(text)?.searchParams.get('tid')?.match(/^\d{1,12}$/)?.[0] ?? null;

// NerdyTeachers' Top 200 by BBS stars, the Info Highway's third list (office-pc.mjs reads it).
export const TOP_URL = 'https://nerdyteachers.com/PICO-8/Games/Top200/';
const isTop = text => {
  try { const url = new URL(String(text ?? '').trim()); return url.protocol === 'https:' && ['nerdyteachers.com', 'www.nerdyteachers.com'].includes(url.hostname) && /^\/PICO-8\/Games\/Top200\/?$/.test(url.pathname); } catch { return false; }
};

// A link to the BBS carts list (Pico-8 category) or the Top 200, as the Info Highway shows it; null for anything else.
export function listLink(text) {
  if (isTop(text)) return { tab: 'top', page: 1, q: '' };
  const url = bbsLink(text);
  if (!url || url.searchParams.get('cat') !== '7') return null;
  const hash = new URLSearchParams(url.hash.slice(1)), get = key => url.searchParams.get(key) ?? hash.get(key);
  if (get('mode') !== 'carts') return null;
  const q = (get('search') ?? '').trim(), page = Math.floor(Number(get('page')));
  return { tab: get('orderby') === 'featured' ? 'featured' : 'new', page: Number.isFinite(page) ? Math.min(50, Math.max(1, page)) : 1, q: q.length <= 60 ? q : '' };
}

export const thumbName = pid => /^\d+$/.test(pid) ? `pico${pid}.png` : `pico8_${pid}.png`;

export const listUrl = ({ tab, page, q }) => !q && tab === 'top' ? TOP_URL :
  `https://www.lexaloffle.com/bbs/?cat=7#sub=2&mode=carts${q ? `&search=${encodeURIComponent(q)}` : tab === 'featured' ? '&orderby=featured' : ''}&page=${page}`;

export const widgetUrl = pid => `https://www.lexaloffle.com/bbs/widget.php?pid=${encodeURIComponent(pid)}`;
export const bbsUrl = pid => `https://www.lexaloffle.com/bbs/?pid=${encodeURIComponent(pid)}`;

// Carts pasted in this browser, newest first. Storage can be missing, full or blocked (private windows): never fatal.
export function recentCarts(storage) {
  try {
    const list = JSON.parse(storage?.getItem(CARTS_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(pid => typeof pid === 'string' && cartPid(pid) === pid).slice(0, KEEP) : [];
  } catch { return []; }
}
