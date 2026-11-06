import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { normalizeManual } from '../src/lib/normalize.mjs';
import { paths } from '../src/lib/config.mjs';
import * as store from '../src/lib/store.mjs';

beforeEach(() => { process.env.JOBAGENT_HOME = mkdtempSync(join(tmpdir(), 'jobagent-recovery-')); });
function queued(n) {
  const job = normalizeManual({ company: 'Example', title: 'Engineer ' + n, url: 'https://careers.example.test/' + n });
  store.upsertJobs([job]); const app = store.createApplication(job);
  store.recordStatus(app.id, 'tailored'); store.recordStatus(app.id, 'queued'); return app;
}

test('authorization refuses a malformed legacy URL without persisting approval', () => {
  const a = queued(1); const db = store.loadApps(); db.apps[a.id].applyUrl = 'bad'; store.saveApps(db);
  assert.throws(() => store.approveApplication(a.id), /URL|applyUrl/);
  assert.equal(store.getApp(a.id).status, 'queued'); assert.equal(store.readSession(), null);
});

test('expired approval can be reapproved with a fresh valid session', () => {
  const a = queued(1); store.approveApplication(a.id);
  const session = JSON.parse(readFileSync(paths().sessionFile, 'utf8')); session.expiresAt = new Date(0).toISOString(); writeFileSync(paths().sessionFile, JSON.stringify(session));
  const renewed = store.approveApplication(a.id); assert.equal(renewed.session.appId, a.id);
  assert.equal(store.readSession().expired, undefined);
});

test('an active authorization cannot be silently replaced by another application', () => {
  const a = queued(1); const b = queued(2); store.approveApplication(a.id);
  assert.throws(() => store.approveApplication(b.id), /active|armed|disarm/i);
  assert.equal(store.getApp(b.id).status, 'queued'); assert.equal(store.readSession().appId, a.id);
});

test('pending authorization journal locks browser and recovers conservatively', async () => {
  const a = queued(1); store.approveApplication(a.id); const p = paths();
  const journal = join(p.stateDir, 'authorization-pending.json');
  writeFileSync(journal, JSON.stringify({ version: 1, appId: a.id }));
  assert.equal(store.readSession(), null);
  assert.equal(typeof store.recoverAuthorization, 'function');
  store.recoverAuthorization();
  assert.equal(store.getApp(a.id).status, 'queued'); assert.equal(store.readSession(), null); assert.equal(existsSync(journal), false);
});

test('application mutation refuses while another live process owns the state lock', () => {
  const p = paths(); mkdirSync(p.stateDir, { recursive: true });
  writeFileSync(join(p.stateDir, 'state.lock'), JSON.stringify({ pid: process.pid + 0, nonce: 'another-owner' }));
  assert.throws(() => queued(1), /busy|locked/i);
});

