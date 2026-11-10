import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { walkGrid } from '../client/office/path.js';
import { COLOURS } from '../client/office/meeting.js';
import { createGoose } from '../client/office/goose.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z), grid = walkGrid([], { width: 10, depth: 10 });
const blank = () => new Proxy({}, { get: (t, k) => k in t ? t[k] : () => ({ addColorStop() {} }), set: (t, k, v) => { t[k] = v; return true; } });
const P = (id, extra = {}) => ({ id, name: id, fruit: 'apple', colour: COLOURS[0], at: 'meeting', ...extra });
// A goose in an empty 10 × 10 m office. You stand at (1, 1), busy unless said. A thing: { kind: { key }, pos, rest: true }.
function goose({ foods = () => [], others = () => [], things = [], sleepers = [], still = false, busy = true } = {}) {
  const sent = [], said = [], woken = [], ghosts = [], player = { position: V(1, 1.6, 1), step: v => player.position.add(v) };
  const props = { loose: () => things.filter(b => !b.held && !b.carried), carry: (b, at) => { if (b.held) return false; b.carried = at; return true; }, drop: b => { b.carried = null; },
    holdGhost: (kind, at) => { const h = { kind, at, gone: false, release() { h.gone = true; } }; ghosts.push(h); return h; } };
  const was = globalThis.document; globalThis.document = { createElement: () => ({ getContext: blank }) };
  let g; try { g = createGoose(new THREE.Scene(), { props, player, walkable: () => grid, bounds: () => ({ width: 10, depth: 10 }), busy: () => busy, reducedMotion: () => still,
    say: icon => said.push(icon), sleepers: () => sleepers, wake: id => woken.push(id), foods, others, me: () => 'a', net: m => sent.push(m) }); }
  finally { if (was) globalThis.document = was; else delete globalThis.document; }
  const run = (seconds, each) => { for (let i = 0; i < Math.round(seconds * 60); i++) { g.update(1 / 60); if (each?.()) return true; } return false; };
  return { g, sent, said, woken, ghosts, player, run, at: () => [g.root.position.x, g.root.position.z] };
}

test('a fruit visit: it stands 0.75–1.0 m from the food, then leaves within 6–12 s, or once the food is gone', () => {
  const food = { food: [5.125, 2.125], head: [2.125, 2.125] };
  let out = [food]; const a = goose({ foods: () => out });
  assert.ok(a.run(110, () => a.g.mode === 'mill'), 'went to the food');
  const d = Math.hypot(a.at()[0] - 5.125, a.at()[1] - 2.125); assert.ok(d > 0.7 && d < 1.05);
  let stayed = 0; a.run(13, () => { stayed += 1 / 60; return !['visit', 'mill'].includes(a.g.mode); });
  assert.ok(stayed > 5.5 && stayed < 12.1, `stayed ${stayed} s`);
  const b = goose({ foods: () => out }); assert.ok(b.run(110, () => b.g.mode === 'mill'));
  out = []; b.run(1 / 60); assert.equal(b.g.mode, 'loiter');
});

test('no fruit visits with reduced motion at home: it stands still', () => {
  const a = goose({ foods: () => [{ food: [5.125, 2.125], head: [2.125, 2.125] }], still: true });
  a.run(1 / 60); const from = a.at(); a.run(110);
  assert.deepEqual(a.at(), from); assert.equal(a.g.mode, 'loiter');
});
