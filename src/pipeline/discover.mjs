// Polls every known-ATS target in config/companies.json, normalizes, and
// upserts into the jobs store. Targets without a known ATS are returned so the
// job-discovery agent can chase them via Firecrawl.
import { getSource } from '../ats/index.mjs';
import { upsertJobs } from '../lib/store.mjs';
import { sleep } from '../lib/util.mjs';

const POLITENESS_DELAY_MS = 400;

export async function discover(targets, { log = () => {} } = {}) {
  const summary = { companies: [], unknown: [], added: 0, seenAgain: 0, errors: 0 };

  for (const target of targets) {
    if (!target.ats || !target.slug) {
      summary.unknown.push(target);
      continue;
    }
    const source = getSource(target.ats);
    if (!source) {
      summary.unknown.push(target);
      continue;
    }
    try {
      const jobs = await source.fetchJobs(target);
      const { added, seenAgain } = upsertJobs(jobs);
      summary.companies.push({ company: target.company, ats: target.ats, fetched: jobs.length, added });
      summary.added += added;
      summary.seenAgain += seenAgain;
      log(`  ${target.company} (${target.ats}): ${jobs.length} open roles, ${added} new`);
    } catch (err) {
      summary.errors += 1;
      summary.companies.push({ company: target.company, ats: target.ats, error: err.message });
      log(`  ${target.company} (${target.ats}): ERROR ${err.message}`);
    }
    await sleep(POLITENESS_DELAY_MS);
  }

  return summary;
}
