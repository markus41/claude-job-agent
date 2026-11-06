import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { paths } from '../src/lib/config.mjs';
import { normalizeManual } from '../src/lib/normalize.mjs';
import { createApplication, saveApps, loadApps } from '../src/lib/store.mjs';
import { buildStatus } from '../src/pipeline/report.mjs';
import { buildCsv } from '../src/lib/workbook.mjs';

beforeEach(() => { process.env.JOBAGENT_HOME = mkdtempSync(join(tmpdir(), 'jobagent-followups-')); });
const due = '2026-01-01T00:00:00.000Z';
function submitted() {
  const j = normalizeManual({ company: 'Example', title: 'Engineer', url: 'https://careers.example.test/1' });
  const a = createApplication(j); const db = loadApps();
  Object.assign(db.apps[a.id], { status: 'submitted', submittedAt: '2025-12-20T00:00:00.000Z', followUps: { due: [due], done: [] } });
  saveApps(db); return a;
}
function cli(...args) { return spawnSync(process.execPath, ['bin/jobagent.mjs', ...args], { env: { ...process.env }, encoding: 'utf8' }); }

test('drafted follow-ups stay due, completion is explicit and idempotent', () => {
  const a = submitted(); const dir = join(paths().applicationsDir, a.dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'follow-up-2026-01-01T00-00-00-000Z.md'), 'Synthetic draft');
  const draft = cli('follow-up-draft', a.id, due); assert.equal(draft.status, 0, draft.stderr);
  assert.equal(buildStatus().followUpsDue[0].drafted, true);
  assert.equal(cli('follow-up-complete', a.id, due).status, 1);
  const complete = () => cli('follow-up-complete', a.id, due, '--confirmed', '--note', 'Human reports sent');
  assert.equal(complete().status, 0); assert.equal(complete().status, 0);
  assert.equal(buildStatus().followUpsDue.length, 0);
  const result = loadApps().apps[a.id]; assert.deepEqual(result.followUps.done, [due]);
  assert.equal(result.history.filter((h) => h.note === 'Human reports sent').length, 1);
});

test('closed applications have no pending follow-up in status or tracker', () => {
  const a = submitted(); const db = loadApps(); db.apps[a.id].status = 'closed'; saveApps(db);
  assert.equal(buildStatus().followUpsDue.length, 0);
  const csv = buildCsv(db.apps, {}); assert.equal(csv.includes('2026-01-01'), false);
});

