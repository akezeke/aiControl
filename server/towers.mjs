// How tall each session's building is and what it looks like, kept here so every device shows the same city. In a file, so a restart keeps them.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { tower } from '../client/city/identity.js';

export const PRUNE_MS = 7 * 86_400_000, SHOWN_MS = 120_000;
const PER_STOREY = 40_000, COMPACTION = 2 * PER_STOREY, HOUR = 3_600_000;
const CAP = { top: 320_000, sub: 80_000 }, BASE = { top: 4, sub: 2 };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class CityTowers {
  #file; #entries = new Map(); #written = '';
  constructor(file) {
    this.#file = file;
    try {
      if (!file) return;
      const text = readFileSync(file, 'utf8');
      for (const [id, saved] of Object.entries(JSON.parse(text))) if (Number.isFinite(saved?.tokens)) this.#entries.set(id, { ...saved, seen: (saved.hour || 0) * HOUR });
      this.#written = text;
    } catch { this.#entries.clear(); }
  }
  update(sessions, now = Date.now()) {
    const here = new Set(sessions.map(session => session.id));
    for (const session of sessions) if (!this.#entries.has(session.id)) this.#entries.set(session.id, { tokens: 0, last: null, compacting: false, settling: false, sub: !!session.parentId });
    const taken = new Set(sessions.map(session => this.#entries.get(session.id).look).filter(Boolean));
    for (const session of sessions) {
      const entry = this.#entries.get(session.id);
      entry.seen = now;
      if (!session.parentId && !entry.look) entry.look = tower(session.id, taken).name;
      this.#measure(session, entry);
    }
    const out = [];
    for (const [id, entry] of this.#entries) {
      if (now - entry.seen >= PRUNE_MS) { this.#entries.delete(id); continue; }
      if (!here.has(id) && now - entry.seen >= SHOWN_MS) continue;
      const kind = entry.sub ? 'sub' : 'top';
      out.push([id, { storeys: clamp(BASE[kind] + Math.floor(entry.tokens / PER_STOREY), BASE[kind], BASE[kind] + CAP[kind] / PER_STOREY), ...(entry.look && { look: entry.look }) }]);
    }
    this.#save();
    return Object.fromEntries(out);
  }
  // A poll with no usable number says nothing at all, so a session briefly losing its context costs it no height.
  #measure(session, entry) {
    const used = session.context?.used;
    if (typeof used !== 'number' || !(used > 0)) return;
    const cap = CAP[entry.sub ? 'sub' : 'top'], compacting = session.status === 'working' && session.activity === 'compacting';
    if (entry.last === null) { entry.tokens = Math.min(used, cap); entry.last = used; }
    if (compacting && !entry.compacting) { entry.tokens = Math.max(0, entry.tokens - COMPACTION); entry.settling = true; }
    // The drop a seen compaction leads to is already paid for; a drop nobody saw coming is a compaction missed between polls.
    if (used < entry.last / 2) { if (entry.settling) entry.settling = false; else entry.tokens = Math.max(0, entry.tokens - COMPACTION); }
    else if (used > entry.last) entry.tokens = Math.min(cap, entry.tokens + used - entry.last);
    entry.last = used; entry.compacting = compacting;
  }
  #save() {
    if (!this.#file) return;
    // `seen` to the hour: it only has to outlast a week, and exact times would rewrite the file on every poll.
    const text = JSON.stringify(Object.fromEntries([...this.#entries].map(([id, { seen, ...entry }]) => [id, { ...entry, hour: Math.floor(seen / HOUR) }])));
    if (text === this.#written) return;
    this.#written = text;
    // Write then rename, so a crash never leaves half a file. Failing only costs the heights at the next restart.
    try { writeFileSync(`${this.#file}.tmp`, text, { mode: 0o600 }); renameSync(`${this.#file}.tmp`, this.#file); } catch { /* memory still holds */ }
  }
}
