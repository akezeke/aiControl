import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { walkGrid, index, CELL } from '../client/office/path.js';
import { createSnake, newSnake, turn, go, step, tick, reach, settled, roomy, placeApple, pack, unpack, due, KEEP, SPAN, DIRS, LENGTH, GROW, STALL, CLEAR } from '../client/office/snake.js';
import { createSnakeModel, snakeColours, spine } from '../client/office/snake-model.js';
import { fruitFood } from '../client/office/fruit.js';
import { shared } from '../client/office/furniture.js';
import { checkUp, COLOURS, FRUITS } from '../client/office/meeting.js';

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

test('the goose\'s circle is something to hit: it holds for a turn, then bumps into it', () => {
  const s = newSnake(open, V(5, 5), 0, first); s.dir = 1; s.apple = null; go(s);
  const [x, z] = s.body[0], goose = [{ x: x + SPAN + 0.15, z, r: 0.2 }]; // its circle (r + CLEAR) takes in the next cell
  const happened = []; while (s.mode === 'play') happened.push(...tick(s, open, 0.01, goose));
  assert.deepEqual(happened, ['bump']); assert.deepEqual(s.body[0], [x, z]);

  const away = newSnake(open, V(5, 5), 0, first); away.dir = 1; away.apple = null; go(away);
  tick(away, open, 1.05 / away.rate, goose); turn(away, 1); tick(away, open, 0.01, goose);
  assert.equal(away.mode, 'play'); assert.deepEqual(DIRS[away.dir], [0, 1]);
});

