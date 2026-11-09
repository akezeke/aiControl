import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewStamp, needsReview, lastObservedActivity, quietSession, filterFeed, commandMatches, handoffText, DraftSync } from '../client/workflow-data.js';

test('reviewing a completion stays reviewed through polls but a new reply returns to review', () => {
  const session = { id: 'a', status: 'idle', updatedAt: 9000, messages: [{ role: 'assistant', timestamp: 3000, text: 'Done' }] };
  assert.equal(reviewStamp(session), 3000);
  assert.equal(needsReview(session, {}), true);
  assert.equal(needsReview(session, { reviewedThrough: 3000 }), false);
  assert.equal(needsReview({ ...session, updatedAt: 12000 }, { reviewedThrough: 3000 }), false);
  assert.equal(needsReview({ ...session, messages: [...session.messages, { role: 'assistant', timestamp: 4000, text: 'Next' }] }, { reviewedThrough: 3000 }), true);
  assert.equal(needsReview({ ...session, status: 'working' }, {}), false);
  assert.equal(needsReview({ ...session, parentId: 'parent' }, {}), false);
});

test('quiet indicator is based on actual messages rather than a fresh metadata poll', () => {
  const session = { status: 'working', updatedAt: 9999999, messages: [{ timestamp: 1000, tool: true }] };
  assert.equal(lastObservedActivity(session), 1000);
  assert.equal(quietSession(session, 2, 121001), true);
  assert.equal(quietSession(session, 2, 120000), false);
  assert.equal(quietSession({ ...session, status: 'idle' }, 2, 999999), false);
});

test('feed filters compose project, provider, session and reply/failure selection', () => {
  const sessions = [{ id: 'a', provider: 'codex', cwd: '/repo', status: 'idle', messages: [{ role: 'user', text: 'Do it' }, { role: 'assistant', text: 'Done' }, { tool: true, failed: true, text: 'exit 1' }] }, { id: 'b', provider: 'claude', cwd: '/else', messages: [] }];
  assert.deepEqual(filterFeed(sessions, { project: '/repo', provider: 'codex', session: 'a', kind: 'replies' })[0].messages.map(m => m.text), ['Done']);
  assert.deepEqual(filterFeed(sessions, { kind: 'errors' })[0].messages.map(m => m.text), ['exit 1']);
  assert.equal(filterFeed(sessions, { provider: 'opencode' }).length, 0);
});

test('command matching ignores case and matches each word across labels and keywords', () => {
  assert.equal(commandMatches({ label: 'New Claude session', keywords: 'project website' }, 'WEB claude'), true);
  assert.equal(commandMatches({ label: 'Open feed' }, 'model'), false);
});

test('handoff contains only selected material and remains a draft', () => {
  const text = handoffText({ title: 'Fix login', cwd: '/repo' }, [{ role: 'assistant', text: 'Cookie fixed.' }], [{ decision: 'accept', at: 'today' }], ['src/login.js']);
  assert.match(text, /Cookie fixed/); assert.match(text, /src\/login.js/); assert.match(text, /accept/);
  assert.doesNotMatch(text, /undefined/);
});

test('draft sync serializes saves and clearing cannot resurrect a sent message', async () => {
  let remote = { text: 'existing', revision: 1 }, release;
  const writes = [];
  const sync = new DraftSync(async (id, text, baseRevision) => {
    writes.push([id, text, baseRevision]);
    if (writes.length === 1) await new Promise(resolve => release = resolve);
    assert.equal(baseRevision, remote.revision);
    remote = { text, revision: remote.revision + 1 };
    return remote;
  });
  sync.adopt({ a: remote });
  sync.edit('a', 'typing');
  const saving = sync.flush('a');
  sync.adopt({ a: { text: 'existing', revision: 1 } });
  assert.equal(sync.get('a').text, 'typing');
  sync.edit('a', ''); release(); await saving;
  assert.deepEqual(writes, [['a', 'typing', 1], ['a', '', 2]]);
  assert.equal(remote.text, ''); assert.equal(sync.get('a').dirty, false);
});

test('draft conflicts preserve local text and separate sessions never share drafts', async () => {
  const sync = new DraftSync(async () => { throw new Error('Draft changed on another device'); });
  sync.adopt({ a: { text: 'one', revision: 1 }, b: { text: 'two', revision: 4 } });
  sync.edit('a', 'local'); await sync.flush('a');
  assert.equal(sync.get('a').text, 'local'); assert.match(sync.get('a').saveError, /another device/);
  assert.equal(sync.get('b').text, 'two');
});

test('a poll during send cannot replace the draft revision used to acknowledge that send', async () => {
  let remote = { text: 'new unsent text on another device', revision: 2 };
  const sync = new DraftSync(async (id, text, baseRevision) => {
    if (remote.revision !== baseRevision) throw new Error('Draft changed on another device');
    return remote = { text, revision: remote.revision + 1 };
  });
  sync.adopt({ a: { text: 'being sent', revision: 1 } });
  sync.get('a').busy = true;
  sync.adopt({ a: remote });
  assert.equal(sync.get('a').remoteRevision, 1);
  sync.edit('a', ''); await sync.flush('a');
  assert.equal(remote.text, 'new unsent text on another device');
  assert.equal(remote.revision, 2);
});
