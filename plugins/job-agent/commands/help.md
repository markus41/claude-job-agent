---
description: How the claude-job-agent workflow fits together, and where to get unstuck.
---

Explain the claude-job-agent workflow to the user, adapted to what they ask.
The source of truth is the repo docs — if you are inside the workspace, read
them (README.md, docs/SETUP.md, docs/SAFETY.md, docs/CONFIGURATION.md);
otherwise summarize from this outline and link
https://github.com/markus41/claude-job-agent.

The loop (all inside the claude-job-agent folder):

1. `/setup` — one-time guided interview: imports their resume, builds their
   profile, achievements bank, answers bank, target companies, and policy.
2. `/hunt` — discovers jobs from their target companies' public ATS boards,
   hard-filters, scores against their profile, and writes tailored
   application packages (resume variant + cover letter + screening answers)
   into `applications/<folder>/` for review.
3. Review the folder, then approve in THEIR OWN terminal:
   `node bin/jobagent.mjs approve <appId>` — agents cannot run this, by
   design.
4. `/apply <appId>` — a visible browser fills the form; the human handles
   any CAPTCHA or login; submission is recorded with confirmation.
5. `/status` — dashboard. `/follow-up` — drafts follow-up notes when due.
   `/doctor` — environment check. `jobagent policy` — show effective config.

Key facts to convey when relevant:
- Everything personal lives in gitignored local files (`profile/`,
  `applications/`, `data/`, live `config/*.json`).
- The tailor never invents facts; unanswerable questions come back flagged
  `NEEDS HUMAN INPUT`.
- LinkedIn/Indeed/aggregators are out of scope (ToS); company boards only.
- Configuration knobs live in `config/policy.json` — documented in
  docs/CONFIGURATION.md.
- If the project's slash commands (/hunt, /setup…) are missing, they are in
  the wrong folder: Claude Code must be started in the claude-job-agent
  directory. `/job-agent:install` can get them there.
