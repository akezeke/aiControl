import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bracketsFor, boxCorners, bracketFrame, rectCorners } from '../client/bridge/brackets.js';

const camera = new THREE.PerspectiveCamera(90, 1, .2, 34); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
const box = (x0, x1, y0, y1, z0, z1) => { const out = []; for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) out.push(new THREE.Vector3(x, y, z)); return out; };

test('brackets surround the projected corners', () => {
  const out = bracketsFor(box(-1, 1, -1, 1, -2, -2), camera);
  for (const [k, v] of Object.entries({ left: -.5, right: .5, bottom: -.5, top: .5 })) assert.ok(Math.abs(out[k] - v) < 1e-6, k);
});
test('nothing for something behind the camera', () => assert.equal(bracketsFor(box(-1, 1, -1, 1, 2, 3), camera), null));
test('nothing for something off to the side', () => assert.equal(bracketsFor(box(5, 6, -1, 1, -2, -2), camera), null));
test('something you stand inside or beside stays on screen and finite', () => {
  const out = bracketsFor(box(-1, 1, -1, 1, -2, 2), camera);
  for (const v of Object.values(out)) assert.ok(Number.isFinite(v) && Math.abs(v) <= 1);
});
test('a box has eight corners, taken from the object in the world', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)); mesh.position.set(5, 0, 0); mesh.updateMatrixWorld(true);
  const corners = boxCorners(mesh);
  assert.equal(corners.length, 8);
  assert.ok(corners.every(({ x, y, z }) => (x === 4 || x === 6) && Math.abs(y) === 1 && Math.abs(z) === 1));
});
test('a flat thing gets its own corners, not the box round it, when it stands at an angle', () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 1)); mesh.rotation.y = Math.PI / 4; mesh.updateMatrixWorld(true);
  for (const { x, z } of boxCorners(mesh)) assert.ok(Math.abs(x + z) < 1e-9);
});
test('something made of parts still gets the box round all of it', () => {
  const group = new THREE.Group(), part = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)); part.position.x = 5; group.add(part); group.updateMatrixWorld(true);
  const xs = boxCorners(group).map(({ x }) => x);
  assert.equal(Math.min(...xs), 4); assert.equal(Math.max(...xs), 6);
});
test('a rectangle on a canvas maps to the same place on its plane', () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 1)); mesh.position.x = 5; mesh.updateMatrixWorld(true);
  const corners = rectCorners(mesh, { x: 0, y: 0, w: 50, h: 25 }, 100, 50);
  assert.equal(corners.length, 4);
  const xs = corners.map(({ x }) => x), ys = corners.map(({ y }) => y);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [4, 5, 0, .5]);
});
test('brackets stand clear of what they surround', () => {
  const frame = bracketFrame({ left: -.5, right: .5, bottom: -.25, top: .5 }, 1000, 800);
  assert.ok(frame.left < -250 && frame.right > 250 && frame.bottom < -100 && frame.top > 200);
});
test('something that fills the view keeps its brackets on screen', () => {
  const frame = bracketFrame({ left: -1, right: 1, bottom: -1, top: 1 }, 1000, 800);
  assert.ok(frame.left >= -500 + 1 && frame.right <= 500 - 1 && frame.bottom >= -400 + 1 && frame.top <= 400 - 1);
});
test('a small thing has four corners, not a closed box', () => {
  const frame = bracketFrame({ left: -.01, right: .01, bottom: -.01, top: .01 }, 1000, 1000);
  assert.ok(frame.armX * 2 < frame.right - frame.left && frame.armY * 2 < frame.top - frame.bottom);
});
test('a big thing gets the full length of arm', () => {
  const { armX, armY } = bracketFrame({ left: -.5, right: .5, bottom: -.5, top: .5 }, 1000, 1000);
  assert.ok(armX >= 28 && armY >= 28);
});
