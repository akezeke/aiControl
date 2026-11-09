import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { walkGrid } from '../client/office/path.js';
import { newSnake, turn, go, step, tick, reach, settled, SPAN, DIRS } from '../client/office/snake.js';

const box = (x1, z1, x2, z2) => new THREE.Box3(new THREE.Vector3(x1, 0, z1), new THREE.Vector3(x2, 1, z2));
const V = (x, z) => new THREE.Vector3(x, 0, z), first = () => 0;
const open = walkGrid([], { width: 10, depth: 10 });

test('starts curled up at the spot, facing the longest way clear, and waits', () => {
  const s = newSnake(open, V(5, 0.2), 0, first);
  assert.equal(s.mode, 'ready'); assert.equal(s.body.length, 3);
  assert.ok(s.body.every(b => b[0] === s.body[0][0] && b[1] === s.body[0][1]));
  assert.deepEqual(DIRS[s.dir], [0, 1]); // from the back wall, into the room
  assert.deepEqual(tick(s, open, 5), []);
  go(s); assert.deepEqual(tick(s, open, 1.01), ['step', 'step', 'step', 'step']);
  assert.ok(Math.abs(s.body[0][1] - s.body[1][1] - SPAN) < 1e-9);
});

test('turns left or right of its heading at the next step, two at most waiting', () => {
  const s = newSnake(open, V(5, 5), 0, first); s.dir = 0;
  turn(s, 1); assert.equal(s.mode, 'play'); assert.equal(s.dir, 0);
  step(s, open); assert.deepEqual(DIRS[s.dir], [1, 0]);
  turn(s, -1); turn(s, -1); turn(s, -1); assert.equal(s.turns.length, 2);
  step(s, open); step(s, open); assert.deepEqual(DIRS[s.dir], [-1, 0]);
});

test('a wall, furniture or its own body ends the run', () => {
  const wall = newSnake(open, V(5, 5), 0, first); wall.dir = 1; wall.apple = null; go(wall);
  const steps = []; while (wall.mode === 'play') steps.push(step(wall, open));
  assert.equal(steps.at(-1), 'crash'); assert.ok(wall.body[0][0] < 10 - 0.3);
  assert.equal(settled(wall), false); tick(wall, open, 0.6); assert.equal(settled(wall), true);

  const desk = walkGrid([box(6, 4, 7, 6)], { width: 10, depth: 10 }), s = newSnake(desk, V(4, 5), 0, first); s.dir = 1; s.apple = null; go(s);
  while (s.mode === 'play') step(s, desk);
  assert.ok(s.body[0][0] < 6 - 0.3);

  const coil = newSnake(open, V(5, 5), 0, first); coil.dir = 0; go(coil);
  coil.body = [[5.125, 5.125], [5.125, 5.625], [5.625, 5.625], [5.625, 5.125], [5.625, 4.625]]; // heading for its own side
  coil.dir = 1; assert.equal(step(coil, open), 'crash');
});

test('the tail moving off leaves room to follow it round', () => {
  const s = newSnake(open, V(5, 5), 0, first); go(s); s.apple = null;
  s.body = [[5.125, 5.125], [5.125, 5.625], [5.625, 5.625], [5.625, 5.125]]; s.dir = 1; // its tail is where it's going
  assert.equal(step(s, open), 'step');
});

test('an apple is somewhere it can get to, a few metres off; eating it grows it and speeds it up', () => {
  const walled = walkGrid([box(0, 4.9, 10, 5.1)], { width: 10, depth: 10 }); // a wall right across the middle
  for (let k = 0; k < 20; k++) {
    const s = newSnake(walled, V(5, 2), 0, Math.random), steps = reach(walled, s.body[0]).find(([x, z]) => x === s.apple[0] && z === s.apple[1])[2];
    assert.ok(s.apple[1] < 5 && steps >= 6 && steps <= 16, `${s.apple} ${steps}`);
  }
  const s = newSnake(open, V(5, 5), 0, first); s.dir = 1; go(s);
  s.apple = [s.body[0][0] + SPAN, s.body[0][1]];
  assert.equal(step(s, open), 'eat');
  assert.deepEqual([s.eaten, s.body.length], [1, 4]); assert.ok(s.rate > 4);
  assert.notDeepEqual(s.apple, s.body[0]);
});

test('a crash keeps the best and sees whether it was one', () => {
  const s = newSnake(open, V(5, 5), 2, first); s.eaten = 3; s.dir = 1; s.apple = null; go(s);
  while (s.mode === 'play') tick(s, open, 0.1);
  assert.deepEqual([s.best, s.record, s.acc], [3, true, 0]);
});
