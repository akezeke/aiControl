import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { HEADS, SUITS, createCrew, crewArrival, crewLook, crewPose } from '../client/bridge/crew.js';
import { CENTER, DISPLAY, SEAT, STATION_ANGLES, WALL } from '../client/bridge/deck.js';
import { SIGNALS } from '../client/bridge/palettes.js';
import { plate } from '../client/bridge/parts.js';

const ids = Array.from({ length: 10 }, (_, i) => `session-${i}`);
test('same id, same look', () => assert.deepEqual(crewLook('abc', new Set()), crewLook('abc', new Set())));
test('seated agents differ while looks remain', () => {
  const taken = new Set();
  for (const id of ids) { const { key } = crewLook(id, taken); assert.ok(!taken.has(key), id); taken.add(key); }
});
test('every pair is taken: it still returns a look', () => {
  const all = new Set(); HEADS.forEach((_, h) => SUITS.forEach((_, s) => all.add(`${h}-${s}`)));
  assert.ok(all.has(crewLook('abc', all).key));
});
test('no suit is close to a signal, and none is bright enough to bloom', () => {
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  for (const suit of SUITS) {
    assert.ok(Math.max(...rgb(suit)) < 0xc8, suit);
    for (const signal of Object.values(SIGNALS)) assert.ok(Math.hypot(...rgb(suit).map((v, i) => v - rgb(signal)[i])) > 100, `${suit} ${signal}`);
  }
});
test('each signal has its pose', () => {
  assert.deepEqual(crewPose('need'), { turn: Math.PI, lean: 0, raise: 1, hands: false, track: false });
  assert.equal(crewPose('working').hands, true); assert.equal(crewPose('working').turn, 0);
  assert.ok(crewPose('idle').lean < 0); assert.equal(crewPose('idle').hands, false);
});
test('only a real comer or goer shimmers', () => {
  const base = { was: null, id: 'a', offline: false, wasOffline: false, started: true, still: false };
  assert.equal(crewArrival(base), 'shimmer');
  assert.equal(crewArrival({ ...base, was: 'a', id: null }), 'shimmer');
  assert.equal(crewArrival({ ...base, was: 'a' }), 'none');
  assert.equal(crewArrival({ ...base, started: false }), 'cut');
  assert.equal(crewArrival({ ...base, offline: true }), 'cut');
  assert.equal(crewArrival({ ...base, wasOffline: true }), 'cut');
  assert.equal(crewArrival({ ...base, still: true }), 'cut');
  assert.equal(crewArrival({ ...base, was: 'a', id: 'b' }), 'shimmer');
});

const DEG = Math.PI / 180, poses = ['need', 'working', 'idle'], times = [0, .7, 1.4];
function bridge(signal, head, t) {
  const scene = new THREE.Group();
  const figures = STATION_ANGLES.map(theta => {
    const group = new THREE.Group(), a = theta * DEG; group.position.set(Math.sin(a) * WALL, 0, -Math.cos(a) * WALL); group.rotation.y = -a; scene.add(group);
    const figure = createCrew({ group }); figure.setLook({ head, suit: 0, mark: 0, key: '' }); figure.setSignal(signal); figure.present(true, 'cut'); figure.tick(30, t); figure.tick(.016, t);
    return { group, figure };
  });
  scene.updateMatrixWorld(true); return figures;
}
test('from the chair, nobody covers any display', () => {
  const eye = new THREE.Vector3(0, SEAT.y, SEAT.z - CENTER), ray = new THREE.Raycaster();
  for (const signal of poses) for (let head = 0; head < HEADS.length; head++) for (const t of times) {
    const figures = bridge(signal, head, t), roots = figures.map(({ figure }) => figure.root);
    for (const { group } of figures) for (let k = -1; k <= 1; k += .25) {
      const point = group.localToWorld(new THREE.Vector3(k * DISPLAY.width / 2, DISPLAY.bottom, DISPLAY.z)), to = point.clone().sub(eye), far = to.length();
      ray.set(eye, to.normalize()); ray.far = far;
      assert.deepEqual(ray.intersectObjects(roots, true).map(hit => hit.object.name), [], `${signal} ${HEADS[head]} t${t}`);
    }
  }
});
test('a figure is cheap', () => {
  const figure = createCrew({ group: new THREE.Group() }); let meshes = 0; figure.root.traverse(o => { meshes += +!!o.isMesh; }); assert.ok(meshes <= 12, String(meshes));
});
test('figures share their geometry', () => {
  const a = createCrew({ group: new THREE.Group() }), b = createCrew({ group: new THREE.Group() }), used = f => { const out = new Set(); f.root.traverse(o => { if (o.isMesh) out.add(o.geometry); }); return out; };
  const of = used(b); for (const geometry of used(a)) assert.ok(of.has(geometry));
});
test('a raised hand comes no higher than the head', () => {
  for (let head = 0; head < HEADS.length; head++) { const [{ figure }] = bridge('need', head, 0), top = name => new THREE.Box3().setFromObject(figure.root.getObjectByName(name), true).max.y; assert.ok(top('hand') <= top('headTop') + 1e-6, HEADS[head]); }
});
test('the raised hand really is up, near the head', () => {
  const [{ figure }] = bridge('need', 0, 0), top = name => new THREE.Box3().setFromObject(figure.root.getObjectByName(name), true).max.y; assert.ok(top('hand') > top('headTop') - .15);
});
test('a shimmer is never aimed at', () => {
  const figure = createCrew({ group: new THREE.Group() }); figure.present(true, 'shimmer');
  const ray = new THREE.Raycaster(new THREE.Vector3(0, .5, 3), new THREE.Vector3(0, 0, -1)), hits = []; figure.shimmer.raycast(ray, hits); assert.deepEqual(hits, []);
});
test('a figure has gone once it has faded, and a cut is instant', () => {
  const figure = createCrew({ group: new THREE.Group() }), step = () => figure.tick(.1, 0);
  figure.present(true, 'cut'); assert.equal(figure.root.visible, true);
  figure.present(false, 'shimmer'); assert.equal(figure.root.visible, true); for (let i = 0; i < 8; i++) step(); assert.equal(figure.root.visible, false);
  figure.present(true, 'shimmer'); step(); assert.equal(figure.root.visible, true); assert.ok(figure.shimmer.visible); for (let i = 0; i < 8; i++) step(); assert.equal(figure.shimmer.visible, false);
  figure.present(false, 'cut'); assert.equal(figure.root.visible, false);
});

test('a plate thinner than its bevel still faces outward', () => {
  const position = plate(.17, .035, .012).attributes.position, [a, b, c, side, normal, middle] = Array.from({ length: 6 }, () => new THREE.Vector3());
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, i + 1); c.fromBufferAttribute(position, i + 2);
    normal.subVectors(b, a).cross(side.subVectors(c, a)); middle.copy(a).add(b).add(c);
    assert.ok(normal.dot(middle) >= -1e-9, `triangle ${i / 3} faces in`);
  }
});
