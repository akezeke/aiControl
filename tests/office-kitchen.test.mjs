import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createKitchen, DOOR_NEAR, DOOR_FAR } from '../client/office/kitchen.js';
import { KITCHEN, flightBoxes } from '../client/office/kitchen-plan.js';
import { kitchenDoor, kitchenShift } from '../client/office/layout.js';
import { WALL_H, WALL_T } from '../client/office/furniture.js';
import { walkGrid, findPath, nearestOpen } from '../client/office/path.js';
import { free, pick, resolveStep } from '../client/office/player.js';
import { moveBody, reachableIn } from '../client/office/props.js';
import { createRoom } from '../client/office/room.js';
import { escaped, makeBody } from '../client/office/flight.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// No document in Node: a blank canvas for its textures.
const blank = () => new Proxy({}, { get: (t, k) => k in t ? t[k] : () => ({ addColorStop() {} }), set: (t, k, v) => { t[k] = v; return true; } });
const DEPTH = 10, door = kitchenDoor(DEPTH), inRoom = V(-3, 1.6, door), near = V(1, 1.6, door), far = V(6, 1.6, door);
// The office's left wall, as room.js stands it.
const leftWall = depth => { const wall = new THREE.Group(); wall.position.set(-WALL_T / 2, WALL_H / 2, depth / 2); wall.rotation.y = Math.PI / 2; return wall; };

function setup(t, depth = DEPTH) {
  const was = globalThis.document; globalThis.document = { createElement: () => ({ getContext: blank }) };
  t.after(() => { if (was) globalThis.document = was; else delete globalThis.document; });
  const events = { moves: 0, shifts: [] }, kitchen = createKitchen({ onMove: () => events.moves++ });
  kitchen.moved = dz => events.shifts.push([dz, kitchen.origin.z]);
  const walking = kitchen.build({ depth, shell: new THREE.Group(), wall: leftWall(depth) });
  return { kitchen, events, walking };
}
const fill = kitchen => kitchen.flight.filter(b => b.surface === 'wall-e');
const run = (kitchen, at, seconds = 1, still = false, overview = 0) => { for (let i = 0; i < seconds * 60; i++) kitchen.update(1 / 60, at, still, overview); };

test('sits at the left wall with the door in the middle of its door side, inside only past the wall', t => {
  const { kitchen } = setup(t);
  assert.deepEqual(kitchen.origin, { x: -WALL_T, z: door });
  assert.deepEqual(kitchen.group.position.toArray(), [-WALL_T, 0, door]);
  assert.ok(kitchen.inside(inRoom));
  assert.ok(!kitchen.inside(near), 'the office');
  assert.ok(!kitchen.inside(V(-3, 1.6, door + KITCHEN.front + 0.5)), 'past its south wall');
  assert.ok(!kitchen.inside(V(-3, 1.6, door + KITCHEN.back - 0.5)), 'past its north wall');
  assert.ok(!kitchen.inside(V(-WALL_T - KITCHEN.width - 0.5, 1.6, door)), 'past its west wall');
});

test('left to itself nothing is built until you first go near, and the doorway is solid to thrown things till then', t => {
  const { kitchen } = setup(t);
  run(kitchen, far);
  assert.equal(kitchen.group.children.length, 0);
  assert.equal(kitchen.group.visible, false);
  assert.equal(fill(kitchen).length, 1, 'the shut door');
  assert.equal(kitchen.flight.length, 1, 'and nothing of the room');
  const [box] = fill(kitchen);
  assert.ok(box.min.x === -WALL_T && Math.abs(box.max.x) < 1e-9 && box.min.z === door - 0.75 && box.max.z === door + 0.75 && box.max.y === 2.2);
  run(kitchen, near);
  assert.ok(kitchen.group.children.length > 0);
  assert.equal(kitchen.group.visible, true);
  assert.equal(kitchen.group.matrixWorldAutoUpdate, true);
  assert.equal(kitchen.shown, true);
  const built = kitchen.group.children[0];
  run(kitchen, far, 2); run(kitchen, near);
  assert.equal(kitchen.group.children[0], built, 'built once');
});

