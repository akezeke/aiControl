// Screenshots a session has looked at (from Claude transcripts or Codex tool results): the newest on a
// second monitor at its desk (room.setShot). Lists are fetched again a while after a session changes, one request at a time.
import { SCREEN_W, SCREEN_H } from './screens.js';

const AGAIN_MS = 15_000;
const api = path => fetch(`/api/sessions/${path}`, { credentials: 'same-origin', cache: 'no-store' }).then(response => response.ok ? response : Promise.reject(new Error(response.status)));

export function createScreenshots({ room, width = SCREEN_W, height = SCREEN_H }) {
  const sessions = new Map(); // id → { changed: updatedAt, seen: updatedAt fetched for, fetched: ms, images, newest, title }
  const queue = new Set();
  let busy = false;

  // Fitted to the monitor's canvas, so a big screenshot isn't kept at full size for a little screen.
  const thumbnail = async blob => {
    const full = await createImageBitmap(blob), k = Math.min(1, width / full.width, height / full.height);
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
    session.images = images;
    const newest = images.at(-1);
    if (!newest) { session.newest = null; session.shot?.bitmap.close(); session.shot = null; room.setShot(id, null); }
    else if (newest.id !== session.newest) {
      const bitmap = await thumbnail(await (await api(`${encodeURIComponent(id)}/images/${encodeURIComponent(newest.id)}`)).blob());
      if (sessions.get(id) !== session) { bitmap.close(); return; }
      session.shot?.bitmap.close(); session.newest = newest.id; session.shot = { bitmap, count: images.length }; room.setShot(id, session.shot);
    } else if (session.shot.count !== images.length) { session.shot = { ...session.shot, count: images.length }; room.setShot(id, session.shot); }
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

  const result = {
    images: id => sessions.get(id)?.images || [],
    count: id => sessions.get(id)?.images?.length || 0,
    // Top-level sessions at a desk: lists for new ones now, changed ones in a while.
    sync(list) {
      const ids = new Set();
      for (const { id, updatedAt, title: name, project } of list) {
        ids.add(id);
        const session = sessions.get(id) || sessions.set(id, { seen: null, fetched: 0, images: [], newest: null, shot: null }).get(id);
        session.changed = updatedAt; session.title = name || project || '';
      }
      for (const [id, session] of sessions) if (!ids.has(id)) { sessions.delete(id); queue.delete(id); session.shot?.bitmap.close(); room.setShot(id, null); }
      tick();
    },
    dispose() {
      clearInterval(timer);
      for (const session of sessions.values()) session.shot?.bitmap.close();
    },
  };
  return result;
}
