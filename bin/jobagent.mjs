#!/usr/bin/env node
// jobagent — deterministic CLI core of claude-job-agent.
// Agents call these subcommands; humans use them directly too. The one
// command agents may NEVER run is `approve` (see docs/SAFETY.md).
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { loadCompanies, loadPolicy, loadProfile, paths, profileFilesPresent } from '../src/lib/config.mjs';
import { detectAts, normalizeManual } from '../src/lib/normalize.mjs';
import {
  approveApplication, createApplication, disarmSession, getApp, getJob,
  importScores, loadApps, recordStatus, upsertJobs,
} from '../src/lib/store.mjs';
import { ensureDir, readJson } from '../src/lib/util.mjs';
import { discover } from '../src/pipeline/discover.mjs';
import { buildStatus, renderStatus } from '../src/pipeline/report.mjs';
import { shortlist } from '../src/pipeline/shortlist.mjs';

const USAGE = `jobagent — job-application pipeline CLI

Usage: node bin/jobagent.mjs <command> [options]

Setup
  init                        Copy example config/profile files into place
  doctor                      Check the environment and configuration

Sourcing
  discover                    Poll all configured ATS boards into the job store
  detect <url>                Identify the ATS + board slug from a careers URL
  ingest <file>               Ingest agent-collected jobs (JSON array) into the store
  show <jobId>                Print one job as JSON

Scoring & tailoring
  shortlist [--limit N] [--rescore] [--json]   Hard-filter unscored jobs → data/shortlist.json
  import-scores <file>        Validate + merge fit scores from the scorer agent
  package <jobId> [--force]   Create an application folder for a scored job

Submission (human-gated)
  approve <appId>             HUMAN ONLY: approve a queued application + arm the browser gate
  disarm                      Disarm the apply session (approved apps drop back to queued)
  record <appId> <status> [--note "..."] [--force]
                              Record a lifecycle transition (tailored, queued, submitted,
                              confirmed, blocked, rejected, interview, offer, closed, withdrawn)

Tracking
  status [--json]             Pipeline snapshot: jobs, applications, session, follow-ups
`;

function out(s) { process.stdout.write(`${s}\n`); }
function fail(msg, code = 1) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(code);
}

function ensureBaseDirs() {
  const p = paths();
  ensureDir(p.dataDir);
  ensureDir(p.stateDir);
  ensureDir(p.applicationsDir);
}

// ---------------------------------------------------------------- commands --

async function cmdInit() {
  const p = paths();
  ensureBaseDirs();
  const pairs = [
    [join(p.configDir, 'companies.example.json'), p.companiesFile],
    [join(p.configDir, 'policy.example.json'), p.policyFile],
    [join(p.profileDir, 'profile.example.json'), p.profileFile],
    [join(p.profileDir, 'resume.example.md'), p.resumeFile],
    [join(p.profileDir, 'answers.example.json'), p.answersFile],
  ];
  for (const [src, dest] of pairs) {
    if (existsSync(dest)) {
      out(`  keep    ${dest} (already exists)`);
    } else if (existsSync(src)) {
      copyFileSync(src, dest);
      out(`  created ${dest}`);
    } else {
      out(`  missing ${src} — cannot scaffold`);
    }
  }
  out('\nNext: edit profile/profile.json, profile/resume.md, profile/answers.json,');
  out('config/companies.json and config/policy.json — then run: node bin/jobagent.mjs doctor');
}