test('the doors open within 2.5 m, close past 3 m, and their box is there only while shut', t => {
  const { kitchen, events } = setup(t);
  assert.equal(DOOR_NEAR, 2.5); assert.equal(DOOR_FAR, 3);
  run(kitchen, V(2.3, 1.6, door), 0.1);
  assert.equal(fill(kitchen).length, 0, 'gone as soon as they start to open');
  assert.ok(kitchen.flight.length > 50, 'and the room has joined'); assert.equal(kitchen.within.length, 0);
  const open = kitchen.flight, moves = events.moves;
  run(kitchen, V(2.8, 1.6, door), 1);
  assert.equal(kitchen.flight, open, 'stays open between the two distances, and the list is left alone');
  assert.equal(events.moves, moves);
  run(kitchen, V(3.1, 1.6, door), 2);
  assert.equal(fill(kitchen).length, 1, 'shut');
  assert.equal(kitchen.flight.length, 1, 'the office meets the door and no more');
  assert.ok(kitchen.within.length > 50, 'what it has built stays, for what\'s in here');
  assert.notEqual(kitchen.flight, open, 'a new list');
  assert.equal(kitchen.group.visible, false, 'skipped once shut');
  assert.equal(kitchen.shown, false, 'and says so');
  run(kitchen, V(2.8, 1.6, door), 1);
  assert.equal(fill(kitchen).length, 1, 'between the two distances shut stays shut');
});

test('they stay open while you are inside, however far in, and only shut(true) holds them', t => {
  const { kitchen } = setup(t);
  run(kitchen, near); run(kitchen, V(-8, 1.6, door - 3), 2);
  assert.equal(fill(kitchen).length, 0);
  kitchen.shut(true); run(kitchen, V(-8, 1.6, door - 3), 2);
  assert.equal(fill(kitchen).length, 1);
  assert.equal(kitchen.group.visible, true, 'inside, it still shows');
  run(kitchen, V(-1, 1.6, door), 2);
  assert.equal(fill(kitchen).length, 1, 'held shut with you beside them');
  kitchen.shut(false); run(kitchen, V(-1, 1.6, door), 0.1);
  assert.equal(fill(kitchen).length, 0);
});

test('with reduced motion they jump', t => {
  const { kitchen } = setup(t), [a, b] = kitchen.doors.children.filter(c => c.userData.leaf);
  kitchen.update(1 / 60, far, true, 0); const shutA = a.rotation.y, shutB = b.rotation.y;
  kitchen.update(1 / 60, near, true, 0);
  assert.ok(Math.abs(a.rotation.y - shutA) > 1.4 && Math.abs(b.rotation.y - shutB) > 1.4, 'wide open in one frame');
  kitchen.update(1 / 60, far, true, 0);
  assert.equal(a.rotation.y, shutA);
  kitchen.update(1 / 60, near, false, 0);
  assert.ok(Math.abs(a.rotation.y - shutA) < 0.5, 'otherwise a swing');
});

test('the leaves swing into the kitchen, and shut they fill the doorway', t => {
  const { kitchen } = setup(t), leaves = kitchen.doors.children.filter(c => c.userData.leaf), tip = l => l.localToWorld(V(0, 1, 0.74));
  run(kitchen, far, 0.1, true);
  const shut = leaves.map(tip);
  assert.ok(Math.abs(shut[0].z - shut[1].z) < 0.03, 'they meet');
  assert.ok(Math.abs(shut[0].z - door) < 0.03);
  for (const p of shut) assert.ok(p.x < 0 && p.x > -WALL_T, 'in the wall');
  run(kitchen, near, 0.1, true);
  for (const l of leaves) assert.ok(tip(l).x < -WALL_T - 0.6, `${tip(l).x}`);
});

test('in the overview it is skipped whole, and hidden no ray goes in', t => {
  const { kitchen } = setup(t);
  run(kitchen, inRoom, 0.1);
  assert.equal(kitchen.group.visible, true);
  assert.notEqual(kitchen.group.raycast(), false);
  run(kitchen, inRoom, 0.1, false, 0.5);
  assert.equal(kitchen.group.visible, false);
  assert.equal(kitchen.group.matrixWorldAutoUpdate, false);
  assert.equal(kitchen.group.raycast(), false);
});

