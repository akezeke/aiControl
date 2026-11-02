import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clipboardLines, copyText, createKitchenBoards, dailyLines, drawClipboard, drawScores, drawWhiteboard, usedUp } from '../client/office/boards.js';
import { challenges } from '../client/office/daily.js';
import { ITEMS, MONDAY } from '../client/office/levels.js';

test('the coffee machine runs empty while a usage window is used up, saying when each agent is back', () => {
  const now = new Date(2026, 9, 29, 12, 0).getTime(), at = minutes => now + minutes * 60_000;
  const usage = [
    { provider: 'claude', windows: [{ label: '5-hour', usedPercent: 100, resetsAt: at(150) }, { label: 'Weekly', usedPercent: 60, resetsAt: at(3000) }] },
    { provider: 'codex', windows: [{ label: '5-hour', usedPercent: 99, resetsAt: at(30) }] },
  ];
  assert.deepEqual(usedUp(usage, now), [{ provider: 'claude', back: 'back 14:30' }]);
  usage[1].windows.push({ label: 'Weekly', usedPercent: 100, resetsAt: at(2 * 1440) });
  assert.deepEqual(usedUp(usage, now)[1], { provider: 'codex', back: 'back in 2d' });
  assert.deepEqual(usedUp([{ provider: 'claude', windows: [{ label: '5-hour', usedPercent: 100, resetsAt: at(-1) }] }], now), [], 'a window past its reset is waiting on a refresh, not empty');
  assert.deepEqual(usedUp(undefined, now), []);
});

test('the whiteboard writes how long until each usage window resets', () => {
  const now = Date.now(), written = [];
  const g = new Proxy({}, { get: (target, key) => key === 'fillText' ? text => written.push(text) : key === 'measureText' ? text => ({ width: text.length }) : key in target ? target[key] : () => {}, set: (target, key, value) => { target[key] = value; return true; } });
  drawWhiteboard({ g, width: 1024, height: 512 }, [{ name: 'Claude', windows: [{ label: '5-hour', usedPercent: 40, resetsAt: now + 134 * 60_000 }, { label: 'Weekly', usedPercent: 20, resetsAt: now + 4 * 1440 * 60_000 }] }], [], '', now);
  assert.ok(written.includes('resets 2h 14m'), written.join());
  assert.ok(written.includes('resets 4d 0h'), written.join());
});

test('the whiteboard writes OpenCode\'s spend: its budget with a bar, or only its spend without one', () => {
  const now = Date.now(), account = budget => ({ provider: 'opencode', name: 'OpenCode', windows: [], periods: [{ id: 'today', usd: 2 }], week: { usd: 17.42 }, budget: { mode: 'weekly', ...budget, spent: 17.42, resetsAt: now + 2 * 86_400_000 } });
  const draw = budget => {
    const written = [], g = new Proxy({ strokes: 0 }, { get: (target, key) => key === 'fillText' ? text => written.push(text) : key === 'measureText' ? text => ({ width: text.length }) : key === 'strokeRect' ? () => { target.strokes++; } : key in target ? target[key] : () => {}, set: (target, key, value) => { target[key] = value; return true; } });
    drawWhiteboard({ g, width: 1024, height: 512 }, [account(budget)], [], '', now);
    return { written, bars: g.strokes };
  };
  const budgeted = draw({ usd: 25 }), bare = draw({});
  assert.deepEqual(budgeted.written.filter(text => text !== 'Usage'), ['OpenCode', 'wk', '70%', '≈$7.58 left']);
  assert.equal(budgeted.bars, 1);
  assert.deepEqual(bare.written.filter(text => text !== 'Usage'), ['OpenCode', 'wk', '≈$17.42', 'this week']);
  assert.equal(bare.bars, 0);
  assert.deepEqual(draw({ usd: 10 }).written.slice(-2), ['174%', 'over budget']);
});

// A canvas that keeps what's written on it.
const pad = () => {
  const written = [], g = new Proxy({ strokes: 0 }, { get: (target, key) => key === 'fillText' ? text => written.push(text) : key === 'measureText' ? text => ({ width: text.length }) : key === 'stroke' ? () => { target.strokes++; } : key in target ? target[key] : () => {}, set: (target, key, value) => { target[key] = value; return true; } });
  return { g, width: 600, height: 808, written };
};
const none = () => ({ lines: {}, best: {}, daily: {} }), DAY = '2026-10-31';

