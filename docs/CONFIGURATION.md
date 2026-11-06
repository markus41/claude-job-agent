# Configuration reference

Every knob in one place. Live files are gitignored; committed `*.example.*`
files show the shapes. `/setup` fills all of this in conversationally — this
page is for hand-tuning afterwards.

Quick sanity commands:

```bash
node bin/jobagent.mjs policy   # the effective merged policy (defaults + your overrides)
node bin/jobagent.mjs doctor   # validates everything below
```

## config/policy.json — behavior & guardrails

Deep-merged over the defaults in `src/lib/config.mjs` (`DEFAULT_POLICY`), so
you only write the keys you change. Arrays replace entirely.

| Key | Default | Meaning |
|---|---|---|
| `allowlist.hosts` | ATS hosts + `*.myworkdayjobs.com` | Hosts the browser agent may navigate to while a session is armed. The approved application's own host is always allowed automatically. `*.x.com` matches `x.com` and any subdomain. |
| `denylist.hosts` | LinkedIn, Indeed, Glassdoor, ZipRecruiter, Monster | Always refused, checked before the allowlist. Extending it is fine; shrinking it is not supported behavior. |
| `caps.maxApplicationsPerDay` | `10` | `approve` refuses past this. |
| `caps.maxJobAgeDays` | `60` | Hard filter drops older postings. |
| `caps.shortlistLimit` | `40` | Max unscored jobs per scoring batch (bounds model cost). |
| `caps.descriptionChars` | `3500` | Description truncation in the shortlist the scorer reads. |
| `approval.mode` | `"manual"` | `"manual"` = a human approves each application. `"auto"` = a human authorizes a batch up front and the agent submits unattended (see [Auto-submit](#auto-submit-mode) below). |
| `approval.sessionTtlMinutes` | `60` | How long an approval keeps the browser armed. |
| `approval.auto.requireScore` | `80` | Minimum fit score for unattended submission. |
| `approval.auto.maxBatch` | `10` | Applications one authorization may cover. |
| `approval.auto.ttlHours` | `12` | How long an authorization stays valid. |
| `approval.auto.requireResumePdf` | `true` | Refuse unattended submission with no PDF to upload. |
| `approval.auto.maxPerCompanyPerDay` | `1` | Don't machine-gun one employer. |
| `approval.auto.blockOnNeedsHumanInput` | `true` | Refuse if screening answers are still unanswered. |
| `tailor.minScore` | `65` | `package` refuses jobs scored below this (override per-job with `--force`). |
| `tailor.topN` | `5` | Default number of applications `/hunt` tailors per run. |
| `tailor.coverLetter.maxWords` | `300` | Cover letter length cap. |
| `tailor.coverLetter.tone` | `"professional"` | `professional` \| `warm` \| `direct` \| `enthusiastic` — steer the writing voice. |
| `scoring.weights.*` | 35/20/15/10/10/10 | Rubric weights for `mustHaveSkills`, `titleSeniority`, `locationWorkplace`, `compensation`, `domainIndustry`, `trajectoryFlags`. Must sum to 100 (doctor checks). |
| `followUps.days` | `[7, 14]` | Days after submission when follow-ups come due. |

## Auto-submit mode

Off by default. It replaces *per-application* approval with *batch*
authorization — you still consent to every submission, you just do it up
front instead of one at a time.

**Turning it on** (two deliberate steps, both yours):

1. Set `"approval": { "mode": "auto" }` in `config/policy.json`.
2. In your own terminal (TTY required, agents are hook-blocked from this):

```bash
node bin/jobagent.mjs auto-enable --batch 10 --hours 12 --min-score 80
```

It prints exactly which packages would go out, lists queued ones that are
*not* eligible and why, and makes you type `authorize 10` to confirm.

**Then, in Claude Code:** `/auto-apply` works through the batch back to back.

**Managing it:**

```bash
node bin/jobagent.mjs auto-status    # batch state + what's eligible/blocked
node bin/jobagent.mjs auto-next      # just the queue with blockers
node bin/jobagent.mjs auto-revoke    # cancel immediately, disarm the browser
```

**Per-application blockers that stop auto-submit every time** (from
`src/lib/auto.mjs`, and `auto-status` shows which ones are firing): mode not
`auto`; no/expired/exhausted authorization; application not `queued`; no fit
score or below the floor; incomplete package; `NEEDS HUMAN INPUT` still in
`answers.md`; no resume PDF; daily cap; per-company/day cap; denylisted host.

A note worth taking seriously: this tool *could* fire off applications far
faster than any human reads them, and that is the fastest way to damage a
candidate's reputation — recruiters and ATS platforms notice bulk-identical
submissions, and quality drops the moment nobody is reading. The defaults
(score floor 80, one per company per day, 10/day cap, 12-hour authorization)
are set for "a serious search," not "a spray." Raise them knowingly.

## config/companies.json — where to look

```json
{ "targets": [
    { "company": "Cloudflare", "ats": "greenhouse", "slug": "cloudflare" },
    { "company": "SomeCo", "careersUrl": "https://someco.com/careers" }
] }
```

- Known ATS (`greenhouse` | `lever` | `ashby`) + board slug → polled
  deterministically by `jobagent discover`. Find slugs with
  `jobagent detect <any-posting-url>`.
- `careersUrl` only → chased by the job-discovery agent (Firecrawl/WebFetch).

## profile/ — who you are (all gitignored)

| File | Purpose |
|---|---|
| `profile.json` | Contact, links, work authorization, **targets** (titles, include/exclude keywords, seniority, `remote` policy, `locations`, `salaryFloor`, industries, `dealBreakers`), skills tiers, education, `screeningDefaults` (the answers forms get). Targets drive the hard filters — see the example file for every field. |
| `resume.md` | The **master resume**. Tailored variants may only reorder/reweight/rephrase what's here. |
| `resume.pdf` | Export for form uploads (keep current). |
| `answers.json` | Screening Q&A bank — consistent answers across every application. |
| `achievements.json` | **Metrics & achievements bank**: quantified wins, projects, certifications, awards, talks. Extra ground truth for scoring evidence and stronger bullets — same no-fabrication rule as the resume. |
| `uploads/` | Drop zone for source documents (your existing resume, review docs). Add via `jobagent upload <file>` (.pdf/.md/.txt/.docx/.doc/.rtf/.html). `/setup` builds your profile from these; `/apply` falls back to the newest PDF here if no `resume.pdf` exists. |

## The live tracker

Every application write refreshes two human-readable files (no config, always
on, gitignored):

- `data/applications.xlsx` — opens in Excel / Numbers / LibreOffice / Sheets,
  frozen header row, one row per application: app id, company, role, status,
  fit score, verdict, created, submitted, next follow-up, last note, apply
  URL, package folder.
- `data/applications.csv` — same columns, for anything that prefers CSV.

They are a *view*, never the ledger — `data/applications.json` remains the
source of truth, and a failed tracker write is logged to `data/audit.log`
without breaking the state change. Columns are defined by `COLUMNS` in
`src/lib/workbook.mjs` if you want different ones. Keep the file closed when
a run is in progress: Excel locks open files on Windows, which blocks the
refresh (the audit log will say so).

## Model & agent tuning

Each subagent pins its model in its frontmatter (`.claude/agents/*.md`):
`sonnet` for discovery/scoring/tailoring/browsing, `haiku` for bookkeeping.
Edit the `model:` line to trade cost vs. quality (e.g. `haiku` for scoring
huge volumes, `opus` for final-draft cover letters). Agent instructions are
plain Markdown — tweak tone/rubric details there; the enforcement lives in
code either way.

## Environment variables

| Variable | Effect |
|---|---|
| `JOBAGENT_HOME` | Relocate all state/config/profile away from the repo folder (tests use this; handy for multiple people sharing one machine — one workspace folder per person). |
| `FIRECRAWL_API_KEY` | Passed when adding the optional Firecrawl MCP (see SETUP.md). |
| `JOBAGENT_DIR` | Used only by the one-click bootstrap scripts as the default install folder. |

## Headless scheduling knobs

`claude -p "/hunt" --max-turns 40` — cap agentic turns per scheduled run.
Submission can't happen headless (approval needs your TTY), so cron/Task
Scheduler runs are bounded to sourcing→tailoring.

## What is deliberately NOT configurable

Effective policy values are validated after merging. Numeric strings,
negative caps, invalid modes and scoring weights that do not total 100 are
rejected before the pipeline runs. Both manual and auto authorization modes
are supported by doctor; it does not change the mode.

Workflow inspection and tracking commands:

```bash
node bin/jobagent.mjs workspace --json
node bin/jobagent.mjs workspace --app app-xxxxxxxx --json
node bin/jobagent.mjs select --limit 3 --json
node bin/jobagent.mjs recover
node bin/jobagent.mjs follow-up-draft app-xxxxxxxx <dueAt>
node bin/jobagent.mjs follow-up-complete app-xxxxxxxx <dueAt> --confirmed --note "Human reports sent"
```

Use the exact due date and draft filename returned by status. Completion is
recordkeeping after the human's explicit report; it does not send anything.
Recovery never creates permission, replaces a live session, or refunds a
consumed batch slot. State-lock contention fails with a retry message rather
than waiting or bypassing the lock.

- **Authorization always comes from a human at a terminal.** `approve` and
  `auto-enable` both require a TTY and a typed confirmation, and both are
  hook-blocked for agents. Auto mode changes the *granularity* of your
  consent (batch instead of per-application), never its existence.
- **CAPTCHA and bot-check behavior.** Never solved, never bypassed, in any
  mode.
- **Credential, ID, and payment entry.** Blocked at the gate.
- **Aggregator denylist, upload containment.** Enforced in
  `src/lib/gate.mjs` + `src/lib/auto.mjs` and unit-tested; changing them
  means editing enforcement code, which the repo's CLAUDE.md forbids agents
  from doing on your behalf.
- **The no-fabrication rule.** There is no setting that lets the tailor
  invent a qualification.
