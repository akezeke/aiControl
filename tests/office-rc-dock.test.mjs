import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AISLE } from '../client/office/layout.js';
import { pick } from '../client/office/player.js';
import { createRoom } from '../client/office/room.js';

const blank = () => new Proxy({}, { get: (t, k) => k in t ? t[k] : () => ({ addColorStop() {} }), set: (t, k, v) => { t[k] = v; return true; } });
const noDocument = t => { const was = globalThis.document; globalThis.document = { createElement: () => ({ getContext: blank }), fonts: undefined }; t.after(() => { if (was) globalThis.document = was; else delete globalThis.document; }); };
const empty = (width, depth, cellW = width - AISLE) => ({ room: { width, depth }, door: { x: width / 2, z: depth }, desks: new Map(), pods: [], grid: { cols: 1, cellW } });

test('the RC dock sits on the floor under the scoreboard, and a click on it starts a race', t => {
  noDocument(t);
  const scene = new THREE.Scene(), room = createRoom(scene, {}), width = 12;
  room.sync(empty(width, 10), new Map());
  const dock = room.rcDock;
  assert.ok(dock, 'a dock');
  // What shows (the parked car's headlight beams are there, hidden, and reach below the floor).
  const box = new THREE.Box3();
  dock.updateMatrixWorld(true);
  dock.traverseVisible(n => { if (n.isMesh) { n.geometry.computeBoundingBox(); box.union(n.geometry.boundingBox.clone().applyMatrix4(n.matrixWorld)); } });
  assert.ok(box.min.y > -0.001 && box.max.y < 0.2, `on the floor and low: ${box.min.y}..${box.max.y}`);
  const board = room.boards.scores.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(dock.position.x - board.x) < 0.1 && dock.position.z > 0.2 && dock.position.z < 0.8, `under the scoreboard (${board.x}): ${dock.position.x}, ${dock.position.z}`);
  let races = 0; room.onRace = () => races++;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 50);
  camera.position.set(dock.position.x, 1.2, dock.position.z + 1.2); camera.lookAt(dock.position); camera.updateMatrixWorld();
  const hit = pick({ clientX: 50, clientY: 50 }, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) }, camera, scene);
  assert.equal(hit?.kind, 'toggle');
  hit.node.userData.toggle(hit.point);
  assert.equal(races, 1);
});

test('the parked RC car is a few merged meshes, not 65 draw calls in every view of the office', t => {
  noDocument(t);
  const scene = new THREE.Scene(), room = createRoom(scene, {});
  room.sync(empty(12, 10), new Map());
  let draws = 0; room.rcParked.traverseVisible(n => { if (n.isMesh) draws++; });
  assert.ok(draws <= 14, `${draws} meshes drawn`);
});
