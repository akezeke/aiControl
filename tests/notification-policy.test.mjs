import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationAllowed, notificationCategory, normalizeNotificationPolicy } from '../client/notification-policy.js';

const permission = { kind: 'input', session: { status: 'permission', cwd: '/work/app' } };
const question = { kind: 'input', session: { status: 'question', cwd: '/work/app' } };
const completion = { kind: 'ready', session: { status: 'idle', cwd: '/work/app' } };
const error = { kind: 'error', session: { status: 'error', cwd: '/work/app' } };
const events = [permission, question, completion, error];
const at = text => Date.parse(text);
const schedule = (start, end, timeZone = 'UTC') => ({ quietHours: { enabled: true, start, end, timeZone } });

test('default policy allows existing alerts and each category can be muted independently', () => {
  assert.deepEqual(events.map(event => notificationCategory(event)), ['permissions', 'questions', 'completions', 'errors']);
  assert.deepEqual(events.map(event => notificationAllowed(event)), [true, true, true, true]);
  for (const [category, expected] of [
    ['permissions', [false, true, true, true]],
    ['questions', [true, false, true, true]],
    ['completions', [true, true, false, true]],
    ['errors', [true, true, true, false]],
  ]) assert.deepEqual(events.map(event => notificationAllowed(event, { categories: { [category]: false } })), expected);
  assert.equal(notificationAllowed({ kind: 'unknown', session: {} }), false);
});

test('project mutes match full working directories rather than names or path prefixes', () => {
  const policy = { mutedProjects: ['/work/app/'] };
  assert.equal(notificationAllowed(permission, policy), false);
  assert.equal(notificationAllowed({ ...permission, session: { status: 'permission', cwd: '/work/app///' } }, policy), false);
  assert.equal(notificationAllowed({ ...permission, session: { status: 'permission', cwd: '/other/app', project: 'app' } }, policy), true);
  assert.equal(notificationAllowed({ ...permission, session: { status: 'permission', cwd: '/work/application' } }, policy), true);
  assert.equal(notificationAllowed({ ...permission, session: { status: 'permission', cwd: '/work/app/child' } }, policy), true);
  assert.equal(notificationAllowed({ ...permission, session: { status: 'permission' } }, { mutedProjects: ['', null, 0] }), true);
});

test('quiet hours include their start and exclude their end on the same day and across midnight', () => {
  for (const [policy, instant, expected] of [
    [schedule('09:00', '17:00'), '2026-11-09T08:59:59Z', true],
    [schedule('09:00', '17:00'), '2026-11-09T09:00:00Z', false],
    [schedule('09:00', '17:00'), '2026-11-09T16:59:59Z', false],
    [schedule('09:00', '17:00'), '2026-11-09T17:00:00Z', true],
    [schedule('22:00', '07:00'), '2026-11-09T21:59:59Z', true],
    [schedule('22:00', '07:00'), '2026-11-09T22:00:00Z', false],
    [schedule('22:00', '07:00'), '2026-11-10T00:00:00Z', false],
    [schedule('22:00', '07:00'), '2026-11-10T06:59:59Z', false],
    [schedule('22:00', '07:00'), '2026-11-10T07:00:00Z', true],
    [schedule('00:00', '01:00'), '2026-11-10T00:00:00Z', false],
    [schedule('00:00', '00:00'), '2026-11-10T00:00:00Z', true],
  ]) assert.equal(notificationAllowed(permission, policy, at(instant)), expected, `${policy.quietHours.start}–${policy.quietHours.end} at ${instant}`);
});

test('quiet hours follow configured zone offset changes and fractional offsets', () => {
  const stockholm = schedule('22:00', '07:00', 'Europe/Stockholm');
  assert.equal(notificationAllowed(permission, stockholm, at('2026-07-01T20:00:00Z')), false, 'summer time is UTC+2');
  assert.equal(notificationAllowed(permission, stockholm, at('2026-11-09T20:00:00Z')), true, 'winter time is UTC+1');
  assert.equal(notificationAllowed(permission, stockholm, at('2026-11-09T21:00:00Z')), false);
  const repeatedHour = schedule('01:00', '03:00', 'Europe/Stockholm');
  assert.equal(notificationAllowed(permission, repeatedHour, at('2026-10-25T00:30:00Z')), false);
  assert.equal(notificationAllowed(permission, repeatedHour, at('2026-10-25T01:30:00Z')), false);
  assert.equal(notificationAllowed(permission, repeatedHour, at('2026-10-25T02:00:00Z')), true);
  assert.equal(notificationAllowed(permission, schedule('22:00', '07:00', 'Asia/Kathmandu'), at('2026-11-09T18:30:00Z')), false);
});

test('malformed preferences normalize safely without local time-zone assumptions', () => {
  for (const policy of [null, [], 'invalid', { categories: { permissions: 'false' }, mutedProjects: 'not an array', quietHours: 'invalid' }]) {
    assert.equal(notificationAllowed(permission, policy), true);
  }
  for (const start of ['24:00', '22:60', '9:00', '', undefined, 2200]) {
    assert.equal(notificationAllowed(permission, schedule(start, '07:00'), at('2026-11-09T23:00:00Z')), true);
  }
  const normalized = normalizeNotificationPolicy({ categories: { permissions: false, unknown: false }, mutedProjects: ['/work/app/', '/work/app', null], quietHours: { enabled: true, start: '22:00', end: '07:00', timeZone: 'Invalid/Zone' } });
  assert.deepEqual(normalized.mutedProjects, ['/work/app']);
  assert.equal(normalized.quietHours.timeZone, 'UTC');
  const otherProject = { ...question, session: { status: 'question', cwd: '/work/other' } };
  assert.equal(notificationAllowed(otherProject, normalized, at('2026-11-09T23:00:00Z')), false);
  assert.equal(notificationAllowed(otherProject, normalized, at('2026-11-09T12:00:00Z')), true);
  assert.equal(notificationAllowed(question, { quietHours: { enabled: false, start: '22:00', end: '07:00' } }, at('2026-11-09T23:00:00Z')), true);
  assert.equal(notificationAllowed(question, schedule('22:00', '07:00'), NaN), true);
});
