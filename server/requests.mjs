import { randomUUID } from 'node:crypto';

export const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function validateAnswers(questions, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw fail('Answer every question.');
  const output = Object.create(null);
  for (const q of questions) {
    const values = answers[q.id];
    if (!Array.isArray(values) || !values.length || values.length > 32 || values.some(x => typeof x !== 'string' || !x.trim() || x.length > 10_000)) throw fail(`Answer: ${q.question}`);
    if (!q.multiSelect && values.length !== 1) throw fail('Choose one answer.');
    if (q.allowOther === false && values.some(x => !q.options?.some(o => o.label === x))) throw fail('Choose one of the offered answers.');
    output[q.id] = values;
  }
  if (Object.keys(answers).some(id => !questions.some(q => q.id === id))) throw fail('Unknown question.');
  return output;
}

// Requests are single use. Adapters retain their protocol IDs only on the server.
export class RequestStore {
  entries = new Map();
  constructor(audit = async () => {}) { this.audit = audit; }
  add(view, send, sourceKey) {
    const existing = [...this.entries.values()].find(x => x.sourceKey === sourceKey);
    if (existing) return existing.view.id;
    const id = randomUUID();
    this.entries.set(id, { view: { ...view, id, createdAt: Date.now() }, send, sourceKey, sending: false });
    return id;
  }
  removeSource(sourceKey) {
    for (const [id, entry] of this.entries) if (entry.sourceKey === sourceKey) this.entries.delete(id);
  }
  removeSession(sessionId) { for (const [id, entry] of this.entries) if (entry.view.sessionId === sessionId) this.entries.delete(id); }
  list() { return [...this.entries.values()].map(x => ({ ...x.view, sending: x.sending })); }
  async respond(id, body) {
    const entry = this.entries.get(id);
    if (!entry) throw fail('This request was already answered or is no longer available.', 409);
    if (entry.sending) throw fail('A response is already being sent.', 409);
    let answer;
    if (entry.view.kind === 'question') answer = { answers: validateAnswers(entry.view.questions, body.answers) };
    else {
      if (!entry.view.actions?.some(x => x.value === body.decision)) throw fail('Invalid decision.');
      // An optional reason goes back to the agent with a denial (Claude only).
      answer = { decision: body.decision, ...(typeof body.message === 'string' && body.message.trim() ? { message: body.message.trim().slice(0, 2000) } : {}) };
    }
    entry.sending = true;
    try {
      await entry.send(answer);
      this.entries.delete(id);
      await this.audit({ at: new Date().toISOString(), sessionId: entry.view.sessionId, provider: entry.view.provider, requestId: id, kind: entry.view.kind, decision: answer.decision ?? 'answered' });
    } catch (error) {
      // A delivery timeout is ambiguous: never retry an approval against stale state.
      if (error.status !== 400) this.entries.delete(id);
      else entry.sending = false;
      throw error;
    }
  }
}
