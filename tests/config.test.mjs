import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, test } from 'node:test';

process.env.JOBAGENT_HOME = mkdtempSync(join(tmpdir(), 'jobagent-cfg-'));

const { DEFAULT_POLICY, loadPolicy, paths } = await import('../src/lib/config.mjs');

beforeEach(() => {
  process.env.JOBAGENT_HOME = mkdtempSync(join(tmpdir(), 'jobagent-cfg-'));
});

test('default policy: complete, manual approval, weights sum to 100', () => {
  const policy = loadPolicy(); // no policy.json present → pure defaults
  assert.equal(policy.approval.mode, 'manual');
  assert.ok(policy.allowlist.hosts.length > 0);
  assert.ok(policy.denylist.hosts.some((h) => h.includes('linkedin')));
  assert.equal(policy.tailor.coverLetter.maxWords, 300);
  const sum = Object.values(policy.scoring.weights).reduce((a, b) => a + b, 0);
  assert.equal(sum, 100);
});

test('user policy overrides merge deeply without clobbering siblings', () => {
  const p = paths();
  mkdirSync(dirname(p.policyFile), { recursive: true });
  writeFileSync(
    p.policyFile,
    JSON.stringify({
      caps: { maxApplicationsPerDay: 3 },
      tailor: { coverLetter: { tone: 'warm' } },
    })
  );
  const policy = loadPolicy();
  assert.equal(policy.caps.maxApplicationsPerDay, 3);
  // Sibling defaults survive a partial override:
  assert.equal(policy.caps.maxJobAgeDays, DEFAULT_POLICY.caps.maxJobAgeDays);
  assert.equal(policy.tailor.coverLetter.tone, 'warm');
  assert.equal(policy.tailor.coverLetter.maxWords, 300);
  assert.equal(policy.tailor.minScore, 65);
});

test('array overrides replace rather than merge', () => {
  const p = paths();
  mkdirSync(dirname(p.policyFile), { recursive: true });
  writeFileSync(p.policyFile, JSON.stringify({ allowlist: { hosts: ['careers.acme.com'] } }));
  const policy = loadPolicy();
  assert.deepEqual(policy.allowlist.hosts, ['careers.acme.com']);
});
