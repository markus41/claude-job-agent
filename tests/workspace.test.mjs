import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { beforeEach, test } from 'node:test';
import { paths, DEFAULT_POLICY } from '../src/lib/config.mjs';
import { normalizeManual } from '../src/lib/normalize.mjs';
import { upsertJobs, importScores, createApplication, loadApps, saveApps } from '../src/lib/store.mjs';

beforeEach(() => { process.env.JOBAGENT_HOME = mkdtempSync(join(tmpdir(), 'jobagent-workspace-')); });
const cli = (...args) => spawnSync(process.execPath, ['bin/jobagent.mjs', ...args], { encoding: 'utf8', env: { ...process.env } });

test('workspace command reports relocated paths and rejects example profile readiness', () => {
  const p = paths(); mkdirSync(p.profileDir, { recursive: true }); mkdirSync(p.configDir, { recursive: true });
  writeFileSync(p.profileFile, '{"name":"Jordan Example"}'); writeFileSync(p.resumeFile, 'Example resume'); writeFileSync(p.answersFile, '{}');
  writeFileSync(p.companiesFile, '{"targets":[{"company":"Example","ats":"lever","slug":"example"}]}');
  const result = cli('workspace', '--json'); assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout); assert.equal(value.paths.root, p.root); assert.equal(value.ready, false); assert.ok(value.blockers.some((x) => /placeholder/i.test(x)));
});

test('workspace resolver prefers tailored then master then newest uploaded PDF', async () => {
  const { resolveResume } = await import('../src/lib/workspace.mjs');
  const p = paths(); mkdirSync(p.uploadsDir, { recursive: true });
  const old = join(p.uploadsDir, 'old.pdf'); const newest = join(p.uploadsDir, 'new.pdf');
  writeFileSync(old, 'old'); writeFileSync(newest, 'new'); utimesSync(old, new Date(0), new Date(0));
  assert.equal(resolveResume(), newest); writeFileSync(p.resumePdfFile, 'master');
  assert.equal(resolveResume(), p.resumePdfFile);
  const app = { dir: 'tailored' }; mkdirSync(join(p.applicationsDir, app.dir), { recursive: true });
  const tailored = join(p.applicationsDir, app.dir, 'resume.pdf'); writeFileSync(tailored, 'tailored');
  assert.equal(resolveResume(app), tailored);
});

test('deterministic select returns scored jobs within caps and excludes active packages', () => {
  const p = paths(); mkdirSync(p.profileDir, { recursive: true }); writeFileSync(p.profileFile, '{"targets":{}}');
  const jobs = ['b', 'a', 'c'].map((x) => normalizeManual({ company: x, title: 'Engineer', url: 'https://careers.example.test/' + x }));
  upsertJobs(jobs); importScores(jobs.map((j) => ({ jobId: j.id, score: 90, verdict: 'strong' })));
  const selected = cli('select', '--limit', '99', '--json'); assert.equal(selected.status, 0, selected.stderr);
  const first = JSON.parse(selected.stdout); assert.equal(first.limit, DEFAULT_POLICY.tailor.topN);
  assert.deepEqual(first.items.map((j) => j.id), jobs.map((j) => j.id).sort());
  createApplication(first.items[0]);
  const again = cli('select', '--json'); assert.equal(again.status, 0, again.stderr);
  assert.equal(JSON.parse(again.stdout).items.length, 2);
});


test('doctor accepts configured auto mode with optional achievements absent', () => {
  const p = paths(); mkdirSync(p.profileDir, { recursive: true }); mkdirSync(p.configDir, { recursive: true });
  writeFileSync(p.profileFile, '{"name":"Synthetic Person","targets":{}}'); writeFileSync(p.resumeFile, 'Synthetic resume'); writeFileSync(p.answersFile, '{}');
  writeFileSync(p.companiesFile, '{"targets":[{"company":"Synthetic","ats":"lever","slug":"synthetic"}]}');
  writeFileSync(p.policyFile, '{"approval":{"mode":"auto"}}');
  const result = cli('doctor'); assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('init can scaffold a relocated workspace from committed examples', () => {
  const result = cli('init'); assert.equal(result.status, 0, result.stderr);
  const state = cli('workspace', '--json'); assert.equal(state.status, 0, state.stderr);
  const value = JSON.parse(state.stdout);
  assert.ok(value.blockers.some((x) => /placeholder/.test(x)));
  assert.equal(value.blockers.some((x) => /missing profile/.test(x)), false);
});

test('selection keeps one company/title per batch and fills the cap with distinct work', async () => {
  const { selectForTailoring } = await import('../src/pipeline/select.mjs');
  const jobs = ['1', '2', '3'].map((id) => normalizeManual({ company: id === '3' ? 'Other' : 'Example', title: 'Engineer', url: 'https://careers.example.test/' + id }));
  upsertJobs(jobs);
  importScores(jobs.map((j, i) => ({ jobId: j.id, score: 90 + i, verdict: i === 0 ? 'strong' : 'good' })));
  const result = selectForTailoring({ targets: {} }, DEFAULT_POLICY, { limit: 3 });
  assert.deepEqual(result.items.map((j) => j.id), [jobs[0].id, jobs[2].id]);
  createApplication(result.items[0]);
  assert.throws(() => createApplication(jobs[1]), /active application|already exists/i);
});

test('offers stay active while closed and rejected applications allow new listings through shortlist', async () => {
  const { selectForTailoring } = await import('../src/pipeline/select.mjs');
  const { shortlist } = await import('../src/pipeline/shortlist.mjs');
  const job = normalizeManual({ company: 'Example', title: 'Engineer', url: 'https://careers.example.test/offer' });
  upsertJobs([job]); importScores([{ jobId: job.id, score: 90, verdict: 'strong' }]);
  const app = createApplication(job); const db = loadApps(); db.apps[app.id].status = 'offer'; saveApps(db);
  assert.equal(selectForTailoring({ targets: {} }, DEFAULT_POLICY).items.length, 0);
  for (const status of ['closed', 'rejected']) {
    db.apps[app.id].status = status; saveApps(db);
    const replacement = normalizeManual({ company: 'Example', title: 'Engineer', url: 'https://careers.example.test/' + status });
    upsertJobs([replacement]);
    assert.ok(shortlist({ targets: {} }, DEFAULT_POLICY).items.some((j) => j.jobId === replacement.id));
  }
});

