import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir } from './config.mjs';
import { fail } from './requests.mjs';

const validUSD = value => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 1_000_000 && Math.abs(value * 100 - Math.round(value * 100)) <= .000001;
const validDay = value => Number.isInteger(value) && value >= 1 && value <= 31;

export class SpendBudget {
  constructor(file = join(dataDir, 'spend-budget.json')) { this.file = file; this.value = { mode: 'weekly', usd: null, day: 7 }; this.pending = Promise.resolve(); }
  async load() {
    try {
      // Older files only stored `weeklyUSD`.
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      this.value = { mode: saved.mode === 'monthly' ? 'monthly' : 'weekly', usd: validUSD(saved.usd ?? saved.weeklyUSD) ? saved.usd ?? saved.weeklyUSD : null, day: validDay(saved.day) ? saved.day : 7 };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this;
  }
  // `usd: null` removes the limit but keeps the chosen mode and reset day.
  save({ mode, usd, day } = {}) {
    if (mode !== 'weekly' && mode !== 'monthly') throw fail('Choose a weekly or monthly budget.');
    if (usd !== null && !validUSD(usd)) throw fail(`Enter a ${mode} budget from $1 to $1,000,000, with up to two decimals.`);
    if (!validDay(day)) throw fail('Enter a reset day from 1 to 31.');
    const value = { mode, usd, day };
    const task = this.pending.then(async () => {
      await writeFile(this.file + '.tmp', JSON.stringify(value) + '\n', { mode: 0o600 });
      await rename(this.file + '.tmp', this.file); this.value = value; return value;
    });
    this.pending = task.catch(() => {}); return task;
  }
}
