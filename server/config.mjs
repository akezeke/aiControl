import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const dataDir = join(root, '.local');
export const hookSocket = join(dataDir, 'hooks.sock');
export const authFile = join(dataDir, 'auth.json');
export const settingsFile = join(dataDir, 'config.json');
export const port = 47841;
export function prepareData() { mkdirSync(dataDir, { recursive: true, mode: 0o700 }); }

// { mode: 'tailscale' | 'local', cert?, key? }, written by scripts/setup.mjs.
export function readSettings() {
  try { return JSON.parse(readFileSync(settingsFile, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
}

// Claude Code config folders, one per account: $CLAUDE_CONFIG_DIR, ~/.claude and every ~/.claude-*
// holding settings.json or sessions/, such as ~/.claude-personal.
export function claudeDirs(home = homedir(), configured = process.env.CLAUDE_CONFIG_DIR) {
  const found = ['.claude', ...readdirSync(home).filter(name => name.startsWith('.claude-'))].map(name => join(home, name))
    .filter(dir => ['settings.json', 'sessions'].some(file => existsSync(join(dir, file))));
  const dirs = [configured, ...found].filter(Boolean);
  return [...new Set((dirs.length ? dirs : [join(home, '.claude')]).map(dir => resolve(dir)))];
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
