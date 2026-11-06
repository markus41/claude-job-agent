// Normalizes raw ATS payloads into the single job schema used everywhere else.
//
// Job schema:
// {
//   id: "greenhouse:acme:4444",       // `${ats}:${companySlug}:${externalId}`
//   ats: "greenhouse" | "lever" | "ashby" | "manual",
//   company, companySlug,
//   title, location,                  // location is a display string or null
//   workplace: "remote" | "hybrid" | "onsite" | null,
//   url, applyUrl,
//   descriptionText,                  // plain text
//   comp: { min, max, currency, interval } | null,
//   postedAt, discoveredAt, lastSeenAt  // ISO strings (postedAt may be null)
// }
import { extractComp } from './comp.mjs';
import { assertCanonicalJob, assertManualEntry } from './intake.mjs';
import { decodeEntities, nowIso, sha1, slugify, stripHtml } from './util.mjs';

export function workplaceFromText(...fragments) {
  const text = fragments.filter(Boolean).join(' ').toLowerCase();
  if (!text) return null;
  if (/\bremote\b|work from home|wfh|distributed/.test(text)) return 'remote';
  if (/\bhybrid\b/.test(text)) return 'hybrid';
  if (/\bon[- ]?site\b|\bin[- ]?office\b/.test(text)) return 'onsite';
  return null;
}

function finalizeJob(partial) {
  const now = nowIso();
  const job = {
    ats: partial.ats,
    company: partial.company,
    companySlug: partial.companySlug,
    title: partial.title ?? '(untitled)',
    location: partial.location ?? null,
    workplace: partial.workplace ?? null,
    url: partial.url ?? null,
    applyUrl: partial.applyUrl ?? partial.url ?? null,
    descriptionText: partial.descriptionText ?? '',
    comp: partial.comp ?? null,
    postedAt: partial.postedAt ?? null,
    discoveredAt: now,
    lastSeenAt: now,
  };
  const externalId = partial.externalId ?? sha1(job.url ?? `${job.company}|${job.title}`).slice(0, 10);
  job.id = `${job.ats}:${job.companySlug}:${externalId}`;
  return assertCanonicalJob(job);
}

// --- Greenhouse ------------------------------------------------------------
// GET https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true
// Job "content" is HTML-escaped HTML; location is { name }.
export function normalizeGreenhouse(target, raw) {
  const location = raw.location?.name
    ?? (Array.isArray(raw.offices) ? raw.offices.map((o) => o?.name).filter(Boolean).join('; ') : null)
    ?? null;
  const descriptionText = stripHtml(decodeEntities(raw.content ?? ''));
  return finalizeJob({
    ats: 'greenhouse',
    company: target.company,
    companySlug: target.slug,
    externalId: raw.id != null ? String(raw.id) : undefined,
    title: raw.title,
    location,
    workplace: workplaceFromText(location) ?? workplaceFromText(descriptionText.slice(0, 600)),
    url: raw.absolute_url ?? null,
    applyUrl: raw.absolute_url ?? null,
    descriptionText,
    comp: extractComp(descriptionText),
    postedAt: raw.first_published ?? raw.updated_at ?? null,
  });
}

// --- Lever ------------------------------------------------------------------
// GET https://api.lever.co/v0/postings/{site}?mode=json
export function normalizeLever(target, raw) {
  const lists = Array.isArray(raw.lists)
    ? raw.lists.map((l) => `${l?.text ?? ''}\n${stripHtml(l?.content ?? '')}`).join('\n')
    : '';
  const descriptionText = [
    raw.descriptionPlain ?? stripHtml(raw.description ?? ''),
    lists,
    raw.additionalPlain ?? '',
  ].filter(Boolean).join('\n').trim();

  const workplaceMap = { remote: 'remote', hybrid: 'hybrid', 'on-site': 'onsite', onsite: 'onsite' };
  const workplace = workplaceMap[raw.workplaceType]
    ?? workplaceFromText(raw.categories?.location)
    ?? null;

  let comp = null;
  if (raw.salaryRange && (raw.salaryRange.min != null || raw.salaryRange.max != null)) {
    comp = {
      min: raw.salaryRange.min ?? null,
      max: raw.salaryRange.max ?? null,
      currency: raw.salaryRange.currency ?? 'USD',
      interval: /hour/i.test(raw.salaryRange.interval ?? '') ? 'hourly' : 'yearly',
    };
  } else {
    comp = extractComp(descriptionText);
  }

  return finalizeJob({
    ats: 'lever',
    company: target.company,
    companySlug: target.slug,
    externalId: raw.id,
    title: raw.text,
    location: raw.categories?.location ?? null,
    workplace,
    url: raw.hostedUrl ?? null,
    applyUrl: raw.applyUrl ?? raw.hostedUrl ?? null,
    descriptionText,
    comp,
    postedAt: typeof raw.createdAt === 'number' ? new Date(raw.createdAt).toISOString() : null,
  });
}

