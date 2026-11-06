import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { beforeEach, test } from 'node:test';
import { paths, DEFAULT_POLICY } from '../src/lib/config.mjs';
import { normalizeManual } from '../src/lib/normalize.mjs';
import { upsertJobs, importScores, createApplication } from '../src/lib/store.mjs';

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

