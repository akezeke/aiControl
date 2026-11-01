import test from 'node:test';
import assert from 'node:assert/strict';
import { hireChoices } from '../client/hire.js';

const claude = (cwd, account, updatedAt, extra = {}) => ({ provider: 'claude', cwd, account, updatedAt, ...extra });

test('one Claude account hires plain Claude and Codex, as before', () => {
  const choices = hireChoices({ claudeAccounts: [''], sessions: [] }, '/w/app');
  assert.deepEqual(choices.map(c => [c.provider, c.label, c.account, c.accounts]), [['claude', 'Claude', undefined, undefined], ['codex', 'Codex', undefined, undefined]]);
  assert.deepEqual(hireChoices({ sessions: [] }, '/w/app').map(c => c.label), ['Claude', 'Codex']);
});

test('several Claude accounts are one Claude choice, the one this project last used first and marked', () => {
  const snapshot = { claudeAccounts: ['', 'personal', 'work'], sessions: [
    claude('/w/app', 'personal', 5), claude('/w/app', 'work', 9), claude('/w/app', '', 20, { parentId: 'claude:x' }), claude('/w/other', '', 30), { provider: 'codex', cwd: '/w/app', updatedAt: 40 },
  ] };
  const choices = hireChoices(snapshot, '/w/app');
  assert.deepEqual(choices.map(c => c.label), ['Claude', 'Codex']);
  assert.deepEqual(choices[0].accounts.map(c => [c.provider, c.label, c.account, c.name, !!c.last]), [
    ['claude', 'work', 'work', 'Claude Code · work', true], ['claude', 'Default', '', 'Claude Code', false], ['claude', 'personal', 'personal', 'Claude Code · personal', false],
  ]);
  // A project nobody worked in yet starts where the server would: the first account.
  assert.deepEqual(hireChoices(snapshot, '/w/new')[0].accounts.map(c => c.label), ['Default', 'personal', 'work']);
});
