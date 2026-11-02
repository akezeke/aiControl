import test from 'node:test';
import assert from 'node:assert/strict';
import { feedGroups, feedNow } from '../client/feed.js';

const message = (id, timestamp, extra = {}) => ({ id, role: 'assistant', text: id, timestamp, ...extra });
const tool = (id, timestamp) => message(id, timestamp, { tool: true });
const shape = groups => groups.map(group => [group.session.id, group.entries.map(entry => entry.shots ? entry.shots.map(image => image.id) : Array.isArray(entry) ? entry.map(m => m.id) : entry.id)]);

test('sessions interleave by time, back-to-back items share a group and tool calls and screenshots fold', () => {
  const a = { id: 'a', messages: [message('a1', 10), tool('at1', 11), tool('at2', 12), message('a2', 40)] };
  const b = { id: 'b', messages: [message('b1', 20), tool('bt1', 21), message('undated', null)] };
  const images = { a: [{ id: 's1', at: 13, tool: true }, { id: 's2', at: 14, tool: true }, { id: 'pasted', at: 15, tool: false }], b: [{ id: 'old', at: null }] };
  const groups = feedGroups([a, b], session => images[session.id]);
  assert.deepEqual(shape(groups), [['a', ['a1', ['at1', 'at2'], ['s1', 's2'], ['pasted']]], ['b', ['b1', ['bt1']]], ['a', ['a2']]]);
  assert.equal(groups[0].at, 15);
  assert.notEqual(groups[0].key, groups[2].key);
});

test('subagents and tool calls can be hidden, and only the newest items are kept', () => {
  const main = { id: 'm', messages: [message('m1', 1), tool('mt', 2), message('m2', 3)] };
  const child = { id: 'c', parentId: 'm', messages: [message('c1', 4)] };
  assert.deepEqual(shape(feedGroups([main, child], () => [], { subagents: false, tools: false })), [['m', ['m1', 'm2']]]);
  assert.deepEqual(shape(feedGroups([main, child], () => [], { limit: 2 })), [['m', ['m2']], ['c', ['c1']]]);
});

test('the top strip lists waiting, then working, then unseen finished sessions', () => {
  const sessions = [{ id: 'idle', status: 'idle' }, { id: 'done', status: 'idle' }, { id: 'work', status: 'working' }, { id: 'ask', status: 'question' }, { id: 'sub', status: 'working', parentId: 'work' }];
  assert.deepEqual(feedNow(sessions, { unread: session => session.id === 'done' }).map(s => s.id), ['ask', 'sub', 'work', 'done']);
  assert.deepEqual(feedNow(sessions, { subagents: false, unread: session => session.id === 'done' }).map(s => s.id), ['ask', 'work', 'done']);
});
