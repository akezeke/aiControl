import { fileURLToPath } from 'node:url';
import { savePassword } from '../server/auth.mjs';
import { authFile, prepareData } from '../server/config.mjs';

export function hiddenInput(label) {
  if (!process.stdin.isTTY) throw new Error('Run this command in a terminal to set the dashboard password.');
  return new Promise((resolve, reject) => {
    process.stdout.write(label); process.stdin.setRawMode(true); process.stdin.resume();
    let value = '';
    const finish = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', read); process.stdout.write('\n'); };
    const read = chunk => {
      for (const char of chunk.toString()) {
        if (char === '\u0003') { finish(); reject(new Error('Cancelled.')); return; }
        if (char === '\r' || char === '\n') { finish(); resolve(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    process.stdin.on('data', read);
  });
}
export async function configurePassword() {
  prepareData();
  const password = await hiddenInput('Dashboard PIN (4–8 digits) or password (12+ characters): ');
  const confirmation = await hiddenInput('Repeat PIN or password: ');
  if (password !== confirmation) throw new Error('Entries do not match.');
  await savePassword(authFile, password);
  console.log('PIN or password saved. Existing logins are invalidated.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await configurePassword();
