import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { visitStep, doorCard, hostName, talkHow } from '../client/office/visit.js';
import { createBoards } from '../client/office/boards.js';
import { meetingFloor, checkFloor, floorSnapshot } from '../client/office/meeting.js';
import { layoutOffice } from '../client/office/layout.js';
import { Cast } from '../client/office/animation.js';
import { identity } from '../client/office/status.js';

// Runs events through the machine from `state`, returning each step's `then` and where it ended.
const run = (state, ...events) => {
  const steps = [];
  for (const event of events) { state = visitStep(state, typeof event === 'string' ? { type: event } : event); steps.push(state.then); }
  return { state, steps };
};
const HOME = { at: 'home' };

test('door → leaving → (floor) → away', () => {
  const { state, steps } = run(HOME, 'door', 'floor', 'faded');
  assert.deepEqual(steps, [['ask'], ['fadeOut'], ['build', 'place', 'fadeIn']]);
  assert.equal(state.at, 'away');
  assert.equal(run(HOME, 'door').state.at, 'leaving');
  assert.equal(run(HOME, 'door', 'floor').state.at, 'leaving', 'still fading out');
  assert.deepEqual(run(HOME, 'door', 'faded').steps[1], [], 'nothing to fade from yet');
  assert.deepEqual(run(HOME, 'door', 'floor', 'floor').steps[2], [], 'a newer floor while fading is read on arrival');
  assert.deepEqual(run(state, 'floor').steps, [['build']], 'away, a new floor redraws where you are');
  assert.deepEqual(run(state, 'faded').steps, [[]], 'a late fade changes nothing');
});

test('the floor going away takes a visitor home', () => {
  const away = run(HOME, 'door', 'floor', 'faded').state;
  const { state, steps } = run(away, 'floorGone', 'floor', 'door', 'faded');
  assert.deepEqual(steps, [['fadeOut'], [], [], ['goHome', 'place', 'fadeIn']]);
  assert.equal(state.at, 'home');
  assert.equal(run(away, 'floorGone').state.at, 'returning');
  // Mid-fade on the way there: straight back, no room built, the fade undone, and why.
  const fading = run(HOME, 'door', 'floor').state;
  assert.deepEqual(run(fading, 'floorGone').steps, [['goHome', 'fadeIn', 'nobody']]);
  assert.equal(run(fading, 'floorGone', 'faded').state.at, 'home', 'the fade that finishes after is ignored');
  assert.deepEqual(run(fading, 'floorGone', 'faded').steps[1], []);
  // Home, the host's page hears floors and losses all the time: none of it moves you.
  assert.deepEqual(run(HOME, 'floor', 'floorGone', 'left', 'faded').steps, [[], [], [], []]);
});

test('Leave while away → returning → home', () => {
  const away = run(HOME, 'door', 'floor', 'faded').state;
  assert.deepEqual(run(away, 'left', 'faded').steps, [['fadeOut'], ['goHome', 'place', 'fadeIn']]);
  assert.deepEqual(run(away, 'door', 'faded').steps, [['fadeOut'], ['goHome', 'place', 'fadeIn']], 'the host\'s door takes you home the same way');
  assert.deepEqual(run(HOME, 'door', 'left').steps[1], ['goHome'], 'Leave while asking: back to saying you\'re home');
  assert.deepEqual(run(HOME, 'door', 'floor', 'left').steps[2], ['goHome', 'fadeIn']);
});

test('a door click with no floor gives nobody, and a reduced-motion run skips the fades', () => {
  const { state, steps } = run(HOME, 'door', 'floorGone');
  assert.deepEqual(steps, [['ask'], ['goHome', 'nobody']], 'not moved, no fade');
  assert.equal(state.at, 'home');
  const still = type => ({ type, reduced: true });
  const there = run(HOME, still('door'), still('floor'));
  assert.deepEqual(there.steps, [['ask'], ['build', 'place']]);
  assert.equal(there.state.at, 'away');
  assert.deepEqual(run(there.state, still('door')).steps, [['goHome', 'place']]);
  assert.equal(run(there.state, still('floorGone')).state.at, 'home');
  // A fade under way when motion's turned down still comes back.
  assert.deepEqual(run(HOME, 'door', 'floor', still('faded')).steps[2], ['build', 'place', 'fadeIn']);
});

