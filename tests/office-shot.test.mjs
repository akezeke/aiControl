import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeBody, simulate } from '../client/office/flight.js';
import { ZONES, levelWorld } from '../client/office/kitchen-plan.js';
import { FLIGHT, SLOW, SLOW_FOR, SOFT, RETRY, LONGEST, MOST_TIME, SETTLE, HARD_TIME, scoreContacts, inZone, runShot, createRun } from '../client/office/shot.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const kind = (bounce, extra = {}) => ({ radius: 0.05, low: 0.05, bounce, roll: 1, drag: 0.1, upright: false, ...extra });
const ball = kind(0.5), rubber = kind(0.95), dead = kind(0.1);
const hit = (surface, speed = 3) => ({ surface, speed }), pick = ({ points, multiplier }) => ({ points, multiplier });
const onBin = () => makeBody(ball, V(-0.5, 1, -2.5), V(0, 8, 0)); // up to the ceiling, then down into the bin
const count = (r, surface) => r.contacts.filter(c => c.surface === surface).length;
const everywhere = { centre: V(-5, 1.5, -3), half: V(6, 2, 4) }; // a zone no end can miss: only the end itself decides

test('a surface is worth its size', () => {
  assert.deepEqual(pick(scoreContacts([hit('fridge'), hit('pan-1'), hit('ceiling')])), { points: 350, multiplier: 3 });
  assert.deepEqual(pick(scoreContacts([hit('floor')])), { points: 0, multiplier: 1 });
});
test('repeats are worth half, then a quarter, then nothing, with no multiplier', () => {
  const r = scoreContacts(['fridge', 'fridge', 'fridge', 'fridge'].map(s => hit(s)));
  assert.deepEqual(pick(r), { points: 175, multiplier: 2 });
});
test('each chair and each wall scores on its own', () => assert.equal(scoreContacts([hit('chair-1'), hit('chair-2')]).multiplier, 3));
test('a contact softer than 0.5 m/s scores nothing', () => {
  assert.equal(scoreContacts([hit('table-1', 0.4)]).points, 0);
  assert.deepEqual(scoreContacts([hit('table-1', 0.4), hit('table-1', 3)]).surfaces, ['table-1']);
});
test('inZone takes a position as an array or a vector', () => {
  const z = ZONES.bin;
  assert.ok(inZone(z.centre.toArray(), z) && inZone(z.centre, z) && !inZone([0, 5, 0], z));
});

test('a made shot scores points times multiplier, a miss scores 0', () => {
  const made = runShot(onBin(), ZONES.bin);
  assert.ok(made.made && made.rest && made.surfaces.includes('ceiling'));
  assert.deepEqual([made.points, made.multiplier, made.score], [50, 1, 50]);
  const miss = runShot(makeBody(ball, V(-1.5, 1, -2.5), V(0, 8, 0)), ZONES.bin);
  assert.ok(!miss.made && miss.points === 50 && miss.score === 0);
});

test('a shot that bounces out of its zone doesn\'t count', () => {
  let found = 0;
  for (let vx = 0.5; vx <= 3 && !found; vx += 0.25) for (let vz = -2; vz <= 2 && !found; vz += 0.5) {
    const b = makeBody(rubber, V(-0.5, 1.2, -2.5), V(vx, 0, vz)), r = runShot(b, ZONES.bin);
    let entered = false; for (let i = 0; i < r.path.length; i += 3) entered ||= inZone([r.path[i], r.path[i + 1], r.path[i + 2]], ZONES.bin);
    if (entered && !r.made) found++;
  }
  assert.ok(found, 'some rubber throw entered and left');
});

test('one real drop on a table is one hit, not a repeat', () => {
  const r = runShot(makeBody(dead, V(-7.2, 1, -1.4), V(0, 0, 0)), null);
  assert.equal(count(r, 'table-1'), 1);
  assert.ok(r.rest && r.surfaces.length === 1 && r.surfaces[0] === 'table-1' && r.contacts[0].speed > 1.5);
  assert.deepEqual(pick(r), { points: 100, multiplier: 2 });
});

test('a ball rolling across the floor from one touch is one touch', () => {
  const r = runShot(makeBody(ball, V(-2, 0.06, -2.5), V(-2, -0.5, 0)), null);
  assert.equal(count(r, 'floor'), 1);
  assert.ok(r.rest && r.time < 8 && r.contacts[0].speed < 1 && r.contacts[0].speed >= 0.5);
  assert.ok(Math.abs(r.path.at(-3) - -2) > 0.5, 'and it rolled');
});

