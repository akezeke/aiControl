import test from 'node:test';
import assert from 'node:assert/strict';
import { officeStatus, identity, isTypingTarget, monitorLines, tiredness, FRUITS } from '../client/office/status.js';

test('every status maps to a pose', () => {
  const want = { working: 'typing', permission: 'waving', question: 'raising', idle: 'sleeping', error: 'slumped', offline: 'still', unknown: 'still' };
  for (const [status, pose] of Object.entries(want)) assert.equal(officeStatus({ status, requests: [] }).pose, pose);
});
test('waiting sessions get highlighted bubbles from their request', () => {
  const b = officeStatus({ status: 'permission', requests: [{ title: 'Run npm test' }] }).bubble;
  assert.deepEqual(b, { icon: '✋', text: 'Run npm test', highlight: true });
});
test('bubble text is one line, max 48 chars', () => {
  const b = officeStatus({ status: 'question', requests: [{ title: `${'x'.repeat(60)}\nsecond line` }] }).bubble;
  assert.equal(b.text.length, 48);
  assert.ok(b.text.endsWith('…') && !b.text.includes('\n'));
});
test('subagents only talk while working', () => {
  assert.equal(officeStatus({ status: 'idle', parentId: 'p', requests: [] }).bubble, null);
  assert.ok(officeStatus({ status: 'working', parentId: 'p', requests: [] }).bubble);
});
test('identity is deterministic and varied', () => {
  assert.deepEqual(identity('claude:abc'), identity('claude:abc'));
  const fruits = new Set(Array.from({ length: 50 }, (_, i) => identity(`s${i}`).fruit));
  assert.ok(fruits.size >= 5 && [...fruits].every(f => FRUITS.includes(f)));
});
test('typing targets are recognized', () => {
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA', closest: () => null }), true);
  assert.equal(isTypingTarget({ tagName: 'CANVAS', isContentEditable: false, closest: () => null }), false);
});
test('monitor shows the title and the last lines, one line each, marked by kind', () => {
  const messages = [{ role: 'user', text: 'old' }, ...Array.from({ length: 6 }, (_, i) => ({ role: 'assistant', text: `**step ${i}**\nmore` })), { role: 'assistant', text: 'Bash · npm test', tool: true }, { role: 'user', text: 'ship it' }];
  const m = monitorLines({ title: 'Fix login', messages });
  assert.equal(m.title, 'Fix login');
  assert.equal(m.lines.length, 6);
  assert.deepEqual(m.lines.at(-1), { kind: 'user', text: 'ship it' });
  assert.deepEqual(m.lines.at(-2), { kind: 'tool', text: 'Bash · npm test' });
  assert.equal(m.lines[0].text, 'step 2');
  assert.deepEqual(monitorLines({ project: 'x' }), { title: 'x', lines: [] });
});
test('a subagent that needs you speaks up', () => {
  assert.equal(officeStatus({ status: 'permission', parentId: 'p', requests: [{ title: 'Run it' }] }).bubble?.highlight, true);
});
test('a working session that is thinking gets its own pose and bubble', () => {
  const s = officeStatus({ status: 'working', activity: 'thinking', detail: 'Read', requests: [] });
  assert.deepEqual([s.pose, s.expression, s.bubble.text], ['thinking', 'thinking', 'Thinking']);
  assert.equal(officeStatus({ status: 'idle', activity: 'thinking', requests: [] }).pose, 'sleeping');
});
test('a session compacting its context says so', () => {
  const s = officeStatus({ status: 'working', activity: 'compacting', detail: 'Compacting context', requests: [] });
  assert.deepEqual([s.pose, s.expression, s.bubble.icon, s.bubble.text], ['squeezing', 'squeezed', '🗜️', 'Compacting']);
});
test('wear follows context fill and long turns; cups follow the turn', () => {
  const now = 1_000_000_000, at = minutes => now - minutes * 60_000;
  const turn = (minutes, extra = {}) => tiredness({ status: 'working', messages: [{ role: 'user', text: 'go', timestamp: at(minutes) }, { role: 'assistant', text: 'ok', timestamp: at(0) }], ...extra }, now);
  assert.deepEqual(turn(1), { wear: 0, cups: 0 });
  assert.deepEqual(turn(25), { wear: 0.1, cups: 3 });
  assert.equal(turn(200).cups, 6);
  assert.equal(turn(1, { context: { used: 70_000 } }).wear, 0, 'what a compaction leaves is fresh');
  assert.equal(turn(1, { context: { used: 150_000 } }).wear, 0.8);
  assert.equal(turn(1, { context: { used: 300_000 } }).wear, 0, 'past 200k the window must be 1M');
  assert.equal(turn(1, { context: { used: 90_000, window: 100_000 } }).wear, 1);
  // Idle: the turn ended with its last message, so the cups stay but stop piling up.
  const idle = { status: 'idle', messages: [{ role: 'user', text: 'go', timestamp: at(60) }, { role: 'assistant', text: 'done', timestamp: at(48) }] };
  assert.equal(tiredness(idle, now).cups, 2);
});
test('desk props come from a wider set', () => {
  const props = new Set(Array.from({ length: 80 }, (_, i) => identity(`s${i}`).props).flat());
  assert.ok(['frame', 'cactus', 'books'].some(prop => props.has(prop)));
});

test('a working bubble shows the running call, its icon following the tool', () => {
  const at = detail => { const b = officeStatus({ status: 'working', detail, requests: [] }).bubble; return [b.icon, b.text]; };
  assert.deepEqual(at('Bash · Type-check after the route change'), ['⌨️', 'Bash · Type-check after the route change']);
  assert.deepEqual(at('Shell (exit 1) · npm test'), ['⌨️', 'Shell (exit 1) · npm test']);
  assert.deepEqual(['Edit · office/room.js', 'Write · a.md', 'MultiEdit · b.js', 'Read · c.js', 'Grep · todo', 'Glob · **/*.js', 'Search · three.js', 'WebSearch · q', 'WebFetch · https://x.dev', 'Agent · Explore the office code', 'Task · Plan it'].map(d => at(d)[0]),
    ['✏️', '✏️', '✏️', '📖', '🔍', '🔍', '🔍', '🔍', '🌐', '👥', '👥']);
  assert.deepEqual(at(''), ['⌨️', 'Working']);
});

test('a session asking in its reply raises its hand with the question', () => {
  const b = officeStatus({ status: 'question', asks: 'Shall I commit it?', requests: [] });
  assert.deepEqual([b.pose, b.bubble.icon, b.bubble.text], ['raising', '❓', 'Shall I commit it?']);
});
