import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionActivity, compareSessions, compareProjects } from '../client/session-order.js';

const session = (id, status, updatedAt) => ({ id, status, updatedAt });
const ids = sessions => sessions.toSorted(compareSessions).map(session => session.id);
const storage = () => ({ value: null, getItem() { return this.value; }, setItem(_key, value) { this.value = value; } });

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
