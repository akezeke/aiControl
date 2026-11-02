import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { fail } from './requests.mjs';
import { runTmux, trustMenu } from './claude-messaging.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const names = { claude: 'Claude Code session', codex: 'Codex session' };

// An agent started from here can stop at a question before it registers, such as whether to trust its folder, and until
// it registers the dashboard can't see it. So each new pane is watched until its agent is up. A trust question becomes a
// request: Trust picks Yes in the pane, Exit closes the pane, and answering in the terminal works too. A launch with its
// session id chosen up front (Claude's --session-id) also stands in as that session until the real one replaces it.
export class Launches {
  #store; #tmux; #registered; #launches = new Map(); #stopped = false;
  constructor(store, { tmux = runTmux, registered = () => false, pollMs = 1000, startMs = 120_000, keyMs = 150 } = {}) {
    this.#store = store; this.#tmux = tmux; this.#registered = registered; this.pollMs = pollMs; this.startMs = startMs; this.keyMs = keyMs;
  }
  get watching() { return this.#launches.size; }
  // `pane`, `session` and `window` are spawnAgent's result; `account` is the Claude account's label.
  watch({ pane, session, window, provider, cwd, account = '', sessionId }) {
    const id = sessionId ? `${provider}:${sessionId}` : `${provider}:launch-${pane.replace(/\W/g, '')}`;
    const launch = { id, nativeId: sessionId || '', pane, provider, cwd, account, place: [session, window].filter(Boolean).join(':'), startedAt: Date.now(), asking: false, sourceKey: `launch:${randomUUID()}` };
    this.#launches.set(launch.sourceKey, launch);
    this.#follow(launch).catch(() => {}).finally(() => { this.#store.removeSource(launch.sourceKey); this.#launches.delete(launch.sourceKey); });
  }
  // Stand-ins: every launch with a known id, and any launch asking a question.
  list() {
    return [...this.#launches.values()].filter(launch => launch.nativeId || launch.asking).map(launch => ({
      id: launch.id, nativeId: launch.nativeId, provider: launch.provider, title: names[launch.provider] || 'New session', cwd: launch.cwd, project: basename(launch.cwd),
      account: launch.account, status: 'idle', starting: true, updatedAt: launch.startedAt, detail: `Starting in tmux ${launch.place}`, control: true, messaging: { send: false, queue: false }, messages: [],
    }));
  }
  stop() { this.#stopped = true; }
  #screen(pane) { return this.#tmux(['capture-pane', '-p', '-J', '-t', pane]); }
  async #follow(launch) {
    let until = Date.now() + this.startMs;
    while (!this.#stopped && !this.#registered(launch.id)) {
      // A closed pane (Exit, or closed in tmux) fails the capture, which ends the watch.
      const menu = trustMenu(await this.#screen(launch.pane));
      if (menu && !launch.asking) { launch.asking = true; this.#ask(launch); }
      if (!menu && launch.asking) {
        launch.asking = false; this.#store.removeSource(launch.sourceKey);
        // Without an id there is nothing to wait for; with one, the agent gets its usual time to register.
        if (!launch.nativeId) return;
        until = Date.now() + this.startMs;
      }
      if (!launch.asking && Date.now() > until) return;
      await sleep(this.pollMs);
    }
  }
  #ask(launch) {
    this.#store.add({ provider: launch.provider, sessionId: launch.id, kind: 'permission', title: 'Trust this folder?', details: launch.cwd, actions: [{ value: 'accept', label: 'Trust' }, { value: 'decline', label: 'Exit' }] }, async ({ decision }) => {
      if (decision === 'decline') { await this.#tmux(['kill-pane', '-t', launch.pane]).catch(() => {}); return; }
      await this.#choose(launch.pane, 'yes').catch(e => { throw e.status ? e : fail('Could not answer in the terminal.', 503); });
    }, launch.sourceKey);
  }
  // Moves the menu's mark to the wanted row one key at a time, looking again once the menu redraws, and confirms only there.
  async #choose(pane, want) {
    for (let step = 0; step < 8; step++) {
      const menu = trustMenu(await this.#screen(pane).catch(() => ''));
      if (!menu) throw fail('The folder question was already answered.', 409);
      if (menu.selected === menu[want]) { await this.#tmux(['send-keys', '-t', pane, 'Enter']); return; }
      await this.#tmux(['send-keys', '-t', pane, menu[want] > menu.selected ? 'Down' : 'Up']);
      for (let wait = 0; wait < 10 && trustMenu(await this.#screen(pane).catch(() => ''))?.selected === menu.selected; wait++) await sleep(this.keyMs);
    }
    throw fail('Could not answer in the terminal.', 503);
  }
}
