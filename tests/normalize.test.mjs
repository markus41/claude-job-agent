import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  detectAts, normalizeAshby, normalizeGreenhouse, normalizeLever, normalizeManual,
} from '../src/lib/normalize.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const load = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

test('normalizeGreenhouse: escaped HTML, comp, remote detection', () => {
  const raw = load('greenhouse.json').jobs[0];
  const job = normalizeGreenhouse({ company: 'Acme Corp', slug: 'acmecorp' }, raw);

  assert.equal(job.id, 'greenhouse:acmecorp:4444001');
  assert.equal(job.ats, 'greenhouse');
  assert.equal(job.title, 'Senior Software Engineer, Platform');
  assert.equal(job.location, 'Remote - US');
  assert.equal(job.workplace, 'remote');
  assert.equal(job.url, 'https://boards.greenhouse.io/acmecorp/jobs/4444001');
  // Double-escaped entities resolve: &amp;rsquo; → ’
  assert.ok(job.descriptionText.includes('platform team’s core services'));
  assert.ok(job.descriptionText.includes('- Own reliability'));
  assert.ok(!job.descriptionText.includes('<'));
  assert.deepEqual(job.comp, { min: 150000, max: 180000, currency: 'USD', interval: 'yearly' });
  assert.equal(job.postedAt, '2026-07-01T12:00:00-04:00');
});

test('normalizeGreenhouse: onsite job without comp', () => {
  const raw = load('greenhouse.json').jobs[1];
  const job = normalizeGreenhouse({ company: 'Acme Corp', slug: 'acmecorp' }, raw);
  assert.equal(job.comp, null);
  // Location alone is inconclusive, but "in office" in the description is.
  assert.equal(job.workplace, 'onsite');
});

test('normalizeLever: structured salaryRange and workplaceType', () => {
  const raw = load('lever.json')[0];
  const job = normalizeLever({ company: 'Betaworks', slug: 'betaworks' }, raw);

  assert.equal(job.id, 'lever:betaworks:a1b2c3d4-0000-4000-8000-1234567890ab');
  assert.equal(job.title, 'Staff Product Engineer');
  assert.equal(job.workplace, 'remote');
  assert.equal(job.applyUrl.endsWith('/apply'), true);
  assert.deepEqual(job.comp, { min: 170000, max: 210000, currency: 'USD', interval: 'yearly' });
  assert.ok(job.descriptionText.includes('Build user-facing features'));
  assert.ok(job.descriptionText.includes('equal opportunity'));
  assert.equal(job.postedAt, new Date(1753000000000).toISOString());
});

test('normalizeLever: hybrid role, comp parsed from description text', () => {
  const raw = load('lever.json')[1];
  const job = normalizeLever({ company: 'Betaworks', slug: 'betaworks' }, raw);
  assert.equal(job.workplace, 'hybrid');
  assert.deepEqual(job.comp, { min: 140000, max: 165000, currency: 'USD', interval: 'yearly' });
});

test('normalizeAshby: isRemote flag and compensation tier summary', () => {
  const raw = load('ashby.json').jobs[0];
  const job = normalizeAshby({ company: 'Gamma Labs', slug: 'gammalabs' }, raw);

  assert.equal(job.id, 'ashby:gammalabs:f47ac10b-58cc-4372-a567-0e02b2c3d479');
  assert.equal(job.workplace, 'remote');
  assert.equal(job.applyUrl.endsWith('/application'), true);
  assert.deepEqual(job.comp, { min: 130000, max: 160000, currency: 'USD', interval: 'yearly' });
  assert.equal(job.postedAt, '2026-07-15T00:00:00Z');
});

test('normalizeManual: requires company/title/url, derives the rest', () => {
  const job = normalizeManual({
    company: 'Delta Systems',
    title: 'Backend Engineer',
    url: 'https://delta.example.com/careers/backend-engineer',
    location: 'Remote (US)',
    description: 'Own our API surface. Salary $120,000-$150,000.',
  });
  assert.equal(job.ats, 'manual');
  assert.equal(job.companySlug, 'delta-systems');
  assert.equal(job.workplace, 'remote');
  assert.deepEqual(job.comp, { min: 120000, max: 150000, currency: 'USD', interval: 'yearly' });

  assert.throws(() => normalizeManual({ company: 'X', title: 'Y' }), /missing required field/);
});

test('detectAts: recognizes hosted board URLs', () => {
  assert.deepEqual(detectAts('https://boards.greenhouse.io/acmecorp'), { ats: 'greenhouse', slug: 'acmecorp' });
  assert.deepEqual(detectAts('https://job-boards.greenhouse.io/acmecorp/jobs/123'), { ats: 'greenhouse', slug: 'acmecorp' });
  assert.deepEqual(
    detectAts('https://boards.greenhouse.io/embed/job_board?for=acmecorp'),
    { ats: 'greenhouse', slug: 'acmecorp' }
  );
  assert.deepEqual(detectAts('https://jobs.lever.co/betaworks'), { ats: 'lever', slug: 'betaworks' });
  assert.deepEqual(detectAts('https://jobs.eu.lever.co/betaworks'), { ats: 'lever', slug: 'betaworks', region: 'eu' });
  assert.deepEqual(detectAts('https://jobs.ashbyhq.com/gammalabs'), { ats: 'ashby', slug: 'gammalabs' });
  assert.equal(detectAts('https://example.com/careers'), null);
  assert.equal(detectAts('not a url'), null);
});
