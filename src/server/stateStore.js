import { mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const EMPTY_TIMER_STATE = {
  status: 'idle',
  mode: 'scheduled',
  configuredDurationSeconds: 1800,
  remainingSecondsWhenPaused: 1800,
  startedAt: null,
  endsAt: null,
  activeIndex: null,
  quickTask: null,
  zenBreak: null,
};

export const EMPTY_STATE = {
  projects: [],
  schedule: [],
  schedules: {},
  activeIndex: 0,
  autoStartNextTask: false,
  notes: { parkingLot: '', general: '' },
  timerState: EMPTY_TIMER_STATE,
};

function normalizeTimerState(value) {
  const timer = value && typeof value === 'object' ? value : {};
  const number = (candidate, fallback) => Number.isFinite(Number(candidate)) ? Math.max(0, Number(candidate)) : fallback;
  const quickTask = timer.quickTask?.active ? {
    active: true,
    project: 'Quick Start',
    title: String(timer.quickTask.title ?? ''),
    duration: number(timer.quickTask.duration, 30),
    zenBreakMinutes: number(timer.quickTask.zenBreakMinutes, 0),
    zenBreakTiming: timer.quickTask.zenBreakTiming === 'random' ? 'random' : 'midpoint',
  } : null;
  return {
    status: ['idle', 'running', 'paused'].includes(timer.status) ? timer.status : 'idle',
    mode: timer.mode === 'quick' ? 'quick' : 'scheduled',
    configuredDurationSeconds: number(timer.configuredDurationSeconds, 1800),
    remainingSecondsWhenPaused: number(timer.remainingSecondsWhenPaused, 1800),
    startedAt: typeof timer.startedAt === 'string' ? timer.startedAt : null,
    endsAt: typeof timer.endsAt === 'string' ? timer.endsAt : null,
    activeIndex: Number.isInteger(timer.activeIndex) ? timer.activeIndex : null,
    quickTask,
    zenBreak: timer.zenBreak && typeof timer.zenBreak === 'object' ? timer.zenBreak : null,
  };
}

export function normalizeState(value) {
  if (!value || !Array.isArray(value.projects) || !Array.isArray(value.schedule)) throw new TypeError('State must contain projects and schedule arrays');
  return {
    projects: value.projects.filter((project) => typeof project === 'string'),
    schedule: value.schedule,
    schedules: value.schedules && typeof value.schedules === 'object' && !Array.isArray(value.schedules) ? value.schedules : {},
    activeIndex: Number.isInteger(value.activeIndex) ? value.activeIndex : 0,
    autoStartNextTask: value.autoStartNextTask === true,
    notes: {
      parkingLot: String(value.notes?.parkingLot ?? ''),
      general: String(value.notes?.general ?? ''),
    },
    timerState: normalizeTimerState(value.timerState),
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
    const { stdout } = await execFileAsync('sqlite3', ['-batch', '-noheader', '-cmd', '.timeout 5000', this.filePath, `PRAGMA foreign_keys = ON; ${sql}`]);
    return stdout.trim();
  }

  async initialize() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await this.query(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), state_json TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT OR IGNORE INTO app_state VALUES (1, ${sqlString(JSON.stringify(EMPTY_STATE))}, CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL, email_normalized TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        password_changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, disabled_at TEXT
      );
      CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions(user_id);
      CREATE TABLE IF NOT EXISTS user_states (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        state_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
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

  async createUser({ id, email, emailNormalized, passwordHash }) {
    await this.pendingWrite;
    await this.query(`BEGIN IMMEDIATE; INSERT INTO users(id,email,email_normalized,password_hash) VALUES (${sqlString(id)},${sqlString(email)},${sqlString(emailNormalized)},${sqlString(passwordHash)}); INSERT INTO user_states(user_id,state_json) VALUES (${sqlString(id)},${sqlString(JSON.stringify(EMPTY_STATE))}); COMMIT;`);
    return { id, email };
  }

  async findUserByEmail(emailNormalized) {
    const output = await this.query(`SELECT json_object('id',id,'email',email,'passwordHash',password_hash,'disabledAt',disabled_at) FROM users WHERE email_normalized=${sqlString(emailNormalized)} LIMIT 1;`);
    return output ? JSON.parse(output) : null;
  }

  async createSession({ id, userId, tokenHash, expiresAt }) {
    await this.query(`INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES (${sqlString(id)},${sqlString(userId)},${sqlString(tokenHash)},${sqlString(expiresAt)});`);
  }

  async getSession(tokenHash) {
    const output = await this.query(`SELECT json_object('id',s.id,'userId',u.id,'email',u.email) FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=${sqlString(tokenHash)} AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP AND u.disabled_at IS NULL LIMIT 1;`);
    if (!output) return null;
    const session = JSON.parse(output);
    await this.query(`UPDATE user_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE id=${sqlString(session.id)};`);
    return session;
  }

  async revokeSession(tokenHash) {
    await this.query(`UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=${sqlString(tokenHash)};`);
  }

  async loadForUser(userId) {
    await this.pendingWrite;
    const output = await this.query(`SELECT json_object('state',json(state_json),'revision',revision) FROM user_states WHERE user_id=${sqlString(userId)};`);
    if (!output) throw new Error('User state is missing');
    const record = JSON.parse(output);
    return { state: normalizeState(record.state), revision: Number(record.revision) };
  }

  saveForUser(userId, value, expectedRevision) {
    const state = normalizeState(value);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new TypeError('A valid revision is required');
    this.pendingWrite = this.pendingWrite.then(async () => {
      const output = await this.query(`UPDATE user_states SET state_json=${sqlString(JSON.stringify(state))},revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=${sqlString(userId)} AND revision=${expectedRevision} RETURNING revision;`);
      return output ? { state, revision: Number(output) } : null;
    });
    return this.pendingWrite;
  }

  async copyLegacyStateToUser(userId) {
    const existing = await this.loadForUser(userId);
    const legacy = normalizeState(JSON.parse(await this.query('SELECT state_json FROM app_state WHERE id=1;')));
    if (JSON.stringify(existing.state) !== JSON.stringify(EMPTY_STATE) && JSON.stringify(existing.state) !== JSON.stringify(legacy)) throw new Error('Owner already has non-empty state; refusing to overwrite it');
    if (JSON.stringify(existing.state) !== JSON.stringify(legacy)) await this.query(`UPDATE user_states SET state_json=${sqlString(JSON.stringify(legacy))},revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=${sqlString(userId)};`);
    return legacy;
  }
}
