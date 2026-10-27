import test from 'node:test';
import assert from 'node:assert/strict';
import { messagingUnavailableReason } from '../client/messaging-status.js';

test('a new frontend on the old backend asks for a restart instead of reporting disconnection', () => {
  const session = { provider: 'codex', status: 'working', control: true };
  const snapshot = { providers: [{ name: 'Codex', connected: true }] };
  assert.match(messagingUnavailableReason(session, snapshot), /server restart.*npm restart/);
  assert.doesNotMatch(messagingUnavailableReason(session, snapshot), /disconnected/);
  const connected = { ...session, messaging: { send: true, queue: true } };
  assert.match(messagingUnavailableReason(connected, snapshot), /server restart.*current work/);
  assert.equal(messagingUnavailableReason(connected, { ...snapshot, features: { steering: true } }), '');
});

test('current backends distinguish a connecting session from a disconnected provider', () => {
  const snapshot = { features: { messaging: true }, providers: [{ name: 'Codex', connected: true }] };
  assert.match(messagingUnavailableReason({ provider: 'codex', status: 'working', control: false }, snapshot), /Connecting to this Codex session/);
  assert.match(messagingUnavailableReason({ provider: 'codex', status: 'offline', messaging: { send: false } }, snapshot), /Codex is disconnected/);
  const disconnected = { providers: [{ name: 'Codex', connected: false }] };
  assert.match(messagingUnavailableReason({ provider: 'codex', messaging: { send: false } }, disconnected), /Codex is disconnected/);
});

test('Claude messaging distinguishes an old backend, missing inbox and connected inbox', () => {
  const session = { provider: 'claude', status: 'idle', control: true };
  assert.match(messagingUnavailableReason(session, {}), /npm restart/);
  const snapshot = { features: { claudeMessaging: true } };
  assert.match(messagingUnavailableReason(session, snapshot), /tmux/);
  assert.equal(messagingUnavailableReason({ ...session, messaging: { send: true } }, snapshot), '');
});
