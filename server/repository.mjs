import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const outputLimit = 256 * 1024, statusLimit = 2 * 1024 * 1024, fileLimit = 500;
const inside = (root, path) => path === root || path.startsWith(root + sep);
const validPath = path => typeof path === 'string' && path.length > 0 && path.length <= 4096 && !isAbsolute(path) && !path.includes('\0') && !path.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.git');

// Git's repository settings may contain executable helpers. Inspection never invokes
// them or refreshes the index, and inherited Git variables cannot select another repo.
async function git(cwd, args, limit = statusLimit) {
  const filterOptions = [];
  if (['status', 'diff'].includes(args[0])) {
    // Working-tree comparison also invokes clean/process filters, independently
    // of external diff and textconv. Clear every configured executable filter.
    const filters = await git(cwd, ['config', '--null', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|smudge|process|required)$']);
    if (filters.truncated || filters.timedOut || ![0, 1].includes(filters.code)) return { ...filters, code: -1, text: '' };
    for (const key of new Set(filters.text.split('\0').filter(Boolean))) filterOptions.push('-c', `${key}=${key.endsWith('.required') ? 'false' : ''}`);
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1', GIT_PAGER: 'cat', LC_ALL: 'C' });
  return new Promise(resolveResult => {
    const child = spawn('git', ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.pager=cat', '-c', 'diff.external=', ...filterOptions, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let size = 0, stderrSize = 0, truncated = false, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 4000);
    child.stdout.on('data', chunk => {
      const remaining = limit - size;
      if (remaining > 0) { chunks.push(chunk.subarray(0, remaining)); size += Math.min(chunk.length, remaining); }
      if (chunk.length > remaining) { truncated = true; child.kill('SIGKILL'); }
    });
    child.stderr.on('data', chunk => { stderrSize += chunk.length; if (stderrSize > 64 * 1024) child.kill('SIGKILL'); });
    const finish = code => { clearTimeout(timer); resolveResult({ code, text: Buffer.concat(chunks).toString('utf8'), truncated, timedOut }); };
    child.once('error', () => finish(-1));
    child.once('close', code => finish(code));
  });
}

export async function repositoryRoot(cwd) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd) || cwd.includes('\0')) return null;
  const directory = await realpath(cwd).catch(() => null);
  if (!directory || !(await lstat(directory)).isDirectory()) return null;
  const result = await git(directory, ['rev-parse', '--show-toplevel'], 8192);
  if (result.code !== 0 || result.truncated) return null;
  const root = await realpath(result.text.trim()).catch(() => null);
  return root && inside(root, directory) ? root : null;
}

// Check every existing component, including a final symlink. Missing final paths
// are valid for deleted files; a link outside the repository is never followed.
async function containedPath(root, path) {
  if (!validPath(path)) return null;
  let current = root;
  for (const part of path.split('/').filter(part => part && part !== '.')) {
    current = join(current, part);
    let stat;
    try { stat = await lstat(current); } catch (error) { if (error.code === 'ENOENT') continue; return null; }
    if (stat.isSymbolicLink()) {
      current = await realpath(current).catch(() => null);
      if (!current || !inside(root, current)) return null;
    }
  }
  return inside(root, current) ? current : null;
}

function statusFiles(text) {
  const fields = text.split('\0'), files = []; let branch = null;
  for (let index = 0; index < fields.length; index++) {
    const entry = fields[index];
    if (!entry) continue;
    if (entry.startsWith('## ')) {
      const head = entry.slice(3).replace(/^(?:No commits yet on|Initial commit on) /, '').split('...')[0];
      branch = head.startsWith('HEAD ') ? null : head;
      continue;
    }
    const status = entry.slice(0, 2), path = entry.slice(3);
    const originalPath = /[RC]/.test(status) ? fields[++index] : undefined;
    if (!validPath(path)) continue;
    files.push({ path, status: status.trim(), staged: status[0] !== ' ' && status[0] !== '?', unstaged: status[1] !== ' ', added: 0, removed: 0, binary: false, ...(originalPath ? { originalPath } : {}) });
  }
  return { branch, files };
}

function addCounts(files, text) {
  const byPath = new Map(files.map(file => [file.path, file])), fields = text.split('\0');
  for (let index = 0; index < fields.length; index++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(fields[index]);
    if (!match) continue;
    let path = match[3];
    if (!path) { index++; path = fields[++index]; }
    const file = byPath.get(path);
    if (!file) continue;
    file.binary ||= match[1] === '-' || match[2] === '-';
    if (file.binary) { file.added = null; file.removed = null; }
    else { file.added += Number(match[1]); file.removed += Number(match[2]); }
  }
}

async function untrackedCounts(root, file) {
  file.added = null;
  const path = await containedPath(root, file.path);
  if (!path) { file.unavailable = true; return; }
  let handle;
  try {
    if (!(await lstat(path)).isFile()) return;
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile()) return;
    const data = Buffer.alloc(Math.min(stat.size, 64 * 1024));
    const { bytesRead } = await handle.read(data, 0, data.length, 0), content = data.subarray(0, bytesRead);
    file.binary = content.includes(0);
    if (file.binary) file.removed = null;
    else if (stat.size === bytesRead) file.added = content.length ? content.toString('utf8').split('\n').length - (content.at(-1) === 10 ? 1 : 0) : 0;
  } catch { file.unavailable = true; }
  finally { await handle?.close(); }
}

