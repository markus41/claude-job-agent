// Shared polite HTTP helper for the read-only ATS clients.
const USER_AGENT = 'claude-job-agent/0.1 (+https://github.com/markus41/claude-job-agent)';

export async function fetchJson(url, { timeoutMs = 20_000 } = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(`Request failed for ${url}: ${err.message}`);
  }
  if (res.status === 404) {
    throw new Error(`404 from ${url} — the board slug is probably wrong (try \`jobagent detect <careers-page-url>\`).`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.json();
}
