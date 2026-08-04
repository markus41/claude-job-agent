import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAppsIndex, hardFilter } from '../src/lib/filters.mjs';

const PROFILE = {
  targets: {
    titleKeywordsInclude: [],
    titleKeywordsExclude: ['recruiter', 'staffing'],
    remote: 'remote-only',
    locations: ['Denver'],
    salaryFloor: 150000,
    dealBreakers: ['security clearance'],
  },
};

const POLICY = { caps: { maxJobAgeDays: 60 } };

const baseJob = (over = {}) => ({
  id: 'greenhouse:acmecorp:1',
  companySlug: 'acmecorp',
  company: 'Acme Corp',
  title: 'Senior Software Engineer',
  location: 'Remote - US',
  workplace: 'remote',
  descriptionText: 'Build things. Ship things.',
  comp: { min: 160000, max: 190000, currency: 'USD', interval: 'yearly' },
  postedAt: new Date().toISOString(),
  ...over,
});

test('hardFilter: clean remote job passes', () => {
  const { pass, reasons } = hardFilter(baseJob(), PROFILE, new Set(), POLICY);
  assert.deepEqual(reasons, []);
  assert.equal(pass, true);
});

test('hardFilter: excluded title keyword rejects', () => {
  const { pass, reasons } = hardFilter(baseJob({ title: 'Technical Recruiter' }), PROFILE, new Set(), POLICY);
  assert.equal(pass, false);
  assert.ok(reasons.some((r) => r.startsWith('title-excluded:')));
});

test('hardFilter: include list enforced only when non-empty', () => {
  const profile = { targets: { ...PROFILE.targets, titleKeywordsInclude: ['engineer'] } };
  assert.equal(hardFilter(baseJob(), profile, new Set(), POLICY).pass, true);
  const miss = hardFilter(baseJob({ title: 'Product Manager' }), profile, new Set(), POLICY);
  assert.equal(miss.pass, false);
  assert.ok(miss.reasons.includes('title-no-include-match'));
});

test('hardFilter: onsite job rejected for remote-only profile unless in a target city', () => {
  const austin = hardFilter(
    baseJob({ workplace: 'onsite', location: 'Austin, TX' }), PROFILE, new Set(), POLICY
  );
  assert.equal(austin.pass, false);
  assert.ok(austin.reasons.includes('workplace-mismatch:onsite'));

  const denver = hardFilter(
    baseJob({ workplace: 'onsite', location: 'Denver, CO' }), PROFILE, new Set(), POLICY
  );
  assert.equal(denver.pass, true);

  // Unknown workplace passes through — the scorer flags it instead.
  const unknown = hardFilter(baseJob({ workplace: null, location: null }), PROFILE, new Set(), POLICY);
  assert.equal(unknown.pass, true);
});

test('hardFilter: posted comp below floor rejects; unknown comp passes', () => {
  const low = hardFilter(
    baseJob({ comp: { min: 100000, max: 140000, currency: 'USD', interval: 'yearly' } }),
    PROFILE, new Set(), POLICY
  );
  assert.equal(low.pass, false);
  assert.ok(low.reasons.some((r) => r.startsWith('comp-below-floor:')));

  const unknown = hardFilter(baseJob({ comp: null }), PROFILE, new Set(), POLICY);
  assert.equal(unknown.pass, true);

  // Hourly comp is annualized before comparison: $80/hr ≈ $166k > floor.
  const hourly = hardFilter(
    baseJob({ comp: { min: 80, max: null, currency: 'USD', interval: 'hourly' } }),
    PROFILE, new Set(), POLICY
  );
  assert.equal(hourly.pass, true);
});

test('hardFilter: deal-breaker phrase in description rejects', () => {
  const { pass, reasons } = hardFilter(
    baseJob({ descriptionText: 'Requires an active Security Clearance (TS/SCI).' }),
    PROFILE, new Set(), POLICY
  );
  assert.equal(pass, false);
  assert.ok(reasons.some((r) => r.startsWith('deal-breaker:')));
});

test('hardFilter: already-applied company+title family rejects', () => {
  const index = buildAppsIndex({
    'app-1': { companySlug: 'acmecorp', title: 'Senior Software Engineer!', status: 'submitted' },
  });
  const { pass, reasons } = hardFilter(baseJob(), PROFILE, index, POLICY);
  assert.equal(pass, false);
  assert.ok(reasons.includes('already-applied'));

  // Withdrawn applications do not block re-applying.
  const withdrawnIndex = buildAppsIndex({
    'app-1': { companySlug: 'acmecorp', title: 'Senior Software Engineer', status: 'withdrawn' },
  });
  assert.equal(hardFilter(baseJob(), PROFILE, withdrawnIndex, POLICY).pass, true);
});

test('hardFilter: stale postings rejected, unknown postedAt passes', () => {
  const old = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const stale = hardFilter(baseJob({ postedAt: old }), PROFILE, new Set(), POLICY);
  assert.equal(stale.pass, false);
  assert.ok(stale.reasons.some((r) => r.startsWith('stale:')));

  assert.equal(hardFilter(baseJob({ postedAt: null }), PROFILE, new Set(), POLICY).pass, true);
});
