import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSlacking, facesToward } from '../client/office/slack.js';
import { CHAIR } from '../client/office/boss-plan.js';

// A canvas context that takes any call, as the friends tests' blank one, plus the canvas's size.
const anything = () => new Proxy({}, { get: (_, k) => k === 'canvas' ? { width: 432, height: 256 } : k === 'measureText' ? () => ({ width: 50 }) : () => ({ addColorStop() {} }), set: () => true });
const scene = new THREE.Scene();
// A desk as room.js builds one, as far as slack.js reads it: its sitter faces the group's +z, the chair behind the desk, the
// screen facing back at the chair. `drawn` counts the screen's redraws. A desk turned π faces the windows wall.
function desk(glow, x, z, rotation) {
  const group = new THREE.Group(); group.position.set(x, 0, z); group.rotation.y = rotation; scene.add(group);
  const screen = new THREE.Object3D(); screen.position.set(0, 1.1, 0.2); screen.rotation.y = Math.PI; group.add(screen);
  const chair = new THREE.Object3D(); chair.position.z = -0.87; group.add(chair); group.updateMatrixWorld(true);
  const d = { glow, group, screen, chair, slack: { show: null, wary: false, busted: 0, calm: 0, feet: false }, drawn: 0 };
  d.screenTexture = { image: { getContext: () => anything() }, set needsUpdate(_) { d.drawn++; } };
  return d;
}
const far = new THREE.Vector3(100, 1.6, 100);

test('with the boss away, every idle desk slacks within 4 s; working desks put their feet up; waiting desks carry on', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const s = createSlacking(() => {}), desks = [desk('dark', 2, 3, 0), desk('dark', 4, 3, Math.PI), desk('green', 6, 3, 0), desk('amber', 8, 3, 0)];
  for (let i = 0; i < 50; i++) s.update(0.1, far, false, desks, 'you');
  assert.ok(desks[0].slack.show && desks[1].slack.show); assert.ok(desks[2].slack.feet && !desks[2].slack.show);
  assert.ok(!desks[3].slack.show && !desks[3].slack.feet);
});
test('seated yourself, you catch nobody, however near', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const s = createSlacking(() => {}), d = desk('dark', 2, 3, 0);
  for (let i = 0; i < 100; i++) s.update(0.1, new THREE.Vector3(2, 1.6, 2.2), false, [d], 'you');
  assert.ok(d.slack.show && !d.slack.busted);
});
test('when the boss comes back, those facing the boss chair are caught at once and the rest are not; feet come down', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const s = createSlacking(() => {}), toward = desk('dark', 2, 3, Math.PI), away = desk('dark', 4, 3, 0), working = desk('green', 6, 3, Math.PI), desks = [toward, away, working];
  for (let i = 0; i < 50; i++) s.update(0.1, far, false, desks, 'you');
  s.update(0.1, far, false, desks, null);
  assert.ok(toward.slack.busted > 0 && !toward.slack.show); assert.ok(away.slack.show && !away.slack.busted); assert.equal(working.slack.feet, false);
  assert.ok(facesToward(toward, CHAIR) && !facesToward(away, CHAIR));
});
test('at most 3 screens are drawn a frame, and none out of view', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const s = createSlacking(() => {}), desks = Array.from({ length: 8 }, (_, i) => desk('dark', i * 2, 3, 0)), hidden = desks[0];
  for (let i = 0; i < 50; i++) s.update(0.1, far, false, desks, 'you', d => d !== hidden);
  for (const d of desks) d.drawn = 0;
  for (let i = 0; i < 10; i++) { const before = desks.reduce((n, d) => n + d.drawn, 0); s.update(0.05, far, false, desks, 'you', d => d !== hidden); assert.ok(desks.reduce((n, d) => n + d.drawn, 0) - before <= 3); }
  assert.equal(hidden.drawn, 0); assert.ok(desks.slice(1).every(d => d.drawn > 0), 'round-robin reaches every seen screen');
});
test('without the boss away, one desk at a time, as before', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const s = createSlacking(() => {}), desks = [desk('dark', 2, 3, 0), desk('dark', 4, 3, 0)];
  for (let i = 0; i < 600; i++) s.update(0.1, far, false, desks);
  assert.ok(desks.filter(d => d.slack.show).length <= 1);
});
test('a desk whose turn comes at once (no delay) shows and draws straight away', t => {
  t.mock.method(Math, 'random', () => 0);
  const s = createSlacking(() => {}), d = desk('dark', 2, 3, 0);
  s.update(0.1, far, false, [d], 'you'); s.update(0.1, far, false, [d], 'you');
  assert.ok(d.slack.show && d.drawn > 0);
});
