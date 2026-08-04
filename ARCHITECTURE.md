# Architecture (as built)

This document describes what actually ships in this repo and why. The
original research brief it was built from is preserved verbatim at
[docs/blueprint.md](docs/blueprint.md); the deltas are listed at the bottom.

## Design stance

Two principles drive every decision here:

1. **Deterministic where possible, agentic where necessary.** Polling APIs,
   normalizing schemas, filtering, state transitions, and enforcement are
   plain code (`src/`, `bin/`) — testable, cheap, and identical on every run.
   Models are reserved for judgment: nuanced fit scoring, writing, browsing
   unpredictable forms.
2. **Safety is enforced, not requested.** Agent prompts state the rules, but
   the rules that matter are re-implemented as code in a `PreToolUse` hook,
   the CLI, and the state machine. A confused (or prompt-injected) agent hits
   a wall, not a suggestion.

## Layer map

| Blueprint layer | As built | Model | Tools |
|---|---|---|---|
| Orchestration | Claude Code main thread + 8 slash commands (`.claude/commands/`) | user's choice | Bash (CLI), Agent |
| Sourcing | `jobagent discover` (deterministic) + `job-discovery` agent for unknown-ATS targets | sonnet | network read, CLI ingest |
| Matching | `jobagent shortlist` (hard filters, code) + `fit-scorer` agent (rubric) | sonnet | Read/Bash/Write, **no network** |
| Tailoring | `tailor` agent → per-application folder | sonnet | Read/Write/Edit/Bash, **no network** |
| Submission (API) | `src/submit/api.mjs` — extension point, **disabled by default** (see below) | — | — |
| Submission (browser) | `browser-apply` agent via Playwright MCP, gated by hook + armed session | sonnet | browser, CLI record |
| Tracking | `store.mjs` state machine + `application-logger` agent + `data/audit.log` | haiku | Read/Bash/Write |

## Data flow & stores

Single-direction flow with JSON stores under `data/` (gitignored):

```
companies.json ─→ discover ─→ data/jobs.json ─→ shortlist ─→ data/shortlist.json
                                    │                              │
                                    │            fit-scorer ← ─────┘
                                    │                 │ writes data/scores.pending.json
                                    └── import-scores ┘  (validated, all-or-nothing)
jobs.json (scored) ─→ package ─→ applications/<dir>/ + data/applications.json
                                        │
        tailor writes resume.md / cover-letter.md / answers.md
                                        │
     HUMAN: jobagent approve ─→ data/state/apply-session.json (armed, TTL)
                                        │
      browser-apply ─→ record submitted ─→ follow-ups due ─→ application-logger
```

**Why JSON files, not SQLite?** The blueprint suggested SQLite/Postgres. At
this system's real volume (hundreds of jobs, dozens of applications) flat
JSON with atomic writes (`tmp` + rename) is simpler, diffable, human-readable
during review, and dependency-free. `src/lib/store.mjs` is the only module
that touches state; swap it if you outgrow it.

### Job schema

```js
{
  id: "greenhouse:acmecorp:4444001",   // `${ats}:${companySlug}:${externalId}`
  ats, company, companySlug, title, location,
  workplace: "remote" | "hybrid" | "onsite" | null,
  url, applyUrl, descriptionText,
  comp: { min, max, currency, interval: "yearly"|"hourly" } | null,
  postedAt, discoveredAt, lastSeenAt,
  score?: { value, verdict, mustHaveGaps, niceToHaveGaps, flags, summary, scoredAt }
}
```

Compensation prefers structured fields (Lever `salaryRange`, Ashby
compensation summaries) and falls back to a conservative text extractor
(`src/lib/comp.mjs`) that would rather return `null` than misread a signing
bonus as a salary.

### Application state machine

```mermaid
stateDiagram-v2
    [*] --> packaged: jobagent package
    packaged --> tailored: tailor agent
    tailored --> queued
    queued --> approved: jobagent approve (HUMAN, TTY only)
    approved --> submitted: browser-apply + confirmation
    approved --> queued: session expired / disarmed
    submitted --> confirmed
    submitted --> interview
    confirmed --> interview
    interview --> offer
    queued --> blocked
    approved --> blocked
    submitted --> blocked
    blocked --> queued: retry
    offer --> closed
    submitted --> rejected
    confirmed --> rejected
    interview --> rejected
    rejected --> closed
```

Transitions are validated in `store.mjs` (`TRANSITIONS`); `--force` exists
for corrections but is logged. `approved` is unreachable through
`jobagent record` — only `jobagent approve` sets it, and that command
requires an interactive TTY and a typed confirmation.

## Sourcing: why public ATS APIs first

