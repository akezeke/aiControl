import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { root, dataDir, authFile, settingsFile, prepareData } from '../server/config.mjs';
import { configurePassword } from './password.mjs';
import { setup } from './setup.mjs';
import { installHooks } from './install-hooks.mjs';
import { processCommand } from '../server/processes.mjs';

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const session = 'aiControl';
const local = process.argv.includes('--local');
function running() { try { execFileSync('tmux', ['has-session', '-t', `=${session}`], { stdio: 'ignore' }); return true; } catch { return false; } }

try {
  try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); }
  catch { throw new Error(`tmux is required. ${process.platform === 'darwin' ? 'Install it with brew install tmux.' : 'Install tmux with your package manager.'}`); }
  if (running()) {
    const status = JSON.parse(await readFile(join(dataDir, 'server.json'), 'utf8').catch(() => '{}'));
    if (!status.pid || !status.url) throw new Error("The tmux session 'aiControl' exists, but no running server has reported ready. Use npm run attach to inspect it.");
    const cmd = await processCommand(status.pid);
    if (!cmd.includes(join(root, 'scripts/server.mjs'))) throw new Error("The tmux session 'aiControl' has stale server information. Inspect it with npm run attach.");
    console.log(`AI Control is already running: ${status.url}.\nAttach: npm run attach`);
    process.exit(0);
  }
  prepareData();
  if (!existsSync(settingsFile)) await setup();
  if (!existsSync(authFile)) await configurePassword();
  await installHooks();
  await unlink(join(dataDir, 'server.json')).catch(() => {});
  // An edit to the server or anything it imports restarts it, client modules it shares included (meeting.js,
  // leaderboard.js, …), as with the hub; the browser picks up other client edits on refresh.
  // Some Node 22 releases (22.14) take the argument after each --watch flag as its value and pass it to the server
  // if it looks like a flag: a bare --watch after --watch-preserve-output starts a second watcher. Before it, the server
  // only gets --watch-preserve-output, which does nothing without --watch (Node 24 passes it on anyway).
  const command = `${quote(process.execPath)} --watch --watch-preserve-output ${quote(join(root, 'scripts/server.mjs'))}${local ? ' --local' : ''} 2>&1 | tee -a ${quote(join(dataDir, 'server.log'))}`;
  execFileSync('tmux', ['new-session', '-d', '-s', session, '-c', root, '-e', `PATH=${process.env.PATH}`, command]);
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    if (existsSync(join(dataDir, 'server.json'))) {
      const status = JSON.parse(await readFile(join(dataDir, 'server.json'), 'utf8'));
      console.log(`AI Control is running in tmux '${session}'.\n${status.url}\nAttach: npm run attach\nStop: npm stop`);
      process.exit(0);
    }
    if (!running()) break;
  }
  throw new Error('Server startup did not complete. See .local/server.log.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