export async function repositoryStatus(cwd) {
  const unavailable = { available: false, root: null, branch: null, files: [], error: 'Repository unavailable' };
  try {
    const root = await repositoryRoot(cwd);
    if (!root) return unavailable;
    const [status, staged, unstaged] = await Promise.all([
      git(root, ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all', '--ignore-submodules=all']),
      git(root, ['diff', '--cached', '--numstat', '-z', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all']),
      git(root, ['diff', '--numstat', '-z', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all']),
    ]);
    if (status.code !== 0) return { ...unavailable, root, error: status.timedOut ? 'Repository inspection timed out' : status.truncated ? 'Repository status exceeds limit' : unavailable.error };
    const parsed = statusFiles(status.text), total = parsed.files.length, files = parsed.files.slice(0, fileLimit);
    if (staged.code === 0) addCounts(files, staged.text);
    if (unstaged.code === 0) addCounts(files, unstaged.text);
    // Limit open descriptors even in repositories with many untracked files.
    const untracked = files.filter(file => file.status === '??');
    for (let start = 0; start < untracked.length; start += 8) await Promise.all(untracked.slice(start, start + 8).map(file => untrackedCounts(root, file)));
    const incomplete = staged.code !== 0 || unstaged.code !== 0;
    if (incomplete) for (const file of files) if (file.status !== '??') { file.added = null; file.removed = null; }
    return { available: true, root, branch: parsed.branch, files, total, truncated: total > fileLimit, incomplete };
  } catch { return unavailable; }
}

export async function repositoryDiff(cwd, path) {
  const unavailable = { available: false, root: null, path: typeof path === 'string' ? path : '', text: '', binary: false, truncated: false, error: 'File unavailable' };
  if (!validPath(path)) return unavailable;
  try {
    const status = await repositoryStatus(cwd);
    if (!status.available) return { ...unavailable, error: status.error };
    const file = status.files.find(file => file.path === path);
    if (!file || !await containedPath(status.root, path) || (file.originalPath && !await containedPath(status.root, file.originalPath))) return { ...unavailable, root: status.root };
    const flags = ['--no-ext-diff', '--no-textconv', '--no-color', '--ignore-submodules=all', '--src-prefix=a/', '--dst-prefix=b/'];
    let results;
    if (file.status === '??') results = [{ name: '', result: await git(status.root, ['diff', '--no-index', ...flags, '--', '/dev/null', path], outputLimit) }];
    else {
      const paths = file.originalPath ? [file.originalPath, path] : [path];
      results = await Promise.all([
        ...(file.staged ? [git(status.root, ['diff', '--cached', ...flags, '--', ...paths], outputLimit).then(result => ({ name: 'Staged', result }))] : []),
        ...(file.unstaged ? [git(status.root, ['diff', ...flags, '--', ...paths], outputLimit).then(result => ({ name: 'Unstaged', result }))] : []),
      ]);
    }
    if (results.some(({ result }) => result.timedOut || (!result.truncated && result.code !== 0 && !(file.status === '??' && result.code === 1)))) return { ...unavailable, root: status.root, error: 'Diff unavailable' };
    const joined = results.map(({ name, result }) => result.text ? `${name ? `${name}\n` : ''}${result.text}` : '').join('\n');
    const bytes = Buffer.from(joined), text = bytes.subarray(0, outputLimit).toString('utf8');
    return { available: true, root: status.root, path, text, binary: file.binary || /(?:^|\n)Binary files .* differ(?:\n|$)/.test(text), truncated: bytes.length > outputLimit || results.some(({ result }) => result.truncated) };
  } catch { return unavailable; }
}

// Only parsers' confirmed edit paths count. Git status and human-readable tool
// labels cannot identify who changed a shared working directory.
export function observedOverlaps(sessions, now = Date.now()) {
  const paths = new Map();
  for (const session of sessions ?? []) {
    if (!session?.id || typeof session.cwd !== 'string' || !isAbsolute(session.cwd)) continue;
    const cwd = resolve(session.cwd), repo = resolve(session.repositoryRoot || cwd);
    if (!inside(repo, cwd)) continue;
    for (const message of session.messages ?? []) {
      if (!message?.tool || message.failed || !Number.isFinite(message.timestamp) || message.timestamp <= 0 || now - message.timestamp > 30 * 60_000 || message.timestamp > now || !Array.isArray(message.editPaths)) continue;
      for (const edit of message.editPaths) {
        if (typeof edit !== 'string' || edit.includes('\0') || edit.length > 4096 || (!isAbsolute(edit) && !validPath(edit))) continue;
        const absolute = resolve(cwd, edit);
        if (!inside(repo, absolute) || absolute === repo) continue;
        const path = relative(repo, absolute);
        if (!validPath(path)) continue;
        const key = `${repo}\0${path}`;
        if (!paths.has(key)) paths.set(key, { repo, cwd: repo, path, sessionIds: new Set() });
        paths.get(key).sessionIds.add(session.id);
      }
    }
  }
  return [...paths.values()].filter(record => record.sessionIds.size > 1).map(record => ({ ...record, sessionIds: [...record.sessionIds].sort() })).sort((a, b) => a.repo.localeCompare(b.repo) || a.path.localeCompare(b.path));
}
