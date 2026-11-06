# Autonomous workflow verification

All seven architecture recommendations are implemented. The independent review's
eight material findings are repaired. PR: https://github.com/markus41/claude-job-agent/pull/1

Code snapshot: `d6a1785ea176b8170d89d6e74358f78265418c8c` against base
`ebfeab8915b69058ed3b47871e12e41eb4050873`. Later delivery commits contain only
this evidence and plan completion. Local environment: Windows, Node 24.22.1.

## Observed proof

| Check | Result | Boundary proved |
| --- | --- | --- |
| `npm test` | 95 passed; 0 failed, skipped or cancelled; baseline was 61 | Synthetic module, CLI and raw-hook behavior |
| `npm run check:complexity` | Passed across all `src`, `bin`, `.claude/hooks` | Static analysis |
| SonarJS measurement with reporting threshold 0 | Maximum 15; writer-intent reader 12 | Actual cognitive complexity, with no baseline or suppression |
| `npm audit --json` | 0 vulnerabilities across runtime and development dependencies | Reported dependency advisories |
| PowerShell parser on `setup.ps1` | 0 errors | Script syntax; installer was not executed |
| `git diff --check` | Passed | Diff formatting |
| Six concurrent child writers | At most one entered; others refused; later writer succeeded | Local process exclusion |
| Killed choosing/published owners, dead legacy reclaim receipt | Later writers succeeded; unreadable live intent refused | Conservative crash recovery |
| Synthetic scored backlog | Unscored shortlist 0, scored selection 1; hunt instructions now continue | Deterministic selection plus source-level orchestration |

[CI matrix](https://github.com/markus41/claude-job-agent/actions/runs/42139401196)
passed all four Windows/Linux jobs on Node 22/24 for `d6a1785` using `npm ci`,
tests and complexity. The PR shows the current head's check status; a prior
green run does not prove a later head.

Six guards were independently removed in temporary source copies. Each focused
test passed intact, failed with the guard removed, and passed when restored:
whole-batch validation, physical link containment, effective policy validation,
pending-journal browser denial, session expiry denial, and competing-writer
exclusion. [Machine-readable receipt](2026-11-05-mutation-receipt.json).

## Independent review and repair

A fresh GPT-6 Astra reviewer inspected the whole branch at `4f7d4f9`, independently
ran 82 tests and the analyzer, and returned eight Important findings with no
Critical findings. The implementation agent reproduced and repaired them in one
fix pass. No second review is claimed; final fixes are proved by focused
regressions and the full 95-test run.

| Finding | Repair and evidence |
| --- | --- |
| Corrupt authorization prevented recovery; invalid expiry looked active | Recovery revokes damaged sessions, treats invalid expiry as stale, preserves damaged batch files; three failing recovery regressions now pass |
| Dead reclaim receipt permanently locked state | Unique choosing/ticket intents ignore proven-dead owners without deleting shared receipts; dead-owner regression changed from failure to pass |
| Duplicate company/title in one selected batch and package creation | Selection reserves identities after ranking; package creation uses the same identity; regression changed from failure to pass |
| Hunt stopped on an empty unscored shortlist | Instructions skip scoring and continue to select; synthetic backlog output and source readback verified |
| Offers retried, closed/rejected listings suppressed | Shared lifecycle keeps offers active and permits terminal retries across shortlist, selection and packages; regression changed from failure to pass |
| One unsafe package aborted auto-next | Inspection exceptions become that application's blockers; healthy queued work still returns eligible; CLI regression changed from failure to pass |
| Literal null policy silently restored defaults | Missing file uses defaults; present non-object rejects; regression changed from failure to pass |
| URL/date arrays survived validation | Scalar strings required before parsing; malformed-input regression changed from failure to pass |

Additional failing regressions repaired: a consumed application cannot retry
under the same batch after interrupted publication; missing attestation identity
cannot grant permission; read-only status reports an interrupted journal even
before approval persisted. No Minor findings were deferred.

## Responsibilities and structure

| Changed area | Responsibility |
| --- | --- |
| intake, normalize, package-paths | Canonical job contract and physical package/file containment |
| policy, config | Validated effective settings; installed project versus private workspace paths |
| workspace, select, filters, lifecycle | Readiness, resume precedence, capped ordering and consistent duplicate eligibility |
| authorization, state-mutation, store, auto | One serialized ledger, permission publication, conservative recovery, batch accounting |
| gate, submit-gate, MCP pin | Verified browser operation classification and independent human-only shell denial |
| follow-ups, report, workbook | Shared due/draft/completion meaning and generated tracker views |
| CLI, agent commands, first-run, audit-log, setup | Consume central decisions and honor relocated state |
| tests, ESLint config, package lock, CI, docs | Reproducible checks and documented operating boundaries |

Focused functions and guard clauses keep nesting shallow; cognitive complexity
is measured across the whole runtime tree. Existing JSON paths, atomic writer,
audit logger, hard filters and workbook generator are reused. No additional
runtime dependency, data-access service, credential path, telemetry pipeline or
authorization mechanism was introduced.

## Decisions made for Markus

| Decision | Reason and cost if wrong |
| --- | --- |
| Implement all seven without another candidate-selection gate | User delegated the choices; cost is a broader reviewable PR |
| Keep manual authorization as the default | Existing consent model; unattended submission still needs personal batch consent |
| Retain Node modules and local JSON | Fits repository scale and requirements; network-drive/multi-host coordination is outside this lock |
| Rank strong before good, then score and job id; reserve exact normalized company/title identity | Reproducible batches and duplicate avoidance; distinct same-title openings need explicit force |
| Publish permission last, deny pending journals, never refund consumed slots | Conservative recovery; interrupted attempts can spend capacity without a submission |
| Refuse a second attempt under the same batch | Avoid retrying uncertain external outcomes; a human must inspect them before fresh authorization |
| Use unique writer intents and ignore only proven-dead owners | Avoid stale shared-file deletion races; contention refuses immediately and unknown ownership remains locked |
| Prefer tailored, master, then newest uploaded PDF; achievements optional | One readiness/upload choice; newest upload may need candidate review |
| Keep follow-up draft and human-confirmed completion separate | Accurate recordkeeping; the human still sends each note |
| Leave the ready PR unmerged | Implementation does not authorize integration or release |

## Remaining UNKNOWNs and limits

Actual Playwright browser execution, authenticated ATS submission, native Excel,
provider login, installers and deployment were not exercised. The published
`@playwright/mcp@0.0.84` package definitions were read; that proves operation
names, not successful live use. Browser redirects and unrestricted shell tools
remain the documented enforcement limits.

An external submit followed by a crash before recording its result still needs
human outcome reconciliation. Same-batch replay is refused; fresh human consent
does not prove the prior submission failed. Locks assume one installed version
and a local filesystem. PID reuse, unreadable legacy ownership, corrupt primary
application ledgers and permanent filesystem failures require diagnosis; no
repair invents candidate facts or restores unknown batch capacity.

No live candidate records were read or changed. No live discovery, application
authorization, auto-mode enablement, external follow-up, merge or deployment ran.

Next boundary: review the ready PR and authorize integration separately.
