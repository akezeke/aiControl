import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeCharacter, POSE, setPose, WORN } from '../client/fantasy/characters.js';
import { makeEnemy, makeMinion, PLANS } from '../client/fantasy/enemies.js';
import { newShared } from '../client/fantasy/rig.js';
import { Shape } from '../client/fantasy/shapes.js';
import { CLASS_NAMES } from '../client/fantasy/roster.js';

const shared = () => newShared({ value: 1 }, { fog: 0, sun: 0xffffff, sky: 0x888888, bounce: 0x444444, dir: [0, 1, 0] });
const hue = ([r, g, b]) => { const hi = Math.max(r, g, b), lo = Math.min(r, g, b), d = hi - lo; return d < .08 ? null : (hi === r ? (g - b) / d + 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4) % 6 * 60; };
// Brown is orange without the light: a warm hue that's neither bright nor grey.
const brownShare = rig => {
  const colours = rig.geometry.getAttribute('color').array; let brown = 0, all = 0;
  for (let i = 0; i < colours.length; i += 3) { const c = [colours[i], colours[i + 1], colours[i + 2]], h = hue(c); all++; if (h != null && h > 10 && h < 45 && Math.max(...c) < .62) brown++; }
  return brown / all;
};

test('every class of every look builds, within its bones', () => {
  for (const cls of Object.keys(CLASS_NAMES)) for (let i = 0; i < 24; i++) {
    const scene = new THREE.Scene(), { rig } = makeCharacter({ id: `${cls}${i}`, cls, session: { id: `${cls}${i}` } }, scene, shared(), new Set());
    assert.ok(rig.geometry.getAttribute('position').count > 100);
    rig.dispose();
  }
});
test('every enemy plan and minion builds', () => {
  for (const [family, plans] of Object.entries(PLANS)) for (let plan = 0; plan < plans; plan++) for (let i = 0; i < 6; i++) {
    const enemy = makeEnemy(`${family}${plan}${i}`, family, new THREE.Scene(), shared(), 1, plan);
    assert.ok(enemy.rig.geometry.getAttribute('position').count > 20, family);
    enemy.rig.dispose();
  }
  for (const kind of ['bat', 'tome', 'imp']) makeMinion(kind, kind, new THREE.Scene(), shared()).rig.dispose();
});
// How many pieces of an enemy touch nothing else, at rest: its triangles dropped into small cells, then a flood through the cells that touch.
const CELL = .05;
function pieces(enemy) {
  enemy.anim(1, 0); enemy.rig.root.updateMatrixWorld(true);
  const { geometry, bones } = enemy.rig, at = geometry.getAttribute('position').array, bone = geometry.getAttribute('bone').array, size = enemy.scale * CELL, cells = new Set(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
  const key = (x, y, z) => (x + 512) * 1048576 + (y + 512) * 1024 + z + 512;
  for (let t = 0; t < at.length / 9; t++) {
    const m = bones[bone[t * 3]].matrixWorld; a.fromArray(at, t * 9).applyMatrix4(m); b.fromArray(at, t * 9 + 3).applyMatrix4(m); c.fromArray(at, t * 9 + 6).applyMatrix4(m);
    const n = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / (size * .7)));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) { p.set(0, 0, 0).addScaledVector(a, i / n).addScaledVector(b, j / n).addScaledVector(c, 1 - (i + j) / n); cells.add(key(Math.floor(p.x / size), Math.floor(p.y / size), Math.floor(p.z / size))); }
  }
  const seen = new Set(); let count = 0;
  for (const start of cells) {
    if (seen.has(start)) continue;
    count++; seen.add(start); const stack = [start];
    while (stack.length) { const k = stack.pop(), z = k % 1024, y = Math.floor(k / 1024) % 1024, x = Math.floor(k / 1048576); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) { const next = (x + dx) * 1048576 + (y + dy) * 1024 + z + dz; if (cells.has(next) && !seen.has(next)) { seen.add(next); stack.push(next); } } }
  }
  return count - 1;
}
// The parts meant to float, plan by plan: blades, a slab, orbs, hands, sparks and drops.
const FLOATS = { sentinel0: 14, sentinel1: 1, sentinel2: 3, golem2: 2, wraith0: 2, wraith1: 2, slime0: 3 };
test('no part of an enemy hangs in the air unless it is meant to', () => {
  for (const [family, plans] of Object.entries(PLANS)) for (let plan = 0; plan < plans; plan++) for (let i = 0; i < 8; i++) {
    const enemy = makeEnemy(`${family}${plan}${i}`, family, new THREE.Scene(), shared(), 1, plan), free = pieces(enemy);
    assert.ok(free <= (FLOATS[`${family}${plan}`] ?? 0), `${family} plan ${plan} seed ${i} has ${free} loose pieces`);
    enemy.rig.dispose();
  }
});
const each = fn => { for (const [family, plans] of Object.entries(PLANS)) for (let plan = 0; plan < plans; plan++) for (let i = 0; i < 6; i++) fn(makeEnemy(`${family}${plan}${i}`, family, new THREE.Scene(), shared(), 1, plan), family, plan, i); };
test('tubes and rocks wear a pattern all over, and it meets itself round them', () => {
  const cloth = { pat: 'scales', ink: 0xff0000 };
  let n = 0; const r = () => (n = (n * 7 + 3) % 11) / 11;
  for (const shape of [new Shape().tube([[0, 0, 0], [.2, 1, 0], [0, 2, .3]], [.3, .2, 0], 0x808080, { sides: 6, cloth }), new Shape().rock(.8, 0x808080, r, { sides: 6, cloth })]) {
    const [{ from, uv }] = shape.worn;
    assert.equal(from, 0); assert.equal(uv.length, shape.p.length);
    for (let t = 0; t < uv.length; t += 9) { const us = [uv[t], uv[t + 3], uv[t + 6]]; for (const v of uv.subarray(t, t + 9)) assert.ok(Number.isFinite(v)); assert.ok(Math.max(...us) - Math.min(...us) < 2, `a triangle spans ${Math.max(...us) - Math.min(...us)} of the pattern`); }
  }
});
test('most enemies wear a hide, the same one for the same seed', () => {
  const bare = [];
  each((enemy, family, plan, i) => {
    const z = enemy.rig.geometry.getAttribute('weave'); let dressed = 0;
    for (let v = 0; v < z.count; v++) if (z.getZ(v) >= 0) dressed++;
    if (dressed / z.count < .15) bare.push(`${family}${plan}`);
    if (i === 0) assert.deepEqual([...z.array], [...makeEnemy(`${family}${plan}${i}`, family, new THREE.Scene(), shared(), 1, plan).rig.geometry.getAttribute('weave').array]);
    enemy.rig.dispose();
  });
  const plans = Object.values(PLANS).reduce((a, b) => a + b);
  assert.ok(new Set(bare).size <= 4, `bare: ${[...new Set(bare)]} of ${plans}`);
  const layers = new Set();
  for (let i = 0; i < 24; i++) { const weave = makeEnemy(`hide${i}`, 'beast', new THREE.Scene(), shared(), 1, 0).rig.geometry.getAttribute('weave'); for (let v = 0; v < weave.count; v++) if (weave.getZ(v) >= 0) layers.add(weave.getZ(v)); }
  assert.ok(layers.size >= 2, `a brute only ever wears ${layers.size} hide`);
});
test('what glows on an enemy shines by itself, and pulses', () => {
  each((enemy, family, plan) => {
    const z = enemy.rig.geometry.getAttribute('weave'); let lit = 0;
    for (let v = 0; v < z.count; v++) if (z.getZ(v) === -2) lit++;
    if (`${family}${plan}` !== 'slime1') assert.ok(lit > 0, `${family} plan ${plan} has nothing shining`);
    enemy.anim(0, 0); const a = enemy.rig.u.uGlow.value; enemy.anim(1.3, 0);
    assert.notEqual(enemy.rig.u.uGlow.value, a, 'no pulse');
    enemy.rig.dispose();
  });
});
test('enemies of a plan differ in build, and a seed keeps its build', () => {
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    const a = makeEnemy(`build${i}`, 'beast', new THREE.Scene(), shared(), 1, 2), b = makeEnemy(`build${i}`, 'beast', new THREE.Scene(), shared(), 1, 2);
    assert.equal(a.inner.scale.x, b.inner.scale.x); assert.equal(a.inner.scale.y, a.scale);
    seen.add((a.inner.scale.x / a.scale).toFixed(3));
  }
  assert.ok(seen.size > 6, `only ${seen.size} widths`);
});
test('one of the beasts flies, off the ground with its wings beating', () => {
  const world = enemy => { enemy.rig.root.updateMatrixWorld(true); const { geometry, bones } = enemy.rig, at = geometry.getAttribute('position'), bone = geometry.getAttribute('bone'), p = new THREE.Vector3(); let low = Infinity, high = -Infinity; for (let v = 0; v < at.count; v++) { p.fromBufferAttribute(at, v).applyMatrix4(bones[bone.getX(v)].matrixWorld); low = Math.min(low, p.y); high = Math.max(high, p.y); } return [low, high]; };
  const fliers = [];
  for (let plan = 0; plan < PLANS.beast; plan++) {
    const enemy = makeEnemy(`beast${plan}0`, 'beast', new THREE.Scene(), shared(), 1, plan); let least = Infinity, top = Infinity, tip = -Infinity;
    for (let t = 0; t < 2; t += .1) { enemy.anim(t, 0); const [low, high] = world(enemy); least = Math.min(least, low); top = Math.min(top, high); tip = Math.max(tip, high); }
    if (least > .5) fliers.push({ plan, beat: tip - top });
    enemy.rig.dispose();
  }
  assert.equal(fliers.length, 1, `${fliers.length} flying beasts`);
  assert.ok(fliers[0].beat > .4, `its wings only move ${fliers[0].beat.toFixed(2)}`);
});

