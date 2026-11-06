// Canonical job validation shared by every intake adapter and the store.
const fail = (field, rule) => { throw new Error(`Invalid job ${field}: ${rule}`); };

export function assertWebUrl(value, field = 'url') {
  let url;
  try { url = new URL(value); } catch { fail(field, 'must be an HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    fail(field, 'must be an HTTP(S) URL without credentials');
  }
  return url;
}

function assertText(value, field, { optional = false } = {}) {
  if (optional && value == null) return;
  if (typeof value !== 'string' || (!optional && !value.trim())) fail(field, 'must be text');
}

export function assertCompanySlug(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    fail('companySlug', 'unsafe identifier; use letters, numbers, dots, underscores or hyphens');
  }
}

function assertComp(comp) {
  if (comp == null) return;
  if (typeof comp !== 'object' || Array.isArray(comp)) fail('comp', 'must be an object');
  for (const key of ['min', 'max']) {
    if (comp[key] != null && (!Number.isFinite(comp[key]) || comp[key] < 0)) fail(`comp.${key}`, 'must be a non-negative number');
  }
  if (!/^[A-Z]{3}$/.test(comp.currency ?? '')) fail('comp.currency', 'must be a currency code');
  if (!['hourly', 'yearly'].includes(comp.interval)) fail('comp.interval', 'must be hourly or yearly');
  if (comp.min != null && comp.max != null && comp.min > comp.max) fail('comp', 'min must not exceed max');
}

export function assertCanonicalJob(job) {
  if (!job || typeof job !== 'object') fail('record', 'must be an object');
  for (const field of ['id', 'ats', 'company', 'title']) assertText(job[field], field);
  assertCompanySlug(job.companySlug);
  assertWebUrl(job.url);
  assertWebUrl(job.applyUrl ?? job.url, 'applyUrl');
  for (const field of ['location', 'descriptionText']) assertText(job[field], field, { optional: true });
  if (job.workplace != null && !['remote', 'hybrid', 'onsite'].includes(job.workplace)) fail('workplace', 'invalid value');
  if (job.postedAt != null && !Number.isFinite(Date.parse(job.postedAt))) fail('postedAt', 'must be a valid date');
  assertComp(job.comp);
  return job;
}

export function assertManualEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('entry', 'must be an object');
  const missing = ['company', 'title', 'url'].filter((key) => !entry[key]);
  if (missing.length) throw new Error(`Manual job entry missing required field(s): ${missing.join(', ')}`);
  for (const field of ['company', 'title']) assertText(entry[field], field);
  for (const field of ['description', 'descriptionText', 'location']) assertText(entry[field], field, { optional: true });
  if (entry.companySlug != null) assertCompanySlug(entry.companySlug);
  assertWebUrl(entry.url);
  if (entry.applyUrl != null) assertWebUrl(entry.applyUrl, 'applyUrl');
}

