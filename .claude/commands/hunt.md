---
description: Full pipeline run — discover, shortlist, score, tailor the best matches, and build the human review queue. Stops before any submission.
argument-hint: [top-n]
---

Run the full sourcing→queue pipeline. Tailoring cap for this run: use the
first argument if one was given ("$1"), otherwise the policy `tailor.topN`
(default 5). An argument may lower the cap but never silently raise it above
policy.

0. **Inspect** — run `node bin/jobagent.mjs workspace --json`. If not ready,
   report its blockers and stop. Use its resolved paths throughout the run.
1. **Discover** — delegate to the `job-discovery` subagent. Wait for its
   summary.
2. **Shortlist** — run `node bin/jobagent.mjs shortlist`. If the shortlist is
   empty, report the rejection histogram and stop.
3. **Score** — delegate to the `fit-scorer` subagent. Wait for the verdict
   distribution.
4. **Tailor** — run `node bin/jobagent.mjs select --json` (add `--limit N`
   when a lower cap was requested). Delegate exactly its returned jobIds to
   the `tailor` subagent. Selection owns ranking, caps and duplicate exclusion.
5. **Report** — run `node bin/jobagent.mjs status` and present:
   - new jobs found, shortlist size, score distribution
   - each queued application: id, company, title, folder path, score, and
     any `NEEDS HUMAN INPUT` items
   - exactly what the human does next: review each folder, then run
     `node bin/jobagent.mjs approve <appId>` in their own terminal for the
     ones they want submitted, then `/apply <appId>`.

Never submit anything from this command. Never run `jobagent approve`
yourself — it is human-only and the gate enforces that.
