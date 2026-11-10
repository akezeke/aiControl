import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { hubState, startHub } from '../server/hub.mjs';
import { createOfficeOnline, liveUpgrade } from '../server/office-online.mjs';
import { createHandler } from '../server/http.mjs';
import { COLOURS, PROTOCOL, meetingFloor } from '../client/office/meeting.js';
import { identity } from '../client/office/status.js';
import { layoutOffice } from '../client/office/layout.js';

const dir = () => mkdtempSync(join(tmpdir(), 'office-live-'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (ok, what = 'condition', ms = 3000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(10)) if (ok()) return;
  assert.fail(`timed out waiting for ${what}`);
};

// A page's socket as the server sees it: what the server sends lands in `got`, parsed; `say` is the page talking.
class Page extends EventEmitter {
  readyState = 1; got = [];
  send(text) { this.got.push(JSON.parse(text)); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  say(m) { this.emit('message', Buffer.from(typeof m === 'string' ? m : JSON.stringify(m)), false); }
  last(type) { return this.got.filter(m => m.type === type).at(-1); }
  all(type) { return this.got.filter(m => m.type === type); }
  // The latest roster's entry for a name.
  sees(name) { return this.last('roster')?.players.find(p => p.name === name); }
}
const open = online => { const page = new Page(); online.live(page); return page; };

// A real hub on a free port, counting the live connections it's asked for, and players joined to it. The host's AI Control
// reads the hub's own file (as on the hub's machine); everyone else has none.
async function setup(t, { hubNow } = {}) {
  const hubFile = join(dir(), 'hub.json');
  let hub = await startHub({ file: hubFile, port: 0, ...hubNow && { now: hubNow } }), upgrades = 0;
  const port = hub.server.address().port, count = () => upgrades++;
  hub.server.on('upgrade', count);
  const code = `http://127.0.0.1:${port}/${hubState(hubFile).key}`, players = [];
  t.after(async () => { for (const online of players) online.close(); await hub.close(); });
  const player = async (name, { host = false, file = join(dir(), 'office-online.json'), ...options } = {}) => {
    const online = createOfficeOnline({ file, ...host && { hubFile }, lingerMs: 150, retryMs: 50, ...options });
    await online.join({ code, name }); players.push(online);
    return online;
  };
  const restart = async () => { await hub.close(); hub = await startHub({ file: hubFile, port, ...hubNow && { now: hubNow } }); hub.server.on('upgrade', count); };
  return { code, player, restart, stop: () => hub.close(), upgrades: () => upgrades };
}

// A host's snapshot with a distinctive word in every field that must stay on the host's machine.
const session = (n, extra = {}) => ({
  id: `SENTINEL-id-${n}`, nativeId: `SENTINEL-native-${n}`, cwd: `/home/SENTINEL-${n}/proj`, project: `SENTINEL-PROJ-${n}`, title: `SENTINEL-${n} title`,
  provider: 'claude', account: 'SENTINEL-ACCOUNT', model: 'SENTINEL-MODEL', status: ['working', 'idle', 'permission'][n % 3],
  messages: [{ role: 'user', text: `SENTINEL-${n} secret`, timestamp: 1000 }], updatedAt: 1000, usage: 'SENTINEL-USAGE', ...extra,
});
function sentinelSnapshot(status = 'working') {
  const sessions = [session(0, { status }), session(1), session(2), session(3), session(4, { parentId: 'SENTINEL-id-0', status: 'working' })];
  const office = layoutOffice(sessions);
  for (const pod of office.pods) pod.name = 'SENTINEL-POD';
  return { sessions, office: { ...office, desks: [...office.desks.values()] }, usage: [{ label: 'SENTINEL-USAGE' }], machine: 'SENTINEL-MACHINE',
    location: 'SENTINEL-PLACE', claudeAccounts: ['SENTINEL-ACCOUNT'], lost: [{ title: 'SENTINEL-LOST' }] };
}

test("the host's floor reaches visitors only through meetingFloor", async t => {
  const s = await setup(t);
  const host = await s.player('Host', { host: true }), anna = await s.player('Anna'), bob = await s.player('Bob');
  assert.equal(host.hosting(), true); assert.equal(anna.hosting(), false);
  let snapshot = sentinelSnapshot();
  const hp = open(host), ap = open(anna), bp = open(bob);
  await until(() => [hp, ap, bp].every(p => p.last('welcome')), 'welcomes');
  hp.say({ type: 'where', at: 'home' });
  host.floor(() => snapshot);
  ap.say({ type: 'where', at: 'meeting' });
  await until(() => ap.last('floor')?.floor, "the host's floor");
  assert.deepEqual(ap.last('floor').floor, meetingFloor(snapshot));
  // The same floor isn't sent twice; a changed one is.
  host.floor(() => snapshot); host.floor(() => snapshot); await wait(100);
  assert.equal(ap.all('floor').length, 1);
  snapshot = sentinelSnapshot('idle'); host.floor(() => snapshot);
  await until(() => ap.all('floor').length === 2, 'the changed floor');
  // Presence and throws both ways, and Bob arriving later, still say nothing of the host's sessions.
  hp.say({ type: 'pos', x: 1, y: 0, z: 1, yaw: 0, pose: 'walking' });
  ap.say({ type: 'throw', kind: 'duck', pos: [1, 1, 1], vel: [1, 0, 0], spin: [0, 0, 0] });
  bp.say({ type: 'where', at: 'meeting' });
  await until(() => ap.last('pos') && hp.last('throw') && bp.last('floor'), 'presence, a throw and the floor');
  for (const page of [ap, bp]) assert.ok(!JSON.stringify(page.got).includes('SENTINEL'), JSON.stringify(page.got).slice(0, 200));
  // Only a host sends a floor: a visitor's tick has nothing to send.
  anna.floor(() => { throw new Error('a visitor never reads its snapshot for a floor'); });
});

test('hosting: connected with no page open, and at the meeting only while a page is', async t => {
  const s = await setup(t);
  const host = await s.player('Host', { host: true }), anna = await s.player('Anna');
  // Signing in opens no link by itself: `npm run hub` signs the host in from its own process, with the same token.
  await wait(100); assert.equal(s.upgrades(), 0);
  const ap = open(anna); await until(() => ap.last('welcome'), 'welcome');
  // main's 2 s tick: the first opens the link, the next sends the floor.
  host.floor(() => sentinelSnapshot());
  await until(() => ap.sees('Host')?.at === 'home', 'the host, at home');
  host.floor(() => sentinelSnapshot());
  ap.say({ type: 'where', at: 'meeting' });
  await until(() => ap.last('floor')?.floor, 'the floor with no host page open');
  const hp = open(host);
  await until(() => ap.sees('Host')?.at === 'meeting', 'the host at the meeting');
  hp.close();
  await until(() => ap.sees('Host')?.at === 'home', 'the host gone home');
  await wait(300);
  assert.ok(ap.sees('Host'), 'still connected after the last page went');
  assert.equal(s.upgrades(), 2);
});

test('pages come and go: one hub connection, the roster follows', async t => {
  const s = await setup(t);
  const anna = await s.player('Anna'), bob = await s.player('Bob');
  const bp = open(bob); await until(() => bp.last('welcome'), "Bob's welcome");
  const tabs = [open(anna), open(anna), open(anna)];
  await until(() => tabs.every(p => p.last('welcome') && p.last('roster')), 'every tab welcomed');
  assert.equal(new Set(tabs.map(p => p.last('welcome').id)).size, 1);
  assert.equal(s.upgrades(), 2);
  tabs[1].say({ type: 'where', at: 'meeting' });
  await until(() => bp.sees('Anna')?.at === 'meeting', 'Anna at the meeting');
  // The page that last said where it is speaks for you: the others' presence isn't sent.
  bp.say({ type: 'where', at: 'meeting' }); await until(() => bp.sees('Bob')?.at === 'meeting', 'Bob at the meeting');
  tabs[0].say({ type: 'pos', x: 9, y: 0, z: 9, yaw: 0, pose: 'standing' });
  tabs[1].say({ type: 'pos', x: 1, y: 0, z: 1, yaw: 0, pose: 'standing' });
  await until(() => bp.last('pos'), "Anna's presence");
  await wait(100); assert.deepEqual(bp.all('pos').map(m => m.x), [1]);
  // A quick reload keeps the connection; closing every tab drops Anna once the 5 s (here 150 ms) are up.
  for (const p of tabs) p.close();
  const reload = open(anna);
  await until(() => reload.last('welcome'), 'the reloaded tab welcomed');
  assert.equal(s.upgrades(), 2);
  reload.close();
  await until(() => !bp.sees('Anna'), 'Anna gone');
  const again = [open(anna), open(anna), open(anna)];
  await until(() => bp.sees('Anna') && again.every(p => p.last('welcome')), 'Anna back');
  assert.equal(s.upgrades(), 3);
  for (const p of [bp, ...tabs, reload, ...again]) for (const m of p.all('roster')) assert.equal(new Set(m.players.map(p => p.name)).size, m.players.length);
});

test("a page that opens later hears where everyone at the meeting last was, and nothing of who's left", async t => {
  const s = await setup(t);
  const anna = await s.player('Anna'), bob = await s.player('Bob');
  const ap = open(anna), bp = open(bob);
  await until(() => ap.last('welcome') && bp.last('welcome'), 'welcomes');
  for (const p of [ap, bp]) p.say({ type: 'where', at: 'meeting' });
  await until(() => bp.sees('Anna')?.at === 'meeting' && bp.sees('Bob')?.at === 'meeting', 'both at the meeting');
  ap.say({ type: 'pos', x: 1, y: 0, z: 1, yaw: 0, pose: 'walking', t: 100 });
  ap.say({ type: 'pos', x: 2, y: 0, z: 1, yaw: 0, pose: 'standing', t: 167 });
  await until(() => bp.last('pos')?.x === 2, "Anna's presence");
  const later = open(bob);
  await until(() => later.last('pos'), 'the last place, replayed');
  assert.deepEqual(later.all('pos'), [{ type: 'pos', id: ap.last('welcome').id, x: 2, y: 0, z: 1, yaw: 0, pose: 'standing', t: 167 }]);
  ap.say({ type: 'where', at: 'home' });
  await until(() => bp.sees('Anna')?.at === 'home', 'Anna home');
  const after = open(bob);
  await until(() => after.last('roster'), 'the roster'); await wait(50);
  assert.deepEqual(after.all('pos'), []);
});

test('a page at the meeting speaks for you over pages at home; a newer one at the meeting sends it home', async t => {
  const s = await setup(t);
  const host = await s.player('Host', { host: true }), anna = await s.player('Anna');
  const room = (width = 10) => ({ sessions: [], office: { pods: [], desks: [], room: { width, depth: 10 } } });
  const hp = open(host); hp.say({ type: 'where', at: 'home' }); host.floor(() => room());
  await until(() => hp.last('welcome'), "the host's welcome");
  host.floor(() => room());
  const phone = open(anna);
  phone.say({ type: 'where', at: 'home' }); phone.say({ type: 'where', at: 'meeting' });
  await until(() => phone.last('floor')?.floor && hp.sees('Anna')?.at === 'meeting', 'Anna visiting on her phone');
  // Her desktop's tab comes back (it was hidden): live.js says where: home on every connect.
  const desk = open(anna); desk.say({ type: 'where', at: 'home' });
  await wait(200);
  assert.equal(hp.sees('Anna').at, 'meeting');
  assert.ok(!phone.all('floor').some(m => m.floor === null), 'the phone keeps the floor');
  phone.say({ type: 'pos', x: 3, y: 0, z: 3, yaw: 0, pose: 'walking' });
  hp.say({ type: 'pos', x: 1, y: 0, z: 1, yaw: 0, pose: 'walking' }); host.floor(() => room(12));
  await until(() => hp.last('pos')?.x === 3 && phone.last('pos')?.x === 1 && phone.last('floor').floor?.room.width === 12, "the phone's presence out, and the host's pos and floor in");
  // The desktop goes through the door too: it speaks for her now, and the phone, no longer heard, walks home.
  desk.say({ type: 'where', at: 'meeting' });
  await until(() => desk.last('floor')?.floor && phone.last('floor').floor === null, 'the desktop at the meeting, the phone told the floor went');
  assert.equal(hp.sees('Anna').at, 'meeting');
});

test('a hub restart: pages hear it went, and the link comes back saying where you were', async t => {
  const s = await setup(t);
  const anna = await s.player('Anna'), bob = await s.player('Bob');
  const ap = open(anna), bp = open(bob);
  ap.say({ type: 'where', at: 'meeting' }); bp.say({ type: 'where', at: 'meeting' });
  await until(() => bp.sees('Anna')?.at === 'meeting', 'Anna at the meeting');
  await s.restart();
  await until(() => ap.last('roster')?.players.length === 0 && ap.last('floor')?.floor === null, 'an empty roster and no floor');
  await until(() => bp.sees('Anna')?.at === 'meeting' && bp.last('roster').players.length === 2, 'Anna back at the meeting', 5000);
});

// A hub that takes a join and answers each live message with `answer(ws, message)`. `lives`: every live connection it got.
// `pong: false`: it never answers a ping either.
async function fakeHub(t, answer, { pong = true } = {}) {
  const lives = [], server = createServer((req, res) => { req.resume(); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ day: '2026-11-09', players: [] })); });
  const wss = new WebSocketServer({ noServer: true, autoPong: pong });
  server.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, ws => { lives.push(ws); ws.on('message', data => answer(ws, JSON.parse(data))); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });
  return { code: `http://127.0.0.1:${server.address().port}/${'k'.repeat(22)}`, lives };
}
// One that answers hello, then never says anything again, not even a pong: a network that died without the connection noticing.
const quietHub = t => fakeHub(t, (ws, m) => { if (m.type === 'hello') ws.send(JSON.stringify({ type: 'welcome', id: 'me', colour: COLOURS[0], at: 'home' })); }, { pong: false });

