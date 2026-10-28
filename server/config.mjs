import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const dataDir = join(root, '.local');
// Some filesystems (e.g. WSL's /mnt/c) can't hold Unix sockets, so prefer the private per-user runtime dir.
export const hookSocket = process.env.XDG_RUNTIME_DIR ? join(process.env.XDG_RUNTIME_DIR, 'ai-control-hooks.sock') : join(dataDir, 'hooks.sock');
export const authFile = join(dataDir, 'auth.json');
export const settingsFile = join(dataDir, 'config.json');
export const port = 47841;
export function prepareData() { mkdirSync(dataDir, { recursive: true, mode: 0o700 }); }

// { mode: 'tailscale' | 'local', cert?, key?, claudeDirs? }, written by scripts/setup.mjs.
export function readSettings() {
  try { return JSON.parse(readFileSync(settingsFile, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
}

// One Claude Code config folder (CLAUDE_CONFIG_DIR) per account, named anything. The label tells accounts apart
// (~/.claude-work → work, ~/accounts/personal → personal); it is empty for ~/.claude, which a plain `claude` uses.
export function claudeAccounts(settings = readSettings(), home = homedir()) {
  const standard = join(home, '.claude');
  const listed = Array.isArray(settings.claudeDirs) ? settings.claudeDirs.filter(dir => typeof dir === 'string' && dir.trim()) : [];
  const dirs = listed.length ? listed : [process.env.CLAUDE_CONFIG_DIR || standard];
  return [...new Set(dirs.map(dir => resolve(dir.trim().replace(/^~(?=\/|$)/, home))))].map(dir => ({
    dir, label: dir === standard ? '' : basename(dir).replace(/^\./, '').replace(/^claude[-_.]?/i, '') || basename(dirname(dir)).replace(/^\./, ''),
    sessionsDir: join(dir, 'sessions'), projectsDir: join(dir, 'projects'),
  }));
}

// This machine's Tailscale IPv4 and MagicDNS name, or null when Tailscale is missing or stopped.
export function tailscaleSelf() {
  try {
    const status = JSON.parse(execFileSync('tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }));
    const ip = status.Self?.TailscaleIPs?.find(address => address.includes('.'));
    return status.BackendState === 'Running' && ip ? { ip, hostname: status.Self.DNSName?.replace(/\.$/, '') || ip } : null;
  } catch { return null; }
}

export function checkCert(pem, hostname) {
  const cert = new X509Certificate(pem);
  if (!cert.checkHost(hostname) || Date.parse(cert.validTo) <= Date.now() || Date.parse(cert.validFrom) > Date.now()) throw new Error(`The HTTPS certificate is expired or not for ${hostname}. Renew it with tailscale cert, or run npm run setup.`);
}

export function isTailscaleIP(ip) {
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every(p => Number.isInteger(p) && p >= 0 && p <= 255) && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}
