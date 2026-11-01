import { statSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fail } from './requests.mjs';

// A typed folder as an absolute path (~ expands, trailing slashes go), or null.
export function folderPath(input, home = homedir()) {
  if (typeof input !== 'string') return null;
  const path = input.trim().replace(/^~(?=\/|$)/, home).replace(/(.)\/+$/, '$1');
  return path && isAbsolute(path) ? path : null;
}

// Nothing there, a file on the way (ENOTDIR) or a folder we may not look in all read as absent.
const look = path => { try { return statSync(path); } catch { return null; } };
const isDir = path => !!look(path)?.isDirectory();

// 'folder' if it's there; 'new' if it isn't but its parent is, so it can be made; else 'none'. Only one level is made,
// so a slip earlier in the path (~/scr/app) doesn't quietly build a tree.
export function folderState(input, home) {
  const path = folderPath(input, home);
  if (!path) return 'none';
  if (isDir(path)) return 'folder';
  return !look(path) && isDir(dirname(path)) ? 'new' : 'none';
}

// The folder to start an agent in, made first when `create` asks for it and folderState says it can be.
export function agentFolder(input, { create = false, home } = {}) {
  const path = folderPath(input, home), state = folderState(input, home);
  if (state === 'folder') return path;
  if (state !== 'new' || !create) throw fail('No such folder.', 404);
  try { mkdirSync(path); } catch (e) { if (e.code !== 'EEXIST' || !isDir(path)) throw fail(`Could not create ${input.trim()}.`, e.code === 'EACCES' || e.code === 'EPERM' ? 403 : 400); }
  return path;
}