test('a hub gone quiet is noticed: pages hear the room went, and the link comes back', async t => {
  const hub = await quietHub(t), anna = createOfficeOnline({ file: join(dir(), 'office-online.json'), retryMs: 50, beatMs: 50 });
  t.after(() => anna.close());
  await anna.join({ code: hub.code, name: 'Anna' });
  const page = open(anna);
  await until(() => page.last('welcome'), 'welcome');
  await until(() => page.last('roster')?.players.length === 0 && page.last('floor')?.floor === null && hub.lives.length === 2, 'the quiet link dropped and opened again');
  // A hub that answers its pings keeps the link.
  const s = await setup(t), bob = await s.player('Bob', { beatMs: 50 }), bp = open(bob);
  await until(() => bp.last('welcome'), "Bob's welcome");
  await wait(400);
  assert.equal(s.upgrades(), 1); assert.ok(bp.sees('Bob'));
});

test('the hub lost: the next sync asks it, rather than answering from the board kept', async t => {
  const s = await setup(t), anna = await s.player('Anna'), ap = open(anna);
  await until(() => ap.last('welcome'), 'welcome');
  assert.equal((await anna.sync({})).offline, undefined);
  await s.stop();
  await until(() => ap.last('roster')?.players.length === 0, 'the room gone');
  assert.equal((await anna.sync({})).offline, true);
});

