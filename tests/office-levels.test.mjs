import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { STEP, makeBody, stepBody } from '../client/office/flight.js';
import { launch, throwSpeed } from '../client/office/throwing.js';
import { runShot } from '../client/office/shot.js';
import { CELL, walkGrid, findPath } from '../client/office/path.js';
import { EYE, LOOK_UP, free } from '../client/office/player.js';
import { KITCHEN, VESSELS, ZONES, flightBoxes, walkBoxes, behind, levelWorld, surfaceTier } from '../client/office/kitchen-plan.js';
import { kitchenDoor } from '../client/office/layout.js';
import { WALL_H, WALL_T } from '../client/office/furniture.js';
import { BALLS, LOOSE } from '../client/office/props.js';
import { ITEMS, STARTS, MONDAY, PAIRS, lineDone } from '../client/office/levels.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z), rad = d => d * Math.PI / 180;
const look = (yaw, pitch) => V(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)); // as camera.js looks
const COARSE = { yaw: 4, pitch: 5, charges: [0.25, 0.625, 1] }, FINE = { yaw: 1, pitch: 2, charges: Array.from({ length: 8 }, (_, i) => 0.25 + i * 0.75 / 7) };

// A throw as the game makes it: from your eyes at the mark, through launch, standing still. Nobody looks up past the player's limit.
const CAP = LOOK_UP * 180 / Math.PI, bearingOf = ({ start, target }) => { const { x, z } = STARTS[start], { centre } = ZONES[target]; return Math.atan2(centre.x - x, centre.z - z); };
const throwAt = ({ kind, start }, yaw, pitch, charge, launcher = launch) => { const { x, z } = STARTS[start]; return { yaw, pitch, charge, ...launcher(kind, charge, { position: V(x, EYE, z) }, look(yaw, pitch), V(0, 0, 0)) }; };
function* throwsOf(grid, shot, launcher) {
  const bearing = bearingOf(shot), yaws = [0]; // from the straight throw outward: what's looked for is usually near it, and a whole fine grid's 20,000 throws
  for (let yaw = grid.yaw; yaw <= 45; yaw += grid.yaw) yaws.push(yaw, -yaw);
  for (const yaw of yaws) for (let pitch = -10; pitch <= CAP; pitch += grid.pitch) for (const charge of grid.charges) yield throwAt(shot, bearing + rad(yaw), rad(pitch), charge, launcher);
}
const shoot = ({ kind, target }, { pos, vel }) => runShot(makeBody(kind, pos, vel), ZONES[target]);
const search = (grid, shot, predicate, launcher) => { for (const t of throwsOf(grid, shot, launcher)) { const result = shoot(shot, t); if (predicate(result)) return { ...t, result }; } return null; };
// The first throw that does it: on the coarse grid, and only if that found nothing, on the fine one.
const findThrow = (item, start, target, predicate, launcher) => { const shot = { kind: ITEMS[item], start, target }; return search(COARSE, shot, predicate, launcher) ?? search(FINE, shot, predicate, launcher); };
const onCoarse = (item, start, target, predicate) => search(COARSE, { kind: ITEMS[item], start, target }, predicate);

// Can a line be done on purpose? A hand is a quarter of a degree and 3% of charge out, so the throw's neighbours at that much either way have to do it too.
// Full charge is held, so it stays full. Share: of a throw's neighbours, how many do the line; the best of all the grid's throws that do it.
const NEAR = { aim: rad(0.25), charge: 0.03 }, ROUND = [-1, 0, 1], POCKET = 0.75;
const shareAround = (shot, { yaw, pitch, charge }, does) => {
  let hits = 0, all = 0;
  for (const dy of ROUND) for (const dp of ROUND) for (const dc of charge === 1 ? [0] : ROUND) {
    if (!dy && !dp && !dc) continue;
    all++; if (does(shoot(shot, throwAt(shot, yaw + dy * NEAR.aim, Math.min(LOOK_UP, pitch + dp * NEAR.aim), Math.min(1, charge + dc * NEAR.charge))))) hits++;
  }
  return hits / all;
};
const made = new Map(); // a level's made throws on both grids: every line needs it made
const madeOf = e => { if (!made.has(e.id)) { const shot = { kind: ITEMS[e.item], start: e.start, target: e.target }, list = []; for (const grid of [COARSE, FINE]) for (const t of throwsOf(grid, shot)) { const result = shoot(shot, t); if (result.made) list.push({ ...t, result }); } made.set(e.id, list); } return made.get(e.id); };
// The first share that clears the bar, or the best there is.
const bestPocket = (e, does) => { const shot = { kind: ITEMS[e.item], start: e.start, target: e.target }; let best = 0; for (const t of madeOf(e)) if (does(t.result)) { best = Math.max(best, shareAround(shot, t, does)); if (best >= POCKET) break; } return best; };
const LINES = ['away', 'trick', 'score'];