test('growing the room moves the same group and tells whoever cares first', t => {
  const { kitchen, events } = setup(t, 8);
  run(kitchen, V(1, 1.6, kitchenDoor(8)));
  const child = kitchen.group.children[0], group = kitchen.group, list = kitchen.flight;
  const walls = kitchen.build({ depth: 8, shell: new THREE.Group(), wall: leftWall(8) });
  assert.deepEqual(events.shifts, [], 'same depth, no move');
  kitchen.build({ depth: 10, shell: new THREE.Group(), wall: leftWall(10) });
  assert.deepEqual(events.shifts, [[kitchenShift(8, 10), kitchenDoor(8)]], 'told while the kitchen is still where it was');
  assert.equal(kitchen.group, group); assert.equal(kitchen.group.children[0], child);
  assert.equal(kitchen.group.position.z, kitchenDoor(10));
  assert.notEqual(kitchen.flight, list);
  list.forEach((b, i) => assert.ok(Math.abs(kitchen.flight[i].min.z - b.min.z - 2) < 1e-9 && Math.abs(kitchen.flight[i].min.x - b.min.x) < 1e-9, b.surface));
  assert.ok(walls.length);
});

test('what it hands back: walls and walk boxes, walls only as far as the office wall, and no piece of the wall twice', t => {
  const { kitchen, walking } = setup(t);
  assert.deepEqual(walking.filter(b => !b.walkOnly).map(b => b.surface).sort(), ['wall-n', 'wall-s', 'wall-w']);
  assert.ok(walking.filter(b => b.walkOnly).length > 10);
  assert.ok(walking.every(b => b.isBox3));
  const back = walking.find(b => b.surface === 'behind');
  assert.ok(back.walkOnly && back.min.z === 0 && back.max.z === door + KITCHEN.back - WALL_T, 'nowhere to end up behind its north wall');
  run(kitchen, near);
  assert.deepEqual(kitchen.flight.filter(b => b.surface.startsWith('wall-')), [], 'open: the office wall stands there already');
  assert.ok(kitchen.flight.some(b => b.surface === 'tray') && kitchen.flight.some(b => b.surface === 'pan-1'));
  assert.ok(!kitchen.flight.some(b => b.walkOnly));
});

test('a game gets the group when it is built, is updated with it, and what it stands on the floor blocks walking', t => {
  const { kitchen } = setup(t), calls = [];
  const game = { build: group => calls.push(['build', group]), update: (dt, at, still, shown) => calls.push(['update', shown]), blocks: [new THREE.Box3(V(-2, 0, -1), V(-1, 1, 0))] };
  kitchen.add(game);
  const walking = kitchen.build({ depth: DEPTH, shell: new THREE.Group(), wall: leftWall(DEPTH) });
  const block = walking.find(b => Math.abs(b.min.x - (-2 - WALL_T)) < 1e-9 && Math.abs(b.min.z - (door - 1)) < 1e-9 && b.max.y === 1);
  assert.ok(block, 'moved to where the kitchen is');
  kitchen.update(1 / 60, far, false, 0);
  assert.deepEqual(calls, [['update', false]], 'not built yet');
  run(kitchen, near, 0.1);
  assert.deepEqual(calls.filter(c => c[0] === 'build'), [['build', kitchen.group]]);
  assert.equal(calls.at(-1)[1], true);
  const late = []; kitchen.add({ build: group => late.push(group), update() {} });
  assert.deepEqual(late, [kitchen.group], 'added after it was built: at once');
});

// What a built room is made of, in the order it's added: how it's drawn doesn't depend on how it got ready.
const made = kitchen => { const all = []; for (const child of kitchen.group.children) child.traverse(n => all.push([n.type, n.geometry?.attributes.position.count ?? 0, n.material?.type ?? '', n.visible])); return all; };
const drain = (steps, each = () => {}) => { let n = 0; for (let s = steps.next(); !s.done; s = steps.next()) { n++; each(); } return n; };

