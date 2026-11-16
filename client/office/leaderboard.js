// Office online's scores: which games count, how a player's local bests add up to one number each, and which of two is
// better. Pure, and shared: the hub (server/hub.mjs) checks and merges with it, the Office (online.js) sums and shows with it.
import { HOLE_COUNT } from './golf-course.js';
import { MONDAY } from './levels.js';
import { dayKey, num } from './daily.js';

// In board order. `lower`: fewer is better. Outside [min, max] a score is dropped as impossible. `daily`: today's only, kept as
// { day, score } (yesterday's still taken, for the boards' clocks; a newer day replaces an older).
export const GAMES = [
  { id: 'trickshotToday', label: 'Trickshot today', daily: true, min: 0, max: 1e7 },
  { id: 'trickshot', label: 'Trickshot levels', min: 0, max: 1e8 },
  { id: 'darts', label: 'Darts', lower: true, min: 1, max: 999 },
  { id: 'pinball', label: 'Pinball', min: 0, max: 1e8 },
  { id: 'golf', label: 'Golf', lower: true, min: HOLE_COUNT, max: 1000 },
  { id: 'golfEndless', label: 'Golf endless', min: 0, max: 1e4 },
  { id: 'snake', label: 'Snake', min: 0, max: 1e5 },
  { id: 'planesEndless', label: 'Planes endless', min: 0, max: 1e4 },
  { id: 'rcToday', label: 'RC today', lower: true, daily: true, min: 1, max: 600 }, // the best lap (s) of today's circuit
  { id: 'rcCollectToday', label: 'RC collect today', lower: true, daily: true, min: 1, max: 3600 }, // all of today's paperclips (s)
];
const BY_ID = new Map(GAMES.map(g => [g.id, g]));
const UNITS = { darts: ' darts', golf: ' strokes', golfEndless: ' holes', planesEndless: ' rings', rcToday: ' s', rcCollectToday: ' s' }, TENTHS = new Set(['rcToday', 'rcCollectToday']);
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const inRange = (game, v) => typeof v === 'number' && Number.isFinite(v) && v >= game.min && v <= game.max;
const better = (game, a, b) => game.lower ? Math.min(a, b) : Math.max(a, b);
const dayBefore = day => dayKey(new Date(Date.parse(`${day}T00:00:00Z`) - 86400000));
const value = (id, v) => BY_ID.get(id).daily ? v.score : v;

// A name as typed, trimmed: 1–16 letters, digits, spaces and . _ ' - , starting with a letter or digit.
export const cleanName = name => {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return /^[\p{L}\p{N}][\p{L}\p{N} ._'-]{0,15}$/u.test(trimmed) ? trimmed : null;
};

// One number per game from what the games keep in this browser; a game with nothing to show is left out. Planes only
// endless: a day's course is laid round each office as it stands, so its times aren't for the same rings. RC today: the best
// lap of any circuit raced today (rc.js keeps { day, lap, finish } per circuit); each office lays its own, so it's rough. RC
// collect today likewise: the best time to all of a day's paperclips (rc.js keeps { day, time } per day's set).
export function bests({ trickshot, darts, pinball, snake, golf, planes, rc, collect }, day) {
  const out = {}, put = (id, v) => { if (v > 0) out[id] = v; };
  const today = trickshot?.daily?.[day];
  if (Array.isArray(today)) { const score = today.reduce((sum, v) => sum + (v || 0), 0); if (score > 0) out.trickshotToday = { day, score }; }
  put('trickshot', MONDAY.reduce((sum, { id }) => sum + (trickshot?.best?.[id] || 0), 0));
  put('darts', darts); put('pinball', pinball);
  const holes = Array.from({ length: HOLE_COUNT }, (_, i) => golf?.best?.[i + 1]);
  if (holes.every(v => v > 0)) put('golf', holes.reduce((a, b) => a + b, 0));
  put('golfEndless', golf?.endlessBest); put('snake', snake); put('planesEndless', planes);
  const todays = (store, field) => object(store) ? Object.values(store).filter(v => object(v) && v.day === day && v[field] > 0).map(v => v[field]) : [];
  const laps = todays(rc, 'lap'), runs = todays(collect, 'time');
  if (laps.length) out.rcToday = { day, score: Math.min(...laps) };
  if (runs.length) out.rcCollectToday = { day, score: Math.min(...runs) };
  return out;
}

// Only known games with possible scores; a daily game's only from `day` or the day before it.
export function clean(scores, day) {
  const out = {};
  if (!object(scores)) return out;
  for (const [id, v] of Object.entries(scores)) {
    const game = BY_ID.get(id);
    if (!game) continue;
    if (game.daily) { if (object(v) && (v.day === day || v.day === dayBefore(day)) && inRange(game, v.score)) out[id] = { day: v.day, score: v.score }; }
    else if (inRange(game, v)) out[id] = v;
  }
  return out;
}

// The better of each, both already clean. A daily game's newer day replaces an older one, whatever its score.
export function merge(stored, incoming) {
  const out = { ...stored };
  for (const [id, v] of Object.entries(incoming)) {
    const had = out[id], game = BY_ID.get(id);
    if (had === undefined) out[id] = v;
    else if (game.daily) { if (v.day > had.day) out[id] = v; else if (v.day === had.day) out[id] = { day: v.day, score: better(game, had.score, v.score) }; }
    else out[id] = better(game, had, v);
  }
  return out;
}

// Each game's best three, best first, for games anyone has played; a daily game's only on the board's own day.
export function standings({ day, players }) {
  return GAMES.flatMap(game => {
    const top = players.flatMap(({ name, scores }) => {
      const v = scores?.[game.id];
      if (v === undefined || (game.daily && v.day !== day)) return [];
      return [{ name, value: value(game.id, v) }];
    }).sort((a, b) => game.lower ? a.value - b.value : b.value - a.value).slice(0, 3);
    return top.length ? [{ id: game.id, label: game.label, top }] : [];
  });
}

export const format = (id, value) => (TENTHS.has(id) ? value.toFixed(1) : num(value)) + (UNITS[id] || '');
