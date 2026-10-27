// Claude's synchronous hook protocol. Failure leaves the original permission UI in charge.
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { hookSocket } from '../server/config.mjs';

let finished = false;
// Claude enforces the configured hook timeout; no decision leaves its own dialog in charge.
function finish(value = '{}') { if (finished) return; finished = true; process.stdout.write(value + '\n', () => process.exit(0)); }
let raw = '';
for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 1024 * 1024) finish(); }
try {
  const event = JSON.parse(raw);
  // Find the owning CLI, skipping the command shell used to invoke hooks.
  let pid = process.ppid, procStart;
  for (let i = 0; i < 8 && pid > 1; i++) {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')[0];
    if (/claude/.test(cmd) || /\(claude\)/.test(stat)) { procStart = fields[19]; break; }
    pid = Number(fields[1]);
  }
  if (!procStart) pid = 0;
  const socket = connect(hookSocket);
  const connectionTimeout = setTimeout(() => { socket.destroy(); finish(); }, 1500);
  socket.once('connect', () => { clearTimeout(connectionTimeout); socket.write(JSON.stringify({ event, pid, procStart }) + '\n'); });
  let response = '';
  socket.on('data', chunk => {
    response += chunk;
    if (response.length > 1024 * 1024) { socket.destroy(); finish(); }
    if (response.includes('\n')) {
      try { finish(JSON.stringify(JSON.parse(response.slice(0, response.indexOf('\n'))))); } catch { finish(); }
    }
  });
  socket.on('error', () => finish()); socket.on('end', () => finish());
} catch { finish(); }
