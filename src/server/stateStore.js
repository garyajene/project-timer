import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const EMPTY_STATE = {
  projects: [], schedule: [], schedules: {}, activeIndex: 0, autoStartNextTask: false,
  notes: { parkingLot: '', general: '' },
  timerState: { status: 'idle', mode: 'scheduled', configuredDurationSeconds: 1800, remainingSecondsWhenPaused: 1800, activeBlockIdentity: null, startedAt: null, endsAt: null, quickTask: null, zenBreakState: null },
};

function cleanTimerState(value = {}) {
  const status = ['idle', 'running', 'paused'].includes(value.status) ? value.status : 'idle';
  const mode = value.mode === 'quick' ? 'quick' : 'scheduled';
  const finite = (number, fallback) => Number.isFinite(Number(number)) ? Math.max(0, Number(number)) : fallback;
  const quickTask = value.quickTask?.active ? {
    active: true, project: 'Quick Start', title: String(value.quickTask.title ?? ''),
    duration: finite(value.quickTask.duration, 30), zenBreakMinutes: finite(value.quickTask.zenBreakMinutes, 0),
    zenBreakTiming: value.quickTask.zenBreakTiming === 'random' ? 'random' : 'midpoint',
  } : null;
  return {
    status, mode,
    configuredDurationSeconds: finite(value.configuredDurationSeconds, 1800),
    remainingSecondsWhenPaused: finite(value.remainingSecondsWhenPaused, 1800),
    activeBlockIdentity: value.activeBlockIdentity && typeof value.activeBlockIdentity === 'object' ? value.activeBlockIdentity : null,
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : null,
    endsAt: typeof value.endsAt === 'string' ? value.endsAt : null,
    quickTask,
    zenBreakState: value.zenBreakState && typeof value.zenBreakState === 'object' ? value.zenBreakState : null,
  };
}

export function normalizeState(value) {
  if (!value || !Array.isArray(value.projects) || !Array.isArray(value.schedule)) throw new TypeError('State must contain projects and schedule arrays');
  return {
    projects: value.projects.filter((project) => typeof project === 'string'), schedule: value.schedule,
    schedules: value.schedules && typeof value.schedules === 'object' && !Array.isArray(value.schedules) ? value.schedules : {},
    activeIndex: Number.isInteger(value.activeIndex) ? value.activeIndex : 0,
    autoStartNextTask: value.autoStartNextTask === true,
    notes: { parkingLot: String(value.notes?.parkingLot ?? ''), general: String(value.notes?.general ?? '') },
    timerState: cleanTimerState(value.timerState),
  };
}

function sql(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

export class PostgresStore {
  constructor(databaseUrl = process.env.DATABASE_URL) {
    if (!databaseUrl) throw new Error('DATABASE_URL is required');
    this.databaseUrl = databaseUrl;
  }

  async query(statement) {
    const { stdout } = await execFileAsync('psql', [this.databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', statement], { maxBuffer: 5_000_000 });
    return stdout.trim();
  }

  async initialize() {
    await this.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY, email TEXT NOT NULL, email_normalized TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), disabled_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS user_sessions (
        id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL, last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), revoked_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions(user_id);
      CREATE TABLE IF NOT EXISTS user_states (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        state_json JSONB NOT NULL, revision BIGINT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );`);
  }

  async createUser({ id, email, emailNormalized, passwordHash }) {
    const initial = JSON.stringify(EMPTY_STATE);
    const output = await this.query(`BEGIN; INSERT INTO users(id,email,email_normalized,password_hash) VALUES (${sql(id)},${sql(email)},${sql(emailNormalized)},${sql(passwordHash)}); INSERT INTO user_states(user_id,state_json) VALUES (${sql(id)},${sql(initial)}::jsonb); COMMIT; SELECT json_build_object('id',id,'email',email) FROM users WHERE id=${sql(id)};`);
    return JSON.parse(output.split('\n').at(-1));
  }

  async findUserByEmail(emailNormalized) {
    const output = await this.query(`SELECT json_build_object('id',id,'email',email,'passwordHash',password_hash,'disabledAt',disabled_at) FROM users WHERE email_normalized=${sql(emailNormalized)} LIMIT 1;`);
    return output ? JSON.parse(output) : null;
  }

  async createSession({ id, userId, tokenHash, expiresAt }) {
    await this.query(`INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES (${sql(id)},${sql(userId)},${sql(tokenHash)},${sql(expiresAt)});`);
  }

  async getSession(tokenHash) {
    const output = await this.query(`SELECT json_build_object('id',s.id,'userId',u.id,'email',u.email) FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=${sql(tokenHash)} AND s.revoked_at IS NULL AND s.expires_at>NOW() AND u.disabled_at IS NULL LIMIT 1;`);
    if (!output) return null;
    const session = JSON.parse(output);
    await this.query(`UPDATE user_sessions SET last_seen_at=NOW() WHERE id=${sql(session.id)};`);
    return session;
  }

  async revokeSession(tokenHash) { await this.query(`UPDATE user_sessions SET revoked_at=NOW() WHERE token_hash=${sql(tokenHash)};`); }

  async loadForUser(userId) {
    const output = await this.query(`SELECT json_build_object('state',state_json,'revision',revision) FROM user_states WHERE user_id=${sql(userId)};`);
    if (!output) throw new Error('User state is missing');
    const record = JSON.parse(output);
    return { state: normalizeState(record.state), revision: Number(record.revision) };
  }

  async saveForUser(userId, value, expectedRevision) {
    const state = normalizeState(value);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new TypeError('A valid revision is required');
    const output = await this.query(`UPDATE user_states SET state_json=${sql(JSON.stringify(state))}::jsonb,revision=revision+1,updated_at=NOW() WHERE user_id=${sql(userId)} AND revision=${expectedRevision} RETURNING revision;`);
    if (!output) return null;
    return { state, revision: Number(output) };
  }

  async replaceOwnerState(userId, value) {
    const state = normalizeState(value);
    await this.query(`UPDATE user_states SET state_json=${sql(JSON.stringify(state))}::jsonb,revision=revision+1,updated_at=NOW() WHERE user_id=${sql(userId)};`);
    return state;
  }
}
