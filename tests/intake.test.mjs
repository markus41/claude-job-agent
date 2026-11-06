import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { normalizeManual } from '../src/lib/normalize.mjs';
import { createApplication, loadJobs, upsertJobs } from '../src/lib/store.mjs';
import { loadPolicy, paths } from '../src/lib/config.mjs';

beforeEach(() => { process.env.JOBAGENT_HOME = mkdtempSync(join(tmpdir(), 'jobagent-intake-')); });
const entry = (over = {}) => ({ company: 'Example', title: 'Engineer', url: 'https://careers.example.test/jobs/1', ...over });

test('manual intake rejects unsafe slugs, invalid URLs and wrong field types', () => {
  for (const over of [{ companySlug: '../escape' }, { companySlug: 'foo/bar' }, { url: 'bad' }, { applyUrl: 'file:///tmp/x' }, { title: {} }, { description: 42 }, { comp: { min: 'many' } }]) {
    assert.throws(() => normalizeManual(entry(over)), /invalid|must|unsafe/i);
  }
});

test('store rejects canonical jobs before any batch member persists', () => {
  const valid = normalizeManual(entry());
  assert.throws(() => upsertJobs([valid, { ...valid, id: 'bad', companySlug: '../escape' }]), /invalid|unsafe/i);
  assert.equal(Object.keys(loadJobs().jobs).length, 0);
});

test('package creation refuses traversal without creating an escaped folder', () => {
  const valid = normalizeManual(entry());
  assert.throws(() => createApplication({ ...valid, companySlug: '../escape' }), /invalid|unsafe/i);
  assert.equal(existsSync(paths().appsFile), false);
});

test('merged policy rejects malformed settings before consumers can compare them', () => {
  const p = paths();
  mkdirSync(p.configDir, { recursive: true });
  for (const override of [{ approval: { auto: { requireScore: 'eighty' } } }, { caps: { maxApplicationsPerDay: -1 } }, { approval: { mode: 'surprise' } }, { scoring: { weights: { compensation: 11 } } }, { approval: null }]) {
    writeFileSync(p.policyFile, JSON.stringify(override));
    assert.throws(() => loadPolicy(), /policy|must|invalid/i);
  }
});


test('package creation rejects an existing symbolic-link directory', async () => {
  const { symlinkSync, readdirSync } = await import('node:fs');
  const p = paths(); mkdirSync(p.applicationsDir, { recursive: true });
  const outside = join(p.root, 'outside'); mkdirSync(outside);
  const linked = join(p.applicationsDir, 'linked');
  symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const { applicationPath } = await import('../src/lib/package-paths.mjs');
  assert.throws(() => applicationPath('linked'), /unsafe|leaves/i);
  assert.deepEqual(readdirSync(outside), []);
});