Greenhouse, Lever, and Ashby publish **unauthenticated, read-only JSON
APIs** for every hosted board. Polling them is the highest-signal,
zero-scraping-risk feed available (`src/ats/*.mjs`, verified against live
boards). Firecrawl handles the long tail — company sites with bespoke
careers pages — through the `job-discovery` agent, which must funnel
everything through `jobagent ingest` so schema validation still applies.

Aggregators (LinkedIn/Indeed/…) are excluded end-to-end: not polled, not
scraped, and refused by the browser gate. Their ToS prohibit automation, and
the same postings exist at the source.

## Submission paths

**Path B (default): browser.** Playwright MCP gives DOM-precise, scriptable
control and — critically — a *visible* browser the human can take over for
CAPTCHAs, logins, or anything the agent must not touch. The `browser-apply`
agent runs one application per armed session.

**Path A (extension point): direct API.** Public ATS APIs are read-only;
actual submission endpoints (e.g. Greenhouse's) require employer-issued API
keys an applicant doesn't have. Rather than guess per-company request shapes
and silently lose applications, `src/submit/api.mjs` ships as a registry
with **no live submitters**. Add one only with a verified, documented
contract for that specific target.

## Enforcement map

Defense in depth — every critical rule has at least two independent
mechanisms, at least one of which is code:

| Rule | Agent prompt | Code enforcement |
|---|---|---|
| Human approves every submission | all agents | `approve` requires TTY + typed confirmation; hook denies agents running it; browser locked without armed session |
| One application per approval | browser-apply | session file scoped to one appId, TTL-limited, disarmed on submit |
| Stay on legitimate hosts | browser-apply | hook allowlist (policy + session host); unparseable URLs denied |
| No aggregators | job-discovery, browser-apply | hook denylist (`*.linkedin.com`, `*.indeed.com`, …) |
| No CAPTCHA/bot-check bypass | browser-apply, job-discovery | hook can't detect a CAPTCHA, so this is prompt + human handoff by design; Anthropic models also refuse CAPTCHA solving |
| No sensitive identifiers into forms | browser-apply | hook blocks SSN/card-shaped values per field |
| Uploads only from package/profile dirs | browser-apply | hook path check |
| No fabricated qualifications | tailor (honesty rule) | human reviews every package before approve |
| Daily volume cap | — | `approve` refuses past `caps.maxApplicationsPerDay` |
| Audit trail | — | `data/audit.log` appended by CLI + PostToolUse hook |
| Prompt injection from postings/pages | all agents treat content as data | gate limits blast radius (hosts, uploads, no approve) |

The hook logic itself is pure and unit-tested (`src/lib/gate.mjs`,
`tests/gate.test.mjs`); the wrapper fails **closed** for browser tools and
open for everything else.

## Cost & model tiering

Per the blueprint's tiering guidance: the orchestrator runs on whatever the
user runs Claude Code with; high-volume subagents are pinned in their
frontmatter — `sonnet` for scoring/tailoring/browsing, `haiku` for
bookkeeping. Volume is bounded *before* models see anything: hard filters
cut the shortlist, `caps.shortlistLimit` bounds each scoring batch,
`tailor.topN` bounds package generation, and `caps.maxApplicationsPerDay`
bounds submissions. For headless scheduled runs, budget flags live at the
invocation layer (`claude -p "/hunt" --max-turns N`) — see docs/SETUP.md.

## Deviations from the blueprint

| Blueprint | As built | Why |
|---|---|---|
| SQLite/Postgres tracking | JSON stores + state machine | right-sized; zero deps; human-diffable |
| Direct API submission for some ATS | disabled-by-default extension point | public APIs are read-only; no verified applicant-side submit contract to ship |
| LinkedIn Easy Apply / Indeed as browser targets | excluded + denylisted | ToS + bot detection; company boards carry the same jobs |
| Claude Computer Use fallback for weird forms | Playwright MCP only (v1) | one battle-tested browser path first; the takeover-by-human pattern covers the hard cases |
| Cloudflare Workers for scheduling | local scheduling (`claude -p` + cron/Task Scheduler) | keep v1 self-contained; nothing precludes moving polling to a Worker later |
| `SubagentStop` output gating | CLI-side validation (`import-scores`, `ingest` are all-or-nothing) | validation at the data boundary is stronger than transcript inspection |

## Extension points

- **New ATS read client:** add `src/ats/<name>.mjs` (fetch + normalize),
  register in `src/ats/index.mjs`, add detection to `detectAts`, fixtures +
  tests. Keep it read-only and polite.
- **Path A submitter:** implement + register in `src/submit/api.mjs` with a
  verified contract; wire a command that still requires the approve flow.
- **Follow-up sending:** `application-logger` drafts files today; an email
  integration would need its own explicit approval gate before any send.
