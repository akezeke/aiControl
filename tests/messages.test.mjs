import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir, symlink, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeMeta, claudeMessages, codexMessage, messageLimit, TranscriptReader, claudeTitles, claudeSessionTitle } from '../server/messages.mjs';

const sessionId = '11111111-2222-3333-4444-555555555555';
const row = (id, type, content, extra = {}) => JSON.stringify({ uuid: id, sessionId, type, timestamp: '2026-10-25T12:00:00Z', message: { role: type, content }, ...extra });

test('recent Claude messages include visible text only, bounded to the limit', () => {
  const lines = Array.from({ length: messageLimit + 3 }, (_, i) => row(String(i), i % 2 ? 'assistant' : 'user', `Visible ${i}`));
  lines.push(row('tool', 'user', [{ type: 'tool_result', content: 'secret tool result' }]));
  lines.push(row('thought', 'assistant', [{ type: 'thinking', thinking: 'private thought' }]));
  lines.push(row('meta', 'user', 'internal context', { isMeta: true }));
  lines.push(row('subagent', 'assistant', 'another session', { isSidechain: true }));
  lines.push(row('foreign', 'assistant', 'another session', { sessionId: 'other' }));
  const messages = claudeMessages(lines, sessionId);
  assert.deepEqual(messages.map(m => m.text), Array.from({ length: messageLimit }, (_, i) => `Visible ${i + 3}`));
  assert.equal(codexMessage({ item: { type: 'reasoning', content: ['private'] } }), null);
  // Tool calls are one line each; their output never reaches the dashboard.
  assert.equal(JSON.stringify(codexMessage({ item: { type: 'commandExecution', id: 'c', aggregatedOutput: 'output' } })).includes('output'), false);
  assert.equal(codexMessage({ item: { type: 'userMessage', id: 'u', content: [{ type: 'text', text: 'Visible' }, { type: 'image', url: 'private' }] } }).text, 'Visible');
});

test('Claude harness rows are notices, not user prompts', () => {
  const messages = claudeMessages([
    row('typed', 'user', 'Fix it\n<pasted_content id="ab">log</pasted_content>', { origin: { kind: 'human' } }),
    row('done', 'user', '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n<summary>Agent "Fix shadows" finished</summary>\n<result>Long report</result>\n</task-notification>', { origin: { kind: 'task-notification' } }),
    row('clear', 'user', '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>'),
    row('out', 'user', '<local-command-stdout>Set model</local-command-stdout>'),
    row('summary', 'user', 'This session is being continued from a previous conversation…', { isCompactSummary: true }),
    row('stop', 'user', [{ type: 'text', text: '[Request interrupted by user]' }]),
  ], sessionId);
  assert.deepEqual(messages.map(m => [m.role, m.text]), [['user', 'Fix it\nlog'], ['notice', 'Agent "Fix shadows" finished'], ['user', '/model opus'], ['notice', 'Context compacted'], ['notice', 'Interrupted']]);
});

test('Claude titles prefer user names, then the latest generated title over a derived name', () => {
  const titles = claudeTitles([
    JSON.stringify({ type: 'ai-title', sessionId, aiTitle: 'Earlier title' }),
    JSON.stringify({ type: 'ai-title', sessionId: 'other', aiTitle: 'Foreign title' }),
    JSON.stringify({ type: 'ai-title', sessionId, aiTitle: '  Improve tank\ntextures  ' }),
    JSON.stringify({ type: 'custom-title', sessionId, customTitle: 'My work' }),
  ], sessionId);
  const record = { name: 'tankgame-07', nameSource: 'derived' };
  assert.equal(claudeSessionTitle(record, titles), 'My work');
  const cleared = claudeTitles([JSON.stringify({ type: 'custom-title', sessionId, customTitle: '' })], sessionId, titles);
  assert.equal(claudeSessionTitle(record, cleared), 'Improve tank textures');
  assert.equal(claudeSessionTitle({ name: 'Personal title', nameSource: 'user' }, cleared), 'Personal title');
  assert.equal(claudeSessionTitle(record, {}), 'tankgame-07');
});

test('bounded history finds a title at the start and keeps later title updates', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'aicontrol-title-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, `${sessionId}.jsonl`), reader = new TranscriptReader(dir);
  const title = value => JSON.stringify({ type: 'ai-title', sessionId, aiTitle: value }) + '\n';
  const recent = Array.from({ length: 6 }, (_, i) => row(String(i), 'user', 'Message')).join('\n') + '\n';
  await writeFile(path, title('Original title') + JSON.stringify({ type: 'progress', data: 'x'.repeat(300000) }) + '\n' + recent);
  assert.equal((await reader.read(path, sessionId)).aiTitle, 'Original title');
  await appendFile(path, title('Updated title'));
  assert.equal((await reader.read(path, sessionId)).aiTitle, 'Updated title');
  await appendFile(path, JSON.stringify({ type: 'progress', data: 'x'.repeat(300000) }) + '\n' + recent);
  assert.equal((await reader.read(path, sessionId)).aiTitle, 'Updated title');
});

