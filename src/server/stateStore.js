import { mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const execFileAsync = promisify(execFile);
const scrypt = promisify(scryptCallback);
export const EMPTY_TIMER_STATE = {
  status: 'idle', mode: 'scheduled', configuredDurationSeconds: 1800, remainingSecondsWhenPaused: 1800,
  startedAt: null, endsAt: null, activeIndex: null, quickTask: null, zenBreak: null,
};
export const EMPTY_STATE = {
  projects: [], projectSettings: {}, schedule: [], schedules: {}, activeIndex: 0, autoStartNextTask: false,
  notes: { parkingLot: '', general: '' }, timerState: EMPTY_TIMER_STATE,
};

function normalizeTimerState(value) {
  const timer = value && typeof value === 'object' ? value : {};
  const number = (candidate, fallback) => Number.isFinite(Number(candidate)) ? Math.max(0, Number(candidate)) : fallback;
  const quickTask = timer.quickTask?.active ? {
    active: true, project: 'Quick Start', title: String(timer.quickTask.title ?? ''), duration: number(timer.quickTask.duration, 30),
    zenBreakMinutes: number(timer.quickTask.zenBreakMinutes, 0), zenBreakTiming: timer.quickTask.zenBreakTiming === 'random' ? 'random' : 'midpoint',
  } : null;
  return {
    status: ['idle', 'running', 'paused'].includes(timer.status) ? timer.status : 'idle', mode: timer.mode === 'quick' ? 'quick' : 'scheduled',
    configuredDurationSeconds: number(timer.configuredDurationSeconds, 1800), remainingSecondsWhenPaused: number(timer.remainingSecondsWhenPaused, 1800),
    startedAt: typeof timer.startedAt === 'string' ? timer.startedAt : null, endsAt: typeof timer.endsAt === 'string' ? timer.endsAt : null,
    activeIndex: Number.isInteger(timer.activeIndex) ? timer.activeIndex : null, quickTask,
    zenBreak: timer.zenBreak && typeof timer.zenBreak === 'object' ? timer.zenBreak : null,
  };
}

export function normalizeState(value) {
  if (!value || !Array.isArray(value.projects) || !Array.isArray(value.schedule)) throw new TypeError('State must contain projects and schedule arrays');
  const projects = value.projects.filter((project) => typeof project === 'string');
  const settings = value.projectSettings && typeof value.projectSettings === 'object' && !Array.isArray(value.projectSettings) ? value.projectSettings : {};
  const projectSettings = Object.fromEntries(projects.map((project) => {
    const candidate = settings[project] || {};
    const priority = Math.min(5, Math.max(1, Number(candidate.priority) || 3));
    const defaultDuration = candidate.defaultDuration == null ? null : Math.max(1, Number(candidate.defaultDuration) || 30);
    return [project, { priority, defaultDuration }];
  }));
  return {
    projects, projectSettings, schedule: value.schedule,
    ...(value.schedulerSettings && typeof value.schedulerSettings === 'object' ? { schedulerSettings: value.schedulerSettings } : {}),
    schedules: value.schedules && typeof value.schedules === 'object' && !Array.isArray(value.schedules) ? value.schedules : {},
    activeIndex: Number.isInteger(value.activeIndex) ? value.activeIndex : 0, autoStartNextTask: value.autoStartNextTask === true,
    notes: { parkingLot: String(value.notes?.parkingLot ?? ''), general: String(value.notes?.general ?? '') }, timerState: normalizeTimerState(value.timerState),
  };
}

function sqlString(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function normalizedEmail(value) { return String(value ?? '').trim().toLowerCase(); }
function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new TypeError('Password must be between 12 and 1024 characters');
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
}

async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, saltText, hashText] = String(encoded).split('$');
  if (algorithm !== 'scrypt') return false;
  const expected = Buffer.from(hashText || '', 'base64');
  const actual = await scrypt(String(password), Buffer.from(saltText || '', 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return expected.length > 0 && timingSafeEqual(expected, actual);
}

export class StateStore {
  constructor(filePath) { this.filePath = filePath; this.pendingWrite = Promise.resolve(); }
  async query(sql) { const { stdout } = await execFileAsync('sqlite3', ['-batch', '-noheader', '-separator', '\t', this.filePath, sql]); return stdout.trim(); }
  async initialize() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await this.query(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), state_json TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT OR IGNORE INTO app_state VALUES (1, ${sqlString(JSON.stringify(EMPTY_STATE))}, CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_states (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, state_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);`);
  }
  async load() { await this.pendingWrite.catch(() => {}); return normalizeState(JSON.parse(await this.query('SELECT state_json FROM app_state WHERE id = 1;'))); }
  save(value) {
    const state = normalizeState(value);
    this.pendingWrite = this.pendingWrite.catch(() => {}).then(() => this.query(`BEGIN IMMEDIATE; UPDATE app_state SET state_json = ${sqlString(JSON.stringify(state))}, updated_at = CURRENT_TIMESTAMP WHERE id = 1; COMMIT;`));
    return this.pendingWrite.then(() => state);
  }
  async register(emailValue, password, { ownerEmail = '' } = {}) {
    const email = normalizedEmail(emailValue);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new TypeError('Enter a valid email address'), { code: 'INVALID_INPUT' });
    const id = randomUUID();
    const passwordHash = await hashPassword(password);
    const isOwner = Boolean(normalizedEmail(ownerEmail)) && email === normalizedEmail(ownerEmail);
    const stateExpression = isOwner ? '(SELECT state_json FROM app_state WHERE id = 1)' : sqlString(JSON.stringify(EMPTY_STATE));
    try {
      await this.query(`BEGIN IMMEDIATE;
        INSERT INTO users (id,email,password_hash,created_at) VALUES (${sqlString(id)},${sqlString(email)},${sqlString(passwordHash)},CURRENT_TIMESTAMP);
        INSERT INTO user_states (user_id,state_json,revision,updated_at) VALUES (${sqlString(id)},${stateExpression},0,CURRENT_TIMESTAMP);
        COMMIT;`);
      if (isOwner && await this.query(`SELECT (SELECT state_json FROM user_states WHERE user_id=${sqlString(id)}) = (SELECT state_json FROM app_state WHERE id=1);`) !== '1') {
        await this.query(`DELETE FROM users WHERE id=${sqlString(id)};`);
        throw new Error('Owner copy verification failed');
      }
    } catch (error) {
      if (/UNIQUE constraint failed/.test(error.message)) error.code = 'EMAIL_EXISTS';
      throw error;
    }
    return { id, email, ownerClaimed: isOwner };
  }
  async authenticate(emailValue, password) {
    const email = normalizedEmail(emailValue);
    const row = (await this.query(`SELECT id,email,password_hash FROM users WHERE email=${sqlString(email)};`)).split('\t');
    if (row.length < 3 || !(await verifyPassword(password, row[2]))) return null;
    return { id: row[0], email: row[1] };
  }
  async createSession(userId, ttlSeconds = 60 * 60 * 24 * 30) {
    const token = randomBytes(32).toString('base64url');
    await this.query(`DELETE FROM user_sessions WHERE expires_at <= CURRENT_TIMESTAMP; INSERT INTO user_sessions VALUES (${sqlString(tokenHash(token))},${sqlString(userId)},datetime('now','+${Math.max(1, Math.floor(ttlSeconds))} seconds'),CURRENT_TIMESTAMP);`);
    return token;
  }
  async sessionUser(token) {
    if (!token) return null;
    const row = (await this.query(`SELECT users.id,users.email FROM user_sessions JOIN users ON users.id=user_sessions.user_id WHERE token_hash=${sqlString(tokenHash(token))} AND expires_at>CURRENT_TIMESTAMP;`)).split('\t');
    return row.length === 2 ? { id: row[0], email: row[1] } : null;
  }
  async deleteSession(token) { if (token) await this.query(`DELETE FROM user_sessions WHERE token_hash=${sqlString(tokenHash(token))};`); }
  async loadUserState(userId) {
    await this.pendingWrite.catch(() => {});
    const row = (await this.query(`SELECT revision,state_json FROM user_states WHERE user_id=${sqlString(userId)};`)).split('\t');
    if (row.length < 2) throw new Error('User workspace is missing');
    return { revision: Number(row[0]), state: normalizeState(JSON.parse(row.slice(1).join('\t'))) };
  }
  saveUserState(userId, value, revision) {
    const state = normalizeState(value);
    if (!Number.isInteger(revision) || revision < 0) throw new TypeError('A valid revision is required');
    this.pendingWrite = this.pendingWrite.catch(() => {}).then(async () => {
      const result = await this.query(`BEGIN IMMEDIATE; UPDATE user_states SET state_json=${sqlString(JSON.stringify(state))},revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=${sqlString(userId)} AND revision=${revision}; SELECT changes(); COMMIT;`);
      if (result.split('\n').at(-1) !== '1') throw Object.assign(new Error('Workspace has changed'), { code: 'STALE_REVISION' });
    });
    return this.pendingWrite.then(() => ({ state, revision: revision + 1 }));
  }
}