async function cmdDoctor() {
  ensureBaseDirs();
  const p = paths();
  let failures = 0;
  const check = (ok, label, hint = '') => {
    out(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !hint ? '' : `\n        → ${hint}`}`);
    if (!ok) failures += 1;
  };

  const [major] = process.versions.node.split('.').map(Number);
  check(major >= 20, `Node.js >= 20 (found ${process.versions.node})`);

  const present = profileFilesPresent();
  check(present.profile, 'profile/profile.json exists', 'run: node bin/jobagent.mjs init');
  check(present.resume, 'profile/resume.md exists', 'run: node bin/jobagent.mjs init');
  check(present.answers, 'profile/answers.json exists', 'run: node bin/jobagent.mjs init');

  try {
    const targets = loadCompanies();
    check(targets.length > 0, `config/companies.json has ${targets.length} target(s)`);
  } catch (err) {
    check(false, 'config/companies.json valid', err.message);
  }
  try {
    const policy = loadPolicy();
    check((policy.allowlist?.hosts ?? []).length > 0, 'policy allowlist is non-empty');
    check(policy.approval?.mode === 'manual', 'approval mode is "manual" (human approves each submission)',
      'auto-approval is intentionally unsupported; keep approval.mode = "manual"');
  } catch (err) {
    check(false, 'config/policy.json valid', err.message);
  }

  const gitignore = existsSync(join(p.root, '.gitignore'))
    ? readFileSync(join(p.root, '.gitignore'), 'utf8')
    : '';
  check(/^profile\/\*/m.test(gitignore) && /^applications\//m.test(gitignore) && /^data\//m.test(gitignore),
    '.gitignore protects profile/, applications/, data/',
    'restore the privacy rules in .gitignore before committing anything');

  check(existsSync(join(p.root, '.claude', 'hooks', 'submit-gate.mjs')), 'submit gate hook present');
  check(existsSync(join(p.root, '.mcp.json')), '.mcp.json present (Playwright MCP config)');

  out(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  if (failures > 0) process.exit(1);
}

async function cmdDiscover() {
  ensureBaseDirs();
  const targets = loadCompanies();
  out(`Polling ${targets.length} target(s)…`);
  const summary = await discover(targets, { log: out });
  out(`\nDone: ${summary.added} new jobs, ${summary.seenAgain} refreshed, ${summary.errors} error(s).`);
  if (summary.unknown.length) {
    out(`\n${summary.unknown.length} target(s) have no known ATS — the job-discovery agent can chase these via Firecrawl:`);
    for (const t of summary.unknown) out(`  - ${t.company}${t.careersUrl ? ` (${t.careersUrl})` : ''}`);
  }
  if (summary.errors > 0) process.exit(2);
}

async function cmdDetect(url) {
  if (!url) fail('usage: jobagent detect <careers-page-url>');
  const hit = detectAts(url);
  if (!hit) {
    out('Unknown ATS. Add this target with "careersUrl" only and let the job-discovery agent handle it via Firecrawl.');
    process.exit(2);
  }
  out(JSON.stringify(hit, null, 2));
}

async function cmdIngest(file) {
  if (!file) fail('usage: jobagent ingest <file.json>');
  ensureBaseDirs();
  const entries = readJson(file, null);
  if (!Array.isArray(entries)) fail(`${file} must contain a JSON array of job entries`);
  const jobs = [];
  const errors = [];
  entries.forEach((e, i) => {
    try {
      jobs.push(normalizeManual(e));
    } catch (err) {
      errors.push(`row ${i}: ${err.message}`);
    }
  });
  if (errors.length) fail(`ingest rejected (fix and retry):\n  ${errors.join('\n  ')}`);
  const { added, seenAgain } = upsertJobs(jobs);
  out(`Ingested ${jobs.length} entries: ${added} new, ${seenAgain} already known.`);
}

async function cmdShow(jobId) {
  if (!jobId) fail('usage: jobagent show <jobId>');
  const job = getJob(jobId);
  if (!job) fail(`unknown jobId: ${jobId}`);
  out(JSON.stringify(job, null, 2));
}

async function cmdShortlist(args) {
  ensureBaseDirs();
  const { values } = parseArgs({
    args,
    options: {
      limit: { type: 'string' },
      rescore: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  });
  const profile = loadProfile();
  const policy = loadPolicy();
  const result = shortlist(profile, policy, {
    limit: values.limit ? Number(values.limit) : undefined,
    rescore: values.rescore,
  });
  if (values.json) {
    out(JSON.stringify(result, null, 2));
    return;
  }
  out(`Shortlist: ${result.truncatedTo} of ${result.eligible} eligible (from ${result.totalJobs} total jobs).`);
  const rejects = Object.entries(result.rejectedCounts);
  if (rejects.length) {
    out('Filtered out:');
    for (const [reason, count] of rejects) out(`  ${String(count).padStart(4)}  ${reason}`);
  }
  out(`Written to ${paths().shortlistFile}`);
}

async function cmdImportScores(file) {
  if (!file) fail('usage: jobagent import-scores <file.json>');
  const entries = readJson(file, null);
  try {
    const { merged } = importScores(entries);
    out(`Merged ${merged} score(s) into the job store.`);
  } catch (err) {
    fail(err.message, err.code === 'EVALIDATION' ? 3 : 1);
  }
}

async function cmdPackage(jobId, args) {
  if (!jobId) fail('usage: jobagent package <jobId> [--force]');
  ensureBaseDirs();
  const { values } = parseArgs({ args, options: { force: { type: 'boolean', default: false } } });
  const job = getJob(jobId);
  if (!job) fail(`unknown jobId: ${jobId}`);
  const policy = loadPolicy();
  if (!values.force) {
    const min = policy.tailor?.minScore ?? 65;
    if (!job.score) fail(`${jobId} has no fit score yet — run the scorer first, or pass --force.`);
    if (job.score.value < min) {
      fail(`${jobId} scored ${job.score.value} (< minScore ${min}). Pass --force to package anyway.`);
    }
  }
  try {
    const app = createApplication(job, { force: values.force });
    out(`Created ${app.id} → applications/${app.dir}/`);
    out('The tailor agent should now write resume.md, cover-letter.md and answers.md into that folder.');
  } catch (err) {
    fail(err.message, err.code === 'EDUPLICATE' ? 4 : 1);
  }
}

async function cmdApprove(appId) {
  if (!appId) fail('usage: jobagent approve <appId>');
  // Human gate: refuse non-interactive callers. Agent-driven shells have no TTY,
  // and the Claude Code submit-gate hook denies this command besides.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail('approve requires an interactive terminal — a human must run this personally.', 5);
  }
  const app = getApp(appId);
  if (!app) fail(`unknown application id: ${appId}`);
  const policy = loadPolicy();
  const status = buildStatus();
  const cap = policy.caps?.maxApplicationsPerDay ?? 10;
  if (status.applications.submittedToday >= cap) {
    fail(`daily cap reached (${cap} submissions today). Raise caps.maxApplicationsPerDay in config/policy.json if intentional.`, 6);
  }

  out(`About to approve and arm the browser gate for:\n`);
  out(`  ${app.id}  ${app.company} — ${app.title}`);
  out(`  apply URL: ${app.applyUrl}`);
  out(`  package:   applications/${app.dir}/\n`);
  out('Review the tailored resume, cover letter, and answers in that folder first.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Type the application id (${app.id}) to confirm: `);
  rl.close();
  if (answer.trim() !== app.id) fail('confirmation did not match — nothing approved.');

  try {
    const { session } = approveApplication(appId, {
      sessionTtlMinutes: policy.approval?.sessionTtlMinutes ?? 60,
    });
    out(`\nApproved. Browser gate armed for ${session.hosts.join(', ')} until ${session.expiresAt}.`);
    out('Run /apply in Claude Code to let the browser agent complete the form.');
  } catch (err) {
    fail(err.message);
  }
}

