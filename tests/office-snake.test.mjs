import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { walkGrid, index, CELL } from '../client/office/path.js';
import { newSnake, turn, go, step, tick, reach, settled, spine, SPAN, DIRS, LENGTH, GROW, STALL } from '../client/office/snake.js';

const box = (x1, z1, x2, z2) => new THREE.Box3(new THREE.Vector3(x1, 0, z1), new THREE.Vector3(x2, 1, z2));
const V = (x, z) => new THREE.Vector3(x, 0, z), first = () => 0;
const open = walkGrid([], { width: 10, depth: 10 });
const at = (x, z, ...moves) => moves.reduce(([a, b], [dx, dz]) => [a + dx * SPAN, b + dz * SPAN], [x, z]); // a spot some steps from (x, z)

test('a step is one cell of the walk grid, quick enough that a turn waits at most an eighth of a second', () => {
  assert.equal(SPAN, CELL);
  assert.ok(1 / newSnake(open, V(5, 5)).rate <= 0.125);
});

test('starts curled up at the spot, facing the longest way clear, and waits', () => {
  const s = newSnake(open, V(5, 0.2), 0, first);
  assert.equal(s.mode, 'ready'); assert.equal(s.body.length, LENGTH);
  assert.ok(s.body.every(b => b[0] === s.body[0][0] && b[1] === s.body[0][1]));
  assert.deepEqual(DIRS[s.dir], [0, 1]); // from the back wall, into the room
  assert.deepEqual(tick(s, open, 5), []);
  go(s); s.apple = null; assert.equal(tick(s, open, 4.01 / s.rate).length, 4);
  assert.ok(Math.abs(s.body[0][1] - s.body[1][1] - SPAN) < 1e-9);
});

test('turns left or right of its heading at the next step, two at most waiting', () => {
  const s = newSnake(open, V(5, 5), 0, first); s.dir = 0; s.apple = null;
  turn(s, 1); assert.equal(s.mode, 'play'); assert.equal(s.dir, 0);
  step(s, open); assert.deepEqual(DIRS[s.dir], [1, 0]);
  turn(s, -1); turn(s, -1); turn(s, -1); assert.equal(s.turns.length, 2);
  step(s, open); step(s, open); assert.deepEqual(DIRS[s.dir], [-1, 0]);
});

test('about to hit something, it holds a moment for a turn, taken there and then', () => {
  const s = newSnake(open, V(9.4, 5), 0, first); s.dir = 1; s.apple = null; go(s); // right up against the right wall, facing it
  const [x, z] = s.body[0];
  tick(s, open, 1.05 / s.rate); assert.equal(s.mode, 'play'); assert.deepEqual(s.body[0], [x, z]);
  turn(s, 1); tick(s, open, 0.01);
  assert.deepEqual(DIRS[s.dir], [0, 1]); assert.deepEqual(s.body[0], at(x, z, [0, 1]));
});

test('with no turn, or only one into something else, it crashes once the hold is up', () => {
  const crashAfter = (s, each) => { let time = 0; while (s.mode === 'play') { tick(s, open, 0.01); time += 0.01; each?.(); } return time; };
  const s = newSnake(open, V(9.4, 5), 0, first); s.dir = 1; s.apple = null; go(s);
  const waited = crashAfter(s) - 1 / s.rate;
  assert.ok(waited >= STALL - 0.02 && waited <= STALL + 0.03, `${waited}`);

  const corner = newSnake(open, V(9.4, 9.4), 0, first); corner.dir = 1; corner.apple = null; go(corner); // the front wall's to its right
  let turned = false;
  crashAfter(corner, () => { if (!turned && corner.acc >= 1) { turn(corner, 1); turned = true; } });
  assert.deepEqual(DIRS[corner.dir], [0, 1]); assert.equal(corner.mode, 'over');
});

