// What a building shows for its session, and how it comes and goes. Pure.
import { officeStatus } from '../office/status.js';

export const RISE_MS = 1000, PUFF_MS = 500, STEP_MS = 125;

const WINDOWS = { green: 'lit', amber: 'dim', blue: 'dim' };

export function citySignal(session, { connected = true, now = Date.now() } = {}) {
  const status = officeStatus(session, now), { screen } = status, working = screen === 'green' && connected;
  return {
    windows: connected ? WINDOWS[screen] || 'dark' : 'dark', twinkle: working, beacon: screen === 'amber', smoke: screen === 'red',
    dust: screen === 'green' && session.activity === 'compacting', bubble: status.bubble,
  };
}

// A power plant's sign: whose it is, always, and how much of their limit is gone, once anything has said so.
export function plantTag(plant, usage = [], low = 80) {
  const percents = usage.filter(account => account.provider === plant.provider).flatMap(account => (account.windows || []).map(window => window.usedPercent));
  if (!percents.length) return { text: plant.name, title: plant.name, high: false };
  const percent = Math.max(...percents), high = percent >= low;
  return { text: `${plant.name} ${Math.round(percent)}%`, title: `${plant.name} usage${high ? ' near its limit' : ''}`, high };
}

export class Lifecycle {
  #known = new Map(); #started = false;
  // `fired` holds ids the person has just fired and when: those come down at once, without waiting to drop off the list.
  update(plan, fired, now) {
    const here = new Set();
    const see = (id, storeys, leaving) => {
      here.add(id);
      const was = this.#known.get(id), ended = fired.get(id);
      if (!was) { this.#known.set(id, { storeys, born: this.#started ? now : -Infinity, leaving, left: now, ended }); return; }
      // A compaction comes down a storey at a time from wherever it's got to; growth just appears.
      if (storeys < was.storeys) { was.from = this.stage(id, now, false).storeys; was.fell = now; }
      if (leaving && !was.leaving) was.left = now;
      was.storeys = storeys; was.leaving = leaving; was.ended = ended;
    };
    for (const building of plan.buildings) {
      see(building.id, building.storeys, false);
      for (const kid of building.subagents) see(kid.id, kid.storeys, kid.leaving);
    }
    for (const [id, entry] of this.#known) {
      if (here.has(id)) continue;
      entry.ended ??= now;
      if (now - entry.ended > PUFF_MS) this.#known.delete(id);
    }
    this.#started = true;
  }
  stage(id, now, reduced) {
    const entry = this.#known.get(id), quiet = { storeys: entry?.storeys, rising: false, crane: false, puff: false, sinking: false, gone: false };
    if (!entry) return { ...quiet, gone: true };
    if (entry.ended !== undefined && (reduced || now - entry.ended >= PUFF_MS)) return { ...quiet, gone: true };
    if (entry.ended !== undefined) return { ...quiet, puff: true, progress: Math.max(0, (now - entry.ended) / PUFF_MS) };
    if (entry.leaving) { const storeys = Math.max(0, entry.storeys - Math.floor((now - entry.left) / STEP_MS)); return { ...quiet, storeys, sinking: !reduced && storeys > 0, gone: reduced || !storeys }; }
    if (reduced) return quiet;
    const age = now - entry.born;
    if (age < RISE_MS) return { ...quiet, storeys: Math.max(1, Math.floor(entry.storeys * age / RISE_MS)), rising: true, crane: true };
    if (entry.fell !== undefined) return { ...quiet, storeys: Math.max(entry.storeys, entry.from - Math.floor((now - entry.fell) / STEP_MS)) };
    return quiet;
  }
}
