// Info Highway: the boss PC's browser for the PICO-8 BBS, through this server's proxy routes. Fetched text only reaches the page
// through textContent and attributes, there is never a frame (playing goes through onPlay), and nothing runs on its own: pages load
// on a click or a key, and the throbber turns only while one loads. Codex and Claude agents are never told apart here.
import { ICONS, paint, stripUrl, cursorUrl } from './pc-icons.js';
import { cartPid, threadId, listLink, listUrl, bbsUrl, thumbName } from './carts.js';

const FAIL = 'Info Highway cannot open this page. The information superhighway may be closed for repairs.';
const LEGENDS = {
  grid: '←→↑↓ Move   Enter/Z Play   X/Backspace Back   M Menu   S Search   Tab Next',
  game: 'Enter/Z Play   X/Backspace Back   M Menu   S Search   Tab Next',
  other: 'X/Backspace Back   S Search   Tab Next',
};
const dialogOf = text => ({ icon: 'info', text, buttons: ['OK'] });

// What the address bar was given: a cart, a thread, a list, another site (https: asks first, http: opens at once) or a search.
export function readAddress(text) {
  text = String(text ?? '').trim();
  const pid = cartPid(text); if (pid) return { kind: 'cart', pid };
  const tid = threadId(text); if (tid) return { kind: 'thread', tid };
  const list = listLink(text); if (list) return { kind: 'list', ...list };
  try {
    const url = new URL(text);
    if (url.protocol === 'https:') return { kind: 'away', url: url.href };
    if (url.protocol === 'http:') return { kind: 'tab', url: url.href };
  } catch { /* not a URL */ }
  return { kind: 'search', q: text.slice(0, 60) };
}

// The real Lexaloffle address of a page. A thread page has no cart id until its info arrives.
export function addressOf(page) {
  switch (page.kind) {
    case 'list': return listUrl(page);
    case 'game': return page.pid ? bbsUrl(page.pid) : `https://www.lexaloffle.com/bbs/?tid=${page.tid}`;
    case 'away': return page.url;
    default: return page.address;
  }
}

const listPath = ({ tab, page, q }) => 'office/bbs/list?' + new URLSearchParams(q ? { q, page } : { tab, page });
const titleOf = page => !page ? 'Info Highway' : page.kind === 'list' ? (page.q ? `Search: ${page.q}` : page.tab === 'featured' ? 'Featured' : 'New')
  : page.kind === 'game' ? page.cart?.title ?? page.pid ?? 'Opening page…' : page.kind === 'away' ? 'Leaving' : 'Error';

