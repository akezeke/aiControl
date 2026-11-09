import test from 'node:test';
import assert from 'node:assert/strict';
import { FRUITS, COLOURS, KINDS, playerLook, checkUp, checkDown, meetingFloor, checkFloor, floorSnapshot, fakeMonitor, WORDS } from '../client/office/meeting.js';
import { palettes } from '../client/office/status.js';
import { sharedLayout, layoutOffice } from '../client/office/layout.js';

const session = (n, extra = {}) => ({
  id: `sess-${n}-abcdef`, cwd: `/home/SENTINEL-${n}/proj`, project: `SENTINEL-PROJ-${n}`, title: `SENTINEL-${n} title`, provider: 'claude',
  status: ['working', 'idle', 'permission'][n % 3], messages: [{ role: 'user', text: `SENTINEL-${n} hi`, timestamp: 1000 }], usage: 'SENTINEL-USAGE', ...extra,
});
const snapshotOf = () => {
  const sessions = [session(0), session(1), session(2), session(3), session(4, { parentId: 'sess-0-abcdef', status: 'working' })];
  const office = layoutOffice(sessions);
  office.pods.forEach(pod => { pod.name = 'SENTINEL-POD'; });
  return { sessions, office: { ...office, desks: [...office.desks.values()] }, usage: 'SENTINEL-USAGE' };
};
const floor = () => meetingFloor(snapshotOf());

test('checks drop every malformed message', () => {
  const good = [
    { type: 'hello', name: 'Ann', fruit: 'apple', colour: COLOURS[0] },
    { type: 'look', fruit: 'banana', colour: COLOURS[1] },
    { type: 'where', at: 'meeting' },
    { type: 'pos', x: 3, y: 0, z: 4.5, yaw: -1.2, pose: 'walking' },
    { type: 'throw', kind: 'football', pos: [1, 1, 1], vel: [1, 2, 3], spin: [4, 5, 6] },
    { type: 'floor', floor: floor() },
  ];
  for (const msg of good) assert.deepEqual(checkUp(msg), msg);
  const bad = [
    null, 5, 'x', [], undefined, {}, { type: 'nope' },
    { type: 'hello', name: 'x'.repeat(40), fruit: 'apple', colour: COLOURS[0] },
    { type: 'hello', name: 'Ann', fruit: 'durian', colour: COLOURS[0] },
    { type: 'hello', name: 'Ann', fruit: 'apple', colour: '#123456' },
    { type: 'where', at: 'moon' },
    { type: 'pos', x: NaN, y: 0, z: 0, yaw: 0, pose: 'walking' },
    { type: 'pos', x: 201, y: 0, z: 0, yaw: 0, pose: 'walking' },
    { type: 'pos', x: 0, y: 7, z: 0, yaw: 0, pose: 'walking' },
    { type: 'pos', x: 0, y: 0, z: -2, yaw: 0, pose: 'walking' },
    { type: 'pos', x: 0, y: 0, z: 0, yaw: Infinity, pose: 'walking' },
    { type: 'pos', x: 0, y: 0, z: 0, yaw: 0, pose: 'flying' },
    { type: 'throw', kind: 'anvil', pos: [0, 0, 0], vel: [0, 0, 0], spin: [0, 0, 0] },
    { type: 'throw', kind: 'mug', pos: [0, 0], vel: [0, 0, 0], spin: [0, 0, 0] },
    { type: 'throw', kind: 'mug', pos: [0, 0, 0], vel: [41, 0, 0], spin: [0, 0, 0] },
    { type: 'throw', kind: 'mug', pos: [0, 0, 0], vel: [0, 0, 0], spin: [0, 101, 0] },
    { type: 'throw', kind: 'mug', pos: [0, 0, NaN], vel: [0, 0, 0], spin: [0, 0, 0] },
    { type: 'floor', floor: { ...floor(), desks: Array.from({ length: 300 }, () => floor().desks[0]) } },
    { type: 'floor', floor: null },
  ];
  for (const msg of bad) assert.equal(checkUp(msg), null, JSON.stringify(msg)?.slice(0, 80));
  assert.deepEqual(checkUp({ ...good[3], extra: 'x' }), good[3]);

  const player = { id: 'a1', name: 'Ann', fruit: 'apple', colour: COLOURS[0], at: 'home' };
  const down = [
    { type: 'roster', players: [player] },
    { type: 'pos', id: 'a1', x: 1, y: 0, z: 1, yaw: 0, pose: 'standing' },
    { type: 'throw', id: 'a1', kind: 'paper', pos: [0, 1, 0], vel: [1, 1, 1], spin: [0, 0, 0] },
    { type: 'floor', floor: floor() }, { type: 'floor', floor: null }, { type: 'refused', why: 'full' },
    { type: 'welcome', id: 'a1', colour: COLOURS[2], at: 'meeting' },
  ];
  for (const msg of down) assert.deepEqual(checkDown(msg), msg);
  for (const msg of [
    null, { type: 'roster', players: Array.from({ length: 33 }, () => player) }, { type: 'roster', players: [{ ...player, id: 'BAD ID' }] },
    { type: 'roster', players: [{ ...player, at: 'x' }] }, { type: 'pos', x: 1, y: 0, z: 1, yaw: 0, pose: 'standing' },
    { type: 'pos', id: 'a'.repeat(13), x: 1, y: 0, z: 1, yaw: 0, pose: 'standing' }, { type: 'refused', why: 'x'.repeat(100) }, { type: 'hello' },
    { type: 'welcome', id: 'BAD ID', colour: COLOURS[0], at: 'home' }, { type: 'welcome', id: 'a1', colour: '#123456', at: 'home' }, { type: 'welcome', id: 'a1', colour: COLOURS[0], at: 'moon' },
  ]) assert.equal(checkDown(msg), null);
});

