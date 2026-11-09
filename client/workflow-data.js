// Workflow decisions are based on transcript evidence, never a poll's timestamp.
export const reviewStamp = session => Math.max(0, ...(session.messages || []).filter(m => m.role === 'assistant' && !m.tool && m.text).map(m => Number(m.timestamp) || 0));
export const needsReview = (session, saved = {}) => !session.parentId && session.status === 'idle' && reviewStamp(session) > (saved.reviewedThrough || 0);
export const lastObservedActivity = session => Math.max(0, ...(session.messages || []).map(m => Number(m.timestamp) || 0)) || session.statusSince || 0;
export const quietSession = (session, minutes = 15, now = Date.now()) => session.status === 'working' && minutes > 0 && lastObservedActivity(session) > 0 && now - lastObservedActivity(session) >= minutes * 60_000;
export const commandMatches = (command, query) => String(query).toLowerCase().trim().split(/\s+/).every(word => `${command.label} ${command.keywords || ''}`.toLowerCase().includes(word));
export function filterFeed(sessions, prefs = {}) {
  return sessions.filter(s => (!prefs.project || s.cwd === prefs.project || s.project === prefs.project) && (!prefs.provider || prefs.provider === 'all' || s.provider === prefs.provider) && (!prefs.session || s.id === prefs.session)).map(s => {
    if (prefs.kind === 'errors') return { ...s, messages: (s.messages || []).filter(m => m.failed || m.error) };
    if (prefs.kind === 'replies') {
      const last = s.status === 'idle' ? (s.messages || []).findLast(m => m.role === 'assistant' && !m.tool) : null;
      return { ...s, messages: last ? [last] : [] };
    }
    return s;
  });
}
export function handoffText(session, messages = [], decisions = [], files = []) {
  const parts = [`Handoff: ${session.title}`, session.cwd && `Project: ${session.cwd}`];
  if (messages.length) parts.push('Selected messages:\n' + messages.map(m => `${m.role || 'Tool'}: ${m.text}`).join('\n\n'));
  if (decisions.length) parts.push('Decisions:\n' + decisions.map(d => `${d.at || ''} · ${d.decision || 'answered'}`).join('\n'));
  if (files.length) parts.push('Files:\n' + files.join('\n'));
  return parts.filter(Boolean).join('\n\n');
}

// Each draft has one serial writer. Remote snapshots never replace unsaved input.
// Revision conflicts leave the local text available to copy or explicitly replace.
export class DraftSync {
  constructor(save) { this.save = save; this.entries = new Map(); }
  get(id) {
    if (!this.entries.has(id)) this.entries.set(id, { text: '', remoteRevision: 0, revision: 0, images: [], dirty: false, saveError: '' });
    return this.entries.get(id);
  }
  adopt(drafts = {}) {
    for (const [id, remote] of Object.entries(drafts)) {
      const draft = this.get(id);
      if (draft.dirty || draft.saving || draft.busy || remote.revision <= draft.remoteRevision) continue;
      if (draft.text !== remote.text) { draft.text = remote.text; draft.revision++; }
      draft.remoteRevision = remote.revision;
    }
  }
  edit(id, text) { const draft = this.get(id); if (draft.text !== text) { draft.text = text; draft.dirty = true; draft.saveError = ''; } return draft; }
  flush(id) {
    const draft = this.get(id);
    if (draft.saving) return draft.saving;
    if (!draft.dirty) return Promise.resolve();
    draft.saving = (async () => {
      while (draft.dirty) {
        const text = draft.text;
        try {
          const saved = await this.save(id, text, draft.remoteRevision);
          draft.remoteRevision = saved.revision;
          draft.dirty = draft.text !== text; draft.saveError = '';
        } catch (error) { draft.saveError = error.message || 'Draft could not be saved'; break; }
      }
    })().finally(() => { draft.saving = null; });
    return draft.saving;
  }
  flushAll() { return Promise.all([...this.entries.keys()].map(id => this.flush(id))); }
}