test('a wall, furniture or its own body ends the run', () => {
  const wall = newSnake(open, V(5, 5), 0, first); wall.dir = 1; wall.apple = null; go(wall);
  const steps = []; while (wall.mode === 'play') steps.push(step(wall, open));
  assert.equal(steps.at(-1), 'crash'); assert.ok(wall.body[0][0] < 10 - 0.3);
  assert.equal(settled(wall), false); tick(wall, open, 0.6); assert.equal(settled(wall), true);

  const desk = walkGrid([box(6, 4, 7, 6)], { width: 10, depth: 10 }), s = newSnake(desk, V(4, 5), 0, first); s.dir = 1; s.apple = null; go(s);
  while (s.mode === 'play') step(s, desk);
  assert.ok(s.body[0][0] < 6 - 0.3 && s.body[0][0] > 6 - 0.3 - 1.5 * SPAN, `${s.body[0][0]}`); // right up to it

  const coil = newSnake(open, V(5, 5), 0, first); coil.apple = null; go(coil);
  const [x, z] = coil.body[0];
  coil.body = [[x, z], at(x, z, [0, 1]), at(x, z, [0, 1], [1, 0]), at(x, z, [1, 0]), at(x, z, [1, 0], [0, -1])]; // heading for its own side
  coil.dir = 1; assert.equal(step(coil, open), 'crash');
});

test('the tail moving off leaves room to follow it round', () => {
  const s = newSnake(open, V(5, 5), 0, first); go(s); s.apple = null;
  const [x, z] = s.body[0];
  s.body = [[x, z], at(x, z, [0, 1]), at(x, z, [0, 1], [1, 0]), at(x, z, [1, 0])]; s.dir = 1; // its tail is where it's going
  assert.equal(step(s, open), 'step');
});

test('an apple is somewhere it can get to, a few metres off; eating it grows it over the next steps and speeds it up', () => {
  const walled = walkGrid([box(0, 4.9, 10, 5.1)], { width: 10, depth: 10 }); // a wall right across the middle
  for (let k = 0; k < 20; k++) {
    const s = newSnake(walled, V(5, 2), 0, Math.random), metres = reach(walled, s.body[0])[index(walled, { x: s.apple[0], z: s.apple[1] })] * SPAN;
    assert.ok(s.apple[1] < 5 && metres >= 3 && metres <= 8, `${s.apple} ${metres}`);
  }
  const s = newSnake(open, V(5, 5), 0, first); s.dir = 1; go(s);
  s.apple = at(...s.body[0], [1, 0]);
  assert.equal(step(s, open), 'eat'); s.apple = null;
  assert.equal(s.eaten, 1); assert.ok(s.rate > newSnake(open, V(5, 5)).rate);
  for (let k = 1; k < GROW + 2; k++) step(s, open);
  assert.equal(s.body.length, LENGTH + GROW);
});

test('a crash keeps the best and sees whether it was one', () => {
  const s = newSnake(open, V(5, 5), 2, first); s.eaten = 3; s.dir = 1; s.apple = null; go(s);
  while (s.mode === 'play') tick(s, open, 0.05);
  assert.deepEqual([s.best, s.record, s.acc], [3, true, 0]);
});

test('a ring keeps to its bit of the body, steady while the body turns a corner', () => {
  const s = newSnake(open, V(1, 5), 0, first); s.apple = null; s.dir = 1; go(s);
  for (let f = 0; f < 60 * (LENGTH + 2) / s.rate; f++) tick(s, open, 1 / 60); // all of it unrolled, heading east
  turn(s, 1);
  const xs = [];
  for (let f = 0; f < 40; f++) {
    tick(s, open, 1 / 60);
    const points = s.body.map((b, i) => { const a = s.prev[i] || b; return V(a[0] + (b[0] - a[0]) * s.acc, a[1] + (b[1] - a[1]) * s.acc); });
    xs.push(spine(points, s.body.length - 2, new THREE.Vector3()).x); // near the tail, still on the straight
  }
  for (let k = 1; k < xs.length; k++) assert.ok(xs[k] >= xs[k - 1] - 1e-9, `frame ${k}: ${xs[k - 1]} → ${xs[k]}`);
});

