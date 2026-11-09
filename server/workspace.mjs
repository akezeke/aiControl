import { constants } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail } from './requests.mjs';

const sections = ['sessions', 'drafts', 'views', 'snippets', 'presets', 'preferences'];
const unsafe = new Set(['__proto__', 'constructor', 'prototype']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keyOK = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !unsafe.has(value) && !/[\u0000-\u001f\u007f]/.test(value);
const string = max => value => typeof value === 'string' && value.length <= max && !value.includes('\0');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const provider = value => ['', 'all', 'codex', 'claude', 'opencode'].includes(value);
const fields = {
  sessions: { alias: string(240), pinned: value => typeof value === 'boolean', reviewedThrough: integer, reviewCompletedAt: integer },
  drafts: { text: string(50_000) },
  views: { name: string(120), project: string(8192), provider, filter: string(80), search: string(1000) },
  snippets: { name: string(120), text: string(50_000) },
  presets: { name: string(120), cwd: string(8192), provider: value => ['codex', 'claude', 'opencode'].includes(value), account: string(240), model: string(240), effort: string(80), prompt: string(50_000) },
};
const empty = () => ({ version: 0, ...Object.fromEntries(sections.map(section => [section, {}])) });

function jsonValue(value, depth = 0) {
  if (depth > 6) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return true;
  if (typeof value === 'string') return string(8192)(value);
  if (Array.isArray(value)) return value.length <= 100 && value.every(item => jsonValue(item, depth + 1));
  return object(value) && Object.keys(value).length <= 100 && Object.entries(value).every(([key, item]) => keyOK(key) && jsonValue(item, depth + 1));
}

function validateValue(section, value, stored = false) {
  if (section === 'preferences') return jsonValue(value) && Buffer.byteLength(JSON.stringify(value)) <= 16_384;
  if (!object(value)) return false;
  return Object.entries(value).every(([key, item]) => key === 'revision' && stored && section === 'drafts' ? integer(item) : Object.hasOwn(fields[section], key) && fields[section][key](item)) &&
    (section !== 'drafts' || Object.hasOwn(value, 'text') && (!stored || integer(value.revision)));
}

// One service instance owns this file. Devices patch a single record and individual fields;
// drafts additionally compare revisions, including empty tombstones left after sending.
export class WorkspaceStore {
  #state = empty(); #queue = Promise.resolve();
  constructor(file, { maxBytes = 4 * 1024 * 1024, maxEntries = 5000 } = {}) { this.file = file; this.maxBytes = maxBytes; this.maxEntries = maxEntries; }
  async load() {
    let handle;
    try {
      handle = await open(this.file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile() || info.size > this.maxBytes) throw fail('Workspace file is too large or is not a regular file.', 413);
      const buffer = Buffer.alloc(info.size), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const stored = JSON.parse(buffer.toString('utf8', 0, bytesRead));
      if (!object(stored) || Object.keys(stored).some(key => key !== 'version' && !sections.includes(key)) || !integer(stored.version ?? 0)) throw fail('Invalid workspace file.', 400);
      const state = empty(); state.version = stored.version ?? 0;
      for (const section of sections) {
        const records = stored[section] ?? {};
        if (!object(records) || Object.keys(records).length > this.maxEntries) throw fail('Invalid workspace records.', 400);
        for (const [key, value] of Object.entries(records)) {
          if (!keyOK(key) || !validateValue(section, value, true)) throw fail('Invalid workspace record.', 400);
          state[section][key] = value;
        }
      }
      this.#state = state;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally { await handle?.close(); }
    return this;
  }
  snapshot() { return structuredClone(this.#state); }
  patch(change) {
    // Clone before waiting: callers must not be able to mutate an already validated patch.
    if (!object(change) || Object.keys(change).some(key => !['section', 'key', 'value', 'baseRevision'].includes(key)) || !sections.includes(change.section) || !keyOK(change.key) || !Object.hasOwn(change, 'value') ||
      change.value !== null && !validateValue(change.section, change.value) || change.section === 'drafts' && !integer(change.baseRevision)) return Promise.reject(fail('Invalid workspace patch.', 400));
    const captured = structuredClone(change);
    const next = this.#queue.then(() => this.#patch(captured));
    this.#queue = next.catch(() => {});
    return next;
  }
  async #patch({ section, key, value, baseRevision }) {
    const state = this.snapshot(), previous = state[section][key];
    if (section === 'drafts') {
      const revision = previous?.revision ?? 0;
      if (revision !== baseRevision) throw fail('Draft changed on another device. Reload it before saving.', 409);
      if (!Number.isSafeInteger(revision + 1)) throw fail('Draft revision limit reached.', 409);
      state.drafts[key] = { text: value?.text ?? '', revision: revision + 1 };
    } else if (value === null) delete state[section][key];
    else state[section][key] = section === 'preferences' ? value : { ...previous, ...value };
    // A delayed review from another device must not requeue already reviewed completions.
    if (section === 'sessions' && value !== null && Object.hasOwn(value, 'reviewedThrough')) state.sessions[key].reviewedThrough = Math.max(previous?.reviewedThrough ?? 0, value.reviewedThrough);
    if (!Number.isSafeInteger(state.version + 1)) throw fail('Workspace version limit reached.', 409);
    state.version++;
    const encoded = JSON.stringify(state);
    if (Object.keys(state[section]).length > this.maxEntries || Buffer.byteLength(encoded) > this.maxBytes) throw fail('Workspace storage limit reached.', 413);
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(encoded, 'utf8');
      await handle.sync();
      await handle.close(); handle = null;
      await rename(temporary, this.file);
      this.#state = state;
    } finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    return this.snapshot();
  }
}
