import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, realpath, readFile, readdir } from 'node:fs/promises';
import { dirname, basename, normalize } from 'node:path';
import { fail, slashCommand } from './requests.mjs';

const runTmux = (args, input) => new Promise((resolve, reject) => {
  const child = execFile('tmux', args, { timeout: 3000 }, (error, stdout) => error ? reject(error) : resolve(stdout));
  child.stdin.on('error', () => {}); // tmux exits without reading stdin for most commands
  child.stdin.end(input);
});
async function parentPid(pid) {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
  return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
}
// A new agent gets a window in the tmux session already working in this project, else in a session
// named after it. The command is typed into a shell, so an error or exit stays readable there.
// configDir starts Claude under another account (CLAUDE_CONFIG_DIR); empty means the default ~/.claude.
export async function spawnAgent(cwd, provider, { configDir = '', tmux = runTmux, update = updateCodex } = {}) {
  if (!['claude', 'codex'].includes(provider)) throw fail('Unknown agent.');
  const panes = (await tmux(['list-panes', '-a', '-F', '#{session_name}\t#{pane_current_path}']).catch(() => '')).split('\n').map(line => line.split('\t'));
  // npm stop ends the server's own session, so agents never go there.
  let name = panes.find(([session, path]) => path === cwd && session !== 'aiControl')?.[0] || basename(cwd).replace(/[^\w-]/g, '_');
  if (name === 'aiControl') name += '-agents';
  const target = panes.some(([session]) => session === name) ? ['new-window', '-t', `=${name}:`] : ['new-session', '-s', name];
  try {
    const pane = (await tmux([...target, '-d', '-c', cwd, '-n', provider, '-P', '-F', '#{pane_id}'])).trim();
    // A plain `codex` joins the shared app server the dashboard watches; any -c override runs a private one it never sees.
    const command = provider === 'codex' ? 'codex' : configDir ? `CLAUDE_CONFIG_DIR='${configDir.replaceAll("'", "'\\''")}' claude` : 'claude';
    await tmux(['send-keys', '-t', pane, command, 'Enter']);
    if (provider === 'codex') update(pane, { tmux }).catch(() => {});
    return { session: name, pane, window: (await tmux(['display-message', '-p', '-t', pane, '#{window_index}']).catch(() => '')).trim() };
  } catch { throw fail('Could not open a tmux window.', 503); }
}
// The thread only loads past Codex's startup update prompt, so take its default, Update now; the update ends Codex, so
// start it again once it reports success. A started Codex or any other question (trusting a folder) is left alone.
export async function updateCodex(pane, { tmux = runTmux, pollMs = 1000, startMs = 20_000, updateMs = 180_000 } = {}) {
  const screen = () => tmux(['capture-pane', '-p', '-J', '-t', pane]).catch(() => '');
  const wait = () => new Promise(resolve => setTimeout(resolve, pollMs));
  for (const end = Date.now() + startMs; Date.now() < end; await wait()) {
    const text = await screen();
    if (/Ask Codex|Trust and continue/.test(text)) return false;
    if (!/Update available/.test(text) || !/›\s*1\.\s*Update now/.test(text)) continue;
    await tmux(['send-keys', '-t', pane, 'Enter']);
    for (const until = Date.now() + updateMs; Date.now() < until; await wait()) {
      if (/Update ran successfully/.test(await screen())) { await tmux(['send-keys', '-t', pane, 'codex', 'Enter']); return true; }
    }
    return false;
  }
  return false;
}
// Every process, with its parent and command line.
async function listProcesses() {
  const all = await Promise.all((await readdir('/proc').catch(() => [])).filter(name => /^\d+$/.test(name)).map(async pid => {
    try {
      const [stat, cmdline] = await Promise.all([readFile(`/proc/${pid}/stat`, 'utf8'), readFile(`/proc/${pid}/cmdline`, 'utf8')]);
      return { pid: Number(pid), ppid: Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]), args: cmdline.replaceAll('\0', ' ').trim() };
    } catch { return null; } // gone meanwhile
  }));
  return all.filter(Boolean);
}
// A captured screen's rows without what's drawn dim (SGR 2), which is how Claude draws its placeholder ('Try "…"').
// Attributes run on from row to row; the colour codes' arguments (38;5;n, 38;2;r;g;b) are skipped, not read as codes.
function undimmedRows(screen) {
  let dim = false;
  return screen.split('\n').map(row => row.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').split(/(\x1b\[[\d;:?]*[ -/]*[@-~])/).map(part => {
    const sgr = /^\x1b\[([\d;:]*)m$/.exec(part);
    if (!sgr) return part.startsWith('\x1b') || dim ? '' : part;
    const codes = sgr[1].split(';');
    for (let i = 0; i < codes.length; i++) {
      const code = Number(codes[i] || 0);
      if ([38, 48, 58].includes(code)) i += { 5: 2, 2: 4 }[codes[i + 1]] || 0;
      else if (code === 2) dim = true;
      else if (code === 0 || code === 22) dim = false;
    }
    return '';
  }).join(''));
}
const tmuxPaneId = record => /\.(%\d+)$/.exec(record.tmux || '')?.[1];
export const claudeEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];