test('getting ready goes in steps, with the same room as the doors would have built, and only once', t => {
  const { kitchen, events } = setup(t), { kitchen: opened } = setup(t), builds = [], sizes = [];
  kitchen.add({ build: group => builds.push(group), update() {} });
  run(opened, near, 0.1);
  const steps = kitchen.prepare(), moves = events.moves;
  assert.equal(kitchen.group.children.length, 0, 'asking does nothing yet');
  const n = drain(steps, () => sizes.push(kitchen.group.children.length));
  assert.ok(n >= 8, `in ${n} steps`);
  assert.ok(sizes[0] <= 1, 'one thing at a time');
  assert.deepEqual(builds, [kitchen.group], 'the game once');
  assert.deepEqual(made(kitchen), made(opened));
  assert.equal(events.moves, moves, "nobody's told: nothing has changed for anything out there");
  const again = kitchen.group.children[0];
  assert.equal(drain(kitchen.prepare()), 0, 'nothing left');
  run(kitchen, near, 0.5);
  assert.deepEqual(builds, [kitchen.group]);
  assert.equal(kitchen.group.children[0], again);
  assert.deepEqual(made(kitchen), made(opened), 'and opening builds nothing more');
});

test('the doors opening part way through get the rest in that one update, and the steps then have nothing left', t => {
  for (const at of [near, inRoom]) {
    const { kitchen } = setup(t), { kitchen: opened } = setup(t), builds = [];
    kitchen.add({ build: group => builds.push(group), update() {} });
    run(opened, near, 0.1);
    const steps = kitchen.prepare();
    for (let i = 0; i < 3; i++) steps.next();
    kitchen.update(1 / 60, at, true, 0);
    assert.equal(kitchen.group.visible, true);
    assert.deepEqual(builds, [kitchen.group]);
    assert.deepEqual(made(kitchen), made(opened));
    assert.ok(kitchen.pans);
    assert.equal(drain(steps), 0);
    assert.deepEqual(builds, [kitchen.group]);
  }
});

test('a game added part way through is built after the room, and one added after that at once', t => {
  const { kitchen } = setup(t), order = [], steps = kitchen.prepare();
  steps.next();
  kitchen.add({ build: group => order.push(['middle', group.children.length]), update() {} });
  assert.deepEqual(order, []);
  drain(steps);
  assert.equal(order.length, 1);
  assert.ok(order[0][1] > 10, 'the room is there by then');
  kitchen.add({ build: () => order.push(['last']), update() {} });
  assert.equal(order.at(-1)[0], 'last');
});

test('prepared and hidden: not shown, the group\'s own matrix flag off, no ray, no pan moved, and thrown things still meet the shut door', t => {
  const { kitchen, events } = setup(t), shown = [];
  kitchen.add({ build() {}, update: (dt, at, still, on) => shown.push(on) });
  drain(kitchen.prepare());
  let moves = 0; const { update } = kitchen.pans; kitchen.pans.update = dt => { moves++; update(dt); };
  const list = kitchen.flight, told = events.moves;
  run(kitchen, far);
  assert.equal(kitchen.group.visible, false);
  assert.equal(kitchen.shown, false);
  assert.equal(kitchen.group.matrixWorldAutoUpdate, false);
  assert.equal(kitchen.group.raycast(), false);
  assert.equal(moves, 0, 'pans only while shown');
  assert.ok(shown.length && shown.every(on => !on));
  assert.equal(kitchen.flight, list, 'the same list: nothing wakes');
  assert.equal(events.moves, told);
  assert.equal(fill(kitchen).length, 1, 'the shut door');
  assert.equal(kitchen.flight.length, 1, 'and nothing of the room, till the doors first open');
  run(kitchen, near, 0.1);
  assert.equal(fill(kitchen).length, 0);
  assert.ok(kitchen.flight.length > 50);
  assert.ok(moves > 0);
});

test('growing the room part way through getting ready builds nothing again and moves what there is', t => {
  const { kitchen } = setup(t, 8), steps = kitchen.prepare(), builds = [];
  kitchen.add({ build: group => builds.push(group), update() {} });
  for (let i = 0; i < 3; i++) steps.next();
  const first = kitchen.group.children[0];
  kitchen.build({ depth: 10, shell: new THREE.Group(), wall: leftWall(10) });
  assert.equal(kitchen.group.position.z, kitchenDoor(10));
  drain(steps);
  assert.equal(kitchen.group.children[0], first);
  assert.deepEqual(builds, [kitchen.group]);
  assert.equal(fill(kitchen).length, 1);
  assert.equal(kitchen.flight.length, 1);
});