test('only dashboard-submitted Claude inbox messages are included when marked as metadata', () => {
  const lines = [row('sent', 'user', 'My dashboard message', { isMeta: true }), row('internal', 'user', 'Internal context', { isMeta: true })];
  assert.deepEqual(claudeMessages(lines, sessionId, new Set(['sent'])).map(message => message.text), ['My dashboard message']);
});

test('transcript reader handles partial lines, cache updates and rejects escaped paths', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'aicontrol-messages-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const projects = join(dir, 'projects'); await mkdir(projects);
  const path = join(projects, `${sessionId}.jsonl`), reader = new TranscriptReader(projects);
  await writeFile(path, 'partial line\n' + row('one', 'user', 'Hello') + '\n');
  assert.deepEqual((await reader.read(path, sessionId)).messages.map(m => m.text), ['Hello']);
  await appendFile(path, row('two', 'assistant', [{ type: 'text', text: 'Reply' }]) + '\n');
  assert.deepEqual((await reader.read(path, sessionId)).messages.map(m => m.text), ['Hello', 'Reply']);
  const outside = join(dir, `${sessionId}.jsonl`); await writeFile(outside, row('private', 'user', 'outside'));
  assert.equal((await reader.read(outside, sessionId)).messagesState, 'unavailable');
  await rm(path); await symlink(outside, path);
  assert.equal((await reader.read(path, sessionId)).messagesState, 'unavailable');
  assert.equal((await reader.read(outside, '../../etc/passwd')).messagesState, 'unavailable');
});

test('subagent transcripts include sidechain text and one line per tool call, and report activity', async () => {
  const { agentActivity } = await import('../server/messages.mjs');
  const sessionId = '11111111-2222-3333-4444-555555555555';
  const row = (uuid, type, content) => JSON.stringify({ uuid, type, sessionId, isSidechain: true, timestamp: '2026-10-27T09:00:00Z', message: { role: type, content } });
  const lines = [
    row('a', 'user', 'Fix the theme'),
    row('b', 'assistant', [{ type: 'text', text: 'Looking at the CSS.' }]),
    row('c', 'assistant', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm   test\n--watch' } }]),
  ];
  assert.deepEqual(claudeMessages(lines, sessionId), []);
  const messages = claudeMessages(lines, sessionId, new Set(), { agent: true });
  assert.deepEqual(messages.map(m => [m.role, m.text, !!m.tool]), [['user', 'Fix the theme', false], ['assistant', 'Looking at the CSS.', false], ['assistant', 'Bash · npm test --watch', true]]);
  assert.equal(agentActivity(lines), 'tool');
  assert.equal(agentActivity([...lines, row('d', 'user', [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]), row('e', 'assistant', [{ type: 'text', text: 'Done.' }])]), 'reply');
});

test('workflow workers show their task without the harness preface, and tool calls by description', async t => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const sessionId = '11111111-2222-3333-4444-555555555555';
  const root = await mkdtemp(join(tmpdir(), 'aicontrol-agent-')); t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'project', sessionId, 'subagents', 'workflows', 'wf_1');
  await mkdir(dir, { recursive: true });
  const row = (uuid, type, content) => JSON.stringify({ uuid, type, sessionId, isSidechain: true, timestamp: '2026-10-27T09:00:00Z', message: { role: type, content } });
  const task = '[Workflow harness — computed task] Preface that is not the task:\n  Fix the roof.\n    - keep indents';
  const lines = [row('task', 'user', task), ...Array.from({ length: 40 }, (_, i) => row(`t${i}`, 'assistant', [{ type: 'tool_use', id: `x${i}`, name: 'Bash', input: { command: `make step-${i}`, description: `Step ${i}` } }]))];
  lines.push(row('edit', 'assistant', [{ type: 'tool_use', id: 'e', name: 'Edit', input: { file_path: '/home/u/repo/src/roof.ts' } }]));
  await writeFile(join(dir, 'agent-abc123.jsonl'), lines.join('\n') + '\n');
  const { messages } = await new TranscriptReader(root).read(join(dir, 'agent-abc123.jsonl'), sessionId, 'abc123');
  assert.equal(messages.length, 30);
  assert.equal(messages[0].text, 'Fix the roof.\n  - keep indents');
  assert.equal(messages.at(-2).text, 'Bash · Step 39');
  assert.equal(messages.at(-2).detail, 'make step-39');
  assert.equal(messages.at(-1).text, 'Edit · src/roof.ts');
  assert.equal(messages.at(-1).detail, '/home/u/repo/src/roof.ts');
});

