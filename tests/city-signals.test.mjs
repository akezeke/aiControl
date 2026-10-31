import test from 'node:test';
import assert from 'node:assert/strict';
import { citySignal, Lifecycle, RISE_MS, PUFF_MS, STEP_MS } from '../client/city/signals.js';
import { glyph } from '../client/city/glyphs.js';
import { officeStatus } from '../client/office/status.js';

const sig = (session, opts) => citySignal({ id: 's', ...session }, { now: 1000, ...opts });
test('working lights the windows with a twinkle', () => { const g = sig({ status: 'working' }); assert.equal(g.windows, 'lit'); assert.equal(g.twinkle, true); assert.equal(g.beacon, false); });
test('thinking does too', () => { const g = sig({ status: 'working', activity: 'thinking' }); assert.equal(g.windows, 'lit'); assert.equal(g.twinkle, true); });
test('compacting raises dust', () => assert.equal(sig({ status: 'working', activity: 'compacting' }).dust, true));
for (const status of ['permission', 'question']) test(`${status} shows the beacon and a highlighted bubble`, () => { const g = sig({ status }); assert.equal(g.beacon, true); assert.equal(g.bubble.highlight, true); });
test('waiting on a background job dims the windows', () => { const g = sig({ status: 'idle', waitingOn: 'tests' }); assert.equal(g.windows, 'dim'); assert.equal(g.twinkle, false); });
test('idle is dark', () => { const g = sig({ status: 'idle' }); assert.equal(g.windows, 'dark'); assert.equal(g.beacon, false); });
test('an error smokes and speaks', () => { const g = sig({ status: 'error', detail: 'boom' }); assert.equal(g.smoke, true); assert.equal(g.bubble.text, 'boom'); });
test('connection lost: dark everywhere, nothing else changes', () => { const g = sig({ status: 'working' }, { connected: false }); assert.equal(g.windows, 'dark'); assert.equal(g.twinkle, false); });
test('a beacon survives connection loss', () => assert.equal(sig({ status: 'permission' }, { connected: false }).beacon, true));
test('helpers only speak when working or waiting on you', () => { assert.equal(sig({ status: 'idle', parentId: 'p' }).bubble, null); assert.ok(sig({ status: 'permission', parentId: 'p' }).bubble); });

const planOf = (...ids) => ({ buildings: ids.map(id => ({ id, storeys: 8, subagents: [], overflow: 0 })) });
test('the first update plays nothing; a newcomer rises with a crane for about a second', () => {
  const life = new Lifecycle(); life.update(planOf('a'), new Map(), 0);
  assert.equal(life.stage('a', 0, false).rising, false);
  life.update(planOf('a', 'b'), new Map(), 100);
  const mid = life.stage('b', 600, false); assert.equal(mid.crane, true); assert.ok(mid.storeys < 8);
  const end = life.stage('b', 100 + RISE_MS, false); assert.equal(end.crane, false); assert.equal(end.storeys, 8);
});
test('compaction drops the storeys one step at a time, or at once with reduced motion', () => {
  const life = new Lifecycle(), a = n => ({ buildings: [{ id: 'a', storeys: n, subagents: [], overflow: 0 }] });
  life.update(a(8), new Map(), 0); life.update(a(6), new Map(), 1000);
  assert.equal(life.stage('a', 1000 + STEP_MS, false).storeys, 7); assert.equal(life.stage('a', 1000 + 2 * STEP_MS, false).storeys, 6);
  assert.equal(life.stage('a', 1000, true).storeys, 6);
});
test('an ended building goes dark, puffs, then the lot is empty', () => {
  const life = new Lifecycle(); life.update(planOf('a'), new Map(), 0);
  life.update({ buildings: [{ id: 'a', storeys: 8, vacantSince: 1000, subagents: [], overflow: 0 }] }, new Map(), 1000);
  assert.equal(life.stage('a', 1100, false).gone, false);
  life.update(planOf(), new Map(), 2000);
  assert.equal(life.stage('a', 2100, false).puff, true); assert.equal(life.stage('a', 2000 + PUFF_MS, false).gone, true);
});
test('a fired building comes down at once, even while still listed', () => {
  const life = new Lifecycle(); life.update(planOf('a'), new Map(), 0); life.update(planOf('a'), new Map([['a', 500]]), 500);
  assert.equal(life.stage('a', 600, false).puff, true); assert.equal(life.stage('a', 500 + PUFF_MS, false).gone, true);
});
test('a leaving subagent sinks', () => {
  const life = new Lifecycle(), p = leaving => ({ buildings: [{ id: 'a', storeys: 8, overflow: 0, subagents: [{ id: 'k', storeys: 3, leaving }] }] });
  life.update(p(false), new Map(), 0); life.update(p(true), new Map(), 100); assert.equal(life.stage('k', 200, false).sinking, true);
});
test('reduced motion skips the rise', () => { const life = new Lifecycle(); life.update(planOf(), new Map(), 0); life.update(planOf('b'), new Map(), 100); const q = life.stage('b', 100, true); assert.equal(q.crane, false); assert.equal(q.storeys, 8); });
test('every icon officeStatus emits has a glyph, and an unknown emoji has none', () => {
  const statuses = [{ status: 'working' }, { status: 'working', activity: 'thinking' }, { status: 'working', activity: 'compacting' }, { status: 'permission' }, { status: 'question' }, { status: 'idle' }, { status: 'idle', waitingOn: 'x' }, { status: 'error' }];
  for (const details of [undefined, 'Bash npm test', 'Read a.js', 'Edit a.js', 'Grep x', 'WebFetch u', 'Task x']) for (const s of statuses) { const icon = officeStatus({ id: 'a', ...s, detail: details }, 0).bubble?.icon; if (icon) assert.ok(glyph(icon), icon); }
  assert.equal(glyph('🦄'), null);
});

test('a leaving subagent loses a storey each step until nothing is left', () => {
  const life = new Lifecycle(), p = leaving => ({ buildings: [{ id: 'a', storeys: 8, overflow: 0, subagents: [{ id: 'k', storeys: 3, leaving }] }] });
  life.update(p(false), new Map(), 0); life.update(p(true), new Map(), 1000);
  assert.equal(life.stage('k', 1000, false).storeys, 3);
  assert.equal(life.stage('k', 1000 + STEP_MS, false).storeys, 2);
  assert.equal(life.stage('k', 1000 + 3 * STEP_MS, false).storeys, 0);
  assert.equal(life.stage('k', 1000 + 30 * STEP_MS, false).storeys, 0);
});
