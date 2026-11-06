import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { spawnSync } from 'node:child_process';

process.env.JOBAGENT_HOME = mkdtempSync(join(tmpdir(), 'jobagent-auto-'));

const { DEFAULT_POLICY, paths } = await import('../src/lib/config.mjs');
const { autoPreflight, buildAttestation, readAttestation } = await import('../src/lib/auto.mjs');
const {
  autoArm, createApplication, loadApps, readSession, recordStatus,
  revokeAttestation, saveAttestation, upsertJobs, getJob, saveApps,
} = await import('../src/lib/store.mjs');

const AUTO_POLICY = {
  ...DEFAULT_POLICY,
  approval: { ...DEFAULT_POLICY.approval, mode: 'auto' },
};

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
  score: { value: 88, verdict: 'strong', scoredAt: '2026-07-03T00:00:00Z' },
  ...over,
});

// Build a queued application with a complete package.
function queuedApp({ needsHumanInput = false, job = makeJob() } = {}) {
  upsertJobs([job]);
  // upsertJobs strips nothing, but score lives under .score — set it directly.
  const stored = getJob(job.id);
  assert.ok(stored, 'job stored');
  const app = createApplication(stored, { force: true });
  const dir = join(paths().applicationsDir, app.dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'resume.md'), '# Resume\n');
  writeFileSync(join(dir, 'cover-letter.md'), 'Dear team,\n');
  writeFileSync(
    join(dir, 'answers.md'),
    needsHumanInput ? 'Q: Clearance?\nNEEDS HUMAN INPUT: do you hold a clearance?\n' : 'Q: Authorized?\nA: Yes.\n'
  );
  recordStatus(app.id, 'tailored');
  recordStatus(app.id, 'queued');
  return loadApps().apps[app.id];
}

const preflight = (app, over = {}) =>
  autoPreflight({
    app,
    job: getJob(app.jobId),
    policy: AUTO_POLICY,
    attestation: readAttestation(),
    apps: loadApps().apps,
    hasResumePdf: true,
    ...over,
  });

beforeEach(() => {
  process.env.JOBAGENT_HOME = mkdtempSync(join(tmpdir(), 'jobagent-auto-'));
});

test('auto-submit refuses when mode is manual', () => {
  const app = queuedApp();
  saveAttestation(buildAttestation({ batchLimit: 5, ttlHours: 12, requireScore: 80 }));
  const blockers = preflight(app, { policy: DEFAULT_POLICY });
  assert.ok(blockers.some((b) => b.includes('auto mode is off')));
});

test('auto-submit refuses without a human batch authorization', () => {
  const app = queuedApp();
  const blockers = preflight(app);
  assert.ok(blockers.some((b) => b.includes('no batch authorization')));
  assert.throws(() => autoArm(app.id, { policy: AUTO_POLICY, hasResumePdf: true }), /auto-submit refused/);
});

test('auto-submit refuses an expired or exhausted batch', () => {
  const app = queuedApp();
  const expired = buildAttestation({ batchLimit: 5, ttlHours: 12, requireScore: 80 });
  expired.expiresAt = new Date(Date.now() - 60_000).toISOString();
  saveAttestation(expired);
  assert.ok(preflight(app).some((b) => b.includes('expired')));

  const used = buildAttestation({ batchLimit: 2, ttlHours: 12, requireScore: 80 });
  used.used = 2;
  saveAttestation(used);
  assert.ok(preflight(app).some((b) => b.includes('used up')));
});

test('auto-submit refuses NEEDS HUMAN INPUT, low scores, and a missing resume PDF', () => {
  saveAttestation(buildAttestation({ batchLimit: 5, ttlHours: 12, requireScore: 80 }));

  const needsHuman = queuedApp({ needsHumanInput: true });
  assert.ok(preflight(needsHuman).some((b) => b.includes('NEEDS HUMAN INPUT')));

  const lowScore = queuedApp({
    job: makeJob({ id: 'greenhouse:acmecorp:2', score: { value: 66, verdict: 'good' } }),
  });
  assert.ok(preflight(lowScore).some((b) => b.includes('below the auto-submit floor')));

  const noPdf = queuedApp({ job: makeJob({ id: 'greenhouse:acmecorp:3' }) });
  assert.ok(preflight(noPdf, { hasResumePdf: false }).some((b) => b.includes('no resume PDF')));
});

