import { createHash } from 'node:crypto';
import { open, readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { documentNames } from '../client/document-links.js';
import { readLines } from './images.mjs';

// Markdown files a session wrote or named. They are served by id from what its own history says, so no file path ever
// comes from a request, and read as they are on disk now. A file the session wrote can be anywhere; one it only named
// must be inside the project it was working in, since message text can name anything.
const marker = '.md';
const maxBytes = 1024 * 1024, trackedLimit = 200, documentLimit = 100;
const writers = new Set(['Write', 'Edit', 'MultiEdit']);
// Claude's own memory notes are edited all the time and aren't anything the session is handing you.
const claudeMemory = /\/\.[^/]*\/projects\/[^/]+\/memory\//;
const documentEntry = (path, root, at, written) => path.endsWith(marker) && !claudeMemory.test(path) ? [{ path, root, at, written }] : [];
const named = (text, root, at) => isAbsolute(root) ? documentNames(text).flatMap(name => documentEntry(resolve(root, name), root, at, false)) : [];

// What one assistant row of a Claude transcript wrote or named.
export function lineDocuments(line, sessionId) {
  let row; try { row = JSON.parse(line); } catch { return []; }
  if (row.type !== 'assistant' || (row.sessionId && row.sessionId !== sessionId) || !Array.isArray(row.message?.content)) return [];
  const at = Date.parse(row.timestamp) || null, root = typeof row.cwd === 'string' ? row.cwd : '';
  return row.message.content.flatMap(block => {
    if (block.type === 'text' && typeof block.text === 'string') return named(block.text, root, at);
    const path = block.type === 'tool_use' && writers.has(block.name) && block.input?.file_path;
    return typeof path === 'string' && isAbsolute(path) ? documentEntry(path, root, at, true) : [];
  });
}

// The same from one Codex thread item.
export function itemDocuments(item, root, at) {
  if (item.type === 'agentMessage' || item.type === 'plan') return named(item.text || '', root, at);
  if (item.type !== 'fileChange' || ['failed', 'declined'].includes(item.status)) return [];
  return (item.changes ?? []).flatMap(change => typeof change.path === 'string' ? documentEntry(resolve(root, change.path), root, at, true) : []);
}

// The latest write of a path stands for it; a mention only counts until there is one.
function track(found, entry) {
  const known = found.get(entry.path);
  if (known?.written && !entry.written) return;
  found.delete(entry.path); found.set(entry.path, entry);
  if (found.size > trackedLimit) found.delete(found.keys().next().value);
}

export class TranscriptDocuments {
  cache = new Map();
  // The whole transcript, unlike images: a plan is worth finding even if it was written long ago in a long session.
  constructor({ scanBytes = Infinity } = {}) { this.scanBytes = scanBytes; }

  async list(path, sessionId) {
    const handle = await open(path, 'r');
    try {
      const { size } = await handle.stat(), cached = this.cache.get(path);
      // A copy, so two requests scanning at once can't both track the same lines.
      const entry = cached && cached.end <= size ? { end: cached.end, found: new Map(cached.found) } : { end: 0, found: new Map() };
      entry.end = await readLines(handle, entry.end, size, this.scanBytes, line => {
        if (line.includes(marker)) for (const document of lineDocuments(line.toString('utf8'), sessionId)) track(entry.found, document);
      });
      this.cache.delete(path); this.cache.set(path, entry);
      if (this.cache.size > 1000) this.cache.delete(this.cache.keys().next().value);
      return [...entry.found.values()];
    } finally { await handle.close(); }
  }
}

// Stat before any read: a FIFO named .md would hang a read for good.
async function showable(path) {
  const real = await realpath(path).catch(() => null);
  if (!real?.endsWith(marker)) return null;
  const info = await stat(real);
  return info.isFile() && info.size <= maxBytes ? real : null;
}
// The folders a name may be relative to, innermost first: the one it was working in and, in a repository, those up to its top.
async function projectFolders(root) {
  const folders = [];
  for (let folder = root; ; folder = dirname(folder)) {
    folders.push(folder);
    if (await stat(join(folder, '.git')).catch(() => null)) return folders;
    if (dirname(folder) === folder) return [root];
  }
}
// The file behind an entry, if it may be shown, and the path that found it; a session in a subfolder often names files from the project's top.
async function documentFile({ path, root, written }) {
  try {
    if (written) { const real = await showable(path); return real && { real, path }; }
    const name = relative(root, path), folders = await projectFolders(await realpath(root)), top = folders.at(-1);
    for (const folder of name.startsWith('..') ? [folders[0]] : folders) {
      const found = join(folder, name), real = await showable(found);
      if (real?.startsWith(top + sep)) return { real, path: found, root: top };
    }
  } catch {}
  return null;
}

// Those of `entries` that exist and may be shown, oldest first; a file found under two names is listed once.
export async function readableDocuments(entries) {
  const files = await Promise.all(entries.map(documentFile)), found = new Map();
  entries.forEach((entry, n) => {
    const { real, ...file } = files[n] || {}, known = real && found.get(real);
    if (real && (!known?.written || entry.written)) found.set(real, { id: createHash('sha256').update(real).digest('hex').slice(0, 16), name: basename(entry.path), ...entry, ...file });
  });
  return [...found.values()].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).slice(-documentLimit);
}

export async function readDocument(document) {
  const file = await documentFile(document);
  if (!file) return null;
  try { return { name: document.name, path: document.path, text: await readFile(file.real, 'utf8') }; } catch { return null; }
}