// A renderer as far as getting ready goes: what it's asked for, and the textures it has already.
const fakeProgram = calls => { const program = { getUniforms: () => calls.push(['use', program]), getAttributes() {} }; return program; };
const fakeRenderer = ({ parallel = true } = {}) => {
  const calls = [], seen = new Set(), renderer = {
    calls, info: { programs: [] }, extensions: { has: name => parallel && name === 'KHR_parallel_shader_compile' }, properties: { has: texture => seen.has(texture) },
    compileAsync: (...args) => { calls.push(['compile', ...args]); renderer.info.programs.push(fakeProgram(calls)); return Promise.resolve(); },
    initTexture: texture => { calls.push(['texture', texture]); seen.add(texture); },
  };
  return renderer;
};

test('after the room: its shaders, hidden as it is and with the scene it will be lit in, then each texture a step of its own, skipping what is there', t => {
  const { kitchen } = setup(t), renderer = fakeRenderer(), camera = new THREE.PerspectiveCamera(), scene = new THREE.Scene(), waits = [];
  kitchen.add({ build() {}, update() {} });
  for (const value of kitchen.prepare(renderer, camera, scene)) {
    waits.push(value);
    if (renderer.calls.length === 1 && renderer.calls[0][0] === 'compile') assert.ok(kitchen.group.children.length > 10 && kitchen.pans, 'with all of it built');
  }
  const [compile, use, ...textures] = renderer.calls;
  assert.equal(compile[0], 'compile');
  assert.deepEqual(use, ['use', renderer.info.programs[0]], "the program's first use, not left for the first draw");
  assert.equal(compile[1], kitchen.group); assert.equal(compile[2], camera); assert.equal(compile[3], scene);
  assert.equal(kitchen.group.visible, false);
  assert.ok(textures.length >= 3 && textures.every(([what, texture]) => what === 'texture' && texture.isTexture));
  assert.equal(new Set(textures.map(c => c[1])).size, textures.length, 'each once');
  assert.ok(waits.some(v => v instanceof Promise), 'the compile is waited for');
  const hasFloor = new Set(); kitchen.group.traverse(n => { if (n.userData.floor) hasFloor.add(n.material.map); });
  assert.ok(textures.some(c => hasFloor.has(c[1])), 'the floor among them');
  const old = renderer.info.programs[0]; renderer.calls.length = 0;
  assert.equal([...kitchen.prepare(renderer, camera, scene)].length, 2, "asked again: the compile, its one new program, and no slice for a texture that's up");
  assert.ok(renderer.calls.every(c => c[1] !== old), 'a program from before is left alone');
});

test('where shaders would stall, the room and its textures still get ready, and the shaders are left to the first draw', t => {
  const { kitchen } = setup(t), renderer = fakeRenderer({ parallel: false }), builds = [];
  kitchen.add({ build: group => builds.push(group), update() {} });
  drain(kitchen.prepare(renderer, new THREE.PerspectiveCamera(), new THREE.Scene()));
  assert.deepEqual(builds, [kitchen.group]);
  assert.ok(kitchen.group.children.length > 10 && kitchen.pans);
  assert.ok(renderer.calls.length >= 3);
  assert.ok(renderer.calls.every(c => c[0] === 'texture'), 'no compile, no first use');
});

test('the doors opening before the shaders are done still leave them to be prepared, for what the first draw would not see', t => {
  const { kitchen } = setup(t), renderer = fakeRenderer(), steps = kitchen.prepare(renderer, new THREE.PerspectiveCamera(), new THREE.Scene());
  steps.next();
  kitchen.update(1 / 60, near, true, 0);
  drain(steps);
  assert.equal(renderer.calls.filter(c => c[0] === 'compile').length, 1);
  assert.ok(renderer.calls.some(c => c[0] === 'texture'));
});

// The kitchen reaches 9.5 m back from the room's front, so in a room shallower than that its back is behind the office's windows wall, where nothing else is built.
// The real room, with no desks; the smallest layout.js makes is 8 deep.
const WIDTH = 10;
function building(t, depth) {
  const was = globalThis.document; globalThis.document = { createElement: () => ({ getContext: blank }), fonts: undefined };
  t.after(() => { if (was) globalThis.document = was; else delete globalThis.document; });
  const room = createRoom(new THREE.Scene(), {}), size = { width: WIDTH, depth }, door = kitchenDoor(depth), { kitchen, secret } = room;
  room.sync({ room: size, door: { x: WIDTH / 2, z: depth }, desks: new Map(), pods: [], grid: { cols: 1, cellW: WIDTH - 1.9 } }, new Map());
  kitchen.update(1 / 60, V(-3, 1.6, door), true, 0); // built, the doors open
  return { room, kitchen, door, size, walls: room.colliders, bounds: secret.bounds(size) };
}