test('auto-submit refuses denylisted hosts even with a valid batch', () => {
  saveAttestation(buildAttestation({ batchLimit: 5, ttlHours: 12, requireScore: 80 }));
  const app = queuedApp({
    job: makeJob({
      id: 'manual:linkedin:9',
      applyUrl: 'https://www.linkedin.com/jobs/view/9',
      url: 'https://www.linkedin.com/jobs/view/9',
    }),
  });
  assert.ok(preflight(app).some((b) => b.includes('denylisted')));
});

test('auto-submit honors the stricter of policy floor and attested floor', () => {
  saveAttestation(buildAttestation({ batchLimit: 5, ttlHours: 12, requireScore: 95 }));
  const app = queuedApp(); // scores 88
  assert.ok(preflight(app).some((b) => b.includes('below the auto-submit floor 95')));
});

test('autoArm arms the gate, consumes batch, and enforces per-company cap', () => {
  saveAttestation(buildAttestation({ batchLimit: 3, ttlHours: 12, requireScore: 80 }));
  const app = queuedApp();

  const { session, attestation } = autoArm(app.id, { policy: AUTO_POLICY, hasResumePdf: true });
  assert.deepEqual(session.hosts, ['boards.greenhouse.io']);
  assert.equal(attestation.used, 1);
  assert.deepEqual(attestation.submittedAppIds, [app.id]);
  assert.equal(loadApps().apps[app.id].status, 'approved');
  assert.equal(readSession().appId, app.id);
  assert.match(loadApps().apps[app.id].history.at(-1).note, /auto-approval under batch/);

  // Submitting counts toward the per-company/day cap (default 1).
  recordStatus(app.id, 'submitted', { note: 'confirmed' });
  const second = queuedApp({ job: makeJob({ id: 'greenhouse:acmecorp:4' }) });
  const blockers = preflight(second);
  assert.ok(blockers.some((b) => b.includes('already submitted')));
});

test('autoArm refuses an application that is not queued', () => {
  saveAttestation(buildAttestation({ batchLimit: 3, ttlHours: 12, requireScore: 80 }));
  const app = queuedApp();
  autoArm(app.id, { policy: AUTO_POLICY, hasResumePdf: true }); // → approved
  assert.throws(
    () => autoArm(app.id, { policy: AUTO_POLICY, hasResumePdf: true }),
    /not "queued"/
  );
});

test('revokeAttestation kills the batch', () => {
  saveAttestation(buildAttestation({ batchLimit: 3, ttlHours: 12, requireScore: 80 }));
  assert.ok(readAttestation());
  assert.equal(revokeAttestation(), true);
  assert.equal(readAttestation(), null);
});

test('daily cap blocks auto-submit regardless of batch size', () => {
  const policy = {
    ...AUTO_POLICY,
    caps: { ...AUTO_POLICY.caps, maxApplicationsPerDay: 1 },
    approval: { ...AUTO_POLICY.approval, auto: { ...AUTO_POLICY.approval.auto, maxPerCompanyPerDay: 99 } },
  };
  saveAttestation(buildAttestation({ batchLimit: 10, ttlHours: 12, requireScore: 80 }));
  const first = queuedApp();
  autoArm(first.id, { policy, hasResumePdf: true });
  recordStatus(first.id, 'submitted', { note: 'ok' });

  const second = queuedApp({ job: makeJob({ id: 'greenhouse:acmecorp:5' }) });
  const blockers = autoPreflight({
    app: second,
    job: getJob(second.jobId),
    policy,
    attestation: readAttestation(),
    apps: loadApps().apps,
    hasResumePdf: true,
  });
  assert.ok(blockers.some((b) => b.includes('daily cap reached')));
});

test('auto-next reports an unsafe legacy package as blocked and continues with other applications', () => {
  const unsafe = queuedApp();
  const valid = queuedApp({ job: makeJob({ id: 'manual:other:1', company: 'Other', companySlug: 'other' }) });
  const db = loadApps(); db.apps[unsafe.id].dir = '../outside'; saveApps(db);
  const p = paths(); mkdirSync(p.configDir, { recursive: true });
  writeFileSync(p.policyFile, JSON.stringify({ approval: { mode: 'auto', auto: { requireResumePdf: false } } }));
  saveAttestation(buildAttestation({ batchLimit: 2, ttlHours: 1, requireScore: 80 }));
  const result = spawnSync(process.execPath, ['bin/jobagent.mjs', 'auto-next', '--json'], { env: { ...process.env }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(result.stdout);
  assert.equal(state.find((a) => a.appId === unsafe.id).eligible, false);
  assert.match(state.find((a) => a.appId === unsafe.id).blockers.join(' '), /unsafe/i);
  assert.equal(state.find((a) => a.appId === valid.id).eligible, true);
});
