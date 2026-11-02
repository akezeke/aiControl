import test from 'node:test';
import assert from 'node:assert/strict';
import { make, hole, par, roll, endless, inside, height, HOLE_COUNT, PARS } from '../client/office/golf-course.js';

// The course's 50 holes, as a number: it changes whenever their shapes or obstacles do, and then PARS (golf-course.js) wants
// working out again: Array.from({ length: 50 }, (_, i) => par(hole(i + 1))).join('').
const fingerprint = () => {
  const shape = n => { const c = hole(n); return JSON.stringify([c.outline, c.tee, c.cup, c.features.map(f => [f.kind, f.x, f.z])], (k, v) => typeof v === 'number' ? +v.toFixed(3) : v); };
  let h = 0; const s = Array.from({ length: HOLE_COUNT }, (_, i) => shape(i + 1)).join('|'); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
};

test('the course is the same as when its pars were worked out, and they hold', () => {
  assert.equal(fingerprint(), 187591367, 'the holes changed: work PARS out again');
  // Surveying every hole takes most of a minute (the windmills); a spread of the quicker ones, with every kind of obstacle.
  for (const n of [1, 6, 9, 11, 12, 14, 16, 26, 27, 46]) {
    const c = hole(n);
    assert.equal(par(c), Number(PARS[n - 1]), `hole ${n}`);
    assert.ok(Math.abs(height(c, c.cup.x, c.cup.z)) < 1e-9, `hole ${n}: the cup sits on the flat`);
  }
});

test('on the flat a putt stops as far as its strength says; nothing leaves the green', () => {
  const flat = make(0, 1);
  for (const field of ['h', 'px', 'pz']) flat.grid[field].fill(0);
  Object.assign(flat, { walls: [], things: [], cup: { x: -9, z: -9 } });
  const from = { x: 6, z: 0 }, end = roll(flat, from, Math.sqrt(2 * 0.6 * 1.5), 0);
  assert.ok(end.rest && Math.abs(end.x - from.x - 1.5) < 0.03, `stopped after ${end.x - from.x}`);
  const c = hole(40);
  for (let a = 0; a < Math.PI * 2; a += 0.7) {
    const b = roll(c, c.tee, Math.cos(a) * 4, Math.sin(a) * 4);
    assert.ok(b.sunk || inside(c.outline, b.x, b.z), `a hard putt at ${a.toFixed(1)} ended off the green`);
  }
});

test('Endless deals makeable holes, a little at a time', () => {
  const run = endless(3, 42);
  let steps = 0, s;
  while (!(s = run.next()).done) steps++;
  assert.ok(steps > 0 && [2, 3].includes(s.value.par) && s.value.index === 3);
});

test('coffee stops a ball, a pipe moves it, a bumper kicks it back, a windmill blocks its tunnel only while a sail is down', () => {
  const flat = features => { const c = make(0, 1); for (const field of ['h', 'px', 'pz']) c.grid[field].fill(0); return Object.assign(c, { walls: [], things: [], cup: { x: -9, z: -9 }, features }); };
  const from = { x: 6, z: 0 };
  assert.ok(roll(flat([{ kind: 'spill', x: 6.5, z: 0, rx: 0.2, rz: 0.15, turn: 0 }]), from, 1.5, 0).spilled);
  const piped = roll(flat([{ kind: 'pipe', x: 6.5, z: 0, to: { x: 7, z: 1 }, out: Math.PI / 2 }]), from, 1.5, 0);
  assert.ok(piped.piped && piped.z > 1.1, `came out at ${piped.x}, ${piped.z}`);
  assert.ok(roll(flat([{ kind: 'bumper', x: 6.5, z: 0, r: 0.055 }]), from, 1, 0).x < from.x, 'kicked back past where it started');
  const mill = flat([{ kind: 'windmill', x: 6.5, z: 0, turn: 0, side: -1, parts: [-0.24, 0.24].map(z => ({ x: 6.5, z, w: 0.3, d: 0.32, turn: 0 })), gate: [6.33, -0.09, 6.33, 0.09] }]);
  assert.ok(roll(mill, from, 1.5, 0, 0.1).x > 6.65, 'through while the tunnel is open');
  assert.ok(roll(mill, from, 1.5, 0, 0.5).x < 6.33, 'turned back by a sail');
});