for (const depth of [8, 8.6, 9.2]) test(`in a room ${depth} deep you can walk to the kitchen's back wall, and no further`, t => {
  const { kitchen, door, walls, bounds } = building(t, depth), grid = walkGrid(walls, bounds), back = door + KITCHEN.back, spot = V(-0.9, 1.5, back + 0.32);
  assert.ok(back < 0, 'behind the windows wall');
  assert.ok(free(spot, walls, bounds), 'there is floor by the back wall');
  const path = findPath(grid, V(3, 0, door), spot); assert.ok(path, 'a route from the office');
  let at = V(3, 1.5, door);
  for (const to of path) for (let i = 0; i < 2000 && Math.hypot(to.x - at.x, to.z - at.z) > 0.03; i++) { const d = V(to.x - at.x, 0, to.z - at.z).clampLength(0, 0.05); at = resolveStep(at, d, walls, bounds); }
  assert.ok(Math.hypot(spot.x - at.x, spot.z - at.z) < 0.05, `walked to the back wall, got to ${at.x},${at.z}`);
  for (const dir of [V(0, 0, -0.05), V(0.05, 0, 0), V(0.05, 0, -0.05)]) { let p = at.clone(); for (let i = 0; i < 400; i++) p = resolveStep(p, dir, walls, bounds); assert.ok(kitchen.inside(p), `pushed along ${dir.toArray()}: still in, at ${p.x},${p.z}`); }
  const outside = V(5, 0, -0.1), stand = nearestOpen(grid, outside); assert.ok(stand.z > 0, `the nearest floor to the windows wall is in the office, not behind it (${stand.z})`);
  if (back < -0.8) assert.ok(!free(V(3, 1.5, bounds.back + 0.5), walls, bounds), 'no floor behind the office');
});

for (const depth of [8, 8.6]) test(`in a room ${depth} deep what's thrown at the kitchen's back stays in it`, t => {
  const { room, door, size, bounds } = building(t, depth), world = { colliders: room.flightColliders, columns: [], ceiling: WALL_H, onContact() {} }, reachable = p => reachableIn(room, size, p);
  const kind = { radius: 0.06, low: 0.06, bounce: 0.6, roll: 1, drag: 0.1, upright: false };
  let n = 0;
  for (const [x, z] of [[-0.9, -7.5], [-3, -6.8], [-9.3, -6.9], [-1, 0]]) for (let a = 0; a < 16; a++) for (const speed of [5, 12, 20]) for (const up of [-0.1, 0.4, 2]) {
    const home = V(x, 1.5, door + z), yaw = a * Math.PI / 8, b = { ...makeBody(kind, home, V(Math.sin(yaw) * speed, up * speed / 2, Math.cos(yaw) * speed)), home, turn: new THREE.Quaternion(), hits: new Set() };
    for (let i = 0; i < 480 && !b.rest; i++) { moveBody(b, 1 / 60, world, bounds, reachable); assert.ok(!escaped(b.pos, bounds), `escaped at ${b.pos.toArray()}`); assert.ok(reachable(b.pos), `thrown from ${x},${z} at ${a} ${speed} ${up}: out at ${b.pos.toArray()}`); }
    n++;
  }
  assert.ok(n > 500);
});