test("a hub on another protocol: pages are told, the link doesn't keep knocking, and a page opening tries again", async t => {
  const hellos = [], hub = await fakeHub(t, (ws, m) => { hellos.push(m); ws.send(JSON.stringify({ type: 'refused', why: 'version' })); ws.close(4002); });
  const anna = createOfficeOnline({ file: join(dir(), 'office-online.json'), retryMs: 20 });
  t.after(() => anna.close());
  await anna.join({ code: hub.code, name: 'Anna' });
  const page = open(anna);
  await until(() => page.last('refused')?.why === 'version', 'the refusal');
  assert.equal(hellos[0].v, PROTOCOL);
  await wait(300);
  assert.equal(hub.lives.length, 1);
  assert.equal((await anna.sync({})).outdated, true);
  assert.equal(anna.status().outdated, undefined, "status is what you joined, not how the link's doing");
  const again = open(anna);
  await until(() => hub.lives.length === 2 && again.last('refused'), 'one more try for the new page');
  await wait(200); assert.equal(hub.lives.length, 2);
});

test("a page can't speak for another or send what checkUp drops", async t => {
  const s = await setup(t);
  const host = await s.player('Host', { host: true }), anna = await s.player('Anna');
  const hp = open(host), ap = open(anna);
  hp.say({ type: 'where', at: 'home' }); ap.say({ type: 'where', at: 'meeting' });
  await until(() => ap.sees('Host')?.at === 'meeting' && ap.sees('Anna')?.at === 'meeting', 'both at the meeting');
  const before = ap.sees('Host'), anyFloor = { room: { width: 77, depth: 8 }, door: { x: 5, z: 8 }, pods: [], desks: [] };
  hp.say({ type: 'hello', name: 'Mallory', fruit: before.fruit === 'kiwi' ? 'pear' : 'kiwi', colour: COLOURS[5] });
  hp.say({ type: 'floor', floor: anyFloor });
  hp.say({ type: 'roster', players: [] }); hp.say({ type: 'welcome', id: 'x', colour: COLOURS[0], at: 'home' });
  hp.say({ type: 'pos', x: 1e9, y: 0, z: 0, yaw: 0, pose: 'walking' });
  hp.say({ type: 'pos', x: 1, y: 0, z: 2, yaw: 0, pose: 'flying' });
  hp.say('{nope'); hp.emit('message', Buffer.from('{"type":"pos"}'), true);
  hp.say({ type: 'pos', id: ap.last('welcome').id, x: 1, y: 0, z: 2, yaw: 0, pose: 'walking' });
  await until(() => ap.last('pos'), 'the one good pos');
  await wait(150);
  assert.deepEqual(ap.all('pos'), [{ type: 'pos', id: hp.last('welcome').id, x: 1, y: 0, z: 2, yaw: 0, pose: 'walking' }]);
  assert.ok(ap.all('floor').every(m => m.floor?.room.width !== 77));
  assert.deepEqual(ap.last('roster').players.map(p => p.name).sort(), ['Anna', 'Host']);
  assert.deepEqual(ap.sees('Host'), before);
  // A flood from a page is cut at the server, so the hub never closes the link for it.
  for (let i = 0; i < 50; i++) hp.say({ type: 'pos', x: i % 100, y: 0, z: 0, yaw: 0, pose: 'walking' });
  await wait(300);
  assert.ok(ap.all('pos').length <= 21, `got ${ap.all('pos').length}`);
  assert.equal(s.upgrades(), 2);
});

