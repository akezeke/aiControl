import test from 'node:test';
import assert from 'node:assert/strict';
import { FRUITS, COLOURS, KINDS, PROTOCOL, playerLook, checkUp, checkDown, meetingFloor, checkFloor, floorSnapshot, fakeMonitor } from '../client/office/meeting.js';
import { palettes, identity, PROPS, ACCESSORIES } from '../client/office/status.js';
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
  const snake = { type: 'snake', mode: 'play', head: [2.125, 3.375], path: '0011-', dir: 2, rate: 8.4, food: [4.125, 1.875], plant: 3 };
  const ready = { ...snake, mode: 'ready', path: '-'.repeat(15), food: null };
  const good = [
    snake, ready, { type: 'snake', mode: 'off' },
    { type: 'hello', v: PROTOCOL, name: 'Ann', fruit: 'apple', colour: COLOURS[0] },
    { type: 'look', fruit: 'banana', colour: COLOURS[1] },
    { type: 'where', at: 'meeting' },
    { type: 'pos', x: 3, y: 0, z: 4.5, yaw: -1.2, pose: 'walking' },
    { type: 'throw', kind: 'football', pos: [1, 1, 1], vel: [1, 2, 3], spin: [4, 5, 6] },
    { type: 'floor', floor: floor() },
    { type: 'pos', x: 3, y: 0, z: 4.5, yaw: -1.2, pose: 'walking', t: 12345 },
    { type: 'remove', name: 'Bo' },
  ];
  for (const msg of good) assert.deepEqual(checkUp(msg), msg);
  const bad = [
    null, 5, 'x', [], undefined, {}, { type: 'nope' },
    { type: 'hello', name: 'x'.repeat(40), fruit: 'apple', colour: COLOURS[0] },
    { type: 'hello', name: 'Ann', fruit: 'durian', colour: COLOURS[0] },
    { type: 'hello', name: 'Ann', fruit: 'apple', colour: '#123456' },
    ...['1', 1.5, 0, -1, 1e6, null].map(v => ({ type: 'hello', v, name: 'Ann', fruit: 'apple', colour: COLOURS[0] })),
    { type: 'where', at: 'moon' },
    { type: 'pos', x: NaN, y: 0, z: 0, yaw: 0, pose: 'walking' },
    { type: 'pos', x: 201, y: 0, z: 0, yaw: 0, pose: 'walking' },
    { type: 'pos', x: 0, y: 7, z: 0, yaw: 0, pose: 'walking' },
    { type: 'pos', x: 0, y: 0, z: -13, yaw: 0, pose: 'walking' },
    { type: 'pos', x: 0, y: 0, z: 0, yaw: Infinity, pose: 'walking' },
    { type: 'pos', x: 0, y: 0, z: 0, yaw: 0, pose: 'flying' },
    { type: 'pos', x: 0, y: 0, z: 0, yaw: 0, pose: 'walking', t: -1 },
    { type: 'pos', x: 0, y: 0, z: 0, yaw: 0, pose: 'walking', t: '5' },
    { type: 'pos', x: 0, y: 0, z: 0, yaw: 0, pose: 'walking', t: null },
    { type: 'throw', kind: 'anvil', pos: [0, 0, 0], vel: [0, 0, 0], spin: [0, 0, 0] },
    { type: 'throw', kind: 'mug', pos: [0, 0], vel: [0, 0, 0], spin: [0, 0, 0] },
    { type: 'throw', kind: 'mug', pos: [0, 0, 0], vel: [41, 0, 0], spin: [0, 0, 0] },
    { type: 'throw', kind: 'mug', pos: [0, 0, 0], vel: [0, 0, 0], spin: [0, 101, 0] },
    { type: 'throw', kind: 'mug', pos: [0, 0, NaN], vel: [0, 0, 0], spin: [0, 0, 0] },
    { type: 'floor', floor: { ...floor(), desks: Array.from({ length: 300 }, () => floor().desks[0]) } },
    { type: 'floor', floor: null },
    { type: 'remove' },
    { type: 'remove', name: 'x'.repeat(40) },
    { type: 'remove', name: 5 },
    { ...snake, path: '0014' }, { ...snake, path: '0'.repeat(1201) }, { ...snake, head: [201, 0] }, { ...snake, head: [0] },
    { ...snake, food: [0, -13] }, { ...snake, food: undefined }, { ...snake, plant: 4 }, { ...snake, plant: 1.5 },
    { ...snake, mode: 'won' }, { ...snake, dir: 4 }, { ...snake, rate: 0.5 }, { ...snake, rate: 33 },
  ];
  for (const msg of bad) assert.equal(checkUp(msg), null, JSON.stringify(msg)?.slice(0, 80));
  assert.deepEqual(checkUp({ ...good[3], extra: 'x' }), good[3]);
  assert.deepEqual(checkUp({ type: 'snake', mode: 'off', head: [1, 1] }), { type: 'snake', mode: 'off' });
  assert.deepEqual(checkDown({ ...snake, id: 'a1' }), { ...snake, id: 'a1' });
  assert.deepEqual(checkDown({ type: 'snake', mode: 'off', id: 'a1' }), { type: 'snake', mode: 'off', id: 'a1' });
  assert.equal(checkDown(snake), null);
  const plan = { type: 'goose', at: [2.5, 3.25], yaw: 1.57, mode: 'visit', idle: 'peck', speed: 0.75, route: [[3, 3.25], [3.5, 4]], carry: null, target: null };
  const events = [{ type: 'goosed', what: 'nip', who: 'b7' }, { type: 'goosed', what: 'take', kind: 'mug', spot: [1, 0.4, 2] }, { type: 'goosed', what: 'drop' },
    { type: 'goosed', what: 'wake', spot: [4.5, 6] }, { type: 'goosed', what: 'honk', icon: '💢' }, { type: 'goosed', what: 'honk', icon: '🪿' }];
  const pokes = ['hit', 'click', 'took'].map(why => ({ type: 'poke', why }));
  for (const msg of [plan, { ...plan, mode: 'mill', speed: 0, route: [] }, { ...plan, carry: 'mug', target: [1, 0.4, 2] }, ...events, ...pokes]) assert.deepEqual(checkUp(msg), msg);
  assert.deepEqual(checkUp({ ...plan, age: 5 }), plan, "age is only ever the server's");
  assert.deepEqual(checkUp({ type: 'goosed', what: 'drop', kind: 'mug', who: 'b7' }), { type: 'goosed', what: 'drop' });
  for (const msg of [
    { ...plan, at: [201, 0] }, { ...plan, at: [1] }, { ...plan, yaw: 'x' }, { ...plan, mode: 'swim' }, { ...plan, idle: 'nap' }, { ...plan, speed: 4.5 }, { ...plan, speed: -1 },
    { ...plan, route: Array(33).fill([1, 1]) }, { ...plan, route: [[1]] }, { ...plan, route: undefined }, { ...plan, carry: 'sofa' }, { ...plan, target: [1, 2] }, { ...plan, target: [1, 2, 300] },
    { type: 'goosed', what: 'bite' }, { type: 'goosed', what: 'nip', who: 'B!' }, { type: 'goosed', what: 'take', kind: 'sofa', spot: [1, 0.4, 2] }, { type: 'goosed', what: 'take', kind: 'mug', spot: [1, 2] },
    { type: 'goosed', what: 'wake', spot: [1, 2, 3] }, { type: 'goosed', what: 'honk', icon: '🦆' }, { type: 'poke', why: 'kick' },
  ]) assert.equal(checkUp(msg), null, JSON.stringify(msg));
  assert.equal(PROTOCOL, 1);
  assert.equal(checkUp({ type: 'hello', name: 'Ann', fruit: 'apple', colour: COLOURS[0] }).v, 1, "an AI Control from before the number speaks the first one");
  assert.equal(checkUp({ type: 'hello', v: 7, name: 'Ann', fruit: 'apple', colour: COLOURS[0] }).v, 7, 'the hub decides what a number it does not speak means');

  const player = { id: 'a1', name: 'Ann', fruit: 'apple', colour: COLOURS[0], at: 'home' };
  const down = [
    { type: 'roster', players: [player] },
    { type: 'pos', id: 'a1', x: 1, y: 0, z: 1, yaw: 0, pose: 'standing' },
    { type: 'throw', id: 'a1', kind: 'paper', pos: [0, 1, 0], vel: [1, 1, 1], spin: [0, 0, 0] },
    { type: 'floor', floor: floor() }, { type: 'floor', floor: null }, { type: 'refused', why: 'full' },
    { type: 'welcome', id: 'a1', colour: COLOURS[2], at: 'meeting' },
  ];
  for (const msg of down) assert.deepEqual(checkDown(msg), msg);
  for (const msg of [{ ...plan, id: 'a1' }, { ...plan, id: 'a1', age: 2500 }, ...events.map(e => ({ ...e, id: 'a1' })), ...pokes.map(p => ({ ...p, id: 'a1' }))]) assert.deepEqual(checkDown(msg), msg);
  for (const msg of [{ ...plan, id: 'a1', age: 10001 }, { ...plan, id: 'a1', age: -1 }, plan, ...events, ...pokes]) assert.equal(checkDown(msg), null, JSON.stringify(msg));
  assert.deepEqual(checkDown({ type: 'goosed', what: 'drop', kind: 'mug', id: 'a1' }), { type: 'goosed', id: 'a1', what: 'drop' });
  assert.deepEqual(checkUp({ type: 'shelf', open: true, x: 1 }), { type: 'shelf', open: true });
  assert.equal(checkUp({ type: 'shelf', open: 'yes' }), null);
  assert.deepEqual(checkDown({ type: 'shelf', open: false, id: 'a1' }), { type: 'shelf', id: 'a1', open: false });
  assert.equal(checkDown({ type: 'shelf', open: false }), null);
  assert.deepEqual(checkDown({ type: 'roster', players: [{ ...player, goose: true }, { ...player, goose: false }, player] }).players.map(p => p.goose), [true, undefined, undefined]);
  assert.ok(!('goose' in checkDown({ type: 'roster', players: [{ ...player, goose: false }] }).players[0]));
  assert.equal(checkDown({ type: 'roster', players: [{ ...player, goose: 'yes' }] }), null);
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
  assert.ok(f.desks.every(d => Array.isArray(d.look.props) && d.look.props.length <= 3 && Number.isInteger(d.look.notes)));
  assert.ok(f.desks.some(d => d.look.props.length || d.look.notes), 'some desk has things on it');
  assert.ok(checkFloor(f));
});

