import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BOSS, CHAIR, DESK, DOOR_X, STAND, behindGlass, shutOffice } from '../client/office/boss-plan.js';
import { AISLE, layoutOffice } from '../client/office/layout.js';
import { CELL, findPath, nearestOpen, walkGrid } from '../client/office/path.js';
import { createRoom } from '../client/office/room.js';
import { createBossDesk, fitFov } from '../client/office/boss.js';
import { viewTest } from '../client/office/screens.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// A stand-in canvas that keeps what's written on it in `printed`.
const blank = printed => new Proxy({}, { get: (t, k) => k === 'fillText' ? text => printed.push(text) : k in t ? t[k] : () => ({ addColorStop() {} }), set: (t, k, v) => { t[k] = v; return true; } });
const noDocument = (t, printed = []) => { const was = globalThis.document; globalThis.document = { createElement: () => ({ getContext: () => blank(printed) }), fonts: undefined }; t.after(() => { if (was) globalThis.document = was; else delete globalThis.document; }); };
const full = (pods, seats = 6, helpers = () => 3) => { const sessions = []; for (let p = 0; p < pods; p++) for (let s = 0; s < seats; s++) { const id = `p${p}s${String(s).padStart(2, '0')}`; sessions.push({ id, cwd: `/p${p}`, project: `p${p}`, status: 'working' }); for (let h = 0; h < helpers(s); h++) sessions.push({ id: `${id}h${h}`, parentId: id, status: 'working' }); } return layoutOffice(sessions, null); };
// The smallest real room's width, `depth` deep, with nobody in it.
const emptyRoom = (depth, width = 8.6) => ({ room: { width, depth }, door: { x: width / 2, z: depth }, desks: new Map(), pods: [], grid: { cols: 1, cellW: width - AISLE } });
const build = layout => { const room = createRoom(new THREE.Scene(), { initTexture() {} }); room.sync(layout, new Map()); return room; };

