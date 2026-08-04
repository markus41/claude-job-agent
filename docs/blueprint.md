# Original architecture blueprint

> **Provenance:** this is the research brief the repo was built from
> (August 2026), preserved verbatim for context. It describes the target
> architecture and cites its sources; the **as-built** system — including
> deliberate deviations (JSON store instead of SQLite, Path A disabled by
> default, aggregators excluded, Playwright-only browser path) — is
> documented in [../ARCHITECTURE.md](../ARCHITECTURE.md). Where this brief
> and ARCHITECTURE.md disagree, ARCHITECTURE.md describes reality.

## Overview

A fully agentic, autonomous job-application system can be built on Claude Code as the orchestration runtime, combining structured ATS data feeds, Firecrawl for pages without public APIs, and Claude's computer-use/browser capabilities to physically complete applications that have no programmatic path. As of mid-2026, Claude Computer Use exited beta with the Claude 4.7 release and now leads independent browser-agent benchmarks at roughly 12 of 15 real-world multi-step tasks completed end-to-end, ahead of OpenAI Operator and the open-source Browser Use library. Claude Code's desktop app also ships a built-in sandboxed browser pane (shipped Week 28, July 2026) that lets an agent click, type, and navigate external sites directly inside the coding environment. This gives the foundation for a system where 100% of sourcing and matching is programmatic, and only the final "submit" step — where required — is handled by a browser or desktop agent acting as a human would.

## System Architecture

The system is best structured as an orchestrator-and-subagent pipeline rather than one monolithic agent, following current Claude Agent SDK production guidance: a planner/orchestrator model (Opus-class) delegates narrowly-scoped, single-purpose subagents (Sonnet/Haiku-class) for sourcing, tailoring, and submission, each with the minimum tool access it needs.

| Layer | Component | Role | Primary tools |
|---|---|---|---|
| Orchestration | Lead Claude agent (Claude Code / Agent SDK) | Plans daily run, delegates, tracks state, enforces budget | Agent tool, file system, SQLite/Postgres |
| Sourcing | Job-Discovery subagent | Pulls listings from ATS APIs + Firecrawl fallback | HTTP client, Firecrawl MCP, custom search API |
| Matching | Fit-Scoring subagent | Scores each posting against resume/skills/target comp+title | Read-only file access, no network |
| Tailoring | Resume/Cover-Letter subagent | Generates per-job resume variant, cover letter, screening-question answers | Templates, Read/Write, no network |
| Submission (API path) | ATS-Submit subagent | Submits directly where Greenhouse/Lever/Workday expose apply endpoints | Signed HTTP requests |
| Submission (no-API path) | Browser/Desktop-Apply agent | Uses Claude Computer Use / Cowork or Playwright MCP to fill and submit forms in-browser | Computer-use tool, Playwright MCP, Browserless MCP |
| Tracking | Application-Log subagent | Records status, dedupes, schedules follow-ups | Database writes |

This mirrors the "capable and secure" pattern recommended for production Claude deployments: the orchestrator holds broad context and routing logic while every subagent runs in an isolated context window with a scoped toolset and a `SubagentStop` hook gating its output before it's folded back in.

## Sourcing Layer: Programmatic Job Discovery

The highest-leverage, zero-scraping-risk data source is the set of public, unauthenticated ATS JSON APIs. Greenhouse and Lever both expose full job-posting data with no authentication required:

- Greenhouse: `GET https://boards-api.greenhouse.io/v1/boards/{company}/jobs?content=true` returns all open roles with full descriptions in one call.
- Lever: `GET https://api.lever.co/v0/postings/{company}?mode=json` returns the same for Lever-hosted boards.
- Ashby and Workable have comparable public board endpoints that third-party aggregators already wrap into unified feeds.

Because these are public, company-published boards, hitting them directly (rather than scraping LinkedIn or Indeed's search-result pages, which carry real bot-detection and ToS exposure) is the lowest-risk way to build the core feed. A background job maintains a list of target-company slugs (pulled from the friend's target industries/companies) and polls each ATS endpoint on a schedule, normalizing results into one schema (title, company, location, comp band if present, apply URL, ATS type).

