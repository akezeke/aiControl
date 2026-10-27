import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, dataDir, prepareData } from '../server/config.mjs';
import { hookTimeoutMs } from '../server/claude.mjs';

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
export const hookCommand = `${quote(process.execPath)} ${quote(join(root, 'scripts/claude-hook.mjs'))}`;

export function mergeHooks(settings, remove = false) {
  const result = structuredClone(settings);
  result.hooks ??= {};
  const events = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd'];
  // PreToolUse is only cleaned up: it blocked the terminal while a question waited here.
  for (const name of [...events, 'PreToolUse']) {
    const current = result.hooks[name] ?? [];
    result.hooks[name] = current.map(group => ({ ...group, hooks: group.hooks.filter(h => h.command !== hookCommand) })).filter(g => g.hooks.length);
    if (!remove && events.includes(name)) result.hooks[name].push({ hooks: [{ type: 'command', command: hookCommand, timeout: name === 'PermissionRequest' ? hookTimeoutMs / 1000 : 5 }] });
    if (!result.hooks[name].length) delete result.hooks[name];
  }
  return result;
}

export async function installHooks(remove = false, file = join(homedir(), '.claude/settings.json')) {
  prepareData();
  const raw = await readFile(file, 'utf8').catch(e => { if (e.code === 'ENOENT') return '{}'; throw e; });
  const existing = JSON.parse(raw);
  const next = mergeHooks(existing, remove);
  if (JSON.stringify(existing) === JSON.stringify(next)) return;
  await mkdir(join(homedir(), '.claude'), { recursive: true, mode: 0o700 });
  await copyFile(file, join(dataDir, `claude-settings-${Date.now()}.backup.json`)).catch(e => { if (e.code !== 'ENOENT') throw e; });
  const temporary = `${file}.aicontrol-${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, file);
  console.log(remove ? 'AI Control hooks removed; other Claude settings preserved.' : 'Claude hooks connected. Existing sessions may need /hooks → review or a restart.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await installHooks(process.argv.includes('--remove'));
