// The bridge's layout: pure, so walking and tests can use it without a renderer.
import * as THREE from 'three';

// The room is a circle centred in the square walkGrid expects.
export const R = 4.5, PIT = 2.7, DECK = .36, CENTER = 8;
const DEG = Math.PI / 180;
export const WALL = R * Math.cos(12 * DEG);
// You walk within a plain circle, just short of the consoles and the window, so there are no corners to catch on.
export const EDGE = 3.5;
export const ROOM = { width: 16, depth: 16, inside: ({ x, z }) => Math.hypot(x - CENTER, z - CENTER) <= EDGE };
// Degrees from the window, front first.
export const STATION_ANGLES = [-48, 48, -72, 72, -96, 96, -120, 120, -144, 144];
// The pit, one step level, then the raised deck.
export function floorHeight(x, z) {
  const r = Math.hypot(x - CENTER, z - CENTER);
  return r < PIT ? 0 : r < PIT + .12 ? DECK / 2 : DECK;
}
export function stationAt(index) {
  const t = STATION_ANGLES[index] * DEG;
  return { x: CENTER + Math.sin(t) * WALL, z: CENTER - Math.cos(t) * WALL, yaw: -t };
}
// Where to stand before a station, clear of its chair.
const STAND = WALL - 1.3;
export function stationStand(index) {
  const t = STATION_ANGLES[index] * DEG;
  return new THREE.Vector3(CENTER + Math.sin(t) * STAND, 0, CENTER - Math.cos(t) * STAND);
}
// What you can't walk through inside that circle. The chairs at the stations and the helm are left out, to keep the deck open.
export const CHAIR_Z = .49, HELM_Z = -1.78, CREW_Z = .85;
// A station's display, in that station's space.
export const DISPLAY = { width: 1.7, height: 1.75, bottom: 1.45, z: .112 };
export const SEAT = { x: CENTER, y: 1.6, z: CENTER + CHAIR_Z - .06, yaw: 0, pitch: -.07 };
const block = (x, z, hx, hz) => new THREE.Box3(new THREE.Vector3(CENTER + x - hx, 0, CENTER + z - hz), new THREE.Vector3(CENTER + x + hx, 1, CENTER + z + hz));
export const deckColliders = () => [
  block(0, HELM_Z, .9, .26),        // the helm
  block(0, CHAIR_Z + .14, .42, .33), // the captain's chair
];