test('meetingFloor carries none of the snapshot\'s words', () => {
  const s = snapshotOf(), f = meetingFloor(s), text = JSON.stringify(f);
  assert.ok(!text.includes('SENTINEL'));
  for (const session of s.sessions) assert.ok(!text.includes(session.id));
  assert.ok(!text.includes('/home'));
  assert.equal(f.desks.length, s.sessions.length);
  assert.deepEqual(f.desks.filter(d => !d.parent).map(d => d.slot).sort(), s.office.desks.map(d => d.slot).sort());
  assert.equal(f.desks.filter(d => d.parent).length, 1);
  assert.equal(f.desks.find(d => d.parent).parent, f.desks.find(d => d.id === f.desks.find(x => x.parent).parent).id);
  assert.deepEqual(f.desks.map(d => d.id), f.desks.map((_, i) => `d${i}`));
  assert.ok(!('props' in f.desks[0].look) && !('notes' in f.desks[0].look));
  assert.ok(checkFloor(f));
});

test('floorSnapshot rebuilds what the office draws', () => {
  const s = snapshotOf(), f = meetingFloor(s), snap = floorSnapshot(checkFloor(f)), layout = sharedLayout(snap.office);
  assert.deepEqual([...layout.desks.values()].map(d => d.slot).sort(), s.office.desks.map(d => d.slot).sort());
  assert.equal(layout.pods.length, s.office.pods.length);
  assert.equal(snap.sessions.length, f.desks.length);
  assert.equal(snap.statuses.size, f.desks.length);
  for (const [id, status] of snap.statuses) {
    assert.equal(status.bubble, null);
    assert.ok(status.identity && 'monitor' in status);
    assert.ok(snap.sessions.some(x => x.id === id));
  }
  assert.ok(snap.sessions.some(x => x.parentId));
});

test('playerLook is stable and wears your colour', () => {
  const a = playerLook('Ann', 'apple', COLOURS[2]), b = playerLook('ANN', 'apple', COLOURS[2]);
  assert.deepEqual(a, b);
  assert.equal(a.trim, COLOURS[2]); assert.equal(a.colour, COLOURS[2]);
  assert.equal(a.fruit, 'apple');
  assert.deepEqual(a.accessories.filter(x => ['beanie', 'cap', 'headphones'].includes(x)), ['cap']);
  const c = playerLook('Ann', 'banana', COLOURS[3]);
  assert.deepEqual(c.accessories.filter(x => ['beanie', 'cap', 'headphones'].includes(x)), []);
  assert.ok(c.accessories.includes('bow'));
  assert.ok(c.color);
  assert.equal(FRUITS.length, 10); assert.equal(COLOURS.length, 8); assert.equal(new Set(COLOURS).size, 8);
  assert.ok(KINDS.includes('football') && KINDS.includes('mug'));
});

test('playerLook gives each fruit its own natural colour', () => {
  for (const name of ['Ann', 'Bo', 'Cy Dee', 'x.y']) for (const [fruit] of FRUITS) {
    const look = playerLook(name, fruit, COLOURS[0]);
    assert.ok(palettes[fruit].includes(look.color), `${name} ${fruit} ${look.color}`);
    assert.equal(playerLook(name, fruit, COLOURS[1]).color, look.color);
  }
});

test('playerLook wears exactly one head item', () => {
  const head = ['bow', 'flower', 'beanie', 'cap', 'headphones'];
  for (let n = 0; n < 40; n++) for (const [fruit] of FRUITS) {
    const { accessories } = playerLook(`name${n}`, fruit, COLOURS[0]);
    assert.deepEqual(accessories.filter(x => head.includes(x)), [fruit === 'banana' ? 'bow' : 'cap'], `${n} ${fruit}`);
    assert.equal(new Set(accessories).size, accessories.length);
  }
});

test('fakeMonitor', () => {
  const m = fakeMonitor('d1', 'green', 5.4);
  assert.deepEqual(m, fakeMonitor('d1', 'green', 5.9));
  assert.notDeepEqual(m, fakeMonitor('d1', 'green', 6));
  assert.equal(m.lines.length, 6); assert.equal(m.title, ''); assert.equal(m.plan, null);
  assert.deepEqual(fakeMonitor('d1', 'green', 6).lines.slice(0, 5), m.lines.slice(1));
  assert.equal(fakeMonitor('d1', 'dark', 5), null); assert.equal(fakeMonitor('d1', 'off', 5), null);
  assert.deepEqual(fakeMonitor('d1', 'amber', 5).lines, [{ kind: 'user', text: '' }], 'an empty prompt: the screen draws a user line\'s › itself');
  for (let t = 0; t < 20; t++) for (const l of fakeMonitor('x', 'green', t).lines) for (const w of l.text.split(' ')) assert.ok(WORDS.includes(w), w);
});
