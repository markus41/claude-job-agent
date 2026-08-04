# Safety & responsible use

This system automates *your* job search — sourcing, scoring, writing, and
form-filling — while keeping a human accountable for every application that
actually goes out. This document is the contract: what the system refuses,
why, and how each rule is enforced.

## Principles

1. **Human accountability.** A job application is a representation to another
   human being. Every submission requires a fresh, per-application approval
   from a person at a real terminal. There is no auto-approve configuration.
2. **Truthfulness.** Tailoring optimizes presentation of true facts. The
   system may never invent skills, titles, dates, degrees, or experience.
   Lying on applications hurts the candidate (rescinded offers, terminations)
   and everyone else in the pile.
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
- Submit **without human approval**, or approve on the human's behalf.

If you want a tool that does those things, this isn't it, and we'd gently
suggest the problem is the plan rather than the tooling.

## Enforcement (rule → mechanism)

Prompts alone don't constrain a confused model, so every critical rule has a
code-level backstop:

| Rule | Mechanisms |
|---|---|
| Human approval per submission | `jobagent approve` requires an interactive TTY + typed app-id confirmation; the PreToolUse hook denies any agent Bash call containing `jobagent approve`; browser tools are denied entirely unless an approval armed `data/state/apply-session.json` (TTL-boxed, single application) |
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
suspicious posting content):

1. `node bin/jobagent.mjs disarm` — instantly locks all browser tools.
2. Check `data/audit.log` — every browser action and state change is there.
3. Check the application folder for exactly what was written/submitted.
4. File an issue (with the injected/suspicious content if applicable).

## Your responsibilities

- Review every package before approving — the words go out under your name.
- Keep your profile and master resume truthful; the system amplifies
  whatever you put there.
- Respect per-site terms for anything you add to the allowlist.
- Applicable employment law (e.g. on automated tools, references, or
  disclosures) varies by jurisdiction — you own compliance for where you
  live and apply.