test('the door\'s card: the meeting from home, your office from the host\'s, nothing for the host or between', () => {
  const joined = { joined: true, host: 'alice', hosting: false };
  assert.equal(doorCard('home', { joined: false }), null);
  assert.deepEqual(doorCard('home', joined), { text: 'Meeting at alice', go: true });
  assert.deepEqual(doorCard('home', { ...joined, nobody: true }), { text: 'Nobody\'s at alice\'s office', go: false });
  assert.equal(doorCard('home', { ...joined, hosting: true }), null, 'a host page is already at its own meeting');
  assert.deepEqual(doorCard('leaving', joined), { text: 'Meeting at alice', go: false }, 'asking');
  assert.deepEqual(doorCard('away', joined), { text: 'Back to your office', go: true });
  assert.equal(doorCard('returning', joined), null);
  assert.equal(hostName('alice-pc.local'), 'alice-pc');
  assert.equal(hostName('192.168.1.20'), '192.168.1.20');
});

// The office's boards on canvases that keep what's written on each.
function boardsRoom() {
  const was = globalThis.document, canvases = [];
  globalThis.document = { createElement: () => { const written = [], g = new Proxy({}, { get: (t, key) => key === 'fillText' ? text => written.push(text) : key === 'measureText' ? text => ({ width: String(text).length }) : key in t ? t[key] : () => {}, set: (t, key, value) => { t[key] = value; return true; } }); const canvas = { getContext: () => g, written, width: 0, height: 0 }; canvases.push(canvas); return canvas; } };
  const face = () => new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  const room = { boards: { whiteboard: face(), clock: face(), waiting: face(), plate: face() }, meeting: null, coffeeSign: { visible: false, userData: { face: face() } } };
  const boards = createBoards(room);
  const said = name => room.boards[name].material.map.image.written;
  return { room, boards, said, done: () => { globalThis.document = was; } };
}

test('visiting, the boards show nothing of the host\'s: a blank whiteboard, an empty waiting board, no coffee sign, the host on the plate', () => {
  const { room, boards, said, done } = boardsRoom();
  try {
    const snapshot = { machine: 'SENTINEL-MACHINE', usage: [{ name: 'SENTINEL-ACCOUNT', provider: 'claude', windows: [{ label: '5-hour', usedPercent: 100, resetsAt: Date.now() + 3_600_000 }] }], providers: [] };
    boards.sync(snapshot, { waiting: ['SENTINEL-TITLE'] });
    assert.ok(said('whiteboard').includes('SENTINEL-ACCOUNT'));
    assert.ok(said('waiting').some(text => text.includes('SENTINEL-TITLE')));
    assert.ok(said('plate').includes('SENTINEL-MACHINE'));
    assert.equal(room.coffeeSign.visible, true);
    for (const name of ['whiteboard', 'waiting', 'plate']) said(name).length = 0;
    const version = name => room.boards[name].material.map.version, before = { whiteboard: version('whiteboard'), waiting: version('waiting') };
    boards.sync(snapshot, { waiting: ['SENTINEL-TITLE'], visiting: 'alice' });
    assert.deepEqual(said('whiteboard'), [], 'just the board');
    assert.deepEqual(said('waiting'), [], 'not even "nobody waiting"');
    assert.ok(version('whiteboard') > before.whiteboard && version('waiting') > before.waiting, 'wiped, not left as they were');
    assert.deepEqual(said('plate'), ['alice']);
    assert.equal(room.coffeeSign.visible, false);
    boards.sync(snapshot, { waiting: ['SENTINEL-TITLE'] });
    assert.ok(said('whiteboard').includes('SENTINEL-ACCOUNT'), 'home again, it\'s all back');
    assert.ok(said('plate').includes('SENTINEL-MACHINE'));
    assert.equal(room.coffeeSign.visible, true);
  } finally { done(); }
});

test('the host\'s office is built at the host\'s size, so its walls, door and kitchen are where theirs are', () => {
  const sessions = [{ id: 'a', cwd: '/x', project: 'x', status: 'working' }], office = layoutOffice(sessions);
  office.room = { width: 30, depth: 24 }; office.door = { x: 15, z: 24 }; // grown once, for pods since gone
  const snap = floorSnapshot(checkFloor(meetingFloor({ sessions, office: { ...office, desks: [...office.desks.values()] } })));
  assert.deepEqual(snap.office.room, { width: 30, depth: 24 });
  assert.deepEqual(snap.office.door, { x: 15, z: 24 });
});

