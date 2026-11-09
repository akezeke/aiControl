// npm run hub: host Office online. Runs the hub (server/hub.mjs) in its own tmux session on 127.0.0.1, publishes it with
// Tailscale Funnel and prints the meeting code: the address and the room key. Friends enter it at the meetings clipboard by
// their office door. This machine's AI Control signs in to it as you (your username).
//   --join <code>  sign this machine in to someone else's meeting, as you, instead of hosting one
//   --new-code     a new key; everyone signs in again with the new code (names and scores stay)
//   --stop         Funnel off, hub stopped
//   --local        no Funnel: only this machine can join (or put your own HTTPS proxy in front)
//   --serve        the hub itself (what the tmux session runs)
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { root, dataDir, prepareData, tailscaleSelf } from '../server/config.mjs';
import { portInUse } from '../server/network.mjs';
import { hubState, newKey, startHub } from '../server/hub.mjs';
import { createOfficeOnline } from '../server/office-online.mjs';

const PORT = 47843, session = 'aiControlHub', file = join(dataDir, 'hub.json'), log = join(dataDir, 'hub.log');
const onlineFile = join(dataDir, 'office-online.json');
// Signs this machine's AI Control in by writing its office-online.json; the running server reads it on the next request.
async function signIn(code) {
  try { console.log(`Signed in as ${(await createOfficeOnline({ file: onlineFile }).join({ code, name: userInfo().username })).name}.`); }
  catch (error) { console.log(`Not signed in: ${error.message} Sign in at the meetings clipboard instead.`); }
}
const signedInTo = () => { try { const { url, key } = JSON.parse(readFileSync(onlineFile, 'utf8')); return `${url}/${key}`; } catch { return ''; } };
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const running = () => { try { execFileSync('tmux', ['has-session', '-t', `=${session}`], { stdio: 'ignore' }); return true; } catch { return false; } };
const until = async (ok, ms = 5000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await ok()) return true; return false; };
const listening = () => portInUse(PORT, { host: '127.0.0.1' });

async function stop() {
  if (!running()) return;
  execFileSync('tmux', ['kill-session', '-t', `=${session}`]);
  // The hub saves on its way out; wait for it, so a new key written next isn't overwritten by the old one.
  if (!await until(async () => !await listening())) throw new Error(`The hub is still on port ${PORT}.`);
}
async function start() {
  if (running()) return;
  const command = `${quote(process.execPath)} ${quote(join(root, 'scripts/hub.mjs'))} --serve 2>&1 | tee -a ${quote(log)}`;
  execFileSync('tmux', ['new-session', '-d', '-s', session, '-c', root, '-e', `PATH=${process.env.PATH}`, command]);
  if (!await until(listening)) throw new Error(`The hub didn't start. See ${log}.`);
}
// What Tailscale says goes straight to the terminal: a link to switch Funnel on for the tailnet, or a permission error.
const tailscale = (self, args) => spawnSync(self.command, args, { stdio: 'inherit', env: { ...process.env, TAILSCALE_BE_CLI: '1' } }).status === 0;

if (process.argv.includes('--serve')) {
  prepareData();
  const hostToken = () => { try { return JSON.parse(readFileSync(onlineFile, 'utf8')).token; } catch { return null; } };
  const hub = await startHub({ file, port: PORT, hostToken });
  console.log(`Hub ready on 127.0.0.1:${PORT}`);
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => hub.close().finally(() => process.exit(0)));
} else {
  try {
    prepareData();
    const self = tailscaleSelf();
    if (process.argv.includes('--join')) await signIn(process.argv[process.argv.indexOf('--join') + 1]);
    else if (process.argv.includes('--stop')) {
      // ponytail: `funnel reset` would also clear any other `tailscale serve` setup, so only port 443 is turned off.
      const serving = self && spawnSync(self.command, ['funnel', 'status', '--json'], { encoding: 'utf8', env: { ...process.env, TAILSCALE_BE_CLI: '1' } }).stdout?.includes(`:${PORT}`);
      if (serving && !tailscale(self, ['funnel', '--https=443', 'off'])) console.log('Funnel may still be on: check `tailscale funnel status`.');
      await stop();
      console.log('Hub stopped.');
    } else {
      if (process.argv.includes('--new-code')) { await stop(); newKey(file); }
      const { key } = hubState(file);
      await start();
      const published = !process.argv.includes('--local') && self && self.hostname !== self.ip && tailscale(self, ['funnel', '--bg', String(PORT)]);
      const url = published ? `https://${self.hostname}` : `http://127.0.0.1:${PORT}`;
      if (published) console.log(`\nMeeting code: ${self.hostname}/${key}`);
      else {
        if (self && !process.argv.includes('--local') && process.platform === 'linux') console.log('\nIf Tailscale refused, allow it once: sudo tailscale set --operator=$USER');
        console.log(`\nFunnel is off, so only this machine can join: ${url}/${key}`);
      }
      // Already in (under whatever name the clipboard last gave): left alone.
      if (signedInTo() !== `${url}/${key}`) await signIn(`${url}/${key}`);
      console.log(`Stop: npm run hub -- --stop · New code: npm run hub -- --new-code`);
    }
  } catch (error) { console.error(error.message); process.exit(1); }
}