test('a floor touch scores nothing and adds no multiplier, and ends nothing', () => {
  assert.deepEqual(pick(scoreContacts([hit('floor'), hit('floor'), hit('floor')])), { points: 0, multiplier: 1 });
  const r = runShot(makeBody(ball, V(-2, 1.5, -2.5), V(0, 0, 0)), ZONES.bin);
  assert.ok(count(r, 'floor') >= 2 && r.points === 0 && r.multiplier === 1);
  assert.ok(r.rest && r.time > r.contacts.at(-1).time && r.time < MOST_TIME, 'it played on to rest');
});

test('three floor touches, then a wall, then a rest in the target: made, and the wall scored', () => {
  const r = runShot(makeBody(kind(0.85), V(-8.424, 2.476, -4.736), V(3.403, -1.153, -0.137)), ZONES.bucket), surfaces = r.contacts.map(c => c.surface);
  assert.deepEqual(surfaces.slice(0, 4), ['floor', 'floor', 'floor', 'wall-e']);
  assert.ok(r.rest && r.made && r.points === 50 && r.score === 50, `${r.points} × ${r.multiplier}`);
});

test('runShot keeps the touches simulate gives, and made is only a rest in the zone', () => {
  const touches = () => { const last = new Map(), kept = []; return { kept, stop(c) { const before = last.get(c.surface); if (before !== undefined && c.time - before < 2.5 / 240) { last.set(c.surface, c.time); return false; } if (c.speed < SOFT) return false; last.set(c.surface, c.time); kept.push(c); return false; } }; };
  for (let i = 0; i < 40; i++) {
    const a = i * 0.7, body = () => makeBody(kind(0.3 + i * 0.015), V(-4 + Math.cos(i) * 2, 1 + (i % 4) * 0.5, -3 + Math.sin(i) * 2), V(Math.cos(a) * (2 + i % 6), 1 + i % 3, Math.sin(a) * (2 + i % 6)));
    const r = runShot(body(), everywhere), { kept, stop } = touches(), whole = simulate(body(), levelWorld(), { maxTime: r.time, stop });
    assert.deepEqual(r.contacts.map(c => [c.surface, c.time]), kept.map(c => [c.surface, c.time]));
    const scored = scoreContacts(kept); assert.deepEqual(pick(r), pick(scored)); assert.deepEqual(r.surfaces, scored.surfaces);
    assert.equal(r.made, r.rest && inZone(r.pos, everywhere));
    assert.deepEqual([...r.path], [...whole.path]);
  }
});

test('in the air at 8 s: it plays on, a late hit scores, and a late rest in the target is made', () => {
  const body = () => makeBody(kind(0.93), V(-6.625, 1.691, -1.148), V(1.466, 1.867, -2.705)), r = runShot(body(), { centre: V(-0.05, 0.05, -7.95), half: V(0.5, 0.5, 0.5) });
  assert.ok(!r.contacts.some(c => Math.abs(c.time - MOST_TIME) < 0.1) && r.path[MOST_TIME * 60 * 3 - 2] > 0.2, 'up at 8 s');
  assert.ok(r.contacts.some(c => c.time > MOST_TIME && c.surface === 'wall-n'));
  assert.ok(r.rest && r.time > MOST_TIME + 2 && r.made && r.points === 250 && r.score === 500, `${r.points} × ${r.multiplier}, ${r.time}`);
});

test('on a surface past 8 s it gets a second to settle; on one since long before, it ends at 8 s', () => {
  const late = runShot(makeBody(kind(0.9, { roll: 0.2 }), V(-1.663, 1.668, -6.388), V(-0.397, 4.669, 0.913)), everywhere);
  assert.ok(!late.rest && !late.made && late.time > MOST_TIME + SETTLE && Math.abs(late.time - late.contacts.at(-1).time - SETTLE) < 0.1, `${late.time}, last hit ${late.contacts.at(-1).time}`);
  const rolling = runShot(makeBody(kind(0.1, { roll: 0.01, drag: 0 }), V(-3, 0.05, -3), V(0.3, 0, 0)), everywhere);
  assert.ok(!rolling.rest && !rolling.made && Math.abs(rolling.time - MOST_TIME) < 0.01, `${rolling.time}`);
});

test('what never settles stops at the hard cap, and isn\'t made', () => {
  const r = runShot(makeBody(kind(0.995), V(-0.5, 2.5, -2.5), V(0, 0, 0)), everywhere);
  assert.ok(r.time === HARD_TIME && !r.rest && !r.made && r.score === 0 && inZone(r.pos, everywhere));
  assert.equal(r.path.length, Math.floor(HARD_TIME * 60) * 3);
});

