// Applies the deterministic hard filters to every unscored job and writes the
// shortlist file the fit-scorer agent consumes.
import { paths } from '../lib/config.mjs';
import { buildAppsIndex, hardFilter } from '../lib/filters.mjs';
import { loadApps, loadJobs } from '../lib/store.mjs';
import { nowIso, truncate, writeJsonAtomic } from '../lib/util.mjs';

export function shortlist(profile, policy, { limit, rescore = false } = {}) {
  const jobsDb = loadJobs();
  const appsIndex = buildAppsIndex(loadApps().apps);
  const max = limit ?? policy.caps.shortlistLimit ?? 40;
  const descChars = policy.caps.descriptionChars ?? 3500;

  const rejected = {};
  const candidates = [];

  const all = Object.values(jobsDb.jobs)
    .sort((a, b) => String(b.postedAt ?? b.discoveredAt).localeCompare(String(a.postedAt ?? a.discoveredAt)));

  for (const job of all) {
    if (job.score && !rescore) continue;
    const { pass, reasons } = hardFilter(job, profile, appsIndex, policy);
    if (!pass) {
      for (const r of reasons) {
        const key = r.split(':')[0];
        rejected[key] = (rejected[key] ?? 0) + 1;
      }
      continue;
    }
    candidates.push(job);
  }

  const items = candidates.slice(0, max).map((job) => ({
    jobId: job.id,
    company: job.company,
    title: job.title,
    location: job.location,
    workplace: job.workplace,
    comp: job.comp,
    postedAt: job.postedAt,
    url: job.url,
    descriptionText: truncate(job.descriptionText, descChars),
  }));

  const result = {
    generatedAt: nowIso(),
    totalJobs: Object.keys(jobsDb.jobs).length,
    eligible: candidates.length,
    truncatedTo: items.length,
    rejectedCounts: rejected,
    items,
  };
  writeJsonAtomic(paths().shortlistFile, result);
  return result;
}
