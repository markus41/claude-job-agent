import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';

// Point the store at a fresh temp home before importing it (paths resolve lazily).
process.env.JOBAGENT_HOME = mkdtempSync(join(tmpdir(), 'jobagent-test-'));

const { paths } = await import('../src/lib/config.mjs');
const {
  approveApplication, createApplication, getJob, importScores, loadApps,
  readSession, recordStatus, submittedToday, upsertJobs,
} = await import('../src/lib/store.mjs');

const makeJob = (over = {}) => ({
  id: 'greenhouse:acmecorp:1',
  ats: 'greenhouse',
  company: 'Acme Corp',
  companySlug: 'acmecorp',
  title: 'Senior Software Engineer',
  location: 'Remote - US',
  workplace: 'remote',
  url: 'https://boards.greenhouse.io/acmecorp/jobs/1',
  applyUrl: 'https://boards.greenhouse.io/acmecorp/jobs/1',
  descriptionText: 'Build things.',
  comp: null,
  postedAt: '2026-07-01T00:00:00Z',
  discoveredAt: '2026-07-02T00:00:00Z',
  lastSeenAt: '2026-07-02T00:00:00Z',
  ...over,
});

beforeEach(() => {
  process.env.JOBAGENT_HOME = mkdtempSync(join(tmpdir(), 'jobagent-test-'));
});

test('upsertJobs preserves discoveredAt and score on refresh', () => {
  const first = upsertJobs([makeJob()]);
  assert.equal(first.added, 1);

  importScores([{ jobId: 'greenhouse:acmecorp:1', score: 82, verdict: 'strong' }]);

  const second = upsertJobs([makeJob({ title: 'Senior Software Engineer II', discoveredAt: '2026-08-01T00:00:00Z' })]);
  assert.equal(second.added, 0);
  assert.equal(second.seenAgain, 1);

  const job = getJob('greenhouse:acmecorp:1');
  assert.equal(job.title, 'Senior Software Engineer II');
  assert.equal(job.discoveredAt, '2026-07-02T00:00:00Z');
  assert.equal(job.score.value, 82);
  assert.ok(job.lastSeenAt > '2026-07-02T00:00:00Z');
});

test('importScores is all-or-nothing on validation errors', () => {
  upsertJobs([makeJob()]);
  assert.throws(
    () => importScores([
      { jobId: 'greenhouse:acmecorp:1', score: 90, verdict: 'strong' },
      { jobId: 'nope:missing:0', score: 50, verdict: 'weak' },
    ]),
    /unknown jobId/
  );
  assert.equal(getJob('greenhouse:acmecorp:1').score, undefined);

  assert.throws(
    () => importScores([{ jobId: 'greenhouse:acmecorp:1', score: 150, verdict: 'strong' }]),
    /score must be a number 0-100/
  );
  assert.throws(
    () => importScores([{ jobId: 'greenhouse:acmecorp:1', score: 80, verdict: 'amazing' }]),
    /verdict must be one of/
  );
});

test('application lifecycle: package → tailored → queued → approve → submitted', () => {
  upsertJobs([makeJob()]);
  const app = createApplication(getJob('greenhouse:acmecorp:1'));

  assert.equal(app.status, 'packaged');
  assert.ok(existsSync(join(paths().applicationsDir, app.dir, 'job.json')));

  // Invalid transition and the approved-via-record ban.
  assert.throws(() => recordStatus(app.id, 'submitted'), /Invalid transition/);
  assert.throws(() => recordStatus(app.id, 'approved'), /only be set via `jobagent approve`/);

  recordStatus(app.id, 'tailored');
  recordStatus(app.id, 'queued');

  const { session } = approveApplication(app.id, { sessionTtlMinutes: 30 });
  assert.deepEqual(session.hosts, ['boards.greenhouse.io']);
  assert.equal(readSession().appId, app.id);

  const submitted = recordStatus(app.id, 'submitted', { note: 'confirmation shown', followUpDays: [7, 14] });
  assert.equal(submitted.status, 'submitted');
  assert.ok(submitted.submittedAt);
  assert.equal(submitted.followUps.due.length, 2);
  // Submission disarms the session; the submitted app must NOT revert to queued.
  assert.equal(readSession(), null);
  assert.equal(loadApps().apps[app.id].status, 'submitted');
  assert.equal(submittedToday(), 1);
});

test('duplicate active applications are refused unless forced', () => {
  upsertJobs([makeJob()]);
  const job = getJob('greenhouse:acmecorp:1');
  createApplication(job);
  assert.throws(() => createApplication(job), /already exists/);
  const second = createApplication(job, { force: true });
  assert.ok(second.id);
});

test('approve requires a queued application', () => {
  upsertJobs([makeJob()]);
  const app = createApplication(getJob('greenhouse:acmecorp:1'));
  assert.throws(() => approveApplication(app.id), /Only "queued" applications/);
});
