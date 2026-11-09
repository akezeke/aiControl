import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAdapter } from '../server/claude.mjs';
import { RequestStore } from '../server/requests.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'aicontrol-claude-status-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new RequestStore();
  const adapter = new ClaudeAdapter(store, '/unused.sock', { sessionsDir: dir, projectsDir: dir, alive: async () => true,
    messaging: { available: async () => false, commands: async () => [] } });
  const record = { pid: 1, procStart: 'live', sessionId: 'session', cwd: '/work/project', status: 'busy', statusUpdatedAt: 1000, updatedAt: 1000 };
  const register = extra => writeFile(join(dir, '1.json'), JSON.stringify({ ...record, ...extra }));
  await register();
  return { adapter, store, register };
}

test('a newer idle registration repairs a missed Claude Stop hook during polling', async t => {
  const { adapter, register } = await fixture(t);
  adapter.hooks.set('session', { status: 'working', detail: 'Bash', updatedAt: 2000 });
  await adapter.refresh();
  assert.equal(adapter.list()[0].status, 'working');

  await register({ status: 'idle', statusUpdatedAt: 3000, updatedAt: 3000 });
  await adapter.refresh();
  assert.equal(adapter.list()[0].status, 'idle');
  assert.equal(adapter.list()[0].detail, '');
  assert.equal((await adapter.quiet('session')).status, 'idle');
  await adapter.refresh();
  assert.equal(adapter.list()[0].status, 'idle');
});

test('Claude Fire rechecks the latest idle registration before the next poll', async t => {
  const { adapter, register } = await fixture(t);
  adapter.hooks.set('session', { status: 'working', updatedAt: 2000 });
  await adapter.refresh();
  await register({ status: 'idle', statusUpdatedAt: 3000, updatedAt: 3000 });
  assert.equal((await adapter.quiet('session')).status, 'idle');
});

test('a newer busy registration supersedes an old Claude Stop hook', async t => {
  const { adapter, register } = await fixture(t);
  adapter.hooks.set('session', { status: 'idle', updatedAt: 2000 });
  await register({ status: 'busy', statusUpdatedAt: 3000, updatedAt: 3000 });
  await adapter.refresh();
  assert.equal(adapter.list()[0].status, 'working');
  await assert.rejects(adapter.quiet('session'), /working/);
});

test('Claude status reconciliation preserves newer work, compaction and unanswered permissions', async t => {
  for (const scenario of ['newer hook', 'registration heartbeat', 'missing transition time', 'compaction', 'permission']) {
    await t.test(scenario, async t => {
      const { adapter, store, register } = await fixture(t);
      const hook = { status: 'working', updatedAt: 2000 };
      const registration = { status: 'idle', statusUpdatedAt: 3000, updatedAt: Date.now() };
      if (scenario === 'newer hook') hook.updatedAt = 4000;
      if (scenario === 'registration heartbeat') registration.statusUpdatedAt = 1000;
      if (scenario === 'missing transition time') registration.statusUpdatedAt = undefined;
      if (scenario === 'compaction') hook.compacting = 'auto';
      if (scenario === 'permission') {
        hook.status = 'permission';
        store.add({ sessionId: 'claude:session', kind: 'permission' }, () => {}, 'pending');
      }
      adapter.hooks.set('session', hook);
      await register(registration);
      await adapter.refresh();
      assert.equal(adapter.list()[0].status, scenario === 'permission' ? 'permission' : 'working');
      await assert.rejects(adapter.quiet('session'), { status: 409 });
      if (scenario === 'permission') assert.equal(store.list().length, 1);
    });
  }
});
