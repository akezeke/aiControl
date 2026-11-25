import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionNames, sessionSegments } from '../client/session-links.js';

const peer = (id, ...peerNames) => ({ id, peerNames });
const e4 = peer('e4', 'tankgame-e4'), c6 = peer('c6', 'tankgame-c6', 'shots-old'), ten = peer('10', 'tankgame-10'), sessions = [e4, c6, ten, { id: 'codex' }];
const split = (text, list = sessions) => sessionSegments(text, sessionNames(text, list)).map(({ text, session }) => session ? [text, session.id] : text);

test('a session named in text ends a segment, possessive and former names included', () => {
  assert.deepEqual(split("tankgame-e4's road edge is in, (tankgame-c6) waits."), [["tankgame-e4's", 'e4'], [' road edge is in, (tankgame-c6', 'c6'], ') waits.']);
  assert.deepEqual(split('Waiting for shots-old.'), [['Waiting for shots-old', 'c6'], '.']);
  assert.deepEqual(split('Nothing here.'), ['Nothing here.']);
});

test('short names count only beside a full one, and never as numbers', () => {
  assert.deepEqual(split('Waiting on tankgame-e4, -c6 and -10.'), [['Waiting on tankgame-e4', 'e4'], [', -c6', 'c6'], ' and -10.']);
  assert.deepEqual(split('Pass -c6 to it.'), ['Pass -c6 to it.']);
  assert.deepEqual(split('containers-b0 and -c6', [c6, peer('b0', 'containers-b0')]), [['containers-b0', 'b0'], ' and -c6']);
});

test('paths, longer names, plain words and shared names are left alone', () => {
  for (const text of ['/tmp/tankgame-e4', 'tankgame-e4/src', 'tankgame-e4.json', 'tankgame-e4-old', 'my-tankgame-e4', 'tankgame-e42']) assert.deepEqual(split(text), [text], text);
  assert.deepEqual(split('run the tests', [peer('t', 'tests'), peer('p', 'run the')]), ['run the tests']);
  assert.deepEqual(split('tankgame-e4 is idle', [e4, peer('other', 'tankgame-e4')]), ['tankgame-e4 is idle']);
});
