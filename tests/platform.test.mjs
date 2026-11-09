import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { processInfo, processMatches, processCommand, parentPid, listProcesses, claudeProcess } from '../server/processes.mjs';
import { portInUse } from '../server/network.mjs';
import { tailscaleSelf } from '../server/config.mjs';

const start = 'Fri Oct  9 08:04:02 2026';
const mac = (output = `  100 S+ ${start} /opt/homebrew/bin/claude\n`) => ({ platform: 'darwin', exec: async (file, args, options) => {
  assert.equal(file, 'ps'); assert.equal(options.env.LC_ALL, 'C'); assert.equal(options.env.TZ, 'UTC');
  assert.ok(args.includes('-ww'));
  return { stdout: output };
} });

test('macOS process identity preserves Claude start tokens and rejects reused PIDs and zombies', async () => {
  assert.deepEqual(await processInfo(123, mac()), { pid: 123, ppid: 100, state: 'S+', start, name: 'claude' });
  assert.equal(await processMatches(123, start, mac()), true);
  assert.equal(await processMatches(123, 'old start', mac()), false);
  assert.equal(await processMatches(123, start, mac(`100 Z ${start} claude`)), false);
  assert.equal(await processMatches(123, start, mac('')), false);
  assert.equal(await processMatches(123, start, { platform: 'darwin', exec: async () => { throw new Error('gone'); } }), false);
  for (const pid of [0, -1, '123', NaN, 1.5]) assert.equal(await processMatches(pid, start, { exec: () => assert.fail('invalid PID reached ps') }), false);
  assert.equal(await parentPid(123, mac()), 100);
});

test('Linux process identity handles parentheses in names and keeps boot ticks', async () => {
  const fields = ['S', '100', ...Array(17).fill('0'), '56789'];
  const options = { platform: 'linux', read: async () => `123 (a name (with) parens) ${fields.join(' ')}` };
  assert.deepEqual(await processInfo(123, options), { pid: 123, ppid: 100, state: 'S', start: '56789', name: 'a name (with) parens' });
  assert.equal(await processMatches(123, '56789', options), true);
  assert.equal(await processMatches(123, 'old', options), false);
});

test('macOS commands and process trees retain full paths and arguments', async () => {
  const command = '/opt/homebrew/bin/node --watch-path /Users/test/My App/server /Users/test/My App/scripts/server.mjs';
  assert.equal(await processCommand(123, mac(command + '\n')), command);
  assert.deepEqual(await listProcesses({ platform: 'darwin', exec: async (_file, args) => {
    assert.ok(args.includes('-axww'));
    return { stdout: ` 123 100 ${command}\n 124 123 /bin/zsh -c sleep 5\n` };
  } }), [{ pid: 123, ppid: 100, args: command }, { pid: 124, ppid: 123, args: '/bin/zsh -c sleep 5' }]);
});

test('hooks find native and npm Claude owners through command shells', async () => {
  const info = async pid => ({ pid, ppid: pid - 1, name: pid === 20 ? 'zsh' : 'claude', state: 'S', start });
  assert.deepEqual(await claudeProcess(20, { info, command: async () => '/bin/zsh -c node scripts/claude-hook.mjs' }), { pid: 19, procStart: start });
  assert.deepEqual(await claudeProcess(20, { info: async pid => ({ ...await info(pid), name: 'node' }), command: async () => '/opt/homebrew/bin/node /opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js' }), { pid: 20, procStart: start });
  assert.deepEqual(await claudeProcess(20, { info: async () => null }), { pid: 0 });
  assert.deepEqual(await claudeProcess(20, { info: async pid => ({ ...await info(pid), name: 'zsh' }), command: async () => '/bin/zsh -c claude' }), { pid: 0 });
});

test('native process inspection recognizes this process and its command on Linux and macOS', async () => {
  const info = await processInfo(process.pid);
  assert.equal(info.ppid, process.ppid);
  assert.equal(await processMatches(process.pid, info.start), true);
  assert.equal(await processMatches(process.pid, 'stale'), false);
  assert.match(await processCommand(process.pid), /node/);
  assert.ok((await listProcesses()).some(row => row.pid === process.pid && row.ppid === process.ppid));
});

