import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { dataDir, root } from '../server/config.mjs';
import { processCommand as command, processInfo, parentPid } from '../server/processes.mjs';

const serverPath = join(root, 'scripts/server.mjs');
// A watcher whose server crashed has no server.json; ending the tmux session stops it.
function endSession() { try { execFileSync('tmux', ['kill-session', '-t', '=aiControl'], { stdio: 'ignore' }); return true; } catch { return false; } }
// The outermost `node --watch` running the server, or the server itself when unwatched. Node 22.14 can nest a second
// watcher (start.mjs); ending only the inner one leaves the outer waiting for a file change, holding the tmux session.
async function watcherOf(pid) {
  let target = pid;
  for (let parent = await parentPid(pid); parent > 1; parent = await parentPid(parent)) {
    const parentCommand = await command(parent);
    // The shell running the pipeline names the same flags and path; only node watchers count.
    if ((await processInfo(parent))?.name !== basename(process.execPath) || !parentCommand.includes('--watch') || !parentCommand.includes(serverPath)) break;
    target = parent;
  }
  return target;
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };

try {
  const { pid } = JSON.parse(await readFile(join(dataDir, 'server.json'), 'utf8'));
  if (!(await command(pid)).includes(serverPath)) throw new Error('The recorded PID does not belong to AI Control.');
  // A watcher ends its server before it exits; the tmux session ends with the outermost one.
  const target = await watcherOf(pid);
  process.kill(target, 'SIGTERM');
  console.log('AI Control is stopping.');
  let stopped = false;
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    if (!alive(pid) && !alive(target)) { stopped = true; break; }
  }
  if (!stopped) throw new Error('Shutdown is still in progress. Check npm run attach before starting again.');
  await new Promise(resolve => setTimeout(resolve, 150));
  console.log('AI Control stopped.');
} catch (error) {
  if (error.code !== 'ENOENT') { console.error(error.message); process.exitCode = 1; }
  else console.log(endSession() ? 'AI Control stopped.' : 'AI Control is not running.');
}
