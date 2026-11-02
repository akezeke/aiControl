import test from 'node:test';
import assert from 'node:assert/strict';
import { newTable, start, step, waiting, TABLE, LANE, LEFT, ARC, R, DT } from '../client/office/pinball.js';

const run = (t, seconds, each) => { for (let i = 0; i < seconds / DT; i++) { step(t); each?.(t); } };
const playing = () => { const t = newTable(); t.input.left = true; step(t); t.input.left = false; return t; };
const plunge = (t, seconds) => { t.input.plunge = true; run(t, seconds); t.input.plunge = false; };
const loose = (x, y, vx = 0, vy = 0) => { const t = newTable(); t.mode = 'play'; t.ball = 3; t.balls = [{ x, y, vx, vy }]; return t; };

test('a flip starts a game with a ball on the plunger; a full pull sends it round the top, a tap leaves it there', () => {
  const t = playing();
  assert.deepEqual([t.mode, t.ball, t.balls.length, waiting(t)], ['play', 1, 1, true]);
  plunge(t, 0.1); run(t, 1);
  assert.ok(waiting(t), 'a tap does nothing');
  plunge(t, 1); run(t, 0.01);
  assert.ok(t.saveUntil > t.time, 'the ball save is on');
  let top = 0, out = false;
  run(t, 2, t => { const b = t.balls[0]; if (b) { top = Math.max(top, b.y); out ||= b.x < LANE.wall - 0.05; } });
  assert.ok(top > 1.05 && out, `went round the arc into the playfield (top ${top.toFixed(2)})`);
  assert.ok(!t.fruits[0], "a launch round the arc isn't an orbit shot");
});

test('balls let loose anywhere drain in the end, never stuck or off the table', () => {
  let seed = 7; const rand = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const underRamp = (x, y) => x > -0.24 && x < -0.163 && y > 0.595 && y < 0.695 || x > 0.13 && x < 0.21 && y > 0.595 && y < 0.755;
  for (let n = 0; n < 150; n++) {
    let x, y; do { x = -0.26 + rand() * 0.52; y = 0.42 + rand() * 0.62; } while (underRamp(x, y) || y > ARC.y && Math.hypot(x - ARC.x, y - ARC.y) > ARC.r - 0.02);
    const t = loose(x, y, (rand() - 0.5) * 4, (rand() - 0.5) * 4);
    for (let s = 0; s < 60 && t.mode === 'play'; s += DT) {
      step(t);
      for (const b of t.balls) assert.ok(b.ramp || b.x > LEFT - R && b.x < LANE.out && b.y < ARC.y + ARC.r, `ball ${n} escaped at ${b.x}, ${b.y}`);
    }
    assert.equal(t.mode, 'over', `ball ${n} never drained: ${JSON.stringify(t.balls)}`);
  }
});

test('a ball rolling down an inlane goes onto the flipper without bouncing off its pivot', () => {
  for (const s of [1, -1]) {
    const t = loose(-0.2165 * s, 0.36, 0, -0.3); let up = 0;
    run(t, 1.5, t => { const b = t.balls[0]; if (b && Math.hypot(b.x + 0.1 * s, b.y - 0.15) < 0.04) up = Math.max(up, b.vy); });
    assert.ok(up < 0.05, `bounced up at ${up.toFixed(2)} m/s`);
  }
});

test('the flippers hit hard enough to reach the bumpers', () => {
  const t = loose(-0.06, 0.25); run(t, 0.3);
  t.input.left = true; let top = 0; run(t, 1, t => { if (t.balls[0]) top = Math.max(top, t.balls[0].y); });
  assert.ok(top > 0.6, `reached ${top.toFixed(2)}`);
});

test('a ramp made hard enough drops the ball into the far inlane; too soft, it rolls back out', () => {
  for (const [i, inlane] of [[0, 0.2165], [1, -0.2165]]) {
    const [x1, x2, y] = TABLE.ramps[i].mouth, soft = loose((x1 + x2) / 2, y - 0.02, 0, 1.4), hard = loose((x1 + x2) / 2, y - 0.02, 0, 2.6);
    let rode = false; run(soft, 1.5, t => { rode ||= !!t.balls[0]?.ramp; });
    assert.ok(rode && !soft.fruits[i + 1] && soft.balls[0].y < y, `ramp ${i}: rolled back`);
    let off = null; run(hard, 1.5, t => { const b = t.balls[0]; if (!off && t.fruits[i + 1]) off = { x: b.x, y: b.y }; });
    assert.ok(off && Math.abs(off.x - inlane) < 0.01 && off.y < 0.5, `ramp ${i}: made, off over the inlane at ${JSON.stringify(off)}`);
  }
});

test('the rules: lanes, the multiplier, fruit, Fruit Salad, multiball, a saved ball once, and the end', () => {
  const t = playing(); plunge(t, 1); run(t, 0.5);
  t.balls[0] = { x: 0, y: 0.05, vx: 0, vy: -1 }; run(t, 0.1);
  assert.deepEqual([t.ball, t.message.text, waiting(t)], [1, 'BALL SAVED', true]);
  plunge(t, 1); run(t, 0.5); t.balls[0] = { x: 0, y: 0.05, vx: 0, vy: -1 }; run(t, 0.1);
  assert.equal(t.ball, 2, 'only once');
  t.balls = [{ x: 0.12, y: 1.0, vx: 0, vy: -0.5 }]; t.lit = [true, true, true, true, false]; t.skillUntil = 0; run(t, 0.1);
  assert.deepEqual([t.mult, t.lit.some(Boolean), t.fruits[5]], [2, false, true], 'all five lanes: 2×, and the cherries');
  t.fruits = [true, true, true, true, false, true];
  const g = TABLE.targets[2]; t.targets = [false, false, true];
  t.balls = [{ x: g.x - 0.03, y: g.y, vx: 1, vy: 0 }]; run(t, 0.1);
  assert.deepEqual([t.multiball, t.balls.length, t.fruits.some(Boolean), t.saladUntil > t.time], [true, 2, false, true], 'the last fruit starts Fruit Salad');
  const before = t.score; t.balls[0] = { x: 0.24, y: 0.69, vx: 0, vy: 0 }; run(t, 0.01);
  assert.equal(t.score - before, (25000 + 2500) * 2 * 3, 'the jackpot and the orange (the fruit start over), times 2, times 3 in the salad');
  t.balls = []; run(t, 1.6);
  assert.deepEqual(t.targets, [true, true, true], 'the targets come back up');
  t.ball = 3; t.saveUntil = 0; t.balls = [{ x: 0, y: 0.05, vx: 0, vy: -1 }]; run(t, 0.1);
  assert.deepEqual([t.mode, t.last, t.best], ['over', t.score, t.score]);
});

test('three nudges in a row tilt: the flippers go dead until the next ball', () => {
  const t = playing(); plunge(t, 1); run(t, 0.3);
  for (let i = 0; i < 3; i++) { t.input.nudge = true; run(t, 0.05); t.input.nudge = false; run(t, 0.2); }
  assert.ok(t.tilted);
  t.input.left = true; run(t, 0.1); assert.equal(t.flippers[0].a, t.flippers[0].rest);
});