const asResult = (over = {}) => ({ made: true, score: 0, surfaces: [], ...over });
const OPTIONS = { timeout: 120000 };

test('the items are what the plan says', () => {
  assert.deepEqual(Object.keys(ITEMS), ['paper', 'rubber', 'roll', 'mug', 'plate', 'teabag']);
  assert.deepEqual(Object.values(ITEMS).map(k => k.throw), [13, 20, 14, 13, 16, 11]);
  for (const [id, k] of Object.entries(ITEMS)) {
    assert.ok(typeof k.name === 'string' && k.name, `${id} has a name`);
    for (const f of ['radius', 'low', 'bounce', 'roll', 'drag', 'tumble']) assert.ok(k[f] >= 0, `${id}.${f}`);
    assert.ok(k.low > 0 && k.low <= k.radius, `${id} rests on its underside`);
  }
  const { paper, rubber, roll, mug, plate, teabag } = ITEMS, all = Object.values(ITEMS), most = f => Math.max(...all.map(k => k[f])), least = f => Math.min(...all.map(k => k[f]));
  assert.ok(Math.abs(rubber.bounce - 0.85) < 0.05); assert.equal(plate.bounce, [...all].sort((a, b) => b.bounce - a.bounce)[1].bounce, 'the plate bounces second to the rubber');
  assert.ok(paper.bounce <= 0.35 && mug.bounce <= 0.4); assert.equal(teabag.bounce, least('bounce'), 'the tea bag is the other end'); assert.equal(teabag.drag, most('drag')); assert.equal(plate.roll, least('roll')); assert.ok(roll.roll >= 4, 'the roll stops short');
  assert.ok(roll.tumble > paper.tumble, 'the roll tumbles'); assert.ok(mug.upright && plate.upright, 'a mug and a plate land the right way up');
});

// You throw with one arm: the kitchen's paper ball is the office's, and how far things go doesn't change at the door.
test('throwing is the same in the office and the kitchen', () => {
  const [football, paper] = BALLS;
  for (const f of ['radius', 'low', 'bounce', 'roll', 'drag', 'throw', 'tumble']) assert.equal(ITEMS.paper[f], paper[f], f);
  assert.equal(football.throw, 11);
  assert.ok(Object.values(LOOSE).every(k => k.throw === 10), 'desk things');
});

test('the clipboard has one line per item, each naming things that exist', () => {
  assert.deepEqual(MONDAY.map(e => e.id), Object.keys(ITEMS));
  for (const e of MONDAY) {
    assert.ok(ITEMS[e.item] && STARTS[e.start] && ZONES[e.target], e.id);
    assert.ok(e.trick.name === e.trick.name.toLowerCase() && e.trick.name, `${e.id}: lower case, the clipboard capitalises`);
    assert.ok(flightBoxes().some(b => e.trick.via.endsWith('-') ? b.surface.startsWith(e.trick.via) : b.surface === e.trick.via) || e.trick.via === 'ceiling', `${e.id}: ${e.trick.via} is a surface`);
    assert.ok(e.set > 0, e.id);
  }
});

test('a line is done by a made shot, by a made shot off the right surface, by the set score', () => {
  const fridge = { trick: { name: '', via: 'fridge' }, set: 600 }, pans = { trick: { name: '', via: 'pan-' }, set: 600 };
  assert.ok(lineDone('away', asResult(), fridge)); assert.ok(!lineDone('away', asResult({ made: false }), fridge));
  assert.ok(lineDone('trick', asResult({ surfaces: ['wall-n', 'fridge'] }), fridge));
  assert.ok(!lineDone('trick', asResult({ surfaces: ['fridge'], made: false }), fridge), 'off it and missed');
  assert.ok(!lineDone('trick', asResult({ surfaces: ['fridge-2', 'floor'] }), fridge), 'without a - it is that surface exactly');
  assert.ok(lineDone('trick', asResult({ surfaces: ['pan-2'] }), pans)); assert.ok(!lineDone('trick', asResult({ surfaces: ['panel'] }), pans), 'with a - it is that family');
  assert.ok(lineDone('score', asResult({ score: 600 }), fridge)); assert.ok(!lineDone('score', asResult({ score: 599 }), fridge));
  assert.ok(!lineDone('nonsense', asResult({ score: 600 }), fridge));
});

