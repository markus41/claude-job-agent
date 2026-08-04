// Greenhouse Job Board API (public, unauthenticated, read-only).
// Docs: https://developers.greenhouse.io/job-board.html
import { fetchJson } from './http.mjs';
import { normalizeGreenhouse } from '../lib/normalize.mjs';

export const ats = 'greenhouse';

export async function fetchJobs(target) {
  if (target.region === 'eu') {
    throw new Error(
      `${target.company}: EU-hosted Greenhouse boards are not supported yet — verify the EU API host before adding support.`
    );
  }
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(target.slug)}/jobs?content=true`;
  const body = await fetchJson(url);
  if (!Array.isArray(body?.jobs)) {
    throw new Error(`${target.company}: unexpected Greenhouse response shape (no "jobs" array) from ${url}`);
  }
  return body.jobs.map((raw) => normalizeGreenhouse(target, raw));
}
