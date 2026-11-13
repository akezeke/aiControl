import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { Auth, savePassword, idleMs } from '../server/auth.mjs';
import { createHandler } from '../server/http.mjs';
import { Passkeys } from '../server/passkeys.mjs';

const origin = 'https://control.test:47841', password = '1234';
const sha = value => createHash('sha256').update(value).digest();
const b64 = value => Buffer.from(value).toString('base64url');

test('HTTP handlers with other auth adapters can serve routes without passkey storage', async () => {
  const handler = createHandler({ auth: { get: async () => ({ csrf: 'token' }) }, origin, snapshot: () => ({ sessions: [] }), vite: () => {} });
  const req = Object.assign(Readable.from([]), { url: '/api/snapshot', method: 'GET', headers: { host: 'control.test:47841' }, socket: {} });
  const res = { statusCode: 200, setHeader() {}, end(raw) { this.raw = raw; this.headersSent = true; } };
  await handler(req, res);
  assert.equal(res.statusCode, 200); assert.deepEqual(JSON.parse(res.raw), { sessions: [] });
});
// A small independent CBOR fixture encoder. Real WebAuthn verification handles these bytes.
function cbor(value) {
  const head = (major, length) => length < 24 ? Buffer.from([major * 32 + length]) : length < 256 ? Buffer.from([major * 32 + 24, length]) : Buffer.from([major * 32 + 25, length >> 8, length & 255]);
  if (Number.isInteger(value)) return head(value < 0 ? 1 : 0, value < 0 ? -1 - value : value);
  if (typeof value === 'string') { const bytes = Buffer.from(value); return Buffer.concat([head(3, bytes.length), bytes]); }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  return Buffer.concat([head(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)])]);
}
function authenticator() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' }), id = b64(randomBytes(32));
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  const clientData = (type, challenge, overrides) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false, ...overrides }));
  const authData = (rpID, flags, counter) => { const count = Buffer.alloc(4); count.writeUInt32BE(counter); return Buffer.concat([sha(rpID), Buffer.from([flags]), count]); };
  return {
    id,
    registration(options, { flags = 0x45, client = {} } = {}) {
      const credentialId = Buffer.from(id, 'base64url'), length = Buffer.alloc(2); length.writeUInt16BE(credentialId.length);
      const bytes = Buffer.concat([authData(options.rp.id, flags, 0), Buffer.alloc(16), length, credentialId, cose]);
      return { id, rawId: id, type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {}, response: {
        clientDataJSON: b64(clientData('webauthn.create', options.challenge, client)),
        attestationObject: b64(cbor(new Map([['fmt', 'none'], ['authData', bytes], ['attStmt', new Map()]]))), transports: ['internal'],
      } };
    },
    assertion(options, { flags = 5, counter = 1, client = {}, rpID = options.rpId, userHandle } = {}) {
      const bytes = authData(rpID, flags, counter), json = clientData('webauthn.get', options.challenge, client);
      return { id, rawId: id, type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {}, response: {
        clientDataJSON: b64(json), authenticatorData: b64(bytes), signature: b64(sign('sha256', Buffer.concat([bytes, sha(json)]), privateKey)), ...(userHandle ? { userHandle } : {}),
      } };
    },
  };
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-passkeys-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'auth.json'); await savePassword(file, password);
  let now = Date.now();
  const auth = new Auth(file, { now: () => now });
  const makeHandler = (instance = auth) => createHandler({ auth: instance, passkeys: new Passkeys(instance), origin: [origin, 'http://localhost:47841', 'http://100.80.0.1:47841'], snapshot: () => ({ sessions: [] }), vite: () => {} });
  const handler = makeHandler();
  const request = async (path, { method = 'GET', headers = {}, body, useHandler = handler } = {}) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    Object.assign(req, { url: path, method, headers: { host: 'control.test:47841', origin, 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'phone' } });
    const res = { headers: {}, statusCode: 200, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(raw) { this.raw = raw; this.headersSent = true; } };
    await useHandler(req, res); return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.raw) };
  };
  const login = await request('/api/login', { method: 'POST', body: { password } });
  const headers = { cookie: login.headers['set-cookie'].split(';')[0], 'x-csrf-token': login.body.csrf };
  const post = (path, body, extra = {}) => request(path, { method: 'POST', headers: { ...headers, ...extra }, body });
  const enroll = async (device = authenticator(), overrides) => {
    const start = await post('/api/passkeys/register/options', { password });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    const done = await post('/api/passkeys/register/verify', { challengeId: start.body.challengeId, response: device.registration(start.body.options, overrides) });
    assert.equal(done.status, 200, JSON.stringify(done.body)); return device;
  };
  const begin = async () => {
    const start = await request('/api/passkeys/login/options', { method: 'POST', body: {} });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    return { options: start.body.options, cookie: start.headers['set-cookie'].split(';')[0] };
  };
  const finish = (flow, response, overrides = {}) => request('/api/passkeys/login/verify', { method: 'POST', headers: { cookie: flow.cookie, ...overrides }, body: { response } });
  return { dir, file, auth, request, headers, post, enroll, begin, finish, makeHandler, advance: ms => { now += ms; } };
}

