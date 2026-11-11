// PICO-8 carts for the boss desk: Lexaloffle's own BBS widget plays them, in the viewer's browser only (nothing is fetched
// or kept here but the pids someone pasted). Lexaloffle has no cart browser to embed, so browsing is their BBS in a new tab.
export const BROWSE_URL = 'https://www.lexaloffle.com/bbs/?cat=7', CARTS_KEY = 'ai-control-office-carts';
const KEEP = 8, PID = /^[\w-]{1,64}$/, BBS = /https?:\/\/(?:www\.)?lexaloffle\.com\/bbs\/[^\s"'<>]*/i;

// Only carts checked by hand: an author can turn embedding off (Celeste, Porklike and Dank Tomb have), and the widget then
// shows a "play at lexaloffle" page instead of the cart.
export const STARTERS = [
  { pid: 'celeste_classic_2-5', title: 'Celeste Classic 2', author: 'noel' },
  { pid: 'mot_grandprix2-0', title: "Mot's Grand Prix", author: 'Mot' },
  { pid: 'pico_ball-5', title: 'PICO-BALL', author: 'Munchkin' },
  { pid: 'mot_pool-23', title: "Mot's 8-Ball Pool", author: 'Mot' },
];

// A `pid=` link on lexaloffle.com (a post's link or the BBS Embed snippet), a bare post number or a cart id such as
// porklike-2. Thread (`tid=`) links would need the BBS asked which cart they mean, so they're refused.
export function cartPid(text) {
  text = String(text ?? '').trim();
  const link = text.match(BBS)?.[0];
  if (link) {
    try {
      const url = new URL(link), pid = url.searchParams.get('pid');
      return ['lexaloffle.com', 'www.lexaloffle.com'].includes(url.hostname) && PID.test(pid ?? '') ? pid : null;
    } catch { return null; }
  }
  return /^\d{1,64}$/.test(text) || /^[a-z0-9_]{1,56}-\d{1,6}$/i.test(text) ? text : null;
}

export const widgetUrl = pid => `https://www.lexaloffle.com/bbs/widget.php?pid=${encodeURIComponent(pid)}`;
export const bbsUrl = pid => `https://www.lexaloffle.com/bbs/?pid=${encodeURIComponent(pid)}#p`;

// Carts pasted in this browser, newest first. Storage can be missing, full or blocked (private windows): never fatal.
export function recentCarts(storage) {
  try {
    const list = JSON.parse(storage?.getItem(CARTS_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(pid => typeof pid === 'string' && cartPid(pid) === pid).slice(0, KEEP) : [];
  } catch { return []; }
}

export function rememberCart(storage, pid) {
  try { storage?.setItem(CARTS_KEY, JSON.stringify([pid, ...recentCarts(storage).filter(p => p !== pid)].slice(0, KEEP))); } catch { /* not kept */ }
}
