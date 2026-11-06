// Synchronous application-ledger mutations share one non-waiting process lock.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './config.mjs';
import { ensureDir } from './util.mjs';

let heldRoot = null;
function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code !== 'ESRCH'; }
}
function acquire(file, owner) {
  try { writeFileSync(file, JSON.stringify(owner), { flag: 'wx' }); return; } catch (err) { if (err.code !== 'EEXIST') throw err; }
  let existing;
  try { existing = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new Error('Application state is locked; lock owner is unknown'); }
  if (alive(existing.pid)) throw new Error('Application state is busy (locked by a live process); retry after it finishes');
  reclaim(file, owner, existing);
}

function reclaim(file, owner, existing) {
  const receipt = file + '.reclaim';
  try { writeFileSync(receipt, JSON.stringify(owner), { flag: 'wx' }); } catch {
    throw new Error('Application state lock recovery is busy; retry');
  }
  try {
    if (readFileSync(file, 'utf8') !== JSON.stringify(existing)) throw new Error('Application state lock changed; retry');
    rmSync(file);
    writeFileSync(file, JSON.stringify(owner), { flag: 'wx' });
  } finally { rmSync(receipt); }
}

export function stateMutation(operation) {
  return (...args) => {
    const p = paths();
    if (heldRoot === p.root) return operation(...args);
    ensureDir(p.stateDir);
    const lock = join(p.stateDir, 'state.lock');
    const owner = { pid: process.pid, nonce: randomUUID() };
    acquire(lock, owner);
    heldRoot = p.root;
    try { return operation(...args); } finally {
      heldRoot = null;
      if (existsSync(lock) && readFileSync(lock, 'utf8') === JSON.stringify(owner)) rmSync(lock);
    }
  };
}

