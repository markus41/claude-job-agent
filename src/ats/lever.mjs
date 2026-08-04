// Lever Postings API (public, unauthenticated, read-only).
// Docs: https://github.com/lever/postings-api
import { fetchJson } from './http.mjs';
import { normalizeLever } from '../lib/normalize.mjs';

export const ats = 'lever';

export async function fetchJobs(target) {
  const base = target.region === 'eu' ? 'https://api.eu.lever.co' : 'https://api.lever.co';
  const url = `${base}/v0/postings/${encodeURIComponent(target.slug)}?mode=json`;
  const body = await fetchJson(url);
  if (!Array.isArray(body)) {
    throw new Error(`${target.company}: unexpected Lever response shape (expected an array) from ${url}`);
  }
  return body.map((raw) => normalizeLever(target, raw));
}
