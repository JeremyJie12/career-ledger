import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyState } from './domain.js';

export class Store {
  constructor(dir) { this.dir = dir; this.file = join(dir, 'ledger.json'); this.queue = Promise.resolve(); }
  async read() {
    try {
      const state = JSON.parse(await readFile(this.file, 'utf8'));
      if (state.version !== 1 || !['sources', 'cards', 'runs'].every(k => Array.isArray(state[k]))) throw new Error('Unsupported or damaged ledger');
      if (state.weeklyReports === undefined) state.weeklyReports = [];
      if (!Array.isArray(state.weeklyReports)) throw new Error('Damaged weekly reports');
      return state;
    } catch (e) { if (e.code === 'ENOENT') return emptyState(); throw e; }
  }
  update(fn) {
    const next = this.queue.then(async () => {
      const state = await this.read();
      const result = await fn(state);
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      await writeFile(`${this.file}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
      return result;
    });
    this.queue = next.catch(() => {});
    return next;
  }
}