test('nobody in a fight wears the same colour until the colours run out', () => {
  const taken = new Set();
  for (let i = 0; i < 6; i++) makeCharacter({ id: `same${i}`, cls: 'sage', session: { id: `same${i}` } }, new THREE.Scene(), shared(), taken);
  assert.equal(taken.size, 6);
});
test('characters and enemies are not all brown', () => {
  const shares = [];
  for (const cls of Object.keys(CLASS_NAMES)) for (let i = 0; i < 12; i++) shares.push(brownShare(makeCharacter({ id: `${cls}${i}`, cls, session: { id: `${cls}${i}` } }, new THREE.Scene(), shared(), new Set()).rig));
  for (const [family, plans] of Object.entries(PLANS)) for (let plan = 0; plan < plans; plan++) for (let i = 0; i < 2; i++) shares.push(brownShare(makeEnemy(`${family}${plan}${i}`, family, new THREE.Scene(), shared(), 1, plan).rig));
  const mean = shares.reduce((sum, share) => sum + share, 0) / shares.length;
  assert.ok(mean < .14, `mean brown ${mean.toFixed(2)}`);
});

test('a knocked-out member lies with their weapon flat on the ground, and picks it up again', () => {
  const up = new THREE.Vector3();
  for (const cls of ['sage', 'duelist', 'rogue', 'knight', 'gunner']) for (let i = 0; i < 6; i++) {
    const char = makeCharacter({ id: `${cls}${i}`, cls, session: { id: `${cls}${i}` } }, new THREE.Scene(), shared(), new Set()), { J, root } = char.rig;
    root.rotation.y = -Math.PI / 2;
    setPose(J, POSE.ko, 1); root.updateMatrixWorld(true);
    for (const wrist of [J.wR, J.wL]) if (wrist) { up.set(0, 0, 1).transformDirection(wrist.matrixWorld); assert.ok(Math.abs(up.y) < .35, `${cls} weapon points ${up.y.toFixed(2)} up`); assert.ok(Math.abs(up.x) > .8, `${cls} weapon runs ${up.x.toFixed(2)} along the body, so from above it looks stood on end`); }
    setPose(J, POSE.stance, 1);
    for (const wrist of [J.wR, J.wL]) if (wrist) assert.equal(wrist.rotation.x, wrist.hold);
  }
});

test('what a person wears is recorded, and giving it back dresses them the same', () => {
  const session = { id: 'worn' }, first = makeCharacter({ id: 'worn', cls: 'knight', session }, new THREE.Scene(), shared(), new Set()), cloth = WORN.get('worn');
  assert.ok(first && cloth);
  makeCharacter({ id: 'worn', cls: 'knight', session, cloth }, new THREE.Scene(), shared(), new Set([cloth]));
  assert.equal(WORN.get('worn'), cloth);
});

test('a gunner has a muzzle to fire from and the poses of the closing scene exist', () => {
  for (let i = 0; i < 8; i++) {
    const { J } = makeCharacter({ id: `g${i}`, cls: 'gunner', session: { id: `g${i}` } }, new THREE.Scene(), shared(), new Set()).rig;
    assert.ok([J.wR, J.wL].some(wrist => wrist?.tip > 0), `gun ${i} has no muzzle`);
  }
  for (const name of ['aim', 'stepL', 'stepR', 'gather', 'release']) assert.ok(POSE[name], name);
});
