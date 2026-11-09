import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repositoryStatus, repositoryDiff, observedOverlaps } from '../server/repository.mjs';

const exec = promisify(execFile);
const git = (cwd, ...args) => exec('git', ['-c', 'core.fsmonitor=false', ...args], { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
async function fixture(t, commit = true) {
  const root = await mkdtemp(join(tmpdir(), 'aicontrol-repository-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, 'init', '-b', 'main');
  await git(root, 'config', 'user.name', 'Repository Test');
  await git(root, 'config', 'user.email', 'repository@example.invalid');
  if (commit) {
    await writeFile(join(root, 'tracked.txt'), 'original\n');
    await writeFile(join(root, 'rename.txt'), 'rename this\n');
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', 'fixture');
  }
  return root;
}

test('repository status combines staged, unstaged, renamed and untracked files from a nested cwd', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'sub'));
  await writeFile(join(root, 'tracked.txt'), 'staged\n');
  await git(root, 'add', 'tracked.txt');
  await writeFile(join(root, 'tracked.txt'), 'working\n');
  await git(root, 'mv', 'rename.txt', 'renamed.txt');
  await writeFile(join(root, 'untracked.txt'), 'new\nsecond\n');
  const before = await readFile(join(root, '.git', 'index'));
  const result = await repositoryStatus(join(root, 'sub'));
  assert.equal(result.available, true);
  assert.equal(result.root, root);
  assert.equal(result.branch, 'main');
  const files = Object.fromEntries(result.files.map(file => [file.path, file]));
  assert.deepEqual([files['tracked.txt'].status, files['tracked.txt'].added, files['tracked.txt'].removed], ['MM', 2, 2]);
  assert.equal(files['renamed.txt'].originalPath, 'rename.txt');
  assert.equal(files['untracked.txt'].status, '??');
  assert.equal(files['untracked.txt'].added, 2);
  assert.deepEqual(await readFile(join(root, '.git', 'index')), before);
  const diff = await repositoryDiff(root, 'tracked.txt');
  assert.equal(diff.available, true);
  assert.match(diff.text, /-original\n\+staged/);
  assert.match(diff.text, /-staged\n\+working/);
  assert.match((await repositoryDiff(root, 'renamed.txt')).text, /rename from rename.txt/);
});

test('unborn repositories and binary or large untracked files have bounded readable results', async t => {
  const root = await fixture(t, false);
  await writeFile(join(root, 'first.txt'), 'first\n');
  await git(root, 'add', 'first.txt');
  await writeFile(join(root, 'binary.dat'), Buffer.from([1, 0, 2, 3]));
  await writeFile(join(root, 'large.txt'), 'many lines\n'.repeat(100_000));
  const result = await repositoryStatus(root);
  assert.equal(result.branch, 'main');
  assert.equal(result.files.find(file => file.path === 'binary.dat').binary, true);
  assert.match((await repositoryDiff(root, 'first.txt')).text, /\+first/);
  const binary = await repositoryDiff(root, 'binary.dat');
  assert.equal(binary.binary, true);
  assert.equal(binary.text.includes('\0'), false);
  const large = await repositoryDiff(root, 'large.txt');
  assert.equal(large.available, true);
  assert.equal(large.truncated, true);
  assert.ok(Buffer.byteLength(large.text) <= 300_000);
});

test('diff rejects traversal, Git metadata, unchanged and ignored files, and symlink escapes', async t => {
  const root = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'aicontrol-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'secret.txt'), 'outside secret\n');
  await writeFile(join(root, '.gitignore'), 'ignored.txt\n');
  await writeFile(join(root, 'ignored.txt'), 'ignored secret\n');
  await symlink(join(outside, 'secret.txt'), join(root, 'escape.txt'));
  await symlink(outside, join(root, 'escape-dir'));
  for (const path of ['../secret.txt', join(outside, 'secret.txt'), '.git/config', 'tracked.txt', 'ignored.txt', 'escape.txt', 'escape-dir/secret.txt', ':(glob)**', 'x\0y']) {
    const result = await repositoryDiff(root, path);
    assert.equal(result.available, false, path);
    assert.equal(result.text, '', path);
    assert.equal(JSON.stringify(result).includes('outside secret'), false);
  }
});

test('literal filenames are not shell commands or Git pathspecs and inspection disables executable Git helpers', async t => {
  const root = await fixture(t);
  const name = ':(glob)$(touch marker).txt';
  await writeFile(join(root, name), 'literal\n');
  await writeFile(join(root, '.gitattributes'), '*.txt diff=hostile\n');
  await writeFile(join(root, 'tracked.txt'), 'changed\n');
  await git(root, 'config', 'diff.hostile.textconv', 'touch marker');
  await git(root, 'config', 'diff.external', 'touch marker');
  await git(root, 'config', 'core.fsmonitor', 'touch marker');
  const diff = await repositoryDiff(root, name);
  assert.equal(diff.available, true);
  assert.match(diff.text, /\+literal/);
  assert.match((await repositoryDiff(root, 'tracked.txt')).text, /\+changed/);
  await assert.rejects(readFile(join(root, 'marker')), { code: 'ENOENT' });
});

test('missing and nonrepository directories return unavailable without throwing', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aicontrol-no-repository-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const cwd of [root, join(root, 'missing'), '', null]) {
    assert.equal((await repositoryStatus(cwd)).available, false);
    assert.equal((await repositoryDiff(cwd, 'file.txt')).available, false);
  }
});

test('repository inspection does not invoke configured content filters', async t => {
  const root = await fixture(t);
  await writeFile(join(root, '.gitattributes'), '*.txt filter=hostile\n');
  await writeFile(join(root, 'tracked.txt'), 'changed content\n');
  await git(root, 'config', 'filter.hostile.clean', 'touch filter-marker; cat');
  const result = await repositoryDiff(root, 'tracked.txt');
  assert.equal(result.available, true);
  assert.match(result.text, /\+changed content/);
  await assert.rejects(readFile(join(root, 'filter-marker')), { code: 'ENOENT' });
});

test('overlaps use only recent confirmed edit paths within a shared repository', () => {
  const now = 2_000_000, edit = (path, extra = {}) => ({ tool: true, editPaths: [path], timestamp: now - 1000, ...extra });
  const sessions = [
    { id: 'a', cwd: '/work/project', messages: [edit('src/main.js'), edit('src/main.js'), { tool: true, text: 'Edit · src/inferred.js', timestamp: now }] },
    { id: 'b', cwd: '/work/project/src', repositoryRoot: '/work/project', messages: [edit('main.js'), edit('../outside.js'), edit('/outside/private.js')] },
    { id: 'c', cwd: '/work/project', messages: [edit('src/main.js', { failed: true }), edit('src/main.js', { timestamp: now - 31 * 60_000 }), edit('src/main.js', { timestamp: null }), edit('src/main.js', { timestamp: now + 100_000 })] },
    { id: 'd', cwd: '/work/other', messages: [edit('src/main.js')] },
    { id: 'e', cwd: '/work/project', messages: [{ text: 'Edit · src/main.js', timestamp: now }] },
  ];
  assert.deepEqual(observedOverlaps(sessions, now), [{ repo: '/work/project', cwd: '/work/project', path: 'src/main.js', sessionIds: ['a', 'b'] }]);
});