test('Codex tool items, notices and failures become one-line entries', () => {
  const line = item => { const m = codexMessage({ item: { id: 'i', ...item } }); return m && [m.role, m.text, !!m.tool, !!m.failed]; };
  assert.deepEqual(line({ type: 'commandExecution', command: 'npm test', exitCode: 1, status: 'failed', aggregatedOutput: 'boom' }), ['assistant', 'Shell (exit 1) · npm test', true, true]);
  assert.deepEqual(line({ type: 'fileChange', status: 'completed', changes: [{ path: '/w/src/a.ts' }, { path: '/w/b.ts' }] }), ['assistant', 'Edit · src/a.ts, w/b.ts', true, false]);
  assert.deepEqual(line({ type: 'mcpToolCall', server: 'docs', tool: 'search', status: 'completed' }), ['assistant', 'docs/search', true, false]);
  assert.deepEqual(line({ type: 'webSearch', query: 'tmux paste' }), ['assistant', 'Search · tmux paste', true, false]);
  assert.deepEqual(line({ type: 'contextCompaction' }), ['notice', 'Context compacted', false, false]);
  assert.deepEqual(line({ type: 'exitedReviewMode', review: 'Two bugs found.' }), ['assistant', 'Two bugs found.', false, false]);
  assert.equal(line({ type: 'reasoning', summary: ['x'] }), null);
});

test('main Claude sessions show tool lines, failed calls, API errors and harness notices', () => {
  const lines = [
    row('u1', 'user', 'Run the tests'),
    row('a1', 'assistant', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test', description: 'Run tests' } }]),
    row('r1', 'user', [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: 'secret failure output' }]),
    row('e1', 'assistant', 'API Error: 529 overloaded', { isApiErrorMessage: true }),
    JSON.stringify({ type: 'system', subtype: 'informational', content: 'Usage limit reached · continuing at 3pm', level: 'notice', uuid: 's1', sessionId, timestamp: new Date().toISOString() }),
    JSON.stringify({ type: 'system', subtype: 'turn_duration', durationMs: 5000, uuid: 's2', sessionId }),
    row('u2', 'user', [{ type: 'image', source: {} }, { type: 'text', text: 'Look' }]),
  ];
  const messages = claudeMessages(lines, sessionId);
  assert.deepEqual(messages.map(m => [m.role, m.text, !!m.tool, !!m.failed, !!m.error]), [
    ['user', 'Run the tests', false, false, false],
    ['assistant', 'Bash · Run tests', true, true, false],
    ['notice', 'API Error: 529 overloaded', false, false, true],
    ['notice', 'Usage limit reached · continuing at 3pm', false, false, false],
    ['user', '[image] Look', false, false, false],
  ]);
  assert.equal(JSON.stringify(messages).includes('secret failure output'), false);
});

test('Claude session facts come from the newest transcript records', () => {
  const meta = claudeMeta([
    JSON.stringify({ type: 'user', sessionId, gitBranch: 'main', permissionMode: 'plan', message: { content: 'x' } }),
    JSON.stringify({ type: 'assistant', sessionId, effort: 'xhigh', message: { model: 'claude-opus-5-5', usage: { input_tokens: 2, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }, { content: 'C', status: 'pending' }] } }] } }),
    JSON.stringify({ type: 'assistant', sessionId, message: { model: '<synthetic>', content: [] } }),
    JSON.stringify({ type: 'queue-operation', sessionId, operation: 'enqueue', content: 'first', timestamp: 't1' }),
    JSON.stringify({ type: 'queue-operation', sessionId, operation: 'enqueue', content: '<task-notification>x</task-notification>', timestamp: 't2' }),
    JSON.stringify({ type: 'queue-operation', sessionId, operation: 'enqueue', content: 'second', timestamp: 't3' }),
    JSON.stringify({ type: 'queue-operation', sessionId, operation: 'dequeue', timestamp: 't4' }),
  ], sessionId);
  assert.equal(meta.model, 'claude-opus-5-5');
  assert.equal(meta.effort, 'xhigh');
  assert.equal(meta.branch, 'main');
  assert.equal(meta.permissionMode, 'plan');
  assert.deepEqual(meta.context, { used: 1017 });
  assert.deepEqual(meta.plan.map(step => step.status), ['done', 'active', 'pending']);
  assert.deepEqual(meta.queuedMessages.map(entry => entry.text), ['second']);
});
