import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ClaudeAdapter } from '../server/claude.mjs';
import { RequestStore } from '../server/requests.mjs';

class HookSocket extends EventEmitter {
  output = []; destroyed = false;
  setTimeout() {}
  write(data, callback) { this.output.push(JSON.parse(data)); callback?.(); }
  end(data) { if (data) this.write(data); this.destroy(); }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } }
}

test('Claude request lifecycle routes answers and removes cancelled prompts', async t => {
  const store = new RequestStore();
  const adapter = new ClaudeAdapter(store, '/unused.sock', { sessionsDir: '/does-not-exist', alive: async () => true });
  const socket = new HookSocket(); t.after(() => socket.destroy()); adapter.accept(socket);
  socket.emit('data', Buffer.from(JSON.stringify({ pid: 1, event: { session_id: 'test-session', cwd: '/work/project', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test' } } }) + '\n'));
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].sessionId, 'claude:test-session');
  await store.respond(store.list()[0].id, { decision: 'decline' });
  assert.equal(socket.output[0].hookSpecificOutput.decision.behavior, 'deny');
  assert.equal(store.list().length, 0);
  const cancelled = new HookSocket(); t.after(() => cancelled.destroy()); adapter.accept(cancelled);
  cancelled.emit('data', Buffer.from(JSON.stringify({ pid: 1, event: { session_id: 'test-session', cwd: '/work/project', hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Where?', options: [{ label: 'Here' }] }] } } }) + '\n'));
  const id = store.list()[0].id;
  cancelled.destroy();
  await assert.rejects(store.respond(id, { answers: { 0: ['Here'] } }), e => e.status === 409);
});

test('malformed hook messages never create an actionable request', () => {
  const adapter = new ClaudeAdapter(new RequestStore(), '/unused.sock');
  const socket = new HookSocket(); adapter.accept(socket);
  socket.emit('data', Buffer.from('{"event":{"tool_name":"Bash"}}\n'));
  assert.equal(adapter.store.list().length, 0);
  assert.deepEqual(socket.output, [{}]);
});

test('a parallel tool completing does not clear unrelated Claude permissions', async t => {
  const store = new RequestStore();
  const adapter = new ClaudeAdapter(store, '/unused.sock', { sessionsDir: '/does-not-exist', alive: async () => true });
  const send = (hook_event_name, command) => {
    const socket = new HookSocket(); t.after(() => socket.destroy()); adapter.accept(socket);
    socket.emit('data', Buffer.from(JSON.stringify({ pid: 1, event: { session_id: 'parallel', cwd: '/work/project', hook_event_name, tool_name: 'Bash', tool_input: { command } } }) + '\n'));
    return socket;
  };
  send('PermissionRequest', 'npm test');
  send('PermissionRequest', 'npm run build');
  assert.equal(store.list().length, 2);
  send('PostToolUse', 'npm test');
  assert.equal(store.list().length, 1);
  assert.match(store.list()[0].details, /npm run build/);
  await store.respond(store.list()[0].id, { decision: 'accept' });
  assert.equal(store.list().length, 0);
});

test('a question answered in the terminal disappears here even though its input gained answers', t => {
  const store = new RequestStore();
  const adapter = new ClaudeAdapter(store, '/unused.sock', { sessionsDir: '/does-not-exist', alive: async () => true });
  const questions = [{ question: 'Where?', options: [{ label: 'Here' }] }];
  const send = (hook_event_name, tool_input) => {
    const socket = new HookSocket(); t.after(() => socket.destroy()); adapter.accept(socket);
    socket.emit('data', Buffer.from(JSON.stringify({ pid: 1, event: { session_id: 'race', cwd: '/w', hook_event_name, tool_name: 'AskUserQuestion', tool_input } }) + '\n'));
    return socket;
  };
  const waiting = send('PermissionRequest', { questions });
  assert.equal(store.list()[0].kind, 'question');
  send('PostToolUse', { questions, answers: { 'Where?': 'Here' } });
  assert.equal(store.list().length, 0);
  assert.deepEqual(waiting.output, [{}]);
});
