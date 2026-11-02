import { resolveStep } from '../client/office/player.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CENTER, CHAIR_Z, CREW_Z, DECK, EDGE, PIT, ROOM, SEAT, STATION_ANGLES, WALL, deckColliders, floorHeight, stationAt, stationStand } from '../client/bridge/deck.js';
import { walkGrid, findPath } from '../client/office/path.js';

const at = (r, degrees) => [CENTER + Math.sin(degrees * Math.PI / 180) * r, CENTER - Math.cos(degrees * Math.PI / 180) * r];

test('floor levels', () => {
  assert.equal(floorHeight(...at(1, 0)), 0);
  assert.equal(floorHeight(...at(EDGE, 90)), DECK);
  const step = floorHeight(...at(PIT + .06, 0));
  assert.ok(step > 0 && step < DECK);
});
test('the room is the circle', () => {
  assert.ok(ROOM.inside({ x: CENTER, z: CENTER }));
  assert.ok(ROOM.inside({ x: CENTER, z: CENTER + EDGE - .1 }));
  assert.ok(!ROOM.inside({ x: CENTER, z: CENTER + EDGE + .1 }));
  assert.ok(!ROOM.inside({ x: .5, z: .5 }));   // in the square, outside the circle
});
test('stations go front first and face the centre', () => {
  assert.equal(STATION_ANGLES.length, 10);
  const { x, z } = stationAt(0);
  assert.ok(z < CENTER && x < CENTER);
});

test('you can walk from the centre up to the deck, through a gap', () => {
  const grid = walkGrid(deckColliders(), ROOM);
  const path = findPath(grid, new THREE.Vector3(CENTER, 0, CENTER), stationStand(0));
  assert.ok(path?.length);
});
test('the deck is still routable', () => {
  const grid = walkGrid(deckColliders(), ROOM);
  const leftChair = new THREE.Vector3(CENTER, 0, SEAT.z - .95);
  const spots = [new THREE.Vector3(CENTER, 0, CENTER + CHAIR_Z + 1), ...STATION_ANGLES.map((_, i) => stationStand(i))];
  for (const spot of spots) assert.ok(findPath(grid, leftChair, spot), `${spot.x},${spot.z}`);
});
test('you stand clear behind a station\'s crew member, on the deck', () => {
  for (let i = 0; i < STATION_ANGLES.length; i++) {
    const { x, z } = stationStand(i), from = Math.hypot(x - CENTER, z - CENTER);
    assert.ok(from < WALL - CREW_Z - .3 && from > PIT, String(from));
  }
});

const walk = (from, delta) => resolveStep(from, delta, deckColliders(), ROOM);
test('nothing stands between the pit and the deck', () => {
  for (let degrees = 0; degrees < 360; degrees += 10) {
    const t = degrees * Math.PI / 180, direction = new THREE.Vector3(Math.sin(t), 0, -Math.cos(t));
    let at = new THREE.Vector3(CENTER, 0, CENTER).addScaledVector(direction, PIT - .9);
    for (let i = 0; i < 40; i++) at = walk(at, direction.clone().multiplyScalar(.05));
    assert.ok(Math.hypot(at.x - CENTER, at.z - CENTER) > EDGE - .3, `stopped at ${degrees}°`);
  }
});
test('you can walk right round the edge of the deck without catching on anything', () => {
  let at = new THREE.Vector3(CENTER, 0, CENTER + EDGE - .05), turned = 0, before = Math.PI;
  for (let i = 0; i < 1000 && turned < 2 * Math.PI; i++) {
    const t = Math.atan2(at.x - CENTER, at.z - CENTER);
    // Along the wall and leaning into it, as you do holding two keys.
    at = walk(at, new THREE.Vector3(Math.cos(t) * .05 + Math.sin(t) * .02, 0, -Math.sin(t) * .05 + Math.cos(t) * .02));
    const now = Math.atan2(at.x - CENTER, at.z - CENTER);
    turned += Math.abs(Math.atan2(Math.sin(now - before), Math.cos(now - before))); before = now;
  }
  assert.ok(turned >= 2 * Math.PI, `got ${turned} radians round`);
});
