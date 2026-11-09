import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createDemoServices } from '../scripts/demo.mjs';
import { createHandler } from '../server/http.mjs';

async function demo(t, options) {
  const services = await createDemoServices(options);
  t.after(() => services.close());
  return services;
}

test('demo workflow has isolated workspace, searchable retained history and shared repository fixtures', async t => {
  const first = await demo(t, { calm: true, withLost: true }), initial = first.snapshot();
  assert.ok(initial.workspace);
  assert.equal(initial.sessions.every(session => !session.requests.length), true);
  assert.equal(initial.lost.length, 2);
  assert.equal(initial.overlaps.some(overlap => overlap.sessionIds.length >= 2), true);
  const weather = initial.sessions.find(session => session.project === 'weather-station' && !session.parentId);
  const peer = initial.sessions.find(session => session.cwd === weather.cwd && session.id !== weather.id);
  const repository = await first.workflow.repository(weather.id);
  assert.equal(repository.available, true);
  assert.equal(repository.root, weather.cwd);
  assert.deepEqual(await first.workflow.repository(peer.id), repository);
  assert.match((await first.workflow.repository(weather.id, repository.files[0].path)).text, /^diff --git/m);
  assert.match((await first.workflow.repository(weather.id, 'docs/review.md')).text, /^--- \/dev\/null$/m);
  assert.equal((await first.workflow.repository(weather.id, '../../private')).available, false);
  const found = await first.workflow.history.search('humidity');
  assert.equal(found.results.some(result => !result.archived), true);
  const archived = found.results.find(result => result.archived);
  assert.ok(archived);
  assert.equal((await first.workflow.history.session(archived.sessionId)).readOnly, true);
  await first.workflow.patch({ section: 'sessions', key: weather.id, value: { alias: 'My weather', pinned: true } });
  assert.equal(first.snapshot().workspace.sessions[weather.id].alias, 'My weather');
  await first.messages.send(weather.id, { text: 'Demo continuity search marker', clientMessageId: 'demo-message' });
  assert.equal((await first.workflow.history.search('continuity search marker')).results[0].sessionId, weather.id);
  const second = await demo(t);
  assert.notEqual(second.snapshot().workspace.sessions[weather.id]?.alias, 'My weather');
  assert.ok(second.snapshot().sessions.some(session => session.requests.length));
  assert.deepEqual(second.snapshot().lost, []);
});

test('demo preset launches preserve provider settings and leave starting prompts as editable drafts', async t => {
  const services = await demo(t, { calm: true }), launches = [];
  for (const provider of ['claude', 'codex', 'opencode']) {
    const preset = { name: `${provider} review`, cwd: '/home/demo/code/recipe-api', provider, account: provider === 'claude' ? 'work' : '', model: `${provider}-demo-model`, effort: 'high', prompt: `Review the ${provider} change before editing.` };
    await services.workflow.patch({ section: 'presets', key: provider, value: preset });
    const launched = await services.spawn({ presetId: provider });
    assert.equal(launched.sessionId.startsWith(`${provider}:`), true);
    assert.equal(services.snapshot().workspace.drafts[launched.sessionId].text, preset.prompt);
    launches.push({ ...launched, preset });
  }
  await new Promise(resolve => setTimeout(resolve, 900));
  for (const launched of launches) {
    const session = services.snapshot().sessions.find(session => session.id === launched.sessionId);
    assert.ok(session);
    for (const field of ['provider', 'account', 'model', 'effort', 'cwd']) assert.equal(session[field], launched.preset[field]);
    assert.deepEqual(session.messages, [], 'the starting prompt is never sent automatically');
    const draft = services.snapshot().workspace.drafts[session.id];
    await services.workflow.patch({ section: 'drafts', key: session.id, value: { text: 'Adjusted prompt' }, baseRevision: draft.revision });
    assert.equal(services.snapshot().workspace.drafts[session.id].text, 'Adjusted prompt');
  }
  await assert.rejects(services.spawn({ presetId: 'missing' }), { status: 404 });
  await assert.rejects(services.spawn({ cwd: '/home/demo/code/recipe-api', provider: 'shell' }), { status: 400 });
  await assert.rejects(services.spawn({ cwd: '/home/demo/code/recipe-api', provider: 'toString' }), { status: 400 });
  await assert.rejects(services.spawn(null), { status: 400 });
});

test('demo handler exposes authenticated workflow routes and records new decisions', async t => {
  const services = await demo(t), origin = 'http://demo.test';
  const handler = createHandler({ ...services, origin, vite: () => {} });
  let cookie = '', csrf = '';
  const request = async (path, body) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    Object.assign(req, { url: `/api/${path}`, method: body === undefined ? 'GET' : 'POST', headers: { host: 'demo.test', origin, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf }, socket: { remoteAddress: '127.0.0.1' } });
    const res = { headers: {}, statusCode: 200, headersSent: false, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, end(raw) { this.body = JSON.parse(raw); this.headersSent = true; } };
    await handler(req, res); return res;
  };
  assert.equal((await request('workspace')).statusCode, 401);
  const login = await request('login', { password: '1234' });
  assert.equal(login.statusCode, 200);
  cookie = login.headers['set-cookie'].split(';')[0]; csrf = login.body.csrf;
  const snapshot = (await request('snapshot')).body;
  assert.ok(snapshot.workspace.presets['weather-review']);
  const saved = await request('workspace', { section: 'preferences', key: 'notifications', value: { categories: { errors: false } } });
  assert.equal(saved.statusCode, 200);
  assert.equal((await request('snapshot')).body.workspace.preferences.notifications.categories.errors, false);
  const found = await request('history/search?q=humidity');
  assert.equal(found.statusCode, 200);
  const archived = found.body.results.find(result => result.archived);
  const historical = await request(`history/session?id=${encodeURIComponent(archived.sessionId)}`);
  assert.equal(historical.body.readOnly, true);
  const health = await request('providers/health');
  assert.equal(health.body.providers.length, 3);
  assert.equal(health.body.providers[0].recovery[0].id, 'retry');
  const retried = await request('providers/codex/retry', {});
  assert.equal(retried.body.providers[0].connected, true);
  const weather = snapshot.sessions.find(session => session.project === 'weather-station' && !session.parentId);
  const status = await request(`sessions/${encodeURIComponent(weather.id)}/repository`);
  assert.equal(status.body.available, true);
  const diff = await request(`sessions/${encodeURIComponent(weather.id)}/repository?path=${encodeURIComponent(status.body.files[0].path)}`);
  assert.match(diff.body.text, /^diff --git/m);
  const pending = weather.requests[0];
  const answered = await request(`requests/${pending.id}/respond`, { decision: pending.actions[0].value });
  assert.equal(answered.statusCode, 200);
  const decisions = await request(`decisions?session=${encodeURIComponent(weather.id)}&q=${encodeURIComponent(pending.id)}`);
  assert.equal(decisions.body.decisions.length, 1);
  assert.equal(decisions.body.decisions[0].requestId, pending.id);
  const launched = await request('spawn', { presetId: 'weather-review' });
  assert.equal(launched.statusCode, 200);
  const workspace = (await request('workspace')).body;
  assert.equal(workspace.drafts[launched.body.sessionId].text, snapshot.workspace.presets['weather-review'].prompt);
});
