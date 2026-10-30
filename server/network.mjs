import { execFileSync } from 'node:child_process';

// Check all interfaces, including IPv6 and listeners owned by other users. macOS ships netstat, not ss.
export function portInUse(port, { platform = process.platform, exec = execFileSync } = {}) {
  const mac = platform === 'darwin';
  const output = exec(mac ? '/usr/sbin/netstat' : 'ss', mac ? ['-an', '-p', 'tcp'] : ['-H', '-ltn'], { encoding: 'utf8', timeout: 5000 });
  return output.split('\n').some(line => {
    const fields = line.trim().split(/\s+/);
    return mac ? fields[5] === 'LISTEN' && fields[3]?.endsWith(`.${port}`) : fields[3]?.endsWith(`:${port}`);
  });
}
