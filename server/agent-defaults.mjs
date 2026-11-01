import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir } from './config.mjs';

// Dashboard launch preferences contain model identifiers only, never provider credentials.
export class AgentDefaults {
  constructor(file = join(dataDir, 'agent-defaults.json')) { this.file = file; this.pending = Promise.resolve(); }
  async read(provider, account = '') {
    try { return JSON.parse(await readFile(this.file, 'utf8'))[JSON.stringify([provider, account])] || {}; }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  save(provider, account, settings) {
    const task = this.pending.then(async () => {
      let all; try { all = JSON.parse(await readFile(this.file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; all = {}; }
      all[JSON.stringify([provider, account || ''])] = { model: settings.model, effort: settings.effort || '' };
      await writeFile(this.file + '.tmp', JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
    });
    this.pending = task.catch(() => {}); return task;
  }
}