test('Monday\'s page lists three lines for each item, and crosses off the done ones', () => {
  const mug = MONDAY.find(e => e.id === 'mug'), at = MONDAY.indexOf(mug) * 4;
  assert.equal(clipboardLines(none()).length, MONDAY.length * 4);
  assert.ok(clipboardLines(none()).every(line => !line.done));
  const lines = clipboardLines({ ...none(), lines: { mug: { away: true, trick: false, score: true } } }), four = lines.slice(at, at + 4);
  assert.deepEqual(four, [
    { text: 'Mug', done: false, indent: 0 },
    { text: 'Put it away', done: true, indent: 1 },
    { text: 'Mug on the shelf, off the fridge', done: false, indent: 1 },
    { text: `Score ${mug.set}`, done: true, indent: 1 },
  ]);
  assert.equal(lines.filter(line => line.done).length, 2, 'only that item\'s');
  assert.equal(clipboardLines({ ...none(), lines: { mug: { away: true, trick: true, score: true } } })[at].done, true, 'all three done, the item goes too');
  assert.ok(clipboardLines(none()).some(line => line.text === 'Score 1,500'), 'written the way the copy line writes a score');
  const blank = pad(), crossed = pad();
  drawClipboard(blank, 'monday', clipboardLines(none())); drawClipboard(crossed, 'monday', lines);
  for (const line of lines) assert.ok(crossed.written.includes(line.text), line.text);
  assert.equal(crossed.g.strokes - blank.g.strokes, 2, 'a line through each done one');
});

test('what\'s thrown at something says hit, on both pages', () => {
  const lines = clipboardLines(none()), at = MONDAY.findIndex(e => e.id === 'rubber') * 4;
  assert.deepEqual(lines.slice(at, at + 3).map(line => line.text), ['Rubber ball', 'Hit the orange', 'Orange, off the banner']);
  assert.equal(lines[MONDAY.findIndex(e => e.id === 'plate') * 4 + 1].text, 'Hit the lemon');
  assert.equal(lines[MONDAY.findIndex(e => e.id === 'paper') * 4 + 1].text, 'Put it away');
  assert.deepEqual(dailyLines('2026-10-30', none()).map(line => line.text), ['Plate: island, hit the lemon', 'Rubber ball: doors, hit the orange', 'Tea bag: far table to mug']);
});

test('today\'s page shows three challenges and your best', () => {
  const shots = challenges(DAY), lines = dailyLines(DAY, { ...none(), daily: { [DAY]: [1200, 0, null] } });
  assert.deepEqual(lines.map(line => line.best), [1200, 0, null]);
  lines.forEach((line, i) => assert.ok(line.text.toLowerCase().startsWith(`${ITEMS[shots[i].item].name}: `), line.text));
  assert.deepEqual(dailyLines(DAY, none()).map(line => line.best), [null, null, null], 'nothing played');
  assert.deepEqual(dailyLines('2026-11-01', { ...none(), daily: { [DAY]: [1, 2, 3] } }).map(line => line.best), [null, null, null], 'another day\'s bests stay that day\'s');
  const page = pad(); drawClipboard(page, 'today', lines);
  for (const text of [...lines.map(line => line.text), 'Best 1,200', 'Best miss', 'Best -']) assert.ok(page.written.includes(text), `${text} in ${page.written}`);
});

test('no icons or emoji on the clipboard', () => {
  for (const { text } of clipboardLines(none())) assert.match(text, /^[\x20-\x7E]*$/);
  for (let d = 1; d <= 31; d++) for (const { text } of dailyLines(`2026-10-${String(d).padStart(2, '0')}`, none())) assert.match(text, /^[\x20-\x7E]*$/);
});

test('the score board has each item\'s best and today\'s three', () => {
  const board = pad();
  drawScores(board, { ...none(), best: { mug: 12400, plate: 0 }, daily: { [DAY]: [8150, null, 0] } }, DAY);
  for (const text of ['Mug', '12,400', 'Plate', 'miss', 'Paper ball', '-', '8,150', ...dailyLines(DAY, none()).map(line => line.text)]) assert.ok(board.written.includes(text), `${text} in ${board.written}`);
  assert.equal(board.written.filter(text => text === 'miss').length, 2, 'a best of nothing is a miss, on both sides');
});

test('Copy goes to the clipboard, or to the fallback where it can\'t', async () => {
  const seen = [], did = () => seen.push('copied'), no = text => seen.push(`shown ${text}`);
  await copyText('a', did, no, { writeText: async text => { seen.push(`wrote ${text}`); } });
  assert.deepEqual(seen.splice(0), ['wrote a', 'copied']);
  await copyText('b', did, no, { writeText: async () => { throw new Error('denied'); } });
  assert.deepEqual(seen.splice(0), ['shown b'], 'refused');
  await copyText('c', did, no, null);
  assert.deepEqual(seen.splice(0), ['shown c'], 'plain HTTP has no clipboard');
});

