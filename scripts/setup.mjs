import { existsSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { root, dataDir, settingsFile, prepareData, tailscaleSelf, checkCert, readSettings, claudeAccounts } from '../server/config.mjs';

// Claude Code folders in use, whatever their name: the configured ones, CLAUDE_CONFIG_DIR and any folder in ~ or ~/.config
// holding a login or sessions and transcripts.
export function claudeDirs(home = homedir(), settings = (() => { try { return readSettings(); } catch { return {}; } })()) {
  const found = [home, join(home, '.config')].flatMap(parent => { try { return readdirSync(parent, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(parent, entry.name)); } catch { return []; } })
    .filter(dir => existsSync(join(dir, '.credentials.json')) || (existsSync(join(dir, 'sessions')) && existsSync(join(dir, 'projects'))));
  const accounts = [...claudeAccounts(settings, home), ...claudeAccounts({ claudeDirs: [...found, process.env.CLAUDE_CONFIG_DIR].filter(Boolean) }, home)];
  return [...new Set(accounts.map(account => account.dir))].map(dir => dir.startsWith(home + '/') ? '~' + dir.slice(home.length) : dir);
}

export async function setup() {
  prepareData();
  const self = tailscaleSelf();
  let settings = { mode: 'local' };
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (!self) console.log('Tailscale is not running: local mode (this computer only). Run npm run setup after starting Tailscale to change.');
    else {
      console.log(`Tailscale: ${self.hostname} (${self.ip})`);
      if (!/^n/i.test(await rl.question('Reach AI Control from your other Tailscale devices? [Y/n] '))) {
        settings = { mode: 'tailscale' };
        const found = [dataDir, root].map(dir => join(dir, `${self.hostname}.crt`)).find(existsSync);
        if (!found) console.log(`For HTTPS, create a certificate (see README), then enter its path:\n  tailscale cert --cert-file .local/${self.hostname}.crt --key-file .local/${self.hostname}.key ${self.hostname}`);
        const answer = (await rl.question(found ? `Certificate [${found}], or "http" for none: ` : 'Certificate .crt path, blank for HTTP (Tailscale still encrypts traffic): ')).trim();
        const cert = answer === 'http' ? '' : answer || found;
        if (cert) {
          const sibling = cert.replace(/\.crt$/, '.key');
          const key = sibling !== cert && existsSync(sibling) ? sibling : (await rl.question('Key file: ')).trim();
          checkCert(await readFile(cert), self.hostname);
          await readFile(key);
          Object.assign(settings, { cert: resolve(cert), key: resolve(key) });
        }
      }
    }
    // One folder per Claude account (CLAUDE_CONFIG_DIR); only asked when more than ~/.claude is in use.
    const dirs = claudeDirs();
    if (dirs.length > 1 || dirs[0] !== '~/.claude') {
      const answer = (await rl.question(`Claude accounts [${dirs.join(', ')}], or comma-separated folders: `)).trim();
      settings.claudeDirs = answer ? answer.split(',').map(dir => dir.trim()).filter(Boolean) : dirs;
    }
  } finally { rl.close(); }
  await writeFile(settingsFile, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  console.log(`Saved ${settings.mode}${settings.mode === 'tailscale' ? (settings.cert ? ' HTTPS' : ' HTTP') : ''}${settings.claudeDirs ? `, ${settings.claudeDirs.length} Claude account${settings.claudeDirs.length === 1 ? '' : 's'}` : ''} settings to .local/config.json.`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await setup().catch(e => { console.error(e.message); process.exitCode = 1; });