test('with the doors shut what\'s thrown from the office stays out, what\'s in stays in and on what it lands on', t => {
  const { room, kitchen, door, size, bounds } = building(t, 10), reachable = p => reachableIn(room, size, p), kind = { radius: 0.06, low: 0.06, bounce: 0.6, roll: 1, drag: 0.1, upright: false };
  kitchen.update(1 / 60, V(8, 1.6, door), true, 0); assert.equal(fill(kitchen).length, 1); room.refreshFlight();
  const out = { colliders: room.flightColliders, columns: [], ceiling: WALL_H, onContact() {} }, inn = { ...out, colliders: [...room.flightColliders, ...kitchen.within] };
  assert.ok(room.flightColliders.length < inn.colliders.length - 50);
  for (let a = -6; a <= 6; a++) for (const speed of [5, 12, 20]) for (const up of [-0.1, 0.4, 2]) {
    const yaw = -Math.PI / 2 + a * Math.PI / 16, home = V(1, 1.5, door), b = { ...makeBody(kind, home, V(Math.sin(yaw) * speed, up * speed / 2, Math.cos(yaw) * speed)), home, turn: new THREE.Quaternion(), hits: new Set() };
    for (let i = 0; i < 300 && !b.rest; i++) { moveBody(b, 1 / 60, out, bounds, reachable); assert.ok(!kitchen.inside(b.pos), `through the shut door at ${b.pos.toArray()}`); }
  }
  // Dropped over each thing that stands in there: it comes to rest above that thing.
  let on = 0;
  for (const box of kitchen.within.filter(box => box.max.y > 0.4 && box.max.y < 2 && box.max.x - box.min.x > 0.2 && box.max.z - box.min.z > 0.2)) {
    const home = V((box.min.x + box.max.x) / 2, box.max.y + 0.3, (box.min.z + box.max.z) / 2); if (kitchen.within.some(o => o !== box && o.containsPoint(home))) continue;
    const b = { ...makeBody(kind, home.clone(), V(0, 0, 0)), home: home.clone(), turn: new THREE.Quaternion(), hits: new Set() };
    for (let i = 0; i < 300 && !b.rest; i++) moveBody(b, 1 / 60, inn, bounds, reachable);
    if (b.pos.y > box.max.y) on++; assert.ok(kitchen.inside(b.pos));
  }
  assert.ok(on > 5, `on ${on}`);
});

test('nothing of the kitchen stands in the office, so its windows wall hides it', t => {
  const { kitchen, walls } = building(t, 8), on = (a, b) => Math.abs(a - b) < 1e-6, back = walls.find(b => on(b.min.x, -WALL_T) && on(b.max.z, 0) && b.max.x > WIDTH);
  assert.ok(flightBoxes(kitchen.origin).every(b => b.max.x <= 1e-9), 'all of it this side of x = 0');
  assert.ok(back && on(back.min.y, 0) && on(back.max.y, WALL_H), 'the windows wall reaches its corner, floor to ceiling');
  assert.ok(walls.some(b => b.surface === 'wall-e' && b.max.z === -WALL_T && b.min.x === -WALL_T), 'and the kitchen has its own east wall past it');
});

test("a tap through the open doorway walks there, either way: the casing's box doesn't fill it", t => {
  const was = globalThis.document; globalThis.document = { createElement: () => ({ getContext: blank }), fonts: undefined };
  t.after(() => { if (was) globalThis.document = was; else delete globalThis.document; });
  const scene = new THREE.Scene(), room = createRoom(scene, {}), depth = 14, door = kitchenDoor(depth), { kitchen } = room;
  room.sync({ room: { width: WIDTH, depth }, door: { x: WIDTH / 2, z: depth }, desks: new Map(), pods: [], grid: { cols: 1, cellW: WIDTH - 1.9 } }, new Map());
  kitchen.update(1 / 60, new THREE.Vector3(1, 0, door), true, 0);
  scene.updateMatrixWorld(true);
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }) }, camera = new THREE.PerspectiveCamera(70, 1, 0.05, 80);
  const tap = (from, to) => { camera.position.set(from, 1.5, door); camera.lookAt(to, 0, door); camera.updateMatrixWorld(); return pick({ clientX: 200, clientY: 200 }, canvas, camera, scene); };
  for (const [from, to] of [[1.2, -1.2], [-2, 1.2]]) {
    const hit = tap(from, to);
    assert.equal(hit?.kind, 'floor', `from x ${from}`);
    assert.ok(Math.abs(hit.point.x - to) < 0.01);
  }
});

test('at a meeting the doors open for anyone near them, and shut once nobody is', t => {
  const { kitchen } = setup(t);
  for (let i = 0; i < 60; i++) kitchen.update(1 / 60, far, false, 0, [{ x: near.x, z: near.z }]);
  assert.equal(kitchen.shown, true, 'someone else by the door');
  run(kitchen, far, 2);
  assert.equal(kitchen.shown, false);
});
