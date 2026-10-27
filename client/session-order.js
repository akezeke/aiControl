const storageKey = 'ai-control-session-activity';
const cacheLimit = 500;
const timestamp = value => {
  const number = typeof value === 'string' && value.trim() ? (Number.isFinite(Number(value)) ? Number(value) : Date.parse(value)) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : 0;
};

export function sessionPriority(session) {
  if (session.status === 'question' || session.status === 'permission') return 0;
  if (session.status === 'working') return 1;
  if (session.status === 'idle') return 2;
  return 3;
}

// Within a status, order by when the session entered it, so ongoing activity
// never reshuffles the list; cards move only when their status changes.
const since = session => timestamp(session.statusSince ?? session.lastActivityAt);
export function compareSessions(a, b) {
  return sessionPriority(a) - sessionPriority(b)
    || since(b) - since(a)
    || a.id.localeCompare(b.id);
}

export function compareProjects([aPath, aSessions], [bPath, bSessions]) {
  const priority = sessions => sessions.reduce((best, session) => Math.min(best, sessionPriority(session)), 3);
  const activity = sessions => sessions.reduce((latest, session) => Math.max(latest, since(session)), 0);
  return priority(aSessions) - priority(bSessions) || activity(bSessions) - activity(aSessions) || aPath.localeCompare(bPath);
}

export class SessionActivity {
  entries = new Map();
  constructor({ storage, now = Date.now } = {}) {
    this.now = now;
    try {
      this.storage = storage ?? globalThis.sessionStorage;
      const saved = JSON.parse(this.storage?.getItem(storageKey) || '[]');
      if (Array.isArray(saved)) for (const entry of saved.slice(0, cacheLimit)) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && timestamp(entry[1])) this.entries.set(entry[0], { at: timestamp(entry[1]) });
      }
    } catch { /* Ordering still works when browser storage is unavailable. */ }
  }
  observe(sessions) {
    const now = this.now();
    let changed = false;
    const result = sessions.map(session => {
      const previous = this.entries.get(session.id);
      const reported = Math.max(timestamp(session.updatedAt),
        ...(session.messages || []).map(message => timestamp(message.timestamp)),
        ...(session.requests || []).map(request => timestamp(request.createdAt)));
      // A real state change is activity; repeated polls and reconnects aren't.
      const transition = previous?.status && previous.status !== session.status
        && sessionPriority(previous) < 3 && sessionPriority(session) < 3;
      const at = Math.max(previous?.at || 0, reported, transition ? now : 0);
      const statusSince = previous?.since && !(transition && sessionPriority(previous) !== sessionPriority(session)) ? previous.since : at;
      if (!previous || previous.at !== at) changed = true;
      this.entries.set(session.id, { at, status: session.status, since: statusSince });
      return { ...session, lastActivityAt: at, statusSince };
    });
    if (changed) {
      const recent = [...this.entries].sort((a, b) => b[1].at - a[1].at).slice(0, cacheLimit);
      this.entries = new Map(recent);
      // Keep only IDs/timestamps across refreshes, never messages or answers.
      // Status is deliberately not restored: an unseen completion isn't "now".
      try { this.storage?.setItem(storageKey, JSON.stringify(recent.map(([id, entry]) => [id, entry.at]))); } catch { /* optional cache */ }
    }
    return result;
  }
}
