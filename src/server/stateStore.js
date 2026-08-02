import { mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const EMPTY_STATE = { projects: [], schedule: [], schedules: {}, activeIndex: 0, autoStartNextTask: false };

export function normalizeState(value) {
  if (!value || !Array.isArray(value.projects) || !Array.isArray(value.schedule)) throw new TypeError('State must contain projects and schedule arrays');
  return {
    projects: value.projects.filter((project) => typeof project === 'string'),
    schedule: value.schedule,
    schedules: value.schedules && typeof value.schedules === 'object' && !Array.isArray(value.schedules) ? value.schedules : {},
    activeIndex: Number.isInteger(value.activeIndex) ? value.activeIndex : 0,
    autoStartNextTask: value.autoStartNextTask === true,
  };
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export class StateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.pendingWrite = Promise.resolve();
  }

  async query(sql) {
    const { stdout } = await execFileAsync('sqlite3', ['-batch', '-noheader', this.filePath, sql]);
    return stdout.trim();
  }

  async initialize() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await this.query(`CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), state_json TEXT NOT NULL, updated_at TEXT NOT NULL); INSERT OR IGNORE INTO app_state VALUES (1, ${sqlString(JSON.stringify(EMPTY_STATE))}, CURRENT_TIMESTAMP);`);
  }

  async load() {
    await this.pendingWrite;
    return normalizeState(JSON.parse(await this.query('SELECT state_json FROM app_state WHERE id = 1;')));
  }

  save(value) {
    const state = normalizeState(value);
    this.pendingWrite = this.pendingWrite.then(() => this.query(`BEGIN IMMEDIATE; UPDATE app_state SET state_json = ${sqlString(JSON.stringify(state))}, updated_at = CURRENT_TIMESTAMP WHERE id = 1; COMMIT;`));
    return this.pendingWrite.then(() => state);
  }
}
