import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { aimPoint, clickAction, keyAction, screenPose, tapUsesAim } from '../client/bridge/seat.js';
import { roster, shipState } from '../client/bridge/ship.js';
import { ROSTER, carryHover, hologramLayout } from '../client/bridge/hologram.js';

const seated = { seated: true, zoomed: false, overview: false, locked: true, mouse: true };
const standing = { ...seated, seated: false };
const floor = { kind: 'floor' }, screen = { kind: 'screen' }, chair = { kind: 'chair' }, person = { kind: 'character' };

test('in the chair, a click on the floor never walks you off', () => {
  assert.equal(clickAction(floor, seated), null);
  assert.equal(clickAction(floor, { ...seated, locked: false, mouse: false }), null); // a tap
});
test('out of the chair, a click on the floor walks', () => {
  assert.equal(clickAction(floor, standing), 'walk');
  assert.equal(clickAction(floor, { ...standing, locked: false, mouse: false }), 'walk');
});
test('a mouse not yet captured is captured by a click on nothing in particular', () => {
  for (const state of [seated, standing]) for (const hit of [floor, null]) assert.equal(clickAction(hit, { ...state, locked: false }), 'capture');
  assert.equal(clickAction(null, seated), null);
  assert.equal(clickAction(null, { ...seated, locked: false, mouse: false }), null);
});
test('sessions and screens answer from anywhere, including the chair', () => {
  for (const state of [seated, standing, { ...seated, locked: false }, { ...seated, locked: false, mouse: false }]) {
    assert.equal(clickAction(person, state), 'talk');
    assert.equal(clickAction(screen, state), 'zoom');
  }
});
test('the chair takes you back only when you are out of it', () => {
  assert.equal(clickAction(chair, standing), 'sit');
  assert.equal(clickAction(chair, seated), null);
});
test('zoomed on a screen, any click comes back, whatever is under it', () => {
  for (const hit of [floor, screen, person, chair, null]) assert.equal(clickAction(hit, { ...seated, zoomed: true }), 'back');
});
test('in the overview, only sessions answer', () => {
  const overview = { ...standing, overview: true, locked: false };
  assert.equal(clickAction(person, overview), 'talk');
  for (const hit of [floor, screen, chair]) assert.equal(clickAction(hit, overview), null);
});
test('E does what a click does on what can be used', () => {
  assert.equal(keyAction(person, seated), 'talk');
  assert.equal(keyAction(screen, seated), 'zoom');
  assert.equal(keyAction(chair, standing), 'sit');
  assert.equal(keyAction(screen, { ...seated, zoomed: true }), 'back');
  assert.equal(keyAction(null, { ...seated, zoomed: true }), 'back');
  assert.equal(keyAction(person, { ...seated, overview: true }), 'talk');
  assert.equal(keyAction(screen, { ...seated, overview: true }), null);
});
test('E never captures the mouse or walks you off', () => {
  assert.equal(keyAction(null, { ...seated, locked: false }), null);
  assert.equal(keyAction(floor, { ...standing, locked: false }), null);
  assert.equal(keyAction(floor, standing), null);
  assert.equal(keyAction(chair, seated), null);
});

const FOV = 68, ASPECT = 16 / 9, tan = Math.tan(FOV / 2 * Math.PI / 180);
const mesh = (w, h, build) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h)); m.userData.width = w; m.userData.height = h; build?.(m); m.updateMatrixWorld(true); return m; };
const fits = (m, { position, look }) => {
  const centre = m.getWorldPosition(new THREE.Vector3()), d = position.distanceTo(look);
  assert.ok(look.distanceTo(centre) < 1e-6, 'looks at the screen');
  assert.ok(m.userData.height / 2 <= d * tan && m.userData.width / 2 <= d * tan * ASPECT, 'all of it in view');
  return d;
};
test('the view of a screen stands square in front of it, on its lit side, with all of it in view', () => {
  const m = mesh(2.24, .82, m => { m.position.set(3, 2.6, -4); m.rotation.y = -.8; });
  const pose = screenPose(m, FOV, ASPECT), d = fits(m, pose);
  const facing = new THREE.Vector3(0, 0, 1).transformDirection(m.matrixWorld);
  assert.ok(pose.position.clone().sub(pose.look).normalize().distanceTo(facing) < 1e-6);
  assert.ok(d < 2.5, `close enough to read: ${d}`);
});
test('a tall window or narrow screen is fitted by whichever side needs more room', () => {
  const wide = fits(mesh(2.76, .2), screenPose(mesh(2.76, .2), FOV, ASPECT)), narrow = screenPose(mesh(2.76, .2), FOV, .5).position.distanceTo(new THREE.Vector3());
  assert.ok(narrow > wide * 2);
});
test('a tiny screen is never so close that the near plane cuts it', () => {
  assert.ok(screenPose(mesh(.1, .05), FOV, ASPECT).position.length() >= .3);
});

