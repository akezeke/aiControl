import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir, root } from '../server/config.mjs';

const serverPath = join(root, 'scripts/server.mjs');
const command = pid => readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '');
const parentPid = async pid => Number((await readFile(`/proc/${pid}/stat`, 'utf8')).split(') ')[1].split(' ')[1]);
// A watcher whose server crashed has no server.json; ending the tmux session stops it.
function endSession() { try { execFileSync('tmux', ['kill-session', '-t', '=aiControl'], { stdio: 'ignore' }); return true; } catch { return false; } }

try {
  const { pid } = JSON.parse(await readFile(join(dataDir, 'server.json'), 'utf8'));
  if (!(await command(pid)).includes(serverPath)) throw new Error('The recorded PID does not belong to AI Control.');
  // Stop the --watch parent too, or it would wait for the next file change.
  const parent = await parentPid(pid), parentCommand = await command(parent);
  process.kill(parentCommand.includes('--watch') && parentCommand.includes(serverPath) ? parent : pid, 'SIGTERM');
  console.log('AI Control is stopping.');
  let stopped = false;
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') { stopped = true; break; } throw error; }
  }
  if (!stopped) throw new Error('Shutdown is still in progress. Check npm run attach before starting again.');
  await new Promise(resolve => setTimeout(resolve, 150));
  console.log('AI Control stopped.');
} catch (error) {
  if (error.code !== 'ENOENT') { console.error(error.message); process.exitCode = 1; }
  else console.log(endSession() ? 'AI Control stopped.' : 'AI Control is not running.');
}