test('liveUpgrade refuses a wrong path, host, origin or cookie', async t => {
  const origin = 'https://pc.tail.ts.net:47841', lived = [];
  const auth = { get: async req => req.headers.cookie === 'c=ok' ? { key: 'k' } : null };
  const upgrade = liveUpgrade({ auth, origins: [origin, 'http://127.0.0.1:47841'], hosts: ['pc.tail.ts.net:47841', '127.0.0.1:47841'], online: { live: ws => lived.push(ws) } });
  t.after(() => upgrade.close());
  const good = { url: '/api/office/live', method: 'GET', headers: { host: 'pc.tail.ts.net:47841', origin, cookie: 'c=ok' } };
  for (const req of [
    { ...good, url: '/api/office/other' }, { ...good, url: '/api/office/live/x' }, { ...good, url: '//' },
    { ...good, headers: { ...good.headers, host: 'evil.test' } }, { ...good, headers: { ...good.headers, origin: 'https://evil.test' } },
    { ...good, headers: { ...good.headers, origin: undefined } }, { ...good, headers: { ...good.headers, cookie: 'c=no' } },
    { ...good, headers: { ...good.headers, cookie: undefined } }, { ...good, headers: { ...good.headers, 'sec-fetch-site': 'cross-site' } },
  ]) {
    const socket = { destroyed: false, destroy() { this.destroyed = true; }, on() {} };
    await upgrade(req, socket, Buffer.alloc(0));
    assert.equal(socket.destroyed, true, JSON.stringify(req));
  }
  assert.equal(lived.length, 0);
});