test('only the head minds the goose: it can waddle across the body', () => {
  const s = newSnake(open, V(5, 5), 0, first); s.dir = 1; s.apple = null; go(s);
  const [x, z] = s.body[0];
  s.body = [[x, z], at(x, z, [-1, 0]), at(x, z, [-2, 0]), at(x, z, [-3, 0])];
  const goose = [{ x: x - 2 * SPAN, z, r: 0.2 }];
  assert.ok(Math.hypot(at(x, z, [1, 0])[0] - goose[0].x, 0) >= goose[0].r + CLEAR);
  assert.equal(step(s, open, goose), 'step');
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

test('an apple never goes where the snake could get in but not out: a dead end one cell wide', () => {
  // Two desks with a gap between them one cell wide (x 3–3.25), from the back wall to z 5.3; the room's open below that.
  const narrow = walkGrid([box(0, 0, 2.68, 5), box(3.57, 0, 10, 5)], { width: 10, depth: 10 }), inGap = ([x, z]) => x > 2.9 && x < 3.4 && z < 5.3;
  assert.ok(reach(narrow, [3.125, 7.125])[index(narrow, { x: 3.125, z: 3.125 })] > 0, 'the gap is open and reachable');
  const ok = roomy(narrow);
  assert.equal(ok[index(narrow, { x: 3.125, z: 3.125 })], 0); assert.equal(ok[index(narrow, { x: 5.125, z: 7.125 })], 1);
  const s = newSnake(narrow, V(3, 7.5), 0, first); s.apple = null;
  for (let k = 0; k < 2000; k++) { const apple = placeApple(s, narrow, () => k / 2000); assert.ok(apple && !inGap(apple), `${apple}`); }
  // Two cells wide, it can turn round in there: that's fine.
  const wide = walkGrid([box(0, 0, 2.68, 5), box(3.82, 0, 10, 5)], { width: 10, depth: 10 });
  assert.equal(roomy(wide)[index(wide, { x: 3.125, z: 3.125 })], 1);
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

// The 3D's textures draw on canvases: a document whose canvases take any drawing, put back after the test.
const ctx = () => new Proxy({}, { get: (o, k) => k in o ? o[k] : () => ({ addColorStop() {} }), set: (o, k, v) => { o[k] = v; return true; } });
const stubDocument = { createElement: () => ({ getContext: ctx }) };
const paper = t => { const was = globalThis.document; globalThis.document = stubDocument; t.after(() => { if (was) globalThis.document = was; else delete globalThis.document; }); };
const luminance = hex => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };

test('a snake in a colour: darker bands and a paler belly; classic with no look', () => {
  assert.deepEqual(snakeColours(null), { skin: '#5cae4f', band: '#3d7d3c', belly: '#f0e2a6' });
  for (const colour of COLOURS) {
    const { skin, band, belly } = snakeColours({ fruit: 'apple', colour });
    assert.equal(skin, colour); assert.ok(luminance(band) < luminance(skin) && luminance(belly) > luminance(skin), colour);
  }
});

test('each colour\'s head is built once', t => {
  paper(t);
  const blue = () => createSnakeModel({ fruit: 'pear', colour: '#3a86ff' }), a = blue(), b = blue(), pink = createSnakeModel({ fruit: 'pear', colour: '#ff5d8f' });
  assert.equal(a.head.children[0].geometry, b.head.children[0].geometry);
  assert.notEqual(pink.head.children[0].geometry, a.head.children[0].geometry);
});

test('the food is the fruit, small and shared', t => {
  paper(t);
  const a = fruitFood('pear', '#3a86ff'), b = fruitFood('pear', '#3a86ff');
  assert.equal(a.children[0].geometry, b.children[0].geometry); assert.equal(a.children[0].material, b.children[0].material);
  assert.equal(a.children[0].material.userData.shared, true);
  for (const [fruit] of FRUITS) {
    const box = new THREE.Box3().setFromObject(fruitFood(fruit, '#3a86ff')), tall = box.max.y - box.min.y;
    assert.ok(tall >= 0.17 && tall <= 0.23, `${fruit} ${tall}`); assert.ok(Math.abs(box.min.y) < 0.01, `${fruit} ${box.min.y}`);
  }
  assert.equal(createSnakeModel(null).meal.children[0].geometry, shared['snake-apple']);
});

test('reduced motion keeps the body and food still', t => {
  paper(t);
  const body = Array.from({ length: 6 }, (_, i) => [2.625 - i * SPAN, 1.125]), prev = body.map(([x, z]) => [x - SPAN, z]);
  // Two updates: the tube and the food's height after each.
  const twice = reduced => {
    const m = createSnakeModel(null), seen = [];
    m.set({ body, prev, acc: 0.5, dir: 1, mode: 'play', rate: 8, stall: 0 }); m.food([1.125, 1.125]);
    for (let k = 0; k < 2; k++) { m.update(0.1, reduced); seen.push([...m.body.geometry.attributes.position.array], m.meal.position.y); }
    return seen;
  };
  const [p1, y1, p2, y2] = twice(true);
  assert.deepEqual(p2, p1); assert.equal(y2, y1);
  const [q1, z1, q2, z2] = twice(false);
  assert.notDeepEqual(q2, q1); assert.notEqual(z2, z1);
});

// Phone controls: a canvas that records its listeners, storage and a coarse pointer.
function phone(stored) {
  const saved = {}, was = { storage: globalThis.localStorage, media: globalThis.matchMedia, document: globalThis.document };
  globalThis.document = stubDocument;
  const store = { getItem: k => saved[k] ?? null, setItem: (k, v) => { saved[k] = v; } };
  if (stored !== undefined) saved['ai-control-snake-touch'] = stored;
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
  globalThis.matchMedia = () => ({ matches: true });
  const on = {}, canvas = { addEventListener: (type, fn) => { on[type] = fn; }, getBoundingClientRect: () => ({ left: 0, width: 400 }) };
  const bars = [], snake = createSnake({ canvas, grid: () => open, home: () => V(0, 0), score: goal => bars.push(goal) });
  snake.enter();
  const fire = (type, x, y = 0, id = 1) => on[type]({ pointerType: 'touch', pointerId: id, clientX: x, clientY: y });
  const restore = () => { Object.defineProperty(globalThis, 'localStorage', { value: was.storage, configurable: true, writable: true }); globalThis.matchMedia = was.media; if (was.document) globalThis.document = was.document; else delete globalThis.document; };
  return { snake, fire, bars, saved, restore, bar: () => bars.at(-1) };
}

test('swipe by default: 12 px sideways turns at once, a tap does nothing', t => {
  const p = phone(); t.after(p.restore);
  p.fire('pointerdown', 200); assert.equal(p.snake.game.mode, 'play'); // sets it going
  p.fire('pointerup', 200);
  p.fire('pointerdown', 100); p.fire('pointerup', 100);
  assert.deepEqual(p.snake.game.turns, [], 'a tap while playing');
  p.fire('pointerdown', 100, 50, 2); p.fire('pointermove', 111, 50, 2); assert.deepEqual(p.snake.game.turns, []);
  p.fire('pointermove', 112, 50, 2); assert.deepEqual(p.snake.game.turns, [1], 'before it is lifted');
  p.fire('pointermove', 200, 50, 2); assert.deepEqual(p.snake.game.turns, [1], 'one turn a finger');
});

test('tap chosen: a finger turns to its half as it lands', t => {
  const p = phone('tap'); t.after(p.restore);
  p.fire('pointerdown', 300); assert.equal(p.snake.game.mode, 'play');
  p.fire('pointerdown', 100, 0, 2); assert.deepEqual(p.snake.game.turns, [-1]);
  p.fire('pointerdown', 300, 0, 3); assert.deepEqual(p.snake.game.turns, [-1, 1]);
});

test('the chips pick, save and are read back; anything unknown is swipe', t => {
  const p = phone(); t.after(p.restore);
  const chips = () => p.bar().filter(item => item.pick);
  assert.deepEqual(chips().map(c => [c.text, c.on]), [['↔ Swipe', true], ['👆 Tap', false]]);
  assert.equal(p.bar().at(-1).text, 'Tap to go');
  chips()[1].pick();
  assert.equal(p.saved['ai-control-snake-touch'], 'tap');
  assert.deepEqual(chips().map(c => c.on), [false, true], 'the bar is redrawn');
  assert.equal(p.snake.game.mode, 'ready');
  const again = phone(p.saved['ai-control-snake-touch']); again.fire('pointerdown', 300); again.fire('pointerdown', 100, 0, 2);
  assert.deepEqual(again.snake.game.turns, [-1], 'read back');
  again.restore();
  const odd = phone('sideways'); odd.fire('pointerdown', 300); odd.fire('pointerdown', 100, 0, 2);
  assert.deepEqual(odd.snake.game.turns, [], 'swipe');
  odd.restore();
});

test('pack says each segment as a step from the one before it, and unpack walks it back', () => {
  const body = [[1.125, 1.125], [1.125, 1.375], [1.375, 1.375], [1.375, 1.375]];
  const m = pack({ body, dir: 0, mode: 'play', rate: 8, apple: [2.125, 1.125] }, 1);
  assert.equal(m.path, '21-'); assert.deepEqual(m.head, [1.125, 1.125]); assert.deepEqual(m.food, [2.125, 1.125]);
  assert.deepEqual(unpack(m), body);
});

test('a new snake, all in one cell, packs as dashes and passes the checks', () => {
  const s = newSnake(open, V(5, 5), 0, first), m = pack(s, 0);
  assert.equal(m.path, '-'.repeat(LENGTH - 1));
  assert.deepEqual(checkUp(m), m); assert.deepEqual(unpack(m), s.body);
});

test('a run of steps round a U packs and unpacks exactly', () => {
  const s = newSnake(open, V(5, 5), 0, first); s.apple = null; go(s);
  for (let i = 0; i < 20; i++) {
    if (i === 5 || i === 12) turn(s, 1);
    assert.notEqual(step(s, open), 'crash'); assert.deepEqual(unpack(pack(s, 0)), s.body);
  }
});

test('a path is cut at 1200', () => {
  const body = Array.from({ length: 1300 }, (_, i) => [1.125 + (i % 40) * SPAN, 1.125 + Math.floor(i / 40) * SPAN]);
  assert.equal(pack({ body, dir: 0, mode: 'play', rate: 8, apple: null }, 0).path.length, 1200);
});

test('a minute of play sends under the hub\'s limit', () => {
  const sends = []; let last = null, prev = 0;
  for (let f = 0; f <= 3600; f++) {
    const t = f / 60, mode = t < 1 ? 'ready' : 'play', moved = Math.floor(t * 16) !== Math.floor((t - 1 / 60) * 16);
    if (due(last, t, mode, moved)) { sends.push([t, 'snake']); last = { at: t, mode }; }
    if (f % 120 === 0) sends.push([t, 'pos']);
    prev = t;
  }
  const snakes = sends.filter(s => s[1] === 'snake');
  for (const [start] of sends) {
    const win = sends.filter(s => s[0] >= start && s[0] < start + 1);
    assert.ok(win.filter(s => s[1] === 'snake').length <= 9); assert.ok(win.length <= 10);
  }
  for (let i = 1; i < snakes.length; i++) assert.ok(snakes[i][0] - snakes[i - 1][0] <= KEEP + 0.05);
});

test('in play with no step for 2 s it still says so', () => {
  assert.equal(due({ at: 0, mode: 'play' }, 2, 'play', false), true);
  assert.equal(due({ at: 0, mode: 'play' }, 1.9, 'play', false), false);
});
