import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
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


test('failed session publication remains locked and recovery never refunds an auto batch', async () => {
  const { DEFAULT_POLICY } = await import('../src/lib/config.mjs');
  const { buildAttestation, readAttestation } = await import('../src/lib/auto.mjs');
  const a = queued(1); store.importScores([{ jobId: a.jobId, score: 90, verdict: 'strong' }]);
  const p = paths(); const d = join(p.applicationsDir, a.dir);
  for (const f of ['resume.md', 'cover-letter.md', 'answers.md']) writeFileSync(join(d, f), 'Synthetic material');
  store.saveAttestation(buildAttestation({ batchLimit: 2, ttlHours: 1, requireScore: 80 }));
  const policy = structuredClone(DEFAULT_POLICY); policy.approval.mode = 'auto';
  const rename = fs.renameSync; const write = fs.writeFileSync;
  fs.renameSync = (from, to) => { if (to === p.sessionFile) throw new Error('Synthetic session write failure'); return rename(from, to); };
  fs.writeFileSync = (file, ...args) => { if (file === p.sessionFile) throw new Error('Synthetic session write failure'); return write(file, ...args); };
  syncBuiltinESMExports();
  try { assert.throws(() => store.autoArm(a.id, { policy, hasResumePdf: true }), /Synthetic session write failure/); }
  finally { fs.renameSync = rename; fs.writeFileSync = write; syncBuiltinESMExports(); }
  assert.equal(store.readSession(), null); assert.equal(readAttestation().used, 1);
  store.recoverAuthorization();
  assert.equal(store.getApp(a.id).status, 'queued'); assert.equal(readAttestation().used, 1);
  assert.throws(() => store.autoArm(a.id, { policy, hasResumePdf: true }), /already.*batch|previous attempt/i);
  assert.equal(readAttestation().used, 1);
});

test('recording blocked revokes the matching armed session without a separate command', () => {
  const a = queued(1); store.approveApplication(a.id);
  store.recordStatus(a.id, 'blocked', { note: 'Synthetic login wall' });
  assert.equal(store.readSession(), null);
  assert.equal(existsSync(paths().sessionFile), false);
});

test('recovery revokes malformed session JSON and requeues its approved application', () => {
  const a = queued(1); store.approveApplication(a.id);
  writeFileSync(paths().sessionFile, '{"appId":');
  assert.doesNotThrow(() => store.recoverAuthorization());
  assert.equal(store.getApp(a.id).status, 'queued');
  assert.equal(store.readSession(), null);
  assert.equal(existsSync(paths().sessionFile), false);
});

test('an invalid session expiry is stale for inspection and recovery', () => {
  const a = queued(1); store.approveApplication(a.id);
  const session = JSON.parse(readFileSync(paths().sessionFile, 'utf8'));
  session.expiresAt = 'invalid'; writeFileSync(paths().sessionFile, JSON.stringify(session));
  assert.ok(!store.readSession() || store.readSession().expired);
  store.recoverAuthorization();
  assert.equal(store.getApp(a.id).status, 'queued');
});

test('corrupt batch authorization revokes its session without replacing the attestation', () => {
  const a = queued(1); store.approveApplication(a.id); const p = paths();
  const session = JSON.parse(readFileSync(p.sessionFile, 'utf8'));
  session.autoAttestedAt = new Date().toISOString(); writeFileSync(p.sessionFile, JSON.stringify(session));
  writeFileSync(p.autoAttestationFile, '{"used":');
  assert.equal(store.readSession(), null);
  store.recoverAuthorization();
  assert.equal(store.getApp(a.id).status, 'queued');
  assert.equal(readFileSync(p.autoAttestationFile, 'utf8'), '{"used":');
});

test('a batch without its attestation identity cannot grant permission', async () => {
  const { DEFAULT_POLICY } = await import('../src/lib/config.mjs');
  const { buildAttestation, readAttestation } = await import('../src/lib/auto.mjs');
  const a = queued(1); const p = paths();
  store.importScores([{ jobId: a.jobId, score: 90, verdict: 'strong' }]);
  for (const file of ['resume.md', 'cover-letter.md', 'answers.md']) writeFileSync(join(p.applicationsDir, a.dir, file), 'Synthetic material');
  const att = buildAttestation({ batchLimit: 2, ttlHours: 1, requireScore: 80 }); delete att.attestedAt;
  writeFileSync(p.autoAttestationFile, JSON.stringify(att));
  const policy = structuredClone(DEFAULT_POLICY); policy.approval.mode = 'auto';
  assert.throws(() => store.autoArm(a.id, { policy, hasResumePdf: true }), /damaged|expired/i);
  assert.equal(store.readSession(), null);
  assert.equal(readAttestation().invalid, true);
});

test('read-only status reports a journal left before approval was persisted', async () => {
  const { buildStatus } = await import('../src/pipeline/report.mjs');
  const a = queued(1); const journal = join(paths().stateDir, 'authorization-pending.json');
  writeFileSync(journal, JSON.stringify({ appId: a.id }));
  assert.equal(buildStatus().recoveryNeeded, true);
  assert.equal(store.getApp(a.id).status, 'queued'); assert.equal(existsSync(journal), true);
});

