// Permission is published last. A pending receipt is never authorization.
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './config.mjs';
import { assertWebUrl } from './intake.mjs';
import { readJson, writeJsonAtomic } from './util.mjs';

export const authorizationJournal = () => join(paths().stateDir, 'authorization-pending.json');

export function prepareSession(app, { ttlMinutes = 60, attestation } = {}) {
  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) throw new Error('Session TTL must be a positive finite number');
  const url = assertWebUrl(app.applyUrl, 'applyUrl');
  const now = Date.now();
  let expires = now + ttlMinutes * 60_000;
  if (attestation) expires = Math.min(expires, Date.parse(attestation.expiresAt));
  if (!Number.isFinite(expires) || expires <= now) throw new Error('Authorization has expired');
  return {
    appId: app.id, jobId: app.jobId, hosts: [url.hostname.toLowerCase()],
    armedAt: new Date(now).toISOString(), expiresAt: new Date(expires).toISOString(),
    ...(attestation ? { autoAttestedAt: attestation.attestedAt } : {}),
  };
}

export function rawSession() { return readJson(paths().sessionFile, null); }

export function assertNoActiveSession() {
  const session = rawSession();
  if (session && Date.parse(session.expiresAt) > Date.now()) throw new Error('An active armed session already exists; disarm it before authorizing another application');
}

export function commitAuthorization({ app, session, persist, audit }) {
  writeJsonAtomic(authorizationJournal(), { version: 1, appId: app.id, startedAt: new Date().toISOString() });
  persist();
  writeJsonAtomic(paths().sessionFile, session);
  audit();
  rmSync(authorizationJournal());
}

export function recoverState({ loadApps, saveApps, audit, isSessionValid }) {
  const pending = existsSync(authorizationJournal());
  const session = rawSession();
  const db = loadApps();
  const stale = !session || !isSessionValid();
  if (!pending && !stale) return { recovered: false };
  if (existsSync(paths().sessionFile)) rmSync(paths().sessionFile);
  let changed = false;
  for (const app of Object.values(db.apps)) {
    if (app.status !== 'approved') continue;
    app.status = 'queued';
    app.history.push({ status: 'queued', at: new Date().toISOString(), note: 'authorization recovery; fresh authorization required' });
    changed = true;
  }
  if (changed) saveApps(db);
  if (pending) rmSync(authorizationJournal());
  if (pending || changed) audit({ actor: 'cli', event: 'authorization-recovered', interrupted: pending });
  return { recovered: pending || changed };
}