// What runShot gives lineDone: a graze of the right surface isn't in `surfaces`, so it can't be the trick.
test('a graze of the trick surface doesn\'t do the trick', () => {
  const entry = { trick: { name: '', via: 'table-1' }, set: 600 };
  const grazed = runShot(makeBody(ITEMS.teabag, V(-7.2, 0.74 + ITEMS.teabag.low + 0.005, -1.4), V(0, -0.2, 0)), { centre: V(-7.2, 0.8, -1.4), half: V(0.7, 0.2, 0.4) });
  assert.ok(grazed.made && grazed.contacts.length === 0, 'it was put down softly on the table');
  assert.ok(!lineDone('trick', grazed, entry));
  const hit = runShot(makeBody(ITEMS.teabag, V(-7.2, 1.2, -1.4), V(0, 0, 0)), { centre: V(-7.2, 0.8, -1.4), half: V(0.7, 0.2, 0.4) });
  assert.ok(lineDone('trick', hit, entry));
});

test('the sweep throws the way the game does: through launch, from your eyes, standing still', () => {
  const calls = [], spy = (kind, charge, camera, direction, walk) => { calls.push({ kind, charge, from: camera.position.clone(), direction: direction.clone(), walk: walk.clone() }); return launch(kind, charge, camera, direction, walk); };
  const { start, target, item } = MONDAY[0], found = findThrow(item, start, target, r => r.made, spy), mark = STARTS[start];
  assert.ok(found && calls.length, 'it found a throw');
  for (const c of calls) { assert.equal(c.kind, ITEMS[item]); assert.deepEqual(c.from.toArray(), [mark.x, EYE, mark.z]); assert.deepEqual(c.walk.toArray(), [0, 0, 0]); assert.ok(Math.abs(c.direction.length() - 1) < 1e-9); }
  assert.equal(EYE, 1.5, "the player's eye height is what the sweep threw from; change it and the proof reruns");
  // And what's returned is launch's throw, reproducing the same shot from nothing but the aim.
  assert.ok(found.pitch <= LOOK_UP);
  const dir = look(found.yaw, found.pitch), again = launch(ITEMS[item], found.charge, { position: V(mark.x, EYE, mark.z) }, dir, V(0, 0, 0)), result = runShot(makeBody(ITEMS[item], again.pos, again.vel), ZONES[target]);
  assert.deepEqual(result.pos, found.result.pos); assert.ok(result.made);
  assert.ok(Math.abs(again.vel.y - (dir.y * throwSpeed(ITEMS[item], found.charge) + 1.2)) < 1e-9, 'with launch\'s lift');
  // A launcher that throws elsewhere changes what the sweep finds, so nothing in it computes a velocity of its own.
  const dud = (kind, charge, camera, direction) => ({ pos: camera.position.clone().addScaledVector(direction, 0.5), vel: V(0, 0, 0) });
  assert.equal(findThrow(item, start, target, r => r.made, dud), null);
});

// A rubber ball bounces out of any bucket this size, so the bucket has mop water in it: its bottom only, wherever the kitchen stands.
test('the bucket\'s water keeps what lands in it, and nothing else does', () => {
  const zone = ZONES.bucket, drop = at => makeBody(ITEMS.rubber, at, V(0, -4, 0));
  const inWater = runShot(drop(V(zone.centre.x, zone.centre.y, zone.centre.z)), zone);
  assert.ok(inWater.made && inWater.time < 0.5, `it stopped in the water, after ${inWater.time} s`);
  const onFloor = runShot(drop(V(-3, 0.5, -1)), null);
  assert.ok(onFloor.time > inWater.time * 2, 'the floor still bounces it');
  const soft = o => flightBoxes(o).filter(b => b.bounce !== undefined);
  for (const o of [undefined, { x: 3, z: 4 }]) { const [water, more] = soft(o); assert.ok(water.surface === 'bucket' && water.bounce === 0 && Math.abs(water.max.y - 0.12) < 1e-9 && !more); }
});

