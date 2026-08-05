// Auto-submit mode: batch authorization instead of per-application approval.
//
// The human still authorizes every submission — just up front, in bulk:
// `jobagent auto-enable` (TTY-only, typed confirmation) writes an attestation
// covering N applications for H hours. The agent may then call
// `jobagent auto-arm <appId>`, which arms the browser gate automatically for
// one application IF every preflight check below passes.
//
// Note what does NOT change: the PreToolUse gate still only lets browser
// tools run against an armed session, still enforces the host allowlist and
// aggregator denylist, still blocks credential-shaped input and out-of-tree
// uploads. Auto mode changes who may arm a session, not what the gate checks.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './config.mjs';
import { nowIso, readJson } from './util.mjs';

const HOUR_MS = 3_600_000;

export function readAttestation() {
  const att = readJson(paths().autoAttestationFile, null);
  if (!att) return null;
  const expired = new Date(att.expiresAt).getTime() <= Date.now();
  const exhausted = (att.used ?? 0) >= att.batchLimit;
  return { ...att, expired, exhausted, remaining: Math.max(0, att.batchLimit - (att.used ?? 0)) };
}

export function buildAttestation({ batchLimit, ttlHours, requireScore, note = '' }) {
  const now = new Date();
  return {
    batchLimit,
    used: 0,
    requireScore,
    note,
    attestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlHours * HOUR_MS).toISOString(),
    submittedAppIds: [],
  };
}

/**
 * Every reason auto-submit must refuse this application. Empty array = clear.
 * Pure except for reading the package files on disk.
 *
 * @param {object} ctx {app, job, policy, attestation, apps, hasResumePdf}
 */
export function autoPreflight({ app, job, policy, attestation, apps, hasResumePdf }) {
  const blockers = [];
  const cfg = policy?.approval?.auto ?? {};

  if (policy?.approval?.mode !== 'auto') {
    blockers.push('auto mode is off (set approval.mode = "auto" in config/policy.json)');
  }
  if (!attestation) {
    blockers.push('no batch authorization — a human must run `jobagent auto-enable` in their own terminal');
  } else {
    if (attestation.expired) blockers.push(`batch authorization expired at ${attestation.expiresAt}`);
    if (attestation.exhausted) {
      blockers.push(`batch authorization used up (${attestation.used}/${attestation.batchLimit}) — needs re-authorizing`);
    }
  }
  if (!app) {
    blockers.push('unknown application');
    return blockers;
  }
  if (app.status !== 'queued') {
    blockers.push(`application is "${app.status}", not "queued"`);
  }

  // Fit-score floor: the attested floor wins if it is stricter.
  const floor = Math.max(cfg.requireScore ?? 80, attestation?.requireScore ?? 0);
  const score = job?.score?.value;
  if (score == null) blockers.push('application has no fit score');
  else if (score < floor) blockers.push(`fit score ${score} is below the auto-submit floor ${floor}`);

  // The package must be complete.
  const dir = join(paths().applicationsDir, app.dir ?? '');
  for (const file of ['resume.md', 'cover-letter.md', 'answers.md']) {
    if (!existsSync(join(dir, file))) blockers.push(`package is missing ${file}`);
  }

  // Unanswered screening questions can never be machine-answered.
  if (cfg.blockOnNeedsHumanInput !== false) {
    const answersPath = join(dir, 'answers.md');
    if (existsSync(answersPath)) {
      const text = readFileSync(answersPath, 'utf8');
      if (/NEEDS HUMAN INPUT/i.test(text)) {
        blockers.push('answers.md still contains NEEDS HUMAN INPUT — a human must answer those questions');
      }
    }
  }

  if (cfg.requireResumePdf !== false && !hasResumePdf) {
    blockers.push('no resume PDF available to upload (export profile/resume.pdf or upload one)');
  }

  // Volume caps.
  const today = nowIso().slice(0, 10);
  const all = Object.values(apps ?? {});
  const submittedToday = all.filter((a) => a.submittedAt?.slice(0, 10) === today).length;
  const dailyCap = policy?.caps?.maxApplicationsPerDay ?? 10;
  if (submittedToday >= dailyCap) {
    blockers.push(`daily cap reached (${submittedToday}/${dailyCap} submitted today)`);
  }
  const perCompanyCap = cfg.maxPerCompanyPerDay ?? 1;
  const companyToday = all.filter(
    (a) => a.companySlug === app.companySlug && a.submittedAt?.slice(0, 10) === today
  ).length;
  if (companyToday >= perCompanyCap) {
    blockers.push(`already submitted ${companyToday} application(s) to ${app.company} today (cap ${perCompanyCap})`);
  }

  // Aggregators are never auto-submittable (nor manually — the gate refuses too).
  try {
    const host = new URL(app.applyUrl).hostname.toLowerCase();
    for (const pattern of policy?.denylist?.hosts ?? []) {
      const p = String(pattern).toLowerCase();
      const hit = p.startsWith('*.')
        ? host === p.slice(2) || host.endsWith(`.${p.slice(2)}`)
        : host === p;
      if (hit) blockers.push(`${host} is denylisted (site terms prohibit automated applications)`);
    }
  } catch {
    blockers.push(`application has no valid applyUrl (${app.applyUrl})`);
  }

  return blockers;
}
