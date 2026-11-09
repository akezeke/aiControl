import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A permission request asked while AI Control restarts, or pending when it restarts, reaches the new server.
test('claude hook carries a permission request through a server restart', { timeout: 10_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hook-')), path = join(dir, 'ai-control-hooks.sock');
  const hook = spawn(process.execPath, ['scripts/claude-hook.mjs'], { env: { ...process.env, XDG_RUNTIME_DIR: dir } });
  let out = '';
  hook.stdout.on('data', chunk => out += chunk);
  const exited = new Promise(resolve => hook.once('exit', resolve));
  hook.stdin.end(JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: 's', cwd: '/' }));
  const listen = handler => new Promise(resolve => { const server = createServer(handler).listen(path, () => resolve(server)); });
  const received = server => Promise.race([new Promise(resolve => server.once('connection', socket => socket.once('data', () => resolve(socket)))),
    exited.then(() => { server.close(); throw new Error(`hook gave up: ${out}`); })]);
  try {
    await new Promise(resolve => setTimeout(resolve, 700)); // no server yet
    const first = await listen(() => {});
    (await received(first)).destroy(); // restarts mid-request
    await new Promise(resolve => first.close(resolve));
    await rm(path, { force: true });
    const second = await listen(() => {});
    const socket = await received(second);
    socket.end('{"answer":1}\n');
    await exited;
    second.close();
    assert.deepEqual(JSON.parse(out), { answer: 1 });
  } finally { hook.kill(); await rm(dir, { recursive: true, force: true }); }
});
