import test from 'node:test';
import assert from 'node:assert/strict';
import { trustMenu } from '../server/claude-messaging.mjs';
import { Launches } from '../server/launches.mjs';
import { RequestStore, mergeSessions } from '../server/requests.mjs';

// As captured from tmux: Claude Code 2.1 in an 80-column pane, and Codex 0.125.
const claudeTrust = ` Accessing workspace:
 /mnt/c/Users/me/src
 Quick safety check: Is this a project you created or one you trust? (Like your
 own code, a well-known open source project, or work from your team). If not,
 take a moment to review what's in this folder first.
 Claude Code'll be able to read, edit, and execute files here.
 Security guide
 ❯ No, exit
   Yes, I trust this folder
 Enter to confirm · Esc to cancel`;
const codexTrust = `> You are in /tmp/new-app
  Do you trust the contents of this directory? Working with untrusted contents comes with higher
  risk of prompt injection.
› 1. Yes, continue
  2. No, quit
  Press enter to continue`;

test('the folder-trust question is read from Claude’s and Codex’s screens, and nothing else is', () => {
  assert.deepEqual(trustMenu(claudeTrust), { yes: 1, no: 0, selected: 0 });
  assert.deepEqual(trustMenu(codexTrust), { yes: 0, no: 1, selected: 0 });
  // The question wrapped by a narrow pane still counts.
  assert.deepEqual(trustMenu(claudeTrust.replace('one you trust?', 'one you\n trust?')), { yes: 1, no: 0, selected: 0 });
  for (const screen of ['', 'Allow Bash?\n❯ 1. Yes\n  2. No', ' ▐▛███▜▌   Claude Code v2.1.316\n❯ Try "fix lint errors"', 'Update available! 0.125.0 -> 0.166.0\n› 1. Update now\n  2. Skip\n  Press enter to continue', 'Do you trust the contents of this directory?']) assert.equal(trustMenu(screen), null, screen);
});

// A pane running an agent at the trust question (or past it), driven by the keys sent to it.
function agentPane({ asks = true, labels = ['No, exit', 'Yes, I trust this folder'] } = {}) {
  const state = { selected: 0, answer: null, closed: false, keys: [], asks };
  const screen = () => !state.asks || state.answer ? 'Claude Code v2.1.316\n❯ ' : ['Quick safety check: Is this a project you created or one you', ' trust? (Like your own code)', ...labels.map((label, i) => `${i === state.selected ? ' ❯ ' : '   '}${label}`), ' Enter to confirm · Esc to cancel'].join('\n');
  const tmux = async args => {
    if (state.closed) throw new Error('can’t find pane: %7');
    if (args[0] === 'capture-pane') return screen();
    if (args[0] === 'kill-pane') { state.closed = true; return ''; }
    if (args[0] === 'send-keys') {
      const key = args[3]; state.keys.push(key);
      if (key === 'Down') state.selected = (state.selected + 1) % labels.length;
      if (key === 'Up') state.selected = (state.selected + labels.length - 1) % labels.length;
      if (key === 'Enter') state.answer = labels[state.selected];
    }
    return '';
  };
  return { state, tmux };
}
const until = async (check, ms = 1000) => { for (const end = Date.now() + ms; !check(); await new Promise(resolve => setTimeout(resolve, 2))) if (Date.now() > end) throw new Error('timed out'); };
const claudeLaunch = { pane: '%7', session: 'src', window: '1', provider: 'claude', cwd: '/w/src', account: 'personal', sessionId: '11111111-2222-3333-4444-555555555555' };

test('a new Claude shows at once, asks the trust question in the dashboard, and becomes the real session when it registers', async () => {
  const store = new RequestStore(), registered = new Set(), { state, tmux } = agentPane();
  const launches = new Launches(store, { tmux, pollMs: 1, keyMs: 1, registered: id => registered.has(id) });
  launches.watch(claudeLaunch);
  const id = 'claude:11111111-2222-3333-4444-555555555555';
  assert.deepEqual(launches.list().map(({ id, provider, cwd, project, account, starting }) => ({ id, provider, cwd, project, account, starting })), [{ id, provider: 'claude', cwd: '/w/src', project: 'src', account: 'personal', starting: true }]);
  await until(() => store.list().length);
  const [request] = store.list();
  assert.equal(request.sessionId, id);
  assert.deepEqual(request.actions.map(action => action.label), ['Trust', 'Exit']);
  assert.equal(mergeSessions(launches.list(), store.list())[0].status, 'permission');
  await store.respond(request.id, { decision: 'accept' });
  assert.equal(state.answer, 'Yes, I trust this folder');
  assert.deepEqual(state.keys, ['Down', 'Enter']);
  // Still standing in until Claude registers under the id it was given.
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(launches.list().length, 1);
  assert.equal(store.list().length, 0);
  registered.add(id);
  await until(() => !launches.list().length);
  launches.stop();
});

test('Exit closes the agent’s pane; a question answered in the terminal leaves the dashboard too', async () => {
  const store = new RequestStore(), exit = agentPane();
  const launches = new Launches(store, { tmux: exit.tmux, pollMs: 1, keyMs: 1, registered: () => false });
  launches.watch(claudeLaunch);
  await until(() => store.list().length);
  await store.respond(store.list()[0].id, { decision: 'decline' });
  assert.equal(exit.state.closed, true);
  assert.equal(exit.state.answer, null);
  await until(() => !launches.list().length);
  const there = agentPane(), other = new Launches(store, { tmux: there.tmux, pollMs: 1, keyMs: 1, registered: () => false });
  other.watch({ ...claudeLaunch, provider: 'codex', sessionId: undefined });
  await until(() => store.list().length);
  assert.match(store.list()[0].sessionId, /^codex:launch-/);
  there.state.answer = 'Yes, I trust this folder';
  await until(() => !store.list().length && !other.list().length);
  other.stop();
});

test('a Codex past any trust question never shows a stand-in, and watching ends', async () => {
  const store = new RequestStore(), { tmux } = agentPane({ asks: false });
  const launches = new Launches(store, { tmux, pollMs: 1, startMs: 10, registered: () => false });
  launches.watch({ ...claudeLaunch, provider: 'codex', sessionId: undefined });
  assert.deepEqual(launches.list(), []);
  await until(() => !launches.watching);
  assert.equal(store.list().length, 0);
});
