import { existsSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { root, dataDir, settingsFile, prepareData, tailscaleSelf, checkCert, readSettings, claudeAccounts } from '../server/config.mjs';
import { openCodeConfig } from '../server/opencode.mjs';
import { hiddenInput } from './password.mjs';

// Claude Code folders in use, whatever their name: the configured ones, CLAUDE_CONFIG_DIR and any folder in ~ or ~/.config
// holding a login or sessions and transcripts.
export function claudeDirs(home = homedir(), settings = (() => { try { return readSettings(); } catch { return {}; } })()) {
  const found = [home, join(home, '.config')].flatMap(parent => { try { return readdirSync(parent, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(parent, entry.name)); } catch { return []; } })
    .filter(dir => existsSync(join(dir, '.credentials.json')) || (existsSync(join(dir, 'sessions')) && existsSync(join(dir, 'projects'))));
  const accounts = [...claudeAccounts(settings, home), ...claudeAccounts({ claudeDirs: [...found, process.env.CLAUDE_CONFIG_DIR].filter(Boolean) }, home)];
  return [...new Set(accounts.map(account => account.dir))].map(dir => dir.startsWith(home + '/') ? '~' + dir.slice(home.length) : dir);
}

export async function setup(args = []) {
  prepareData();
  // A scoped connection change keeps network settings, certificates and accounts intact.
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--opencode') throw new Error('Usage: npm run setup -- --opencode auto|off|http://127.0.0.1:4096');
    const settings = readSettings();
    if (args[1] === 'off') delete settings.opencode;
    else settings.opencode = args[1] === 'auto' ? { service: true } : openCodeConfig({ ...settings.opencode, service: false, url: args[1] });
    await writeFile(settingsFile, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
    console.log('Saved OpenCode connection. Run npm restart to apply.');
    return;
  }
  const self = tailscaleSelf();
  let settings = { mode: 'local' };
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let openCodePassword = false;
  try {
    if (!self) console.log('Tailscale is not running: local mode (this computer only). Run npm run setup after starting Tailscale to change.');
    else {
      console.log(`Tailscale: ${self.hostname} (${self.ip})`);
      if (!/^n/i.test(await rl.question('Reach AI Control from your other Tailscale devices? [Y/n] '))) {
        settings = { mode: 'tailscale' };
        const found = [dataDir, root].map(dir => join(dir, `${self.hostname}.crt`)).find(existsSync);
        const cli = self.command === 'tailscale' ? 'tailscale' : `TAILSCALE_BE_CLI=1 '${self.command.replaceAll("'", "'\\''")}'`;
        if (!found) console.log(`For HTTPS, create a certificate (see README), then enter its path:\n  ${cli} cert --cert-file .local/${self.hostname}.crt --key-file .local/${self.hostname}.key ${self.hostname}`);
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
    const existing = readSettings().opencode;
    const saved = existing?.service ? 'auto' : existing?.url;
    const answer = (await rl.question(`OpenCode: "auto" for the V2 service, server URL${saved ? ` [${saved}]` : ' (blank to skip)'}, or "off": `)).trim() || saved;
    if (answer === 'auto') settings.opencode = { service: true };
    else if (answer && answer !== 'off') {
      settings.opencode = openCodeConfig({ ...existing, service: false, url: answer });
      const auth = (await rl.question(`OpenCode server password: keep${settings.opencode.password ? ' saved' : ' empty'}, change, or clear [keep]: `)).trim().toLowerCase();
      if (auth === 'clear') settings.opencode.password = '';
      if (auth === 'change') {
        openCodePassword = true;
        settings.opencode.username = (await rl.question(`OpenCode username [${settings.opencode.username}]: `)).trim() || settings.opencode.username;
      }
    }
  } finally { rl.close(); }
  if (openCodePassword) settings.opencode.password = await hiddenInput('OpenCode server password: ');
  if (settings.opencode) settings.opencode = openCodeConfig(settings.opencode);
  await writeFile(settingsFile, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  console.log(`Saved ${settings.mode}${settings.mode === 'tailscale' ? (settings.cert ? ' HTTPS' : ' HTTP') : ''}${settings.claudeDirs ? `, ${settings.claudeDirs.length} Claude account${settings.claudeDirs.length === 1 ? '' : 's'}` : ''} settings to .local/config.json.`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await setup(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
