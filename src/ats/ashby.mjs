// Ashby Posting API (public, unauthenticated, read-only).
// Docs: https://developers.ashbyhq.com/reference/jobpostingapi
import { fetchJson } from './http.mjs';
import { normalizeAshby } from '../lib/normalize.mjs';

export const ats = 'ashby';

export async function fetchJobs(target) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(target.slug)}?includeCompensation=true`;
  const body = await fetchJson(url);
  if (!Array.isArray(body?.jobs)) {
    throw new Error(`${target.company}: unexpected Ashby response shape (no "jobs" array) from ${url}`);
  }
  return body.jobs
    .filter((raw) => raw?.isListed !== false)
    .map((raw) => normalizeAshby(target, raw));
}
