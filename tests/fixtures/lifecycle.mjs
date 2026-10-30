// Run only in CI's disposable checkout: exercises the real tmux/watch startup and stop scripts.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { root, dataDir, settingsFile, authFile, prepareData } from '../../server/config.mjs';
import { savePassword } from '../../server/auth.mjs';
import { processInfo, processCommand, processMatches } from '../../server/processes.mjs';

if (!process.env.CI || [settingsFile, authFile, join(dataDir, 'server.json')].some(existsSync)) throw new Error('Lifecycle smoke test requires a fresh CI checkout.');
const exec = promisify(execFile);
const run = (file, args) => exec(file, args, { cwd: root, timeout: 30_000, env: { ...process.env, TAILSCALE_BE_CLI: '1' } });
await assert.rejects(run('tmux', ['has-session', '-t', '=aiControl']), 'The smoke test needs its own tmux session.');
prepareData();
await writeFile(settingsFile, JSON.stringify({ mode: 'local', claudeDirs: [join(dataDir, 'smoke-claude')] }));
await savePassword(authFile, '1234');
const status = async () => JSON.parse(await readFile(join(dataDir, 'server.json'), 'utf8'));
try {
  assert.match((await run('npm', ['start'])).stdout, /is running in tmux/);
  const first = await status(), server = await processInfo(first.pid), watcher = await processInfo(server.ppid);
  assert.match(await processCommand(watcher.pid), /--watch/);
  assert.deepEqual(await fetch(`${first.url}/api/auth`).then(response => response.json()), { authenticated: false, kind: 'pin' });
  assert.match((await run('npm', ['start'])).stdout, /already running/);
  assert.equal((await status()).pid, first.pid);
  await run('npm', ['restart']);
  const second = await status();
  assert.notEqual(second.pid, first.pid);
  assert.equal(await processMatches(first.pid, server.start), false);
  assert.equal(await processMatches(watcher.pid, watcher.start), false);
  assert.equal((await fetch(`${second.url}/api/auth`)).status, 200);
  const restarted = await processInfo(second.pid), restartedWatcher = await processInfo(restarted.ppid);
  await run('npm', ['stop']);
  assert.equal(existsSync(join(dataDir, 'server.json')), false);
  assert.equal(await processMatches(second.pid, restarted.start), false);
  assert.equal(await processMatches(restartedWatcher.pid, restartedWatcher.start), false);
  assert.match((await run('npm', ['stop'])).stdout, /not running/);
  console.log('Lifecycle passed: start, duplicate start, restart, HTTP, stop, watcher cleanup.');
} catch (error) {
  console.error(await readFile(join(dataDir, 'server.log'), 'utf8').catch(() => 'No server log.'));
  throw error;
} finally {
  await run('npm', ['stop']).catch(() => {});
  await run('tmux', ['kill-session', '-t', '=aiControl']).catch(() => {});
  await Promise.all([settingsFile, authFile].map(file => unlink(file)));
}
