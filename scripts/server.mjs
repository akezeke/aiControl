import { readFile } from 'node:fs/promises';
import { startServer } from '../server/main.mjs';
import { port, readSettings, tailscaleSelf, checkCert, isTailscaleIP } from '../server/config.mjs';
import { portInUse } from '../server/network.mjs';

const settings = readSettings();
const local = process.argv.includes('--local') || settings.mode !== 'tailscale';
const self = local ? { ip: '127.0.0.1', hostname: '127.0.0.1' } : tailscaleSelf();
if (!self) throw new Error('Tailscale is not running. Start it, or use npm run dev:local.');
if (!local && !isTailscaleIP(self.ip)) throw new Error('Tailscale has no valid IPv4 address. Refusing to bind to another interface.');
if (portInUse(port)) throw new Error(`Port ${port} is already in use. AI Control will not share or replace another project's server.`);
let tls = null;
if (!local && settings.cert) {
  tls = { cert: await readFile(settings.cert), key: await readFile(settings.key) };
  checkCert(tls.cert, self.hostname);
}
const app = await startServer({ host: self.ip, hostname: self.hostname, tls });
// --watch waits for this exit before restarting, so always exit.
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().catch(console.error).finally(() => process.exit(0)));
