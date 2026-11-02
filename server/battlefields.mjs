// Where each project fights in the fantasy theme, kept here so every device shows the same field and a project keeps its own while others come and go. In a file, so a restart keeps them.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { byHash, pickField, PLACE_KEYS, TIMES } from '../client/fantasy/roster.js';

export const PRUNE_MS = 7 * 86_400_000;
const HOUR = 3_600_000, spot = field => `${field.place}/${field.time}`;

export class Battlefields {
  #file; #fields = new Map(); #shown = new Set(); #written = '';
  constructor(file) {
    this.#file = file;
    try {
      if (!file) return;
      for (const [project, saved] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) if (PLACE_KEYS.includes(saved?.place) && TIMES.includes(saved?.time)) this.#fields.set(project, { place: saved.place, time: saved.time, seen: (saved.hour || 0) * HOUR });
    } catch { this.#fields.clear(); }
  }
  update(sessions, now = Date.now()) {
    const here = [...new Set(sessions.map(session => session.project || 'Unknown'))], held = new Set(), out = [];
    // Those on show keep their field; whoever's back has theirs again if it's still free; then the rest pick, in an order fixed by their names so a first start matches what a page works out alone.
    const order = project => this.#shown.has(project) ? 0 : this.#fields.has(project) ? 1 : 2;
    for (const project of here.sort((a, b) => order(a) - order(b) || byHash(a, b))) {
      const known = this.#fields.get(project), field = known && !held.has(spot(known)) ? known : pickField(project, held);
      held.add(spot(field)); this.#fields.set(project, { place: field.place, time: field.time, seen: now }); out.push([project, { place: field.place, time: field.time }]);
    }
    for (const [project, field] of this.#fields) if (now - field.seen >= PRUNE_MS) this.#fields.delete(project);
    this.#shown = new Set(here);
    this.#save();
    return Object.fromEntries(out);
  }
  #save() {
    if (!this.#file) return;
    // `seen` to the hour: it only has to outlast a week.
    const text = JSON.stringify(Object.fromEntries([...this.#fields].map(([project, { seen, ...field }]) => [project, { ...field, hour: Math.floor(seen / HOUR) }])));
    if (text === this.#written) return;
    this.#written = text;
    // Write then rename, so a crash never leaves half a file. Failing only costs the fields at the next restart.
    try { writeFileSync(`${this.#file}.tmp`, text, { mode: 0o600 }); renameSync(`${this.#file}.tmp`, this.#file); } catch { /* memory still holds */ }
  }
}
