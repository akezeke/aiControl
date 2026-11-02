// A session's own building away from the map: the list's cards and the panel's header show the tower you know it by.
import { citySignal } from './signals.js';
import { lookOf, tower } from './identity.js';
import { annex, buildTower } from './generator.js';
import { renderSprite, SpriteCache } from './sprite.js';
import { sharedLayout, layoutOffice } from '../office/layout.js';
import { cityPlan } from './plan.js';
import { paintMap, placeContacts } from './minimap.js';
import { timeOfDay } from './ground.js';

export const PORTRAIT_STOREYS = 6;
const ANNEX_STOREYS = 3, BEATS = 4, PHASE_MS = 650;

const lookFor = (id, towers) => towers?.[id]?.look ? lookOf(id, towers[id].look) : tower(id);

const shape = (session, { towers = {}, connected = true, reduced = false, sibling = 0, now = Date.now() } = {}) => {
  const look = lookFor(session.parentId || session.id, towers), signal = citySignal(session, { connected, now }), kid = !!session.parentId;
  const storeys = kid ? ANNEX_STOREYS : Math.min(PORTRAIT_STOREYS, Math.max(4, towers?.[session.id]?.storeys ?? PORTRAIT_STOREYS));
  const beats = signal.twinkle && !reduced ? BEATS : 1;
  return { look, signal, kid, storeys, beats, sibling, key: [look.id, look.name, kid ? `k${sibling}` : 't', storeys, signal.windows, !!signal.asleep, beats].join('|') };
};

// Pure: every frame the same size, its building's foot on the same spot, so stepping through them only moves what moves.
export function portrait(session, options) {
  const { look, signal, kid, storeys, beats, sibling, key } = shape(session, options);
  const sprites = Array.from({ length: beats }, (_, beat) => renderSprite((kid ? annex(look, sibling, signal.windows, storeys, beat) : buildTower(look, signal.windows, storeys, beat)).stack, 0, { asleep: signal.asleep }));
  const left = Math.max(...sprites.map(s => s.originX)), top = Math.max(...sprites.map(s => s.originY));
  const width = left + Math.max(...sprites.map(s => s.width - s.originX)), height = top + Math.max(...sprites.map(s => s.height - s.originY));
  const frames = sprites.map(s => {
    const frame = new Uint8ClampedArray(width * height * 4), dx = left - s.originX, dy = top - s.originY;
    for (let y = 0; y < s.height; y++) frame.set(s.rgba.subarray(y * s.width * 4, (y + 1) * s.width * 4), ((y + dy) * width + dx) * 4);
    return frame;
  });
  return { key, name: look.name, kind: kid ? 'annex' : 'tower', asleep: !!signal.asleep, width, height, frames };
}

// Strips of frames, ready to copy. A render costs a look-up unless a building changed: baking one takes milliseconds, and a poll redoes the whole list.
const baked = new SpriteCache(96);
let listLayout = null, listPlan = null;
function sheet(session, options) {
  const { key } = shape(session, options);
  let found = baked.get(key);
  if (found) return found;
  const made = portrait(session, options), canvas = document.createElement('canvas'); canvas.width = made.width * made.frames.length; canvas.height = made.height;
  const ctx = canvas.getContext('2d');
  made.frames.forEach((frame, i) => ctx.putImageData(new ImageData(frame, made.width, made.height), i * made.width, 0));
  found = { key, canvas, width: made.width, height: made.height, beats: made.frames.length };
  baked.set(key, found);
  return found;
}

// One window on a strip of frames, which CSS steps through so that nothing here runs per frame. All the windows share the clock, so a rebuilt card doesn't restart.
function view({ key, canvas, width, height, beats }) {
  const box = document.createElement('span'); box.className = 'city-portrait'; box.dataset.key = key; box.setAttribute('aria-hidden', 'true');
  box.style.setProperty('--w', `${width}px`); box.style.setProperty('--h', `${height}px`);
  const strip = document.createElement('canvas'); strip.width = canvas.width; strip.height = canvas.height; strip.getContext('2d').drawImage(canvas, 0, 0);
  if (beats > 1) { strip.className = 'beats'; strip.style.animationDelay = `${-Math.round(performance.now() % (BEATS * PHASE_MS))}ms`; }
  box.append(strip);
  return box;
}

// Idempotent, and run after every render: a card rebuilt because its data changed gets its building back in the same frame.
export function dressList(root, snapshot, { error = false, reduced = false, selected = null } = {}) {
  const sessions = snapshot?.sessions || [], byId = new Map(sessions.map(session => [session.id, session])), towers = snapshot?.towers || {}, providers = snapshot?.providers || [];
  const options = session => ({ towers, reduced, connected: !error && providers.find(p => p.provider === session.provider)?.connected !== false, sibling: session.parentId ? Math.max(0, sessions.filter(s => s.parentId === session.parentId).indexOf(session)) % 3 : 0 });
  const put = (holder, session, before = holder.firstChild) => {
    const opts = options(session), old = holder.querySelector(':scope > .city-portrait');
    if (old?.dataset.key === shape(session, opts).key) return;
    const fresh = view(sheet(session, opts));
    if (old) old.replaceWith(fresh); else holder.insertBefore(fresh, before);
  };
  for (const card of root.querySelectorAll('.session-card[data-session-id]')) {
    const session = byId.get(card.dataset.sessionId), mark = card.querySelector('.agent-mark');
    if (!session || !mark) continue;
    put(mark, session);
    mark.title = `${lookFor(session.parentId || session.id, towers).name} · ${session.provider === 'codex' ? 'Codex' : 'Claude Code'}`;
  }
  const header = root.querySelector('.chat-header'), open = selected && byId.get(selected);
  if (header && open) put(header, open);
  const mapped = root.querySelector('.console-screen');
  if (!mapped) return;
  // With the scene up the map is the scene's, turned and lit as it is. Without one the list draws it, so it's the same map.
  if (mapped.hasAttribute('data-live')) { placeContacts(mapped); return; }
  listLayout = snapshot?.office ? sharedLayout(snapshot.office) : layoutOffice(sessions, listLayout);
  listPlan = cityPlan(listLayout, towers, listPlan, providers, sessions, snapshot?.claudeAccounts);
  paintMap(mapped, listPlan, 0, { time: timeOfDay(), asleep: id => { const session = byId.get(id); return !!session && !!citySignal(session, options(session)).asleep; } });
}
