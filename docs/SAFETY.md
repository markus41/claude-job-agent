# Safety & responsible use

This system automates *your* job search — sourcing, scoring, writing, and
form-filling — while keeping a human accountable for every application that
actually goes out. This document is the contract: what the system refuses,
why, and how each rule is enforced.

## Principles

Current enforcement limits: role instructions such as “no network” are not
an operating-system sandbox, because those roles can invoke Bash. The browser
gate checks verified tool inputs; redirects and page changes caused by clicks
still need the browser agent's scope checks. Arbitrary script execution and
unknown browser operations are denied. Claims about absolute isolation should
be read within these limits.

1. **Human accountability.** A job application is a representation to another
   human being. Every submission is authorized by a person at a real
   terminal — either per application (`approve`, the default) or as an
   explicit batch (`auto-enable`, opt-in). No submission ever happens without
   one of those two human acts. See [Auto-submit mode](#auto-submit-mode).
2. **Truthfulness.** Tailoring optimizes presentation of true facts. The
   candidate's ground truth is `profile/` — resume, profile, and the
   achievements/metrics bank — and the system may never add skills, titles,
   dates, degrees, or experience beyond it. Lying on applications hurts the
   candidate (rescinded offers, terminations) and everyone else in the pile.
3. **Least privilege.** Each subagent gets the minimum tool surface: the
   scorer and tailor have no network; the discovery agent has no browser;
   the browser agent acts only inside an armed, time-boxed, host-fenced
   session.
4. **Respect for the sites you apply through.** Public read APIs are used as
   published, politely rate-limited, with an identifying User-Agent.
   Aggregators that prohibit automation are excluded entirely.
5. **Auditability.** State transitions and browser actions are logged to
   `data/audit.log`; each submission stores the exact materials sent.
6. **Privacy.** The candidate's data lives only in gitignored local files.
   Nothing personal is committed, and the gate blocks uploading files from
   outside the package/profile directories.

## Hard refusals

The system will not, under any configuration:

- Solve, bypass, or automate around **CAPTCHAs or bot-detection** — it stops
  and hands the visible browser to the human.
- Enter **passwords, SSNs, government IDs, dates of birth, or payment data**
  into any form. Account creation and login are done by the human directly.
- Automate **LinkedIn, Indeed, Glassdoor, ZipRecruiter, or Monster** — their
  terms of service prohibit it. Company career pages carry the same jobs.
- **Fabricate qualifications** or answer screening questions it has no
  truthful answer for.
- Submit **without human authorization**, or authorize on the human's behalf
  (neither `approve` nor `auto-enable` can be run by an agent).

If you want a tool that does those things, this isn't it, and we'd gently
suggest the problem is the plan rather than the tooling.

## Enforcement (rule → mechanism)

Prompts alone don't constrain a confused model, so every critical rule has a
code-level backstop:

| Rule | Mechanisms |
|---|---|
| Human authorization per submission | `jobagent approve` requires an interactive TTY + typed app-id confirmation; the PreToolUse hook denies any agent Bash call containing `jobagent approve` **or** `jobagent auto-enable`; browser tools are denied entirely unless an authorization armed `data/state/apply-session.json` (TTL-boxed, single application) |
| Unattended runs stay inside the human's mandate | `autoPreflight()` re-checks 10 conditions per application and refuses on any of them; each auto-arm consumes one unit of the attested batch, which expires by clock and by count |
| Host fencing | hook checks every `browser_navigate` URL against `allowlist.hosts` + the approved application's own host; unparseable URLs denied |
| Aggregator exclusion | hook denylist (`*.linkedin.com`, `*.indeed.com`, `*.glassdoor.com`, `*.ziprecruiter.com`, `*.monster.com`) — checked before the allowlist |
| Sensitive input | hook blocks SSN-shaped and card-shaped values per form field |
| Upload containment | hook resolves every upload path; only `applications/**` and `profile/**` pass |
| Volume | `approve` enforces `caps.maxApplicationsPerDay`; shortlist/tailor batch caps bound model usage |
| State integrity | transitions validated by the state machine; `approved` unreachable via `record`; score/ingest imports are all-or-nothing validated |
| Audit | CLI appends state events; a PostToolUse hook appends every browser action |
| Gate failure | the hook fails **closed** for browser tools (a broken gate locks the browser, not the other way around) |

The gate logic is pure, dependency-free, and unit-tested
(`src/lib/gate.mjs`, `tests/gate.test.mjs`).

## Auto-submit mode

Off by default; enabling it takes two deliberate human acts (a policy edit
plus a TTY-only `auto-enable` ceremony with a typed confirmation). It exists
because reviewing every package one at a time is genuinely slow once you
trust the output — so it moves your consent earlier, to a batch, instead of
removing it.

**What changes.** Who may arm the browser gate. In manual mode only
`approve` can; in auto mode the agent may call `auto-arm <appId>`, which arms
a session *only if* every preflight condition passes and there is batch
capacity left. Each arm burns one unit; the authorization also expires by
clock (`ttlHours`).

**What does not change — any mode, any config:**

- The PreToolUse gate still governs every browser call: host allowlist,
  aggregator denylist, upload containment, SSN/card blocking, armed-session
  requirement.
- CAPTCHAs and bot-checks are never solved or bypassed. Unattended, hitting
  one records the application `blocked` and moves on.
- Logins, account creation, credentials, government IDs, payment data:
  never entered. Unattended, they end that application as `blocked`.
- `NEEDS HUMAN INPUT` in a package blocks that submission outright — the
  agent will not invent an answer to get past it.
- The no-fabrication rule on all written materials.
- The audit trail: `auto-enable`, every `auto-arm`, every refusal (with its
  blocker list), and every browser action land in `data/audit.log`.

**Volume, honestly.** The machinery could submit far faster than any human
can read, and that is the main way it could hurt the person using it:
recruiters and ATS platforms flag bulk submissions, and unread applications
are worse applications. The defaults (score floor 80, one application per
company per day, 10 per day overall, 12-hour authorization) are tuned for a
serious search rather than a spray, and `auto-status` always shows exactly
what is queued and what is blocked. Raise the caps knowingly, and keep
reading a sample of what goes out.

**Kill switch.** `node bin/jobagent.mjs auto-revoke` cancels the batch and
disarms the browser immediately; `disarm` alone locks the browser without
touching the batch.

## Prompt injection

Job postings and web pages are untrusted input that the model reads at scale
— exactly the channel prompt-injection attacks use. Defenses:

- Every agent's instructions declare page/posting content to be **data, not
  instructions**, and require reporting anomalies.
- The blast radius is capped by code: even a fully hijacked agent cannot
  approve, cannot leave the allowlisted hosts, cannot upload arbitrary
  files, cannot run the approve command, and cannot exceed the armed
  session's scope or TTL.
- The scorer and tailor (which read the most untrusted text) have **no
  network access**, so exfiltration via those stages has nowhere to go.

## Rate limiting & politeness

- ATS polling is sequential with a delay between boards, sends an
  identifying User-Agent, and hits documented public endpoints only.
- Discovery never crawls behind logins or robots.txt exclusions; protected
  pages are skipped and reported.
- Browser sessions are single-application and time-boxed; there is no bulk
  submission mode.

## Incident response

Something looks wrong (agent acting oddly, unexpected navigation attempt,
suspicious posting content, an auto run doing more than you meant):

1. `node bin/jobagent.mjs auto-revoke` — cancels any batch authorization AND
   disarms the browser. (`disarm` alone locks the browser but leaves the
   batch intact.)
2. Check `data/audit.log` — every browser action, state change, arm, and
   refusal is there.
3. Check `data/applications.xlsx` for the readable picture of what went out,
   and the application folders for exactly what was submitted.
4. File an issue (with the injected/suspicious content if applicable).

## Your responsibilities

- Review every package before approving — the words go out under your name.
  In auto mode, read a real sample regularly; you authorized the batch, so
  its contents are yours.
- Keep your profile and master resume truthful; the system amplifies
  whatever you put there.
- Respect per-site terms for anything you add to the allowlist.
- Applicable employment law (e.g. on automated tools, references, or
  disclosures) varies by jurisdiction — you own compliance for where you
  live and apply.