test('runShot agrees with simulate on the path, and leaves the shared world alone', () => {
  const a = runShot(onBin(), ZONES.bin), b = simulate(onBin(), levelWorld(), { maxTime: HARD_TIME });
  assert.deepEqual(a.path, b.path); assert.equal(a.time, b.time);
  assert.deepEqual(runShot(onBin(), ZONES.bin).path, a.path, 'twice the same');
});

const play = (run, dt = 1 / 60) => { const events = []; for (let i = 0; i < 3000 && run.state === 'flying'; i++) events.push(...run.advance(dt)); return events; };
const start = V(-1, 1.2, -1);

test('playback emits each contact in order, then the end once', () => {
  const run = createRun({ start }), at = V();
  assert.equal(run.state, 'aiming'); assert.deepEqual(run.advance(1), []); assert.deepEqual(run.at(at).toArray(), start.toArray());
  run.shoot(onBin(), ZONES.bin);
  assert.equal(run.state, 'flying');
  const events = play(run), contacts = events.filter(e => e.type === 'contact'), ends = events.filter(e => e.type === 'end');
  assert.equal(ends.length, 1); assert.equal(events.at(-1), ends[0]); assert.equal(ends[0].result, run.result);
  assert.deepEqual(contacts.map(e => e.surface), run.result.contacts.map(c => c.surface));
  assert.ok(contacts.every(e => e.pos.length === 3 && e.speed > 0));
  assert.equal(run.state, 'done'); assert.deepEqual(run.advance(1), []);
  run.at(at); assert.ok(at.distanceTo(V(...run.result.pos)) < 1e-6, 'it stops where the shot did');
});

test('one huge dt (a stalled tab) emits every contact in order and the end once', () => {
  const run = createRun({ start }); run.shoot(onBin(), ZONES.bin);
  const events = run.advance(1e6);
  assert.deepEqual(events.slice(0, -1).map(e => e.surface), run.result.contacts.map(c => c.surface));
  assert.equal(events.at(-1).type, 'end');
  assert.equal(run.state, 'done');
});

test('a miss is played in full, every knock heard, to its end', () => {
  const run = createRun({ start }), at = V(); run.shoot(makeBody(ball, V(-2, 1.5, -2.5), V(0, 0, 0)), ZONES.bin);
  const r = run.result, seen = play(run);
  assert.deepEqual(seen.map(e => e.type).filter(t => t !== 'contact'), ['end']); assert.equal(seen.at(-1).type, 'end');
  assert.deepEqual(seen.filter(e => e.type === 'contact').map(e => e.time), r.contacts.map(c => c.time));
  run.at(at); assert.ok(at.distanceTo(V(...r.pos)) < 1e-6, 'and it stops where the shot did');
  assert.equal(run.time, r.time);
});

test('a retry waits a second of real time from the release, whatever the rate', () => {
  for (const reducedMotion of [false, true]) {
    const run = createRun({ start, reducedMotion }); assert.equal(run.retrying, false);
    run.shoot(makeBody(kind(0.85), V(-2, 2.5, -2.5), V(1, 0, 0)), null);
    run.advance(RETRY - 0.01); assert.equal(run.retrying, false); assert.equal(run.state, 'flying');
    run.advance(0.02); assert.equal(run.retrying, true); assert.equal(run.state, 'flying');
    run.advance(-1); run.advance(NaN); assert.equal(run.retrying, true);
    run.reset(); assert.equal(run.retrying, false); assert.equal(run.flown, 0);
  }
  const run = createRun({ start }); run.shoot(onBin(), ZONES.bin); run.advance(1e6); assert.equal(run.state, 'done'); assert.equal(run.retrying, true);
});

test('given a clock, RETRY and LONGEST go by it, however few frames there are and however clamped their dt', () => {
  let time = 100; const run = createRun({ start, now: () => time }); run.shoot(makeBody(kind(0.85), V(-2, 2.5, -2.5), V(1, 0, 0)), null);
  time += RETRY - 0.05; run.advance(0.1); assert.equal(run.retrying, false); assert.ok(Math.abs(run.flown - (RETRY - 0.05)) < 1e-9, `${run.flown}`);
  time += 0.1; run.advance(0.1); assert.equal(run.retrying, true); assert.equal(run.state, 'flying');
  time += LONGEST - RETRY; run.advance(0.1); assert.equal(run.state, 'done', 'cut off at a tenth of a second of dt a frame');
  assert.ok(run.time < run.result.time, 'short of the end'); run.reset(); assert.equal(run.flown, 0); assert.equal(run.retrying, false);
  time = 200; run.shoot(makeBody(kind(0.85), V(-2, 2.5, -2.5), V(1, 0, 0)), null); run.advance(0.1); assert.equal(run.flown, 0, 'from this release, not the last'); assert.equal(run.retrying, false);
});

