import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildTrack } from '../client/office/rc-track.js';
import { buildCar, lighten } from '../client/office/rc-car.js';
import { createDrivers } from '../client/office/rc.js';

const blank = () => new Proxy({}, { get: (t, k) => k in t ? t[k] : () => ({ addColorStop() {} }), set: (t, k, v) => { t[k] = v; return true; } });
const noDocument = t => { const was = globalThis.document; globalThis.document = { createElement: () => ({ getContext: blank }), fonts: undefined }; t.after(() => { if (was) globalThis.document = was; else delete globalThis.document; }); };

// Seen from above, as it always is: a strip wound the other way is culled, and the track doesn't show.
test("the track's lane and tape face up, whichever way round the circuit goes", t => {
  noDocument(t);
  for (const way of [1, -1]) {
    const n = 40, points = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { points[i * 2] = Math.cos(way * i / n * Math.PI * 2) * 2; points[i * 2 + 1] = Math.sin(way * i / n * Math.PI * 2) * 2; }
    const [lane, tape] = buildTrack({ points, length: 4 * Math.PI }).children;
    for (const mesh of [lane, tape]) {
      const p = mesh.geometry.attributes.position, idx = mesh.geometry.index.array, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (let i = 0; i < idx.length; i += 3) {
        a.fromBufferAttribute(p, idx[i]); b.fromBufferAttribute(p, idx[i + 1]); c.fromBufferAttribute(p, idx[i + 2]);
        assert.ok(b.sub(a).cross(c.sub(a)).y > 0, `triangle ${i / 3} faces down (way ${way})`);
      }
    }
  }
});

// An NPC's car in few draw calls (seven of them in full cost as many as the whole office): everything but its flames, wing
// and lamps' light merged by material, wheels too (theirs don't turn), the same size and shape, outlined and painted.
test('an NPC car is a handful of draw calls, the same car', t => {
  noDocument(t);
  const drawn = car => { let n = 0; car.traverseVisible(node => { if (node.isMesh) n++; }); return n; };
  const full = buildCar({ colour: '#3fa34d' }), light = lighten(buildCar({ colour: '#3fa34d' }));
  const box = car => new THREE.Box3().setFromObject(car);
  assert.ok(drawn(light.car) <= 14, `${drawn(light.car)} draw calls (the full car ${drawn(full.car)})`);
  assert.ok(box(light.car).min.distanceTo(box(full.car).min) < 1e-3 && box(light.car).max.distanceTo(box(full.car).max) < 1e-3, 'the same size');
  let paint = false, outline = false; light.car.traverse(node => { if (node.isMesh && node.material.color?.getHexString() === '3fa34d') paint = true; if (node.isMesh && node.geometry.attributes.outlineNormal && node.userData.outline) outline = true; });
  assert.ok(paint && outline, `paint ${paint}, outline ${outline}`);
});

// A friend's car at a meeting: shown where they drive it (played back by their clock), steering as they do; gone on 'off',
// after 3 s without a word, or when they're not at the meeting.
test("a friend's car shows where they drive it, and goes when they stop", t => {
  noDocument(t);
  let now = 10;
  const scene = new THREE.Scene(), drivers = createDrivers(scene, { clock: () => now }), roster = [{ id: 'me', at: 'meeting', name: 'Me', colour: '#e23b2a' }, { id: 'bo', at: 'meeting', name: 'Bo', colour: '#3fa34d' }];
  drivers.sync(roster, 'me');
  const say = (ms, x, steer = 0) => drivers.heard('bo', { type: 'car', mode: 'drive', x, y: 0, z: 2, yaw: 0.5, steer, glide: false, t: ms });
  for (let k = 0; k <= 10; k++) { say(1000 + k * 100, 1 + k * 0.1, 0.8); now += 0.1; drivers.update(); }
  now += 0.3; drivers.update();
  assert.ok(drivers.has('bo'));
  const car = scene.children.find(o => o.isGroup && o.visible);
  assert.ok(car, 'shown');
  const at = new THREE.Vector3(); car.children[0].getWorldPosition(at);
  assert.ok(at.x > 1.5 && at.x <= 2.01 && Math.abs(at.z - 2) < 1e-6, `where they drove: ${at.x.toFixed(2)}, ${at.z}`);
  drivers.heard('me', { type: 'car', mode: 'drive', x: 0, y: 0, z: 0, yaw: 0, steer: 0, glide: false, t: 1 });
  assert.ok(!drivers.has('me'), 'not your own');
  drivers.heard('bo', { type: 'car', mode: 'off' }); assert.ok(!drivers.has('bo'), "gone on 'off'");
  say(5000, 1); assert.ok(drivers.has('bo')); now += 3.5; drivers.update(); assert.ok(!drivers.has('bo'), 'gone after 3 s of silence');
  say(9000, 1); drivers.sync(roster.map(p => p.id === 'bo' ? { ...p, at: 'home' } : p), 'me'); assert.ok(!drivers.has('bo'), 'gone when they leave the meeting');
  drivers.dispose(); assert.equal(scene.children.filter(o => o.isGroup).length, 0);
});