For companies without a known ATS slug, or general "search by title/location/salary" discovery across LinkedIn, Indeed, and company career pages that don't expose a public API, Firecrawl fills the gap:

- `/v2/search` finds a company's careers page when only the company name is known.
- `/v2/scrape` with a JSON schema turns any career page into structured job data (Firecrawl's own job-board scraping guide walks through exactly this schema-plus-LLM pattern).
- `/v2/agent` (asynchronous, poll-based) is the fallback for boards where search misses or roles are buried in JS-heavy navigation — it lets Firecrawl itself navigate and extract in one step rather than requiring you to hand-code the crawl path.

A Firecrawl MCP server (or direct API calls from the Job-Discovery subagent) should be scoped to read-only network access — no reason to give this subagent file-write or Bash.

## Matching and Tailoring Layer

Once postings are normalized, a Fit-Scoring subagent — deliberately given no network access — compares each listing against a structured profile document (target titles, salary floor, must-have skills, deal-breakers, seniority level) and outputs a ranked shortlist with a fit score and gap notes. This subagent should run on a cheaper model tier (Sonnet or Haiku) since scoring is high-volume and repetitive, reserving Opus-class reasoning for the orchestrator.

For each shortlisted role, a Tailoring subagent generates:

- A resume variant that reorders/reweights bullets toward the specific posting's keywords (important for ATS keyword parsing).
- A custom cover letter referencing the specific role, company, and team.
- Draft answers to common screening questions (salary expectations, work authorization, "why this company") pulled from a maintained Q&A bank so answers stay consistent across applications, matching the pattern used in existing Claude Code auto-apply builds.

Every output should land in a versioned folder per application (`/applications/{company}-{role}-{date}/`) so the orchestrator and browser agent have a clean, auditable handoff.

## Submission Layer: API Path vs. Browser/Desktop Agent Path

This is the crux of "apply for as many jobs as possible" — the system needs two submission paths, chosen automatically per posting:

**Path A — Direct API submission.** Some ATS platforms (notably certain Greenhouse and Workday configurations) expose a documented apply/submission endpoint that accepts structured fields plus a resume file upload without requiring a browser session. Where available, an ATS-Submit subagent posts directly — fastest, cheapest, most reliable, and the preferred default whenever it exists.

**Path B — Browser or desktop agent completes the form.** For the large majority of postings (LinkedIn Easy Apply, Indeed, most Workday/Taleo instances, and any bespoke company career-page form), there is no clean API, and a human-equivalent agent must fill and submit the form. Two viable implementations exist, and the system should support both:

- Claude Computer Use / Cowork: takes periodic screenshots, reasons over on-screen state, and issues clicks/keystrokes — genuinely useful for multi-step flows with account creation, file uploads, and multi-page wizards, where it currently leads competing browser agents in success rate.
- Playwright MCP or Browserless MCP: gives Claude Code a real, scriptable browser it drives via DOM-aware actions rather than pure screenshots — a documented pattern already used to build fully autonomous "one command" apply systems (`claude mcp add playwright -- npx @playwright/mcp@latest`), and generally faster/cheaper per task than screenshot-based computer use.

A practical hybrid: use Playwright/Browserless MCP as the default browser driver (cheaper, DOM-precise, good for known ATS templates like Workday/Taleo/iCIMS), and fall back to full Claude Computer Use only for unfamiliar, highly custom, or CAPTCHA-guarded career-page forms where visual reasoning over an unpredictable UI matters more than speed. Both approaches should run inside sandboxed browser profiles — the July 2026 Claude Code desktop browser pane, for instance, runs a clean isolated profile that can complete fresh OAuth/account-creation popups without touching the user's real logins, which matters for the account-creation step many ATS platforms require before application.

The Application-Log subagent should record, per posting: which path was used, timestamp, confirmation screenshot or confirmation-email match, and a hash of the exact resume/cover-letter version submitted — this creates an audit trail and prevents duplicate applications on repeated runs.

## Orchestration, Cost Control, and Safety Guardrails

Running this at volume (dozens to hundreds of applications) makes cost and safety controls non-optional, not optional polish:

- **Budget gates.** Set `max_turns` and `max_budget_usd` on every Agent SDK `query()` call so a runaway subagent loop cannot silently burn spend, and use pessimistic budget deduction in fan-out scenarios where multiple subagents fire in parallel.
- **Least-privilege tool scoping.** The Job-Discovery subagent gets network-only tools; the Fit-Scoring and Tailoring subagents get file read/write only, no network; only the Submission subagents get browser/computer-use tools — this containment means a bad run in one subagent can't cascade into unrelated capabilities.
- **PreToolUse hooks and human-in-the-loop gates.** A `PreToolUse` hook should hard-block any submission action outside an approved company allowlist, and a `canUseTool` callback can surface high-stakes actions (e.g., submitting to a role above/below the stated comp band) for a quick human approve/deny rather than blanket auto-approval.
- **Model tiering.** Use an Opus/Fable-class model for the orchestrator where planning quality matters, and Sonnet/Haiku for the high-volume, repetitive subagent work (scoring hundreds of postings, filling routine form fields) — production teams report roughly 40% lower cost with tiered models and minimal capability loss on worker tasks.
- **Safety awareness on computer-use agents.** Recent red-team research found that even safety-aligned frontier models like Claude 4.5 Sonnet showed a meaningfully high attack-success rate when deployed in multi-agent computer-use setups exposed to untrusted web content, rising further when subtasks were decomposed across agents. Practically, this means the browser/desktop submission agent should treat scraped page content as untrusted data, never execute instructions found embedded in a job posting or web page, and should operate under the same allowlist/approval hooks as any other high-stakes action.
- **Checkpointing.** Persist state after each phase (sourcing complete, scoring complete, tailoring complete, submissions complete) so a failure mid-run resumes from the last completed phase instead of restarting the entire batch — the current best-practice guidance explicitly favors checkpoint-based recovery over full restarts for long agentic runs.

## Reference Stack Summary

| Need | Recommended tool | Why |
|---|---|---|
| Orchestration runtime | Claude Code + Claude Agent SDK | Native subagent definitions, hooks, budget controls |
| Structured job feeds | Greenhouse/Lever/Ashby public APIs | No auth, no scraping risk, full postings in one call |
| Unstructured/JS-heavy career pages | Firecrawl scrape/search/agent endpoints | Schema-driven extraction, async agent mode for buried listings |
| DOM-precise form filling | Playwright MCP or Browserless MCP | Faster/cheaper than screenshot loops, proven auto-apply pattern |
| Visual/unpredictable UI submission | Claude Computer Use (API) or Cowork | Leads current browser-agent benchmarks on multi-step reasoning tasks |
| Sandboxed browsing for OAuth/account creation | Claude Code desktop browser pane | Clean isolated profile, no session hijack risk |
| Deployment/compute | Cloudflare Workers (cron polling, webhook receivers, lightweight API proxy) | Fits the "expand however needed" scope for scheduling and edge functions |

## Practical Build Sequence

1. Stand up the ATS API poller (Greenhouse/Lever/Ashby) and normalize into a shared schema — this alone covers a large share of tech/corporate roles with zero scraping risk.
2. Wire Firecrawl MCP for company-name-only discovery and non-API career pages.
3. Build the Fit-Scoring and Tailoring subagents against a structured candidate profile document.
4. Stand up Playwright MCP as the default submission driver against known ATS templates (Workday, Taleo, iCIMS forms follow predictable DOM patterns), following the documented `/auto-apply` command pattern.
5. Add Claude Computer Use/Cowork as the fallback path for anything Playwright can't reliably navigate.
6. Layer in budget gates, PreToolUse allowlist hooks, and the Application-Log subagent before running at any real volume.

*(The original brief's numbered source list — benchmark posts, vendor docs, and research papers — is omitted here; the load-bearing technical references are linked directly from ARCHITECTURE.md and the source files that implement them.)*
