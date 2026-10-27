import { connect } from 'node:net';
import { execFile } from 'node:child_process';
import { lstat, realpath, readFile } from 'node:fs/promises';
import { dirname, basename, normalize } from 'node:path';
import { fail } from './requests.mjs';

const runTmux = (args, input) => new Promise((resolve, reject) => {
  const child = execFile('tmux', args, { timeout: 3000 }, (error, stdout) => error ? reject(error) : resolve(stdout));
  child.stdin.on('error', () => {}); // tmux exits without reading stdin for most commands
  child.stdin.end(input);
});
async function parentPid(pid) {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
  return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
}
const tmuxPaneId = record => /\.(%\d+)$/.exec(record.tmux || '')?.[1];

// Sessions in tmux get the text typed into their pane: Claude sees the user's own
// prompt, queued like terminal input while busy. Other sessions fall back to the
// cross-session inbox, where Claude sees a message from another session.
export class ClaudeMessaging {
  submissions = new Map();
  sockets = new Set();
  typing = Promise.resolve();
  constructor({ alive, openSocket = connect, stat = lstat, canonical = realpath, uid = process.getuid?.(), timeoutMs = 5000, tmux = runTmux, parent = parentPid, pollMs = 100, settleMs = 3000 } = {}) {
    Object.assign(this, { alive, openSocket, stat, canonical, uid, timeoutMs, tmux, parent, pollMs, settleMs });
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
    if (!await this.alive(record.pid, record.procStart)) throw fail('Claude is no longer running. Refresh before sending.', 409);
    if (tmuxPaneId(record)) {
      // Enter on an open dialog would pick its default option.
      if (!['idle', 'busy'].includes(record.status) || record.waitingFor) throw fail('Claude is waiting on a prompt in its terminal.', 409);
      const pane = await this.verifiedPane(record);
      if (pane) return this.type(pane, body);
    }
    if (!await this.inboxAvailable(record)) throw fail('Claude has no tmux pane or inbox to receive messages.', 409);
    return this.post(record, body);
  }
  type(pane, body) {
    // Strip control characters so text cannot end the bracketed paste or send keys.
    const text = body.text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
    const buffer = `ai-control-${body.clientMessageId}`;
    const run = async () => {
      try {
        await this.tmux(['copy-mode', '-q', '-t', pane]);
        await this.tmux(['load-buffer', '-b', buffer, '-'], text);
        await this.tmux(['paste-buffer', '-d', '-p', '-r', '-b', buffer, '-t', pane]);
      } catch { throw fail('Could not type into Claude’s tmux pane. Refresh and try again.', 503); }
      // A busy or long session can take a while to take in a paste, and an early Enter hits an empty
      // prompt. So wait until the text shows in the input line, press Enter, and press again only
      // while our own text is still visibly there (so a retry can never confirm a dialog).
      const snippet = text.split('\n').find(line => line.trim())?.trim().replace(/\s+/g, ' ').slice(0, 20) || '';
      const inInput = async () => {
        const screen = await this.tmux(['capture-pane', '-p', '-J', '-t', pane]).catch(() => '');
        const line = screen.split('\n').reverse().find(row => /^\s*[❯>]/.test(row))?.replace(/^\s*[❯>]\s?/, '').replace(/\s+/g, ' ') ?? '';
        return line.includes(snippet) || line.includes('[Pasted text');
      };
      const until = async (check, ms) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, this.pollMs))) if (await check()) return true; return check(); };
      await until(inInput, this.settleMs);
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await this.tmux(['send-keys', '-t', pane, 'Enter']); }
        catch { throw fail('The text is in Claude’s prompt but Enter failed. Check the terminal before sending again.', 504); }
        if (await until(async () => !await inInput(), this.settleMs / 2)) return { status: 'sent', via: 'tmux', clientMessageId: body.clientMessageId };
      }
      throw fail('The text is in Claude’s prompt but was not submitted. Press Enter in the terminal.', 504);
    };
    // One paste and Enter at a time, so concurrent sends never interleave.
    const result = this.typing.then(run, run);
    this.typing = result.catch(() => {});
    return result;
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
