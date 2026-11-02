// Sessions that went without saying goodbye: a killed tmux server, a WSL shutdown, a crash. What each top-level session
// was last doing (asked, answered, its status) is kept in a file, so a restart still knows who was there and can offer to
// resume them. Nothing is resumed without a click.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fail } from './requests.mjs';
import { housekeeping } from './prompt-history.mjs';

// Missing this long before it counts as lost: refresh gaps and a restart's first reads land within it.
export const GRACE_MS = 20_000;
// Offered this long after last seen, then forgotten.
export const KEEP_MS = 72 * 3600_000;
// A resume that isn't live by then is offered again.
export const RESUME_MS = 120_000;
// How a Claude session says it ended on purpose (SessionEnd's reason, or /resume into another); `fired` is the dashboard's
// own, `closed` a terminal or tmux window closed under it (claude.mjs).
const CLEAN = new Set(['clear', 'resume', 'logout', 'prompt_input_exit', 'fired', 'closed']);
// `claude --permission-mode` choices; 'default' needs no flag.
const MODES = new Set(['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan']);
const TEXT = 600;

const clip = text => { const flat = String(text || '').replace(/\s+/g, ' ').trim(); return flat.length > TEXT ? `${flat.slice(0, TEXT - 1)}…` : flat; };
const lastSaid = (messages, role) => messages?.findLast?.(message => message.role === role && !message.tool && message.text?.trim() && !(role === 'user' && housekeeping(message.text)))?.text;
// The transcript window holds the last 20 messages: a long turn scrolls the prompt out, and the mode is recorded only
// now and then. `typed(session)` is the prompt history's word on it; else the last ones seen are kept.
function describe(session, now, known, typed) {
  const mode = session.permissionMode ? (MODES.has(session.permissionMode) ? session.permissionMode : '') : known?.mode || '';
  return { id: session.id, provider: session.provider, nativeId: session.nativeId, account: session.account || '', cwd: session.cwd || '', project: session.project || '', title: session.title || '',
    status: session.status || '', detail: clip(session.detail), mode, pid: session.pid || 0,
    prompt: clip(lastSaid(session.messages, 'user') || typed(session)) || known?.prompt || '', reply: clip(lastSaid(session.messages, 'assistant')) || known?.reply || '', activeAt: session.updatedAt || 0, seenAt: now };
}

// The arguments after `claude` or `codex` that pick a lost session up where it stopped, in the mode it had.
export function resumeArgs(entry) {
  if (!/^[\w-]{1,100}$/.test(entry?.nativeId || '')) throw fail('That session can’t be resumed.', 400);
  return entry.provider === 'codex' ? ['resume', entry.nativeId] : ['--resume', entry.nativeId, ...(MODES.has(entry.mode) ? ['--permission-mode', entry.mode] : [])];
}

export class Recovery {
  #file; #entries = new Map(); #written = ''; #shape = ''; #savedAt = 0; #startedAt = null;
  constructor(file) {
    this.#file = file;
    // Whoever was live when the last run ended gets the grace period to show up again before counting as lost.
    try { if (file) for (const entry of JSON.parse(readFileSync(file, 'utf8'))) if (entry?.id && entry.nativeId) this.#entries.set(entry.id, { ...entry, earlier: !entry.lostAt }); } catch { /* starts empty */ }
  }
  // `ended(entry)`: how the session said it ended, if it did. `typed(session)`: its last prompt from the prompt history.
  update(sessions, { ended = () => '', typed = () => '', now = Date.now() } = {}) {
    this.#startedAt ??= now;
    const live = new Set(), pids = new Set();
    for (const session of sessions) {
      if (session.parentId || !session.nativeId || !['claude', 'codex'].includes(session.provider)) continue;
      const known = this.#entries.get(session.id);
      // Codex keeps its threads listed, offline, while its app server is away: they're kept as they were last seen live.
      if (session.status === 'offline') { if (known) known.offline = true; continue; }
      live.add(session.id); if (session.pid) pids.add(`${session.provider}:${session.pid}`);
      this.#entries.set(session.id, describe(session, now, known, typed));
    }
    for (const [id, entry] of this.#entries) {
      if (live.has(id)) continue;
      // Nothing said, nothing to lose: Claude doesn't even keep a transcript to resume until the first prompt.
      if (now - entry.seenAt > KEEP_MS || !(entry.prompt || entry.reply)) { this.#entries.delete(id); continue; }
      if (entry.lostAt) continue;
      // Ended on purpose, or /cleared into a new session in the same process (not after a restart: pids come round again).
      if (CLEAN.has(ended(entry)) || (!entry.earlier && entry.pid && pids.has(`${entry.provider}:${entry.pid}`))) { this.#entries.delete(id); continue; }
      // Codex doesn't say why a thread went. One that closes while its app server stays up was closed in its terminal.
      if (entry.provider === 'codex' && !entry.offline && !entry.earlier) { this.#entries.delete(id); continue; }
      if (now - Math.max(entry.seenAt, this.#startedAt) >= GRACE_MS) entry.lostAt = now;
    }
    this.#save(now);
  }
  lost(now = Date.now()) {
    return [...this.#entries.values()].filter(entry => entry.lostAt).sort((a, b) => b.seenAt - a.seenAt || a.title.localeCompare(b.title))
      .map(({ pid, earlier, offline, resumedAt, ...entry }) => ({ ...entry, resuming: !!resumedAt && now - resumedAt < RESUME_MS }));
  }
  // A lost session not already on its way back.
  get(id, now = Date.now()) { const entry = this.#entries.get(id); return entry?.lostAt && !(entry.resumedAt && now - entry.resumedAt < RESUME_MS) ? entry : null; }
  resumed(id, now = Date.now()) { const entry = this.#entries.get(id); if (entry) { entry.resumedAt = now; this.#save(now, true); } }
  dismiss(ids, now = Date.now()) { for (const id of ids) if (this.#entries.get(id)?.lostAt) this.#entries.delete(id); this.#save(now, true); }
  // Only seenAt moves every tick; that alone is written once a minute.
  #save(now, force = false) {
    if (!this.#file) return;
    const entries = [...this.#entries.values()].map(({ earlier, offline, ...entry }) => entry);
    const text = JSON.stringify(entries), shape = JSON.stringify(entries.map(({ seenAt, ...entry }) => entry));
    if (text === this.#written || (!force && shape === this.#shape && now - this.#savedAt < 60_000)) return;
    this.#written = text; this.#shape = shape; this.#savedAt = now;
    // Write then rename, so a crash never leaves half a file.
    try { writeFileSync(`${this.#file}.tmp`, text, { mode: 0o600 }); renameSync(`${this.#file}.tmp`, this.#file); } catch { /* memory still holds */ }
  }
}