test('a registered passkey survives restart and opens a normal idle-expiring session', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.request('/api/auth')).body.passkeys, { supported: true, enabled: false });
  const device = await f.enroll();
  const file = join(f.dir, 'passkeys.json');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await readFile(file, 'utf8')).includes('privateKey'), false);
  const list = await f.request('/api/passkeys', { headers: f.headers });
  assert.equal(list.body.passkeys.length, 1); assert.equal(list.body.passkeys[0].id, device.id);
  assert.equal(list.body.passkeys[0].publicKey, undefined);
  const restored = f.makeHandler(new Auth(f.file));
  assert.equal((await f.request('/api/auth', { useHandler: restored })).body.passkeys.enabled, true);
  const flow = await f.begin(), response = device.assertion(flow.options);
  const login = await f.finish(flow, response);
  assert.equal(login.status, 200, JSON.stringify(login.body)); assert.ok(login.body.csrf);
  assert.match(login.headers['set-cookie'][0], /HttpOnly; SameSite=Strict.*Secure/);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  assert.equal((await f.request('/api/snapshot', { headers: { cookie } })).status, 200);
  f.advance(idleMs);
  assert.equal((await f.request('/api/snapshot', { headers: { cookie } })).status, 401);
});

test('enrollment requires PIN, session, origin, CSRF and verified user presence', async t => {
  const f = await fixture(t), path = '/api/passkeys/register/options';
  assert.equal((await f.request(path, { method: 'POST', body: { password } })).status, 401);
  assert.equal((await f.post(path, { password }, { 'x-csrf-token': 'wrong' })).status, 403);
  assert.equal((await f.post(path, { password }, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await f.post(path, { password: 'wrong' })).status, 400);
  const start = await f.post(path, { password }); assert.equal(start.status, 200);
  const device = authenticator(), bad = device.registration(start.body.options, { flags: 0x41 });
  assert.equal((await f.post('/api/passkeys/register/verify', { challengeId: start.body.challengeId, response: bad })).status, 400);
  assert.equal((await f.request('/api/passkeys', { headers: f.headers })).body.passkeys.length, 0);
  const retry = await f.post(path, { password });
  const anotherLogin = await f.request('/api/login', { method: 'POST', body: { password } });
  const other = { cookie: anotherLogin.headers['set-cookie'].split(';')[0], 'x-csrf-token': anotherLogin.body.csrf };
  assert.equal((await f.request('/api/passkeys/register/verify', { method: 'POST', headers: other, body: { challengeId: retry.body.challengeId, response: device.registration(retry.body.options) } })).status, 400);
});

test('passkey login rejects forged signatures, wrong origin/RP, user handle and missing verification', async t => {
  const f = await fixture(t), device = await f.enroll();
  const attacks = [
    options => { const data = device.assertion(options); data.response.signature = b64(randomBytes(72)); return data; },
    options => device.assertion(options, { client: { origin: 'https://evil.test' } }),
    options => device.assertion(options, { client: { challenge: b64(randomBytes(32)) } }),
    options => device.assertion(options, { rpID: 'evil.test' }),
    options => device.assertion(options, { flags: 1 }),
    options => device.assertion(options, { flags: 4 }),
    options => device.assertion(options, { userHandle: b64(randomBytes(32)) }),
  ];
  for (const attack of attacks) {
    const flow = await f.begin(), result = await f.finish(flow, attack(flow.options));
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.equal(result.body.authenticated, undefined);
  }
  assert.equal((await f.request('/api/snapshot')).status, 401);
  const flow = await f.begin(); assert.equal((await f.finish(flow, device.assertion(flow.options))).status, 200);
});

test('challenges bind to the browser, expire, are single use and reject counter regression', async t => {
  const f = await fixture(t), device = await f.enroll();
  const first = await f.begin(), second = await f.begin(), assertion = device.assertion(first.options);
  assert.equal((await f.finish(second, assertion)).status, 400);
  assert.equal((await f.finish(first, assertion, { cookie: '' })).status, 400);
  assert.equal((await f.finish(first, assertion)).status, 200);
  assert.equal((await f.finish(first, assertion)).status, 400);
  const regression = await f.begin();
  assert.equal((await f.finish(regression, device.assertion(regression.options, { counter: 1 }))).status, 400);
  const expired = await f.begin(); f.advance(5 * 60_000 + 1);
  assert.equal((await f.finish(expired, device.assertion(expired.options, { counter: 2 }))).status, 400);
});

test('synced passkeys with zero counters remain usable across repeated unlocks', async t => {
  const f = await fixture(t), device = await f.enroll(authenticator(), { flags: 0x5d });
  for (let i = 0; i < 2; i++) {
    const flow = await f.begin();
    assert.equal((await f.finish(flow, device.assertion(flow.options, { flags: 0x1d, counter: 0 }))).status, 200);
  }
});

test('concurrent enrollments preserve both credentials and their separate sign counters', async t => {
  const f = await fixture(t), devices = [authenticator(), authenticator()];
  const starts = await Promise.all(devices.map(() => f.post('/api/passkeys/register/options', { password })));
  assert.equal(starts[0].body.options.user.id, starts[1].body.options.user.id);
  const registered = await Promise.all(devices.map((device, index) => f.post('/api/passkeys/register/verify', {
    challengeId: starts[index].body.challengeId, response: device.registration(starts[index].body.options),
  })));
  assert.deepEqual(registered.map(value => value.status), [200, 200]);
  const flows = await Promise.all(devices.map(() => f.begin()));
  const loggedIn = await Promise.all(devices.map((device, index) => f.finish(flows[index], device.assertion(flows[index].options))));
  assert.deepEqual(loggedIn.map(value => value.status), [200, 200]);
  const saved = JSON.parse(await readFile(join(f.dir, 'passkeys.json'), 'utf8'));
  assert.deepEqual(saved.passkeys.map(key => key.counter), [1, 1]);
  assert.deepEqual(new Set((await f.request('/api/passkeys', { headers: f.headers })).body.passkeys.map(key => key.id)), new Set(devices.map(device => device.id)));
});

test('password changes, including CLI changes, revoke saved passkeys and pending ceremonies', async t => {
  const f = await fixture(t), device = await f.enroll(), flow = await f.begin();
  const pending = await f.post('/api/passkeys/register/options', { password });
  await savePassword(f.file, '5678');
  assert.equal((await f.finish(flow, device.assertion(flow.options))).status, 400);
  assert.equal((await f.request('/api/auth')).body.passkeys.enabled, false);
  assert.equal((await f.post('/api/passkeys/register/verify', { challengeId: pending.body.challengeId, response: device.registration(pending.body.options) })).status, 401);
  const login = await f.request('/api/login', { method: 'POST', body: { password: '5678' } });
  const headers = { cookie: login.headers['set-cookie'].split(';')[0], 'x-csrf-token': login.body.csrf };
  assert.deepEqual((await f.request('/api/passkeys', { headers })).body.passkeys, []);
});

test('removal requires the PIN and revokes pending logins without affecting another passkey', async t => {
  const f = await fixture(t), device = await f.enroll(), second = await f.enroll(), flow = await f.begin();
  assert.equal((await f.post('/api/passkeys/remove', { id: device.id, password: 'wrong' })).status, 400);
  assert.equal((await f.post('/api/passkeys/remove', { id: device.id, password }, { 'x-csrf-token': 'wrong' })).status, 403);
  assert.equal((await f.post('/api/passkeys/remove', { id: device.id, password })).status, 200);
  assert.equal((await f.finish(flow, device.assertion(flow.options))).status, 400);
  const other = await f.begin(); assert.equal((await f.finish(other, second.assertion(other.options))).status, 200);
});

test('passkeys are unavailable on plain remote HTTP and IP addresses, and login requests are bounded', async t => {
  const f = await fixture(t);
  const status = await f.request('/api/auth', { headers: { host: '100.80.0.1:47841' } });
  assert.deepEqual(status.body.passkeys, { supported: false, enabled: false });
  assert.equal((await f.request('/api/passkeys/login/options', { method: 'POST', headers: { host: '100.80.0.1:47841', origin: 'http://100.80.0.1:47841' }, body: {} })).status, 400);
  await f.enroll();
  for (let i = 0; i < 30; i++) assert.equal((await f.request('/api/passkeys/login/options', { method: 'POST', body: {} })).status, 200);
  assert.equal((await f.request('/api/passkeys/login/options', { method: 'POST', body: {} })).status, 429);
  assert.equal((await f.request('/api/login', { method: 'POST', body: { password } })).status, 200);
});
