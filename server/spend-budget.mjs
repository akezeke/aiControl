import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir } from './config.mjs';
import { fail } from './requests.mjs';

export class SpendBudget {
  constructor(file = join(dataDir, 'spend-budget.json')) { this.file = file; this.weeklyUSD = null; this.pending = Promise.resolve(); }
  async load() {
    try { this.weeklyUSD = JSON.parse(await readFile(this.file, 'utf8')).weeklyUSD || null; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this;
  }
  save(value) {
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 1_000_000 || Math.abs(value * 100 - Math.round(value * 100)) > .000001)) throw fail('Enter a weekly budget from $1 to $1,000,000, with up to two decimals.');
    const task = this.pending.then(async () => {
      await writeFile(this.file + '.tmp', JSON.stringify({ weeklyUSD: value }) + '\n', { mode: 0o600 });
      await rename(this.file + '.tmp', this.file); this.weeklyUSD = value; return { weeklyUSD: value };
    });
    this.pending = task.catch(() => {}); return task;
  }
}
