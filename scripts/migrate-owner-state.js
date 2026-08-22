import { copyFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { PostgresStore, normalizeState } from '../src/server/stateStore.js';
import { hashPassword, normalizeEmail } from '../src/server/auth.js';

const execFileAsync = promisify(execFile);
const ownerEmail = normalizeEmail(process.env.OWNER_EMAIL);
const ownerPassword = process.env.OWNER_PASSWORD;
const sqlitePath = resolve(process.env.LEGACY_SQLITE_PATH ?? resolve(process.env.DATA_DIR ?? '.data', 'project-timer.sqlite'));

if (!ownerEmail || !ownerPassword) throw new Error('OWNER_EMAIL and OWNER_PASSWORD are required');
if (process.env.CONFIRM_OWNER_MIGRATION !== 'copy-and-retain') throw new Error('Set CONFIRM_OWNER_MIGRATION=copy-and-retain to run the explicit owner migration');

const backupPath = `${sqlitePath}.pre-accounts-${new Date().toISOString().replaceAll(':', '-')}.bak`;
await mkdir(dirname(backupPath), { recursive: true });
await copyFile(sqlitePath, backupPath);
const { stdout } = await execFileAsync('sqlite3', ['-batch', '-noheader', sqlitePath, 'SELECT state_json FROM app_state WHERE id=1;']);
const legacy = normalizeState(JSON.parse(stdout.trim()));
const checksum = createHash('sha256').update(JSON.stringify(legacy)).digest('hex');

const store = new PostgresStore();
await store.initialize();
let user = await store.findUserByEmail(ownerEmail);
if (!user) {
  user = await store.createUser({ id: randomUUID(), email: ownerEmail, emailNormalized: ownerEmail, passwordHash: await hashPassword(ownerPassword) });
} else {
  const current = await store.loadForUser(user.id);
  const currentJson = JSON.stringify(current.state);
  const emptyJson = JSON.stringify(normalizeState({ projects: [], schedule: [] }));
  if (currentJson !== emptyJson && currentJson !== JSON.stringify(legacy)) throw new Error('Owner already has non-empty state; refusing to overwrite it');
}
const beforeCopy = await store.loadForUser(user.id);
if (JSON.stringify(beforeCopy.state) !== JSON.stringify(legacy)) await store.replaceOwnerState(user.id, legacy);
const copied = await store.loadForUser(user.id);
const copiedChecksum = createHash('sha256').update(JSON.stringify(copied.state)).digest('hex');
if (checksum !== copiedChecksum) throw new Error('Owner state verification failed; the SQLite backup remains untouched');
console.log(JSON.stringify({ migrated: true, ownerEmail, backupPath, checksum, legacyRetained: true }));
