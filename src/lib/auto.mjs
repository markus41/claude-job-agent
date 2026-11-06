// Batch preflight shares validated policy, package inspection and host rules.
import { paths } from './config.mjs';
import { nowIso, readJson } from './util.mjs';
import { inspectPackage } from './workspace.mjs';
import { hostMatches } from './gate.mjs';
import { assertWebUrl } from './intake.mjs';
import { validatePolicy } from './policy.mjs';

export function readAttestation() {
  const att = readJson(paths().autoAttestationFile, null);
  if (!att) return null;
  const invalid = !Number.isInteger(att.batchLimit) || att.batchLimit < 1
    || !Number.isInteger(att.used) || att.used < 0 || !Number.isFinite(att.requireScore)
    || att.requireScore < 0 || att.requireScore > 100 || !Number.isFinite(Date.parse(att.expiresAt));
  const expired = invalid || Date.parse(att.expiresAt) <= Date.now();
  const exhausted = invalid || att.used >= att.batchLimit;
  return { ...att, expired, exhausted, remaining: invalid ? 0 : Math.max(0, att.batchLimit - att.used) };
}

export function buildAttestation({ batchLimit, ttlHours, requireScore, note = '' }) {
  if (!Number.isInteger(batchLimit) || batchLimit < 1 || !Number.isFinite(ttlHours) || ttlHours <= 0) throw new Error('Invalid batch limit or duration');
  if (!Number.isFinite(requireScore) || requireScore < 0 || requireScore > 100) throw new Error('Invalid batch score floor');
  const now = new Date();
  return { batchLimit, used: 0, requireScore, note, attestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlHours * 3_600_000).toISOString(), submittedAppIds: [] };
}

function authorizationBlockers(policy, attestation) {
  const blockers = [];
  try { validatePolicy(policy); } catch (err) { blockers.push(err.message); }
  if (policy?.approval?.mode !== 'auto') blockers.push('auto mode is off (set approval.mode = "auto" in config/policy.json)');
  if (!attestation) return [...blockers, 'no batch authorization — a human must run jobagent auto-enable personally'];
  if (attestation.expired || !(Date.parse(attestation.expiresAt) > Date.now())) blockers.push('batch authorization expired at ' + attestation.expiresAt);
  if (attestation.exhausted || attestation.used >= attestation.batchLimit) blockers.push('batch authorization used up — needs re-authorizing');
  return blockers;
}

function scoreBlockers(job, policy, attestation) {
  const floor = Math.max(policy.approval.auto.requireScore, attestation?.requireScore ?? 0);
  const score = job?.score?.value;
  if (!Number.isFinite(score) || !Number.isFinite(floor)) return ['application has no valid fit score or score floor'];
  return score < floor ? [`fit score ${score} is below the auto-submit floor ${floor}`] : [];
}

function packageBlockers(app, cfg, hasResumePdf) {
  const packageState = inspectPackage(app);
  const blockers = [...packageState.blockers];
  if (cfg.blockOnNeedsHumanInput && packageState.needsHumanInput) blockers.push('answers.md still contains NEEDS HUMAN INPUT — human input required');
  if (cfg.requireResumePdf && !hasResumePdf && !packageState.resumePdf) blockers.push('no resume PDF available to upload');
  return blockers;
}

function volumeBlockers(app, apps, policy) {
  const today = nowIso().slice(0, 10);
  const submitted = Object.values(apps ?? {}).filter((a) => a.submittedAt?.slice(0, 10) === today);
  const blockers = [];
  if (submitted.length >= policy.caps.maxApplicationsPerDay) blockers.push('daily cap reached');
  const companyCount = submitted.filter((a) => a.companySlug === app.companySlug).length;
  if (companyCount >= policy.approval.auto.maxPerCompanyPerDay) blockers.push('already submitted application(s) to ' + app.company + ' today');
  return blockers;
}

function hostBlockers(app, policy) {
  try {
    const url = assertWebUrl(app.applyUrl, 'applyUrl');
    return hostMatches(url.hostname, policy.denylist.hosts) ? [url.hostname + ' is denylisted'] : [];
  } catch (err) { return [err.message]; }
}

export function autoPreflight({ app, job, policy, attestation, apps, hasResumePdf }) {
  const blockers = authorizationBlockers(policy, attestation);
  if (!app) return [...blockers, 'unknown application'];
  if (app.status !== 'queued') blockers.push(`application is "${app.status}", not "queued"`);
  try { validatePolicy(policy); } catch { return blockers; }
  return [...blockers, ...scoreBlockers(job, policy, attestation),
    ...packageBlockers(app, policy.approval.auto, hasResumePdf),
    ...volumeBlockers(app, apps, policy), ...hostBlockers(app, policy)];
}

