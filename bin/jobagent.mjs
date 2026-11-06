#!/usr/bin/env node
// jobagent — deterministic CLI core of claude-job-agent.
// Agents call these subcommands; humans use them directly too. The one
// command agents may NEVER run is `approve` (see docs/SAFETY.md).
import { copyFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { autoPreflight, buildAttestation, readAttestation } from '../src/lib/auto.mjs';
import { loadCompanies, loadPolicy, loadProfile, paths, profileFilesPresent } from '../src/lib/config.mjs';
import { detectAts, normalizeManual } from '../src/lib/normalize.mjs';
import {
  approveApplication, autoArm, createApplication, disarmSession, getApp, getJob,
  importScores, loadApps, recordStatus, revokeAttestation, saveAttestation, upsertJobs, recoverAuthorization, recordFollowUp,
} from '../src/lib/store.mjs';
import { ensureDir, readJson } from '../src/lib/util.mjs';
import { discover } from '../src/pipeline/discover.mjs';
import { buildStatus, renderStatus } from '../src/pipeline/report.mjs';
import { shortlist } from '../src/pipeline/shortlist.mjs';
import { selectForTailoring } from '../src/pipeline/select.mjs';
import { inspectWorkspace, inspectPackage, resolveResume } from '../src/lib/workspace.mjs';

const USAGE = `jobagent — job-application pipeline CLI

Usage: node bin/jobagent.mjs <command> [options]

Setup
  init                        Copy example config/profile files into place
  doctor                      Check the environment and configuration
  upload <file>               Copy a resume/source document into profile/uploads/
  policy                      Print the effective (merged) policy as JSON
  workspace [--json]          Inspect readiness and resolved workspace paths

Sourcing
  discover                    Poll all configured ATS boards into the job store
  detect <url>                Identify the ATS + board slug from a careers URL
  ingest <file>               Ingest agent-collected jobs (JSON array) into the store
  show <jobId>                Print one job as JSON

Scoring & tailoring
  shortlist [--limit N] [--rescore] [--json]   Hard-filter unscored jobs → data/shortlist.json
  import-scores <file>        Validate + merge fit scores from the scorer agent
  package <jobId> [--force]   Create an application folder for a scored job
  select [--limit N] [--json] Select ranked unpackaged jobs within tailoring caps

Submission (human-gated)
  approve <appId>             HUMAN ONLY: approve a queued application + arm the browser gate
  disarm                      Disarm the apply session (approved apps drop back to queued)
  recover                     Revoke stale sessions and repair interrupted authorization

Auto-submit mode (batch authorization — see docs/SAFETY.md)
  auto-enable [--batch N] [--hours H] [--min-score S]
                              HUMAN ONLY: authorize the next N submissions
  auto-status                 Show the current batch authorization
  auto-revoke                 Cancel the batch authorization immediately
  auto-arm <appId>            Arm the gate for one application inside the batch
  auto-next [--json]          List queued applications eligible for auto-submit
  record <appId> <status> [--note "..."] [--force]
                              Record a lifecycle transition (tailored, queued, submitted,
                              confirmed, blocked, rejected, interview, offer, closed, withdrawn)

Tracking
  status [--json]             Pipeline snapshot: jobs, applications, session, follow-ups
  follow-up-draft <appId> <dueAt>             Record a draft using the scheduled filename
  follow-up-complete <appId> <dueAt> --confirmed [--note "..."]
                              Record a human-reported completion (never sends anything)
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
  ensureDir(p.uploadsDir);
  ensureDir(p.configDir);
  const pairs = [
    [join(p.projectRoot, 'config', 'companies.example.json'), p.companiesFile],
    [join(p.projectRoot, 'config', 'policy.example.json'), p.policyFile],
    [join(p.projectRoot, 'profile', 'profile.example.json'), p.profileFile],
    [join(p.projectRoot, 'profile', 'resume.example.md'), p.resumeFile],
    [join(p.projectRoot, 'profile', 'answers.example.json'), p.answersFile],
    [join(p.projectRoot, 'profile', 'achievements.example.json'), p.achievementsFile],
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
  out('\nNext (easiest): open Claude Code in this folder and run /setup — it interviews');
  out('you, imports your existing resume, and fills all of these in for you.');
  out('Or edit by hand: profile/profile.json, profile/resume.md, profile/answers.json,');
  out('profile/achievements.json, config/companies.json, config/policy.json —');
  out('then run: node bin/jobagent.mjs doctor');
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
  check(major >= 22, `Node.js >= 22 (found ${process.versions.node})`);

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
    check(['manual', 'auto'].includes(policy.approval.mode), `approval mode is "${policy.approval.mode}" (human authorization required)`);
    const weights = Object.values(policy.scoring?.weights ?? {});
    const weightSum = weights.reduce((a, b) => a + b, 0);
    check(weights.length === 0 || weightSum === 100,
      `scoring.weights sum to 100 (currently ${weightSum})`,
      'adjust scoring.weights in config/policy.json so the rubric weights total exactly 100');
  } catch (err) {
    check(false, 'config/policy.json valid', err.message);
  }

  const gitignore = existsSync(join(p.projectRoot, '.gitignore'))
    ? readFileSync(join(p.projectRoot, '.gitignore'), 'utf8')
    : '';
  check(/^profile\/\*/m.test(gitignore) && /^applications\//m.test(gitignore) && /^data\//m.test(gitignore),
    '.gitignore protects profile/, applications/, data/',
    'restore the privacy rules in .gitignore before committing anything');

  check(existsSync(join(p.projectRoot, '.claude', 'hooks', 'submit-gate.mjs')), 'submit gate hook present');
  check(existsSync(join(p.projectRoot, '.mcp.json')), '.mcp.json present (Playwright MCP config)');

  // Informational (never fail the doctor): personalization extras.
  const info = (present2, label, hint) =>
    out(`  ${present2 ? 'PASS' : 'INFO'}  ${label}${present2 ? '' : `\n        → ${hint}`}`);
  info(present.achievements, 'profile/achievements.json (optional but recommended)',
    'run /setup or copy profile/achievements.example.json — quantified wins make tailoring much stronger');
  info(present.resumePdf, 'profile/resume.pdf for form uploads',
    'export your resume to PDF (Word/Google Docs, or pandoc) so /apply can upload it');

  for (const blocker of inspectWorkspace().blockers) check(false, blocker);
  out(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  if (failures > 0) process.exit(1);
}

async function cmdUpload(file) {
  if (!file) fail('usage: jobagent upload <path-to-resume-or-source-doc>');
  const src = file.replace(/^["']|["']$/g, '');
  if (!existsSync(src)) fail(`file not found: ${src}`);
  const ALLOWED = new Set(['.pdf', '.md', '.txt', '.docx', '.doc', '.rtf', '.html']);
  const ext = extname(src).toLowerCase();
  if (!ALLOWED.has(ext)) {
    fail(`unsupported file type "${ext}" — allowed: ${[...ALLOWED].join(', ')}`);
  }
  const p = paths();
  ensureDir(p.uploadsDir);
  let destName = basename(src);
  let dest = join(p.uploadsDir, destName);
  if (existsSync(dest)) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    destName = `${basename(src, ext)}-${stamp}${ext}`;
    dest = join(p.uploadsDir, destName);
  }
  copyFileSync(src, dest);
  out(`Uploaded → profile/uploads/${destName}`);
  out('This folder is gitignored — the file stays on this machine.');
  if (ext === '.docx' || ext === '.doc') {
    out('Note: Claude reads PDF/MD/TXT best. If /setup struggles with this file, export a PDF and upload that instead.');
  }
  out('Next: run /setup in Claude Code to build your profile from it.');
}

async function cmdPolicy() {
  out(JSON.stringify(loadPolicy(), null, 2));
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

// --- Auto-submit mode -----------------------------------------------------------

function eligibleForAuto(policy, attestation) {
  const apps = loadApps().apps;
  const queued = Object.values(apps).filter((a) => a.status === 'queued');
  return queued.map((app) => {
    const job = getJob(app.jobId);
    const blockers = autoPreflight({ app, job, policy, attestation, apps });
    return {
      appId: app.id,
      company: app.company,
      title: app.title,
      score: job?.score?.value ?? null,
      eligible: blockers.length === 0,
      blockers,
    };
  }).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

async function cmdAutoEnable(args) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail('auto-enable requires an interactive terminal — a human must authorize the batch personally.', 5);
  }
  const { values } = parseArgs({
    args,
    options: {
      batch: { type: 'string' },
      hours: { type: 'string' },
      'min-score': { type: 'string' },
    },
  });
  const policy = loadPolicy();
  if (policy.approval?.mode !== 'auto') {
    fail('approval.mode is "manual". Set it to "auto" in config/policy.json first (read docs/SAFETY.md § Auto-submit before you do).', 8);
  }
  const cfg = policy.approval.auto ?? {};
  const batch = Number(values.batch ?? cfg.maxBatch ?? 10);
  const hours = Number(values.hours ?? cfg.ttlHours ?? 12);
  const minScore = Number(values['min-score'] ?? cfg.requireScore ?? 80);
  if (!Number.isInteger(batch) || batch < 1) fail('--batch must be a positive whole number');
  if (!(hours > 0)) fail('--hours must be greater than 0');
  if (!(minScore >= 0 && minScore <= 100)) fail('--min-score must be between 0 and 100');

  const preview = eligibleForAuto(policy, buildAttestation({ batchLimit: batch, ttlHours: hours, requireScore: minScore }));
  const ready = preview.filter((p) => p.eligible);

  out('AUTO-SUBMIT AUTHORIZATION\n');
  out(`  You are authorizing up to ${batch} application(s) to be submitted WITHOUT`);
  out(`  reviewing each one, over the next ${hours} hour(s), scoring ${minScore}+.\n`);
  out(`  Ready to go out right now (${ready.length}):`);
  for (const item of ready.slice(0, batch)) {
    out(`    ${item.appId}  [${item.score}]  ${item.company} — ${item.title}`);
  }
  if (!ready.length) out('    (none yet — packages must be tailored and queued first)');
  const blocked = preview.filter((p) => !p.eligible);
  if (blocked.length) {
    out(`\n  Queued but NOT eligible (${blocked.length}) — these still need you:`);
    for (const item of blocked.slice(0, 10)) {
      out(`    ${item.appId}  ${item.company} — ${item.title}`);
      for (const b of item.blockers) out(`        · ${b}`);
    }
  }
  out('\n  These go out under your name. Read at least one package in applications/');
  out('  before authorizing — the agent will not stop to ask you again.');
  out('  Cancel anytime with: node bin/jobagent.mjs auto-revoke\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const phrase = `authorize ${batch}`;
  const answer = await rl.question(`Type "${phrase}" to confirm: `);
  rl.close();
  if (answer.trim().toLowerCase() !== phrase) fail('confirmation did not match — nothing authorized.');

  const att = saveAttestation(
    buildAttestation({ batchLimit: batch, ttlHours: hours, requireScore: minScore, note: 'cli auto-enable' })
  );
  out(`\nAuthorized: ${att.batchLimit} submission(s) until ${att.expiresAt}.`);
  out('Run /auto-apply in Claude Code to work through the batch.');
}

async function cmdAutoStatus(args) {
  const { values } = parseArgs({ args, options: { json: { type: 'boolean', default: false } } });
  const policy = loadPolicy();
  const att = readAttestation();
  const eligible = eligibleForAuto(policy, att);
  if (values.json) {
    out(JSON.stringify({ mode: policy.approval?.mode, attestation: att, eligible }, null, 2));
    return;
  }
  out(`MODE   ${policy.approval?.mode}`);
  if (!att) {
    out('BATCH  none — a human must run: node bin/jobagent.mjs auto-enable');
  } else {
    const state = att.expired ? 'EXPIRED' : att.exhausted ? 'USED UP' : 'ACTIVE';
    out(`BATCH  ${state} — ${att.used}/${att.batchLimit} used, min score ${att.requireScore}, expires ${att.expiresAt}`);
  }
  const ready = eligible.filter((e) => e.eligible);
  out(`READY  ${ready.length} queued application(s) eligible for auto-submit`);
  for (const item of ready) out(`  ${item.appId}  [${item.score}]  ${item.company} — ${item.title}`);
  const blocked = eligible.filter((e) => !e.eligible);
  if (blocked.length) {
    out(`\nBLOCKED (${blocked.length}):`);
    for (const item of blocked) {
      out(`  ${item.appId}  ${item.company} — ${item.title}`);
      for (const b of item.blockers) out(`      · ${b}`);
    }
  }
}

async function cmdAutoRevoke() {
  const existed = revokeAttestation();
  disarmSession({ quiet: true });
  out(existed
    ? 'Batch authorization revoked and any armed session disarmed.'
    : 'No batch authorization was active (session disarmed anyway).');
}

async function cmdAutoArm(appId) {
  if (!appId) fail('usage: jobagent auto-arm <appId>');
  const policy = loadPolicy();
  try {
    const { session, attestation } = autoArm(appId, {
      policy,
      hasResumePdf: Boolean(resolveResume(getApp(appId))),
    });
    out(`Armed ${appId} for ${session.hosts.join(', ')} until ${session.expiresAt}.`);
    out(`Batch: ${attestation.used}/${attestation.batchLimit} used.`);
  } catch (err) {
    fail(err.message, err.code === 'EAUTOBLOCKED' ? 9 : 1);
  }
}

async function cmdAutoNext(args) {
  const { values } = parseArgs({ args, options: { json: { type: 'boolean', default: false } } });
  const policy = loadPolicy();
  const eligible = eligibleForAuto(policy, readAttestation());
  if (values.json) {
    out(JSON.stringify(eligible, null, 2));
    return;
  }
  if (!eligible.length) {
    out('No queued applications. Run /hunt to build some.');
    return;
  }
  for (const item of eligible) {
    out(`${item.eligible ? 'READY  ' : 'BLOCKED'} ${item.appId}  [${item.score ?? '--'}]  ${item.company} — ${item.title}`);
    if (!item.eligible) for (const b of item.blockers) out(`        · ${b}`);
  }
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

function cmdSelect(args) {
  const { values } = parseArgs({ args, options: { limit: { type: 'string' }, json: { type: 'boolean' } } });
  const result = selectForTailoring(loadProfile(), loadPolicy(), values.limit ? { limit: Number(values.limit) } : {});
  out(values.json ? JSON.stringify(result, null, 2) : result.items.map((j) => `${j.id}  [${j.score.value}]  ${j.company} — ${j.title}`).join('\n'));
}

function cmdWorkspace(args) {
  const { values } = parseArgs({ args, options: { app: { type: 'string' }, json: { type: 'boolean' } } });
  const state = inspectWorkspace();
  if (values.app) {
    const app = getApp(values.app);
    if (!app) throw new Error('Unknown application id: ' + values.app);
    state.package = inspectPackage(app);
  }
  out(JSON.stringify(state, null, 2));
}

function cmdFollowUp(appId, dueAt, args, complete) {
  const { values } = parseArgs({ args, options: { confirmed: { type: 'boolean', default: false }, note: { type: 'string', default: '' } } });
  const app = recordFollowUp(appId, dueAt, { complete, confirmed: values.confirmed, note: values.note });
  out(JSON.stringify({ appId: app.id, followUps: app.followUps }));
}

const [, , command, ...rest] = process.argv;

try {
  switch (command) {
    case 'init': await cmdInit(); break;
    case 'doctor': await cmdDoctor(); break;
    case 'workspace': cmdWorkspace(rest); break;
    case 'follow-up-draft': cmdFollowUp(rest[0], rest[1], rest.slice(2), false); break;
    case 'follow-up-complete': cmdFollowUp(rest[0], rest[1], rest.slice(2), true); break;
    case 'select': cmdSelect(rest); break;
    case 'upload': await cmdUpload(rest[0]); break;
    case 'policy': await cmdPolicy(); break;
    case 'discover': await cmdDiscover(); break;
    case 'detect': await cmdDetect(rest[0]); break;
    case 'ingest': await cmdIngest(rest[0]); break;
    case 'show': await cmdShow(rest[0]); break;
    case 'shortlist': await cmdShortlist(rest); break;
    case 'import-scores': await cmdImportScores(rest[0]); break;
    case 'package': await cmdPackage(rest[0], rest.slice(1)); break;
    case 'approve': await cmdApprove(rest[0]); break;
    case 'disarm': await cmdDisarm(); break;
    case 'recover': out(JSON.stringify(recoverAuthorization())); break;
    case 'auto-enable': await cmdAutoEnable(rest); break;
    case 'auto-status': await cmdAutoStatus(rest); break;
    case 'auto-revoke': await cmdAutoRevoke(); break;
    case 'auto-arm': await cmdAutoArm(rest[0]); break;
    case 'auto-next': await cmdAutoNext(rest); break;
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