const s = (id, status, extra = {}) => ({ id, status, title: id, updatedAt: 0, ...extra });
test('the roster lists every session, those waiting first, without helpers', () => {
  const list = roster([s('idle', 'idle'), s('work', 'working'), s('ask', 'question'), s('sub', 'working', { parentId: 'work' }), s('perm', 'permission')]);
  assert.deepEqual(list.slice(0, 2).map(({ id }) => id).sort(), ['ask', 'perm']);
  assert.deepEqual(list.slice(2).map(({ id }) => id), ['work', 'idle']);
});
test('the ship carries its roster, and an empty ship has an empty one', () => {
  assert.deepEqual(shipState({ sessions: [s('a', 'idle')] }, 0).roster.map(({ id }) => id), ['a']);
  assert.deepEqual(shipState({}, 0).roster, []);
});
test('a highlight follows its row when the list reorders, and goes if the row does', () => {
  const a = { id: 'a' }, b = { id: 'b' };
  assert.equal(carryHover([a, b], 0, [b, a]), 1);
  assert.equal(carryHover([a, b], 0, [b]), -1);
  assert.equal(carryHover([a, b], -1, [b, a]), -1);
});
test('a helper is listed only when it is the one asking', () => {
  const ids = roster([s('sub', 'question', { parentId: 'main' }), s('main', 'working')]).map(({ id }) => id);
  assert.deepEqual(ids, ['sub', 'main']);
});
test('the roster panel has room for all ten stations', () => {
  assert.equal(hologramLayout(10, 512, Math.round(512 * ROSTER.height / ROSTER.width)).rows.length, 10);
});
test('a screenshot on a display opens, from the chair or close up, but not from the overview', () => {
  const picture = { kind: 'shot' };
  assert.equal(clickAction(picture, seated), 'shots'); assert.equal(clickAction(picture, { ...seated, zoomed: true }), 'shots'); assert.equal(keyAction(picture, { ...seated, zoomed: true }), 'shots');
  assert.equal(clickAction(picture, { ...seated, overview: true }), null);
});
test('what is aimed at: the sight when captured or by touch, otherwise the mouse', () => {
  const centre = 'centre', mouse = 'mouse';
  assert.equal(aimPoint({ aiming: true, touch: false, overview: false }, centre, mouse), centre);
  assert.equal(aimPoint({ aiming: false, touch: false, overview: false }, centre, mouse), mouse);
  assert.equal(aimPoint({ aiming: false, touch: true, overview: false }, centre, null), centre);
  assert.equal(aimPoint({ aiming: false, touch: true, overview: true }, centre, null), null);
});
test('a tap does what is highlighted, wherever the finger lands', () => {
  const tap = { mouse: false, zoomed: false, panelOpen: false, seated: true, aimed: { kind: 'hit' }, tapped: { kind: 'chair' } };
  assert.equal(tapUsesAim(tap), true);
  assert.equal(tapUsesAim({ ...tap, tapped: null }), true);
  assert.equal(tapUsesAim({ ...tap, tapped: { kind: 'floor' } }), true); // seated, the floor means nothing
  assert.equal(tapUsesAim({ ...tap, aimed: null }), false); // nothing highlighted: it's what the finger is on
  assert.equal(tapUsesAim({ ...tap, mouse: true }), false);
});
test('a tap still means what it did close up, over an open list, and on the floor when walking', () => {
  const tap = { mouse: false, zoomed: false, panelOpen: false, seated: false, aimed: { kind: 'hit' }, tapped: null };
  assert.equal(tapUsesAim({ ...tap, zoomed: true }), false);
  assert.equal(tapUsesAim({ ...tap, panelOpen: true }), false);
  assert.equal(tapUsesAim({ ...tap, tapped: { kind: 'floor' } }), false);
  assert.equal(tapUsesAim(tap), true);
});
