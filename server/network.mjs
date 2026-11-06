import { execFileSync } from 'node:child_process';

// Check all interfaces, including IPv6 and listeners owned by other users.
export function portInUse(port, { platform = process.platform, exec = execFileSync } = {}) {
  if (platform === 'darwin') {
    try {
      return Boolean(exec('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8', timeout: 5000 }).trim());
    } catch (error) {
      // lsof exits 1 without output when no files match; surface inspection errors.
      if (error.status === 1 && !error.stdout && !error.stderr) return false;
      throw error;
    }
  }
  const output = exec('ss', ['-H', '-ltn'], { encoding: 'utf8', timeout: 5000 });
  return output.split('\n').some(line => {
    const fields = line.trim().split(/\s+/);
    return fields[3]?.endsWith(`:${port}`);
  });
}
