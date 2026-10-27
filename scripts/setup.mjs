import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { root, dataDir, settingsFile, prepareData, tailscaleSelf, checkCert } from '../server/config.mjs';

export async function setup() {
  prepareData();
  const self = tailscaleSelf();
  let settings = { mode: 'local' };
  if (!self) console.log('Tailscale is not running: local mode (this computer only). Run npm run setup after starting Tailscale to change.');
  else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
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
    } finally { rl.close(); }
  }
  await writeFile(settingsFile, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  console.log(`Saved ${settings.mode}${settings.mode === 'tailscale' ? (settings.cert ? ' HTTPS' : ' HTTP') : ''} settings to .local/config.json.`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await setup().catch(e => { console.error(e.message); process.exitCode = 1; });