// The kitchen's boards as trickshot and the kitchen use them, on a canvas that counts what's drawn.
function hung(reach) {
  const drawn = { fills: 0 }, was = globalThis.document, started = [], copied = [];
  const g = new Proxy({}, { get: (target, key) => key === 'measureText' ? () => ({ width: 1 }) : key === 'fillRect' ? () => { drawn.fills++; } : key in target ? target[key] : () => {}, set: (target, key, value) => { target[key] = value; return true; } });
  const game = { progress: none(), saved: 0, entry: id => ({ id }), start: entry => started.push(entry), copy: () => copied.push(true) };
  const boards = createKitchenBoards(game, reach), room = new THREE.Group();
  globalThis.document = { createElement: () => ({ getContext: () => g, width: 0, height: 0 }) };
  try { boards.build(room); } finally { globalThis.document = was; }
  const all = []; room.traverse(node => { if (node.userData.toggle) all.push(node); });
  const shown = node => { for (let n = node; n; n = n.parent) if (!n.visible) return false; return true; };
  return { boards, room, game, drawn, started, copied, controls: () => all.filter(shown), find: name => all.find(node => node.name === name) };
}

test('Today\'s sheet starts a level from close up; from further off a click goes over to read it', () => {
  let near = false; const read = [], at = { x: 1, y: 2, z: 3 }, asked = [];
  const { find, started, room } = hung({ inReach: point => { asked.push(point); return near; }, read: board => read.push(board) });
  find('Today').userData.toggle(at);
  for (const name of ['daily-0', 'daily-2', 'Random shot']) { find(name).userData.toggle(at); assert.equal(started.length, 0, name); }
  assert.equal(read.length, 3); assert.ok(asked.every(point => point === at), 'by where it was hit');
  const clip = room.children.find(node => node.userData.near); assert.ok(read.every(board => board === clip && board.userData.board), 'the clipboard, the way a click on the rest of it goes');
  near = true;
  find('daily-1').userData.toggle(at); find('Random shot').userData.toggle(at);
  assert.equal(started.length, 2); assert.equal(started[0].id, 'daily-1'); assert.equal(read.length, 3);
});

test('the boards are hung ready to read, with the clipboard\'s page tabs', () => {
  const { room, controls } = hung(), read = []; room.traverse(node => { if (node.userData.board) read.push(node); });
  assert.equal(read.length, 2, 'clipboard and score board');
  assert.deepEqual(controls().map(node => node.name), ['Monday', 'Today'], 'Monday\'s page: only its tabs');
  assert.ok(controls().every(node => node.userData.dropsHeld), 'clicked, not thrown at');
  for (const board of read) for (const node of board.children) if (node.material?.map) assert.ok(node.material.map.version > 0, 'drawn, for its first upload to happen ahead of the doors');
  assert.ok(read.every(board => board.children.some(node => node.material?.userData.lit)), 'the switch dims them, not to nothing');
});

test('Today\'s page starts its challenges and a random shot, and Copy copies', () => {
  const { find, controls, started, copied } = hung();
  find('Today').userData.toggle();
  assert.deepEqual(controls().map(node => node.name).sort(), ['Copy', 'Monday', 'Random shot', 'Today', 'daily-0', 'daily-1', 'daily-2'].sort());
  find('daily-1').userData.toggle();
  assert.deepEqual(started.splice(0), [{ id: 'daily-1' }]);
  find('Random shot').userData.toggle();
  const [shot] = started; assert.ok(ITEMS[shot.item] && shot.start && shot.target && !shot.id && !shot.day, 'keeps no score beyond the attempt');
  find('Copy').userData.toggle();
  assert.equal(copied.length, 1);
  find('Monday').userData.toggle();
  assert.deepEqual(controls().map(node => node.name), ['Monday', 'Today']);
});

test('the boards redraw when progress changes or the day turns over, not every frame', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 31, 23, 59) });
  const { boards, game, drawn } = hung(), still = () => { const at = drawn.fills; for (let i = 0; i < 100; i++) boards.update(1 / 60, null, false, true); return drawn.fills - at; };
  assert.equal(still(), 0, 'nothing changed');
  game.saved++;
  const at = drawn.fills; boards.update(1 / 60, null, false, false);
  assert.equal(drawn.fills, at, 'hidden, it waits');
  assert.ok(still() > 0, 'a shot was recorded');
  assert.equal(still(), 0, 'once');
  t.mock.timers.tick(2 * 60_000);
  assert.ok(still() > 0, 'a new day');
  assert.equal(still(), 0, 'once');
});
