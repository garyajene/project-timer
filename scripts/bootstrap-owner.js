import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeState, StateStore } from '../src/server/stateStore.js';
import { hashPassword, normalizeEmail, verifyPassword } from '../src/server/auth.js';

const email = normalizeEmail(process.env.OWNER_EMAIL);
const password = process.env.OWNER_PASSWORD;
const filePath = resolve(process.env.DATA_DIR ?? '.data', 'project-timer.sqlite');
if (!email || !password) throw new Error('OWNER_EMAIL and OWNER_PASSWORD are required');
if (process.env.CONFIRM_OWNER_BOOTSTRAP !== 'copy-and-retain') throw new Error('Set CONFIRM_OWNER_BOOTSTRAP=copy-and-retain to confirm the owner copy');

const backupPath = `${filePath}.pre-accounts-${new Date().toISOString().replaceAll(':', '-')}.bak`;
await copyFile(filePath, backupPath);
const store = new StateStore(filePath);
await store.initialize();
if (await store.query('PRAGMA integrity_check;') !== 'ok') throw new Error('SQLite integrity check failed; owner copy was not attempted');

let owner = await store.findUserByEmail(email);
if (!owner) owner = await store.createUser({ id: randomUUID(), email, emailNormalized: email, passwordHash: await hashPassword(password) });
else if (!await verifyPassword(password, owner.passwordHash)) throw new Error('The configured owner already exists, but OWNER_PASSWORD does not match');
const source = normalizeState(JSON.parse(await store.query('SELECT state_json FROM app_state WHERE id=1;')));
const sourceHash = createHash('sha256').update(JSON.stringify(source)).digest('hex');
await store.copyLegacyStateToUser(owner.id);
const destination = await store.loadForUser(owner.id);
const destinationHash = createHash('sha256').update(JSON.stringify(destination.state)).digest('hex');
if (sourceHash !== destinationHash) throw new Error('Owner workspace verification failed; the original app_state and backup remain untouched');
console.log(JSON.stringify({ ownerEmail: email, copied: true, verified: true, backupPath, sourceHash, legacyStateRetained: true }));
