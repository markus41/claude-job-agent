// JSON-file state store: jobs, applications, the armed apply-session, and the
// audit log. Volumes here are hundreds of records, so plain JSON with atomic
// writes beats dragging in a database. Swap this module out if you outgrow it.
import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './config.mjs';
import { ensureDir, nowIso, readJson, sha1, slugify, truncate, writeJsonAtomic } from './util.mjs';

// --- Jobs --------------------------------------------------------------------

export function loadJobs() {
  return readJson(paths().jobsFile, { version: 1, jobs: {} });
}

export function saveJobs(db) {
  writeJsonAtomic(paths().jobsFile, db);
}

export function upsertJobs(newJobs) {
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
}

export function getJob(jobId) {
  return loadJobs().jobs[jobId] ?? null;
}

export function importScores(entries) {
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
}

// --- Applications --------------------------------------------------------------

// Lifecycle: packaged → tailored → queued → approved → submitted → confirmed →
// interview → offer → closed, with blocked/withdrawn/rejected side-exits.
// "approved" is deliberately reachable ONLY through `jobagent approve`
// (human, interactive terminal) — never through `record`.
export const TRANSITIONS = {
  packaged: ['tailored', 'withdrawn'],
  tailored: ['queued', 'withdrawn'],
  queued: ['approved', 'blocked', 'withdrawn'],
  approved: ['submitted', 'blocked', 'queued', 'withdrawn'],
  submitted: ['confirmed', 'rejected', 'interview', 'blocked', 'closed'],
  confirmed: ['rejected', 'interview', 'closed'],
  interview: ['offer', 'rejected', 'closed'],
  blocked: ['queued', 'withdrawn', 'closed'],
  offer: ['closed'],
  rejected: ['closed'],
  withdrawn: [],
  closed: [],
};

export const ACTIVE_STATUSES = new Set([
  'packaged', 'tailored', 'queued', 'approved', 'submitted', 'confirmed', 'interview', 'blocked',
]);

export function loadApps() {
  return readJson(paths().appsFile, { version: 1, apps: {} });
}

export function saveApps(db) {
  writeJsonAtomic(paths().appsFile, db);
}

export function getApp(appId) {
  return loadApps().apps[appId] ?? null;
}

export function createApplication(job, { force = false } = {}) {
  const db = loadApps();
  const dup = Object.values(db.apps).find(
    (a) => a.jobId === job.id && ACTIVE_STATUSES.has(a.status)
  );
  if (dup && !force) {
    const err = new Error(`An active application for this job already exists: ${dup.id} (${dup.status}). Use --force to create another.`);
    err.code = 'EDUPLICATE';
    throw err;
  }
  const id = `app-${sha1(`${job.id}|${nowIso()}`).slice(0, 8)}`;
  const dirName = `${job.companySlug}-${truncate(slugify(job.title), 40).replace(/…$/, '')}-${id.slice(4)}`;
  const dir = join(paths().applicationsDir, dirName);
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
}

export function recordStatus(appId, status, { note = '', force = false, followUpDays = [7, 14] } = {}) {
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
  if (status === 'submitted') disarmSession({ quiet: true });
  appendAudit({ actor: 'cli', event: 'record', appId, status, note: truncate(note, 200) });
  return app;
}

// Called by `jobagent approve` only (which enforces the interactive-terminal check).
export function approveApplication(appId, { sessionTtlMinutes = 60 } = {}) {
  const db = loadApps();
  const app = db.apps[appId];
  if (!app) throw new Error(`Unknown application id: ${appId}`);
  if (app.status !== 'queued') {
    throw new Error(`Only "queued" applications can be approved. ${appId} is "${app.status}".`);
  }
  app.status = 'approved';
  app.history.push({ status: 'approved', at: nowIso(), note: 'human approval' });
  saveApps(db);
  const session = armSession(app, { ttlMinutes: sessionTtlMinutes });
  appendAudit({ actor: 'human', event: 'approve', appId, expiresAt: session.expiresAt });
  return { app, session };
}

// --- Apply session (arms the browser gate) ------------------------------------

export function armSession(app, { ttlMinutes = 60 } = {}) {
  let host = null;
  try {
    host = new URL(app.applyUrl).hostname.toLowerCase();
  } catch {
    throw new Error(`Application ${app.id} has no valid applyUrl (${app.applyUrl}).`);
  }
  const now = new Date();
  const session = {
    appId: app.id,
    jobId: app.jobId,
    hosts: [host],
    armedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
  };
  writeJsonAtomic(paths().sessionFile, session);
  return session;
}

export function readSession() {
  const session = readJson(paths().sessionFile, null);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return { ...session, expired: true };
  return session;
}

export function disarmSession({ quiet = false } = {}) {
  const p = paths().sessionFile;
  const existed = existsSync(p);
  if (existed) rmSync(p);
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
}

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