test('liveUpgrade lets in the dashboard itself, and drops it when its session ends', async t => {
  let signedIn = true;
  const lived = [], auth = { get: async req => signedIn && req.headers.cookie === 'c=ok' ? { key: 'k' } : null };
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const upgrade = liveUpgrade({ auth, origins: [origin], hosts: [new URL(origin).host], online: { live: ws => lived.push(ws) }, beatMs: 50 });
  server.on('upgrade', upgrade);
  t.after(() => { upgrade.close(); server.close(); });
  const connect = headers => new Promise(resolve => {
    const ws = new WebSocket(`ws://${new URL(origin).host}/api/office/live`, { headers });
    ws.once('open', () => resolve(ws)); ws.once('error', () => resolve(null));
  });
  assert.equal(await connect({ origin: 'https://evil.test', cookie: 'c=ok' }), null);
  const ws = await connect({ origin, cookie: 'c=ok' });
  assert.ok(ws); await until(() => lived.length === 1, 'the page handed over');
  const closed = new Promise(resolve => ws.once('close', resolve));
  signedIn = false;
  await closed;
});

test('look persists and is validated', async t => {
  const s = await setup(t), file = join(dir(), 'office-online.json');
  const anna = await s.player('Anna', { file }), bob = await s.player('Bob');
  assert.deepEqual((await anna.sync({})).look, { fruit: identity('player:anna').fruit, colour: COLOURS[0] });
  for (const bad of [{ fruit: 'durian', colour: COLOURS[1] }, { fruit: 'kiwi', colour: '#123456' }, { fruit: 'kiwi' }, null, 'kiwi'])
    assert.throws(() => anna.look(bad), e => e.status === 400, JSON.stringify(bad));
  const bp = open(bob), ap = open(anna);
  await until(() => bp.sees('Anna'), 'Anna in the roster');
  assert.deepEqual(anna.look({ fruit: 'kiwi', colour: COLOURS[3] }).look, { fruit: 'kiwi', colour: COLOURS[3] });
  await until(() => bp.sees('Anna').fruit === 'kiwi' && bp.sees('Anna').colour === COLOURS[3], 'the new look in the roster');
  ap.say({ type: 'look', fruit: 'pear', colour: COLOURS[4] });
  await until(() => bp.sees('Anna').fruit === 'pear', 'a look from the page');
  assert.deepEqual([JSON.parse(readFileSync(file, 'utf8')).fruit, JSON.parse(readFileSync(file, 'utf8')).colour], ['pear', COLOURS[4]]);
  // A new link says hello in the saved look.
  ap.close(); await until(() => !bp.sees('Anna'), 'Anna gone');
  const back = open(anna);
  await until(() => back.last('welcome') && bp.sees('Anna')?.fruit === 'pear', 'Anna back as a pear');
  // Kept across a restart, leaving and joining again.
  await anna.leave();
  assert.deepEqual((await createOfficeOnline({ file }).join({ code: s.code, name: 'Anna' })).look, { fruit: 'pear', colour: COLOURS[4] });
  // POST /api/office/look: behind the session and CSRF, 400 (never 401) for a bad look, and it counts as activity.
  const touched = [], online = createOfficeOnline({ file });
  const handler = createHandler({ auth: { get: async () => ({ key: 'k', csrf: 'c' }), touch: session => touched.push(session) }, origin: 'https://control.test', online, snapshot: () => ({}), vite: () => {} });
  const post = async (body, headers = {}) => {
    const req = Object.assign(Readable.from([JSON.stringify(body)]), { url: '/api/office/look', method: 'POST', socket: {},
      headers: { host: 'control.test', origin: 'https://control.test', 'content-type': 'application/json', 'x-csrf-token': 'c', ...headers } });
    const res = { statusCode: 200, headersSent: false, setHeader() {}, end(raw) { this.raw = raw; this.headersSent = true; } };
    await handler(req, res); return { status: res.statusCode, body: JSON.parse(res.raw) };
  };
  assert.equal((await post({ fruit: 'lemon', colour: COLOURS[6] }, { 'x-csrf-token': 'bad' })).status, 403);
  assert.equal(touched.length, 0);
  assert.equal((await post({ fruit: 'durian', colour: COLOURS[6] })).status, 400);
  assert.equal((await post({ fruit: 'lemon', colour: COLOURS[6], pad: 'x'.repeat(5000) })).status, 413);
  const ok = await post({ fruit: 'lemon', colour: COLOURS[6] });
  assert.equal(ok.status, 200); assert.deepEqual(ok.body.look, { fruit: 'lemon', colour: COLOURS[6] });
  assert.equal(touched.length, 1);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).fruit, 'lemon');
});

