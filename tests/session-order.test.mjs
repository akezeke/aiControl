import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionActivity, compareSessions, compareProjects, recentlyActive, activeSessionGroups } from '../client/session-order.js';

const session = (id, status, updatedAt) => ({ id, status, updatedAt });
const ids = sessions => sessions.toSorted(compareSessions).map(session => session.id);
const storage = () => ({ value: null, getItem() { return this.value; }, setItem(_key, value) { this.value = value; } });

test('active subagents bring their idle ancestors and remain directly underneath them', () => {
  const parent = { id: 'parent', status: 'idle', inactiveSince: 1 }, other = { id: 'other', status: 'working', statusSince: 30 };
  const middle = { id: 'middle', parentId: 'parent', status: 'idle' }, child = { id: 'child', parentId: 'middle', status: 'permission', statusSince: 10 };
  const unrelated = { id: 'unrelated', status: 'idle' };
  const groups = activeSessionGroups([parent, child, unrelated, middle, other], [child, other]);
  assert.deepEqual(groups.map(([key, list]) => [key, list.map(s => s.id)]), [['', ['parent', 'middle', 'child', 'other']]]);
  assert.equal(groups[0][1][0], parent, 'ancestor keeps its actual idle status');
});
test('a family appears once in Active even when one child is recently active and another still runs', () => {
  const all = [{ id: 'p', status: 'idle', inactiveSince: 10 }, { id: 'r', parentId: 'p', status: 'idle', inactiveSince: 90 }, { id: 'w', parentId: 'p', status: 'working', statusSince: 50 }, { id: 'recent', status: 'idle', inactiveSince: 100 }];
  assert.deepEqual(activeSessionGroups(all, all).map(([key, list]) => [key, list.map(s => s.id)]), [['', ['p', 'w', 'r']], ['recent', ['recent']]]);
  assert.deepEqual(activeSessionGroups(all, [all[1]]).map(([key, list]) => [key, list.map(s => s.id)]), [['recent', ['p', 'r']]]);
});
test('missing parents and malformed ancestry cannot hide an active agent or recurse forever', () => {
  const all = [{ id: 'orphan', parentId: 'absent', status: 'working' }, { id: 'a', parentId: 'b', status: 'working' }, { id: 'b', parentId: 'a', status: 'idle' }];
  const ids = activeSessionGroups(all, [all[0], all[1]]).flatMap(([, list]) => list.map(s => s.id));
  assert.equal(ids.length, 3);
  assert.deepEqual(new Set(ids), new Set(['orphan', 'a', 'b']));
  assert.deepEqual(activeSessionGroups(all, []), []);
});

test('input, working and idle have explicit priority, with newest activity first and stable ties', () => {
  const activity = new SessionActivity({ storage: storage() });
  const input = [session('idle-new', 'idle', 900), session('working-old', 'working', 100), session('permission', 'permission', 10), session('question', 'question', 20), session('working-new', 'working', 200), session('idle-old', 'idle', 300), session('offline', 'offline', 1000)];
  assert.deepEqual(ids(activity.observe(input)), ['question', 'permission', 'working-new', 'working-old', 'idle-new', 'idle-old', 'offline']);
  const tied = [session('b', 'idle', null), session('a', 'idle', NaN)];
  assert.deepEqual(ids(activity.observe(tied)), ['a', 'b']);
  assert.deepEqual(ids(activity.observe(tied.toReversed())), ['a', 'b']);
});

test('older or missing timestamps cannot move a session back on the next poll', () => {
  let now = 1000;
  const activity = new SessionActivity({ storage: storage(), now: () => now });
  activity.observe([session('a', 'working', 900), session('b', 'working', 700)]);
  now = 2000;
  const next = activity.observe([session('b', 'working', 700), session('a', 'working', 10)]);
  assert.deepEqual(ids(next), ['a', 'b']);
  assert.equal(next[1].lastActivityAt, 900);
  now = 3000;
  assert.equal(activity.observe([session('a', 'working')])[0].lastActivityAt, 900);
});

