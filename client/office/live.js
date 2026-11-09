// The page's live link to its own AI Control (/api/office/live, which relays to the hub's room): the roster and floor that
// come down, and where you are and what you do that goes up. It connects only while the page is visible and you're in a
// meeting, closes when hidden, and reconnects with a backoff (1 s up to 30 s). Everything outside is passed in, so node can fake it.
import { checkDown } from './meeting.js';
const BACKOFF = [1000, 30000], EVERY = 100, MOVE = 0.02, TURN = 0.02;

// What the colour/fruit pickers show: your own look in the roster and everyone else's colours as taken.
export function pickerState(roster, me) {
  const mine = roster.find(p => p.id === me), taken = new Set(roster.filter(p => p.id !== me).map(p => p.colour));
  return { fruit: mine?.fruit ?? null, colour: mine?.colour ?? null, taken };
}

// The URL is built only here, so tests never need a location.
const defaultSocket = () => new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/office/live`);

export function createLive({
  socket = defaultSocket, visible = () => !document.hidden, joined = () => false, now = () => performance.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = t => clearTimeout(t),
  onHidden = fn => { document.addEventListener('visibilitychange', fn); return () => document.removeEventListener('visibilitychange', fn); },
} = {}) {
  let pending = null, flush = null, ws = null, retry = null, wait = BACKOFF[0], at = null, roster = [], floor = null, id = null, last = null, lastAt = -Infinity, disposed = false;
  const listeners = new Map();
  const emit = (type, data) => { for (const fn of listeners.get(type) ?? []) fn(data); };
  const open = () => ws?.readyState === 1;
  const send = msg => { if (open()) ws.send(JSON.stringify(msg)); };
  const wanted = () => !disposed && visible() && joined();

  function connect() {
    if (ws || !wanted()) return;
    const s = ws = socket();
    s.onopen = () => { wait = BACKOFF[0]; if (at) send({ type: 'where', at }); };
    s.onmessage = event => {
      let m; try { m = checkDown(JSON.parse(event.data)); } catch { return; }
      if (!m) return; // checked at every hop: only what meeting.js lets through
      if (m.type === 'welcome') id = m.id;
      else if (m.type === 'roster' && Array.isArray(m.players)) roster = m.players;
      else if (m.type === 'floor') floor = m.floor ?? null;
      emit(m.type, m);
    };
    s.onclose = () => {
      if (ws !== s) return;
      ws = null; last = null; clear();
      if (wanted()) { retry = setTimer(() => { retry = null; connect(); }, wait); wait = Math.min(wait * 2, BACKOFF[1]); }
    };
    s.onerror = () => {};
  }
  function clear() { // what the link said is gone with it
    const had = roster.length || floor;
    roster = []; floor = null; id = null;
    if (had) { emit('roster', { type: 'roster', players: [] }); emit('floor', { type: 'floor', floor: null }); }
  }
  function go(sample, t) {
    pending = null; last = { x: sample.x, y: sample.y, z: sample.z, yaw: sample.yaw, pose: sample.pose }; lastAt = t;
    send({ type: 'pos', ...last });
  }
  function drop() { pending = null; if (flush) { clearTimer(flush); flush = null; } if (retry) { clearTimer(retry); retry = null; } const s = ws; if (s) s.close(); }
  // Connect or close to match: visible and in a meeting. Call when either changes.
  function refresh() { if (wanted()) { if (!ws && !retry) { wait = BACKOFF[0]; connect(); } } else drop(); }
  const stop = onHidden(refresh);

  return {
    roster: () => roster, floor: () => floor, id: () => id,
    on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type).delete(fn); },
    send,
    where(to) { at = to; send({ type: 'where', at }); },
    // `sample`: { x, y, z, yaw, pose }. Sent at most 10 Hz and only past 2 cm or 0.02 rad; a new pose waits for the window.
    // A pose change inside the 100 ms window waits for it: the latest sample goes when the window opens.
    presence(sample) {
      if (!open()) return;
      const t = now(), p = last, poseChanged = !p || sample.pose !== p.pose;
      if (!poseChanged) {
        let dyaw = Math.abs(sample.yaw - p.yaw) % (2 * Math.PI); if (dyaw > Math.PI) dyaw = 2 * Math.PI - dyaw;
        if (Math.hypot(sample.x - p.x, sample.y - p.y, sample.z - p.z) <= MOVE && dyaw <= TURN) return;
      }
      if (t - lastAt >= EVERY) { go(sample, t); return; }
      if (!poseChanged) return;
      pending = sample;
      flush ??= setTimer(() => { flush = null; const s = pending; pending = null; if (s && open()) go(s, now()); }, lastAt + EVERY - t);
    },
    refresh,
    dispose() { disposed = true; stop?.(); drop(); listeners.clear(); },
  };
}