test('the host\'s agents wear the host\'s looks, and a desk number that comes back on someone else is someone else', t => {
  const blank = () => new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true }), was = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: blank }) };
  t.after(() => { if (was) globalThis.document = was; else delete globalThis.document; });
  const cast = new Cast(new THREE.Scene()), room = { deskAnchor: () => ({ seat: new THREE.Vector3(), facing: 0, helpers: [] }) };
  const layout = { door: { x: 5, z: 5 }, desks: new Map([['d0', { subagents: [], leaving: [], overflow: 0 }]]) };
  const look = (fruit, color) => ({ fruit, color, accessories: [], trim: '#ff5d8f', habits: identity('x').habits, props: [], notes: 0 });
  const sync = who => cast.sync(layout, [], room, new Map([['d0', { pose: 'typing', expression: 'smile', ...who && { identity: who } }]]));
  const colours = () => { const out = new Set(); cast.characters.get('d0').fruit.group.traverse(node => { if (node.material?.color) out.add(node.material.color.getHexString()); }); return out; };
  const hex = colour => new THREE.Color(colour).getHexString();
  sync(look('apple', '#2a7f3c'));
  assert.ok(colours().has(hex('#2a7f3c')), 'the host\'s apple, not one made up from "d0"');
  const first = cast.characters.get('d0');
  sync(look('apple', '#2a7f3c'));
  assert.equal(cast.characters.get('d0'), first, 'the same look stays the same character');
  sync(look('pear', '#7a4f9e'));
  assert.notEqual(cast.characters.get('d0'), first);
  assert.ok(colours().has(hex('#7a4f9e')) && !colours().has(hex('#2a7f3c')));
  const own = cast.characters.get('d0'); sync(null); sync(null);
  assert.equal(cast.characters.get('d0'), own, 'without a look in its status a character is left as it is');
});

test('nobody there says so, whatever else the page thinks it knows', () => {
  assert.deepEqual(doorCard('home', { joined: true, host: 'alice', hosting: true, nobody: true }), { text: 'Nobody\'s at alice\'s office', go: false });
});

test('a hidden tab or a locked phone keeps a visitor where they are; shown again, the floor has a moment to come back', () => {
  const away = run(HOME, 'door', 'floor', 'faded').state;
  // The page's own link closes while hidden (live.js), and says there's no floor: that's not the host going.
  const back = run(away, 'hidden', 'floorGone', 'shown', 'floorGone', 'floor', 'timeout');
  assert.deepEqual(back.steps, [[], [], ['wait'], [], ['build'], []]);
  assert.equal(back.state.at, 'away', 'the floor came back: still there');
  const lost = run(away, 'hidden', 'floorGone', 'shown', 'timeout', 'faded');
  assert.deepEqual(lost.steps.slice(2), [['wait'], ['fadeOut'], ['goHome', 'place', 'fadeIn']], 'none came: home the usual way');
  assert.equal(lost.state.at, 'home');
  assert.deepEqual(run(away, 'timeout').steps, [[]], 'a wait that\'s over changes nothing');
  assert.deepEqual(run(away, 'hidden', 'left').steps[1], ['fadeOut'], 'leaving the meeting still takes you home');
  assert.deepEqual(run(away, 'shown', 'floorGone').steps, [[], ['fadeOut']], 'shown without having been hidden: the floor going is the host going');
  assert.deepEqual(run(HOME, 'hidden', 'shown').steps, [[], []], 'home, nothing to wait for');
});

test('talking to someone: walk over at home; visiting, only your own open, straight away, and the host\'s agents not at all', () => {
  const own = [{ id: 'mine' }];
  assert.equal(talkHow('mine', { away: false, own }), 'walk');
  assert.equal(talkHow('d0', { away: false, own }), 'walk', 'at home every character is yours');
  assert.equal(talkHow('mine', { away: true, own }), 'panel');
  assert.equal(talkHow('d0', { away: true, own }), null);
  assert.equal(talkHow(undefined, { away: true, own }), null);
  assert.equal(talkHow(undefined, { away: false, own }), null);
});
