import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLights } from '../client/office/lights.js';

// The switch is this browser's at home and the meeting's away: flipped there it's told but not kept, and home again it's yours.
test('the switch: kept at home, told always, the meeting\'s while away', t => {
  const kept = new Map(), was = globalThis.localStorage;
  globalThis.localStorage = { getItem: k => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v) };
  t.after(() => { if (was) globalThis.localStorage = was; else delete globalThis.localStorage; });
  const lights = createLights(new THREE.Group(), { from: new THREE.Vector3(), to: new THREE.Vector3() }), told = [];
  lights.onFlip = on => told.push(on);
  const flip = () => lights.createSwitch().userData.toggle();
  assert.equal(lights.on, true);
  flip(); assert.equal(lights.on, false); assert.equal(kept.get('office-lights'), 'off');
  flip(); assert.equal(kept.get('office-lights'), 'on');
  lights.visit(true); lights.set(false); assert.equal(lights.on, false, 'as the meeting says');
  flip(); flip(); assert.equal(lights.on, false); assert.equal(kept.get('office-lights'), 'on', 'not kept away');
  lights.visit(false); assert.equal(lights.on, true, 'yours, as kept');
  flip(); lights.visit(true); assert.equal(lights.on, true, 'on in their office, whatever yours'); lights.visit(false); assert.equal(lights.on, false);
  assert.deepEqual(told, [false, true, true, false, false]);
});
