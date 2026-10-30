import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const dataDir = join(root, '.local');
// Some filesystems (e.g. WSL's /mnt/c) can't hold Unix sockets, so prefer the private per-user runtime dir. A Claude
// started without XDG_RUNTIME_DIR (cron, sudo -u) must still find the server's socket, so fall back to its usual place.
// macOS's per-user temp directory also keeps the socket below its 104-byte Unix socket path limit.
const runtimeDir = process.env.XDG_RUNTIME_DIR || (process.platform === 'darwin' ? tmpdir() : [`/run/user/${process.getuid?.()}`].find(dir => existsSync(dir)));
export const hookSocket = runtimeDir ? join(runtimeDir, 'ai-control-hooks.sock') : join(dataDir, 'hooks.sock');
export const authFile = join(dataDir, 'auth.json');
export const settingsFile = join(dataDir, 'config.json');
export const port = 47841;
export function prepareData() { mkdirSync(dataDir, { recursive: true, mode: 0o700 }); }

// { mode: 'tailscale' | 'local', cert?, key?, claudeDirs? }, written by scripts/setup.mjs.
export function readSettings() {
  try { return JSON.parse(readFileSync(settingsFile, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
}

// Claude Code config folders in use when none are configured: $CLAUDE_CONFIG_DIR, ~/.claude and every ~/.claude-*
// holding settings.json or sessions/, such as ~/.claude-personal.
export function claudeDirs(home = homedir(), configured = process.env.CLAUDE_CONFIG_DIR) {
  const names = (() => { try { return readdirSync(home); } catch { return []; } })();
  const found = ['.claude', ...names.filter(name => name.startsWith('.claude-'))].map(name => join(home, name))
    .filter(dir => ['settings.json', 'sessions'].some(file => existsSync(join(dir, file))));
  const dirs = [configured, ...found].filter(Boolean);
  return [...new Set((dirs.length ? dirs : [join(home, '.claude')]).map(dir => resolve(dir)))];
}

// One Claude Code config folder (CLAUDE_CONFIG_DIR) per account, named anything. The label tells accounts apart
// (~/.claude-work → work, ~/accounts/personal → personal); it is empty for ~/.claude, which a plain `claude` uses.
export function claudeAccounts(settings = readSettings(), home = homedir()) {
  const standard = join(home, '.claude');
  const listed = Array.isArray(settings.claudeDirs) ? settings.claudeDirs.filter(dir => typeof dir === 'string' && dir.trim()) : [];
  const dirs = listed.length ? listed : claudeDirs(home);
  return [...new Set(dirs.map(dir => resolve(dir.trim().replace(/^~(?=\/|$)/, home))))].map(dir => ({
    dir, label: dir === standard ? '' : basename(dir).replace(/^\./, '').replace(/^claude[-_.]?/i, '') || basename(dirname(dir)).replace(/^\./, ''),
    sessionsDir: join(dir, 'sessions'), projectsDir: join(dir, 'projects'),
  }));
}

// This machine's Tailscale IPv4 and MagicDNS name, or null when Tailscale is missing or stopped.
export function tailscaleSelf({ platform = process.platform, home = homedir(), exec = execFileSync } = {}) {
  const commands = ['tailscale', ...platform === 'darwin' ? ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', join(home, 'Applications/Tailscale.app/Contents/MacOS/Tailscale')] : []];
  for (const command of commands) {
    try {
      const status = JSON.parse(exec(command, ['status', '--json'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, TAILSCALE_BE_CLI: '1' } }));
      const ip = status.Self?.TailscaleIPs?.find(address => address.includes('.'));
      return status.BackendState === 'Running' && ip ? { ip, hostname: status.Self.DNSName?.replace(/\.$/, '') || ip, command } : null;
    } catch (error) { if (error.code !== 'ENOENT') return null; }
  }
  return null;
}

export function checkCert(pem, hostname) {
  const cert = new X509Certificate(pem);
  if (!cert.checkHost(hostname) || Date.parse(cert.validTo) <= Date.now() || Date.parse(cert.validFrom) > Date.now()) throw new Error(`The HTTPS certificate is expired or not for ${hostname}. Renew it with tailscale cert, or run npm run setup.`);
}

export function isTailscaleIP(ip) {
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every(p => Number.isInteger(p) && p >= 0 && p <= 255) && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}
