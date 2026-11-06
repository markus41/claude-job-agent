// Deterministic hard filters that run BEFORE any model sees a posting.
// Cheap, explainable, and they keep LLM scoring volume (and cost) down.
// Nuanced judgment belongs to the fit-scorer agent, not here.
import { annualize } from './comp.mjs';
import { normTitle } from './util.mjs';

const DAY_MS = 86_400_000;

function containsAny(haystack, needles = []) {
  const text = String(haystack ?? '').toLowerCase();
  for (const n of needles) {
    const needle = String(n).toLowerCase().trim();
    if (needle && text.includes(needle)) return needle;
  }
  return null;
}

// appsIndex: built once per run via buildAppsIndex() — avoids re-reading state per job.
export function buildAppsIndex(apps) {
  const index = new Set();
  for (const app of Object.values(apps ?? {})) {
    if (app.status === 'withdrawn') continue;
    index.add(`${app.companySlug}|${normTitle(app.title)}`);
  }
  return index;
}

function compensationReason(job, floor) {
  if (!floor || !job.comp) return null;
  const annual = annualize(job.comp);
  const top = annual?.max ?? annual?.min;
  return top != null && top < floor ? `comp-below-floor:${top}<${floor}` : null;
}

function staleReason(job, maxAgeDays) {
  if (!job.postedAt) return null;
  const age = (Date.now() - new Date(job.postedAt).getTime()) / DAY_MS;
  return Number.isFinite(age) && age > maxAgeDays ? `stale:${Math.round(age)}d` : null;
}

export function hardFilter(job, profile, appsIndex, policy) {
  const reasons = [];
  const targets = profile.targets ?? {};
  const caps = policy?.caps ?? {};

  // 1. Title exclusions ("staff accountant" ≠ "staff engineer" is your problem to encode).
  const excluded = containsAny(job.title, targets.titleKeywordsExclude);
  if (excluded) reasons.push(`title-excluded:${excluded}`);

  // 2. Title inclusions — only enforced when the list is non-empty.
  const includes = targets.titleKeywordsInclude ?? [];
  if (includes.length && !containsAny(job.title, includes)) {
    reasons.push('title-no-include-match');
  }

  // 3. Workplace / location. Unknown workplace passes (the scorer flags it).
  if (targets.remote === 'remote-only' && (job.workplace === 'onsite' || job.workplace === 'hybrid')) {
    const locationOk = containsAny(job.location, targets.locations ?? []);
    if (!locationOk) reasons.push(`workplace-mismatch:${job.workplace}`);
  }

  // 4. Compensation floor — only when the posting states comp.
  const compReason = compensationReason(job, targets.salaryFloor);
  if (compReason) reasons.push(compReason);

  // 5. Deal-breakers anywhere in the description.
  const dealBreaker = containsAny(job.descriptionText, targets.dealBreakers);
  if (dealBreaker) reasons.push(`deal-breaker:${dealBreaker}`);

  // 6. Already applied to this company for the same title family.
  if (appsIndex?.has(`${job.companySlug}|${normTitle(job.title)}`)) {
    reasons.push('already-applied');
  }

  // 7. Stale postings.
  const maxAgeDays = caps.maxJobAgeDays ?? 60;
  const stale = staleReason(job, maxAgeDays);
  if (stale) reasons.push(stale);

  return { pass: reasons.length === 0, reasons };
}
