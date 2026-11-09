import { execFileSync } from 'node:child_process';
import { connect as netConnect } from 'node:net';

function listenerAt(port, host, connect) {
  return new Promise((resolve, reject) => {
    const socket = connect({ port, host });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error(`Port check timed out for ${host}.`)); });
    socket.once('error', error => {
      socket.destroy();
      if (['ECONNREFUSED', 'EADDRNOTAVAIL', 'EAFNOSUPPORT', 'ENETUNREACH', 'EHOSTUNREACH'].includes(error.code)) resolve(false);
      else reject(error);
    });
  });
}

// macOS lsof can hang in Virtualization.framework; probe the addresses this server can bind instead.
export async function portInUse(port, { platform = process.platform, exec = execFileSync, connect = netConnect, host = '127.0.0.1' } = {}) {
  if (platform === 'darwin') {
    for (const address of new Set(['127.0.0.1', '::1', host])) if (await listenerAt(port, address, connect)) return true;
    return false;
  }
  // On Linux inspect all interfaces, including IPv6 and listeners owned by other users.
  const output = exec('ss', ['-H', '-ltn'], { encoding: 'utf8', timeout: 5000 });
  return output.split('\n').some(line => {
    const fields = line.trim().split(/\s+/);
    return fields[3]?.endsWith(`:${port}`);
  });
}