test('the colour the hub gave you is saved, so your next sync asks for it', async t => {
  const s = await setup(t), file = join(dir(), 'office-online.json');
  const bob = await s.player('Bob'), bp = open(bob); await until(() => bp.last('welcome'), "Bob's welcome");
  const anna = await s.player('Anna', { file }), ap = open(anna); await until(() => ap.last('welcome'), "Anna's welcome");
  const given = ap.last('welcome').colour; assert.notEqual(given, bp.last('welcome').colour);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).colour, given);
  const r = await anna.sync({ darts: 1 }); assert.equal(r.refused, undefined); assert.equal(r.look.colour, given);
});
test('a look in a colour someone holds is refused, and your saved look goes back to the one you hold', async t => {
  const s = await setup(t), file = join(dir(), 'office-online.json');
  const anna = await s.player('Anna', { file }), bob = await s.player('Bob'), ap = open(anna), bp = open(bob);
  await until(() => ap.sees('Bob') && bp.sees('Anna'), 'both in');
  const mine = ap.sees('Anna').colour;
  ap.say({ type: 'look', fruit: 'pear', colour: ap.sees('Bob').colour });
  await until(() => ap.last('refused')?.why === 'colour', 'refused');
  await until(() => JSON.parse(readFileSync(file, 'utf8')).colour === mine, 'saved colour back');
});
test('removed by the host: signed out at once, the pages told, no reconnecting', async t => {
  const s = await setup(t);
  const host = await s.player('Host', { host: true }), anna = await s.player('Anna'), hp = open(host), ap = open(anna);
  await until(() => hp.sees('Anna'), 'Anna in');
  ap.say({ type: 'remove', name: 'Host' }); await wait(100); assert.ok(hp.sees('Host'), "a visitor's remove goes nowhere");
  hp.say({ type: 'remove', name: 'anna' });
  await until(() => ap.last('refused')?.why === 'removed', 'Anna told');
  const r = await anna.sync({}); assert.equal(r.joined, false); assert.equal(r.name, 'Anna'); assert.equal(r.out, 'removed');
  const n = s.upgrades(); await wait(300); assert.equal(s.upgrades(), n, 'no reconnect');
  await until(() => !hp.sees('Anna'), 'gone from the roster');
});
