import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Cast, poseTargets, waitingPose, finishes } from '../client/office/animation.js';
import { handGeometry, fistGeometry } from '../client/office/fruit.js';

const fruit = { height: 0.5, surface: () => ({ x: 0, r: 0.22 }) };

test('a compacting fruit shivers in its seat, big enough to see across the room', () => {
  const frames = Array.from({ length: 120 }, (_, i) => poseTargets('squeezing', i / 60, 1, fruit));
  const range = pick => Math.max(...frames.map(pick)) - Math.min(...frames.map(pick));
  assert.ok(range(p => p.body.tilt) > 0.12, 'rocks side to side');
  assert.ok(range(p => p.x) > 0.03, 'jiggles on the spot');
  assert.ok(range(p => p.body.y) < 0.04 && Math.abs(frames[0].z - poseTargets('thinking', 0, 1, fruit).z) < 0.01, 'stays in the chair');
  assert.deepEqual(poseTargets('squeezing', 0, 1, fruit), poseTargets('squeezing', 0, 1, fruit), 'reduced motion (t = 0) holds still');
});

test('waiting on a task: awake in the seat, drumming on the desk in bursts, looking up at the monitor now and then', () => {
  const frames = Array.from({ length: 600 }, (_, i) => poseTargets('drumming', i / 30, 1, fruit)), typing = poseTargets('typing', 0, 1, fruit), lift = frames.map(p => p.limbs.rightHand.y);
  assert.ok(frames.every(p => Math.abs(p.z - typing.z) < 0.01), 'stays in the chair');
  assert.ok(Math.max(...lift) - Math.min(...lift) > 0.03, 'the fingers lift and come back down');
  assert.ok(frames.some(p => p.glance) && frames.some(p => !p.glance), 'checks the monitor now and then');
  assert.deepEqual(poseTargets('drumming', 0, 1, fruit), poseTargets('drumming', 0, 1, fruit), 'reduced motion (t = 0) holds still');
});

test('a finish plays when the work is really over: from working or waiting to asleep, not from working to waiting', () => {
  assert.deepEqual(['typing', 'drumming', 'raising'].map(from => finishes(from, 'sleeping')), [true, true, false]);
  assert.equal(finishes('typing', 'drumming'), false);
});

test('waiting on you gets louder: a raised hand, waving after two minutes, a tapping foot after ten', () => {
  const now = 1_000_000_000, ago = minutes => now - minutes * 60_000;
  assert.deepEqual([0.5, 3, 12].map(m => waitingPose(ago(m), now)), ['raising', 'waving', 'impatient']);
  const frames = Array.from({ length: 60 }, (_, i) => poseTargets('impatient', i / 6, 1, fruit));
  assert.ok(Math.max(...frames.map(p => p.limbs.rightFoot.y)) > 0.06, 'taps a foot');
  assert.ok(frames.every(p => p.z < -0.5), 'stands behind the chair');
  assert.ok(frames.every(p => p.elbows > 0 && p.limbs.rightHand.x < -fruit.surface(fruit.height * 0.32).r), 'a hand on the hip, outside the body');
  assert.ok(frames.some(p => p.glance) && frames.some(p => !p.glance), 'looks at the watch now and then');
});

test('finishing is a stretch (hands together overhead) or a cheer (arms out in a V), in the seat', () => {
  const [stretch, cheer] = ['stretching', 'cheering'].map(pose => poseTargets(pose, 0.4, 1, fruit)), seated = poseTargets('typing', 0, 1, fruit);
  for (const p of [stretch, cheer]) {
    assert.ok(p.limbs.leftHand.y > p.body.y + fruit.height && p.limbs.rightHand.y > p.body.y + fruit.height, 'hands above the head');
    assert.ok(Math.abs(p.z - seated.z) < 0.01, 'stays in the chair');
  }
  assert.ok(cheer.limbs.leftHand.x - cheer.limbs.rightHand.x > 2 * (stretch.limbs.leftHand.x - stretch.limbs.rightHand.x), 'a cheer spreads wider');
});

test('habits: a pecker hops one finger, a thinker scratches or looks up with hands behind the head, a sleeper folds hands in the lap', () => {
  const at = (pose, habit, t = 0.4) => poseTargets(pose, t, 1, fruit, 0, habit), frames = habit => Array.from({ length: 60 }, (_, i) => at('typing', habit, i / 30));
  const hop = habit => Math.max(...frames(habit).map(p => p.limbs.rightHand.y)) - Math.min(...frames(habit).map(p => p.limbs.rightHand.y));
  assert.ok(hop('peck') > 2 * hop(''), 'the pecking finger lifts higher');
  assert.ok(at('thinking', 'scratch').limbs.rightHand.y > at('thinking', '').limbs.rightHand.y + 0.1, 'a hand up at the head');
  const ceiling = at('thinking', 'ceiling');
  assert.ok(ceiling.limbs.leftHand.z < 0 && ceiling.limbs.rightHand.z < 0 && ceiling.glance.y > ceiling.body.y + fruit.height, 'hands behind the head, eyes up');
  const lap = at('sleeping', 'lap'), heels = at('sleeping', '');
  assert.ok(lap.limbs.leftFoot.y < 0.1 && heels.limbs.leftFoot.y > 0.5, 'feet stay down');
  assert.deepEqual(at('typing', 'touch'), at('typing', ''), 'the first habit is the plain pose');
});