test('a long miss is cut off at 10 s of real time, where a made shot plays on', () => {
  const run = createRun({ start }); run.shoot(makeBody(kind(0.85), V(-2, 2.5, -2.5), V(1, 0, 0)), null);
  const r = run.result; assert.ok(r.time > LONGEST * FLIGHT + 1 && !r.made, `${r.time}`);
  let real = 0, ends = 0; while (run.state === 'flying') { for (const e of run.advance(1 / 60)) if (e.type === 'end') { ends++; assert.equal(e.result, r); } real += 1 / 60; }
  assert.equal(ends, 1); assert.ok(Math.abs(real - LONGEST) < 0.05, `${real}`); assert.ok(run.time < r.time, 'short of the end');
  const zone = { centre: V(...r.pos), half: V(0.5, 0.5, 0.5) }, made = createRun({ start }); made.shoot(makeBody(kind(0.85), V(-2, 2.5, -2.5), V(1, 0, 0)), zone);
  assert.ok(made.result.made); let t = 0; while (made.state === 'flying') { made.advance(1 / 60); t += 1 / 60; }
  assert.ok(t > LONGEST && made.time === made.result.time, `${t}`);
});

test('playback follows the path between samples', () => {
  const run = createRun({ start, reducedMotion: true }), at = V(); run.shoot(makeBody(ball, V(-1, 1.2, -1), V(0, 0, 0)), null);
  run.advance(1 / 120); run.at(at); assert.ok(at.y < 1.2 && at.y > 1.2 - 0.01, `${at.y}`);
  assert.ok(Math.abs(run.time - 1 / 120) < 1e-9);
});

test('slow motion covers the last of a made shot, and never under reduced motion', () => {
  for (const reducedMotion of [false, true]) {
    const run = createRun({ start, reducedMotion }); run.shoot(onBin(), ZONES.bin);
    const total = run.result.time; assert.ok(run.result.made && total > 1);
    let slow = 0, scaled = 0;
    for (let i = 0; i < 2000 && run.state === 'flying'; i++) {
      run.advance(1 / 60);
      if (run.timeScale === SLOW) { slow++; assert.ok(run.time > total - SLOW_FOR - 1e-9, 'only at the end'); }
      if (run.time > total - SLOW_FOR + 1 / 60 && run.state === 'flying') scaled++;
    }
    assert.equal(slow > 0, !reducedMotion); assert.ok(reducedMotion || scaled > 0);
  }
});

test('a miss is at the flight\'s rate to its last hit, then settles at full speed', () => {
  const run = createRun({ start }); run.shoot(makeBody(kind(0.2), V(-2, 1.2, -2.5), V(2, 0, 0)), ZONES.bin);
  const last = run.result.contacts.at(-1).time; assert.ok(!run.result.made && run.result.time > last + 0.3, `${last} of ${run.result.time}`);
  const rates = new Set(); run.advance(1 / 240);
  for (let i = 0; i < 3000 && run.state === 'flying'; i++) { assert.equal(run.timeScale, run.time < last ? FLIGHT : 1, `${run.time}`); rates.add(run.timeScale); run.advance(1 / 240); }
  assert.deepEqual([...rates], [FLIGHT, 1]); assert.equal(run.state, 'done');
  // One big step over the change keeps both rates.
  const big = createRun({ start }); big.shoot(makeBody(kind(0.2), V(-2, 1.2, -2.5), V(2, 0, 0)), ZONES.bin);
  big.advance(last / FLIGHT + 0.2); assert.ok(Math.abs(big.time - (last + 0.2)) < 1e-6, `${big.time}`);
  const calm = createRun({ start, reducedMotion: true }); calm.shoot(makeBody(kind(0.2), V(-2, 1.2, -2.5), V(2, 0, 0)), ZONES.bin);
  for (let i = 0; i < 3000 && calm.state === 'flying'; i++) { assert.equal(calm.timeScale, 1); calm.advance(1 / 60); }
});

test('slow motion takes longer to play out than the shot', () => {
  const run = createRun({ start }); run.shoot(onBin(), ZONES.bin);
  let t = 0; for (let i = 0; i < 2000 && run.state === 'flying'; i++) { run.advance(1 / 60); t += 1 / 60; }
  assert.ok(t > run.result.time + 0.5, `${t} vs ${run.result.time}`);
});

