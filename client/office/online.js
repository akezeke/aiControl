// Office online in the page: this browser's bests, read from where each game keeps them, sent to this AI Control (which
// relays them to the hub, server/office-online.mjs) and the board that comes back. It never draws and never runs per
// frame: it syncs when the office opens, when a game is left and when the visitors' clipboard is clicked, and skips the
// request when nothing changed. Whatever shows the board (boards.js, the games) asks `top(id)`, a list kept until the
// board changes, and `watch`es for that change.
import { bests, format, standings } from './leaderboard.js';
import { loadProgress } from './progress.js';
import { dayKey } from './daily.js';

// The games' own localStorage keys (darts.js, pinball.js, snake.js, golf.js), copied so those modules stay as they are; a
// test checks each is still there. Trickshot's comes through progress.js.
export const KEYS = { darts: 'ai-control-darts-best', pinball: 'ai-control-pinball-best', snake: 'ai-control-snake-best', golf: 'ai-control-golf' };
const storage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

// Never throws: blocked or broken storage just has nothing to send.
export function localBests(store = storage(), date = new Date()) {
  try {
    const read = key => store.getItem(key), number = key => Number(read(key)) || 0;
    let golf = null; try { golf = JSON.parse(read(KEYS.golf)); } catch { /* none, or broken */ }
    return bests({ trickshot: loadProgress(store), darts: number(KEYS.darts) || null, pinball: number(KEYS.pinball), snake: number(KEYS.snake), golf }, dayKey(date));
  } catch { return {}; }
}

// Snake's score line (office.js) with the leader added, unless the leader is you.
export const leaderLine = (goal, leader) => leader && !leader.you ? [...goal, { text: `Top ${leader.name} ${leader.text}` }] : goal;

// `api(path, body)`: main.js's. `scores`: what to send (tests pass their own).
export function createOnline({ api, scores = () => localBests() }) {
  let state = null, shown = '', sent = null, tops = new Map();
  const listeners = new Set();
  // Who was in when doesn't count as a change: every sync of your own stamps it, and nothing shows it but the order of names.
  const take = next => {
    const text = JSON.stringify(next, (key, value) => key === 'seen' ? undefined : value);
    if (text === shown) return;
    state = next; shown = text; tops = new Map();
    for (const fn of listeners) fn();
  };
  const online = {
    state: () => state,
    // Up to three, best first, each with its text and whether it's you; the same list until the board changes.
    top(id) {
      if (!tops.has(id)) {
        const me = state?.name?.toLowerCase(), row = state?.board ? standings(state.board).find(r => r.id === id) : null;
        tops.set(id, row ? row.top.map(t => ({ ...t, text: format(id, t.value), you: t.name.toLowerCase() === me })) : []);
      }
      return tops.get(id);
    },
    watch(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async sync(force = false) {
      const now = scores(), text = JSON.stringify(now);
      if (!force && text === sent) return;
      try {
        const next = await api('office/scores', { scores: now });
        if (!next?.offline && !next?.error) sent = text; // a best the hub didn't get goes again next time
        take(next);
      } catch { /* unreachable: keep what's shown */ }
    },
    async signIn(code, name) { take(await api('office/online', { code, name })); sent = null; await online.sync(true); }, // your bests, at once
    async signOut() { take(await api('office/online', { leave: true })); sent = null; },
    dispose() { listeners.clear(); },
  };
  return online;
}
