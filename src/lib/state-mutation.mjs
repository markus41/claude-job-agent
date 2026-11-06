// Non-waiting bakery lock: each writer owns one intent, never another writer's file.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './config.mjs';
import { ensureDir, writeJsonAtomic } from './util.mjs';

let heldRoot = null;
const busy = () => { throw new Error('Application state is busy (locked by another writer); retry after it finishes'); };

function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code !== 'ESRCH'; }
}
function assertLegacyOwnerGone(file) {
  if (!existsSync(file)) return;
  let owner;
  try { owner = JSON.parse(readFileSync(file, 'utf8')); } catch { busy(); }
  if (alive(owner?.pid)) busy();
}

function liveIntents(directory, ownName) {
  const records = [];
  for (const name of readdirSync(directory)) {
    if (name === ownName || !name.endsWith('.json')) continue;
    const pid = Number(name.split('-')[0]);
    if (!alive(pid)) continue;
    let record;
    try { record = JSON.parse(readFileSync(join(directory, name), 'utf8')); }
    catch (err) { if (err.code === 'ENOENT') continue; busy(); }
    if (!record || typeof record.choosing !== 'boolean' || !Number.isSafeInteger(record.ticket) || record.ticket < 0) busy();
    records.push({ ...record, name });
  }
  return records;
}

function acquire(directory, name) {
  const file = join(directory, name);
  writeFileSync(file, JSON.stringify({ choosing: true, ticket: 0 }), { flag: 'wx' });
  try {
    const ticket = 1 + Math.max(0, ...liveIntents(directory, name).map((r) => r.ticket));
    if (!Number.isSafeInteger(ticket)) busy();
    writeJsonAtomic(file, { choosing: false, ticket });
    for (const other of liveIntents(directory, name)) {
      if (other.choosing || other.ticket < ticket || (other.ticket === ticket && other.name < name)) busy();
    }
  } catch (err) { rmSync(file); throw err; }
  return file;
}

export function stateMutation(operation) {
  return (...args) => {
    const p = paths();
    if (heldRoot === p.root) return operation(...args);
    ensureDir(p.stateDir);
    assertLegacyOwnerGone(join(p.stateDir, 'state.lock'));
    assertLegacyOwnerGone(join(p.stateDir, 'state.lock.reclaim'));
    const directory = join(p.stateDir, 'writers');
    ensureDir(directory);
    const intent = acquire(directory, `${process.pid}-${randomUUID()}.json`);
    heldRoot = p.root;
    try { return operation(...args); } finally {
      heldRoot = null;
      rmSync(intent);
    }
  };
}

