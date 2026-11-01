import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { folderPath, folderState, agentFolder } from '../server/folders.mjs';
import { Auth, savePassword } from '../server/auth.mjs';
import { RequestStore } from '../server/requests.mjs';
import { createHandler } from '../server/http.mjs';

async function home(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-control-folders-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'src')); await writeFile(join(dir, 'notes.txt'), '');
  return dir;
}

test('a typed folder is absolute, with ~ expanded and trailing slashes gone', () => {
  assert.equal(folderPath(' ~/src/app/ ', '/home/me'), '/home/me/src/app');
  assert.equal(folderPath('~', '/home/me'), '/home/me');
  assert.equal(folderPath('/', '/home/me'), '/');
  assert.equal(folderPath('src/app', '/home/me'), null);
  assert.equal(folderPath('', '/home/me'), null);
  assert.equal(folderPath(42, '/home/me'), null);
});

test('a folder is there, can be made inside one that is, or neither', async t => {
  const dir = await home(t);
  assert.equal(folderState('~/src', dir), 'folder');
  assert.equal(folderState('~/src/app', dir), 'new');
  assert.equal(folderState('~/scr/app', dir), 'none');
  assert.equal(folderState('~/notes.txt', dir), 'none');
  assert.equal(folderState('~/notes.txt/app', dir), 'none');
  assert.equal(folderState('src/app', dir), 'none');
});

test('an agent starts in an existing folder, or a new one only when asked', async t => {
  const dir = await home(t);
  assert.equal(agentFolder('~/src/', { home: dir }), join(dir, 'src'));
  assert.throws(() => agentFolder('~/src/app', { home: dir }), { status: 404, message: 'No such folder.' });
  await assert.rejects(stat(join(dir, 'src', 'app')));
  assert.equal(agentFolder('~/src/app', { create: true, home: dir }), join(dir, 'src', 'app'));
  assert.ok((await stat(join(dir, 'src', 'app'))).isDirectory());
  assert.equal(agentFolder('~/src/app', { create: true, home: dir }), join(dir, 'src', 'app'));
  assert.throws(() => agentFolder('~/scr/app', { create: true, home: dir }), { status: 404 });
  assert.throws(() => agentFolder('~/notes.txt', { create: true, home: dir }), { status: 404 });
  await assert.rejects(stat(join(dir, 'scr')));
});

test('the folder check needs a login and passes the typed path through', async t => {
  const dir = await home(t), file = join(dir, 'auth.json'), password = 'correct horse testing battery', origin = 'https://control.test:47841', asked = [];
  await savePassword(file, password);
  const handler = createHandler({ auth: new Auth(file), origin, store: new RequestStore(), snapshot: () => ({}), vite: () => {}, folder: path => { asked.push(path); return folderState(path, dir); } });
  const request = async (path, { method = 'GET', headers = {}, body } = {}) => {
    const req = Readable.from(body ? [JSON.stringify(body)] : []);
    Object.assign(req, { url: path, method, headers: { host: 'control.test:47841', ...headers }, socket: { remoteAddress: '100.80.0.2' } });
    const res = { headers: {}, statusCode: 200, headersSent: false, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, end(raw) { this.raw = raw; this.headersSent = true; } };
    await handler(req, res); return { status: res.statusCode, body: res.raw && JSON.parse(res.raw), headers: res.headers };
  };
  assert.equal((await request('/api/folder?path=~/src/app')).status, 401);
  assert.deepEqual(asked, []);
  const login = await request('/api/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: { password } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  assert.deepEqual((await request(`/api/folder?path=${encodeURIComponent('~/src/app')}`, { headers: { cookie } })).body, { state: 'new' });
  assert.deepEqual((await request('/api/folder?path=%2Fnowhere%2Fat%2Fall', { headers: { cookie } })).body, { state: 'none' });
  assert.deepEqual((await request('/api/folder', { headers: { cookie } })).body, { state: 'none' });
  assert.deepEqual(asked, ['~/src/app', '/nowhere/at/all', '']);
});