test('desk ids stay with their desks while sessions come and go', () => {
  const s = (id, extra = {}) => ({ id, cwd: '/p', project: 'p', status: 'working', updatedAt: 1, ...extra }), names = ['a', 'b', 'c', 'd', 'e', 'h'];
  // Which session a desk is, by its look (identity of the id), and where it sits.
  const looks = new Map(names.map(name => [JSON.stringify(identity(name)), name]));
  assert.equal(looks.size, names.length);
  const ids = new Map();
  let layout;
  const floorOf = sessions => {
    layout = layoutOffice(sessions, layout, 1000);
    const f = meetingFloor({ sessions, office: { ...layout, desks: [...layout.desks.values()] } }, ids);
    assert.ok(checkFloor(f)); assert.ok(f.desks.every(d => /^d[0-9]{1,3}$/.test(d.id)));
    return Object.fromEntries(f.desks.map(d => [looks.get(JSON.stringify(d.look)), { id: d.id, slot: d.slot, parent: d.parent }]));
  };
  const first = floorOf([s('a'), s('b'), s('c'), s('h', { parentId: 'b' })]);
  assert.deepEqual(Object.values(first).map(d => d.id).sort(), ['d0', 'd1', 'd2', 'd3']);
  // a ends: nothing renumbers, and b's helper still points at b.
  const second = floorOf([s('b'), s('c'), s('h', { parentId: 'b' })]);
  assert.deepEqual(second, { b: first.b, c: first.c, h: first.h });
  // A newcomer doesn't take an id the last floor still had: a's desk going and d's arriving are two things, not one changing.
  const third = floorOf([s('b'), s('c'), s('h', { parentId: 'b' }), s('d')]);
  assert.deepEqual({ ...third, d: undefined }, { ...second, d: undefined });
  assert.equal(third.d.id, first.a.id, "a's id is free again once a floor went without it");
  const fourth = floorOf([s('c'), s('h', { parentId: 'c' }), s('d'), s('e')]);
  assert.deepEqual([fourth.c.id, fourth.d.id], [first.c.id, third.d.id]);
  assert.deepEqual([fourth.h.id, fourth.h.parent], [first.h.id, first.c.id]);
  assert.ok(!Object.values(third).some(d => d.id === fourth.e.id), "b's id isn't handed straight on to e");
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

test("the floor's lists of desk things and accessories are status.js's", () => {
  const seen = { props: new Set(), accessories: new Set() };
  for (let n = 0; n < 2000; n++) { const look = identity(`s${n}`); look.props.forEach(p => seen.props.add(p)); look.accessories.forEach(a => seen.accessories.add(a)); }
  assert.deepEqual([...seen.props].sort(), [...PROPS].sort());
  for (const [fruit] of FRUITS) for (const a of playerLook('Ann', fruit, COLOURS[0]).accessories) seen.accessories.add(a);
  assert.deepEqual([...seen.accessories].sort(), [...ACCESSORIES].sort());
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
  assert.equal(fakeMonitor('d1', 'off', 5), null);
  assert.deepEqual(fakeMonitor('d1', 'amber', 5).lines, [{ kind: 'user', text: '' }], 'an empty prompt: the screen draws a user line\'s › itself');
});

test('desks keep their things: props and notes survive checkFloor and reach floorSnapshot', () => {
  const f = floor(), clean = checkFloor(f), snap = floorSnapshot(clean);
  assert.deepEqual(clean.desks.map(d => [d.look.props, d.look.notes]), f.desks.map(d => [d.look.props, d.look.notes]));
  for (const d of clean.desks) assert.deepEqual([snap.statuses.get(d.id).identity.props, snap.statuses.get(d.id).identity.notes], [d.look.props, d.look.notes]);
});

test("checkFloor reads a newer host's looks as the nearest it knows, and keeps sizes and types strict", () => {
  const desk = (change, part = 'look') => { const f = floor(); change(f.desks[0][part]); return checkFloor(f)?.desks[0][part] ?? null; };
  assert.ok(checkFloor(floor()));
  // Things this version doesn't know: dropped, or the plain default, never the whole floor refused.
  assert.deepEqual(desk(l => { l.props = ['bomb', 'plant']; }).props, ['plant']);
  assert.deepEqual(desk(l => { l.accessories = ['jetpack', 'glasses']; }).accessories, ['glasses']);
  assert.equal(desk(l => { l.fruit = 'durian'; }).fruit, 'apple');
  assert.equal(desk(s => { s.screen = 'hologram'; }, 'status').screen, 'off');
  assert.equal(desk(l => { l.notes = 9; }).notes, 3);
  assert.equal(desk(l => { l.notes = -2; }).notes, 0);
  assert.equal(desk(s => { s.cups = 40; }, 'status').cups, 6);
  assert.equal(desk(l => { delete l.notes; }).notes, 0); // missing (an older host) means none, not refused
  // Wrong types and sizes are still refused whole.
  for (const change of [l => { l.props = ['plant', 'mug', 'duck', 'frame']; }, l => { l.props = 'plant'; }, l => { l.props = [7]; }, l => { l.notes = 1.5; }, l => { l.notes = '2'; },
    l => { l.fruit = 5; }, l => { l.fruit = 'x'.repeat(40); }, l => { l.accessories = Array(9).fill('cap'); }, l => { l.accessories = ['CAP!']; }])
    assert.equal(desk(change), null, change.toString());
  for (const change of [s => { s.screen = 3; }, s => { s.cups = 1.5; }, s => { s.cups = null; }, s => { s.wear = 2; }])
    assert.equal(desk(change, 'status'), null, change.toString());
});

test("an older host's floor without desk things is still taken, with none on the desks", async () => {
  const { checkFloor } = await import('../client/office/meeting.js');
  const look = { fruit: 'apple', color: '#aa0000', accessories: ['cap'], trim: '#00aa00', habits: { typing: 'touch', thinking: 'chin', sleeping: 'heels', finish: 'cheering' } };
  const status = { pose: 'typing', expression: 'focused', screen: 'green', since: null, wear: 0, cups: 0 };
  const floor = { room: { width: 10, depth: 10 }, door: { x: 5, z: 10 }, pods: [[0, 0]], desks: [{ id: 'd0', pod: 0, slot: 0, parent: null, look, status }] };
  const clean = checkFloor(floor);
  assert.ok(clean, 'older floor rejected');
  assert.deepEqual([clean.desks[0].look.props, clean.desks[0].look.notes], [[], 0]);
  assert.deepEqual(checkFloor({ ...floor, desks: [{ ...floor.desks[0], look: { ...look, props: ['secret'], notes: 0 } }] }).desks[0].look.props, []);
});