test('a session finishing work becomes the most recent idle session without jumping on later polls', () => {
  let now = 1000;
  const activity = new SessionActivity({ storage: storage(), now: () => now });
  activity.observe([session('finishing', 'working', 100), session('idle', 'idle', 900), session('busy', 'working', 500)]);
  now = 2000;
  const next = activity.observe([session('finishing', 'idle', 50), session('idle', 'idle', 900), session('busy', 'working', 500)]);
  assert.deepEqual(ids(next), ['busy', 'finishing', 'idle']);
  assert.equal(next[0].lastActivityAt, 2000);
  now = 3000;
  const repeated = activity.observe(next.toReversed());
  assert.deepEqual(ids(repeated), ['busy', 'finishing', 'idle']);
  assert.equal(repeated.find(s => s.id === 'finishing').lastActivityAt, 2000);
});

test('message/request times count as activity; a reconnect does not invent recent work', () => {
  const activity = new SessionActivity({ storage: storage(), now: () => 5000 });
  const [message, request] = activity.observe([
    { ...session('message', 'idle', 100), messages: [{ timestamp: 900 }] },
    { ...session('request', 'permission', 100), requests: [{ createdAt: 800 }] },
  ]);
  assert.equal(message.lastActivityAt, 900);
  assert.equal(request.lastActivityAt, 800);
  activity.observe([session('message', 'offline', 50)]);
  assert.equal(activity.observe([session('message', 'idle', 50)])[0].lastActivityAt, 900);
});

test('refresh remembers timestamps without mistaking an unseen status change for activity', () => {
  const cache = storage();
  const before = new SessionActivity({ storage: cache, now: () => 1000 });
  before.observe([{ ...session('a', 'working', 900), title: 'Private title', messages: [{ text: 'Private message' }] }]);
  assert.deepEqual(JSON.parse(cache.value), [['a', 900]]);
  const after = new SessionActivity({ storage: cache, now: () => 5000 });
  assert.equal(after.observe([session('a', 'idle', 50)])[0].lastActivityAt, 900);
  const unavailable = new SessionActivity({ storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } });
  assert.equal(unavailable.observe([session('a', 'idle', 900)])[0].lastActivityAt, 900);
});

test('projects use the same priority and retain recent completion times among idle projects', () => {
  let now = 1000;
  const activity = new SessionActivity({ storage: storage(), now: () => now });
  activity.observe([session('finishing', 'working', 10)]);
  now = 2000;
  const sessions = activity.observe([session('idle', 'idle', 900), session('busy', 'working', 100), session('ask', 'question', 50), session('finishing', 'idle', 10)]);
  const groups = sessions.map(session => [session.id, [session]]);
  assert.deepEqual(groups.toSorted(compareProjects).map(([name]) => name), ['ask', 'busy', 'finishing', 'idle']);
});

test('new activity inside a status never reorders; a status change does', () => {
  let now = 1000;
  const activity = new SessionActivity({ storage: storage(), now: () => now });
  activity.observe([session('a', 'working', 100), session('b', 'working', 200)]);
  now = 2000;
  assert.deepEqual(ids(activity.observe([session('a', 'working', 1900), session('b', 'working', 200)])), ['b', 'a']);
  now = 3000;
  assert.deepEqual(ids(activity.observe([session('a', 'question', 1900), session('b', 'working', 2500)])), ['a', 'b']);
});

test('recently active sessions expire one hour after stopping, even after polling and a reload', () => {
  let now = 10_000;
  const cache = storage(), activity = new SessionActivity({ storage: cache, now: () => now });
  activity.observe([session('a', 'working', 100)]);
  now = 20_000;
  const [finished] = activity.observe([session('a', 'idle', 100)]);
  assert.equal(recentlyActive(finished, now), true);
  now = 20_000 + 3_599_999;
  const [polled] = activity.observe([session('a', 'idle', now)]);
  assert.equal(recentlyActive(polled, now), true);
  const restored = new SessionActivity({ storage: cache, now: () => now });
  const [reloaded] = restored.observe([session('a', 'idle', now)]);
  assert.equal(recentlyActive(reloaded, now), true);
  now++;
  assert.equal(recentlyActive(reloaded, now), false);
  assert.equal(recentlyActive(restored.observe([session('a', 'idle', now)])[0], now), false);
});

