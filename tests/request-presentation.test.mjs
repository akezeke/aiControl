import test from 'node:test';
import assert from 'node:assert/strict';
import { requestPresentation } from '../client/request-presentation.js';
import { codexRequest } from '../server/codex.mjs';

test('Codex approval exposes the actual command, reason, folder and access without protocol IDs', () => {
  const request = codexRequest({ method: 'item/commandExecution/requestApproval', params: {
    threadId: 'thread', turnId: 'turn', itemId: 'item', reason: 'Install the project dependencies?', command: 'npm ci', cwd: '/repos/app',
    additionalPermissions: { network: { enabled: true }, fileSystem: { write: ['/repos/app/node_modules'], read: null } },
    networkApprovalContext: { host: 'registry.npmjs.org', protocol: 'https' },
  } });
  const view = requestPresentation(request.view);
  assert.equal(view.reason, 'Install the project dependencies?');
  assert.equal(view.command, 'npm ci');
  assert.deepEqual(view.fields, [
    { label: 'Working folder', value: '/repos/app' },
    { label: 'Network connection', value: { host: 'registry.npmjs.org', protocol: 'https' } },
    { label: 'Requested access', value: { network: { enabled: true }, fileSystem: { write: ['/repos/app/node_modules'], read: null } } },
  ]);
  assert.match(view.raw, /threadId/);
  assert.deepEqual(request.encode({ decision: 'decline' }), { decision: 'decline' });
});

test('file approvals retain affected paths, moves, diffs and the requested write root', () => {
  const item = { changes: [{ path: '/repos/app/old.js', kind: { type: 'update', move_path: '/repos/app/new.js' }, diff: '-old\n+new' }] };
  const request = codexRequest({ method: 'item/fileChange/requestApproval', params: { threadId: 't', itemId: 'i', grantRoot: '/repos/app' } }, new Map([['t:i', item]]));
  const view = requestPresentation(request.view);
  assert.deepEqual(view.files, [{ path: '/repos/app/old.js', kind: 'update', moveTo: '/repos/app/new.js', diff: '-old\n+new' }]);
  assert.deepEqual(view.fields, [{ label: 'Requested write root', value: '/repos/app' }]);
});

test('permission fields preserve unknown scopes and plain text remains readable', () => {
  const permissions = { fileSystem: { entries: [{ path: { special: 'tmpdir' }, access: 'write' }] }, futureAccess: { enabled: true } };
  const view = requestPresentation({ details: JSON.stringify({ permissions, futureScope: 'whole session' }) });
  assert.deepEqual(view.fields, [{ label: 'Requested access', value: permissions }, { label: 'Future Scope', value: 'whole session' }]);
  assert.equal(requestPresentation({ details: 'Please allow this action.' }).reason, 'Please allow this action.');
  assert.equal(requestPresentation({}).command, '');
  // These are data, never HTML or executable commands.
  assert.equal(requestPresentation({ details: JSON.stringify({ command: '<script>alert(1)</script>' }) }).command, '<script>alert(1)</script>');
});

test('Claude edits and writes are shown as diffs, not as raw fields', async () => {
  const { lineDiff } = await import('../client/request-presentation.js');
  assert.equal(lineDiff('a\nb\nc\nd', 'a\nb\nX\nd'), ' a\n b\n-c\n+X\n d');
  const edit = requestPresentation({ details: JSON.stringify({ file_path: '/w/a.js', old_string: 'one', new_string: 'two' }) });
  assert.deepEqual(edit.files, [{ path: '/w/a.js', kind: 'edit', diff: '-one\n+two' }]);
  assert.deepEqual(edit.fields, []);
  const write = requestPresentation({ details: JSON.stringify({ file_path: '/w/b.js', content: 'x\ny' }) });
  assert.equal(write.files[0].diff, '+x\n+y');
});
