// Claude Code logs each typed prompt to history.jsonl in its config folder, with the session it went to. A transcript can
// bury its last prompt under megabytes of tool output and compactions; this log can't. Read once from the tail, then as
// it grows.
import { open } from 'node:fs/promises';

const START = 8 * 1024 * 1024, TEXT = 600;
// A bare slash command (/usage, /compact) is housekeeping, not what the session was asked to do.
export const housekeeping = text => /^\/[\w:-]+$/.test(text.trim());

export class PromptHistory {
  #files; #last = new Map(); #reading = null;
  constructor(paths) { this.#files = paths.map(path => ({ path, offset: -1, rest: '' })); }
  get(sessionId) { return this.#last.get(sessionId) || ''; }
  refresh() { return this.#reading ??= this.#read().finally(() => { this.#reading = null; }); }
  async #read() {
    for (const file of this.#files) {
      let handle;
      try {
        handle = await open(file.path, 'r');
        const { size } = await handle.stat();
        // Rewritten or cut short: read the tail again. A first read skips the half line it starts in.
        if (size < file.offset || file.offset < 0) { file.offset = Math.max(0, size - START); file.rest = file.offset ? null : ''; }
        if (size === file.offset) continue;
        const buffer = Buffer.alloc(size - file.offset);
        await handle.read(buffer, 0, buffer.length, file.offset);
        file.offset = size;
        const lines = buffer.toString('utf8').split('\n');
        if (file.rest === null) lines.shift(); else lines[0] = file.rest + lines[0];
        file.rest = lines.pop() ?? '';
        for (const line of lines) {
          try { const row = JSON.parse(line); if (typeof row.sessionId === 'string' && typeof row.display === 'string' && row.display.trim() && !housekeeping(row.display)) this.#last.set(row.sessionId, row.display.slice(0, TEXT)); }
          catch { /* not a prompt line */ }
        }
      } catch { /* no history in this folder (yet) */ }
      finally { await handle?.close(); }
    }
  }
}