// A step at speed can go clean through a thin bottom: then the floor is what it hits, not what it was thrown at. A ladder of speeds, at several phases of the fixed step.
const SPEEDS = [4, 8, 10, 20, 30], PHASES = 12;
for (const name of ['bucket', 'bin', 'basket']) test(`nothing dropped into the ${name} goes through its bottom, at any speed`, () => {
  const zone = ZONES[name], rim = zone.centre.y + zone.half.y, failed = [];
  for (const [id, kind] of Object.entries(ITEMS)) for (const speed of SPEEDS) for (let phase = 0; phase < PHASES; phase++) {
    const r = runShot(makeBody(kind, V(zone.centre.x, rim - phase * (speed / 240) / PHASES, zone.centre.z), V(0, -speed, 0)), zone);
    if (r.surfaces[0] !== name) failed.push(`${id} at ${speed} m/s, phase ${phase}: first hit ${r.surfaces[0]}`);
    if (name === 'bucket' && !r.made) failed.push(`${id} at ${speed} m/s, phase ${phase}: not made, ${r.surfaces}`);
  }
  assert.deepEqual(failed, []);
});

// The fastest thing there is: a rubber ball at full charge, thrown at a run, with its lift and a fall on top. At every phase of the step, straight on and glancing, it comes off the thin face it met.
const FASTEST = ITEMS.rubber.throw + 4 * 1.9 + 1.2 + 4, THIN = /^(table|chair|cutout|pan|banner|sign|cupboard|tray|wall|bin|tableMug)/;
test('nothing goes through anything, however thin and however fast', () => {
  const failed = [];
  for (const kind of [ITEMS.rubber, ITEMS.plate]) for (const box of flightBoxes().filter(b => THIN.test(b.surface))) {
    const middle = box.centre ?? box.getCenter(V()), half = box.half ?? box.getSize(V()).multiplyScalar(0.5), q = box.quaternion ?? new THREE.Quaternion();
    const axis = ['x', 'y', 'z'].reduce((a, c) => half[c] < half[a] ? c : a), n = V(0, 0, 0).setComponent('xyz'.indexOf(axis), 1).applyQuaternion(q);
    const along = V(0, 0, 0).setComponent(('xyz'.indexOf(axis) + 1) % 3, 1).applyQuaternion(q);
    for (const side of [1, -1]) for (const slant of [0, 0.5]) for (let phase = 0; phase < PHASES; phase++) {
      let hit = false; const world = { colliders: [box], columns: [], onContact: () => { hit = true; } };
      const heading = n.clone().multiplyScalar(-side).addScaledVector(along, slant).normalize(), from = middle.clone().addScaledVector(heading, -(0.6 + phase * FASTEST * STEP / PHASES));
      if (from.y < 0.3) continue; // that would be from under the floor
      const body = makeBody(kind, from, heading.clone().multiplyScalar(FASTEST));
      for (let i = 0; i < 60 && !hit; i++) stepBody(body, world);
      if (!hit || body.pos.clone().sub(middle).dot(n) * side <= 0) failed.push(`${kind.name} ${hit ? 'through' : 'missed'} ${box.surface}, side ${side}, slant ${slant}, phase ${phase}`);
    }
  }
  assert.deepEqual(failed, []);
});

// And in the room as it is: flat out in every direction, on the run, from every mark. It's still in when it's over.
test('the fastest throw stays in the room', () => {
  const kind = ITEMS.rubber, out = [], reach = 0.001;
  for (const { x, z } of Object.values(STARTS)) for (let yaw = 0; yaw < 360; yaw += 15) for (const pitch of [-20, 0, 20, 45]) {
    const dir = look(rad(yaw), rad(pitch)), walk = look(rad(yaw), 0).multiplyScalar(4 * 1.9), { pos, vel } = launch(kind, 1, { position: V(x, EYE, z) }, dir, walk);
    const r = runShot(makeBody(kind, pos, vel), null);
    for (let i = 0; i < r.path.length; i += 3) if (r.path[i] < -KITCHEN.width - reach || r.path[i] > reach || r.path[i + 1] < 0 || r.path[i + 1] > WALL_H + reach || r.path[i + 2] < KITCHEN.back - reach || r.path[i + 2] > KITCHEN.front + reach) { out.push(`${x},${z} yaw ${yaw} pitch ${pitch}: at ${[...r.path.slice(i, i + 3)]}`); break; }
  }
  assert.deepEqual(out, []);
});