const wide = (room, layout) => walkGrid(room.colliders, room.secret.bounds(layout.room));
const STAND_AT = V(STAND.x, 0, STAND.z), GLASS = BOSS.d + BOSS.glass / 2; // the front glass's plane
for (const [pods, seats] of [[1, 6], [4, 6], [16, 6], [2, 14]]) test(`with ${pods} projects of ${seats}, the boss desk is walked to through its door`, t => {
  noDocument(t);
  const layout = full(pods, seats, () => 2), room = build(layout), grid = wide(room, layout), door = V(layout.room.width / 2, 0, layout.room.depth - 0.6);
  const path = findPath(grid, door, STAND_AT); assert.ok(path, 'a way in');
  // Where it crosses the front glass's plane (the path's smoothed, so it needn't stop in the doorway on its way through).
  const way = [door, ...path], across = way.slice(1).flatMap((b, i) => { const a = way[i]; return (a.z > GLASS) !== (b.z > GLASS) ? [a.x + (b.x - a.x) * (a.z - GLASS) / (a.z - b.z)] : []; });
  assert.ok(across.length && across.every(x => Math.abs(x - DOOR_X) < BOSS.door / 2), `through the doorway: ${across}`);
});
// A metre and more between the desk (or its chair) and the walls, the glass and the statue, and each side walked to from the door.
for (const pods of [1, 4]) test(`with ${pods} projects, the boss's desk can be walked right round`, t => {
  noDocument(t);
  const layout = full(pods, 6, () => 2), room = build(layout), grid = wide(room, layout), door = V(layout.room.width / 2, 0, layout.room.depth - 0.6);
  const [desk, chair] = room.boss.desk.solids.map(box => box.clone().applyMatrix4(room.boss.desk.group.matrixWorld)), plinth = room.boss.colliders.at(-1);
  const gaps = { left: desk.min.x, right: BOSS.w - desk.max.x, back: chair.min.z, front: BOSS.d - desk.max.z };
  for (const [side, gap] of Object.entries(gaps)) assert.ok(gap >= 1.05, `${side} of the desk: ${gap.toFixed(2)} m`);
  assert.ok(plinth.max.x < desk.min.x - 0.5 || plinth.max.z < chair.min.z - 0.5 || plinth.min.z > desk.max.z + 0.5, 'the statue stands out of the way');
  const sides = { left: V(desk.min.x / 2, 0, DESK.z), right: V((desk.max.x + BOSS.w) / 2, 0, DESK.z), back: V(CHAIR.x, 0, chair.min.z / 2), front: V(DESK.x, 0, (desk.max.z + BOSS.d) / 2) };
  for (const [side, p] of Object.entries(sides)) {
    assert.ok(nearestOpen(grid, p).distanceTo(p) < 0.3, `room to stand ${side} of the desk`);
    assert.ok(findPath(grid, door, p), `${side} of the desk, from the door`);
  }
});
// The snake and the goose roam a copy of the walk grid with the office shut (office.js); you walk in through its door.
for (const pods of [1, 4]) test(`with ${pods} projects, the snake and the goose can't get into the boss's office, though you can`, t => {
  noDocument(t);
  const layout = full(pods, 6, () => 2), room = build(layout), grid = wide(room, layout), was = grid.open.slice(), roam = shutOffice(grid);
  const behind = k => behindGlass({ x: roam.left + (k % roam.cols + 0.5) * CELL, z: roam.back + (Math.floor(k / roam.cols) + 0.5) * CELL });
  assert.deepEqual(grid.open, was, "the walk grid's left as it was");
  assert.ok(grid.open.some((o, k) => o && behind(k)), 'there is floor in there');
  assert.ok(roam.open.every((o, k) => o === (behind(k) ? 0 : grid.open[k])), 'none of it open to them, and the rest of the floor as it was');
  assert.ok(findPath(grid, V(layout.room.width / 2, 0, layout.room.depth - 0.6), STAND_AT), 'you walk in');
});
// The glass pushes the pods forward, and with them the middle of the left wall: in the shallowest room the whiteboard still clears the bookshelf.
test("in the shallowest room, the whiteboard clears what stands against the left wall in front of the boss's glass", t => {
  noDocument(t);
  const layout = layoutOffice([], null), room = build(layout), { depth } = layout.room, board = new THREE.Box3().setFromObject(room.boards.whiteboard.parent);
  const against = room.furnitureColliders.filter(b => b.min.x < 0.1 && b.min.z >= BOSS.d + BOSS.glass && b.max.z <= depth / 2 + 2 && b.max.y > board.min.y);
  assert.ok(against.length, 'the bookshelf');
  for (const b of against) assert.ok(b.max.z + 0.05 <= board.min.z || b.min.z >= board.max.z + 0.05, `${b.min.z.toFixed(2)}..${b.max.z.toFixed(2)} under the whiteboard at ${board.min.z.toFixed(2)}..${board.max.z.toFixed(2)}`);
});
test('the door blocks flight while shut, and not once it opens', t => {
  noDocument(t);
  const room = build(emptyRoom(14)), way = V(DOOR_X, 1, GLASS), blocks = () => room.flightColliders.some(b => b.containsPoint(way));
  assert.ok(blocks());
  room.boss.update(1, V(DOOR_X, 0, GLASS + 1), true, 0); assert.ok(!blocks(), 'open for someone near (reduced motion: at once)');
  room.boss.update(1, V(DOOR_X, 0, 10), true, 0); assert.ok(blocks(), 'shut again');
});
test('the monitor and the chair sit you down', t => {
  noDocument(t);
  const room = build(emptyRoom(14)); let sat = 0; room.onBoss = () => sat++;
  room.boss.monitor.userData.toggle(); assert.equal(sat, 1);
});
test("the boss's office is all about the boss: your own fruit, drawn again only when it changes", t => {
  const printed = []; noDocument(t, printed);
  const { boss } = build(emptyRoom(14)), said = () => printed.join(' ');
  for (const line of ['BOSS OF THE YEAR', 'EMPLOYEE OF THE MONTH', '#1 BOSS', 'THE BOSS']) assert.ok(said().includes(line), line);
  const statue = boss.statue.geometry, drawn = boss.vanity.version;
  boss.dress('pear', '#3a86ff'); assert.ok(boss.vanity.version > drawn, 'redrawn'); assert.notEqual(boss.statue.geometry, statue, 'the statue is a pear now');
  const again = boss.vanity.version; boss.dress('pear', '#3a86ff'); assert.equal(boss.vanity.version, again, 'the same look: left as it is');
});

// Seated at the boss desk (createBossDesk): a camera as office.js has it, its canvas 1600 × 900 CSS px.
const camera = () => { const c = new THREE.PerspectiveCamera(50, 16 / 9); c.position.set(2, 1.6, 6); c.updateMatrixWorld(); c.userData.canvas = { clientWidth: 1600, clientHeight: 900 }; return c; };
const stubDesktop = (calls = [], placed = []) => ({ place: corners => { calls.push('place'); placed.push(corners); }, hide: () => calls.push('hide'), state: () => ({ window: null, cart: null, start: false }), root: {} });
const fonts = { load: () => Promise.resolve() };

