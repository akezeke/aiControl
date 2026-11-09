import test from 'node:test';
import assert from 'node:assert/strict';
import * as alerts from '../client/alerts.js';
const { statusEvents } = alerts;

test('alerts fire when a session starts waiting or finishes, never on first sight', () => {
  const previous = new Map(), s = (id, status, extra) => ({ id, status, ...extra });
  assert.deepEqual(statusEvents(previous, [s('a', 'working'), s('b', 'question'), s('c', 'working', { parentId: 'a' })]), []);
  const events = statusEvents(previous, [s('a', 'idle'), s('b', 'permission'), s('c', 'idle', { parentId: 'a' }), s('d', 'question')]);
  assert.deepEqual(events.map(e => [e.kind, e.session.id]), [['ready', 'a']]);
  assert.deepEqual(statusEvents(previous, [s('a', 'question')]).map(e => e.kind), ['input']);
});

test('errors emit once on a status transition, including after waiting for input', () => {
  const previous = new Map();
  const session = status => [{ id: 'a', status }];
  assert.deepEqual(statusEvents(previous, session('error')), []);
  statusEvents(previous, session('working'));
  assert.deepEqual(statusEvents(previous, session('error')).map(event => event.kind), ['error']);
  assert.deepEqual(statusEvents(previous, session('error')), []);
  statusEvents(previous, session('question'));
  assert.deepEqual(statusEvents(previous, session('error')).map(event => event.kind), ['error']);
});

test('browser sounds honor shared categories, muted projects and quiet hours before choosing an event', async t => {
  const previousDocument = globalThis.document, previousSpeech = globalThis.speechSynthesis, previousUtterance = globalThis.SpeechSynthesisUtterance;
  const previousSound = alerts.alertSettings.sound, spoken = [];
  t.after(() => {
    globalThis.document = previousDocument; globalThis.speechSynthesis = previousSpeech; globalThis.SpeechSynthesisUtterance = previousUtterance;
    alerts.alertSettings.sound = previousSound; alerts.setNotificationPolicy({});
  });
  globalThis.document = { documentElement: { dataset: { theme: 'command' } } };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  globalThis.speechSynthesis = { cancel() {}, speak: utterance => spoken.push(utterance.text) };
  alerts.alertSettings.sound = true;
  alerts.setNotificationPolicy({ categories: { permissions: false }, mutedProjects: ['/work/muted'] });
  await alerts.signal([
    { kind: 'input', session: { status: 'permission', cwd: '/work/app' } },
    { kind: 'input', session: { status: 'question', cwd: '/work/muted' } },
    { kind: 'ready', session: { status: 'idle', cwd: '/work/app' } },
  ]);
  assert.deepEqual(spoken, ['Unit ready']);
  alerts.setNotificationPolicy({ quietHours: { enabled: true, start: '22:00', end: '07:00', timeZone: 'UTC' } });
  await alerts.signal([{ kind: 'error', session: { status: 'error' } }], Date.parse('2026-11-09T23:00:00Z'));
  assert.equal(spoken.length, 1);
  await alerts.signal([{ kind: 'error', session: { status: 'error' } }], Date.parse('2026-11-10T07:00:00Z'));
  assert.deepEqual(spoken, ['Unit ready', 'Unit error']);
  alerts.alertSettings.sound = false;
  await alerts.signal([{ kind: 'input', session: { status: 'question' } }], Date.parse('2026-11-10T12:00:00Z'));
  assert.equal(spoken.length, 2);
});