test('working or waiting again clears the recent section and the next stop starts a fresh hour', () => {
  let now = 10_000;
  const activity = new SessionActivity({ storage: storage(), now: () => now });
  activity.observe([session('a', 'working', 100)]);
  now = 20_000;
  assert.equal(recentlyActive(activity.observe([session('a', 'idle', 100)])[0], now), true);
  for (const status of ['working', 'question', 'permission']) {
    now += 1000;
    assert.equal(recentlyActive(activity.observe([session('a', status, 100)])[0], now), false);
  }
  now = 3_999_000;
  activity.observe([session('a', 'working', now)]);
  now = 4_000_000;
  const [stopped] = activity.observe([session('a', 'error', 100)]);
  assert.equal(recentlyActive(stopped, now), true);
  now += 1000;
  const [offline] = activity.observe([session('a', 'offline', now)]);
  assert.equal(offline.inactiveSince, stopped.inactiveSince);
  assert.equal(recentlyActive(offline, 7_600_000), false);
});

test('first-seen idle sessions use available activity time, never the time the dashboard opens', () => {
  const now = 10_000_000, activity = new SessionActivity({ storage: storage(), now: () => now });
  const observed = activity.observe([
    session('recent', 'idle', now - 1000), session('old', 'idle', now - 3_600_000),
    session('missing', 'idle'), session('unknown', 'offline', now), session('working', 'working', now),
  ]);
  assert.deepEqual(observed.filter(s => recentlyActive(s, now)).map(s => s.id), ['recent']);
  const legacy = new SessionActivity({ storage: { getItem: () => JSON.stringify([['legacy', now - 2000]]) }, now: () => now });
  assert.equal(recentlyActive(legacy.observe([session('legacy', 'idle')])[0], now), true);
});

test('returning to a hidden dashboard does not give an old completion a fresh hour', () => {
  let now = 10_000;
  const activity = new SessionActivity({ storage: storage(), now: () => now });
  activity.observe([session('a', 'working', 100)]);
  now = 8_000_000;
  const [finished] = activity.observe([{ ...session('a', 'idle', now), messages: [{ role: 'assistant', timestamp: 20_000 }] }]);
  assert.equal(recentlyActive(finished, now), false);
});

test('metadata and user messages after suspended polling cannot make an old stop recent', () => {
  let now = 10_000;
  const activity = new SessionActivity({ storage: storage(), now: () => now });
  activity.observe([session('a', 'working', 100)]);
  now = 8_000_000;
  const [stopped] = activity.observe([{ ...session('a', 'idle', now), messages: [{ role: 'assistant', timestamp: 100 }, { role: 'user', timestamp: now }] }]);
  assert.equal(recentlyActive(stopped, now), false);
});

test('a new assistant reply can reveal an unseen turn without metadata updates extending retention', () => {
  let now = 10_000;
  const cache = storage(), activity = new SessionActivity({ storage: cache, now: () => now });
  activity.observe([{ ...session('a', 'idle', 100), messages: [{ role: 'assistant', timestamp: 100 }] }]);
  now = 8_000_000;
  const restored = new SessionActivity({ storage: cache, now: () => now });
  const reply = { role: 'assistant', timestamp: now - 1000 };
  const [finished] = restored.observe([{ ...session('a', 'idle', now), messages: [reply] }]);
  assert.equal(recentlyActive(finished, now), true);
  now += 3_599_000;
  const [polled] = restored.observe([{ ...session('a', 'idle', now), messages: [reply, { role: 'user', timestamp: now }] }]);
  assert.equal(recentlyActive(polled, now), false);
});
