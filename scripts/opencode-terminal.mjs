import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSettings } from '../server/config.mjs';
import { OpenCodeClient, openCodeConfig } from '../server/opencode.mjs';
import { OpenCodeAPI } from '../server/opencode-api.mjs';

// Read credentials inside the new pane; never type them into shell history or tmux's command line.
export function terminalLaunch(config, sessionId, v2 = true, cwd = process.cwd(), inherited = process.env) {
  if (!/^ses[\w-]+$/.test(sessionId || '')) throw new Error('Invalid OpenCode session ID.');
  if (!config) throw new Error('Connect OpenCode with npm run setup first.');
  if (config.service) return { args: ['--session', sessionId], env: { ...inherited } };
  const env = { ...inherited, OPENCODE_PASSWORD: config.password, OPENCODE_SERVER_PASSWORD: config.password, OPENCODE_SERVER_USERNAME: config.username };
  return { args: v2 ? ['--server', config.url, '--session', sessionId] : ['attach', config.url, '--session', sessionId, '--dir', cwd], env };
}

async function main() {
  const config = openCodeConfig(readSettings().opencode);
  let v2 = true;
  if (config && !config.service) { const api = new OpenCodeAPI(new OpenCodeClient(config)); await api.detect(); v2 = api.v2; }
  const { args, env } = terminalLaunch(config, process.argv[2], v2);
  await new Promise((resolve, reject) => {
    const child = spawn('opencode', args, { env, stdio: 'inherit' });
    const stop = () => child.kill('SIGTERM'); process.once('SIGTERM', stop);
    child.once('error', () => reject(new Error('Could not start opencode. Check that it is installed in your terminal PATH.')));
    child.once('close', code => { process.removeListener('SIGTERM', stop); process.exitCode = code || 0; resolve(); });
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main().catch(error => { console.error(error.message); process.exitCode = 1; });