async function cmdDisarm() {
  const existed = disarmSession();
  out(existed ? 'Apply session disarmed.' : 'No apply session was armed.');
}

async function cmdRecord(appId, status, args) {
  if (!appId || !status) fail('usage: jobagent record <appId> <status> [--note "..."] [--force]');
  const { values } = parseArgs({
    args,
    options: { note: { type: 'string', default: '' }, force: { type: 'boolean', default: false } },
  });
  const policy = loadPolicy();
  try {
    const app = recordStatus(appId, status, {
      note: values.note,
      force: values.force,
      followUpDays: policy.followUps?.days ?? [7, 14],
    });
    out(`${app.id} → ${app.status}`);
  } catch (err) {
    fail(err.message, err.code === 'ETRANSITION' ? 7 : err.code === 'EAPPROVALPATH' ? 5 : 1);
  }
}

async function cmdStatus(args) {
  ensureBaseDirs();
  const { values } = parseArgs({ args, options: { json: { type: 'boolean', default: false } } });
  const status = buildStatus();
  out(values.json ? JSON.stringify(status, null, 2) : renderStatus(status));
}

// ------------------------------------------------------------------ router --

const [, , command, ...rest] = process.argv;

try {
  switch (command) {
    case 'init': await cmdInit(); break;
    case 'doctor': await cmdDoctor(); break;
    case 'discover': await cmdDiscover(); break;
    case 'detect': await cmdDetect(rest[0]); break;
    case 'ingest': await cmdIngest(rest[0]); break;
    case 'show': await cmdShow(rest[0]); break;
    case 'shortlist': await cmdShortlist(rest); break;
    case 'import-scores': await cmdImportScores(rest[0]); break;
    case 'package': await cmdPackage(rest[0], rest.slice(1)); break;
    case 'approve': await cmdApprove(rest[0]); break;
    case 'disarm': await cmdDisarm(); break;
    case 'record': await cmdRecord(rest[0], rest[1], rest.slice(2)); break;
    case 'status': await cmdStatus(rest); break;
    case 'help':
    case '--help':
    case undefined:
      out(USAGE);
      break;
    default:
      fail(`unknown command "${command}". Run: node bin/jobagent.mjs help`);
  }
} catch (err) {
  fail(err.message);
}
