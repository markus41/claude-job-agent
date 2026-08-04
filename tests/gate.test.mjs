import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { evaluateGate, hostMatches } from '../src/lib/gate.mjs';

const REPO = resolve('gate-test-repo');
const FUTURE = new Date(Date.now() + 30 * 60_000).toISOString();
const PAST = new Date(Date.now() - 30 * 60_000).toISOString();

const POLICY = {
  allowlist: { hosts: ['boards.greenhouse.io', 'jobs.lever.co', '*.myworkdayjobs.com'] },
  denylist: { hosts: ['*.linkedin.com', '*.indeed.com'] },
};

const armed = { appId: 'app-1234', hosts: ['careers.example.com'], expiresAt: FUTURE };
const ctx = (over = {}) => ({ policy: POLICY, session: armed, repoRoot: REPO, ...over });

const nav = (url) => ({ tool_name: 'mcp__playwright__browser_navigate', tool_input: { url } });

test('hostMatches: exact and wildcard patterns', () => {
  assert.equal(hostMatches('boards.greenhouse.io', POLICY.allowlist.hosts), true);
  assert.equal(hostMatches('acme.wd5.myworkdayjobs.com', POLICY.allowlist.hosts), true);
  assert.equal(hostMatches('myworkdayjobs.com', POLICY.allowlist.hosts), true);
  assert.equal(hostMatches('evil-myworkdayjobs.com', POLICY.allowlist.hosts), false);
  assert.equal(hostMatches('www.linkedin.com', POLICY.denylist.hosts), true);
});

test('bash approve command is denied for agents', () => {
  const result = evaluateGate(
    { tool_name: 'Bash', tool_input: { command: 'node bin/jobagent.mjs approve app-9999' } },
    ctx()
  );
  assert.equal(result?.decision, 'deny');
  assert.match(result.reason, /human-only/);

  assert.equal(
    evaluateGate({ tool_name: 'Bash', tool_input: { command: 'git status' } }, ctx()),
    null
  );
  assert.equal(
    evaluateGate({ tool_name: 'Bash', tool_input: { command: 'node bin/jobagent.mjs status --json' } }, ctx()),
    null
  );
});

test('browser tools locked without an armed session', () => {
  for (const session of [null, undefined, { ...armed, expiresAt: PAST }, { ...armed, expired: true }]) {
    const result = evaluateGate(nav('https://boards.greenhouse.io/acme/jobs/1'), ctx({ session }));
    assert.equal(result?.decision, 'deny');
    assert.match(result.reason, /no armed apply session/);
  }
  // Even non-navigation browser tools are locked when disarmed.
  const snap = evaluateGate(
    { tool_name: 'mcp__playwright__browser_snapshot', tool_input: {} },
    ctx({ session: null })
  );
  assert.equal(snap?.decision, 'deny');
});

test('navigation: session host and allowlist pass, others deny', () => {
  assert.equal(evaluateGate(nav('https://careers.example.com/apply/123'), ctx()), null);
  assert.equal(evaluateGate(nav('https://boards.greenhouse.io/acme/jobs/1'), ctx()), null);
  assert.equal(evaluateGate(nav('https://acme.wd5.myworkdayjobs.com/en-US/acme/job/1'), ctx()), null);

  const denied = evaluateGate(nav('https://totally-random.example.org/'), ctx());
  assert.equal(denied?.decision, 'deny');
  assert.match(denied.reason, /not in the allowlist/);

  const bad = evaluateGate(nav('not a url'), ctx());
  assert.equal(bad?.decision, 'deny');
});

test('navigation: aggregators are denied even when armed', () => {
  const result = evaluateGate(nav('https://www.linkedin.com/jobs/view/12345'), ctx());
  assert.equal(result?.decision, 'deny');
  assert.match(result.reason, /denylist/);
});

test('plugin-installed playwright tool names are matched too', () => {
  const result = evaluateGate(
    { tool_name: 'mcp__plugin_model-apps_playwright__browser_navigate', tool_input: { url: 'https://www.indeed.com/viewjob?jk=1' } },
    ctx()
  );
  assert.equal(result?.decision, 'deny');
});

test('file uploads restricted to applications/ and profile/', () => {
  const ok = evaluateGate(
    {
      tool_name: 'mcp__playwright__browser_file_upload',
      tool_input: { paths: [resolve(REPO, 'applications', 'acme-swe-1234', 'resume.pdf')] },
    },
    ctx()
  );
  assert.equal(ok, null);

  const okProfile = evaluateGate(
    {
      tool_name: 'mcp__playwright__browser_file_upload',
      tool_input: { paths: [resolve(REPO, 'profile', 'resume.pdf')] },
    },
    ctx()
  );
  assert.equal(okProfile, null);

  const denied = evaluateGate(
    {
      tool_name: 'mcp__playwright__browser_file_upload',
      tool_input: { paths: [resolve(REPO, '..', 'secrets.txt')] },
    },
    ctx()
  );
  assert.equal(denied?.decision, 'deny');
  assert.match(denied.reason, /Upload of .* blocked/);
});

test('typed content: SSN and card patterns blocked, normal fields pass', () => {
  const ssn = evaluateGate(
    { tool_name: 'mcp__playwright__browser_type', tool_input: { text: '123-45-6789' } },
    ctx()
  );
  assert.equal(ssn?.decision, 'deny');
  assert.match(ssn.reason, /SSN/);

  const card = evaluateGate(
    {
      tool_name: 'mcp__playwright__browser_fill_form',
      tool_input: { fields: [{ name: 'card', value: '4111 1111 1111 1111' }] },
    },
    ctx()
  );
  assert.equal(card?.decision, 'deny');
  assert.match(card.reason, /payment card/);

  // Adjacent short numeric fields must NOT chain into a false positive.
  const fine = evaluateGate(
    {
      tool_name: 'mcp__playwright__browser_fill_form',
      tool_input: {
        fields: [
          { name: 'zip', value: '80202' },
          { name: 'phone', value: '555-123-4567' },
          { name: 'name', value: 'Jordan Example' },
        ],
      },
    },
    ctx()
  );
  assert.equal(fine, null);
});

test('non-browser, non-bash tools produce no opinion', () => {
  assert.equal(evaluateGate({ tool_name: 'Read', tool_input: { file_path: 'x' } }, ctx({ session: null })), null);
});
