import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fail } from './requests.mjs';

export function claudeModelOptions(models) {
  if (!Array.isArray(models)) throw fail('Claude did not return a model catalog.', 503);
  return models.filter(model => typeof model.value === 'string').map(model => ({ id: model.value, resolvedModel: model.resolvedModel,
    name: model.displayName || model.value, efforts: model.supportsEffort ? model.supportedEffortLevels || [] : [] }));
}

const cache = new Map();
// Initialization supplies account/model capabilities without a prompt or inference. Not --bare: it skips the login and the
// account's catalog, leaving a stale built-in list (e.g. no new Fable). Hooks and MCP stay off so no phantom session registers.
// The native installer's ~/.local/bin is often missing from the server's PATH when an agent shell started it.
export function claudeModels(cwd, configDir, { launch = spawn, now = Date.now } = {}) {
  const key = JSON.stringify([cwd, configDir]), cached = cache.get(key);
  if (cached && now() - cached.at < 60_000) return cached.promise;
  const promise = new Promise((resolve, reject) => {
    const child = launch('claude', ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}'],
      { cwd, env: { ...process.env, PATH: [process.env.PATH, join(homedir(), '.local/bin')].filter(Boolean).join(delimiter), ...configDir ? { CLAUDE_CONFIG_DIR: configDir } : {} }, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); child.stdin.end(); child.kill('SIGTERM'); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(fail('Claude model discovery timed out. Try again.', 503)), 15_000); timer.unref?.();
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('error', () => finish(fail('Could not load Claude models. Check that Claude Code is installed.', 503)));
    child.on('close', () => finish(fail('Claude closed before returning its model catalog.', 503)));
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 2_000_000) { finish(fail('Claude returned an oversized model catalog.', 503)); return; }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.type !== 'control_response' || message.response?.request_id !== 'models') continue;
        try { finish(null, claudeModelOptions(message.response?.response?.models)); } catch (error) { finish(error); }
      }
    });
    child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } }) + '\n');
  });
  cache.set(key, { at: now(), promise }); promise.catch(() => cache.delete(key));
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return promise;
}