// --- Ashby ------------------------------------------------------------------
// GET https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true
export function normalizeAshby(target, raw) {
  const secondary = Array.isArray(raw.secondaryLocations)
    ? raw.secondaryLocations.map((l) => (typeof l === 'string' ? l : l?.location)).filter(Boolean)
    : [];
  const location = [
    typeof raw.location === 'string' ? raw.location : raw.location?.name,
    ...secondary,
  ].filter(Boolean).join('; ') || null;

  const descriptionText = raw.descriptionPlain ?? stripHtml(raw.descriptionHtml ?? '');
  const compSummary = raw.compensation?.compensationTierSummary
    ?? raw.compensation?.scrapeableCompensationSalarySummary
    ?? null;

  return finalizeJob({
    ats: 'ashby',
    company: target.company,
    companySlug: target.slug,
    externalId: raw.id,
    title: raw.title,
    location,
    workplace: raw.isRemote === true ? 'remote' : (raw.isRemote === false ? workplaceFromText(location) ?? 'onsite' : workplaceFromText(location)),
    url: raw.jobUrl ?? null,
    applyUrl: raw.applyUrl ?? raw.jobUrl ?? null,
    descriptionText,
    comp: extractComp(compSummary ?? '') ?? extractComp(descriptionText),
    postedAt: raw.publishedAt ?? null,
  });
}

// --- Manual / Firecrawl ingestion -------------------------------------------
// Accepts loosely-structured objects (from the job-discovery agent) and
// normalizes them. Required: company, title, url.
export function normalizeManual(entry) {
  assertManualEntry(entry);
  const required = ['company', 'title', 'url'];
  const missing = required.filter((k) => !entry?.[k]);
  if (missing.length) {
    throw new Error(`Manual job entry missing required field(s): ${missing.join(', ')}`);
  }
  const descriptionText = entry.descriptionText ?? entry.description ?? '';
  return finalizeJob({
    ats: 'manual',
    company: entry.company,
    companySlug: entry.companySlug ?? slugify(entry.company),
    externalId: sha1(entry.url).slice(0, 10),
    title: entry.title,
    location: entry.location ?? null,
    workplace: entry.workplace ?? workplaceFromText(entry.location, descriptionText.slice(0, 600)),
    url: entry.url,
    applyUrl: entry.applyUrl ?? entry.url,
    descriptionText,
    comp: entry.comp ?? extractComp(descriptionText),
    postedAt: entry.postedAt ?? null,
  });
}

// --- ATS detection from a careers URL ----------------------------------------
export function detectAts(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const seg = u.pathname.split('/').filter(Boolean);

  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
    // https://boards.greenhouse.io/{slug}[/jobs/{id}] or /embed/job_board?for={slug}
    if (seg[0] === 'embed') {
      const slug = u.searchParams.get('for');
      return slug ? { ats: 'greenhouse', slug } : null;
    }
    return seg[0] ? { ats: 'greenhouse', slug: seg[0] } : null;
  }
  if (host === 'boards.eu.greenhouse.io' || host === 'job-boards.eu.greenhouse.io') {
    return seg[0] ? { ats: 'greenhouse', slug: seg[0], region: 'eu' } : null;
  }
  if (host.endsWith('greenhouse.io') && seg[0] === 'embed') {
    const slug = u.searchParams.get('for');
    return slug ? { ats: 'greenhouse', slug } : null;
  }
  if (host === 'jobs.lever.co') {
    return seg[0] ? { ats: 'lever', slug: seg[0] } : null;
  }
  if (host === 'jobs.eu.lever.co') {
    return seg[0] ? { ats: 'lever', slug: seg[0], region: 'eu' } : null;
  }
  if (host === 'jobs.ashbyhq.com') {
    return seg[0] ? { ats: 'ashby', slug: decodeURIComponent(seg[0]) } : null;
  }
  return null;
}
