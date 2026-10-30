import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const validPid = pid => Number.isSafeInteger(pid) && pid > 0;
const psOptions = () => ({ encoding: 'utf8', timeout: 1500, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } });

// Claude registrations use Linux boot ticks or macOS's `LC_ALL=C TZ=UTC ps -o lstart=`.
// Keep the latter's internal spaces: this value also identifies the process in inbox messages.
export async function processInfo(pid, { platform = process.platform, read = readFile, exec = run } = {}) {
  if (!validPid(pid)) return null;
  try {
    if (platform === 'linux') {
      const stat = await read(`/proc/${pid}/stat`, 'utf8');
      const end = stat.lastIndexOf(')'), fields = stat.slice(end + 2).trim().split(/\s+/);
      if (end < 0 || fields.length < 20) return null;
      return { pid, ppid: Number(fields[1]), state: fields[0], start: fields[19], name: stat.slice(stat.indexOf('(') + 1, end) };
    }
    const { stdout } = await exec('ps', ['-ww', '-p', String(pid), '-o', 'ppid=,stat=,lstart=,comm='], psOptions());
    const row = stdout.trim().match(/^(\d+)\s+(\S+)\s+(\w{3} \w{3}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(.+)$/);
    return row ? { pid, ppid: Number(row[1]), state: row[2], start: row[3], name: basename(row[4]) } : null;
  } catch { return null; } // A process can exit between discovery and inspection.
}

export async function processMatches(pid, start, options) {
  const info = await processInfo(pid, options);
  return !!info && !info.state.startsWith('Z') && (!start || info.start === String(start));
}

export async function parentPid(pid, options) { return (await processInfo(pid, options))?.ppid || 0; }

export async function processCommand(pid, { platform = process.platform, read = readFile, exec = run } = {}) {
  if (!validPid(pid)) return '';
  try {
    if (platform === 'linux') return (await read(`/proc/${pid}/cmdline`, 'utf8')).replaceAll('\0', ' ').trim();
    return (await exec('ps', ['-ww', '-p', String(pid), '-o', 'args='], psOptions())).stdout.trim();
  } catch { return ''; }
}

export async function listProcesses({ platform = process.platform, read = readFile, list = readdir, exec = run } = {}) {
  if (platform !== 'linux') {
    const { stdout } = await exec('ps', ['-axww', '-o', 'pid=,ppid=,args='], psOptions());
    return stdout.split('\n').flatMap(line => {
      const row = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      return row ? [{ pid: Number(row[1]), ppid: Number(row[2]), args: row[3] }] : [];
    });
  }
  const all = await Promise.all((await list('/proc')).filter(name => /^\d+$/.test(name)).map(async name => {
    const pid = Number(name), options = { platform, read, exec };
    const [info, args] = await Promise.all([processInfo(pid, options), processCommand(pid, options)]);
    return info ? { pid, ppid: info.ppid, args } : null;
  }));
  return all.filter(Boolean);
}

// Hooks may run through a shell, and npm installations run Claude's CLI through Node.
export async function claudeProcess(pid, { info = processInfo, command = processCommand } = {}) {
  for (let i = 0; i < 8 && pid > 1; i++) {
    const process = await info(pid);
    if (!process || process.state.startsWith('Z')) break;
    const args = await command(pid);
    if (process.name === 'claude' || /^(?:\S*\/)?claude(?:\s|$)/.test(args)
      || (process.name === 'node' && /^\S+\s+\S*\/\@anthropic-ai\/claude-code\/cli\.js(?:\s|$)/.test(args))) {
      return { pid, procStart: process.start };
    }
    pid = process.ppid;
  }
  return { pid: 0 };
}
