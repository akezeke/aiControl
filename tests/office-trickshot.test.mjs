import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTrickshot } from '../client/office/trickshot.js';
import { BLEND, GAUGE_SIZE, arcPoints, blendLeft, createArc, drawnAt, gaugeAt, gaugeColour, launch } from '../client/office/throwing.js';
import { TiltedBox, makeBody, simulate, stepBody, stopShort } from '../client/office/flight.js';
import { ZONES, levelWorld } from '../client/office/kitchen-plan.js';
import { EYE, Player } from '../client/office/player.js';
import { WALL_H } from '../client/office/furniture.js';
import { BALLS, LOOSE } from '../client/office/props.js';
import { ITEMS, MONDAY, PAIRS, STARTS } from '../client/office/levels.js';
import { loadProgress } from '../client/office/progress.js';
import { FLIGHT, SLOW, inZone } from '../client/office/shot.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z), rad = d => d * Math.PI / 180;
const look = (yaw, pitch) => V(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
const ORIGIN = { x: -0.2, z: 5 }, DT = 1 / 60;
// Throws that do it, from tests/office-levels.test.mjs's search: yaw and pitch in radians.
const IN = { yaw: 2.416772208600941, pitch: 0.17453292519943295, charge: 0.625 }; // the paper ball into the sink, off a cupboard and the wall
const WEDGED = { yaw: rad(-129), pitch: rad(17), charge: 1 }; // a rubber ball from the far table, still a metre up at 8 s
const SKIDS = { yaw: STARTS.island.stand, pitch: rad(-30), charge: 1 }; // the paper ball at the floor: decided well before it stops
const toVerdict = t => { for (let i = 0; i < 2000 && !t.game.run.decided; i++) t.game.update(DT, null, false, true); assert.ok(t.game.run.decided); };

function setup({ aim, reduced = false, holding = false, store, score, share } = {}) {
  const calls = [], saved = [], group = new THREE.Group(), camera = { position: V(0, EYE, 0) };
  const props = { holding, throw(direction, drop) { calls.push(['drop', direction, drop]); props.holding = false; }, loose: () => [] };
  const hand = { palm: new THREE.Object3D(), held: null, hold(mesh, radius) { calls.push(['hold', mesh, radius]); hand.held = mesh; }, free() { calls.push(['free']); hand.held?.removeFromParent(); hand.held = null; }, pull(level) { calls.push(['pull', level]); } };
  const kitchen = { origin: ORIGIN, group, doors: [], shut(on) { kitchen.doors.push(on); } };
  const view = { plays: [], play(pose) { view.plays.push(pose); }, gameAmount: 0 };
  const memory = store ?? { value: null, getItem() { return memory.value; }, setItem(key, value) { memory.value = value; saved.push(value); } };
  const onPlay = game => { calls.push(['play', game]); camera.position.set(game.stand().x, EYE, game.stand().z); };
  const game = createTrickshot({ kitchen, hand, camera, props, view, onPlay, aim, score, share, store: memory, reducedMotion: () => reduced });
  game.build(group);
  return { game, calls, saved, group, camera, props, hand, kitchen, view, memory };
}
// Started the way a click starts it: walked to the mark, then in.
const begin = (t, id) => { t.game.start(t.game.entry(id)); t.game.enter(); const { x, z } = t.game.stand(); t.hand.palm.position.set(x - 0.2, EYE - 0.27, z + 0.2); };
const play = (t, seconds = 40) => { for (let i = 0; i < seconds * 60 && t.game.run.state === 'flying'; i++) t.game.update(DT, null, false, true); };
const throwIt = (t, { yaw, pitch, charge }) => t.game.release(charge, look(yaw, pitch));
const item = (t, id) => t.game.item(id);
// How far `p` is from the part of a flat list of points that starts at `i`.
const segmentGap = (p, way, i) => { const a = V(way[i], way[i + 1], way[i + 2]), b = V(way[i + 3], way[i + 4], way[i + 5]); return new THREE.Line3(a, b).closestPointToPoint(p, true, V(0, 0, 0)).distanceTo(p); };
// A throw's real way, every step, to the second contact or `past` metres after the first. Each hit with its place, its surface and the velocity it left with.
const realWay = (kind, { pos, vel }, world, past = 1.3) => {
  const b = makeBody(kind, pos, vel), hits = [], way = [...pos.toArray()];
  const watch = { ...world, onContact(body, e) { hits.push({ surface: e.surface, normal: e.normal.clone(), pos: body.pos.clone() }); way.push(...body.pos.toArray()); } };
  let after = 0, last = pos.clone(), left = null;
  for (let n = 0; n < 240 * 4 && !b.rest && hits.length < 2 && after < past; n++) {
    const before = hits.length;
    stepBody(b, watch);
    if (hits.length) after += last.distanceTo(b.pos);
    if (hits.length && !before) { left = b.vel.clone(); }
    last.copy(b.pos); way.push(last.x, last.y, last.z);
  }
  return { way, hits, left, after };
};
// Every dot is on the way, in order: how many got looked at. Within 2.5 cm, as a contact pushes the thing out by up to a step's move, and the dots go straight to it from the last sample.
const onWay = (dots, way, skip = 0) => {
  let from = 0;
  for (let i = skip * 3; i < dots.length; i += 3) {
    const p = V(dots[i], dots[i + 1], dots[i + 2]);
    while (from + 6 <= way.length && segmentGap(p, way, from) > 0.025) from += 3;
    assert.ok(from + 6 <= way.length, `dot ${i / 3} of ${dots.length / 3}, ${p.toArray()}, is on the real way, in order`);
  }
  return dots.length / 3 - skip;
};

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

test('the verdict shows when the shot\'s decided, saved once, while the item keeps moving', () => {
  const t = setup();
  begin(t, 'paper'); throwIt(t, SKIDS);
  const { decided, time } = t.game.run.result; assert.ok(time > decided + 0.3, `${decided} to ${time}`);
  while (t.game.run.time < decided - 0.02) { t.game.update(DT, null, false, true); assert.equal(t.game.score, null); assert.equal(t.saved.length, 0); }
  toVerdict(t);
  assert.equal(t.game.score, 'Miss'); assert.equal(t.game.run.state, 'flying'); assert.equal(t.saved.length, 1); assert.equal(t.game.saved, 1);
  const was = item(t, 'paper').position.clone();
  for (let i = 0; i < 5; i++) t.game.update(DT, null, false, true);
  assert.ok(item(t, 'paper').position.distanceTo(was) > 0.01, 'still going');
  play(t, 40);
  assert.equal(t.game.run.state, 'done'); assert.equal(t.saved.length, 1, 'not saved again at the end'); assert.equal(t.game.score, 'Miss');
});

test('from the verdict R or a click goes again, mid-roll, and nothing of the old shot comes back', () => {
  for (const again of [t => t.game.key('KeyR', true), t => t.game.click(look(0, 0))]) {
    const t = setup();
    begin(t, 'paper'); throwIt(t, SKIDS);
    t.game.click(look(0, 0)); assert.equal(t.game.run.state, 'flying', 'not undecided');
    toVerdict(t); assert.equal(t.game.run.state, 'flying');
    again(t);
    assert.equal(t.game.run.state, 'aiming'); assert.equal(t.game.score, null); assert.equal(t.game.following, false); assert.equal(t.view.plays.at(-1), null);
    assert.equal(t.hand.held, item(t, 'paper'));
    const saves = t.saved.length;
    for (let i = 0; i < 400; i++) t.game.update(DT, null, false, true);
    assert.equal(t.game.score, null); assert.equal(t.saved.length, saves); assert.equal(t.hand.held, item(t, 'paper'));
  }
});

test('the camera\'s hand-back counts from when the item really stops, not from the verdict', () => {
  const t = setup();
  begin(t, 'paper'); throwIt(t, SKIDS); toVerdict(t);
  const { time } = t.game.run.result;
  while (t.game.run.state === 'flying') { t.game.update(DT, null, false, true); assert.ok(t.view.plays.at(-1), `still on it at ${t.game.run.time} of ${time}`); }
  for (let i = 0; i < 50; i++) t.game.update(DT, null, false, true);
  assert.ok(t.view.plays.at(-1), 'holds');
  for (let i = 0; i < 20; i++) t.game.update(DT, null, false, true);
  assert.equal(t.view.plays.at(-1), null, 'back after about a second');
});

const aSecond = t => { for (let i = 0; i < 66; i++) t.game.update(DT, null, false, true); };
test('a miss comes back to your hand with the camera, and the verdict stays up till the next throw', () => {
  const t = setup();
  begin(t, 'paper'); throwIt(t, SKIDS); play(t);
  assert.equal(t.game.run.state, 'done'); assert.equal(t.hand.held, null, 'on the floor while you look at it'); assert.equal(t.game.holding, false);
  for (let i = 0; i < 50; i++) t.game.update(DT, null, false, true);
  assert.equal(t.hand.held, null, 'still waiting');
  aSecond(t);
  assert.equal(t.view.plays.at(-1), null);
  assert.equal(t.hand.held, item(t, 'paper')); assert.equal(t.game.run.state, 'aiming'); assert.equal(t.game.holding, true); assert.deepEqual(item(t, 'paper').rotation.toArray().slice(0, 3), [0, 0, 0]);
  assert.equal(t.game.score, 'Miss');
  const saves = t.saved.length; aSecond(t); assert.equal(t.saved.length, saves);
  t.game.click(look(0, 0)); assert.equal(t.game.score, 'Miss', 'a click there is the next throw\'s, not a reset');
  throwIt(t, SKIDS);
  assert.equal(t.game.score, null, 'the next throw clears it'); assert.equal(t.game.run.state, 'flying'); assert.equal(t.hand.held, null);
});

test('with reduced motion it comes back after the same wait', () => {
  const t = setup({ reduced: true });
  begin(t, 'paper'); throwIt(t, SKIDS); play(t);
  assert.equal(t.hand.held, null); assert.equal(t.game.run.state, 'done');
  for (let i = 0; i < 50; i++) t.game.update(DT, null, true, true);
  assert.equal(t.hand.held, null);
  for (let i = 0; i < 16; i++) t.game.update(DT, null, true, true);
  assert.equal(t.hand.held, item(t, 'paper')); assert.equal(t.game.holding, true); assert.equal(t.game.score, 'Miss');
  assert.equal(t.view.plays.filter(Boolean).length, 0, 'and no camera came into it');
});

test('a made shot comes back too, and it\'s put away when you leave', () => {
  const t = setup();
  begin(t, 'paper'); throwIt(t, IN); play(t);
  const { pos } = t.game.run.result, score = t.game.score; assert.ok(t.game.run.result.made);
  aSecond(t);
  assert.equal(t.hand.held, item(t, 'paper')); assert.equal(t.game.holding, true); assert.equal(t.game.score, score);
  t.game.leave();
  assert.deepEqual(item(t, 'paper').position.toArray(), pos, 'where it landed');
});

test('R and a click still go at once during the wait; R after it clears the verdict', () => {
  for (const again of [t => t.game.key('KeyR', true), t => t.game.click(look(0, 0))]) {
    const t = setup();
    begin(t, 'paper'); throwIt(t, IN); play(t);
    for (let i = 0; i < 20; i++) t.game.update(DT, null, false, true);
    again(t);
    assert.equal(t.game.run.state, 'aiming'); assert.equal(t.game.score, null); assert.equal(t.view.plays.at(-1), null); assert.equal(t.hand.held, item(t, 'paper'));
    aSecond(t); assert.equal(t.game.score, null, 'and the wait is off'); assert.equal(t.game.holding, true);
  }
  const t = setup();
  begin(t, 'paper'); throwIt(t, IN); play(t); aSecond(t);
  assert.ok(t.game.score);
  t.game.key('KeyR', true);
  assert.equal(t.game.score, null); assert.equal(t.hand.held, item(t, 'paper'));
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

test('the arc follows the shot\'s real path', () => {
  const aim = { direction: look(IN.yaw, IN.pitch), charge: IN.charge }, t = setup({ aim: () => aim });
  begin(t, 'paper');
  t.game.update(DT, null, false, true);
  const dots = t.game.arc.points, { x, z } = STARTS.island, eye = V(x, EYE, z);
  assert.ok(dots.length >= 18 && dots.length % 3 === 0, `${dots.length / 3} dots`);
  assert.ok(t.game.arc.mesh.visible);
  assert.equal(t.game.arc.mesh.count, dots.length / 3);
  assert.equal(t.game.arc.mesh.parent !== null, true, 'it\'s in the room');

  const { pos, vel } = launch(ITEMS.paper, IN.charge, { position: eye }, aim.direction, V(0, 0, 0));
  const { path, contacts: [hit] } = simulate(makeBody(ITEMS.paper, pos, vel), levelWorld(), { maxTime: 2.5, stop: () => true });
  assert.ok(hit, 'it hits something');
  const after = onWay(dots, realWay(ITEMS.paper, { pos, vel }, levelWorld()).way, t.game.arc.times.findIndex(time => time >= BLEND)); // before that, still coming from the hand
  assert.ok(after >= 6, `${after} dots after the blend`);

  // The same as what's thrown.
  t.game.release(IN.charge, aim.direction);
  const flown = t.game.run.result.path;
  for (let i = 0; i < path.length - 3; i++) assert.equal(flown[i], path[i]);
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

test('dots are evenly spaced in the world, and a long way gets a wider gap, not more dots', () => {
  const eye = V(0, EYE, 0), wall = Object.assign(new THREE.Box3(V(-9, 0, 5), V(9, 3, 5.2)), { surface: 'wall' }), world = { colliders: [wall], columns: [], ceiling: 50 };
  const thrown = launch(ITEMS.rubber, 1, { position: eye }, V(0, 0.05, 1).normalize(), V(0, 0, 0)), dots = arcPoints(ITEMS.rubber, thrown, world, eye);
  assert.ok(dots.length / 3 >= 12 && dots.length / 3 <= 24, `${dots.length / 3} dots`);
  const hitZ = 5 - ITEMS.rubber.radius;
  for (let i = 3; i < dots.length; i += 3) {
    const gap = Math.hypot(dots[i] - dots[i - 3], dots[i + 1] - dots[i - 2], dots[i + 2] - dots[i - 1]);
    if (Math.max(dots[i + 2], dots[i - 1]) > hitZ - 0.31) assert.ok(gap < 0.31, `gap ${gap} before dot ${i / 3}, round the corner at the hit`);
    else assert.ok(Math.abs(gap - 0.3) < 0.01, `gap ${gap} before dot ${i / 3}`);
  }
  const open = { colliders: [], columns: [], ceiling: 50 }, far = arcPoints(ITEMS.rubber, launch(ITEMS.rubber, 1, { position: eye }, V(0, 1, 0.1).normalize(), V(0, 0, 0)), open, eye);
  assert.equal(far.length / 3, 24);
  assert.ok(Math.hypot(far[0] - far[3], far[1] - far[4], far[2] - far[5]) > 0.3);
});

test('dots are one size and one flat colour, however far they are', () => {
  const eye = V(0, EYE, 0), open = { colliders: [], columns: [], ceiling: 50 }, arc = createArc(), m = new THREE.Matrix4(), scale = V(0, 0, 0), p = V(0, 0, 0), q = new THREE.Quaternion();
  arc.show(ITEMS.rubber, launch(ITEMS.rubber, 1, { position: eye }, V(0, 0.2, 1).normalize(), V(0, 0, 0)), open, eye, V(-0.3, EYE - 0.3, 0.2));
  const sizes = new Set();
  for (let i = 0; i < arc.mesh.count; i++) { arc.mesh.getMatrixAt(i, m); m.decompose(p, q, scale); sizes.add(scale.toArray().join()); }
  assert.equal(sizes.size, 1, [...sizes].join(' '));
  assert.ok(p.distanceTo(eye) > 3, 'the last is well away');
  arc.mesh.geometry.computeBoundingSphere();
  const radius = arc.mesh.geometry.boundingSphere.radius * scale.x;
  assert.ok(radius > 0.005 && radius < 0.02, `${radius} m`);
  assert.equal(arc.mesh.material.vertexColors, false);
  assert.equal(arc.mesh.geometry.attributes.color, undefined);
  assert.ok(arc.ring.material.color.equals(arc.mesh.material.color), 'the ring is the same colour');
  assert.ok(arc.mesh.material.depthTest && arc.ring.material.depthTest, 'things in front hide them');
});

test('a contact says which way the surface faces and where the thing was', () => {
  const eye = V(0, EYE, 0), wall = Object.assign(new THREE.Box3(V(-9, 0, 3), V(9, 3, 3.2)), { surface: 'wall' });
  const { contacts: [hit] } = simulate(makeBody(ITEMS.rubber, eye, V(0, 0, 8)), { colliders: [wall], columns: [], ceiling: 50 }, { stop: () => true });
  assert.deepEqual(hit.normal, [0, 0, -1]);
  assert.ok(Math.abs(hit.pos[2] - (3 - ITEMS.rubber.radius)) < 1e-6, `${hit.pos}`);
});

// The ring against what it should be lying on: `gapTo` is how far it is off the surface, along `normal`.
const onSurface = (arc, normal, gapTo) => {
  assert.equal(arc.ring.visible, true, 'there is a ring');
  assert.equal(arc.ring.parent, arc.mesh);
  assert.ok(V(0, 0, 1).applyQuaternion(arc.ring.quaternion).distanceTo(normal) < 1e-6, 'it faces out');
  const gap = gapTo(arc.ring.position);
  assert.ok(gap > 0 && gap < 0.01, `${gap} m off the surface`);
  const across = new THREE.Box3().setFromObject(new THREE.Mesh(arc.ring.geometry));
  assert.ok(Math.max(across.max.x - across.min.x, across.max.y - across.min.y) >= 0.08 && across.max.x - across.min.x <= 0.1, 'about 9 cm');
};

test('a throw at a wall, the floor or something tilted has a ring on what it hits, and no dot through it', () => {
  const kind = ITEMS.rubber, eye = V(0, EYE, 0), palm = V(-0.3, EYE - 0.3, 0.2);
  const wall = Object.assign(new THREE.Box3(V(-9, 0, 3), V(9, 3, 3.2)), { surface: 'wall' }), walled = { colliders: [wall], columns: [], ceiling: 50 };
  const at = createArc();
  at.show(kind, launch(kind, 1, { position: eye }, V(0, 0, 1), V(0, 0, 0)), walled, eye, palm);
  onSurface(at, V(0, 0, -1), p => 3 - p.z);
  for (let i = 2; i < at.points.length; i += 3) {
    assert.ok(at.points[i] <= 3 - kind.radius + 1e-3, `dot ${(i - 2) / 3} at ${at.points[i]}`);
  }
  assert.ok(Math.max(...at.points.filter((_, i) => i % 3 === 2)) > 3 - kind.radius - 0.32, 'and they get there');

  const open = { colliders: [], columns: [], ceiling: 50 }, down = createArc();
  down.show(kind, launch(kind, 0.3, { position: eye }, V(0, -0.4, 1).normalize(), V(0, 0, 0)), open, eye, palm);
  onSurface(down, V(0, 1, 0), p => p.y);
  for (let i = 1; i < down.points.length; i += 3) assert.ok(down.points[i] >= kind.low - 1e-3, `dot ${(i - 1) / 3} at ${down.points[i]}`);

  const tilted = new TiltedBox({ centre: [0, 1, 3], half: [2, 2, 0.1], rotation: [-0.5, 0, 0], surface: 'ramp' }), slope = createArc(), face = V(0, 0, -1).applyQuaternion(tilted.quaternion);
  slope.show(kind, launch(kind, 1, { position: eye }, V(0, 0, 1), V(0, 0, 0)), { colliders: [tilted], columns: [], ceiling: 50 }, eye, palm);
  onSurface(slope, face, p => p.clone().sub(tilted.centre).dot(face) - tilted.half.z);
});

test('no ring when nothing\'s hit by the time it stops looking', () => {
  const eye = V(0, EYE, 0), open = { colliders: [], columns: [], ceiling: 500 }, arc = createArc(), thrown = launch(ITEMS.rubber, 1, { position: eye }, V(0, 1, 0), V(0, 0, 0));
  arc.show(ITEMS.rubber, thrown, open, eye, V(-0.3, EYE - 0.3, 0.2));
  assert.equal(arc.mesh.visible, true);
  assert.ok(arc.mesh.count > 0);
  assert.equal(arc.ring.visible, false);
  const { path } = simulate(makeBody(ITEMS.rubber, thrown.pos, thrown.vel), open, { maxTime: 2.5 }), end = V(...path.slice(-3));
  assert.ok(V(...arc.points.slice(-3)).distanceTo(end) < 2, 'the dots go on to the cap');
  assert.ok(end.y > 2, 'still up in the air');
});

test('no ring on what\'s out of sight behind something', () => {
  const kind = ITEMS.rubber, eye = V(0, EYE, 0), palm = V(-0.3, EYE - 0.3, 0.2), thrown = launch(kind, 0.5, { position: eye }, V(0, 0.75, 1).normalize(), V(0, 0, 0));
  const screen = Object.assign(new THREE.Box3(V(-9, 0, 1), V(9, 2, 1.1)), { surface: 'screen' }), arc = createArc();
  // Over the screen and onto the floor beyond it.
  arc.show(kind, thrown, { colliders: [screen], columns: [], ceiling: 50 }, eye, palm);
  assert.ok(arc.points.at(-1) > 1.1, 'it does go over');
  assert.equal(arc.ring.visible, false);
  // The same throw with nothing there.
  arc.show(kind, launch(kind, 0.51, { position: eye }, V(0, 0.75, 1).normalize(), V(0, 0, 0)), { colliders: [], columns: [], ceiling: 50 }, eye, palm);
  assert.equal(arc.ring.visible, true);
});

test('the ring goes with the arc, nothing listens to it, and a hand alone doesn\'t move it', () => {
  const kind = ITEMS.rubber, eye = V(0, EYE, 0), wall = Object.assign(new THREE.Box3(V(-9, 0, 3), V(9, 3, 3.2)), { surface: 'wall' }), world = { colliders: [wall], columns: [], ceiling: 50 };
  const arc = createArc(), room = new THREE.Group(), thrown = launch(kind, 1, { position: eye }, V(0, 0, 1), V(0, 0, 0)), palm = V(-0.3, EYE - 0.3, 0.2);
  room.add(arc.mesh);
  arc.show(kind, thrown, world, eye, palm);
  room.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(eye.clone(), V(0, 0, 1));
  ray.ray.direction.subVectors(arc.ring.position.clone().add(V(0.04, 0, 0)), eye).normalize();
  assert.deepEqual(ray.intersectObject(room, true), []);
  const was = arc.ring.position.clone();
  arc.show(kind, thrown, world, eye, palm.clone().setY(EYE - 0.1));
  assert.ok(arc.ring.position.equals(was));
  assert.equal(arc.ring.parent, arc.mesh, 'in the room with the dots: no call of its own');
  arc.hide();
  assert.equal(arc.mesh.visible, false);
  let shown = true; arc.ring.traverseAncestors(a => { if (!a.visible) shown = false; });
  assert.equal(shown, false);
  arc.show(kind, thrown, world, eye, palm);
  assert.equal(arc.ring.visible, true, 'and back again');
});

test('a throw that falls short of a far wall ends on the floor, not against the wall', () => {
  // As it was reported: the old arc stopped 4 m out, seen against this wall, and the thing fell 8 m out.
  const kind = { radius: 0.05, low: 0.05, bounce: 0.2, roll: 6, drag: 0.3, throw: 10, tumble: 8, upright: true };
  const eye = V(0, 1.6, 0), wall = Object.assign(new THREE.Box3(V(-20, 0, -12.2), V(20, 3, -12)), { surface: 'wall' }), world = { colliders: [wall], columns: [], ceiling: 3 };
  const thrown = launch(kind, 1, { position: eye }, V(0, Math.sin(0.1), -Math.cos(0.1)), V(0, 0, 0)), arc = createArc();
  arc.show(kind, thrown, world, eye, V(-0.3, 1.33, -0.8));
  const { contacts: [hit] } = simulate(makeBody(kind, thrown.pos, thrown.vel), world, { maxTime: 6, stop: () => true });
  assert.equal(hit.surface, 'floor');
  assert.ok(hit.pos[2] < -7.5 && hit.pos[2] > -8.5, `first hit ${hit.pos[2]} m out`);
  onSurface(arc, V(0, 1, 0), p => p.y);
  assert.ok(Math.hypot(arc.ring.position.x - hit.pos[0], arc.ring.position.z - hit.pos[2]) < 1e-6, 'the ring is where it lands');
  const at = i => V(...arc.points.subarray(i * 3, i * 3 + 3)), place = V(...hit.pos), count = arc.points.length / 3, gap = at(0).distanceTo(at(1));
  let closest = Infinity, furthest = -Infinity;
  for (let i = 0; i < count; i++) { closest = Math.min(closest, at(i).distanceTo(place)); if (at(i).z < place.z) furthest = Math.max(furthest, at(i).distanceTo(place)); }
  assert.ok(closest <= gap, `the closest dot is ${closest} m from it, gaps of ${gap}`);
  assert.ok(furthest <= 1.3, `the furthest past it is ${furthest} m`);
  assert.ok(at(count - 1).y < 0.6, `and low down, ${at(count - 1).y} m up`);
  assert.ok(at(count - 1).z > -10, 'nowhere near the wall');
});

test('a throw at a wall shows the dots leaving it the way it really bounces, for a bit over a metre', () => {
  const kind = ITEMS.rubber, eye = V(0, EYE, 0), wall = Object.assign(new THREE.Box3(V(-9, 0, 3), V(9, 3, 3.2)), { surface: 'wall' }), world = { colliders: [wall], columns: [], ceiling: 50 };
  const thrown = launch(kind, 1, { position: eye }, V(0.45, 0.05, 1).normalize(), V(0, 0, 0)), { way, hits, left } = realWay(kind, thrown, world);
  assert.equal(hits[0].surface, 'wall');
  assert.ok(left.z < -0.5 && left.x > 0.5, `it does bounce: ${left.toArray()}`);
  const dots = arcPoints(kind, thrown, world, eye);
  onWay(dots, way);
  const at = i => V(...dots.subarray(i * 3, i * 3 + 3)), count = dots.length / 3, peak = [...Array(count).keys()].reduce((best, i) => at(i).z > at(best).z ? i : best, 0);
  const past = [...Array(count).keys()].slice(peak + 1).filter(i => at(i).z < at(i - 1).z);
  assert.ok(past.length >= 2, `${past.length} dots leave the wall`);
  const seen = at(past.at(-1)).sub(hits[0].pos);
  assert.ok(seen.angleTo(left) < rad(8), `they leave at ${seen.angleTo(left) * 180 / Math.PI} degrees from how it really does`);
  assert.ok(seen.length() >= 0.55 && seen.length() <= 1.3, `the last is ${seen.length()} m from the hit`);
});

test('the bounce stretch ends at the second contact', () => {
  // A corner: the wall, then the side wall a hand away.
  const kind = ITEMS.rubber, eye = V(0, EYE, 0), wall = Object.assign(new THREE.Box3(V(-9, 0, 3), V(9, 3, 3.2)), { surface: 'wall' }), side = Object.assign(new THREE.Box3(V(1.35, 0, -9), V(1.55, 3, 9)), { surface: 'side' });
  const world = { colliders: [wall, side], columns: [], ceiling: 50 }, thrown = launch(kind, 1, { position: eye }, V(0.4, 0.05, 1).normalize(), V(0, 0, 0)), { way, hits } = realWay(kind, thrown, world, 5);
  assert.deepEqual(hits.map(h => h.surface), ['wall', 'side']);
  const dots = arcPoints(kind, thrown, world, eye), gone = hits[0].pos.distanceTo(hits[1].pos);
  assert.ok(gone > 0.3 && gone < 0.9, `${gone} m between the hits`);
  onWay(dots, way);
  for (let i = 0; i < dots.length; i += 3) assert.ok(dots[i] <= 1.35 - kind.radius + 1e-3, 'none through the second wall');
  assert.ok(dots.at(-1) > hits[0].pos.z - 0.9 && dots.at(-3) > hits[0].pos.x, 'they\'re on their way there');
});

test('a soft landing shows nothing made up after it', () => {
  // Under a metre a second it just stops, and rolls: no bounce, so nothing to see.
  const kind = LOOSE.mug, eye = V(0, 0.6, 0), thrown = { pos: V(0, kind.low + 0.02, 0), vel: V(0, -0.5, 0.4) }, world = { colliders: [], columns: [], ceiling: 50 };
  const dots = arcPoints(kind, thrown, world, eye), { way, hits } = realWay(kind, thrown, world);
  assert.equal(hits.length, 2);
  onWay(dots, way);
  assert.ok(dots.at(-1) < 0.05, `the last dot's ${dots.at(-1)} m along`);
});

test('in the kitchen, every dot of every throw is on the real way, never past the stretch', () => {
  const world = levelWorld();
  for (const name of ['paper', 'rubber', 'mug']) for (const start of Object.values(STARTS)) for (let yaw = 0; yaw < 360; yaw += 60) for (const [pitch, charge] of [[-0.2, 0.3], [0.1, 1], [0.4, 0.6]]) {
    const kind = ITEMS[name] ?? LOOSE[name], eye = V(start.x, EYE, start.z), thrown = launch(kind, charge, { position: eye }, look(rad(yaw), pitch), V(0, 0, 0));
    thrown.pos.copy(stopShort(eye, thrown.pos.clone(), kind, world.colliders));
    const { way } = realWay(kind, thrown, world);
    onWay(arcPoints(kind, thrown, world, eye), way);
  }
});

test('every throw hits something before the arc stops looking, with no ring missing', () => {
  // Floor and ceiling are all it takes: however big the room, nothing stays up. So a dot trail in mid air, with no ring, never happens in a room.
  const eye = V(0, EYE, 0), world = { colliders: [], columns: [], ceiling: WALL_H }, arc = createArc(), palm = V(-0.3, EYE - 0.3, 0.2);
  let longest = 0;
  for (const kind of [...Object.values(ITEMS), ...BALLS, ...Object.values(LOOSE)]) for (const charge of [0, 0.25, 0.5, 0.75, 1]) for (let pitch = -60; pitch <= 88; pitch += 4) {
    const thrown = launch(kind, charge, { position: eye }, V(0, Math.sin(rad(pitch)), -Math.cos(rad(pitch))), V(0, 0, 0));
    longest = Math.max(longest, simulate(makeBody(kind, thrown.pos, thrown.vel), world, { maxTime: 2.5, stop: () => true }).contacts[0]?.time ?? Infinity);
    arc.show(kind, thrown, world, eye, palm);
    assert.equal(arc.ring.visible, true, `${kind.name ?? kind.radius} at ${charge}, pitch ${pitch}`);
  }
  assert.ok(longest < 2, `the longest flight to a first hit is ${longest} s`);
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

test('the item stays in sight, unless it\'s down in what it was thrown at', () => {
  const world = levelWorld().colliders, truly = V(0, 0, 0), spare = V(0, 0, 0);
  for (const id of Object.keys(SHOTS)) {
    const t = setup(), zone = ZONES[MONDAY.find(e => e.id === id).target]; begin(t, id); throwIt(t, SHOTS[id]);
    let run = 0, longest = 0;
    while (t.game.run.state === 'flying') {
      t.game.update(DT, null, false, true); t.game.run.at(truly);
      const seen = stopShort(poseLocal(t, 'from'), spare.copy(truly), { radius: 0.005, low: 0.005 }, world).distanceTo(truly) < 0.15;
      run = seen || inZone(truly.toArray(), zone) ? 0 : run + 1; longest = Math.max(longest, run);
    }
    assert.ok(longest <= 15, `${id}: out of sight for ${longest} frames`);
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

// What's been played, for a test to listen to. `audio` stays with the module once it's made, so there's one of these.
const heard = [];
const fakeAudio = { currentTime: 0, destination: {}, resume() {},
  createGain: () => ({ gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: to => to, disconnect() {} }),
  createOscillator() { const o = { frequency: { setValueAtTime(from) { o.from = from; }, exponentialRampToValueAtTime() {} }, connect: to => to, start() { heard.push(o.from); }, stop() {} }; return o; } };
const listen = c => { const was = globalThis.AudioContext; globalThis.AudioContext = function () { return fakeAudio; }; c.after(() => { globalThis.AudioContext = was; }); heard.length = 0; };
const FANFARE = 1047;

test('a made shot gets its fanfare, and with reduced motion it doesn\'t', c => {
  listen(c);
  for (const reduced of [false, true]) {
    const t = setup({ reduced });
    begin(t, 'paper'); throwIt(t, IN); play(t);
    assert.ok(t.game.score && t.game.score !== 'Miss');
    assert.equal(heard.some(from => from === FANFARE), !reduced);
    heard.length = 0;
  }
});

test('a shot\'s camera has the view from the throw until it\'s handed back, and R takes it back at once', () => {
  const t = setup();
  begin(t, 'paper');
  assert.equal(t.game.following, false, 'aiming');
  throwIt(t, IN);
  assert.equal(t.game.following, true, 'in flight');
  play(t);
  assert.equal(t.game.following, true, 'holding on where it landed');
  for (let i = 0; i < 2 * 60; i++) t.game.update(DT, null, false, true);
  assert.equal(t.game.following, false, 'handed back');
  t.game.reset(); throwIt(t, IN);
  assert.equal(t.game.following, true);
  t.game.key('KeyR', true);
  assert.equal(t.game.following, false);
  throwIt(t, IN);
  t.game.leave();
  assert.equal(t.game.following, false);
  const calm = setup({ reduced: true });
  begin(calm, 'paper'); throwIt(calm, IN);
  assert.equal(calm.game.following, false, 'with reduced motion the view stays yours');
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

test('a jump lands you there at once, level and facing that way, with any walk, flight or jump behind you', t => {
  const { player } = pinned(t);
  player.walkTo(V(9, 0, 2)); player.height = 0.4; player.rise = 2; player.spin = 3; player.pitch = -1;
  player.jumpTo(-3, 7, 1.2);
  assert.deepEqual([player.position.x, player.position.y, player.position.z, player.yaw], [-3, EYE, 7, 1.2]);
  assert.equal(player.pitch, -0.08);
  assert.equal(player.target, null);
  player.flyTo(V(9, 0, 2), V(9, 0, 9));
  player.jumpTo(-3, 7, 1.2);
  player.update(1 / 60);
  assert.deepEqual([player.position.x, player.position.y, player.position.z, player.yaw], [-3, EYE, 7, 1.2], 'nothing carries on');
});

test('a key still down from before doesn\'t walk you off afterwards', t => {
  const { player, press } = pinned(t);
  press('KeyW');
  player.pin(true);
  player.pin(false);
  player.update(1 / 60);
  assert.deepEqual([player.position.x, player.position.z], [5, 2]);
});

test('after a daily shot its line can be copied: the Copy button shows, and C copies; a level has none', () => {
  const scores = [], lines = [], d = setup({ score: (text, done, copy) => scores.push(copy), share: line => lines.push(line) }), day = '2026-10-31';
  d.game.start({ item: 'paper', start: 'island', target: 'sink', day, index: 1 }); d.game.enter();
  assert.equal(scores.at(-1), false, 'nothing to copy yet');
  assert.equal(d.game.key('KeyC', true), false);
  throwIt(d, IN); play(d);
  assert.equal(scores.at(-1), true);
  assert.equal(d.game.key('KeyC', false), false, 'on the way down only');
  assert.equal(d.game.key('KeyC', true), true);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Trickshot 31 Oct: - \/ [\d,]+ \/ -$/);
  for (let i = 0; i < 66; i++) d.game.update(DT, null, false, true);
  assert.equal(d.hand.held, d.game.item('paper')); assert.equal(scores.at(-1), true, 'back in hand, it\'s still there');
  assert.equal(d.game.key('KeyC', true), true); assert.equal(lines.length, 2); lines.pop();
  d.game.reset();
  assert.equal(scores.at(-1), false, 'a reset takes it');
  d.game.leave();
  assert.equal(scores.at(-1), false);

  const t = setup({ score: (text, done, copy) => scores.push(copy), share: line => lines.push(line) });
  begin(t, 'paper'); throwIt(t, IN); play(t);
  assert.ok(t.game.run.result.made);
  assert.equal(scores.at(-1), false);
  assert.equal(t.game.key('KeyC', true), false);
  assert.equal(lines.length, 1);
});

test('the bar shows the goal from the start, its lines struck as they\'re done, and the verdict beside it', () => {
  const said = [], t = setup({ score: (goal, verdict, copy) => said.push({ goal, verdict, copy }) });
  begin(t, 'paper');
  const first = said.at(-1), { trick, set } = MONDAY.find(e => e.id === 'paper');
  assert.deepEqual(first.goal.map(g => g.done), [false, false, false]); assert.equal(first.verdict, null);
  assert.match(first.goal[0].text, /^Paper ball → sink$/); assert.ok(trick.name.endsWith(first.goal[1].text)); assert.equal(first.goal[2].text, new Intl.NumberFormat('en-US').format(set));
  throwIt(t, IN);
  assert.ok(said.at(-1).goal.length === 3 && said.at(-1).verdict === null, 'in flight, still the goal');
  play(t);
  const done = said.at(-1); assert.equal(done.verdict, t.game.score); assert.ok(done.verdict); assert.equal(done.goal[0].done, true, 'put away: struck at once'); assert.equal(done.goal[0].text, first.goal[0].text);
  for (let i = 0; i < 66; i++) t.game.update(DT, null, false, true);
  assert.equal(said.at(-1).verdict, done.verdict, 'beside the goal once it\'s back in hand');
  throwIt(t, SKIDS);
  assert.equal(said.at(-1).verdict, null); assert.equal(said.at(-1).goal[0].done, true, 'struck stays struck');
  t.game.leave();
  assert.equal(said.at(-1).goal, null, 'gone with the level');
});

const MARKER_SIGHT = { radius: 0.01, low: 0.01 };
test('a marker hangs over the target, seen from the mark, for every shot there is', () => {
  const t = setup(), { colliders } = levelWorld();
  assert.equal(t.game.marker.visible, false, 'not till a level\'s on');
  const shots = [...MONDAY, ...Object.entries(PAIRS).flatMap(([item, pairs]) => pairs.map(([start, target]) => ({ item, start, target })))];
  for (const shot of shots) {
    t.game.start(shot); t.game.enter(); t.game.update(DT, null, false, true);
    const { marker } = t.game, zone = ZONES[shot.target], p = marker.position.clone(), { x, z } = STARTS[shot.start], eye = V(x, EYE, z);
    assert.equal(marker.visible, true);
    assert.ok(Math.abs(p.x - zone.centre.x) < 1e-9 && Math.abs(p.z - zone.centre.z) < 1e-9 && p.y > zone.centre.y + zone.half.y, `${shot.target}: over it`);
    assert.ok(stopShort(eye, p.clone(), MARKER_SIGHT, colliders).distanceTo(p) < 1e-6, `${shot.item} from ${shot.start}: seen over ${shot.target}`);
    assert.equal(marker.parent, t.group); let deaf = true; marker.traverse(n => { const hits = []; n.raycast(new THREE.Raycaster(eye, p.clone().sub(eye).normalize()), hits); deaf &&= !hits.length; }); assert.ok(deaf, 'clicks go through');
    t.game.leave(); assert.equal(marker.visible, false);
  }
});

test('the marker bobs gently, keeps still under reduced motion, and isn\'t drawn while a shot\'s camera is on', () => {
  const t = setup(); begin(t, 'paper');
  const ys = []; for (let i = 0; i < 200; i++) { t.game.update(DT, null, false, true); ys.push(t.game.marker.position.y); }
  const spread = Math.max(...ys) - Math.min(...ys); assert.ok(spread > 0.02 && spread < 0.08, `bobs ${spread}`);
  throwIt(t, IN); t.game.update(DT, null, false, true);
  assert.equal(t.game.marker.visible, false, 'the shot\'s camera has the view');
  play(t); t.game.update(DT, null, false, true); assert.equal(t.game.marker.visible, false, 'holding on where it landed');
  for (let i = 0; i < 66; i++) t.game.update(DT, null, false, true);
  assert.equal(t.game.marker.visible, true, 'back with your eyes');
  const calm = setup({ reduced: true }); begin(calm, 'paper'); calm.game.update(DT, null, true, true);
  const y = calm.game.marker.position.y; for (let i = 0; i < 100; i++) calm.game.update(DT, null, true, true);
  assert.equal(calm.game.marker.position.y, y); assert.equal(calm.game.marker.visible, true);
  throwIt(calm, IN); calm.game.update(DT, null, true, true); assert.equal(calm.game.marker.visible, true, 'no camera comes into it');
});

test('progress changing is counted, for the boards to notice', () => {
  const t = setup(), before = t.game.saved;
  begin(t, 'paper'); throwIt(t, IN); play(t);
  assert.equal(t.game.saved, before + 1);
  t.game.leave();
  t.game.start({ item: 'paper', start: 'island', target: 'sink' }); t.game.enter();
  throwIt(t, IN); play(t);
  assert.equal(t.game.saved, before + 1, 'a random shot keeps no score, so nothing to redraw');
  assert.deepEqual(t.game.progress.daily, {});
});

test('the power gauge goes from calm to hot', () => {
  const rgb = level => { const m = gaugeColour(level).match(/\d+/g).map(Number); assert.equal(m.length, 3, gaugeColour(level)); return m; };
  const [r0, , b0] = rgb(0), [r1, g1, b1] = rgb(1);
  assert.ok(b0 > r0, `cool at the start: ${rgb(0)}`);
  assert.ok(r1 > 220 && b1 < 80 && g1 < 110, `hot when full: ${rgb(1)}`);
  for (let i = 1; i <= 20; i++) assert.ok(rgb(i / 20)[0] >= rgb((i - 1) / 20)[0], 'it only gets redder');
  assert.equal(gaugeColour(-1), gaugeColour(0)); assert.equal(gaugeColour(2), gaugeColour(1));
});

test('the power gauge sits at the aim, clear of a finger, and always on screen', () => {
  assert.deepEqual(gaugeAt(500, 325, 1000, 650, false), { x: 500, y: 325 }, 'round the dot or the pointer');
  const out = GAUGE_SIZE / 2, inside = ({ x, y }, w, h, why) => assert.ok(x >= out && x <= w - out && y >= out && y <= h - out, `${why}: ${x}, ${y}`);
  inside(gaugeAt(3, 2, 1000, 650, false), 1000, 650, 'a pointer in the corner');
  inside(gaugeAt(998, 648, 1000, 650, false), 1000, 650, 'and the far one');
  // A finger's pad is about 25 px round its point and comes from below: the gauge is never over that or below it.
  for (const [w, h] of [[390, 780], [780, 390]]) for (let x = 0; x <= w; x += 13) for (let y = 0; y <= h; y += 13) {
    const at = gaugeAt(x, y, w, h, true);
    inside(at, w, h, `a finger at ${x}, ${y}`);
    assert.ok(Math.hypot(at.x - x, at.y - y) >= out + 25, `over the finger at ${x}, ${y}: ${at.x}, ${at.y}`);
    if (y > 120) assert.ok(at.y < y, `above a finger at ${x}, ${y}: ${at.y}`);
  }
});