// The water is the inside of the bucket: from outside, even low down, it's a wall you hit, and the ball comes back.
test('a ball hitting the bucket from outside bounces off its wall', () => {
  const [cx, , cz, r] = VESSELS.bucket, world = levelWorld();
  for (const y of [0.04, 0.06, 0.1, 0.2, 0.35]) {
    const b = makeBody(ITEMS.rubber, V(cx - r - 0.1, y, cz), V(5, 0, 0));
    for (let i = 0; i < 12; i++) stepBody(b, world);
    assert.ok(b.vel.x < -3, `at y ${y} it came away at ${b.vel.x} m/s`);
  }
  const water = flightBoxes().find(b => b.bounce !== undefined), walls = flightBoxes().filter(b => b.surface === 'bucket' && b !== water && !b.bounce);
  assert.ok(water.min.x >= cx - r + VESSELS.bucket[5] - 1e-9 && water.max.x <= cx + r - VESSELS.bucket[5] + 1e-9, 'its footprint is inside the walls');
  assert.ok(walls.every(w => w.min.y === 0), 'the walls reach the floor');
});

test('no throw of a grid looks up past what the player can', () => {
  assert.equal(LOOK_UP, 0.8);
  for (const grid of [COARSE, FINE]) { const shot = { kind: ITEMS.paper, start: 'doors', target: 'bin' }; let top = -Infinity; for (const t of throwsOf(grid, shot)) top = Math.max(top, t.pitch); assert.ok(top <= LOOK_UP && top > LOOK_UP - rad(grid.pitch), `${grid.pitch} degree grid tops out at ${top}`); }
});

// Every line of the clipboard can be done on purpose, not only by a fluke the grid happened to land on.
test('every clipboard line has a pocket a hand can stay in', OPTIONS, () => {
  const failed = MONDAY.flatMap(e => LINES.map(line => [line, bestPocket(e, r => lineDone(line, r, e))]).filter(([, share]) => share < POCKET).map(([line, share]) => `${e.id} ${line}: best ${Math.round(share * 100)}%`));
  assert.deepEqual(failed, []);
});

// A set is the highest round score up to 1500 you can do on purpose, and that isn't the trick over again: within a tenth of the same throws, it's one line, not two.
// Only when no score is both is it allowed to be the trick. Then it's the highest with a pocket.
const apart = (e, score) => { const list = madeOf(e), hits = list.filter(t => t.result.score >= score), other = list.filter(t => (t.result.score >= score) !== lineDone('trick', t.result, e)); return other.length >= 0.1 * Math.max(1, hits.length); };
const ROUNDS = Array.from({ length: 15 }, (_, i) => 1500 - i * 100);
test('every set score is the highest round one with a pocket, apart from the trick if it can be', OPTIONS, () => {
  const pockets = e => ROUNDS.filter(score => bestPocket(e, r => r.score >= score) >= POCKET);
  const wanted = e => { const held = pockets(e); return held.find(score => apart(e, score)) ?? held[0]; };
  assert.deepEqual(Object.fromEntries(MONDAY.map(e => [e.id, e.set])), Object.fromEntries(MONDAY.map(e => [e.id, wanted(e)])));
  assert.deepEqual(MONDAY.filter(e => !apart(e, e.set)).map(e => e.id), []);
});

// A throw should fly, bounce and hit things: each level has a made throw off three different things that score.
const scoredOff = r => new Set(r.surfaces.filter(s => surfaceTier(s) !== 'floor')).size;
test('every clipboard level has a made throw off three surfaces or more', OPTIONS, () => {
  assert.deepEqual(MONDAY.filter(e => !madeOf(e).some(t => scoredOff(t.result) >= 3)).map(e => e.id), []);
});

test('every clipboard level can be put away', OPTIONS, () => {
  const failed = MONDAY.filter(e => !findThrow(e.item, e.start, e.target, r => lineDone('away', r, e))).map(e => e.id);
  assert.deepEqual(failed, []);
});

test('every clipboard trick can be done', OPTIONS, () => {
  const failed = MONDAY.filter(e => !findThrow(e.item, e.start, e.target, r => lineDone('trick', r, e))).map(e => `${e.id}: ${e.trick.name}`);
  assert.deepEqual(failed, []);
});

test('every clipboard set score can be reached', OPTIONS, () => {
  const failed = MONDAY.filter(e => !findThrow(e.item, e.start, e.target, r => lineDone('score', r, e))).map(e => `${e.id}: ${e.set}`);
  assert.deepEqual(failed, []);
});

