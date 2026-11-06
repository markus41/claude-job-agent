import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('human-only shell denial survives malformed policy context', () => {
  const home = mkdtempSync(join(tmpdir(), 'jobagent-hook-'));
  mkdirSync(join(home, 'config')); writeFileSync(join(home, 'config', 'policy.json'), '{bad json');
  const result = spawnSync(process.execPath, ['.claude/hooks/submit-gate.mjs'], {
    env: { ...process.env, JOBAGENT_HOME: home }, encoding: 'utf8',
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'node bin/jobagent.mjs approve app-synthetic' } }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
});
