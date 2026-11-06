// Deterministic scored-to-tailoring handoff shared by /hunt and /tailor.
import { hardFilter, buildAppsIndex } from '../lib/filters.mjs';
import { ACTIVE_STATUSES, loadApps, loadJobs } from '../lib/store.mjs';

const verdictOrder = { strong: 0, good: 1 };

export function selectForTailoring(profile, policy, { limit = policy.tailor.topN } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Selection limit must be a positive integer');
  const max = Math.min(limit, policy.tailor.topN);
  const apps = Object.values(loadApps().apps).filter((a) => ACTIVE_STATUSES.has(a.status));
  const index = buildAppsIndex(Object.fromEntries(apps.map((a) => [a.id, a])));
  const packaged = new Set(apps.map((a) => a.jobId));
  const items = Object.values(loadJobs().jobs)
    .filter((job) => job.score && job.score.verdict in verdictOrder && Number.isFinite(job.score.value))
    .filter((job) => job.score.value >= policy.tailor.minScore && !packaged.has(job.id))
    .filter((job) => hardFilter(job, profile, index, policy).pass)
    .sort((a, b) => verdictOrder[a.score.verdict] - verdictOrder[b.score.verdict]
      || b.score.value - a.score.value || a.id.localeCompare(b.id))
    .slice(0, max);
  return { limit: max, items };
}

