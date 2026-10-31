// Trickshot's daily challenges: the UTC date seeds a generator, so everyone gets the same three. Data only, so Node can sweep it.
import { ITEMS, PAIRS } from './levels.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], pad = n => String(n).padStart(2, '0');
export const dayKey = date => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

const fnv1a = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return h >>> 0; };
const mulberry32 = a => () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const shuffled = (rand, list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const shotOf = (item, [start, target]) => ({ item, start, target });

export function randomShot(seed) {
  const rand = mulberry32(fnv1a(`shot:${seed}`)), item = pick(rand, Object.keys(ITEMS));
  return shotOf(item, pick(rand, PAIRS[item]));
}

// Three shots: no target twice, and each item once while the list allows.
export function challenges(key) {
  const rand = mulberry32(fnv1a(`day:${key}`)), items = shuffled(rand, Object.keys(ITEMS)), out = [], targets = new Set();
  for (const item of [...items, ...items]) { // a second round only if targets ran short
    const open = out.length < 3 ? PAIRS[item].filter(p => !targets.has(p[1])) : [];
    if (open.length) { const pair = pick(rand, open); targets.add(pair[1]); out.push(shotOf(item, pair)); }
  }
  return out;
}

export const num = n => String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, ',');
export const bestText = best => best == null ? '-' : best > 0 ? num(best) : 'miss'; // not played; a score; played, and nothing yet
export const copyLine = (key, bests) => { const [, m, d] = key.split('-'); return `Trickshot ${+d} ${MONTHS[m - 1]}: ${[0, 1, 2].map(i => bestText(bests[i])).join(' / ')}`; };
