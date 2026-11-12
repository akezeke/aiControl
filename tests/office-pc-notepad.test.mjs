import test from 'node:test';
import assert from 'node:assert/strict';
import { TITLES, salariesText, createNotepad, draw } from '../client/office/pc-notepad.js';
import { useDom } from './fixtures/pc-dom.mjs';

const now = new Date(2026, 10, 12, 14, 32), at = now.getTime();
const SESSIONS = [
  { id: 's-alpha', project: 'aiControl', status: 'working', provider: 'claude' },
  { id: 's-helper', parentId: 's-alpha', project: 'aiControl', status: 'working', activity: 'thinking', provider: 'claude' },
  { id: 's-gamma', project: 'aiControl', status: 'permission', provider: 'codex', context: { used: 180_000, window: 200_000 },
    messages: [{ role: 'user', timestamp: at - 11 * 60_000 }, { role: 'assistant', timestamp: at }] },
  { id: 's-delta', project: 'a-very-long-project-name', status: 'idle', permissionMode: 'bypassPermissions', provider: 'codex' },
];
test('salaries.txt, exactly', () => assert.equal(salariesText(SESSIONS, now), [
  'SALARIES.TXT                                                CONFIDENTIAL',
  'Updated 14:32 by HR',
  '',
  'Name        Project           Title                               Salary  Notes',
  'Pear        a-very-long-pro…  VP of Semicolons                   $92,000  docked for napping, security clearance: none',
  'Watermelon  aiControl         Associate Rubber Duck              $83,000  asks too many questions, −2 coffees, overtime',
  'Kiwi        aiControl         Intern Emeritus                    $52,000  raise pending',
  'Kiwi        aiControl         Unpaid intern of Kiwi                   $0  paid to stare',
  'The Boss    Everything        Chief Executive Everything  $9,999,999,999  bonus approved',
].join('\n')));
test('Everyone fired', () => assert.equal(salariesText([], now), [
  'SALARIES.TXT                                        CONFIDENTIAL',
  'Updated 14:32 by HR',
  '',
  'Name      Project     Title                               Salary  Notes',
  'Everyone fired. Budget: balanced.',
  'The Boss  Everything  Chief Executive Everything  $9,999,999,999  bonus approved',
].join('\n')));
test('Codex and Claude give identical lines', () => {
  for (const s of SESSIONS) assert.equal(salariesText([{ ...s, provider: 'codex' }], now), salariesText([{ ...s, provider: 'claude' }], now));
});
test('stable per id: order does not matter', () => assert.equal(salariesText([...SESSIONS].reverse(), now), salariesText(SESSIONS, now)));
test('twelve titles', () => { assert.equal(TITLES.length, 12); assert.equal(TITLES[0], 'Senior Vibe Engineer'); assert.equal(TITLES[11], 'Intern Emeritus'); });
test('every status note', () => {
  const note = s => salariesText([{ id: 'x', project: 'p', ...s }], now).split('\n')[4].split(/\$[\d,]+ {2}/)[1];
  const table = [
    [{ status: 'working' }, 'raise pending'], [{ status: 'working', activity: 'thinking' }, 'paid to stare'],
    [{ status: 'working', activity: 'compacting' }, 'shredding old memos'], [{ status: 'idle', waitingOn: 'you' }, 'paid by the hour, sadly'],
    [{ status: 'permission' }, 'asks too many questions'], [{ status: 'question' }, 'asks too many questions'],
    [{ status: 'idle' }, 'docked for napping'], [{ status: 'error' }, 'under review by HR'], [{ status: 'bogus' }, undefined],
  ];
  for (const [s, want] of table) assert.equal(note(s), want, JSON.stringify(s));
});
test('one coffee', () => {
  const s = { id: 'x', project: 'p', status: 'idle', messages: [{ role: 'user', timestamp: at - 4 * 60_000 }, { role: 'assistant', timestamp: at }] };
  assert.match(salariesText([s], now), /docked for napping, −1 coffee$/m);
});
test('Save is denied and nothing is saved', t => {
  useDom(t); const calls = []; const p = createNotepad({ ui: { dialog: o => calls.push(o) } });
  p.open(SESSIONS, now); const before = p.node.value;
  const [file] = p.menus(); assert.equal(file.label, '&File'); assert.deepEqual(file.items.map(i => i.label), ['&Save', '&Close']);
  file.items[0].run();
  assert.deepEqual(calls, [{ icon: 'error', text: 'Access is denied. Only HR may change salaries.', buttons: ['OK'] }]);
  assert.equal(p.node.value, before); assert.equal(p.title(), 'salaries.txt - Notepad');
  let closed = 0; p.onClose(() => closed++); file.items[1].run(); assert.equal(closed, 1);
});
test('edits stop updates; opening again rebuilds', t => {
  useDom(t); const p = createNotepad({ ui: {} }); p.open(SESSIONS, now); const first = p.node.value; assert.equal(p.dirty(), false);
  p.node.dispatch('input'); assert.equal(p.dirty(), true);
  p.update([], now, true); assert.equal(p.node.value, first);
  p.open([], now); assert.equal(p.dirty(), false); assert.match(p.node.value, /Everyone fired/);
});
test('no rebuild while hidden; rebuilds while visible', t => {
  useDom(t); const p = createNotepad({ ui: {} }); p.open(SESSIONS, now); const first = p.node.value;
  p.update([], now, false); assert.equal(p.node.value, first);
  p.update([], now, true); assert.match(p.node.value, /Everyone fired/);
});
test('draw: white, the first lines that fit, in Courier Prime', t => {
  const doc = useDom(t); const g = doc.createElement('canvas').getContext('2d');
  draw(g, { x: 10, y: 20, w: 200, h: 49 }, { text: 'a\nb\nc\nd\ne' });
  const texts = g.calls.filter(c => c.name === 'fillText').map(c => c.args[0]); assert.deepEqual(texts, ['a', 'b', 'c']);
  assert.equal(g.calls[0].state.fillStyle, '#fff'); assert.match(g.calls.find(c => c.name === 'fillText').state.font, /Courier Prime/);
});

test('the textarea has Word Wrap off, so salaries.txt keeps its columns', t => {
  useDom(t); assert.equal(createNotepad().node.attributes.wrap, 'off');
});
