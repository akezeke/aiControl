// Trickshot's saves: the clipboard, each level's best, and daily bests by date. localStorage is always in try/catch, so a blocked store just means no saves.
import { MONDAY, lineDone } from './levels.js';

const KEY = 'aiControl.trickshot', DAY_MS = 86400000, KEEP_DAYS = 30, LINES = ['away', 'trick', 'score'];
const empty = () => ({ lines: {}, best: {}, daily: {} });
const obj = v => v && typeof v === 'object' && !Array.isArray(v), score = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const valid = p => obj(p) && obj(p.lines) && obj(p.best) && obj(p.daily)
  && Object.values(p.lines).every(l => obj(l) && LINES.every(k => typeof l[k] === 'boolean'))
  && Object.values(p.best).every(score)
  && Object.keys(p.daily).every(goodKey) && Object.values(p.daily).every(d => Array.isArray(d) && d.length === 3 && d.every(v => v === null || score(v)));
const goodScore = v => score(v) ? v : 0, goodKey = k => typeof k === 'string' && /^\d{4}-\d\d-\d\d$/.test(k) && Number.isFinite(dayAt(k)) && new Date(dayAt(k)).toISOString().slice(0, 10) === k;
const defaultStore = () => { try { return localStorage; } catch { return null; } };

export function loadProgress(store = defaultStore()) {
  try {
    const p = JSON.parse(store.getItem(KEY));
    return valid(p) ? { lines: p.lines, best: p.best, daily: p.daily } : empty();
  } catch { return empty(); }
}

export function saveProgress(progress, store = defaultStore()) { try { store.setItem(KEY, JSON.stringify(progress)); } catch { /* no saves */ } }

// Lines only go from false to true; best keeps the highest score.
export function recordLevel(progress, id, result) {
  const entry = MONDAY.find(e => e.id === id); if (!entry) return progress;
  const line = progress.lines[id] ||= { away: false, trick: false, score: false };
  for (const k of LINES) line[k] = line[k] || !!lineDone(k, result, entry);
  progress.best[id] = Math.max(progress.best[id] || 0, goodScore(result.score));
  return progress;
}

const dayAt = key => Date.parse(`${key}T00:00:00Z`);

// Takes the key it was given; never reads the clock. A slot keeps the best so far.
export function recordDaily(progress, key, index, result) {
  if (!goodKey(key) || !Number.isInteger(index) || index < 0 || index > 2) return progress;
  const day = progress.daily[key] ||= [null, null, null];
  day[index] = Math.max(day[index] || 0, goodScore(result.score));
  const now = dayAt(key);
  for (const k of Object.keys(progress.daily)) if (now - dayAt(k) > KEEP_DAYS * DAY_MS) delete progress.daily[k];
  return progress;
}
