// What the ship is doing, and who sits where. Pure.
import { VACANT_MS } from '../office/layout.js';
import { compareSessions } from '../session-order.js';
import { usageWindowView } from '../usage-presentation.js';

const STATIONS = 10, NEAR = 80, FULL = 100;
const isWaiting = session => session.status === 'question' || session.status === 'permission';
const DISPLACEABLE = new Set(['idle', 'offline', 'error']);

function limitsOf(usage, now) {
  const limits = [];
  for (const account of usage || []) for (const window of account.windows || []) {
    if (!Number.isFinite(window.usedPercent)) continue;
    // An expired window is waiting for a refresh, so its old figure says nothing about now.
    const live = !usageWindowView(window, now).expired;
    limits.push({ provider: account.provider, label: account.label || account.name, window: window.label, usedPercent: window.usedPercent, resetsAt: window.resetsAt, near: live && window.usedPercent >= NEAR, full: live && window.usedPercent >= FULL });
  }
  return limits;
}

// Everyone on board, those waiting first. Helpers only show when they're the ones asking.
export const roster = sessions => sessions.filter(session => !session.parentId || isWaiting(session)).sort(compareSessions);

export function shipState(snapshot, now) {
  const sessions = snapshot?.sessions || [], limits = limitsOf(snapshot?.usage, now);
  const waiting = sessions.filter(isWaiting).sort(compareSessions), working = sessions.filter(session => session.status === 'working' && !session.parentId).length;
  const limit = limits.some(item => item.full);
  return {
    mode: limit ? 'limit' : waiting.length ? 'hail' : working ? 'warp' : 'orbit',
    warp: limit ? 0 : working, waiting: waiting.length, next: waiting[0] || null, roster: roster(sessions), limits,
  };
}

// A session keeps its station while it exists, so stations can be learned by position.
export function assignStations(sessions, previous, now) {
  const main = sessions.filter(session => !session.parentId), byId = new Map(main.map(session => [session.id, session]));
  const stations = Array.from({ length: STATIONS }, (_, i) => {
    const seat = previous?.[i];
    if (!seat) return null;
    if (byId.has(seat.id)) return { id: seat.id, goneAt: null };
    const goneAt = seat.goneAt ?? now;
    return now - goneAt >= VACANT_MS ? null : { id: seat.id, goneAt };
  });
  const seated = new Set(stations.filter(seat => seat && seat.goneAt == null).map(seat => seat.id));
  const unseated = main.filter(session => !seated.has(session.id));
  const take = (index, session) => { stations[index] = { id: session.id, goneAt: null }; seated.add(session.id); };
  const displaceable = () => {
    let best = -1, oldest = Infinity;
    stations.forEach((seat, i) => { const session = seat && byId.get(seat.id); if (session && DISPLACEABLE.has(session.status) && (session.updatedAt ?? 0) < oldest) { best = i; oldest = session.updatedAt ?? 0; } });
    return best;
  };
  for (const session of unseated.filter(isWaiting)) {
    let index = stations.indexOf(null);
    if (index < 0) index = stations.findIndex(seat => seat?.goneAt != null);
    if (index < 0) { index = displaceable(); if (index >= 0) seated.delete(stations[index].id); }
    if (index >= 0) take(index, session);
  }
  for (const session of unseated.filter(session => !isWaiting(session))) {
    const index = stations.indexOf(null);
    if (index >= 0) take(index, session);
  }
  return { stations, overflow: main.filter(session => !seated.has(session.id)).length };
}

// The three signals a station can show: an error or a closed client isn't asking for anything.
export const signalOf = session => isWaiting(session) ? 'need' : session.status === 'working' ? 'working' : 'idle';

// Per station. With no signal nothing here is known, so nothing is claimed.
export function stationSignals(seats, sessions, offline) {
  const byId = new Map(sessions.map(session => [session.id, session]));
  return seats.map(seat => { const session = !offline && seat && seat.goneAt == null && byId.get(seat.id); return session ? signalOf(session) : null; });
}

// What the signs say, and the ship with no signal: it drops out of warp rather than leave stale data looking live.
export function displayState(state, error) {
  if (error) return { ...state, mode: 'orbit', warp: 0, offline: true, left: 'NO SIGNAL', right: 'NO SIGNAL', rightName: '' };
  return {
    ...state, offline: false,
    left: state.mode === 'limit' ? 'ENGINE OFFLINE' : state.warp > 0 ? `WARP ${state.warp}` : 'ORBIT',
    right: state.waiting > 0 ? `${state.waiting} WAITING` : '',
    rightName: state.next?.title || state.next?.project || '',
  };
}