test('macOS port checks find real IPv4 and IPv6 loopback listeners without lsof', async () => {
  const options = { platform: 'darwin', host: '127.0.0.2', exec: () => assert.fail('macOS must not invoke lsof') };
  for (const host of ['127.0.0.1', '::1']) {
    const server = createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); });
    const { port } = server.address();
    try { assert.equal(await portInUse(port, options), true, host); }
    finally { await new Promise(resolve => server.close(resolve)); }
    assert.equal(await portInUse(port, options), false, host);
  }
});

test('macOS port checks include the configured server address', async () => {
  const { EventEmitter } = await import('node:events');
  const connect = ({ host }) => {
    const socket = new EventEmitter(); socket.setTimeout = () => socket; socket.destroy = () => socket;
    queueMicrotask(() => host === '100.64.0.8' ? socket.emit('connect') : socket.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })));
    return socket;
  };
  assert.equal(await portInUse(47841, { platform: 'darwin', host: '100.64.0.8', connect }), true);
});

test('macOS port checks surface unexpected connection errors and timeouts', async () => {
  const { EventEmitter } = await import('node:events');
  const failing = code => () => {
    const socket = new EventEmitter(); socket.setTimeout = () => socket; socket.destroy = () => socket;
    queueMicrotask(() => socket.emit(code === 'ETIMEDOUT' ? 'timeout' : 'error', Object.assign(new Error(code), { code })));
    return socket;
  };
  await assert.rejects(portInUse(47841, { platform: 'darwin', connect: failing('EACCES') }), /EACCES/);
  await assert.rejects(portInUse(47841, { platform: 'darwin', connect: failing('ETIMEDOUT') }), /timed out/i);
});

test('Linux port checks inspect listeners on all interfaces and report errors', async () => {
  assert.equal(await portInUse(47841, { platform: 'linux', exec: () => 'LISTEN 0 128 [::1]:47841 [::]:*' }), true);
  await assert.rejects(portInUse(47841, { platform: 'linux', exec: () => { throw new Error('inspection failed'); } }), /inspection failed/);
});

test('native port check sees a real listener and releases it after close', async () => {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  try { assert.equal(await portInUse(port), true); }
  finally { await new Promise(resolve => server.close(resolve)); }
  assert.equal(await portInUse(port), false);
});

test('macOS ps flags also work against real ps without truncating arguments', async () => {
  const exec = promisify(execFile);
  const info = await processInfo(process.pid, { platform: 'darwin', exec });
  assert.equal(info.ppid, process.ppid);
  assert.equal(await parentPid(process.pid, { platform: 'darwin', exec }), process.ppid);
  assert.match(await processCommand(process.pid, { platform: 'darwin', exec }), /node/);
});

test('Tailscale uses the Mac app when the CLI is missing and forces CLI mode', () => {
  const calls = [], status = JSON.stringify({ BackendState: 'Running', Self: { TailscaleIPs: ['fd7a::1', '100.64.1.2'], DNSName: 'test.example.ts.net.' } });
  const result = tailscaleSelf({ platform: 'darwin', home: '/Users/test', exec: (command, args, options) => {
    calls.push(command); assert.deepEqual(args, ['status', '--json']); assert.equal(options.env.TAILSCALE_BE_CLI, '1');
    if (command === 'tailscale') throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return status;
  } });
  assert.deepEqual(calls, ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']);
  assert.equal(result.ip, '100.64.1.2'); assert.equal(result.hostname, 'test.example.ts.net');
  assert.equal(result.command, calls[1]);
  assert.equal(tailscaleSelf({ exec: () => '{"BackendState":"Stopped"}' }), null);
  assert.equal(tailscaleSelf({ exec: () => { throw new Error('unavailable'); } }), null);
});