test('a reset during slow motion leaves nothing running', () => {
  const run = createRun({ start }); run.shoot(onBin(), ZONES.bin);
  for (let i = 0; i < 2000 && run.timeScale !== SLOW; i++) run.advance(1 / 60);
  assert.equal(run.timeScale, SLOW);
  run.reset();
  assert.equal(run.state, 'aiming'); assert.equal(run.timeScale, 1); assert.equal(run.result, null); assert.equal(run.time, 0);
  assert.deepEqual(run.advance(1), []);
  assert.deepEqual(run.at(V()).toArray(), start.toArray());
});

test('a second shot after done or reset plays on its own', () => {
  const run = createRun({ start }); run.shoot(onBin(), ZONES.bin); run.advance(1e6);
  run.shoot(makeBody(ball, V(-2, 1.5, -2.5), V(0, 0, 0)), ZONES.bin);
  assert.equal(run.state, 'flying'); assert.equal(run.time, 0);
  assert.equal(run.advance(1e6).filter(e => e.type === 'end').length, 1);
});

test('a door rattling in its frame is a few touches, not one per bounce between its faces', () => {
  const r = runShot(makeBody(kind(0.436215489), V(-8.090594645166115, 1.8204622549565799, -6.9696031492061925), V(-4.536360383749176, 0.7948744729137394, -0.9532840428656361)), null);
  assert.equal(count(r, 'fridge'), 2); assert.deepEqual(r.contacts.slice(0, 4).map(c => c.surface), ['fridge', 'fridge', 'floor', 'floor']);
});

test('a soft event just before a hard one on the same surface doesn\'t swallow it', () => {
  const r = runShot(makeBody(kind(0.85), V(-3.931104635586962, 2.23621227350086, -4.9684287677519023), V(-6.652099726126528, -2.0635864889875903, -7.460915273121503)), null);
  assert.ok(r.surfaces.includes('cupboard-2'), r.surfaces.join());
});

test('a made shot ends with the clock normal, and a big dt crosses into slow motion', () => {
  const run = createRun({ start }); run.shoot(onBin(), ZONES.bin);
  const slowAt = run.result.time - SLOW_FOR; run.advance(slowAt / FLIGHT + 0.3);
  assert.equal(run.timeScale, SLOW);
  assert.ok(Math.abs(run.time - (slowAt + 0.3 * SLOW)) < 1e-9, `${run.time} vs ${slowAt}`); // 0.3 s of real time past the boundary is only 0.3 * SLOW of the shot
  run.advance(1e6);
  assert.equal(run.timeScale, 1); assert.equal(run.state, 'done');
});

test('a whole flight plays at the gentle rate, the same in big steps as small; reduced motion at full speed', () => {
  const run = createRun({ start }); run.shoot(onBin(), ZONES.bin);
  assert.equal(run.timeScale, FLIGHT); assert.ok(FLIGHT > SLOW && FLIGHT < 1);
  run.advance(0.5);
  assert.ok(Math.abs(run.time - 0.5 * FLIGHT) < 1e-9, `${run.time}`);
  const total = run.result.time, real = (total - SLOW_FOR) / FLIGHT + SLOW_FOR / SLOW, big = createRun({ start }), small = createRun({ start });
  big.shoot(onBin(), ZONES.bin); small.shoot(onBin(), ZONES.bin);
  big.advance(real - 0.05);
  for (let i = 0; i < 100; i++) small.advance((real - 0.05) / 100);
  assert.ok(Math.abs(big.time - small.time) < 1e-9, `${big.time} vs ${small.time}`);
  assert.equal(big.state, 'flying');
  big.advance(0.1); assert.equal(big.state, 'done'); assert.equal(big.timeScale, 1);
  const calm = createRun({ start, reducedMotion: true }); calm.shoot(onBin(), ZONES.bin);
  assert.equal(calm.timeScale, 1); calm.advance(0.5);
  assert.ok(Math.abs(calm.time - 0.5) < 1e-9, `${calm.time}`); assert.equal(calm.timeScale, 1);
  // Playback only: the shot's the same.
  assert.deepEqual([...calm.result.path], [...big.result.path]); assert.equal(calm.result.score, big.result.score);
});

test('a negative or NaN dt waits', () => {
  const run = createRun({ start }); run.shoot(onBin(), ZONES.bin); run.advance(0.5);
  const was = run.time;
  for (const dt of [-1, NaN]) { run.advance(dt); assert.ok(Math.abs(run.time - was) < 1e-9, `${dt}`); }
});

test('points are whole, and the score is points times multiplier', () => {
  const r = scoreContacts(['wall-n', 'wall-n', 'wall-n'].map(s => hit(s)));
  assert.deepEqual(pick(r), { points: 88, multiplier: 1 }); // 50 + 25 + 12.5
});