// Sessions in tmux get the text typed into their pane: Claude sees the user's own
// prompt, queued like terminal input while busy. Other sessions fall back to the
// cross-session inbox, where Claude sees a message from another session.
export class ClaudeMessaging {
  submissions = new Map();
  sockets = new Set();
  typing = Promise.resolve();
  constructor({ alive, openSocket = connect, stat = lstat, canonical = realpath, uid = process.getuid?.(), timeoutMs = 5000, tmux = runTmux, parent = parentPid, pollMs = 100, settleMs = 3000, exitMs = 15_000, processes = listProcesses, signal = (pid, name) => process.kill(pid, name) } = {}) {
    Object.assign(this, { alive, openSocket, stat, canonical, uid, timeoutMs, tmux, parent, pollMs, settleMs, exitMs, processes, signal });
  }
  async available(record) {
    if (tmuxPaneId(record)) return 'tmux';
    return await this.inboxAvailable(record) ? 'inbox' : '';
  }
  async inboxAvailable(record) {
    const path = record.messagingSocketPath;
    if (record.peerProtocol !== 1 || !Number.isSafeInteger(record.pid) || record.pid < 1 || !record.procStart || typeof path !== 'string' || normalize(path) !== path || basename(path) !== `${record.pid}.sock`) return false;
    const parent = dirname(path);
    const allowed = [`/run/user/${this.uid}/cc-socks`, '/tmp/cc-socks', `/tmp/cc-socks-${this.uid}`];
    if (!allowed.includes(parent)) return false;
    try {
      if (await this.canonical(path) !== path) return false;
      const [socket, directory] = await Promise.all([this.stat(path), this.stat(parent)]);
      return socket.isSocket() && directory.isDirectory() && socket.uid === this.uid && directory.uid === this.uid && !(socket.mode & 0o077) && !(directory.mode & 0o077);
    } catch { return false; }
  }
  // The registered pane must still host this Claude process, so keys never reach another program.
  async verifiedPane(record) {
    const pane = tmuxPaneId(record);
    if (!pane) return null;
    try {
      const panePid = Number((await this.tmux(['display-message', '-p', '-t', pane, '#{pane_pid}'])).trim());
      for (let pid = record.pid, i = 0; pid > 1 && i < 8; i++, pid = await this.parent(pid)) if (pid === panePid) return pane;
    } catch { /* pane gone or tmux unavailable */ }
    return null;
  }
  async send(record, body) {
    if (typeof body?.text !== 'string' || !body.text.trim() || body.text.length > 12_000) throw fail('Enter a message of 1–12,000 characters.');
    if (body.mode !== 'send' || !/^[a-f0-9-]{36}$/i.test(body.clientMessageId || '')) throw fail('Invalid message submission.');
    const key = `${record.sessionId}:${body.clientMessageId}`;
    const previous = this.submissions.get(key);
    if (previous) {
      if (previous.text !== body.text) throw fail('This message ID was already used.', 409);
      return previous.promise;
    }
    if (this.submissions.size >= 1000) this.submissions.delete(this.submissions.keys().next().value);
    const entry = { text: body.text };
    entry.promise = this.deliver(record, body).catch(error => {
      // Retry only when nothing reached Claude.
      if (error.status !== 504) this.submissions.delete(key);
      throw error;
    });
    this.submissions.set(key, entry);
    return entry.promise;
  }
  async deliver(record, body) {
    if (tmuxPaneId(record)) {
      const pane = await this.readyPane(record, false);
      if (pane) return this.type(pane, body);
    } else if (!await this.alive(record.pid, record.procStart)) throw fail('Claude is no longer running. Refresh before sending.', 409);
    if (!await this.inboxAvailable(record)) throw fail('Claude has no tmux pane or inbox to receive messages.', 409);
    // The inbox delivers text as a message from another session, so a /command would not run.
    const command = slashCommand(body.text);
    if (command) throw fail(`${command} only works typed into Claude’s terminal; run Claude in tmux to send it from here.`, 409);
    return this.post(record, body);
  }
  // Enter or Escape on an open dialog would pick one of its options, so keys go only to a quiet prompt.
  async readyPane(record, required = true) {
    if (!await this.alive(record.pid, record.procStart)) throw fail('Claude is no longer running. Refresh before sending.', 409);
    if (record.status === 'waiting' || record.waitingFor) throw fail('Claude is waiting on a prompt in its terminal.', 409);
    const pane = await this.verifiedPane(record);
    // Statuses Claude adds over time, such as 'shell' (at its prompt while background shells run), are judged on
    // screen: a dialog takes the prompt box's place.
    if (!['idle', 'busy'].includes(record.status) && (!pane || await this.inputText(pane) === null)) throw fail('Claude is waiting on a prompt in its terminal.', 409);
    if (!pane && required) throw fail('Run Claude inside tmux to control it from here.', 409);
    return pane;
  }
  async interrupt(record) {
    const pane = await this.readyPane(record);
    if (record.status !== 'busy') throw fail('Claude is not working right now.', 409);
    try { await this.tmux(['send-keys', '-t', pane, 'Escape']); } catch { throw fail('Could not reach Claude’s tmux pane.', 503); }
    return { ok: true };
  }
  // /effort runs immediately, even mid-turn.
  async setEffort(record, effort) {
    if (!claudeEfforts.includes(effort)) throw fail('Unknown effort level.');
    await this.type(await this.readyPane(record), { text: `/effort ${effort}`, clientMessageId: randomUUID() });
    return { ok: true };
  }
  // What Claude's Bash tool still runs, in the foreground or background (dev servers, monitors): each command is a shell,
  // a child of Claude, that sources Claude's shell snapshot. Named by what that shell started.
  async commands(pid) {
    const all = await this.processes();
    return all.filter(child => child.ppid === pid && child.args.includes('/shell-snapshots/')).map(shell => all.find(child => child.ppid === shell.pid)?.args || 'a shell command');
  }
  // What's typed at Claude's prompt: '' when it's empty, null when no prompt shows (a dialog, or Claude has gone).
  // The input box is the prompt line, and the lines it wraps onto, between two rules.
  async inputText(pane) {
    const screen = await this.tmux(['capture-pane', '-p', '-e', '-J', '-t', pane]).catch(() => null);
    if (screen === null) return null;
    const rows = undimmedRows(screen), rule = row => /^\s*─/.test(row ?? '');
    const start = rows.findLastIndex((row, i) => rule(rows[i - 1]) && /^\s*[❯>]/.test(row)), end = rows.findIndex((row, i) => i > start && rule(row));
    if (start < 0 || end < 0) return null;
    return rows.slice(start, end).join('\n').replace(/^\s*[❯>]/, '').replaceAll('\u00a0', ' ').trim();
  }
  // Ends the session with /exit, typed only into an empty prompt. `recheck` runs once /exit shows there, just before
  // Enter; if it throws, /exit is wiped again. Done when the process has gone.
  // Outside tmux, an interactive Claude gets SIGTERM instead, which it takes like /exit: it quits within a second or two,
  // its terminal gets its shell back and the session can be resumed. A draft in its prompt can't be seen, so it goes too.
  async fire(record, recheck) {
    const pane = await this.readyPane(record, false);
    if (record.status !== 'idle') throw fail('Claude is working. Stop it first.', 409);
    if (!pane) {
      if (record.kind !== 'interactive') throw fail('Only terminal sessions can be fired.', 409);
      await recheck();
      if (!await this.alive(record.pid, record.procStart)) return { ok: true };
      try { this.signal(record.pid, 'SIGTERM'); } catch { throw fail('Could not signal Claude.', 503); }
      if (!await this.until(async () => !await this.alive(record.pid, record.procStart), this.exitMs)) throw fail('Claude is still running after SIGTERM. Check its terminal.', 504);
      return { ok: true };
    }
    const typed = () => this.inputText(pane);
    return this.queue(async () => {
      const before = await typed();
      if (before === null) throw fail('Claude’s prompt isn’t showing. Check its terminal.', 409);
      if (before) throw fail('There’s a draft in Claude’s prompt. Send or clear it first.', 409);
      await this.paste(pane, '/exit', randomUUID());
      try {
        if (!await this.until(async () => await typed() === '/exit', this.settleMs)) throw fail('Could not type /exit into Claude’s prompt. Check its terminal.', 503);
        await recheck();
      } catch (error) {
        if ((await typed())?.endsWith('/exit')) await this.tmux(['send-keys', '-t', pane, ...Array(5).fill('BSpace')]).catch(() => {});
        throw error;
      }
      try { await this.tmux(['send-keys', '-t', pane, 'Enter']); } catch { throw fail('/exit is in Claude’s prompt but Enter failed. Check the terminal.', 504); }
      if (!await this.until(async () => !await this.alive(record.pid, record.procStart), this.exitMs)) throw fail('Claude is still running after /exit. Check its terminal.', 504);
      return { ok: true };
    });
  }
  async paste(pane, text, id) {
    const buffer = `ai-control-${id}`;
    try {
      await this.tmux(['copy-mode', '-q', '-t', pane]);
      await this.tmux(['load-buffer', '-b', buffer, '-'], text);
      await this.tmux(['paste-buffer', '-d', '-p', '-r', '-b', buffer, '-t', pane]);
    } catch { throw fail('Could not type into Claude’s tmux pane. Refresh and try again.', 503); }
  }
  async until(check, ms) {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, this.pollMs))) if (await check()) return true;
    return check();
  }
  // One paste and Enter at a time, so concurrent sends never interleave.
  queue(run) {
    const result = this.typing.then(run, run);
    this.typing = result.catch(() => {});
    return result;
  }
  type(pane, body) {
    // Strip control characters so text cannot end the bracketed paste or send keys.
    const text = body.text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
    const run = async () => {
      await this.paste(pane, text, body.clientMessageId);
      // A busy or long session can take a while to take in a paste, and an early Enter hits an empty
      // prompt. So wait until the text shows in the input line, press Enter, and press again only
      // while our own text is still visibly there (so a retry can never confirm a dialog).
      const snippet = text.split('\n').find(line => line.trim())?.trim().replace(/\s+/g, ' ').slice(0, 20) || '';
      // The prompt box itself, not a ❯ row of the agent picker that can sit below it.
      const inInput = async () => {
        const line = (await this.inputText(pane))?.replace(/\s+/g, ' ') ?? '';
        return line.includes(snippet) || line.includes('[Pasted text');
      };
      await this.until(inInput, this.settleMs);
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await this.tmux(['send-keys', '-t', pane, 'Enter']); }
        catch { throw fail('The text is in Claude’s prompt but Enter failed. Check the terminal before sending again.', 504); }
        if (await this.until(async () => !await inInput(), this.settleMs / 2)) return { status: 'sent', via: 'tmux', clientMessageId: body.clientMessageId };
      }
      throw fail('The text is in Claude’s prompt but was not submitted. Press Enter in the terminal.', 504);
    };
    return this.queue(run);
  }
  post(record, body) {
    const frame = JSON.stringify({ type: 'user', session_id: record.sessionId, uuid: body.clientMessageId, msgV: 1, msg_id: `cc-msg-${body.clientMessageId.replaceAll('-', '')}`, priority: 'next', message: { role: 'user', content: body.text } }) + '\n';
    return new Promise((resolve, reject) => {
      let socket, finished = false, written = false;
      const done = error => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        this.sockets.delete(socket); socket?.destroy();
        if (error) reject(fail(written ? 'Delivery to Claude is unconfirmed. Check the original session before sending another copy.' : 'Could not connect to Claude. Refresh and try again.', written ? 504 : 503));
        else resolve({ status: 'submitted', via: 'inbox', clientMessageId: body.clientMessageId });
      };
      const timer = setTimeout(() => done(new Error('timeout')), this.timeoutMs);
      try {
        socket = this.openSocket(record.messagingSocketPath);
        this.sockets.add(socket);
        socket.once('connect', async () => {
          try {
            if (!await this.alive(record.pid, record.procStart) || !await this.inboxAvailable(record)) { done(new Error('stale session')); return; }
            if (finished) return;
            written = true;
            socket.end(frame, () => done());
          } catch (error) { done(error); }
        });
        socket.once('error', done);
        socket.once('close', () => { if (!finished) done(new Error('closed')); });
      } catch (error) { done(error); }
    });
  }
  stop() { for (const socket of this.sockets) socket.destroy(); }
}
