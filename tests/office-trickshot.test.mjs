import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTrickshot } from '../client/office/trickshot.js';
import { BLEND, arcPoints, blendLeft, createArc, drawnAt, launch } from '../client/office/throwing.js';
import { makeBody, simulate } from '../client/office/flight.js';
import { levelWorld } from '../client/office/kitchen-plan.js';
import { EYE, Player } from '../client/office/player.js';
import { ITEMS, MONDAY, STARTS } from '../client/office/levels.js';
import { loadProgress } from '../client/office/progress.js';
import { FLIGHT, SLOW } from '../client/office/shot.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z), rad = d => d * Math.PI / 180;
const look = (yaw, pitch) => V(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
const ORIGIN = { x: -0.2, z: 5 }, DT = 1 / 60;
// Throws that do it, from tests/office-levels.test.mjs's search: yaw and pitch in radians.
const IN = { yaw: 2.416772208600941, pitch: 0.17453292519943295, charge: 0.625 }; // the paper ball into the sink, off a cupboard and the wall
const WEDGED = { yaw: rad(-129), pitch: rad(17), charge: 1 }; // a rubber ball from the far table, still a metre up at 8 s

function setup({ aim, reduced = false, holding = false, store } = {}) {
  const calls = [], saved = [], group = new THREE.Group(), camera = { position: V(0, EYE, 0) };
  const props = { holding, throw(direction, drop) { calls.push(['drop', direction, drop]); props.holding = false; }, loose: () => [] };
  const hand = { palm: new THREE.Object3D(), held: null, hold(mesh, radius) { calls.push(['hold', mesh, radius]); hand.held = mesh; }, free() { calls.push(['free']); hand.held?.removeFromParent(); hand.held = null; }, pull(level) { calls.push(['pull', level]); } };
  const kitchen = { origin: ORIGIN, group, doors: [], shut(on) { kitchen.doors.push(on); } };
  const view = { plays: [], play(pose) { view.plays.push(pose); }, gameAmount: 0 };
  const memory = store ?? { value: null, getItem() { return memory.value; }, setItem(key, value) { memory.value = value; saved.push(value); } };
  const onPlay = game => { calls.push(['play', game]); camera.position.set(game.stand().x, EYE, game.stand().z); };
  const game = createTrickshot({ kitchen, hand, camera, props, view, onPlay, aim, store: memory, reducedMotion: () => reduced });
  game.build(group);
  return { game, calls, saved, group, camera, props, hand, kitchen, view, memory };
}
// Started the way a click starts it: walked to the mark, then in.
const begin = (t, id) => { t.game.start(t.game.entry(id)); t.game.enter(); const { x, z } = t.game.stand(); t.hand.palm.position.set(x - 0.2, EYE - 0.27, z + 0.2); };
const play = (t, seconds = 20) => { for (let i = 0; i < seconds * 60 && t.game.run.state === 'flying'; i++) t.game.update(DT, null, false, true); };
const throwIt = (t, { yaw, pitch, charge }) => t.game.release(charge, look(yaw, pitch));
const item = (t, id) => t.game.item(id);

test('a free game with the thrower\'s methods', () => {
  const { game } = setup();
  assert.equal(game.free, true);
  for (const name of ['build', 'update', 'stand', 'enter', 'leave', 'click', 'key', 'release', 'abort', 'start', 'entry']) assert.equal(typeof game[name], 'function', name);
  assert.equal(game.holding, false);
  assert.equal(game.entry('mug').item, 'mug');
});

test('its mark is in the room\'s frame, facing the way the level says', () => {
  const { game } = setup();
  game.start(game.entry('mug'));
  const { x, z, stand } = STARTS.fridge, spot = game.stand();
  assert.deepEqual([spot.x, spot.z, spot.yaw], [ORIGIN.x + x, ORIGIN.z + z, stand]);
});

test('starting a level drops what you\'re carrying', () => {
  const t = setup({ holding: true });
  begin(t, 'paper');
  const steps = t.calls.map(c => c[0]), drops = t.calls.filter(c => c[0] === 'drop');
  assert.equal(drops.length, 1);
  assert.deepEqual(drops[0].slice(1), [null, true]);
  assert.ok(steps.indexOf('drop') < steps.indexOf('hold'));
  assert.equal(t.hand.held, item(t, 'paper'));
  assert.equal(t.calls.find(c => c[0] === 'hold')[2], ITEMS.paper.radius);
  assert.equal(t.game.holding, true);
  assert.equal(t.game.heldKind, ITEMS.paper);
});

test('nothing is dropped when your hand is empty', () => {
  const t = setup();
  begin(t, 'paper');
  assert.equal(t.calls.filter(c => c[0] === 'drop').length, 0);
});

test('the doors stay shut while a level runs', () => {
  const t = setup();
  begin(t, 'paper');
  assert.deepEqual(t.kitchen.doors, [true]);
});

test('R resets to the start mark with the score cleared', () => {
  const t = setup();
  begin(t, 'paper');
  throwIt(t, IN); play(t);
  assert.equal(t.game.run.state, 'done');
  assert.ok(t.game.score);
  assert.equal(t.game.key('KeyR', true), true);
  assert.equal(t.game.run.state, 'aiming');
  assert.equal(t.game.score, null);
  assert.equal(t.hand.held, item(t, 'paper'));
  assert.equal(t.game.holding, true);
  assert.equal(t.game.key('KeyR', false), false);
});

test('R resets a shot still in the air, and it stays reset', () => {
  const t = setup();
  begin(t, 'paper');
  throwIt(t, IN);
  for (let i = 0; i < 20; i++) t.game.update(DT, null, false, true);
  assert.equal(t.game.run.state, 'flying');
  assert.equal(t.hand.held, null);
  t.game.key('KeyR', true);
  assert.equal(t.game.run.state, 'aiming');
  assert.equal(t.hand.held, item(t, 'paper'));
  const saves = t.saved.length;
  for (let i = 0; i < 200; i++) t.game.update(DT, null, false, true);
  assert.equal(t.game.score, null);
  assert.equal(t.saved.length, saves);
});

test('a click after the shot goes again, for a finger with no R; in the air it does nothing', () => {
  const t = setup();
  begin(t, 'paper');
  t.game.click(look(0, 0));
  assert.equal(t.game.run.state, 'aiming');
  throwIt(t, IN);
  t.game.click(look(0, 0));
  assert.equal(t.game.run.state, 'flying');
  play(t);
  t.game.click(look(0, 0));
  assert.equal(t.game.run.state, 'aiming');
});

test('leaving puts the item back on its spot and opens the doors', () => {
  const t = setup();
  const spot = item(t, 'paper').position.clone();
  begin(t, 'paper');
  t.game.leave();
  assert.deepEqual(t.kitchen.doors, [true, false]);
  assert.equal(t.hand.held, null);
  assert.equal(t.game.holding, false);
  assert.deepEqual(item(t, 'paper').position.toArray(), spot.toArray());
  assert.ok(item(t, 'paper').parent, 'it\'s back in the room');
});

test('leaving mid-flight stops the shot where it is, and it\'s not scored', () => {
  const t = setup();
  const spot = item(t, 'paper').position.clone();
  begin(t, 'paper');
  throwIt(t, IN);
  for (let i = 0; i < 10; i++) t.game.update(DT, null, false, true);
  t.game.leave();
  for (let i = 0; i < 300; i++) t.game.update(DT, null, false, true);
  assert.deepEqual(item(t, 'paper').position.toArray(), spot.toArray());
  assert.deepEqual(t.game.progress.lines, {});
  assert.equal(t.saved.length, 0);
});

test('an item put away stays there, and picking it up replays its level', () => {
  const t = setup();
  const spot = item(t, 'paper').position.clone();
  begin(t, 'paper');
  throwIt(t, IN); play(t);
  const rest = t.game.run.result.pos;
  t.game.leave();
  assert.deepEqual(item(t, 'paper').position.toArray(), rest);
  assert.notDeepEqual(item(t, 'paper').position.toArray(), spot.toArray());
  // Picked up where it lies: back to the mark, in hand.
  let holder = item(t, 'paper'); while (!holder.userData.toggle) holder = holder.parent;
  holder.userData.toggle();
  assert.equal(t.calls.at(-1)[0], 'play');
  const { x, z } = STARTS.island, at = t.game.stand();
  assert.deepEqual([at.x, at.z], [ORIGIN.x + x, ORIGIN.z + z]);
  t.game.enter();
  assert.equal(t.game.run.state, 'aiming');
  assert.equal(t.hand.held, item(t, 'paper'));
  assert.equal(t.game.score, null);
});

test('put away last time, it\'s in its target when the page comes back', () => {
  const memory = { value: JSON.stringify({ lines: { paper: { away: true, trick: false, score: false } }, best: { paper: 100 }, daily: {} }), getItem() { return memory.value; }, setItem() {} };
  const t = setup({ store: memory });
  const { x, y, z } = item(t, 'paper').position;
  assert.ok(x > -7.1 && x < -6.5 && z > -7.92 && z < -7.62, 'in the sink');
  assert.ok(y > 0.6 && y < 0.91, 'in the sink');
});

test('a made shot records its lines and best; a daily shot records only its daily', () => {
  const t = setup();
  begin(t, 'paper');
  throwIt(t, IN); play(t);
  const { result } = t.game.run;
  assert.ok(result.made);
  assert.equal(t.game.progress.lines.paper.away, true);
  assert.equal(t.game.progress.best.paper, result.score);
  assert.deepEqual(t.game.progress.daily, {});
  assert.equal(loadProgress(t.memory).best.paper, result.score, 'and it\'s saved');
  t.game.leave();

  const d = setup();
  d.game.start({ item: 'paper', start: 'island', target: 'sink', day: '2026-10-31', index: 1 }); d.game.enter();
  throwIt(d, IN); play(d);
  assert.ok(d.game.run.result.made);
  assert.deepEqual(d.game.progress.lines, {});
  assert.deepEqual(d.game.progress.best, {});
  assert.deepEqual(d.game.progress.daily['2026-10-31'], [null, d.game.run.result.score, null]);
  assert.deepEqual(loadProgress(d.memory).daily['2026-10-31'], [null, d.game.run.result.score, null], 'and it\'s saved');
  // A daily's item isn't put away.
  const spot = setup().game.item('paper').position.toArray();
  d.game.leave();
  assert.deepEqual(item(d, 'paper').position.toArray(), spot);
});

test('a shot without a level or a day keeps nothing', () => {
  const t = setup();
  t.game.start({ item: 'paper', start: 'island', target: 'sink' }); t.game.enter();
  throwIt(t, IN); play(t);
  assert.ok(t.game.run.result.made);
  assert.ok(t.game.score);
  assert.equal(t.saved.length, 0);
});

test('a miss scores nothing and says so; a made shot says its points and multiplier', () => {
  const t = setup();
  begin(t, 'paper');
  throwIt(t, IN); play(t);
  const { points, multiplier, score } = t.game.run.result;
  assert.equal(t.game.score, `${points} × ${multiplier} = ${score}`);
  t.game.key('KeyR', true);
  t.game.release(0, look(STARTS.island.stand, 0)); play(t);
  assert.equal(t.game.run.result.made, false);
  assert.equal(t.game.score, 'Miss');
});

test('a shot stopped in mid-air isn\'t left floating', () => {
  const t = setup();
  begin(t, 'rubber');
  t.camera.position.set(ORIGIN.x + STARTS.farTable.x, EYE, ORIGIN.z + STARTS.farTable.z);
  throwIt(t, WEDGED); play(t);
  assert.equal(t.game.run.state, 'aiming');
  assert.equal(t.hand.held, item(t, 'rubber'));
  assert.equal(t.game.score, 'Miss');
});

test('the arc covers the first 0.6 s and matches the shot\'s path', () => {
  const aim = { direction: look(IN.yaw, IN.pitch), charge: IN.charge }, t = setup({ aim: () => aim });
  begin(t, 'paper');
  t.game.update(DT, null, false, true);
  const dots = t.game.arc.points, { x, z } = STARTS.island, eye = V(x, EYE, z);
  assert.ok(dots.length >= 18 && dots.length <= 36 && dots.length % 3 === 0, `${dots.length / 3} dots`);
  assert.ok(t.game.arc.mesh.visible);
  assert.equal(t.game.arc.mesh.count, dots.length / 3);
  assert.equal(t.game.arc.mesh.parent !== null, true, 'it\'s in the room');

  const { pos, vel } = launch(ITEMS.paper, IN.charge, { position: eye }, aim.direction, V(0, 0, 0));
  const { path } = simulate(makeBody(ITEMS.paper, pos, vel), levelWorld(), { maxTime: 0.6 });
  let from = 0, after = 0;
  for (let i = 0; i < dots.length; i += 3) {
    if (t.game.arc.times[i / 3] < BLEND) continue; // still coming from the hand
    after++;
    while (from < path.length && !(path[from] === dots[i] && path[from + 1] === dots[i + 1] && path[from + 2] === dots[i + 2])) from += 3;
    assert.ok(from < path.length, `dot ${i / 3} is on the path, in order`);
  }
  assert.ok(after >= 6, `${after} dots after the blend`);

  // The same as what's thrown.
  t.game.release(IN.charge, aim.direction);
  const flown = t.game.run.result.path;
  for (let i = 0; i < path.length; i++) assert.equal(flown[i], path[i]);
  assert.equal(t.game.arc.mesh.visible, false, 'gone with the throw');
});

test('the arc starts at the hand and is on the true path by the blend\'s end', () => {
  const aim = { direction: look(IN.yaw, IN.pitch), charge: IN.charge }, t = setup({ aim: () => aim });
  begin(t, 'paper');
  t.game.update(DT, null, false, true);
  const { arc } = t.game, palm = t.hand.palm.getWorldPosition(V(0, 0, 0)).sub(V(ORIGIN.x, 0, ORIGIN.z));
  assert.ok(V(...arc.points.subarray(0, 3)).distanceTo(palm) < 0.2, `first dot ${V(...arc.points.subarray(0, 3)).distanceTo(palm)} m from the palm`);
  const { x, z } = STARTS.island, pure = arcPoints(ITEMS.paper, launch(ITEMS.paper, IN.charge, { position: V(x, EYE, z) }, aim.direction, V(0, 0, 0)), levelWorld(), V(x, EYE, z));
  assert.equal(pure.length, arc.points.length);
  let gap = Infinity;
  for (let i = 0; i < pure.length; i += 3) {
    const off = V(...arc.points.subarray(i, i + 3)).distanceTo(V(...pure.subarray(i, i + 3)));
    if (arc.times[i / 3] >= BLEND) assert.equal(off, 0, `dot ${i / 3}`);
    else { assert.ok(off <= gap + 1e-6, `dot ${i / 3} is nearer the path than the one before`); gap = off; }
  }
});

test('the arc follows the hand without working the way out again', () => {
  const eye = V(0, EYE, 0), thrown = launch(ITEMS.rubber, 0.5, { position: eye }, V(0, 0.2, 1).normalize(), V(0, 0, 0));
  const open = { colliders: [], columns: [], ceiling: 50 }, arc = createArc(), palm = V(-0.3, EYE - 0.3, 0.2);
  let runs = 0; const world = { ...open, get columns() { runs++; return open.columns; } }; // only a flight asks for them
  arc.show(ITEMS.rubber, thrown, world, eye, palm);
  const first = arc.points, worked = runs;
  arc.show(ITEMS.rubber, thrown, world, eye, palm.clone().addScalar(1e-4)); // the sway settling
  assert.equal(arc.points, first);
  arc.show(ITEMS.rubber, thrown, world, eye, palm.clone().setY(EYE - 0.1));
  assert.notEqual(arc.points, first);
  assert.ok(arc.points[1] > first[1], 'the first dot went with it');
  const last = arc.points.length - 3;
  assert.deepEqual([...arc.points.subarray(last)], [...first.subarray(last)], 'past the blend it\'s the same');
  assert.ok(worked > 0); assert.equal(runs, worked, 'no flight worked out for a hand');
});

test('a thrown item is drawn from the hand and is where it truly is by the blend\'s end', () => {
  for (const reduced of [false, true]) {
    const t = setup({ reduced });
    begin(t, 'paper');
    t.game.update(DT, null, false, true);
    throwIt(t, IN);
    const mesh = item(t, 'paper'), palm = t.hand.palm.getWorldPosition(V(0, 0, 0)).sub(V(ORIGIN.x, 0, ORIGIN.z)), truly = V(0, 0, 0);
    assert.ok(mesh.position.distanceTo(palm) < 1e-9, 'let go at the palm');
    const start = t.game.run.at(truly).clone();
    assert.ok(start.distanceTo(palm) > 0.1, 'which isn\'t where it flies from');
    let was = Infinity;
    while (t.game.run.time < BLEND) {
      t.game.update(DT, null, false, true);
      const off = mesh.position.distanceTo(t.game.run.at(truly));
      assert.ok(off <= was + 1e-9, `${off} m off at ${t.game.run.time} s`); was = off;
    }
    assert.equal(mesh.position.distanceTo(t.game.run.at(truly)), 0);
    play(t);
    assert.ok(mesh.position.equals(t.game.run.at(truly)) || t.game.run.state === 'aiming');
  }
  assert.equal(blendLeft(0), 1); assert.equal(blendLeft(BLEND), 0); assert.equal(blendLeft(BLEND * 2), 0);
});

test('what\'s drawn from the hand doesn\'t go through a wall', () => {
  const wall = Object.assign(new THREE.Box3(V(-2, 0, 0.8), V(2, 3, 1)), { surface: 'wall' }), kind = ITEMS.rubber, world = { colliders: [wall], columns: [], ceiling: 50 };
  const onFace = wall.min.z - kind.radius, pos = V(0, 1.5, onFace - 0.01), out = V(0, 0, 0);
  // A palm reaching through the wall in front of you.
  drawnAt(out, pos, V(-0.3, -0.3, 0.5), 0, kind, world.colliders);
  assert.ok(out.z <= onFace + 1e-6, `${out.z}`);
  assert.equal(drawnAt(out, pos, V(-0.3, -0.3, 0.5), BLEND, kind, world.colliders).distanceTo(pos), 0);
  const eye = V(0, 1.5, 0.3), arc = createArc(), thrown = launch(kind, 0.5, { position: eye }, V(0, 0, 1), V(0, 0, 0));
  arc.show(kind, thrown, world, eye, V(-0.2, 1.2, 1.5));
  assert.ok(arc.points.length > 0);
  for (let i = 2; i < arc.points.length; i += 3) assert.ok(arc.points[i] <= onFace + 1e-3, `dot ${(i - 2) / 3} at ${arc.points[i]}`);
});

test('the arc stops at 4 m of flight and at 0.6 s', () => {
  const eye = V(0, EYE, 0), hard = launch(ITEMS.rubber, 1, { position: eye }, V(0, 0.2, 1).normalize(), V(0, 0, 0));
  const open = { colliders: [], columns: [], ceiling: 50 }, dots = arcPoints(ITEMS.rubber, hard, open, eye);
  let far = 0, last = hard.pos;
  for (let i = 0; i < dots.length; i += 3) { const p = V(dots[i], dots[i + 1], dots[i + 2]); far += p.distanceTo(last); last = p; }
  assert.ok(far <= 4 && far > 3.3, `${far} m`);
  const soft = launch(ITEMS.teabag, 0, { position: eye }, V(0, 0, 1), V(0, 0, 0)), slow = arcPoints(ITEMS.teabag, soft, open, eye);
  const { path } = simulate(makeBody(ITEMS.teabag, soft.pos, soft.vel), open, { maxTime: 0.6 });
  assert.deepEqual([...slow.slice(-3)], [...path.slice(-3)], 'it reaches 0.6 s');
});

test('the arc follows aim and charge, and isn\'t worked out again without a change', () => {
  const aim = { direction: look(0, 0), charge: 0 }, t = setup({ aim: () => aim });
  begin(t, 'paper');
  t.game.update(DT, null, false, true);
  const first = t.game.arc.points;
  t.game.update(DT, null, false, true);
  assert.equal(t.game.arc.points, first);
  aim.charge = 0.5; t.game.update(DT, null, false, true);
  assert.notEqual(t.game.arc.points, first);
  const second = t.game.arc.points;
  aim.direction = look(0.3, 0); t.game.update(DT, null, false, true);
  assert.notEqual(t.game.arc.points, second);
});

test('a throw stays where it is if the room grows under it', () => {
  const t = setup(), other = setup();
  begin(t, 'paper'); begin(other, 'paper');
  throwIt(t, IN); throwIt(other, IN);
  t.kitchen.origin = { x: ORIGIN.x, z: ORIGIN.z + 3 }; // kitchen.moved has moved you along with it
  t.camera.position.z += 3;
  for (let i = 0; i < 30; i++) { t.game.update(DT, null, false, true); other.game.update(DT, null, false, true); }
  assert.deepEqual(item(t, 'paper').position.toArray(), item(other, 'paper').position.toArray());
});

// Everything that the camera can be in, by what's on hand: the same boxes as a flight.
const inBox = p => levelWorld().colliders.find(box => {
  if (!box.inverse) return p.x > box.min.x && p.x < box.max.x && p.y > box.min.y && p.y < box.max.y && p.z > box.min.z && p.z < box.max.z;
  const q = p.clone().sub(box.centre).applyQuaternion(box.inverse);
  return Math.abs(q.x) < box.half.x && Math.abs(q.y) < box.half.y && Math.abs(q.z) < box.half.z;
});
const poseLocal = (t, key) => { const p = t.view.plays.at(-1)()[key]; return V(p.x - ORIGIN.x, p.y, p.z - ORIGIN.z); };
const SHOTS = { paper: IN, rubber: { yaw: 2.5156756047097217, pitch: rad(10), charge: 1 }, roll: { yaw: 0.17756142103488476, pitch: rad(25), charge: 1 }, mug: { yaw: -1.5784087546712922, pitch: rad(5), charge: 0.25 }, plate: { yaw: 1.6271065558422666, pitch: rad(25), charge: 0.25 }, teabag: { yaw: 0.2761636434773391, pitch: rad(5), charge: 1 } };

test('from release the camera follows every throw, made or missed, and holds on where it landed before it hands back', () => {
  const t = setup();
  begin(t, 'paper');
  throwIt(t, { ...IN, yaw: IN.yaw + 0.5 }); // not the sink
  assert.ok(t.view.plays.at(-1), 'at once');
  const pose = t.view.plays.at(-1)();
  for (const key of ['from', 'look', 'fov']) assert.ok(pose[key], key);
  assert.equal(pose.hands, false);
  const { x, z } = t.game.stand();
  assert.ok(Math.hypot(pose.from.x - x, pose.from.z - z) < 1e-9, 'from your own eyes');
  // It keeps its place between frames: the camera's own place has no say.
  const was = pose.from.toArray(); t.camera.position.set(9, 9, 9);
  assert.deepEqual(t.view.plays.at(-1)().from.toArray(), was);
  while (t.game.run.state === 'flying') t.game.update(DT, null, false, true);
  assert.notEqual(t.game.run.result.made, true);
  assert.ok(t.view.plays.at(-1), 'still on it at the end');
  const end = V(...t.game.run.result.pos);
  for (let i = 0; i < 50; i++) t.game.update(DT, null, false, true);
  assert.ok(t.view.plays.at(-1), 'holds');
  assert.ok(poseLocal(t, 'look').distanceTo(end) < 0.02, 'looking at where it landed');
  for (let i = 0; i < 20; i++) t.game.update(DT, null, false, true);
  assert.equal(t.view.plays.at(-1), null, 'back to the mark after about a second');
});

test('the camera trails the item, looks at it and is never in anything, on all six shots', () => {
  for (const id of Object.keys(SHOTS)) {
    const t = setup(), { start } = MONDAY.find(e => e.id === id), truly = V(0, 0, 0), eye = V(STARTS[start].x, EYE, STARTS[start].z);
    begin(t, id); throwIt(t, SHOTS[id]);
    let amount = 0, frames = 0, close = 0, biggest = 0, last = null; // the camera's own easing onto the pose, as camera.js does it
    while (t.game.run.state === 'flying') {
      t.game.update(DT, null, false, true); frames++;
      amount += (1 - amount) * (1 - Math.exp(-DT * 5));
      const from = poseLocal(t, 'from'), look = poseLocal(t, 'look'), seen = eye.clone().lerp(from, amount);
      for (const p of [from, seen]) {
        assert.ok(!inBox(p), `${id} frame ${frames}: in ${inBox(p)?.surface}, ${p.toArray()}`);
        assert.ok(p.x > -10 && p.x < 0 && p.z > -8 && p.z < 1 && p.y > 0 && p.y < 3.2, `${id}: left the room, ${p.toArray()}`);
      }
      t.game.run.at(truly);
      if (last) biggest = Math.max(biggest, from.distanceTo(last)); last = from;
      if (look.distanceTo(truly) < 1) close++;
    }
    assert.ok(close / frames > 0.5, `${id}: looks at the item, ${close} of ${frames} frames within 1 m`);
    assert.ok(biggest < 0.25, `${id}: no jerk, biggest step ${biggest} m`);
    assert.ok(poseLocal(t, 'from').distanceTo(V(...t.game.run.result.pos)) < 3.5, `${id}: it caught up`);
  }
});

test('nor on any other throw, wherever it goes', () => {
  let seed = 7; const random = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  for (let n = 0; n < 60; n++) {
    const { id, start } = MONDAY[n % MONDAY.length], t = setup();
    begin(t, id); throwIt(t, { yaw: random() * Math.PI * 2, pitch: rad(random() * 70 - 20), charge: 0.1 + random() * 0.9 });
    for (let i = 0; t.game.run.state === 'flying' || i < 60; i++) {
      t.game.update(DT, null, false, true);
      if (!t.view.plays.at(-1)) break;
      const from = poseLocal(t, 'from');
      assert.ok(!inBox(from), `${id} from ${start}, throw ${n}: in ${inBox(from)?.surface}, ${from.toArray()}`);
      assert.ok(from.x > -10 && from.x < 0 && from.z > -8 && from.z < 1 && from.y > 0 && from.y < 3, `${id}, throw ${n}: left the room, ${from.toArray()}`);
    }
  }
});

test('behind the item and above it, coming round slowly after a bounce', () => {
  const t = setup();
  begin(t, 'paper'); throwIt(t, IN);
  const truly = V(0, 0, 0);
  for (let i = 0; i < 18; i++) t.game.update(DT, null, false, true);
  t.game.run.at(truly);
  const from = poseLocal(t, 'from'), ahead = look(IN.yaw, 0);
  assert.ok(truly.clone().sub(from).dot(ahead) > 0, 'the item\'s ahead of it');
  assert.ok(from.y > EYE - 0.1, 'and it isn\'t under it');
});

test('R, leaving and a stuck shot take the camera back', () => {
  const again = setup();
  begin(again, 'paper'); throwIt(again, IN);
  for (let i = 0; i < 10; i++) again.game.update(DT, null, false, true);
  assert.ok(again.view.plays.at(-1));
  again.view.gameAmount = 0.8;
  again.game.key('KeyR', true);
  assert.equal(again.view.plays.at(-1), null); assert.equal(again.view.gameAmount, 0);
  const off = setup();
  begin(off, 'paper'); throwIt(off, IN);
  for (let i = 0; i < 10; i++) off.game.update(DT, null, false, true);
  off.view.gameAmount = 0.8;
  off.game.leave();
  assert.equal(off.view.plays.at(-1), null); assert.equal(off.view.gameAmount, 0);
  const stuck = setup();
  begin(stuck, 'rubber'); throwIt(stuck, WEDGED); play(stuck);
  assert.equal(stuck.game.run.state, 'aiming'); assert.equal(stuck.view.plays.at(-1), null);
  const count = stuck.view.plays.length;
  for (let i = 0; i < 90; i++) stuck.game.update(DT, null, false, true);
  assert.equal(stuck.view.plays.length, count, 'and it doesn\'t come back');
});

test('slow motion on a made shot, on top of the whole flight\'s gentle rate', () => {
  const t = setup();
  begin(t, 'paper'); throwIt(t, IN);
  assert.equal(t.game.run.timeScale, FLIGHT);
  const seen = new Set();
  while (t.game.run.state === 'flying') { t.game.update(DT, null, false, true); seen.add(t.game.run.timeScale); }
  assert.ok(t.game.run.result.made);
  assert.ok(seen.has(FLIGHT) && seen.has(SLOW));
});

test('with reduced motion there\'s no slow motion, camera move or celebration, just the score', () => {
  const t = setup({ reduced: true });
  begin(t, 'paper');
  throwIt(t, IN);
  while (t.game.run.state === 'flying') { t.game.update(DT, null, true, true); assert.equal(t.game.run.timeScale, 1); }
  assert.equal(t.view.plays.filter(Boolean).length, 0);
  assert.equal(t.game.party.visible, false);
  assert.ok(t.game.score);
});

test('no level item is in props.loose()', () => {
  const t = setup(), loose = [];
  t.group.traverse(node => { if (node.userData.loose || node.userData.prop) loose.push(node); });
  assert.deepEqual(loose, []);
  assert.deepEqual(t.props.loose(), []);
  for (const { id } of MONDAY) assert.ok(item(t, id));
});

test('all six items stand in the room, each with its own toggle', () => {
  const t = setup();
  const toggles = new Set(MONDAY.map(({ id }) => { let n = item(t, id); while (n && !n.userData.toggle) n = n.parent; return n; }));
  assert.equal(toggles.size, 6);
  const spots = MONDAY.map(({ id }) => item(t, id).position.toArray().join());
  assert.equal(new Set(spots).size, 6, 'two on one mark stand apart');
});

test('abort keeps it in hand, and the hand comes back', () => {
  const t = setup();
  begin(t, 'paper');
  t.game.abort();
  assert.deepEqual(t.calls.at(-1), ['pull', 0]);
  assert.equal(t.game.holding, true);
});

// Pinned: for a game played from your own eyes.
function pinned(t) {
  const handlers = {}, target = { addEventListener: (type, fn) => { handlers[type] = fn; }, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), setPointerCapture() {}, classList: { contains: () => false }, hasFocus: () => true };
  const was = { document: globalThis.document, window: globalThis.window };
  globalThis.document = { ...target, body: { classList: { contains: () => false } }, querySelector: () => null, activeElement: null };
  globalThis.window = target;
  t.after(() => Object.assign(globalThis, was));
  const player = new Player({ ...target }, { colliders: () => [], room: () => null, onPick() {} });
  player.place(5, 2, 0);
  return { player, press: code => handlers.keydown({ code, target: null, preventDefault() {} }), lift: code => handlers.keyup({ code }) };
}

test('pinned, you can\'t walk, jump or click your way anywhere, and you can still look', t => {
  const { player, press, lift } = pinned(t);
  player.walkTo(V(9, 0, 2));
  player.pin(true);
  press('KeyW'); press('Space');
  for (let i = 0; i < 60; i++) player.update(1 / 60);
  assert.deepEqual([player.position.x, player.position.z, player.position.y], [5, 2, EYE]);
  player.walkTo(V(9, 0, 2));
  assert.equal(player.target, null);
  lift('KeyW');
  press('ArrowLeft');
  for (let i = 0; i < 60; i++) player.update(1 / 60);
  assert.ok(player.yaw > 0.5, 'looks');
  lift('ArrowLeft');
  player.pin(false);
  press('KeyW');
  for (let i = 0; i < 60; i++) player.update(1 / 60);
  assert.ok(Math.hypot(player.position.x - 5, player.position.z - 2) > 1, 'and walks again');
});

test('a key still down from before doesn\'t walk you off afterwards', t => {
  const { player, press } = pinned(t);
  press('KeyW');
  player.pin(true);
  player.pin(false);
  player.update(1 / 60);
  assert.deepEqual([player.position.x, player.position.z], [5, 2]);
});
