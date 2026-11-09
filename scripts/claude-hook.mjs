// Claude's synchronous hook protocol. Failure leaves the original permission UI in charge.
import { connect } from 'node:net';
import { hookSocket } from '../server/config.mjs';
import { claudeProcess } from '../server/processes.mjs';

// A permission request asked while AI Control restarts, or pending when it restarts, keeps knocking this long after
// losing the server so it still shows there. Claude's own dialog stays usable meanwhile.
const RETRY_MS = 30_000;

let finished = false;
// Claude enforces the configured hook timeout; no decision leaves its own dialog in charge.
function finish(value = '{}') { if (finished) return; finished = true; process.stdout.write(value + '\n', () => process.exit(0)); }
let raw = '';
for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 1024 * 1024) finish(); }
try {
  const event = JSON.parse(raw);
  const { pid, procStart } = await claudeProcess(process.ppid);
  // A goodbye names the tmux server it ran in (TMUX is "socket,pid,index"), so a closed window can be told from a killed server.
  const tmux = event?.hook_event_name === 'SessionEnd' && process.env.TMUX ? { tmux: process.env.TMUX } : {};
  const message = JSON.stringify({ event, pid, procStart, ...tmux }) + '\n', retries = event?.hook_event_name === 'PermissionRequest';
  let lostAt = 0;
  const attempt = () => {
    const socket = connect(hookSocket);
    const connectionTimeout = setTimeout(() => socket.destroy(), 1500);
    socket.once('connect', () => { clearTimeout(connectionTimeout); lostAt = 0; socket.write(message); });
    let response = '';
    socket.on('data', chunk => {
      response += chunk;
      if (response.length > 1024 * 1024) { finish(); socket.destroy(); }
      if (response.includes('\n')) {
        try { finish(JSON.stringify(JSON.parse(response.slice(0, response.indexOf('\n'))))); } catch { finish(); }
      }
    });
    socket.on('error', () => {});
    // Closed without an answer: the server is down or restarting.
    socket.once('close', () => {
      clearTimeout(connectionTimeout);
      if (finished) return;
      lostAt ||= Date.now();
      if (retries && Date.now() - lostAt < RETRY_MS) setTimeout(attempt, 500); else finish();
    });
  };
  attempt();
} catch { finish(); }
