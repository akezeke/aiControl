// Screenshots a session has looked at (server/images.mjs reads them from its transcript and its subagents'): the newest on a
// second monitor at its desk (room.setShot), and all of them in a panel beside the scene. Lists are fetched again a while
// after a session changes, one request at a time; images are fetched once and kept as blobs.
import { SCREEN_W, SCREEN_H } from './screens.js';

const AGAIN_MS = 15_000, KEEP = 120;
const api = path => fetch(`/api/sessions/${path}`, { credentials: 'same-origin', cache: 'no-store' }).then(response => response.ok ? response : Promise.reject(new Error(response.status)));
const ago = at => { const s = Math.max(0, (Date.now() - at) / 1000); return s < 60 ? 'now' : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`; };
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };

export function createScreenshots(container, { room, onClose, onSession }) {
  const sessions = new Map(); // id → { changed: updatedAt, seen: updatedAt fetched for, fetched: ms, images, newest, title }
  const blobs = new Map(); // `${session} ${image}` → Promise<{ blob, url }>, oldest first
  const queue = new Set();
  let busy = false;

  const image = (id, imageId) => {
    const key = `${id} ${imageId}`;
    let entry = blobs.get(key);
    if (entry) { blobs.delete(key); blobs.set(key, entry); return entry; }
    entry = api(`${encodeURIComponent(id)}/images/${encodeURIComponent(imageId)}`).then(response => response.blob()).then(blob => ({ blob, url: URL.createObjectURL(blob) }));
    entry.catch(() => blobs.delete(key));
    blobs.set(key, entry);
    for (const [old, gone] of blobs) { if (blobs.size <= KEEP) break; blobs.delete(old); gone.then(({ url }) => URL.revokeObjectURL(url), () => {}); }
    return entry;
  };
  // Fitted to the monitor's canvas, so a big screenshot isn't kept at full size for a little screen.
  const thumbnail = async blob => {
    const full = await createImageBitmap(blob), k = Math.min(1, SCREEN_W / full.width, SCREEN_H / full.height);
    if (k === 1) return full;
    const small = await createImageBitmap(full, { resizeWidth: Math.max(1, Math.round(full.width * k)), resizeHeight: Math.max(1, Math.round(full.height * k)), resizeQuality: 'high' });
    full.close();
    return small;
  };

  const refresh = async id => {
    const session = sessions.get(id); if (!session) return;
    session.seen = session.changed; session.fetched = Date.now();
    const { images = [] } = await (await api(`${encodeURIComponent(id)}/images`)).json();
    if (sessions.get(id) !== session) return;
    if (shown === id && at === session.images.length - 1) at = -1; // on the newest: stay on the newest
    session.images = images;
    const newest = images.at(-1);
    if (!newest) { session.newest = null; session.shot?.bitmap.close(); session.shot = null; room.setShot(id, null); }
    else if (newest.id !== session.newest) {
      const bitmap = await thumbnail((await image(id, newest.id)).blob);
      if (sessions.get(id) !== session) { bitmap.close(); return; }
      session.shot?.bitmap.close(); session.newest = newest.id; session.shot = { bitmap, count: images.length }; room.setShot(id, session.shot);
    } else if (session.shot.count !== images.length) { session.shot = { ...session.shot, count: images.length }; room.setShot(id, session.shot); }
    if (shown === id) render();
  };
  const pump = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const id of queue) { queue.delete(id); await refresh(id).catch(() => {}); }
    } finally { busy = false; }
  };
  // Lists due again: changed since the last fetch and not fetched for a while.
  const tick = () => {
    const now = Date.now();
    for (const [id, session] of sessions) if (session.seen !== session.changed && now - session.fetched > AGAIN_MS) queue.add(id);
    pump();
  };
  const timer = setInterval(tick, 5000);

  // The panel: the picture, big, over a strip of them all; ←/→ step, Esc closes, the picture opens full size.
  const panel = el('dialog', 'office-shots'); panel.tabIndex = -1; panel.setAttribute('aria-label', 'Screenshots');
  const head = el('div', 'head'), title = el('button', 'title'), meta = el('span', 'meta'), close = el('button', 'close', '✕');
  title.type = close.type = 'button'; title.title = 'Open session'; close.title = 'Close (Esc)'; close.setAttribute('aria-label', 'Close');
  head.append(title, meta, close);
  const stage = el('div', 'stage'), big = el('a', 'big'), picture = el('img'), prev = el('button', 'step prev', '‹'), next = el('button', 'step next', '›');
  big.target = '_blank'; big.rel = 'noopener'; big.title = 'Full size'; picture.alt = ''; big.append(picture);
  prev.type = next.type = 'button'; prev.setAttribute('aria-label', 'Previous'); next.setAttribute('aria-label', 'Next');
  stage.append(big, prev, next);
  const strip = el('div', 'strip');
  panel.append(head, stage, strip); container.append(panel);
  let shown = null, at = -1, drawn = '', pictured = null;

  const step = by => { const images = sessions.get(shown)?.images || []; if (!images.length) return; at = Math.max(0, Math.min(images.length - 1, at + by)); render(); };
  const render = () => {
    const session = sessions.get(shown), images = session?.images || [];
    at = Math.min(at < 0 ? images.length - 1 : at, images.length - 1);
    title.textContent = session?.title || '';
    const current = images[at];
    meta.textContent = current ? [`${at + 1}/${images.length}`, current.agent, current.at && ago(current.at)].filter(Boolean).join(' · ') : images.length ? '' : '—';
    meta.title = current?.agent || '';
    prev.disabled = at <= 0; next.disabled = at >= images.length - 1;
    const signature = `${shown} ${images.map(image => image.id).join()}`;
    if (signature !== drawn) {
      drawn = signature;
      strip.replaceChildren(...images.map((item, i) => {
        const thumb = el('button', 'thumb'), img = el('img'); thumb.type = 'button'; thumb.title = [item.agent, item.at && ago(item.at)].filter(Boolean).join(' · '); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
        thumb.append(img); thumb.onclick = () => { at = i; render(); };
        image(shown, item.id).then(({ url }) => { img.src = url; }, () => thumb.classList.add('failed'));
        return thumb;
      }));
    }
    [...strip.children].forEach((thumb, i) => thumb.classList.toggle('current', i === at));
    const thumb = strip.children[at];
    if (thumb) strip.scrollLeft = Math.min(thumb.offsetLeft, Math.max(strip.scrollLeft, thumb.offsetLeft + thumb.offsetWidth - strip.clientWidth));
    if (current?.id === pictured) return;
    pictured = current?.id; picture.removeAttribute('src'); big.removeAttribute('href');
    if (current) { const want = current.id; image(shown, want).then(({ url }) => { if (pictured === want) { picture.src = url; big.href = url; } }, () => {}); }
  };
  panel.addEventListener('keydown', event => {
    // The office keys and the arrows stay here, as in the pod sign's menu.
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); result.close(); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); at = event.key === 'Home' ? 0 : Infinity; step(0); }
  });
  prev.onclick = () => step(-1); next.onclick = () => step(1);
  close.onclick = () => result.close();
  title.onclick = () => { const id = shown; result.close(); onSession?.(id); };

  const result = {
    get open() { return panel.open; },
    contains: node => panel.contains(node),
    count: id => sessions.get(id)?.images?.length || 0,
    // The sessions that could have any (top-level Claude ones at a desk): lists for new ones now, changed ones in a while.
    sync(list) {
      const ids = new Set();
      for (const { id, updatedAt, title: name, project } of list) {
        ids.add(id);
        const session = sessions.get(id) || sessions.set(id, { seen: null, fetched: 0, images: [], newest: null, shot: null }).get(id);
        session.changed = updatedAt; session.title = name || project || '';
      }
      for (const [id, session] of sessions) if (!ids.has(id)) { sessions.delete(id); queue.delete(id); session.shot?.bitmap.close(); room.setShot(id, null); if (shown === id) result.close(); }
      tick();
    },
    // Newest first, then fetched again if it's been a few seconds.
    show(id) {
      shown = id; at = -1; drawn = ''; pictured = null;
      panel.show(); panel.focus({ preventScroll: true }); render();
      if (Date.now() - (sessions.get(id)?.fetched || 0) > 3000) { queue.add(id); pump(); }
    },
    close() {
      if (!panel.open) return;
      panel.close(); shown = null; strip.replaceChildren(); drawn = ''; pictured = null; picture.removeAttribute('src'); big.removeAttribute('href');
      onClose?.();
    },
    dispose() {
      clearInterval(timer); panel.remove();
      for (const session of sessions.values()) session.shot?.bitmap.close();
      for (const entry of blobs.values()) entry.then(({ url }) => URL.revokeObjectURL(url), () => {});
    },
  };
  return result;
}
