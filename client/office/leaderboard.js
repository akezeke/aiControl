// Office online's scores: which games count, how a player's local bests add up to one number each, and which of two is
// better. Pure, and shared: the hub (server/hub.mjs) checks and merges with it, the Office (online.js) sums and shows with it.
import { HOLE_COUNT } from './golf-course.js';
import { MONDAY } from './levels.js';
import { dayKey, num } from './daily.js';

// In board order. `lower`: fewer is better. Outside [min, max] a score is dropped as impossible.
export const GAMES = [
  { id: 'trickshotToday', label: 'Trickshot today', min: 0, max: 1e7 },
  { id: 'trickshot', label: 'Trickshot levels', min: 0, max: 1e8 },
  { id: 'darts', label: 'Darts', lower: true, min: 1, max: 999 },
  { id: 'pinball', label: 'Pinball', min: 0, max: 1e8 },
  { id: 'golf', label: 'Golf', lower: true, min: HOLE_COUNT, max: 1000 },
  { id: 'golfEndless', label: 'Golf endless', min: 0, max: 1e4 },
  { id: 'snake', label: 'Snake', min: 0, max: 1e5 },
];
const BY_ID = new Map(GAMES.map(g => [g.id, g]));
const UNITS = { darts: ' darts', golf: ' strokes', golfEndless: ' holes' };
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const inRange = (game, v) => typeof v === 'number' && Number.isFinite(v) && v >= game.min && v <= game.max;
const better = (game, a, b) => game.lower ? Math.min(a, b) : Math.max(a, b);
const dayBefore = day => dayKey(new Date(Date.parse(`${day}T00:00:00Z`) - 86400000));
const value = (id, v) => id === 'trickshotToday' ? v.score : v;

// A name as typed, trimmed: 1–16 letters, digits, spaces and . _ ' - , starting with a letter or digit.
export const cleanName = name => {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return /^[\p{L}\p{N}][\p{L}\p{N} ._'-]{0,15}$/u.test(trimmed) ? trimmed : null;
};

// One number per game from what the games keep in this browser; a game with nothing to show is left out.
export function bests({ trickshot, darts, pinball, snake, golf }, day) {
  const out = {}, put = (id, v) => { if (v > 0) out[id] = v; };
  const today = trickshot?.daily?.[day];
  if (Array.isArray(today)) { const score = today.reduce((sum, v) => sum + (v || 0), 0); if (score > 0) out.trickshotToday = { day, score }; }
  put('trickshot', MONDAY.reduce((sum, { id }) => sum + (trickshot?.best?.[id] || 0), 0));
  put('darts', darts); put('pinball', pinball);
  const holes = Array.from({ length: HOLE_COUNT }, (_, i) => golf?.best?.[i + 1]);
  if (holes.every(v => v > 0)) put('golf', holes.reduce((a, b) => a + b, 0));
  put('golfEndless', golf?.endlessBest); put('snake', snake);
  return out;
}

// Only known games with possible scores; a day's Trickshot only from `day` or the day before it.
export function clean(scores, day) {
  const out = {};
  if (!object(scores)) return out;
  for (const [id, v] of Object.entries(scores)) {
    const game = BY_ID.get(id);
    if (!game) continue;
    if (id === 'trickshotToday') { if (object(v) && (v.day === day || v.day === dayBefore(day)) && inRange(game, v.score)) out[id] = { day: v.day, score: v.score }; }
    else if (inRange(game, v)) out[id] = v;
  }
  return out;
}

// The better of each, both already clean. A newer day's Trickshot replaces an older one, whatever its score.
export function merge(stored, incoming) {
  const out = { ...stored };
  for (const [id, v] of Object.entries(incoming)) {
    const had = out[id], game = BY_ID.get(id);
    if (had === undefined) out[id] = v;
    else if (id === 'trickshotToday') { if (v.day > had.day) out[id] = v; else if (v.day === had.day) out[id] = { day: v.day, score: Math.max(had.score, v.score) }; }
    else out[id] = better(game, had, v);
  }
  return out;
}

// Each game's best three, best first, for games anyone has played; a day's Trickshot only on the board's own day.
export function standings({ day, players }) {
  return GAMES.flatMap(game => {
    const top = players.flatMap(({ name, scores }) => {
      const v = scores?.[game.id];
      if (v === undefined || (game.id === 'trickshotToday' && v.day !== day)) return [];
      return [{ name, value: value(game.id, v) }];
    }).sort((a, b) => game.lower ? a.value - b.value : b.value - a.value).slice(0, 3);
    return top.length ? [{ id: game.id, label: game.label, top }] : [];
  });
}

export const format = (id, value) => num(value) + (UNITS[id] || '');
