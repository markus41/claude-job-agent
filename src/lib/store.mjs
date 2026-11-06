// JSON-file state store: jobs, applications, the armed apply-session, and the
// audit log. Volumes here are hundreds of records, so plain JSON with atomic
// writes beats dragging in a database. Swap this module out if you outgrow it.
import { appendFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './config.mjs';
import { autoPreflight, readAttestation } from './auto.mjs';
import { ensureDir, nowIso, readJson, sha1, slugify, truncate, writeJsonAtomic } from './util.mjs';
import { writeTrackerFiles } from './workbook.mjs';
import { assertCanonicalJob } from './intake.mjs';
import { TRANSITIONS, ACTIVE_STATUSES, applicationIdentity } from './lifecycle.mjs';
import { applicationPath } from './package-paths.mjs';
import { stateMutation } from './state-mutation.mjs';
import { followUpDraftName, updateFollowUp } from './follow-ups.mjs';
import { authorizationJournal, assertNoActiveSession, commitAuthorization, prepareSession, rawSession, recoverState } from './authorization.mjs';

// --- Jobs --------------------------------------------------------------------

export function loadJobs() {
  return readJson(paths().jobsFile, { version: 1, jobs: {} });
}

export function saveJobs(db) {
  writeJsonAtomic(paths().jobsFile, db);
}

export const upsertJobs = stateMutation(function upsertJobs(newJobs) {
  newJobs.forEach(assertCanonicalJob);
  const db = loadJobs();
  let added = 0;
  let seenAgain = 0;
  for (const job of newJobs) {
    const existing = db.jobs[job.id];
    if (existing) {
      // Refresh listing fields but preserve first-seen time and any score.
      db.jobs[job.id] = {
        ...existing,
        ...job,
        discoveredAt: existing.discoveredAt,
        score: existing.score,
        lastSeenAt: nowIso(),
      };
      seenAgain += 1;
    } else {
      db.jobs[job.id] = job;
      added += 1;
    }
  }
  saveJobs(db);
  return { added, seenAgain, total: Object.keys(db.jobs).length };
});

export function getJob(jobId) {
  return loadJobs().jobs[jobId] ?? null;
}

export const importScores = stateMutation(function importScores(entries) {
  if (!Array.isArray(entries)) throw new Error('Scores file must be a JSON array.');
  const db = loadJobs();
  const errors = [];
  const VERDICTS = new Set(['strong', 'good', 'weak', 'reject']);
  entries.forEach((e, i) => {
    if (!e || typeof e !== 'object') return errors.push(`row ${i}: not an object`);
    if (!db.jobs[e.jobId]) return errors.push(`row ${i}: unknown jobId "${e.jobId}"`);
    if (typeof e.score !== 'number' || e.score < 0 || e.score > 100) {
      return errors.push(`row ${i}: score must be a number 0-100`);
    }
    if (!VERDICTS.has(e.verdict)) {
      return errors.push(`row ${i}: verdict must be one of ${[...VERDICTS].join('|')}`);
    }
  });
  if (errors.length) {
    const err = new Error(`Score import rejected (no rows merged):\n  ${errors.join('\n  ')}`);
    err.code = 'EVALIDATION';
    throw err;
  }
  for (const e of entries) {
    db.jobs[e.jobId].score = {
      value: e.score,
      verdict: e.verdict,
      mustHaveGaps: e.mustHaveGaps ?? [],
      niceToHaveGaps: e.niceToHaveGaps ?? [],
      flags: e.flags ?? [],
      summary: e.summary ?? '',
      scoredAt: nowIso(),
    };
  }
  saveJobs(db);
  return { merged: entries.length };
});

// --- Applications --------------------------------------------------------------

// Lifecycle: packaged → tailored → queued → approved → submitted → confirmed →
// interview → offer → closed, with blocked/withdrawn/rejected side-exits.
// Approval comes from a human terminal or auto-arm under a human attestation;
// it is never reachable through record.
export { TRANSITIONS, ACTIVE_STATUSES } from './lifecycle.mjs';
export function loadApps() {
  return readJson(paths().appsFile, { version: 1, apps: {} });
}

export const saveApps = stateMutation(function saveApps(db) {
  writeJsonAtomic(paths().appsFile, db);
  refreshTracker(db);
});

// Human-readable live view of the pipeline: data/applications.xlsx + .csv.
// A view, never the ledger — if writing it fails, the state write still stands.
export function refreshTracker(appsDb) {
  try {
    const db = appsDb ?? loadApps();
    writeTrackerFiles(db.apps, loadJobs().jobs);
    return true;
  } catch (err) {
    // Most common cause on Windows: applications.xlsx is open in Excel, which
    // locks the file. The state write already succeeded; the view is stale
    // until the next change after the file is closed.
    appendAudit({
      actor: 'cli',
      event: 'tracker-write-failed',
      error: err.message,
      hint: 'close data/applications.xlsx if it is open, then make any state change to refresh it',
    });
    return false;
  }
}

export function getApp(appId) {
  return loadApps().apps[appId] ?? null;
}

export const createApplication = stateMutation(function createApplication(job, { force = false } = {}) {
  assertCanonicalJob(job);
  const db = loadApps();
  const dup = Object.values(db.apps).find(
    (a) => ACTIVE_STATUSES.has(a.status) && (a.jobId === job.id || applicationIdentity(a) === applicationIdentity(job))
  );
  if (dup && !force) {
    const err = new Error(`An active application for this job or company/title already exists: ${dup.id} (${dup.status}). Use --force to create another.`);
    err.code = 'EDUPLICATE';
    throw err;
  }
  const id = `app-${sha1(`${job.id}|${nowIso()}`).slice(0, 8)}`;
  const dirName = `${job.companySlug}-${truncate(slugify(job.title), 40).replace(/…$/, '')}-${id.slice(4)}`;
  const dir = applicationPath(dirName);
  ensureDir(dir);
  writeJsonAtomic(join(dir, 'job.json'), job);

  const app = {
    id,
    jobId: job.id,
    company: job.company,
    companySlug: job.companySlug,
    title: job.title,
    applyUrl: job.applyUrl ?? job.url,
    dir: dirName,
    status: 'packaged',
    createdAt: nowIso(),
    submittedAt: null,
    history: [{ status: 'packaged', at: nowIso(), note: 'application package created' }],
    followUps: { due: [], done: [] },
  };
  db.apps[id] = app;
  saveApps(db);
  appendAudit({ actor: 'cli', event: 'package', appId: id, jobId: job.id });
  return app;
});

export const recordStatus = stateMutation(function recordStatus(appId, status, { note = '', force = false, followUpDays = [7, 14] } = {}) {
  if (status === 'approved') {
    const err = new Error('Status "approved" can only be set via `jobagent approve` (human, interactive terminal).');
    err.code = 'EAPPROVALPATH';
    throw err;
  }
  const db = loadApps();
  const app = db.apps[appId];
  if (!app) throw new Error(`Unknown application id: ${appId}`);
  const allowed = TRANSITIONS[app.status] ?? [];
  if (!allowed.includes(status) && !force) {
    const err = new Error(
      `Invalid transition ${app.status} → ${status} for ${appId}. Allowed: ${allowed.join(', ') || '(terminal)'}. Use --force to override.`
    );
    err.code = 'ETRANSITION';
    throw err;
  }
  app.status = status;
  app.history.push({ status, at: nowIso(), note });
  if (status === 'submitted') {
    app.submittedAt = nowIso();
    app.followUps.due = followUpDays.map((d) => {
      const t = new Date();
      t.setUTCDate(t.getUTCDate() + d);
      return t.toISOString();
    });
  }
  saveApps(db);
  if (status !== 'approved' && rawSession()?.appId === appId) disarmSession({ quiet: true });
  appendAudit({ actor: 'cli', event: 'record', appId, status, note: truncate(note, 200) });
  return app;
});

// --- Auto-submit mode ----------------------------------------------------------

// Written only by `jobagent auto-enable` (TTY-only, typed confirmation).
export const saveAttestation = stateMutation(function saveAttestation(att) {
  writeJsonAtomic(paths().autoAttestationFile, att);
  appendAudit({
    actor: 'human',
    event: 'auto-enable',
    batchLimit: att.batchLimit,
    requireScore: att.requireScore,
    expiresAt: att.expiresAt,
  });
  return att;
});

export const revokeAttestation = stateMutation(function revokeAttestation() {
  const p = paths().autoAttestationFile;
  const existed = existsSync(p);
  if (existed) rmSync(p);
  disarmSession({ quiet: true });
  appendAudit({ actor: 'cli', event: 'auto-revoke' });
  return existed;
});

// Agents MAY call this (via `jobagent auto-arm`). It arms the browser gate for
// one application only if autoPreflight() returns no blockers, and consumes
// one unit of the human's attested batch.
export const autoArm = stateMutation(function autoArm(appId, { policy, hasResumePdf }) {
  recoverAuthorization();
  const db = loadApps();
  const app = db.apps[appId];
  const job = app ? loadJobs().jobs[app.jobId] : null;
  const attestation = readAttestation();

  const blockers = autoPreflight({ app, job, policy, attestation, apps: db.apps, hasResumePdf });
  if (blockers.length) {
    appendAudit({ actor: 'agent', event: 'auto-arm-refused', appId, blockers });
    const err = new Error(`auto-submit refused for ${appId}:\n  - ${blockers.join('\n  - ')}`);
    err.code = 'EAUTOBLOCKED';
    err.blockers = blockers;
    throw err;
  }

  assertNoActiveSession();
  const session = prepareSession(app, { ttlMinutes: policy?.approval?.sessionTtlMinutes ?? 60, attestation });
  app.status = 'approved';
  app.history.push({
    status: 'approved',
    at: nowIso(),
    note: `auto-approval under batch attested ${attestation.attestedAt} (${(attestation.used ?? 0) + 1}/${attestation.batchLimit})`,
  });
  const updated = {
    ...attestation,
    used: (attestation.used ?? 0) + 1,
    submittedAppIds: [...(attestation.submittedAppIds ?? []), appId],
  };
  delete updated.expired;
  delete updated.exhausted;
  delete updated.remaining;
  commitAuthorization({
    app, session,
    persist: () => { writeJsonAtomic(paths().autoAttestationFile, updated); saveApps(db); },
    audit: () => appendAudit({
    actor: 'agent',
    event: 'auto-arm',
    appId,
    used: updated.used,
    batchLimit: updated.batchLimit,
    expiresAt: session.expiresAt,
    }),
  });
  return { app, session, attestation: updated };
});

// Called by `jobagent approve` only (which enforces the interactive-terminal check).
export const approveApplication = stateMutation(function approveApplication(appId, { sessionTtlMinutes = 60 } = {}) {
  recoverAuthorization();
  assertNoActiveSession();
  const db = loadApps();
  const app = db.apps[appId];
  if (!app) throw new Error(`Unknown application id: ${appId}`);
  if (app.status !== 'queued') {
    throw new Error(`Only "queued" applications can be approved. ${appId} is "${app.status}".`);
  }
  const session = prepareSession(app, { ttlMinutes: sessionTtlMinutes });
  app.status = 'approved';
  app.history.push({ status: 'approved', at: nowIso(), note: 'human approval' });
  commitAuthorization({ app, session, persist: () => saveApps(db),
    audit: () => appendAudit({ actor: 'human', event: 'approve', appId, expiresAt: session.expiresAt }) });
  return { app, session };
});

// --- Apply session (arms the browser gate) ------------------------------------

export function readSession() {
  if (existsSync(authorizationJournal())) return null;
  const session = rawSession();
  if (!session) return null;
  if (loadApps().apps[session.appId]?.status !== 'approved') return null;
  if (session.autoAttestedAt) {
    const att = readAttestation();
    if (!att || att.expired || att.attestedAt !== session.autoAttestedAt) return null;
  }
  if (!(Date.parse(session.expiresAt) > Date.now())) return { ...session, expired: true };
  return session;
}

export const disarmSession = stateMutation(function disarmSession({ quiet = false } = {}) {
  const p = paths().sessionFile;
  const existed = existsSync(p);
  if (existed) rmSync(p);
  if (existsSync(authorizationJournal())) rmSync(authorizationJournal());
  // If an app is stuck in "approved" with no armed session, drop it back to queued.
  const db = loadApps();
  for (const app of Object.values(db.apps)) {
    if (app.status === 'approved') {
      app.status = 'queued';
      app.history.push({ status: 'queued', at: nowIso(), note: 'session disarmed' });
    }
  }
  saveApps(db);
  if (!quiet) appendAudit({ actor: 'cli', event: 'disarm' });
  return existed;
});

export const recoverAuthorization = stateMutation(function recoverAuthorization() {
  return recoverState({ loadApps, saveApps, audit: appendAudit, isSessionValid: () => {
    const session = readSession();
    return session && !session.expired;
  } });
});

export const recordFollowUp = stateMutation(function recordFollowUp(appId, dueAt, options = {}) {
  const db = loadApps();
  const app = db.apps[appId];
  if (!app) throw new Error('Unknown application id: ' + appId);
  if (!options.complete) {
    const draft = join(applicationPath(app.dir), followUpDraftName(dueAt));
    if (!existsSync(draft) || !statSync(draft).isFile()) throw new Error('Write the follow-up draft before recording it');
  }
  if (updateFollowUp(app, dueAt, options)) {
    saveApps(db);
    appendAudit({ actor: options.complete ? 'human' : 'agent', event: options.complete ? 'follow-up-complete' : 'follow-up-draft', appId, dueAt });
  }
  return app;
});

// --- Counters & audit ----------------------------------------------------------

export function submittedToday() {
  const today = nowIso().slice(0, 10);
  return Object.values(loadApps().apps).filter(
    (a) => a.submittedAt && a.submittedAt.slice(0, 10) === today
  ).length;
}

export function appendAudit(entry) {
  const p = paths();
  mkdirSync(p.dataDir, { recursive: true });
  appendFileSync(p.auditFile, `${JSON.stringify({ ts: nowIso(), ...entry })}\n`);
}
