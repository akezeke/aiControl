// Who sits where in the office is worked out here, so every device shows the same seats: they depend on who came when, which a
// page can't tell by itself. In a file, so a restart keeps them.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { layoutOffice } from '../client/office/layout.js';

// Nobody's polled for this long, so nobody's watching: the floor can close up without anyone seeing a desk jump.
export const IDLE_MS = 10 * 60_000;
// How long a spawn's asked-for slot waits for its agent to show up. In memory only: a restart forgets a spawn it never saw land.
export const RESERVE_MS = 120_000;
const compact = layout => ({ desks: [...layout.desks.values()].map(desk => [desk.sessionId, desk.podKey, desk.slot]), pods: layout.pods.map(pod => [pod.key, pod.col, pod.row, pod.name]) });
const earlier = ({ desks, pods }, vacantSince) => ({ saved: true, desks: new Map(desks.map(([id, podKey, slot]) => [id, { podKey, slot, vacantSince }])), pods: pods.map(([key, col, row, name]) => ({ key, col, row, name })), room: { width: 0, depth: 0 } });

export class OfficeSeats {
  #file; #layout; #seen = 0; #written = ''; #reserved = [];
  constructor(file) {
    this.#file = file;
    // Anyone missing from a restart's first list gets the usual time to walk out: the adapters may not have found them yet.
    try { if (file) { this.#written = readFileSync(file, 'utf8'); this.#layout = earlier(JSON.parse(this.#written)); } } catch { this.#layout = undefined; }
  }
  reserve(cwd, slot, now = Date.now()) { if (Number.isInteger(slot) && slot >= 0 && slot <= 63) this.#reserved.push({ cwd, slot, at: now }); }
  release(cwd, slot) { const i = this.#reserved.findIndex(r => r.cwd === cwd && r.slot === slot); if (i >= 0) this.#reserved.splice(i, 1); }
  // Gone by the time anyone looks again, they don't walk out for nobody; the -Infinity drops them at once.
  // `watched: false` (the meeting floor's tick, office-online.mjs) is the same layout without anyone looking: it neither
  // closes up the floor nor counts as a look, so the next real look still does.
  update(sessions, now = Date.now(), { watched = true } = {}) {
    const idle = watched && this.#seen && now - this.#seen >= IDLE_MS;
    this.#reserved = this.#reserved.filter(r => now - r.at < RESERVE_MS);
    const reserved = new Map();
    for (const { cwd, slot } of this.#reserved) reserved.set(cwd, [...reserved.get(cwd) || [], slot]);
    this.#layout = layoutOffice(sessions, idle ? earlier(compact(this.#layout), -Infinity) : this.#layout, now, reserved); if (watched) this.#seen = now;
    // Taken, by whoever: never used twice.
    const desks = [...this.#layout.desks.values()];
    this.#reserved = this.#reserved.filter(r => !desks.some(desk => desk.podKey === r.cwd && desk.slot === r.slot));
    this.#save();
    return { ...this.#layout, desks: [...this.#layout.desks.values()] };
  }
  #save() {
    if (!this.#file) return;
    const text = JSON.stringify(compact(this.#layout));
    if (text === this.#written) return;
    this.#written = text;
    // Write then rename, so a crash never leaves half a file. Failing only costs the seats at the next restart.
    try { writeFileSync(`${this.#file}.tmp`, text, { mode: 0o600 }); renameSync(`${this.#file}.tmp`, this.#file); } catch { /* the layout in memory still holds */ }
  }
}
