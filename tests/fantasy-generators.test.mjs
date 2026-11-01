import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeCharacter, POSE, setPose, WORN } from '../client/fantasy/characters.js';
import { makeEnemy, makeMinion, PLANS } from '../client/fantasy/enemies.js';
import { newShared } from '../client/fantasy/rig.js';
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
