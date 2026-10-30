import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Claude namespaces Keychain logins by CLAUDE_CONFIG_DIR (SHA-256, first eight hex characters).
// Never fall back to the default account's Keychain entry for a different config folder.
export async function claudeCredentials(credentialsFile, { platform = process.platform, home = homedir(), configuredDir = process.env.CLAUDE_CONFIG_DIR, user = process.env.USER || userInfo().username, read = readFile, exec = run } = {}) {
  if (platform === 'darwin') {
    const dir = resolve(dirname(credentialsFile)).normalize('NFC');
    const custom = dir !== join(home, '.claude').normalize('NFC') || (configuredDir && resolve(configuredDir).normalize('NFC') === dir);
    const service = 'Claude Code-credentials' + (custom ? '-' + createHash('sha256').update(dir).digest('hex').slice(0, 8) : '');
    try {
      const { stdout } = await exec('/usr/bin/security', ['find-generic-password', '-a', /^[a-zA-Z0-9._-]+$/.test(user) ? user : 'claude-code-user', '-w', '-s', service], { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
      const credentials = JSON.parse(stdout);
      if (credentials?.claudeAiOauth) return credentials;
    } catch { /* Claude also uses a file when the Keychain is unavailable. Never surface command output. */ }
  }
  return JSON.parse(await read(credentialsFile, 'utf8'));
}