export function createBrowser({ doc = document, api, ui, installed, onPlay, onInstall, open }) {
  const make = (tag, className, text) => { const n = doc.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };
  const row = (...kids) => { const n = make('div'); Object.assign(n.style, { display: 'flex', alignItems: 'center', gap: '6px' }); n.append(...kids); return n; };
  const setDisabled = (n, on) => { n.disabled = on; if (on) n.setAttribute('disabled', ''); else n.removeAttribute('disabled'); };
  const button = (text, fn, extra = '') => {
    const n = make('button', 'pc-button' + extra, text); n.type = 'button';
    n.addEventListener('click', e => { if (!n.disabled) { e?.preventDefault?.(); fn(); } });
    return n;
  };
  const attrs = (n, props) => { for (const [k, v] of Object.entries(props)) { n.setAttribute(k, String(v)); n[k] = String(v); } };

  let hist = [], idx = -1, token = 0, busy = false, legendOn = false, sel = -1, cards = [], closeHandler = null;
  let searchBox = null, primaryEl = null, installBtn = null, cursor = null;
  const visited = new Set();
  const page = () => hist[idx];

  // Chrome: toolbar, address bar, page, status bar. The menu bar is the window's (menus()).
  const back = button('◄ Back', () => back_()), forward = button('► Forward', () => forward_());
  const throbber = make('div', 'pc-throbber'); throbber.style.backgroundImage = `url(${stripUrl(ICONS.throbber, 1, doc)})`;
  const toolbar = row(back, forward, button('⟳ Refresh', () => refresh()), button('⌂ Home', () => home()), throbber);
  const field = make('input', 'pc-field address'); attrs(field, { type: 'text' }); field.setAttribute('spellcheck', 'false');
  field.style.flex = '1';
  const addressBar = row(make('span', '', 'Address'), field, button('Go', () => go(field.value)));
  const pageEl = make('div', 'pc-page');
  const statusEl = make('span'), progress = make('div', 'pc-progress');
  for (let i = 0; i < 6; i++) progress.append(make('div', 'pc-progress-block'));
  const bar = make('div', 'pc-status');
  const node = make('div', 'pc-client pc-browser');
  Object.assign(node.style, { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' });
  node.append(toolbar, addressBar, pageEl, bar);
  // A click or tap brings the normal status back; a key press shows the legend.
  node.addEventListener('click', () => { legendOn = false; setStatus(); });

  const legend = () => { const p = page(); return p?.kind === 'list' && cards.length ? LEGENDS.grid : p?.kind === 'game' ? LEGENDS.game : LEGENDS.other; };
  const base = () => { const p = page(); return !p ? '' : p.kind === 'error' ? FAIL : p.stale ? 'Done (offline copy)' : 'Done'; };
  const status = () => busy ? 'Opening page…' : legendOn ? legend() : base();
  function setStatus() {
    statusEl.textContent = status();
    throbber.classList.toggle('loading', busy);
    cursor ??= `url(${cursorUrl(ICONS.hourglass, 1, doc)}) 8 8, wait`;
    pageEl.style.cursor = busy ? cursor : '';
    bar.replaceChildren(statusEl, ...(busy ? [progress] : []));
  }

  const mark = c => {
    const on = installed(c.row.pid);
    if (on && !c.check) { c.check = make('span', 'pc-check', '✓'); c.head.append(c.check); } else if (!on && c.check) { c.check.remove(); c.check = null; }
  };
  const gameOf = () => {
    const p = page();
    if (p?.kind === 'game') return p.pid ? { pid: p.pid, title: p.cart?.title } : null;
    const c = p?.kind === 'list' && sel >= 0 ? cards[sel]?.row : null;
    return c ? { pid: c.pid, title: c.title, card: c } : null;
  };
  const install = g => onInstall({ pid: g.pid, title: g.title });
  // The selected card (-1 for none) wears pc.css's border as well as its link's focus: the one Enter plays.
  const select = i => { sel = i; cards.forEach((c, j) => c.node.classList.toggle('selected', j === i)); };

  function buildList(p) {
    const tab = (label, name) => { const n = button(label, () => go({ kind: 'list', tab: name, page: 1, q: '' }), !p.q && p.tab === name ? ' pressed' : ''); return n; };
    searchBox = make('input', 'pc-field search'); attrs(searchBox, { type: 'text' }); searchBox.setAttribute('maxlength', '60'); searchBox.value = p.q ?? '';
    const grid = make('div', 'pc-cards');
    (p.carts ?? []).forEach((r, i) => {
      const card = make('div', 'pc-card'); card.setAttribute('data-tip', r.updated);
      const img = make('img', 'pc-thumb'); attrs(img, { loading: 'lazy', width: 128, height: 128, alt: '', src: '/api/office/bbs/thumb/' + r.thumb });
      const a = make('a', '', r.title); a.setAttribute('tabindex', '0'); a.setAttribute('role', 'link');
      a.classList.toggle('visited', visited.has(bbsUrl(r.pid)));
      // No href: Enter on a card plays it (key()), where a real link would open its page. A click anywhere on the card opens it.
      card.addEventListener('click', e => { e?.preventDefault?.(); select(i); go({ kind: 'game', pid: r.pid, cart: r }); });
      a.addEventListener('focus', () => select(i));
      const head = make('div'); head.append(a);
      card.append(img, head, make('div', '', r.author), make('div', '', `♥ ${r.likes}`));
      const c = { row: r, node: card, link: a, head, check: null }; mark(c); cards.push(c); grid.append(card);
    });
    const prev = button('« Prev', () => go({ ...p, page: p.page - 1, carts: undefined })), next = button('Next »', () => go({ ...p, page: p.page + 1, carts: undefined }));
    setDisabled(prev, p.page <= 1); setDisabled(next, !p.more);
    const pager = row(prev, make('span', '', '|'), make('span', '', `Page ${p.page}`), make('span', '', '|'), next);
    return [row(tab('Featured', 'featured'), tab('New', 'new'), searchBox, button('Search', () => search())), make('hr'), grid, make('hr'), pager];
  }
  function buildGame(p) {
    const c = p.cart, img = make('img', 'pc-thumb');
    attrs(img, { width: 256, height: 256, alt: '', src: '/api/office/bbs/thumb/' + (c?.thumb ?? thumbName(p.pid ?? '')) });
    Object.assign(img.style, { width: '256px', height: '256px', imageRendering: 'pixelated' }); img.classList.remove('pc-thumb');
    const info = make('div'); info.append(make('h2', '', c?.title ?? p.pid ?? ''));
    if (c?.author) info.append(make('div', '', c.author));
    if (c?.likes != null) info.append(make('div', '', `♥ ${c.likes}`));
    if (c?.updated) info.append(make('div', '', c.updated));
    const out = [row(img, info)];
    if (p.loaded) {
      const url = bbsUrl(p.pid), link = text => {
        const a = make('a', '', text); attrs(a, { href: url, target: '_blank', rel: 'noopener noreferrer' });
        a.addEventListener('click', e => { e?.preventDefault?.(); open(url); }); return a;
      };
      installBtn = button('Install', () => install({ pid: p.pid, title: c.title })); setDisabled(installBtn, installed(p.pid));
      const play = button('▶ Play', () => onPlay({ pid: p.pid, title: c.title }));
      if (c.embed) { primaryEl = play; out.push(make('hr'), row(play, installBtn, link('Open at lexaloffle ↗'))); }
      else {
        // The author turned embedding off: Play stays, greyed, beside the reason and the way to play it there.
        setDisabled(play, true); primaryEl = button('Play at lexaloffle ↗', () => open(url));
        out.push(make('hr'), row(play, installBtn, primaryEl), make('p', '', 'The author only lets this cart play at lexaloffle.com.'));
      }
    }
    return out;
  }
  function buildPage(p) {
    if (p.kind === 'list') return buildList(p);
    if (p.kind === 'game') return buildGame(p);
    if (p.kind === 'away') {
      primaryEl = button('Open in new tab ↗', () => open(p.url));
      return [make('p', '', 'You are now leaving the Info Highway'), make('p', '', p.url), make('hr'), primaryEl];
    }
    primaryEl = button('Retry', () => retry());
    return [make('p', '', FAIL), make('hr'), primaryEl];
  }
  function render() {
    const p = page();
    cards = []; searchBox = primaryEl = installBtn = null;
    field.value = p ? addressOf(p) : '';
    setDisabled(back, idx <= 0); setDisabled(forward, idx >= hist.length - 1);
    pageEl.replaceChildren(...(p ? buildPage(p) : []));
    setStatus();
  }

  async function fetchPage(p, mine) {
    try {
      if (p.kind === 'list') {
        const r = await api(listPath(p)); if (mine !== token) return;
        Object.assign(p, { carts: r.carts, more: r.more, stale: !!r.stale });
      } else {
        const r = await api('office/bbs/cart?' + (p.pid ? `pid=${encodeURIComponent(p.pid)}` : `tid=${p.tid}`)); if (mine !== token) return;
        // A list row's own title and author stay; the info adds embed.
        p.pid ??= r.pid; p.cart = { ...r, ...p.cart, embed: r.embed }; p.loaded = true; visited.add(bbsUrl(p.pid));
      }
    } catch {
      if (mine !== token) return;
      hist[idx] = { kind: 'error', address: addressOf(p) };
    }
    busy = false; render(); focusPrimary();
  }
  // A page that lands late doesn't take focus from elsewhere (a playing game): only from in here, an ancestor (the desktop's
  // root, where focus falls back) or nowhere.
  function focusPrimary() {
    const a = doc.activeElement;
    if (!a || a === doc.body || node.contains(a) || a.contains?.(node)) primaryEl?.focus();
  }
  // Shows the history entry; only a page without its data fetches.
  function show(p) {
    const mine = ++token; sel = -1;
    busy = (p.kind === 'list' && !p.carts) || (p.kind === 'game' && !p.loaded);
    render();
    if (busy) return fetchPage(p, mine);
    focusPrimary(); return Promise.resolve();
  }
  function visit(p) {
    hist.length = idx + 1; hist.push(p); idx++;
    visited.add(addressOf(p)); return show(p);
  }
  const pageOf = r => r.kind === 'cart' ? { kind: 'game', pid: r.pid } : r.kind === 'thread' ? { kind: 'game', tid: r.tid }
    : r.kind === 'search' ? { kind: 'list', tab: 'new', page: 1, q: r.q } : r;
  function go(input) {
    if (typeof input !== 'string') return visit(input);
    const r = readAddress(input);
    if (r.kind === 'tab') { open(r.url); return Promise.resolve(); }
    if (r.kind === 'search' && !r.q) return Promise.resolve();
    return visit(pageOf(r));
  }
  const home = () => go({ kind: 'list', tab: 'featured', page: 1, q: '' });
  const back_ = () => idx > 0 ? (idx--, show(page())) : Promise.resolve();
  const forward_ = () => idx < hist.length - 1 ? (idx++, show(page())) : Promise.resolve();
  function refresh() {
    const p = page(); if (!p) return Promise.resolve();
    if (p.kind === 'error') return retry();
    if (p.kind === 'list') p.carts = undefined; else if (p.kind === 'game') p.loaded = false;
    return show(p);
  }
  // Replaces the error entry, so Back skips it.
  function retry() { const p = pageOf(readAddress(page().address)); if (p.kind === 'tab') return go(page().address); hist[idx] = p; return show(p); }
  function search() { const q = searchBox?.value.trim().slice(0, 60); return q ? go({ kind: 'list', tab: 'new', page: 1, q }) : undefined; }

  // Enter on a card: cart info first, then the PICO-8 window, or the game page when the author blocked embedding.
  async function playCard(r) {
    const mine = ++token; busy = true; setStatus();
    let info;
    try { info = await api(`office/bbs/cart?pid=${encodeURIComponent(r.pid)}`); } catch { if (mine === token) visit({ kind: 'error', address: bbsUrl(r.pid) }); return; }
    if (mine !== token) return;
    if (info.embed) { busy = false; setStatus(); onPlay({ pid: r.pid, title: r.title }); return; }
    visit({ kind: 'game', pid: r.pid, cart: { ...info, ...r, embed: false }, loaded: true });
  }
  function primary() {
    const p = page();
    if (p?.kind === 'game' && p.loaded) { if (p.cart.embed) onPlay({ pid: p.pid, title: p.cart.title }); else open(bbsUrl(p.pid)); }
    else if (p?.kind === 'away') open(p.url);
    else if (p?.kind === 'error') retry();
    else return false;
    return true;
  }
  function find() {
    if (page()?.kind === 'list' && searchBox) searchBox.focus(); else { field.focus(); field.select?.(); }
  }

  function key(e) {
    legendOn = true; setStatus();
    const k = e.key, active = doc.activeElement, p = page();
    if (e.ctrlKey || e.metaKey) { if (k.toLowerCase() !== 'f') return false; find(); return true; }
    if (e.altKey) return false;
    // Text fields keep their letters; only Enter submits.
    if (active?.tagName === 'INPUT') {
      if (k !== 'Enter') return false;
      if (active === field) go(field.value); else if (active === searchBox) search(); else return false;
      return true;
    }
    switch (k) {
      case 's': case 'S': find(); return true;
      case 'x': case 'X': case 'Backspace': back_(); return true;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        if (p?.kind !== 'list' || !cards.length) return false;
        const top = cards[0].node.offsetTop, cols = cards.filter(c => c.node.offsetTop === top).length;
        const to = sel < 0 ? 0 : sel + { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[k];
        if (to >= 0 && to < cards.length) { select(to); cards[to].link.focus(); cards[to].node.scrollIntoView?.({ block: 'nearest' }); }
        return true;
      }
      case 'Enter': case 'z': case 'Z': {
        const control = active && (active.tagName === 'BUTTON' || active.tagName === 'A');
        if (p?.kind === 'list' && cards.length) {
          const at = cards.findIndex(c => c.link === active);
          if (at < 0 && control) return false;
          select(at >= 0 ? at : Math.max(sel, 0)); playCard(cards[sel].row); return true;
        }
        // On a control Enter is the browser's own click; Z has no such default.
        if (k === 'Enter' && control) return false;
        return primary();
      }
      default: return false;
    }
  }

  const items = () => {
    const g = gameOf();
    return {
      install: { label: '&Install', disabled: !g?.title || installed(g.pid), run: () => install(g) },
      tab: { label: 'Open in new &tab ↗', disabled: !g, run: () => open(bbsUrl(g.pid)) },
      play: { label: '&Play', run: () => g.card ? playCard(g.card) : primary() },
    };
  };
  const close = () => { token++; hist = []; idx = -1; busy = false; legendOn = false; sel = -1; visited.clear(); render(); };

  render();
  return {
    node, home, go, back: back_, forward: forward_, refresh, close, legend, status, key, page,
    title: () => `${titleOf(page())} - Info Highway`,
    selection: () => { const p = page(); return p?.kind === 'game' ? p : p?.kind === 'list' && sel >= 0 ? cards[sel]?.row ?? null : null; },
    refreshInstalled() { cards.forEach(mark); if (installBtn) setDisabled(installBtn, installed(page().pid)); },
    // A press anywhere in the PC: the legend gives way to the status.
    endLegend() { if (legendOn) { legendOn = false; setStatus(); } },
    // A right-click: selects the card under `target` (and focuses its link), or none; true on a card.
    pick(target) {
      select(cards.findIndex(c => c.node.contains(target)));
      if (sel >= 0) cards[sel].link.focus({ preventScroll: true });
      return sel >= 0;
    },
    onClose(fn) { closeHandler = fn; },
    menus() {
      const i = items();
      return [
        { label: '&File', items: [i.install, i.tab, { label: '&Close', run: () => closeHandler?.() }].map(({ label, disabled, run }) => ({ label, disabled: !!disabled, run })) },
        { label: '&Go', items: [
          { label: '&Back', disabled: idx <= 0, run: back_ }, { label: '&Forward', disabled: idx >= hist.length - 1, run: forward_ },
          { label: '&Home', disabled: false, run: home }, { label: '&Refresh', disabled: !page(), run: refresh },
        ] },
        { label: '&Help', items: [
          { label: '&Help Topics…', disabled: false, run: () => ui.dialog(dialogOf('Help is not available. Please contact your system administrator.')) },
          { label: '&About Info Highway…', disabled: false, run: () => ui.dialog(dialogOf('Info Highway 2.0 · Best viewed at 1080 × 640.')) },
        ] },
      ];
    },
    contextItems() {
      if (!gameOf()) return [];
      const i = items();
      return [i.play, i.install, i.tab].map(({ label, disabled, run }) => ({ label, disabled: !!disabled, run }));
    },
  };
}

// The monitor's picture of the window: white page with the list's thumbnails in a grid, or the game's big thumbnail; a thumbnail
// not loaded yet is grey. `image(name)` looks up a loaded thumbnail, as in every module's draw.
export function draw(g, box, { page, image }) {
  const { x, y, w, h } = box;
  // pc.css's starfield: its ground, then a fixed scatter of 1 px stars (a seeded LCG, so every redraw matches).
  g.fillStyle = '#000018'; g.fillRect(x, y, w, h); g.fillStyle = '#fff';
  let seed = 7; const rnd = n => (seed = seed * 16807 % 2147483647) % n;
  for (let i = Math.floor(w * h / 600); i > 0; i--) g.fillRect(x + rnd(w), y + rnd(h), 1, 1);
  const thumb = (pid, tx, ty, size) => {
    const img = image(thumbName(pid));
    if (img) { g.imageSmoothingEnabled = false; g.drawImage(img, tx, ty, size, size); } else { g.fillStyle = '#808080'; g.fillRect(tx, ty, size, size); }
  };
  if (page?.kind === 'list') {
    const cell = Math.max(8, Math.floor(w / 6)), cols = Math.max(1, Math.floor(w / cell)), rowsFit = Math.max(1, Math.floor(h / cell));
    (page.carts ?? []).slice(0, cols * rowsFit).forEach((c, i) => thumb(c.pid, x + (i % cols) * cell + 1, y + Math.floor(i / cols) * cell + 1, cell - 2));
  } else if (page?.kind === 'game' && page.pid) {
    const size = Math.floor(Math.min(w, h) * 0.7); thumb(page.pid, x + Math.floor((w - size) / 2), y + Math.floor((h - size) / 2), size);
  } else {
    const icon = page?.kind === 'error' ? ICONS.error : ICONS.globe, scale = Math.max(1, Math.floor(Math.min(w, h) * 0.4 / icon.h));
    paint(g, icon, Math.round(x + (w - icon.w * scale) / 2), Math.round(y + (h - icon.h * scale) / 2), scale);
  }
}