// Possible isn't playable: one throw in 30,000 passes the tests above and isn't a game. Putting it away and the trick are on the grid a player's own hand can hit.
test('every clipboard level and trick is found on the coarse grid', OPTIONS, () => {
  const failed = MONDAY.flatMap(e => ['away', 'trick'].filter(line => !onCoarse(e.item, e.start, e.target, r => lineDone(line, r, e))).map(line => `${e.id} ${line}`));
  assert.deepEqual(failed, []);
});

// The daily and random shots are held to what the clipboard's lines are: a throw that goes in isn't a shot unless the throws around it do too. It stops at the first that clears the bar.
const pocketOf = (item, start, target) => {
  const shot = { kind: ITEMS[item], start, target }; let best = 0;
  for (const grid of [COARSE, FINE]) for (const t of throwsOf(grid, shot)) if (shoot(shot, t).made) { best = Math.max(best, shareAround(shot, t, r => r.made)); if (best >= POCKET) return best; }
  return best;
};
test('every start and target pair has a pocket for its item, from its mark', OPTIONS, () => {
  const failed = Object.entries(PAIRS).flatMap(([item, pairs]) => pairs.map(([start, target]) => [`${item} ${start} to ${target}`, pocketOf(item, start, target)])).filter(([, share]) => share < POCKET);
  assert.deepEqual(failed, []);
});

test('each item has three pairs or more, and together they use every target', () => {
  assert.deepEqual(Object.keys(PAIRS), Object.keys(ITEMS));
  for (const [item, pairs] of Object.entries(PAIRS)) {
    assert.ok(pairs.length >= 3, item);
    for (const [start, target] of pairs) assert.ok(STARTS[start] && ZONES[target], `${item} ${start} ${target}`);
    assert.equal(new Set(pairs.map(String)).size, pairs.length, `${item} repeats a pair`);
  }
  assert.deepEqual([...new Set(Object.values(PAIRS).flat().map(p => p[1]))].sort(), Object.keys(ZONES).sort());
});

// The real path grid at the kitchen's real place, as in the plan's own test: cells fall differently in rooms of different depths.
const DEPTHS = [8, 8.6, 9.7, 10, 12.3, 14, 15.5], LEFT = -(WALL_T + KITCHEN.width);
test('no start mark stands in a collider', () => {
  assert.deepEqual(Object.keys(STARTS).sort(), ['doors', 'farTable', 'fridge', 'island', 'stove', 'vending']);
  const boxes = flightBoxes();
  for (const [name, { x, z, stand }] of Object.entries(STARTS)) {
    assert.ok(Number.isFinite(stand), `${name} faces somewhere`);
    for (const y of [0.05, 0.5, 1, EYE]) assert.ok(!boxes.some(b => b.containsPoint(V(x, y, z))), `${name} is inside something at ${y}`);
    const ahead = V(x, 0, z).addScaledVector(look(stand, 0), 1);
    assert.ok(ahead.x > -KITCHEN.width && ahead.x < 0 && ahead.z > KITCHEN.back && ahead.z < KITCHEN.front, `${name} faces the room`);
  }
  for (const depth of DEPTHS) {
    const origin = { x: -WALL_T, z: kitchenDoor(depth) }, room = { left: LEFT, back: Math.min(0, origin.z + KITCHEN.back - WALL_T), width: WALL_T, depth }, at = (x, z) => V(x + origin.x, 0, z + origin.z);
    const colliders = [...flightBoxes(origin, { doorShut: false }).filter(b => b.surface.startsWith('wall-')), ...walkBoxes(origin), behind(origin)], grid = walkGrid(colliders, room);
    for (const [name, { x, z }] of Object.entries(STARTS)) {
      const p = at(x, z), cell = Math.floor((p.z - grid.back) / CELL) * grid.cols + Math.floor((p.x - grid.left) / CELL);
      assert.ok(free(p, colliders, room), `${name} (room ${depth}) stands in something you walk round`);
      assert.equal(grid.open[cell], 1, `${name} (room ${depth}) is not on an open cell`);
      const way = findPath(grid, at(-1, 0), p);
      assert.ok(way, `${name} (room ${depth}) can't be walked to from the doors`);
      assert.ok(way.at(-1).distanceTo(p) < 1e-9, `${name} (room ${depth}): the way ends on the mark`);
    }
  }
});