test('neighbours: a thumbs up goes up beside the head on their side; a worried look keeps the hands on the keys', () => {
  for (const [habit, hand, other] of [['left', 'leftHand', 'rightHand'], ['right', 'rightHand', 'leftHand']]) {
    const p = poseTargets('thumbsup', 0.4, 1, fruit, 0, habit);
    assert.equal(p.thumb, hand);
    assert.ok(p.limbs[hand].y > p.body.y + fruit.height && p.limbs[other].y < p.body.y + 0.2, 'one hand up high, the other in the lap');
    assert.ok(Math.sign(p.limbs[hand].x) === (habit === 'left' ? 1 : -1), 'on the side they turn to');
  }
  const worried = poseTargets('concerned', 0.4, 1, fruit), typing = poseTargets('typing', 0.4, 1, fruit);
  assert.ok(Math.abs(worried.limbs.leftHand.z - typing.limbs.leftHand.z) < 0.05 && Math.abs(worried.limbs.leftHand.y - typing.limbs.leftHand.y) < 0.03, 'hands stay on the keys');
  const [hand, fist] = [handGeometry(), fistGeometry()];
  assert.ok(fist.attributes.position.count === hand.attributes.position.count && fist.index.count === hand.index.count, 'the fist swaps in for the hand in place');
});

test('the fired sob with their hands over their eyes, sitting and then running for the door', () => {
  for (const pose of ['crying', 'fleeing']) {
    // The eyes, where leaning forward has carried them.
    const p = poseTargets(pose, 0.4, 1, fruit), eyes = p.body.y + fruit.height * 0.6 * Math.cos(p.body.lean) - fruit.surface().r * Math.sin(p.body.lean);
    for (const hand of [p.limbs.leftHand, p.limbs.rightHand]) assert.ok(Math.abs(hand.y - eyes) < 0.08 && hand.z > fruit.surface().r && Math.abs(hand.x) < 0.12, `${pose}: a hand on the face`);
  }
  const strides = Array.from({ length: 30 }, (_, i) => poseTargets('fleeing', i / 30, 1, fruit).limbs.leftFoot.z), walk = Array.from({ length: 30 }, (_, i) => poseTargets('walking', i / 30, 1, fruit).limbs.leftFoot.z);
  assert.ok(Math.max(...strides) - Math.min(...strides) > Math.max(...walk) - Math.min(...walk), 'longer strides than a walk');
});

test('startled, a sitter sits up to turn round, feet and hands off the desk, then goes back to what it was doing', t => {
  const blank = () => new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true }), was = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: blank }) };
  t.after(() => { if (was) globalThis.document = was; else delete globalThis.document; });
  const seated = pose => {
    const cast = new Cast(new THREE.Scene()), statuses = new Map([['a', { pose, expression: 'neutral' }]]);
    const room = { deskAnchor: () => ({ seat: new THREE.Vector3(), facing: 0, helpers: [] }) };
    cast.sync({ door: { x: 5, z: 5 }, desks: new Map([['a', { subagents: [], leaving: [], overflow: 0 }]]) }, new Map(), room, statuses);
    const c = cast.characters.get('a'); c.habits.sleeping = 'heels';
    const run = seconds => { for (let i = 0; i < seconds * 60; i++) cast.update(1 / 60, new THREE.Vector3(3, 1.6, 0)); return c.current; };
    return { cast, c, run };
  };
  const { cast, c, run } = seated('sleeping'), heels = run(1).limbs.leftFoot.y;
  assert.ok(heels > 0.5, 'heels up on the desk to start with');
  cast.startle('a');
  const up = run(1);
  assert.ok(up.limbs.leftFoot.y < 0.1, 'feet back on the floor');
  assert.ok(up.turn > 0.5, 'turned to the boss');
  assert.deepEqual(cast.sleepers(), [], 'awake, for the goose');
  assert.ok(run(3).limbs.leftFoot.y > 0.5, 'and back to sleep');

  const typist = seated('typing'), keys = typist.run(1).limbs.leftHand.y;
  typist.cast.startle('a');
  assert.ok(typist.run(1).limbs.leftHand.y < keys - 0.1, 'hands off the keys');

  const waver = seated('raising'), hand = waver.run(1).limbs.rightHand.y;
  waver.cast.startle('a');
  assert.ok(Math.abs(waver.run(1).limbs.rightHand.y - hand) < 0.15, 'someone already on their feet keeps standing');
});