test('the fov fits the screen inside 92% of the view at any window shape', () => {
  for (const aspect of [0.5, 1, 1.78, 2.5]) {
    const fov = fitFov(aspect, 0.75), half = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * 0.75;
    const h = 0.4 / (2 * half), w = 0.675 / (2 * half * aspect);
    assert.ok(Math.max(h, w) <= 0.921 && Math.max(h, w) >= 0.919, `aspect ${aspect}: ${h}, ${w}`);
  }
});
test('a screen counts as in view only in front of the camera and facing it', () => {
  const c = new THREE.PerspectiveCamera(50, 16 / 9); c.position.set(0, 1.6, 0); c.updateMatrixWorld();
  const anchor = (z, yaw) => { const a = new THREE.Object3D(); a.position.set(0, 1.6, z); a.rotation.y = yaw; a.updateMatrixWorld(); return a; };
  const seen = viewTest(c);
  assert.equal(seen(anchor(-2, 0)), true, '2 m in front, facing you');
  assert.equal(seen(anchor(-2, Math.PI)), false, 'turned away');
  assert.equal(seen(anchor(2, Math.PI)), false, 'behind you, facing you');
});
test("the boss desk keeps every key but Esc, has no blur, and leaving takes the desktop down", t => {
  noDocument(t);
  const calls = [], desktop = stubDesktop(calls);
  const game = createBossDesk({ annex: build(emptyRoom(10)).boss, desktop, camera: camera(), fonts });
  assert.equal(game.exact, true); assert.equal(game.blur, undefined, "the cart's iframe taking focus blurs the window: that mustn't stop it");
  assert.equal(game.key('KeyW', true), true); assert.equal(game.key('ArrowLeft', true), true); assert.equal(game.key('Escape', true), false);
  assert.deepEqual(game.stand(), STAND);
  game.enter(); game.update(0.016, { still: false, friend: null, arrived: true }); assert.ok(calls.includes('place'));
  game.update(0.016, { still: false, friend: null, arrived: false }); assert.equal(calls.at(-1), 'hide', 'gone before the camera pulls back');
  game.leave(); assert.equal(calls.at(-1), 'hide');
});
test("seated, the desktop's laid over the monitor, centred and 92% of the view", t => {
  noDocument(t);
  const placed = [], annex = build(emptyRoom(14)).boss, cam = camera(), game = createBossDesk({ annex, desktop: stubDesktop([], placed), camera: cam, fonts });
  game.enter();
  for (const aspect of [16 / 9, 0.6]) {
    cam.aspect = aspect; cam.userData.canvas = { clientWidth: 900 * aspect, clientHeight: 900 };
    const pose = game.pose(); cam.fov = pose.fov; cam.updateProjectionMatrix(); cam.position.copy(pose.from); cam.lookAt(pose.look); cam.updateMatrixWorld();
    assert.ok(pose.from.distanceTo(pose.look) > 0.74 && pose.from.distanceTo(pose.look) < 0.76, 'from 0.75 m');
    assert.ok(pose.from.z < pose.look.z, "from the boss's side of the monitor");
    game.update(0.016, { still: false, friend: null, arrived: true });
    const [tl, tr, br, bl] = placed.at(-1), w = 900 * aspect, mid = { x: (tl.x + br.x) / 2, y: (tl.y + br.y) / 2 };
    assert.ok(Math.abs(mid.x - w / 2) < 1 && Math.abs(mid.y - 450) < 1, `centred: ${mid.x}, ${mid.y}`);
    assert.ok(tl.x < tr.x && tl.y < bl.y && Math.abs(tr.y - tl.y) < 1 && Math.abs(bl.x - tl.x) < 1, 'upright, top-left first');
    const fill = Math.max((tr.x - tl.x) / w, (bl.y - tl.y) / 900);
    assert.ok(fill > 0.91 && fill < 0.93, `fills ${fill}`);
  }
});
test('the monitor is drawn again once Silkscreen has loaded', async t => {
  noDocument(t);
  let loaded; const annex = build(emptyRoom(10)).boss, slow = { load: () => new Promise(r => { loaded = r; }) };
  createBossDesk({ annex, desktop: stubDesktop(), camera: camera(), fonts: slow }); const before = annex.texture.version;
  loaded(); await new Promise(r => setImmediate(r));
  assert.ok(annex.texture.version > before);
});
test("the monitor's drawn when the minute turns, only while it's in view, and the desktop's state when you're at it", t => {
  noDocument(t);
  const annex = build(emptyRoom(14)).boss, cam = camera(), state = { window: null, cart: null, start: false };
  let minute = 0; const desktop = { ...stubDesktop(), state: () => ({ ...state }) };
  const game = createBossDesk({ annex, desktop, camera: cam, fonts, now: () => new Date(2026, 10, 11, 9, minute).getTime() });
  const look = game.pose(), facing = () => { cam.fov = 50; cam.updateProjectionMatrix(); cam.position.copy(look.from).add(V(0, 0.3, -1.2)); cam.lookAt(look.look); cam.updateMatrixWorld(); };
  const away = () => { cam.position.set(2, 1.6, 8); cam.lookAt(2, 1.6, 12); cam.updateMatrixWorld(); };
  const tick = () => game.update(0.2, { still: false, friend: null, arrived: false }), drawn = () => annex.texture.version;
  facing(); tick(); let v = drawn(); tick(); assert.equal(drawn(), v, 'the same minute: left as it is');
  minute = 1; away(); tick(); assert.equal(drawn(), v, 'out of view: not drawn');
  facing(); tick(); assert.ok(drawn() > v, 'back in view: drawn'); v = drawn();
  game.enter(); tick(); v = drawn(); state.start = true; tick(); assert.ok(drawn() > v, "the desktop's Start menu opened");
});
