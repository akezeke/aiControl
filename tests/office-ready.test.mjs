import test from 'node:test';
import assert from 'node:assert/strict';
import { shaders, textures, inSlices } from '../client/office/ready.js';

const program = log => { const it = { getUniforms: () => log.push(['uniforms', it]), getAttributes: () => log.push(['attributes', it]) }; return it; };
const renderer = ({ parallel = true, seen = [] } = {}) => {
  const log = [], old = {}, known = new Set(seen), it = {
    log, old,
    extensions: { has: name => parallel && name === 'KHR_parallel_shader_compile' },
    info: { programs: [old] },
    properties: { has: map => known.has(map) },
    compileAsync: (...args) => { log.push(['compile', ...args]); it.info.programs.push(program(log), program(log)); return Promise.resolve(); },
    initTexture: map => { log.push(['texture', map]); known.add(map); },
  };
  return it;
};
const map = (version = 1) => ({ isTexture: true, version });
const root = (...materials) => ({ traverse: visit => materials.forEach(material => visit({ material })) });

test('with parallel compile: the compile is waited for, then each new program has its first use in a slice of its own', () => {
  const r = renderer(), at = {}, camera = {}, scene = {}, steps = shaders(r, at, camera, scene);
  const compiled = steps.next().value;
  assert.ok(compiled instanceof Promise);
  assert.deepEqual(r.log, [['compile', at, camera, scene]]);
  const [, , first, second] = [r.old, ...r.info.programs];
  assert.equal(steps.next().done, false);
  assert.deepEqual(r.log.slice(1), [['uniforms', first], ['attributes', first]]);
  assert.equal(steps.next().done, false);
  assert.deepEqual(r.log.slice(3), [['uniforms', second], ['attributes', second]]);
  assert.equal(steps.next().done, true);
});

test('without parallel compile, no shader is touched: it would stall whoever is walking, so the first draw pays as it always did', () => {
  const r = renderer({ parallel: false });
  assert.deepEqual([...shaders(r, {}, {}, {})], []);
  assert.deepEqual(r.log, []);
});

test('textures: a slice each and each once, whatever holds them, the gate not applying', () => {
  const a = map(), b = map(), c = map(), r = renderer({ parallel: false }), steps = textures(r, root({ map: a, alphaMap: b }, [{ map: a }], undefined, { uniforms: { far: { value: c }, drift: { value: 1 } } }));
  assert.equal(steps.next().done, false);
  assert.deepEqual(r.log, [['texture', a]]);
  assert.equal(steps.next().done, false);
  assert.deepEqual(r.log, [['texture', a], ['texture', b]]);
  assert.equal(steps.next().done, false);
  assert.deepEqual(r.log.at(-1), ['texture', c], 'a shader\'s too');
  assert.equal(steps.next().done, true);
});

test("textures: what the renderer has is left alone, dirty or not (a screen's page, a board mid-redraw), and so is one with no picture yet", () => {
  const up = map(7), dirty = map(9), empty = map(0), r = renderer({ seen: [up, dirty] });
  assert.deepEqual([...textures(r, root({ map: up, gradientMap: dirty, alphaMap: empty }))], []);
  assert.deepEqual(r.log, []);
});

// Idle callbacks to run by hand, and a frame to draw by hand.
const driver = (count = 3, options = {}) => {
  const idle = [], frames = new Set(), ran = [], steps = (function* () { for (let i = 0; i < count; i++) { ran.push(i); yield; } })();
  let up = true, stop = false;
  inSlices(frames, steps, { whenIdle: fn => idle.push(fn), stopped: () => stop, up: () => up, after: 3, ...options });
  return { idle, frames, ran, draw: () => { for (const frame of [...frames]) frame(); }, goIdle: async () => { await idle.shift()(); }, up: on => { up = on; }, stop: () => { stop = true; } };
};

test('nothing starts until the office is up and has drawn that many frames, and then once', () => {
  const d = driver();
  d.up(false);
  for (let i = 0; i < 9; i++) d.draw();
  assert.equal(d.idle.length, 0, "frames before it's up don't count");
  d.up(true);
  d.draw(); d.draw();
  assert.equal(d.idle.length, 0);
  d.draw();
  assert.equal(d.idle.length, 1);
  assert.equal(d.frames.size, 0, 'done with frames');
  d.draw();
  assert.equal(d.idle.length, 1);
  assert.deepEqual(d.ran, [], 'and even then not till idle');
});

test('one slice per idle callback, in order, and none after the last', async () => {
  const d = driver();
  for (let i = 0; i < 3; i++) d.draw();
  for (let i = 0; i < 3; i++) {
    await d.goIdle();
    assert.deepEqual(d.ran, [0, 1, 2].slice(0, i + 1));
    assert.equal(d.idle.length, 1, 'the next one asked for');
  }
  await d.goIdle();
  assert.equal(d.idle.length, 0);
});

test('what a slice yields is waited for before the next is asked for', async () => {
  let finish; const waiting = new Promise(resolve => { finish = resolve; }), idle = [], frames = new Set();
  inSlices(frames, (function* () { yield waiting; })(), { whenIdle: fn => idle.push(fn), stopped: () => false, up: () => true, after: 1 });
  for (const frame of frames) frame();
  const slice = idle.shift()();
  await Promise.resolve();
  assert.equal(idle.length, 0);
  finish(); await slice;
  assert.equal(idle.length, 1);
});

test('stopped between slices, no more runs, and nothing else is asked for', async () => {
  const d = driver();
  for (let i = 0; i < 3; i++) d.draw();
  await d.goIdle();
  d.stop();
  await d.goIdle();
  assert.deepEqual(d.ran, [0]);
  assert.equal(d.idle.length, 0);
});
