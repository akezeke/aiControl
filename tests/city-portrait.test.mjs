import test from 'node:test';
import assert from 'node:assert/strict';
import { portrait, PORTRAIT_STOREYS } from '../client/city/portrait.js';
import { tower } from '../client/city/identity.js';

const session = (over = {}) => ({ id: 'a', provider: 'claude', status: 'idle', ...over });
const opaque = rgba => { let n = 0; for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) n++; return n; };
const light = rgba => { let sum = 0, n = 0; for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3]) { sum += rgba[i] + rgba[i + 1] + rgba[i + 2]; n++; } return sum / n; };

test('a session at work has the four looks its tower cycles through on the map, all one size', () => {
  const { frames, width, height } = portrait(session({ status: 'working' }));
  assert.equal(frames.length, 4);
  for (const frame of frames) assert.equal(frame.length, width * height * 4);
  assert.ok(frames.some(frame => frame.some((value, i) => value !== frames[0][i])), 'the frames differ');
});

test('anything not at work holds still', () => {
  assert.equal(portrait(session({ status: 'idle' })).frames.length, 1);
  assert.equal(portrait(session({ status: 'permission', requests: [{ createdAt: 1 }] })).frames.length, 1);
});

test('reduced motion holds a working tower still too', () => {
  assert.equal(portrait(session({ status: 'working' }), { reduced: true }).frames.length, 1);
});

test('a sleeper is darker than the same tower at work, as on the map', () => {
  const awake = portrait(session({ status: 'working' }), { reduced: true }), asleep = portrait(session({ status: 'idle' }), { reduced: true });
  assert.ok(light(asleep.frames[0]) < light(awake.frames[0]) * .8);
});

test('without a connection nothing is at work', () => {
  const lost = portrait(session({ status: 'working' }), { connected: false });
  assert.equal(lost.frames.length, 1);
  assert.equal(lost.asleep, true);
});

test('a saved look is the one on the map, and without one the same look the map would pick', () => {
  assert.equal(portrait(session(), { towers: { a: { look: 'Gold Dome', storeys: 9 } } }).name, 'Gold Dome');
  assert.equal(portrait(session()).name, tower('a').name);
});

test('a tall tower still fits: height is capped, so a card keeps its size', () => {
  const tall = portrait(session(), { towers: { a: { look: 'Gold Spire', storeys: 40 } } }), capped = portrait(session(), { towers: { a: { look: 'Gold Spire', storeys: PORTRAIT_STOREYS } } });
  assert.equal(tall.height, capped.height);
  assert.equal(tall.key, capped.key);
});

test('a subagent is a small building in its parent\'s colours, smaller than a tower', () => {
  const parent = portrait(session(), { towers: { a: { look: 'Gold Spire' } } }), kid = portrait(session({ id: 'k', parentId: 'a' }), { towers: { a: { look: 'Gold Spire' } } });
  assert.equal(kid.name, 'Gold Spire');
  assert.ok(opaque(kid.frames[0]) < opaque(parent.frames[0]));
  assert.ok(kid.height < parent.height);
});
